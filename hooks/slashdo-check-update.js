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
    if (updateAvailable && autoUpdate) {
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
      }
    }

    const result = {
      update_available: updateAvailable,
      command: '/do:update',
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
