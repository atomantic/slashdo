#!/usr/bin/env node
'use strict';
// Check for slashdo updates in background, write result to cache.
// Called by SessionStart hook - runs once per session.
//
// When the user opted into auto-update (~/.claude/.slashdo-config.json:
// { "autoUpdate": true }), a detected update is applied automatically by
// running `npx -y slash-do@latest` instead of surfacing the ⬆ /do:update
// statusline hint. On auto-update failure we fall back to showing the hint.
//
// Structure: the parent invocation (SessionStart) only spawns a detached child
// running THIS SAME FILE with `--worker`, so session start is never blocked.
// The worker body lives in `runUpdateCheck()` below with fs/execSync/clock
// injected, so test/check-update.test.js can drive every branch directly —
// it used to be an inline `-e` string that no test could reach.
//
// This file is deployed standalone into ~/.claude/hooks/, where `src/` does not
// exist, so it must not require anything outside Node core. That is why the
// semver comparison lives HERE and `src/version-check.js` re-exports it, rather
// than the other way around — one implementation, reachable from both sides.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execSync } = require('child_process');

// A lock older than this is treated as abandoned (crashed/killed mid-update)
// and reclaimed. Kept well above the 120s install timeout below so a slow-but-
// live install is never stolen out from under itself.
const LOCK_STALE_MS = 10 * 60 * 1000;
const NPM_VIEW_TIMEOUT_MS = 5000;
const INSTALL_TIMEOUT_MS = 120000;
const NPM_VIEW_COMMAND = 'npm view slash-do version';
// --env claude keeps this scoped to the environment running the hook, and
// avoids the interactive multi-env prompt (stdin is not a TTY here).
const INSTALL_COMMAND = 'npx -y slash-do@latest --env claude';

// Every path the check reads or writes, derived from a home directory. Taking
// homeDir as an argument (rather than calling os.homedir() inline) is what lets
// tests point the whole check at a temp dir.
function resolvePaths(homeDir) {
  const claudeDir = path.join(homeDir, '.claude');
  const cacheDir = path.join(claudeDir, 'cache');
  return {
    cacheDir,
    cacheFile: path.join(cacheDir, 'slashdo-update-check.json'),
    versionFile: path.join(claudeDir, '.slashdo-version'),
    configFile: path.join(claudeDir, '.slashdo-config.json'),
    // Serializes the auto-update across concurrent Claude sessions — only the
    // session that atomically creates this file runs `npx slash-do@latest`;
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

// The whole background check, with its side effects injected.
//   deps.fs        — fs-like (readFileSync/writeFileSync/existsSync/openSync/…)
//   deps.execSync  — child_process.execSync-like
//   deps.paths     — resolvePaths() output
//   deps.now       — () => epoch ms
//   deps.pid       — process id used to name the reclaimed stale lock
// Returns { status, ... } describing what it did, for tests and callers.
function runUpdateCheck({ fs: fsDep, execSync: execSyncDep, paths, now, pid }) {
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

  let latest = null;
  try {
    latest = execSyncDep(NPM_VIEW_COMMAND, {
      encoding: 'utf8',
      timeout: NPM_VIEW_TIMEOUT_MS,
      windowsHide: true,
    }).trim();
  } catch (e) {}

  let updateAvailable = isUpdateAvailable(installed, latest);

  // Auto-update: apply the update instead of surfacing the statusline hint.
  // Guard it with an exclusive lock file so that when several Claude sessions
  // start at once, only one spawns "npx slash-do@latest" against the shared
  // ~/.claude/ — the installer's writes are idempotent today, but serializing
  // keeps that assumption from being load-bearing if the install logic ever
  // stops being safe to run concurrently.
  // `deferred` is set when this session sees an available auto-update but
  // yields the lock to another session: the lock holder owns the cache write
  // for this cycle, so a deferring session must NOT write its own (stale
  // update_available:true) result and clobber the holder's update_available:false
  // once the install completes.
  let deferred = false;
  let autoUpdated = false;
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
        execSyncDep(INSTALL_COMMAND, {
          stdio: 'ignore',
          timeout: INSTALL_TIMEOUT_MS,
          windowsHide: true,
        });
        // Installer already refreshed the cache to update_available:false and
        // bumped the version file, so nothing left to flag.
        updateAvailable = false;
        latest = installed = fsDep.readFileSync(paths.versionFile, 'utf8').trim();
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

  const result = {
    update_available: updateAvailable,
    command: '/do:update',
    installed,
    latest: latest || 'unknown',
    checked: Math.floor(now() / 1000),
  };

  fsDep.writeFileSync(paths.cacheFile, JSON.stringify(result));
  return { status: 'written', autoUpdated, result };
}

// Worker entrypoint: the real dependencies wired to the real home directory.
function runWorker() {
  return runUpdateCheck({
    fs,
    execSync,
    paths: resolvePaths(os.homedir()),
    now: Date.now,
    pid: process.pid,
  });
}

// SessionStart entrypoint: spawn the worker detached so we never block startup.
function spawnWorker() {
  const { cacheDir } = resolvePaths(os.homedir());
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
  NPM_VIEW_COMMAND,
  INSTALL_COMMAND,
  resolvePaths,
  compareVersions,
  isUpdateAvailable,
  runUpdateCheck,
};
