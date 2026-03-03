'use strict';

const { execSync } = require('child_process');
const fs = require('fs');

function getInstalledVersion(versionFile) {
  if (!versionFile || !fs.existsSync(versionFile)) return null;
  return fs.readFileSync(versionFile, 'utf8').trim();
}

function getLatestVersion(timeoutMs) {
  const timeout = timeoutMs || 3000;
  const result = execSync('npm view slashdo version 2>/dev/null', {
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

module.exports = { getInstalledVersion, getLatestVersion, compareVersions, checkForUpdate };
