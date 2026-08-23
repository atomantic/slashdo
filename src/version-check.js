'use strict';

const { execSync } = require('child_process');
const fs = require('fs');

function getInstalledVersion(versionFile) {
  if (!versionFile || !fs.existsSync(versionFile)) return null;
  return fs.readFileSync(versionFile, 'utf8').trim();
}

// slashdo also installs via the npm-free curl installer, so npm is not guaranteed
// to be on PATH. Probing first turns an opaque ENOENT into a state callers can name.
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

function compareVersions(installed, latest) {
  if (!installed || !latest) return null;

  const parse = (v) => v.replace(/^v/, '').split('.').map(Number);
  const [iMajor, iMinor, iPatch] = parse(installed);
  const [lMajor, lMinor, lPatch] = parse(latest);

  if (lMajor > iMajor) return 'major';
  if (lMajor === iMajor && lMinor > iMinor) return 'minor';
  if (lMajor === iMajor && lMinor === iMinor && lPatch > iPatch) return 'patch';
  return null;
}

function checkForUpdate(versionFile) {
  const installed = getInstalledVersion(versionFile);
  if (!installed) return null;

  let latest;
  try {
    latest = getLatestVersion(3000);
  } catch {
    return null;
  }

  const diff = compareVersions(installed, latest);
  if (!diff) return null;

  return { installed, latest, diff };
}

module.exports = { getInstalledVersion, hasNpm, getLatestVersion, compareVersions, checkForUpdate };
