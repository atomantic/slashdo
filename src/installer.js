'use strict';

const fs = require('fs');
const path = require('path');
const { getTargetFilename, transformCommand, transformLib } = require('./transformer');
const { readConfig, writeConfig } = require('./config');

const shellQuote = (value) => `'${value.replace(/'/g, `'\\''`)}'`;

function collectCommands(commandsDir) {
  const commands = [];
  const doDir = path.join(commandsDir, 'do');
  if (!fs.existsSync(doDir)) return commands;

  const entries = fs.readdirSync(doDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.md')) {
      commands.push({
        relPath: path.join('do', entry.name),
        absPath: path.join(doDir, entry.name),
        name: entry.name.replace('.md', ''),
      });
    }
  }
  return commands.sort((a, b) => a.name.localeCompare(b.name));
}

function collectLibFiles(libDir) {
  if (!fs.existsSync(libDir)) return [];
  const files = [];
  const entries = fs.readdirSync(libDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push({
        relPath: entry.name,
        absPath: path.join(libDir, entry.name),
        name: entry.name,
      });
    }
  }
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

function collectHooks(hooksDir) {
  if (!fs.existsSync(hooksDir)) return [];
  const files = [];
  const entries = fs.readdirSync(hooksDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.js'))) {
      files.push({
        relPath: entry.name,
        absPath: path.join(hooksDir, entry.name),
        name: entry.name,
      });
    }
  }
  return files;
}

function filesAreEqual(fileA, contentB) {
  if (!fs.existsSync(fileA)) return false;
  const contentA = fs.readFileSync(fileA, 'utf8');
  return contentA === contentB;
}

function syncFile({ label, content, targetPath, dryRun, results }) {
  if (filesAreEqual(targetPath, content)) {
    results.upToDate++;
    results.actions.push({ name: label, status: 'up to date' });
    return;
  }

  const isNew = !fs.existsSync(targetPath);
  if (dryRun) {
    results.actions.push({
      name: label,
      status: isNew ? 'would install' : 'would update',
      target: targetPath,
    });
  } else {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, content, 'utf8');
    results.actions.push({
      name: label,
      status: isNew ? 'installed' : 'updated',
      target: targetPath,
    });
  }
  if (isNew) results.installed++;
  else results.updated++;
}

function syncFileSet(items, { getContent, getTargetPath, getLabel, dryRun, results }) {
  for (const item of items) {
    syncFile({
      label: getLabel(item),
      content: getContent(item),
      targetPath: getTargetPath(item),
      dryRun,
      results,
    });
  }
}

function removeFile({ label, targetPath, dryRun, results }) {
  if (!fs.existsSync(targetPath)) return;

  if (dryRun) {
    results.actions.push({ name: label, status: 'would remove', target: targetPath });
  } else {
    fs.unlinkSync(targetPath);
    results.actions.push({ name: label, status: 'removed', target: targetPath });
  }
  results.removed++;
}

function removeFileSet(items, { getTargetPath, getLabel, dryRun, results }) {
  for (const item of items) {
    removeFile({
      label: getLabel(item),
      targetPath: getTargetPath(item),
      dryRun,
      results,
    });
  }
}

const RENAMED_COMMANDS = {
  cam: 'push',
  makegoals: 'goals',
  makegood: 'better',
  good: 'better',
  'optimize-md': 'omd',
};

// Old hooks to remove during install/uninstall (superseded or no longer needed)
const OBSOLETE_HOOKS = [
  'update-check.md',
];

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
    const hookCommand = `node ${shellQuote(path.join(env.hooksDir, updateCheckHook.name))}`;

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
    const statuslineCommand = `node ${shellQuote(path.join(env.hooksDir, statuslineHook.name))}`;
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
      settings.statusLine = { type: 'command', command: `node ${shellQuote(gsdHookPath)}` };
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

function migrateRenamedCommands(env, dryRun, results) {
  for (const [oldName, newName] of Object.entries(RENAMED_COMMANDS)) {
    const oldRelPath = path.join('do', oldName + '.md');
    const oldTargetRel = getTargetFilename(oldRelPath, env);
    const oldTargetPath = path.join(env.commandsDir, oldTargetRel);

    if (!fs.existsSync(oldTargetPath)) continue;

    if (dryRun) {
      results.actions.push({ name: `/do:${oldName}`, status: `would migrate → /do:${newName}` });
    } else {
      fs.unlinkSync(oldTargetPath);
      results.actions.push({ name: `/do:${oldName}`, status: `migrated → /do:${newName}` });
    }
  }
}

function removeObsoleteHooks(env, dryRun, results) {
  if (!env.supportsHooks || !env.hooksDir) return;

  for (const oldName of OBSOLETE_HOOKS) {
    const oldTargetPath = path.join(env.hooksDir, oldName);
    if (!fs.existsSync(oldTargetPath)) continue;

    if (dryRun) {
      results.actions.push({ name: `hook/${oldName}`, status: 'would remove (obsolete)' });
    } else {
      fs.unlinkSync(oldTargetPath);
      results.actions.push({ name: `hook/${oldName}`, status: 'removed (obsolete)' });
    }
    results.removed++;
  }
}

function persistAutoUpdate(env, dryRun, autoUpdate, results) {
  if (dryRun || !env.configFile || !env.supportsHooks || typeof autoUpdate !== 'boolean') return;

  const config = readConfig(env.configFile);
  if (config.autoUpdate === autoUpdate) return;

  config.autoUpdate = autoUpdate;
  writeConfig(env.configFile, config);
  results.actions.push({ name: '.slashdo-config.json', status: autoUpdate ? 'auto-update enabled' : 'auto-update disabled' });
}

function writeVersionAndRefreshCache(env, packageDir, dryRun) {
  if (dryRun || !env.versionFile) return;

  const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
  fs.writeFileSync(env.versionFile, pkg.version, 'utf8');

  if (!env.supportsHooks || !env.hooksDir) return;

  try {
    const cacheDir = path.join(path.dirname(env.hooksDir), 'cache');
    const cacheFile = path.join(cacheDir, 'slashdo-update-check.json');
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify({
      update_available: false,
      installed: pkg.version,
      latest: pkg.version,
      checked: Math.floor(Date.now() / 1000),
    }));
  } catch (e) {
    // Best-effort: never fail the install over cache bookkeeping
  }
}

function finalizeInstall(env, hookFiles, packageDir, dryRun, filterNames, autoUpdate, results) {
  if (env.supportsHooks && env.hooksDir && !filterNames?.length) {
    results.actions.push(...registerHooksInSettings(env, hookFiles, dryRun));
  }

  migrateRenamedCommands(env, dryRun, results);
  removeObsoleteHooks(env, dryRun, results);
  persistAutoUpdate(env, dryRun, autoUpdate, results);
  writeVersionAndRefreshCache(env, packageDir, dryRun);
}

function install({ env, packageDir, filterNames, dryRun, uninstall, autoUpdate }) {
  const commandsDir = path.join(packageDir, 'commands');
  const libDir = path.join(packageDir, 'lib');
  const hooksDir = path.join(packageDir, 'hooks');
  const commands = collectCommands(commandsDir);
  const libFiles = collectLibFiles(libDir);
  const hookFiles = env.supportsHooks ? collectHooks(hooksDir) : [];

  const filtered = filterNames?.length
    ? commands.filter(c => filterNames.includes(c.name) || filterNames.includes(`do:${c.name}`))
    : commands;

  const results = { installed: 0, updated: 0, upToDate: 0, removed: 0, actions: [] };

  if (uninstall) {
    return doUninstall(filtered, libFiles, hookFiles, env, results, dryRun, filterNames);
  }

  syncFileSet(filtered, {
    getContent: cmd => transformCommand(fs.readFileSync(cmd.absPath, 'utf8'), env, libDir, cmd.relPath),
    getTargetPath: cmd => path.join(env.commandsDir, getTargetFilename(cmd.relPath, env)),
    getLabel: cmd => `/do:${cmd.name}`,
    dryRun,
    results,
  });

  if (env.libDir) {
    syncFileSet(libFiles, {
      getContent: lib => transformLib(fs.readFileSync(lib.absPath, 'utf8'), env),
      getTargetPath: lib => path.join(env.libDir, lib.relPath),
      getLabel: lib => `lib/${lib.name}`,
      dryRun,
      results,
    });
  }

  if (env.supportsHooks && env.hooksDir) {
    syncFileSet(hookFiles, {
      getContent: hook => fs.readFileSync(hook.absPath, 'utf8'),
      getTargetPath: hook => path.join(env.hooksDir, hook.relPath),
      getLabel: hook => `hook/${hook.name}`,
      dryRun,
      results,
    });
  }

  finalizeInstall(env, hookFiles, packageDir, dryRun, filterNames, autoUpdate, results);

  return results;
}

function doUninstall(commands, libFiles, hookFiles, env, results, dryRun, filterNames) {
  removeFileSet(commands, {
    getTargetPath: cmd => path.join(env.commandsDir, getTargetFilename(cmd.relPath, env)),
    getLabel: cmd => `/do:${cmd.name}`,
    dryRun,
    results,
  });

  if (env.libDir) {
    removeFileSet(libFiles, {
      getTargetPath: lib => path.join(env.libDir, lib.relPath),
      getLabel: lib => `lib/${lib.name}`,
      dryRun,
      results,
    });
  }

  if (env.supportsHooks && env.hooksDir && !filterNames?.length) {
    removeFileSet(hookFiles, {
      getTargetPath: hook => path.join(env.hooksDir, hook.relPath),
      getLabel: hook => `hook/${hook.name}`,
      dryRun,
      results,
    });

    // Clean up obsolete hooks that may have been installed by prior versions.
    removeObsoleteHooks(env, dryRun, results);

    // Deregister hooks and clean up cache
    const settingsActions = deregisterHooksFromSettings(env, dryRun);
    results.actions.push(...settingsActions);

    const cacheFile = path.join(path.dirname(env.hooksDir), 'cache', 'slashdo-update-check.json');
    if (fs.existsSync(cacheFile)) {
      if (dryRun) {
        results.actions.push({ name: 'cache/slashdo-update-check.json', status: 'would remove' });
      } else {
        fs.unlinkSync(cacheFile);
        results.actions.push({ name: 'cache/slashdo-update-check.json', status: 'removed' });
      }
      results.removed++;
    }
  }

  if (!dryRun && env.versionFile && fs.existsSync(env.versionFile)) {
    fs.unlinkSync(env.versionFile);
  }

  // Only remove the config file on a FULL uninstall — a filtered/command-scoped
  // uninstall (e.g. `--uninstall do:config`) must not delete saved /do:config
  // defaults that the remaining installed commands still rely on.
  if (!dryRun && env.configFile && !filterNames?.length && fs.existsSync(env.configFile)) {
    fs.unlinkSync(env.configFile);
  }

  return results;
}

function list({ env, packageDir }) {
  const commandsDir = path.join(packageDir, 'commands');
  const commands = collectCommands(commandsDir);
  const items = [];

  for (const cmd of commands) {
    const content = fs.readFileSync(cmd.absPath, 'utf8');
    const transformed = transformCommand(content, env, path.join(packageDir, 'lib'), cmd.relPath);
    const targetRel = getTargetFilename(cmd.relPath, env);
    const targetPath = path.join(env.commandsDir, targetRel);

    let status;
    if (!fs.existsSync(targetPath)) {
      status = 'not installed';
    } else if (filesAreEqual(targetPath, transformed)) {
      status = 'up to date';
    } else {
      status = 'changed';
    }

    const { parseFrontmatter } = require('./transformer');
    const { frontmatter } = parseFrontmatter(content);

    items.push({
      name: `/do:${cmd.name}`,
      status,
      description: frontmatter.description || '(no description)',
    });
  }

  return items;
}

module.exports = { install, list, collectCommands };
