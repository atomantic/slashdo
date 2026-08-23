'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();

// Claude Code owns the shape of its settings.json. The installer only reads and
// writes settings generically, then delegates these mutations to the target
// environment so another hook-capable environment cannot inherit this schema.
function registerClaudeHooks(settings, hookFiles, env, dryRun) {
  const actions = [];
  let modified = false;

  const updateCheckHook = hookFiles.find(h => h.name === 'slashdo-check-update.js');
  if (updateCheckHook) {
    const hookCommand = `node "${path.join(env.hooksDir, updateCheckHook.name)}"`;

    if (!settings.hooks) {
      settings.hooks = {};
    } else if (typeof settings.hooks !== 'object' || Array.isArray(settings.hooks)) {
      actions.push({ name: 'settings/hooks', status: 'skipped (unexpected shape)' });
      return { actions, modified };
    }

    if (Object.prototype.hasOwnProperty.call(settings.hooks, 'SessionStart') &&
      !Array.isArray(settings.hooks.SessionStart)) {
      actions.push({ name: 'settings/SessionStart hook', status: 'skipped (unexpected shape)' });
    } else {
      if (!Array.isArray(settings.hooks.SessionStart)) settings.hooks.SessionStart = [];

      const alreadyRegistered = settings.hooks.SessionStart.some(group =>
        group &&
        typeof group === 'object' &&
        Array.isArray(group.hooks) &&
        group.hooks.some(h => typeof h?.command === 'string' && h.command.includes('slashdo-check-update'))
      );

      if (!alreadyRegistered) {
        if (settings.hooks.SessionStart.length > 0) {
          let firstGroup = settings.hooks.SessionStart[0];
          if (!firstGroup || typeof firstGroup !== 'object') {
            firstGroup = { hooks: [] };
            settings.hooks.SessionStart[0] = firstGroup;
          }
          if (!Array.isArray(firstGroup.hooks)) firstGroup.hooks = [];
          firstGroup.hooks.push({ type: 'command', command: hookCommand });
        } else {
          settings.hooks.SessionStart.push({ hooks: [{ type: 'command', command: hookCommand }] });
        }
        modified = true;
        actions.push({ name: 'settings/SessionStart hook', status: dryRun ? 'would register' : 'registered' });
      } else {
        actions.push({ name: 'settings/SessionStart hook', status: 'already registered' });
      }
    }
  }

  const statuslineHook = hookFiles.find(h => h.name === 'slashdo-statusline.js');
  if (statuslineHook) {
    const statuslineCommand = `node "${path.join(env.hooksDir, statuslineHook.name)}"`;
    const currentCmd = typeof settings.statusLine?.command === 'string' ? settings.statusLine.command : '';

    if (!settings.statusLine) {
      settings.statusLine = { type: 'command', command: statuslineCommand };
      modified = true;
      actions.push({ name: 'settings/statusLine', status: dryRun ? 'would configure' : 'configured' });
    } else if (currentCmd.includes('gsd-statusline')) {
      settings.statusLine = { type: 'command', command: statuslineCommand };
      modified = true;
      actions.push({ name: 'settings/statusLine', status: dryRun ? 'would upgrade (gsd→slashdo)' : 'upgraded (gsd→slashdo)' });
    } else if (currentCmd.includes('slashdo-statusline')) {
      actions.push({ name: 'settings/statusLine', status: 'already configured' });
    } else {
      actions.push({ name: 'settings/statusLine', status: 'existing statusline preserved' });
    }
  }

  return { actions, modified };
}

function deregisterClaudeHooks(settings, _hookFiles, env, dryRun) {
  const actions = [];
  let modified = false;

  if (Array.isArray(settings.hooks?.SessionStart)) {
    const emptiedByUs = new Set();
    for (let i = 0; i < settings.hooks.SessionStart.length; i++) {
      const group = settings.hooks.SessionStart[i];
      if (!group || typeof group !== 'object') continue;
      if (Array.isArray(group.hooks)) {
        const before = group.hooks.length;
        group.hooks = group.hooks.filter(h =>
          !h || typeof h !== 'object' || typeof h.command !== 'string' || !h.command.includes('slashdo-check-update')
        );
        if (group.hooks.length < before) {
          modified = true;
          actions.push({ name: 'settings/SessionStart hook', status: dryRun ? 'would deregister' : 'deregistered' });
          if (group.hooks.length === 0) emptiedByUs.add(i);
        }
      }
    }
    settings.hooks.SessionStart = settings.hooks.SessionStart.filter((_, i) => !emptiedByUs.has(i));
    if (settings.hooks.SessionStart.length === 0) delete settings.hooks.SessionStart;
    if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
  }

  if (settings.statusLine?.command?.includes('slashdo-statusline')) {
    const gsdHookPath = path.join(env.hooksDir, 'gsd-statusline.js');
    if (fs.existsSync(gsdHookPath)) {
      settings.statusLine = { type: 'command', command: `node "${gsdHookPath}"` };
      actions.push({ name: 'settings/statusLine', status: dryRun ? 'would downgrade (slashdo→gsd)' : 'downgraded (slashdo→gsd)' });
    } else {
      delete settings.statusLine;
      actions.push({ name: 'settings/statusLine', status: dryRun ? 'would remove' : 'removed' });
    }
    modified = true;
  }

  return { actions, modified };
}

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
    registerHooks: registerClaudeHooks,
    deregisterHooks: deregisterClaudeHooks,
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
  grok: {
    name: 'Grok Build',
    // Grok Build (xAI's `grok` CLI) auto-loads skills from ~/.grok/skills/,
    // one SKILL.md per skill directory — the Agent Skills standard, identical
    // in shape to Codex. It also reads Claude Code's skills, but we install a
    // dedicated ~/.grok tree so a grok-only user gets slashdo without ~/.claude.
    commandsDir: path.join(HOME, '.grok', 'skills'),
    libDir: null,
    hooksDir: null,
    versionFile: path.join(HOME, '.grok', '.slashdo-version'),
    configFile: path.join(HOME, '.grok', '.slashdo-config.json'),
    configPath: '~/.grok/.slashdo-config.json',
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
