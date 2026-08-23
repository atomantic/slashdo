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
const path = require('path');

function registerHooksInSettings(env, hookFiles, dryRun) {
  if (!env.settingsFile) return [];

  const actions = [];
  const settingsPath = env.settingsFile;

  let settings = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
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

    if (!settings.hooks) {
      settings.hooks = {};
    } else if (typeof settings.hooks !== 'object' || Array.isArray(settings.hooks)) {
      actions.push({ name: 'settings/hooks', status: 'skipped (unexpected shape)' });
      return actions;
    }

    // If SessionStart exists but isn't an array, skip hook registration (but continue to statusLine)
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
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
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

module.exports = { registerHooksInSettings, deregisterHooksFromSettings };
