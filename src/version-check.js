'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
// Single source of truth for the semver comparison. It lives in the hook rather
// than here because the hook is deployed standalone into ~/.claude/hooks/, where
// src/ does not exist — so the hook cannot require us, but we can require it.
// Re-exported below so this module's public surface is unchanged.
const { compareVersions } = require('../hooks/slashdo-check-update');

function getInstalledVersion(versionFile) {
  if (!versionFile || !fs.existsSync(versionFile)) return null;
  return fs.readFileSync(versionFile, 'utf8').trim();
}

function getLatestVersion(timeoutMs) {
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
    return null;
  }

  const diff = compareVersions(installed, latest);
  if (!diff) return null;

  return { installed, latest, diff };
}

module.exports = { getInstalledVersion, getLatestVersion, compareVersions, checkForUpdate };
