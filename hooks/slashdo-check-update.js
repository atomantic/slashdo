#!/usr/bin/env node
// Check for slashdo updates in background, write result to cache
// Called by SessionStart hook - runs once per session

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const homeDir = os.homedir();
const cacheDir = path.join(homeDir, '.claude', 'cache');
const cacheFile = path.join(cacheDir, 'slashdo-update-check.json');
const versionFile = path.join(homeDir, '.claude', '.slashdo-version');

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

    let latest = null;
    try {
      latest = execSync('npm view slash-do version', { encoding: 'utf8', timeout: 5000, windowsHide: true }).trim();
    } catch (e) {}

    // Simple semver comparison: only flag update when latest > installed
    let updateAvailable = false;
    if (latest && latest !== installed) {
      const parse = v => (v || '').replace(/-.+$/, '').split('.').map(Number);
      const [iM, im, ip] = parse(installed);
      const [lM, lm, lp] = parse(latest);
      if ([iM, im, ip, lM, lm, lp].some(isNaN)) { updateAvailable = installed !== latest; }
      else { updateAvailable = lM > iM || (lM === iM && (lm > im || (lm === im && lp > ip))); }
    }

    const result = {
      update_available: updateAvailable,
      installed,
      latest: latest || 'unknown',
      checked: Math.floor(Date.now() / 1000)
    };

    fs.writeFileSync(cacheFile, JSON.stringify(result));
  `], {
    stdio: 'ignore',
    windowsHide: true,
    detached: true
  });

  child.unref();
} catch (e) {
  // Hook is best-effort — never break SessionStart
}
