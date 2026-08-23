'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
// Single source of truth for the semver comparison. It lives in the hook rather
// than here because the hook is deployed standalone into ~/.claude/hooks/, where
// src/ does not exist — so the hook cannot require us, but we can require it.
// Re-exported below so this module's public surface is unchanged.
//
// compareVersions RANKS a bump; it answers null whenever it cannot rank one,
// including for a version it cannot parse ('1.2', 'nightly'). That is why the
// hook pairs it with isUpdateAvailable(), which applies the update POLICY on top:
// unrankable-but-different still surfaces the hint. checkForUpdate() below wants
// the rank itself ('major'/'minor'/'patch'), so it stays on the ranking answer.
//
// Adopting the hook's implementation moved two answers, both pinned in
// test/version-check.test.js: an unrankable version now returns null where the
// old three-segment-only parse guessed a rank, and a prerelease is ranked by the
// release it belongs to ('1.2.3' → '1.2.4-beta.1' is 'patch', not null).
const { compareVersions } = require('../hooks/slashdo-check-update');

function getInstalledVersion(versionFile) {
  if (!versionFile || !fs.existsSync(versionFile)) return null;
  return fs.readFileSync(versionFile, 'utf8').trim();
}

// slashdo also installs via the npm-free curl installer, so npm is not guaranteed
// to be on PATH. Probing first turns an opaque ENOENT into a state callers can name.
// hooks/slashdo-check-update.js repeats this probe rather than importing it: hooks
// are installed standalone into ~/.claude/hooks/ with no src/ beside them.
function hasNpm() {
  try {
    execSync(process.platform === 'win32' ? 'where npm' : 'command -v npm', {
      timeout: 3000,
      stdio: 'ignore',
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

function getLatestVersion(timeoutMs) {
  if (!hasNpm()) {
    const err = new Error('npm is not on PATH — cannot look up the latest slash-do version');
    err.code = 'NPM_UNAVAILABLE';
    throw err;
  }
  const timeout = timeoutMs || 3000;
  const result = execSync('npm view slash-do version 2>/dev/null', {
    timeout,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return result.trim();
}

function checkForUpdate(versionFile) {
  const installed = getInstalledVersion(versionFile);
  if (!installed) return null;

  let latest;
  try {
    latest = getLatestVersion(3000);
  } catch {
    // Includes err.code === 'NPM_UNAVAILABLE'. This function's contract is "an
    // update worth telling the user about, or null" — a broken lookup is not one.
    // Callers that need to distinguish should call hasNpm() themselves.
    return null;
  }

  const diff = compareVersions(installed, latest);
  if (!diff) return null;

  return { installed, latest, diff };
}

module.exports = { getInstalledVersion, hasNpm, getLatestVersion, compareVersions, checkForUpdate };
