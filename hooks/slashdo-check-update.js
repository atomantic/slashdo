#!/usr/bin/env node
// Check for slashdo updates in background, write result to cache.
// Called by SessionStart hook - runs once per session.
//
// The curl installer (install.sh) is explicitly npm-free, so this hook can run
// on a machine with no npm/npx on PATH. In that case there is no way to learn the
// latest version, so the cache records `update_check: 'npm-unavailable'` plus a
// one-shot `notice` for the statusline instead of a bare `update_available: false`
// that would be indistinguishable from "you're already on the latest version".
//
// When the user opted into auto-update (~/.claude/.slashdo-config.json:
// { "autoUpdate": true }), a detected update is applied automatically by
// running `npx -y slash-do@latest` instead of surfacing the ⬆ /do:update
// statusline hint. On auto-update failure we fall back to showing the hint.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const homeDir = os.homedir();
const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(homeDir, '.claude');
const cacheDir = path.join(claudeDir, 'cache');
const cacheFile = path.join(cacheDir, 'slashdo-update-check.json');
const versionFile = path.join(claudeDir, '.slashdo-version');
const configFile = path.join(claudeDir, '.slashdo-config.json');
// Serializes the auto-update across concurrent Claude sessions — only the session
// that atomically creates this file runs `npx slash-do@latest`; the rest defer.
const lockFile = path.join(cacheDir, 'slashdo-update.lock');

// Best-effort: silently exit on any setup failure (permissions, read-only FS, etc.)
try {
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  // Spawn background process so we don't block session start
  const child = spawn(process.execPath, ['-e', `
    const fs = require('fs');
    const { execSync } = require('child_process');

    const cacheFile = ${JSON.stringify(cacheFile)};
    const versionFile = ${JSON.stringify(versionFile)};
    const configFile = ${JSON.stringify(configFile)};
    const lockFile = ${JSON.stringify(lockFile)};
    // A lock older than this is treated as abandoned (crashed/killed mid-update)
    // and reclaimed. Kept well above the 120s install timeout below so a slow-but-
    // live install is never stolen out from under itself.
    const LOCK_STALE_MS = 10 * 60 * 1000;
    // How long a surfaced npm/npx notice stays suppressed. It shows for the session
    // that wrote it and then goes quiet for a week: the hook cannot know whether a
    // statusline ever rendered it (the user may have a custom statusline, or a second
    // session may have rewritten the cache first), so it repeats on this cadence
    // rather than firing exactly once and risking being lost.
    const NOTICE_REPEAT_S = 7 * 24 * 60 * 60;

    // Previous cache state — carries the last notice timestamp so we warn on a
    // slow cadence instead of on every session for the rest of time.
    let previous = null;
    try {
      previous = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    } catch (e) {}

    let installed = '0.0.0';
    try {
      if (fs.existsSync(versionFile)) {
        installed = fs.readFileSync(versionFile, 'utf8').trim();
      }
    } catch (e) {}

    // No version file means slashdo isn't installed — skip silently
    if (installed === '0.0.0') {
      process.exit(0);
    }

    let autoUpdate = false;
    try {
      if (fs.existsSync(configFile)) {
        const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
        autoUpdate = config && config.autoUpdate === true;
      }
    } catch (e) {}

    // Probe PATH before shelling out: without this, a missing npm throws ENOENT
    // into the catch below, leaving latest === null and writing a cache that reads
    // exactly like "up to date" — the user never learns the check is dead.
    const hasCommand = (cmd) => {
      try {
        execSync((process.platform === 'win32' ? 'where ' : 'command -v ') + cmd, { stdio: 'ignore', timeout: 5000, windowsHide: true });
        return true;
      } catch (e) {
        return false;
      }
    };

    // Distinct, machine-readable reason the check could not complete (null = it did).
    let updateCheck = null;

    let latest = null;
    if (hasCommand('npm')) {
      try {
        latest = execSync('npm view slash-do version', { encoding: 'utf8', timeout: 5000, windowsHide: true }).trim();
      } catch (e) {
        // Offline / registry error / timeout: transient, so no user-facing notice,
        // but the cache still says the check failed rather than implying "current".
        updateCheck = 'lookup-failed';
      }
    } else {
      updateCheck = 'npm-unavailable';
    }

    // Simple semver comparison: only flag update when latest > installed
    let updateAvailable = false;
    if (latest && latest !== installed) {
      const parse = v => (v || '').replace(/^v/, '').replace(/-.+$/, '').split('.').map(Number);
      const [iM, im, ip] = parse(installed);
      const [lM, lm, lp] = parse(latest);
      if ([iM, im, ip, lM, lm, lp].some(isNaN)) { updateAvailable = installed !== latest; }
      else { updateAvailable = lM > iM || (lM === iM && (lm > im || (lm === im && lp > ip))); }
    }

    // Auto-update: apply the update instead of surfacing the statusline hint.
    // Guard it with an exclusive lock file so that when several Claude sessions
    // start at once, only one spawns "npx slash-do@latest" against the shared
    // the Claude config directory — the installer's writes are idempotent today,
    // but serializing keeps that assumption from being load-bearing if the
    // install logic ever stops being safe to run concurrently.
    // Set when this session sees an available auto-update but yields the lock to
    // another session: the lock holder owns the cache write for this cycle, so a
    // deferring session must NOT write its own (stale update_available:true) result
    // and clobber the holder's update_available:false once the install completes.
    let deferred = false;
    // npm can be present while npx is not (npx is a separate shim on some
    // distro-packaged Node builds). Both the auto-updater below and the manual
    // /do:update hint shell out to npx, so probe whenever there is an update to
    // apply — not just on the auto-update path, or a user with auto-update off
    // would be pointed at a /do:update that cannot run.
    const npxAvailable = updateAvailable ? hasCommand('npx') : true;
    if (updateAvailable && !npxAvailable) {
      updateCheck = 'npx-unavailable';
      // Suppress the ⬆ /do:update badge: that command is itself an npx wrapper,
      // so pointing at it here would just be a second dead end. The notice below
      // still tells the user an update exists and how to get it.
      updateAvailable = false;
    }
    if (updateAvailable && autoUpdate && npxAvailable) {
      // wx = create-exclusive: succeeds for exactly one racer, throws EEXIST for
      // the rest. In the common case (no lock yet, several sessions starting at
      // once) this gives EXACT mutual exclusion — exactly one installs.
      //
      // A pre-existing lock older than LOCK_STALE_MS is a crashed run; reclaim it.
      // Rename-then-recreate (rather than unlink-then-recreate) avoids the gross
      // race where two reclaimers both unlink and both then win wx. It is still
      // only BEST-EFFORT, not perfectly exclusive: the staleness is checked before
      // the rename, so a fresh lock created by another session in that window can
      // be reclaimed too, letting two sessions install at once. That residual race
      // is acceptable here precisely because this guard is defense-in-depth — the
      // installer's writes are idempotent, so a rare double-install during crash
      // recovery is harmless; the lock just keeps it from being load-bearing.
      let haveLock = false;
      const acquire = () => { const fd = fs.openSync(lockFile, 'wx'); fs.writeSync(fd, String(process.pid)); fs.closeSync(fd); haveLock = true; };
      try {
        acquire();
      } catch (e) {
        if (e.code === 'EEXIST') {
          try {
            if (Date.now() - fs.statSync(lockFile).mtimeMs > LOCK_STALE_MS) {
              const staleName = lockFile + '.stale.' + process.pid;
              fs.renameSync(lockFile, staleName); // atomic: one winner, losers throw ENOENT
              fs.unlinkSync(staleName);
              acquire();
            }
          } catch (e2) {}
        }
      }

      // Only the lock holder updates.
      if (haveLock) {
        try {
          // --env claude keeps this scoped to the environment running the hook,
          // and avoids the interactive multi-env prompt (stdin is not a TTY here).
          execSync('npx -y slash-do@latest --env claude', { stdio: 'ignore', timeout: 120000, windowsHide: true });
          // Installer already refreshed the cache to update_available:false and
          // bumped the version file, so nothing left to flag.
          updateAvailable = false;
          latest = installed = fs.readFileSync(versionFile, 'utf8').trim();
        } catch (e) {
          // Auto-update failed — fall through and surface the hint so the user
          // can update manually.
        } finally {
          try { fs.unlinkSync(lockFile); } catch (e) {}
        }
      } else {
        // Another session holds the lock and will install + write the authoritative
        // cache. Defer the cache write so we don't overwrite its result with our own
        // now-stale update_available:true (which would show a phantom /do:update
        // badge until the next session ran).
        deferred = true;
      }
    }

    const result = {
      update_available: updateAvailable,
      command: '/do:update',
      installed,
      latest: latest || 'unknown',
      checked: Math.floor(Date.now() / 1000)
    };

    if (updateCheck) {
      result.update_check = updateCheck;
      const notices = {
        'npm-unavailable': 'slashdo update check needs npm on PATH — update with install.sh',
        'npx-unavailable': 'slashdo update available but npx is missing — update with install.sh'
      };
      // States that carry a pending update the user cannot apply: there is nothing
      // else on the statusline for them (the ⬆ badge is suppressed above), so this
      // one repeats every session until it is resolved rather than being rate-limited.
      const persistent = { 'npx-unavailable': true };
      // The stamp and the state it belongs to are tracked separately from
      // update_check: a transient 'lookup-failed' run in between must not drop the
      // stamp and re-open the window hours after the last warning, but a change to a
      // genuinely different message must still get through. A healthy check writes
      // neither, so npm going missing again later warns immediately.
      const lastNotice = Number(previous && previous.notice_at) || 0;
      const lastState = (previous && previous.notice_state) || null;
      if (notices[updateCheck]) {
        const now = Math.floor(Date.now() / 1000);
        const windowElapsed = !lastNotice || now - lastNotice >= NOTICE_REPEAT_S;
        if (persistent[updateCheck] || windowElapsed || lastState !== updateCheck) {
          result.notice = notices[updateCheck];
          result.notice_at = now;
        } else {
          result.notice_at = lastNotice;
        }
        result.notice_state = updateCheck;
      } else if (lastNotice) {
        result.notice_at = lastNotice;
        if (lastState) {
          result.notice_state = lastState;
        }
      }
    }

    if (!deferred) {
      fs.writeFileSync(cacheFile, JSON.stringify(result));
    }
  `], {
    stdio: 'ignore',
    windowsHide: true,
    detached: true
  });

  child.unref();
} catch (e) {
  // Hook is best-effort — never break SessionStart
}
