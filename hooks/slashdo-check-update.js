#!/usr/bin/env node
// Check for slashdo updates in background, write result to cache.
// Called by SessionStart hook - runs once per session.
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
const cacheDir = path.join(homeDir, '.claude', 'cache');
const cacheFile = path.join(cacheDir, 'slashdo-update-check.json');
const versionFile = path.join(homeDir, '.claude', '.slashdo-version');
const configFile = path.join(homeDir, '.claude', '.slashdo-config.json');
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

    let latest = null;
    try {
      latest = execSync('npm view slash-do version', { encoding: 'utf8', timeout: 5000, windowsHide: true }).trim();
    } catch (e) {}

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
    // ~/.claude/ — the installer's writes are idempotent today, but serializing
    // keeps that assumption from being load-bearing if the install logic ever
    // stops being safe to run concurrently.
    // Set when this session sees an available auto-update but yields the lock to
    // another session: the lock holder owns the cache write for this cycle, so a
    // deferring session must NOT write its own (stale update_available:true) result
    // and clobber the holder's update_available:false once the install completes.
    let deferred = false;
    if (updateAvailable && autoUpdate) {
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
