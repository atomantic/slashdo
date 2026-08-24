#!/usr/bin/env node
'use strict';
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
// resolving the current registry version first and running that exact version
// with npm lifecycle scripts disabled, instead of surfacing the ⬆ /do:update
// statusline hint. On validation or auto-update failure we fall back to showing
// the hint.
//
// Structure: the parent invocation (SessionStart) only spawns a detached child
// running THIS SAME FILE with `--worker`, so session start is never blocked.
// The worker body lives in `runUpdateCheck()` below with filesystem, subprocess,
// platform, and clock dependencies injected, so test/check-update.test.js can
// drive every branch directly —
// it used to be an inline `-e` string that no test could reach.
//
// This file is deployed standalone into ~/.claude/hooks/, where `src/` does not
// exist, so it must not require anything outside Node core. The semver
// comparison lives HERE because this deployed hook must stay dependency-free
// and standalone.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execSync, execFileSync } = require('child_process');

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
const PROBE_TIMEOUT_MS = 5000;
const NPM_VIEW_TIMEOUT_MS = 5000;
const INSTALL_TIMEOUT_MS = 120000;
const NPM_COMMAND = 'npm';
const NPX_COMMAND = 'npx';
// Pin the registry lookup to the stable latest tag and force scalar output so
// user npm config (tag=next or json=true) cannot change what gets installed or
// make a valid version look malformed.
const NPM_VIEW_ARGS = Object.freeze(['view', 'slash-do@latest', 'version', '--json=false']);
// Keep this human-readable form for diagnostics and tests; the real lookup
// uses execFileSync so registry output never becomes shell syntax.
const NPM_VIEW_COMMAND = `${NPM_COMMAND} ${NPM_VIEW_ARGS.join(' ')}`;
const EXACT_VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
// --env claude keeps this scoped to the environment running the hook, and
// avoids the interactive multi-env prompt (stdin is not a TTY here).
// --ignore-scripts prevents package lifecycle hooks from becoming an additional
// unattended execution path; slash-do's bin still runs as the requested command.
function buildInstallArgs(version) {
  if (!isInstallableVersion(version)) {
    throw new TypeError('refusing an invalid slash-do version');
  }
  return ['--yes', '--ignore-scripts', `slash-do@${version}`, '--env', 'claude'];
}

// Windows exposes npm and npx as .cmd shims, which cannot be launched through
// execFileSync directly. Run cmd.exe itself as the executable there. Every
// command-line token is fixed except the registry version, which has already
// passed isInstallableVersion(), so the wrapper cannot turn registry output into
// additional cmd syntax. POSIX uses the stronger direct-argv path.
function runTool(execFileSyncDep, command, args, options, platform = process.platform,
  windowsShell = process.env.ComSpec || 'cmd.exe') {
  if (platform === 'win32') {
    return execFileSyncDep(windowsShell, ['/d', '/s', '/c', [command, ...args].join(' ')], options);
  }
  return execFileSyncDep(command, args, options);
}

const NOTICES = {
  'npm-unavailable': 'slashdo update check needs npm on PATH — update with install.sh',
  'npx-unavailable': 'slashdo update available but npx is missing — update with install.sh',
  'invalid-version': 'slashdo update check returned an invalid version — no update was applied',
};
// States that carry a pending update the user cannot apply: there is nothing
// else on the statusline for them (the ⬆ badge is suppressed below), so this
// one repeats every session until it is resolved rather than being rate-limited.
const PERSISTENT_NOTICES = { 'npx-unavailable': true, 'invalid-version': true };

// Shell probe for a command on PATH.
function probeCommand(cmd, platform = process.platform) {
  return (platform === 'win32' ? 'where ' : 'command -v ') + cmd;
}

// Every path the check reads or writes, derived from a home directory. Taking
// homeDir as an argument (rather than calling os.homedir() inline) is what lets
// tests point the whole check at a temp dir. configDir overrides it wholesale,
// mirroring CLAUDE_CONFIG_DIR — the entrypoints pass process.env, so the
// resolution itself stays a pure function of its arguments.
function resolvePaths(homeDir, configDir) {
  const claudeDir = configDir || path.join(homeDir, '.claude');
  const cacheDir = path.join(claudeDir, 'cache');
  return {
    cacheDir,
    cacheFile: path.join(cacheDir, 'slashdo-update-check.json'),
    versionFile: path.join(claudeDir, '.slashdo-version'),
    configFile: path.join(claudeDir, '.slashdo-config.json'),
    // Serializes the auto-update across concurrent Claude sessions — only the
    // session that atomically creates this file runs the exact resolved npx
    // package version;
    // the rest defer.
    lockFile: path.join(cacheDir, 'slashdo-update.lock'),
  };
}

function parseVersion(version) {
  return String(version || '')
    .replace(/^v/, '')
    .replace(/-.+$/, '')
    .split('.')
    .map(Number);
}

// Comparable means every major/minor/patch segment is a real number. A short
// version like '1.0' is NOT comparable: its missing patch segment would make
// every comparison against it silently false, hiding a genuine update.
function isComparableVersion(version) {
  const parts = parseVersion(version);
  return parts.length >= 3 && parts.every(Number.isFinite);
}

// The registry result is later used as a package selector. Require a complete
// semver value before it reaches npx, both to avoid package-spec surprises and
// to refuse a malformed response rather than guessing at an update.
function isInstallableVersion(version) {
  return typeof version === 'string' && EXACT_VERSION_RE.test(version);
}

// Semver comparison over NUMERIC segments, so 1.9.0 → 1.10.0 reads as a minor
// bump rather than the backwards answer a lexical compare would give.
// Returns 'major' | 'minor' | 'patch' when latest is newer, else null — including
// when either side is not a comparable version, which callers must handle.
function compareVersions(installed, latest) {
  if (!isComparableVersion(installed) || !isComparableVersion(latest)) return null;

  const [iMajor, iMinor, iPatch] = parseVersion(installed);
  const [lMajor, lMinor, lPatch] = parseVersion(latest);

  if (lMajor > iMajor) return 'major';
  if (lMajor === iMajor && lMinor > iMinor) return 'minor';
  if (lMajor === iMajor && lMinor === iMinor && lPatch > iPatch) return 'patch';
  return null;
}

// Update decision for the hook: a newer semver, or — when either side isn't
// parseable as semver — any difference at all, so an odd version string still
// surfaces the hint rather than silently pinning the user to a stale install.
// Only a missing `latest` (the npm lookup failed) settles it as 'no update'.
function isUpdateAvailable(installed, latest) {
  if (!latest || installed === latest) return false;
  if (!isComparableVersion(installed) || !isComparableVersion(latest)) return true;
  return compareVersions(installed, latest) !== null;
}

// Decide whether this run surfaces a statusline notice, and carry the
// suppression window forward. `previous` is the last cache body (or null).
//
// The stamp and the state it belongs to are tracked separately from
// update_check: a transient 'lookup-failed' run in between must not drop the
// stamp and re-open the window hours after the last warning, but a change to a
// genuinely different message must still get through. A healthy check writes
// neither, so npm going missing again later warns immediately.
function applyNotice(result, updateCheck, previous, nowS) {
  if (!updateCheck) return result;

  result.update_check = updateCheck;
  const lastNotice = Number(previous && previous.notice_at) || 0;
  const lastState = (previous && previous.notice_state) || null;

  if (NOTICES[updateCheck]) {
    const windowElapsed = !lastNotice || nowS - lastNotice >= NOTICE_REPEAT_S;
    if (PERSISTENT_NOTICES[updateCheck] || windowElapsed || lastState !== updateCheck) {
      result.notice = NOTICES[updateCheck];
      result.notice_at = nowS;
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
  return result;
}

// The whole background check, with its side effects injected.
//   deps.fs        — fs-like (readFileSync/writeFileSync/existsSync/openSync/…)
//   deps.execSync  — child_process.execSync-like (PATH probes)
//   deps.execFileSync — child_process.execFileSync-like (npm/npx calls)
//   deps.paths     — resolvePaths() output
//   deps.now       — () => epoch ms
//   deps.pid       — process id used to name the reclaimed stale lock
// Returns { status, ... } describing what it did, for tests and callers.
function runUpdateCheck({
  fs: fsDep,
  execSync: execSyncDep,
  execFileSync: execFileSyncDep,
  paths,
  now,
  pid,
  platform = process.platform,
  windowsShell = process.env.ComSpec || 'cmd.exe',
}) {
  // Previous cache state — carries the last notice timestamp so we warn on a
  // slow cadence instead of on every session for the rest of time.
  let previous = null;
  try {
    previous = JSON.parse(fsDep.readFileSync(paths.cacheFile, 'utf8'));
  } catch (e) {}

  let installed = '0.0.0';
  try {
    if (fsDep.existsSync(paths.versionFile)) {
      installed = fsDep.readFileSync(paths.versionFile, 'utf8').trim();
    }
  } catch (e) {}

  // No version file means slashdo isn't installed — skip silently
  if (installed === '0.0.0') {
    return { status: 'not-installed' };
  }

  let autoUpdate = false;
  try {
    if (fsDep.existsSync(paths.configFile)) {
      const config = JSON.parse(fsDep.readFileSync(paths.configFile, 'utf8'));
      autoUpdate = config && config.autoUpdate === true;
    }
  } catch (e) {}

  // Probe PATH before shelling out: without this, a missing npm throws ENOENT
  // into the catch below, leaving latest === null and writing a cache that reads
  // exactly like "up to date" — the user never learns the check is dead.
  const hasCommand = (cmd) => {
    try {
      execSyncDep(probeCommand(cmd, platform), {
        stdio: 'ignore',
        timeout: PROBE_TIMEOUT_MS,
        windowsHide: true,
      });
      return true;
    } catch (e) {
      return false;
    }
  };

  // Distinct, machine-readable reason the check could not complete (null = it did).
  let updateCheck = null;

  let latest = null;
  if (hasCommand(NPM_COMMAND)) {
    try {
      const candidate = String(runTool(execFileSyncDep, NPM_COMMAND, NPM_VIEW_ARGS, {
        encoding: 'utf8',
        timeout: NPM_VIEW_TIMEOUT_MS,
        windowsHide: true,
      }, platform, windowsShell)).trim();
      if (isInstallableVersion(candidate)) {
        latest = candidate;
      } else {
        updateCheck = 'invalid-version';
      }
    } catch (e) {
      // Offline / registry error / timeout: transient, so no user-facing notice,
      // but the cache still says the check failed rather than implying "current".
      updateCheck = 'lookup-failed';
    }
  } else {
    updateCheck = 'npm-unavailable';
  }

  let updateAvailable = isUpdateAvailable(installed, latest);

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

  // Auto-update: apply the update instead of surfacing the statusline hint.
  // Guard it with an exclusive lock file so that when several Claude sessions
  // start at once, only one spawns npx for the exact resolved version against
  // the shared Claude config directory. The installer's writes are idempotent today,
  // but serializing keeps that assumption from being load-bearing if the
  // install logic ever stops being safe to run concurrently.
  // `deferred` is set when this session sees an available auto-update but
  // yields the lock to another session: the lock holder owns the cache write
  // for this cycle, so a deferring session must NOT write its own (stale
  // update_available:true) result and clobber the holder's update_available:false
  // once the install completes.
  let deferred = false;
  let autoUpdated = false;
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
    // Someone else holds the lock. Only THIS makes deferring the cache write
    // correct — a lock we failed to create for any other reason (read-only FS,
    // EACCES) has no holder who will write the authoritative result for us, so
    // deferring there would suppress the hint forever.
    let lockHeldByOther = false;
    const acquire = () => {
      const fd = fsDep.openSync(paths.lockFile, 'wx');
      fsDep.writeSync(fd, String(pid));
      fsDep.closeSync(fd);
      haveLock = true;
    };
    try {
      acquire();
    } catch (e) {
      if (e.code === 'EEXIST') {
        lockHeldByOther = true;
        try {
          if (now() - fsDep.statSync(paths.lockFile).mtimeMs > LOCK_STALE_MS) {
            const staleName = paths.lockFile + '.stale.' + pid;
            fsDep.renameSync(paths.lockFile, staleName); // atomic: one winner, losers throw ENOENT
            // The rename won: that lock is ours now and no other session holds
            // one, so we must not defer to it if the rest of the reclaim fails.
            lockHeldByOther = false;
            fsDep.unlinkSync(staleName);
            acquire();
          }
        } catch (e2) {
          // Re-acquiring can lose to a session that created a fresh lock in the
          // gap — that one really is a holder worth deferring to.
          if (e2.code === 'EEXIST') lockHeldByOther = true;
        }
      }
    }

    // Only the lock holder updates.
    if (haveLock) {
      try {
        runTool(execFileSyncDep, NPX_COMMAND, buildInstallArgs(latest), {
          stdio: 'ignore',
          timeout: INSTALL_TIMEOUT_MS,
          windowsHide: true,
        }, platform, windowsShell);
        // A zero exit code alone is not enough: a stale/cached install could
        // otherwise be reported as successful while the old version remains.
        const updatedVersion = fsDep.readFileSync(paths.versionFile, 'utf8').trim();
        if (updatedVersion !== latest) {
          throw new Error(`installed version ${updatedVersion} does not match ${latest}`);
        }
        updateAvailable = false;
        installed = updatedVersion;
        autoUpdated = true;
      } catch (e) {
        // Auto-update failed — fall through and surface the hint so the user
        // can update manually.
      } finally {
        try { fsDep.unlinkSync(paths.lockFile); } catch (e) {}
      }
    } else if (lockHeldByOther) {
      // Another session holds the lock and will install + write the authoritative
      // cache. Defer the cache write so we don't overwrite its result with our own
      // now-stale update_available:true (which would show a phantom /do:update
      // badge until the next session ran).
      deferred = true;
    }
  }

  if (deferred) {
    return { status: 'deferred' };
  }

  const nowS = Math.floor(now() / 1000);
  const result = applyNotice({
    update_available: updateAvailable,
    command: '/do:update',
    installed,
    latest: latest || 'unknown',
    checked: nowS,
  }, updateCheck, previous, nowS);

  fsDep.writeFileSync(paths.cacheFile, JSON.stringify(result));
  return { status: 'written', autoUpdated, result };
}

// Worker entrypoint: the real dependencies wired to the real home directory.
function runWorker() {
  return runUpdateCheck({
    fs,
    execSync,
    execFileSync,
    paths: resolvePaths(os.homedir(), process.env.CLAUDE_CONFIG_DIR),
    now: Date.now,
    pid: process.pid,
    platform: process.platform,
    windowsShell: process.env.ComSpec || 'cmd.exe',
  });
}

// SessionStart entrypoint: spawn the worker detached so we never block startup.
function spawnWorker() {
  const { cacheDir } = resolvePaths(os.homedir(), process.env.CLAUDE_CONFIG_DIR);
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  const child = spawn(process.execPath, [__filename, '--worker'], {
    stdio: 'ignore',
    windowsHide: true,
    detached: true,
  });
  child.unref();
}

if (require.main === module) {
  // Best-effort: silently exit on any failure (permissions, read-only FS, etc.)
  // — the hook must never break SessionStart.
  try {
    if (process.argv.includes('--worker')) runWorker();
    else spawnWorker();
  } catch (e) {}
}

module.exports = {
  LOCK_STALE_MS,
  NOTICE_REPEAT_S,
  NPM_VIEW_COMMAND,
  NPM_VIEW_ARGS,
  buildInstallArgs,
  runTool,
  NOTICES,
  probeCommand,
  resolvePaths,
  compareVersions,
  isInstallableVersion,
  isUpdateAvailable,
  runUpdateCheck,
};
