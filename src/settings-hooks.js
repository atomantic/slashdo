'use strict';

// Canonical ~/.claude/settings.json mutation for slashdo's SessionStart hook and
// statusline. This lives in its own module — with no dependency beyond fs/path —
// so BOTH install paths share one implementation:
//
//   * the npm/npx path requires it from src/installer.js
//   * the curl path (install.sh / uninstall.sh) fetches this single file and
//     calls it via `node -e`, instead of hand-translating the algorithm into a
//     shell-embedded copy that silently drifts (see issue #166)
//
// Keep it dependency-free: any require() added here must also be fetched by the
// curl installer, so a new import breaks the no-npm path.

const fs = require('fs');
const os = require('os');
const path = require('path');

// The hooks slashdo registers, by installed filename.
const SLASHDO_HOOKS = ['slashdo-check-update.js', 'slashdo-statusline.js'];

// install.sh caches this module here so uninstall.sh can deregister offline.
const SETTINGS_HOOKS_CACHE = '.slashdo-settings-hooks.js';

// Read settings.json, or null when it cannot be trusted. An empty or
// whitespace-only file reads as {}: it provably holds nothing to lose, and
// treating it as corruption would block both install and uninstall.
function readSettings(settingsPath) {
  const raw = fs.readFileSync(settingsPath, 'utf8');
  if (raw.trim() === '') return {};
  const parsed = JSON.parse(raw);
  // Valid JSON that is not an object (null, a string, a number, an array) has
  // no place to register into. Reject it here so it lands in the caller's
  // "skipped (parse error)" path instead of throwing on property access.
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('settings.json is not a JSON object');
  }
  return parsed;
}

function registerHooksInSettings(env, hookFiles, dryRun) {
  if (!env.settingsFile) return [];

  const actions = [];
  const settingsPath = env.settingsFile;

  let settings = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = readSettings(settingsPath);
    } catch (e) {
      // Corrupted settings.json — skip registration to avoid data loss
      actions.push({ name: 'settings.json', status: 'skipped (parse error)' });
      return actions;
    }
  }

  let modified = false;

  // Register SessionStart hook for slashdo-check-update.js
  const updateCheckHook = hookFiles.find(h => h.name === 'slashdo-check-update.js');
  if (updateCheckHook) {
    const hookCommand = `node "${path.join(env.hooksDir, updateCheckHook.name)}"`;

    // Absent (or null) is ours to create — neither carries user data. Any other
    // non-object is a value the user put there, so leave it exactly as it is: a
    // truthiness test would overwrite `hooks: ""` or `hooks: 0` the same way the
    // shell copy overwrote `hooks: "some-string"`.
    const hooksValue = settings.hooks;
    if (hooksValue === undefined || hooksValue === null) {
      settings.hooks = {};
    } else if (typeof hooksValue !== 'object' || Array.isArray(hooksValue)) {
      // Skip only the hook registration — the statusline below is independent
      // of settings.hooks and must still be configured, exactly as it is when
      // SessionStart alone is malformed.
      actions.push({ name: 'settings/hooks', status: 'skipped (unexpected shape)' });
    }

    // If SessionStart exists but isn't an array, skip hook registration (but continue to statusLine)
    if (typeof settings.hooks !== 'object' || Array.isArray(settings.hooks)) {
      // Already reported as an unexpected shape above; nothing to register into.
    } else if (Object.prototype.hasOwnProperty.call(settings.hooks, 'SessionStart') &&
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
          firstGroup.hooks.push({
            type: 'command',
            command: hookCommand,
          });
        } else {
          settings.hooks.SessionStart.push({
            hooks: [{
              type: 'command',
              command: hookCommand,
            }],
          });
        }
        modified = true;
        actions.push({ name: 'settings/SessionStart hook', status: dryRun ? 'would register' : 'registered' });
      } else {
        actions.push({ name: 'settings/SessionStart hook', status: 'already registered' });
      }
    }
  }

  // Configure statusline: upgrade gsd-statusline → slashdo-statusline (superset)
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

  if (!dryRun && modified) {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  }

  return actions;
}

function deregisterHooksFromSettings(env, dryRun) {
  if (!env.settingsFile) return [];

  const settingsPath = env.settingsFile;
  if (!fs.existsSync(settingsPath)) return [];

  const actions = [];
  let settings;
  try {
    settings = readSettings(settingsPath);
  } catch (e) {
    // Corrupted settings.json — skip deregistration to avoid data loss
    actions.push({ name: 'settings.json', status: 'skipped (parse error)' });
    return actions;
  }
  let modified = false;

  // Remove SessionStart hook entries referencing slashdo
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
    // Only remove groups that became empty as a result of removing slashdo entries
    settings.hooks.SessionStart = settings.hooks.SessionStart.filter((_, i) => !emptiedByUs.has(i));
    if (settings.hooks.SessionStart.length === 0) {
      delete settings.hooks.SessionStart;
    }
    if (Object.keys(settings.hooks).length === 0) {
      delete settings.hooks;
    }
  }

  // Remove statusline if it references slashdo-statusline
  if (settings.statusLine?.command?.includes('slashdo-statusline')) {
    // Restore gsd-statusline if its hook file still exists
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

  if (!dryRun && modified) {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  }

  return actions;
}

// ── Curl-installer entry points ─────────────────────────────────────
//
// install.sh / uninstall.sh call these instead of deriving slashdo's paths,
// hook list, and config default in shell-embedded JS of their own. Keeping the
// arguments here too is the point: an extraction that left the inputs to the
// shell would just relocate the drift it set out to remove.
// test/environments.test.js pins claudeEnv() against ENVIRONMENTS.claude, which
// owns the same paths for the npm path.

function claudeEnv() {
  const claudeDir = path.join(os.homedir(), '.claude');
  return {
    settingsFile: path.join(claudeDir, 'settings.json'),
    hooksDir: path.join(claudeDir, 'hooks'),
    configFile: path.join(claudeDir, '.slashdo-config.json'),
  };
}

function applyDefaultHooks(dryRun) {
  const env = claudeEnv();

  // Default auto-update to enabled on first install. The curl installer is
  // piped (no TTY to prompt), so we pick the same default the npx installer
  // offers; re-run "npx slash-do@latest" interactively to change it.
  if (!dryRun && !fs.existsSync(env.configFile)) {
    try {
      fs.writeFileSync(env.configFile, JSON.stringify({ autoUpdate: true }, null, 2) + '\n', 'utf8');
    } catch (e) {
      // Best-effort: a config we cannot write must not abort hook registration
    }
  }

  const hookFiles = SLASHDO_HOOKS
    .filter((name) => fs.existsSync(path.join(env.hooksDir, name)))
    .map((name) => ({ name }));

  return registerHooksInSettings(env, hookFiles, dryRun);
}

function removeDefaultHooks(dryRun) {
  return deregisterHooksFromSettings(claudeEnv(), dryRun);
}

// Render one action as "<severity> <name>: <status>". The severity travels with
// the action so callers do not re-infer it by pattern-matching English prose —
// a new 'failed (...)' status would otherwise print as a success.
function formatAction(action) {
  const severity = action.status.startsWith('skipped') ? 'warn' : 'ok';
  return `${severity} ${action.name}: ${action.status}`;
}

module.exports = {
  registerHooksInSettings,
  deregisterHooksFromSettings,
  claudeEnv,
  applyDefaultHooks,
  removeDefaultHooks,
  formatAction,
  SLASHDO_HOOKS,
  SETTINGS_HOOKS_CACHE,
};
