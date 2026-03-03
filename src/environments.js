'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();

const ENVIRONMENTS = {
  claude: {
    name: 'Claude Code',
    commandsDir: path.join(HOME, '.claude', 'commands'),
    libDir: path.join(HOME, '.claude', 'lib'),
    hooksDir: path.join(HOME, '.claude', 'hooks'),
    versionFile: path.join(HOME, '.claude', '.slashdo-version'),
    format: 'yaml-frontmatter',
    ext: '.md',
    namespacing: 'subdirectory',
    libPathPrefix: '~/.claude/lib/',
    supportsHooks: true,
    supportsCatInclusion: true,
  },
  opencode: {
    name: 'OpenCode',
    commandsDir: path.join(HOME, '.config', 'opencode', 'commands'),
    libDir: path.join(HOME, '.config', 'opencode', 'lib'),
    hooksDir: null,
    versionFile: path.join(HOME, '.config', 'opencode', '.slashdo-version'),
    format: 'yaml-frontmatter',
    ext: '.md',
    namespacing: 'flat',
    libPathPrefix: '~/.config/opencode/lib/',
    supportsHooks: false,
    supportsCatInclusion: true,
  },
  gemini: {
    name: 'Gemini CLI',
    commandsDir: path.join(HOME, '.gemini', 'commands'),
    libDir: path.join(HOME, '.gemini', 'lib'),
    hooksDir: null,
    versionFile: path.join(HOME, '.gemini', '.slashdo-version'),
    format: 'toml',
    ext: '.md',
    namespacing: 'subdirectory',
    libPathPrefix: '~/.gemini/lib/',
    supportsHooks: false,
    supportsCatInclusion: true,
  },
  codex: {
    name: 'Codex',
    commandsDir: path.join(HOME, '.codex', 'skills'),
    libDir: null,
    hooksDir: null,
    versionFile: path.join(HOME, '.codex', '.slashdo-version'),
    format: 'skill-md',
    ext: null,
    namespacing: 'directory',
    libPathPrefix: null,
    supportsHooks: false,
    supportsCatInclusion: false,
  },
};

function detectInstalled() {
  const detected = [];
  for (const [key, env] of Object.entries(ENVIRONMENTS)) {
    const parentDir = path.dirname(env.commandsDir);
    if (fs.existsSync(parentDir)) {
      detected.push(key);
    }
  }
  return detected;
}

function getEnv(name) {
  return ENVIRONMENTS[name] || null;
}

function allEnvNames() {
  return Object.keys(ENVIRONMENTS);
}

module.exports = { ENVIRONMENTS, detectInstalled, getEnv, allEnvNames };
