'use strict';

// Per-environment slashdo preferences (e.g. auto-update), stored as JSON next to
// the .slashdo-version file. Read/write are best-effort: a missing or corrupt
// file reads as an empty config rather than throwing.

const fs = require('fs');

function readConfig(configFile) {
  if (!configFile || !fs.existsSync(configFile)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (e) {
    // Corrupt config — treat as empty so callers fall back to defaults
    return {};
  }
}

function writeConfig(configFile, config) {
  if (!configFile) return;
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

module.exports = { readConfig, writeConfig };
