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
    settingsFile: path.join(HOME, '.claude', 'settings.json'),
    versionFile: path.join(HOME, '.claude', '.slashdo-version'),
    configFile: path.join(HOME, '.claude', '.slashdo-config.json'),
    // `~`-style form of configFile, used by the transformer to rewrite the
    // config-path token in command/lib text for each host CLI.
    configPath: '~/.claude/.slashdo-config.json',
    // format: documentation only — transformCommand always emits YAML frontmatter
    // now that the legacy Gemini TOML path was removed.
    format: 'yaml-frontmatter',
    ext: '.md',
    namespacing: 'subdirectory',
    libPathPrefix: '~/.claude/lib/',
    supportsHooks: true,
    supportsCatInclusion: true,
    supportsTeams: true,
  },
  opencode: {
    name: 'OpenCode',
    commandsDir: path.join(HOME, '.config', 'opencode', 'commands'),
    libDir: path.join(HOME, '.config', 'opencode', 'lib'),
    hooksDir: null,
    versionFile: path.join(HOME, '.config', 'opencode', '.slashdo-version'),
    configFile: path.join(HOME, '.config', 'opencode', '.slashdo-config.json'),
    configPath: '~/.config/opencode/.slashdo-config.json',
    format: 'yaml-frontmatter',
    ext: '.md',
    namespacing: 'flat',
    libPathPrefix: '~/.config/opencode/lib/',
    supportsHooks: false,
    supportsCatInclusion: true,
    supportsTeams: false,
  },
  antigravity: {
    name: 'Antigravity CLI',
    // agy stores Agent Skills under ~/.gemini/antigravity-cli/ (it shares the
    // ~/.gemini parent with the legacy Gemini CLI but uses its own subtree).
    commandsDir: path.join(HOME, '.gemini', 'antigravity-cli', 'skills'),
    libDir: null,
    hooksDir: null,
    versionFile: path.join(HOME, '.gemini', 'antigravity-cli', '.slashdo-version'),
    configFile: path.join(HOME, '.gemini', 'antigravity-cli', '.slashdo-config.json'),
    configPath: '~/.gemini/antigravity-cli/.slashdo-config.json',
    // Antigravity uses the Agent Skills standard: one SKILL.md per skill
    // directory, YAML frontmatter, lib content inlined (no runtime !cat
    // injection) — the same shape as Codex skills.
    format: 'yaml-frontmatter',
    ext: null,
    namespacing: 'directory',
    libPathPrefix: null,
    supportsHooks: false,
    supportsCatInclusion: false,
    supportsTeams: false,
  },
  codex: {
    name: 'Codex',
    commandsDir: path.join(HOME, '.codex', 'skills'),
    libDir: null,
    hooksDir: null,
    versionFile: path.join(HOME, '.codex', '.slashdo-version'),
    configFile: path.join(HOME, '.codex', '.slashdo-config.json'),
    configPath: '~/.codex/.slashdo-config.json',
    format: 'yaml-frontmatter',
    ext: null,
    namespacing: 'directory',
    libPathPrefix: null,
    supportsHooks: false,
    supportsCatInclusion: false,
    supportsTeams: false,
  },
};

// Legacy environments from prior slashdo versions — detected for migration/uninstall
// only, never used for new installs. Not exposed via allEnvNames().
const LEGACY_ENVIRONMENTS = {
  'gemini-legacy': {
    name: 'Gemini CLI (legacy)',
    commandsDir: path.join(HOME, '.gemini', 'commands', 'do'),
    libDir: path.join(HOME, '.gemini', 'lib'),
    hooksDir: null,
    versionFile: path.join(HOME, '.gemini', '.slashdo-version'),
    format: 'yaml-frontmatter',
    ext: '.md',
    namespacing: 'subdirectory',
    libPathPrefix: null,
    supportsHooks: false,
    supportsCatInclusion: false,
    supportsTeams: false,
  },
};

// Alternate names that resolve to a canonical environment key. The Antigravity
// CLI (binary `agy`) is the successor to the Gemini CLI, so the historical
// `gemini` slug and the `agy` binary name both point at the `antigravity` env.
const ALIASES = {
  gemini: 'antigravity',
  agy: 'antigravity',
};

function canonicalEnvName(name) {
  return ALIASES[name] || name;
}

function detectInstalled({ includeLegacy = false } = {}) {
  const detected = [];
  for (const [key, env] of Object.entries(ENVIRONMENTS)) {
    const parentDir = path.dirname(env.commandsDir);
    if (fs.existsSync(parentDir)) {
      detected.push(key);
    }
  }
  // Legacy environments are only included when uninstalling so they don't
  // surface as install targets (bin/cli.js looks them up via ENVIRONMENTS[k]).
  if (includeLegacy) {
    for (const [key, env] of Object.entries(LEGACY_ENVIRONMENTS)) {
      if (fs.existsSync(env.commandsDir)) {
        detected.push(key);
      }
    }
  }
  return detected;
}

function getEnv(name) {
  return ENVIRONMENTS[canonicalEnvName(name)] || LEGACY_ENVIRONMENTS[name] || null;
}

function allEnvNames() {
  return Object.keys(ENVIRONMENTS);
}

function allEnvAliases() {
  return Object.keys(ALIASES);
}

module.exports = { ENVIRONMENTS, LEGACY_ENVIRONMENTS, ALIASES, detectInstalled, getEnv, canonicalEnvName, allEnvNames, allEnvAliases };
