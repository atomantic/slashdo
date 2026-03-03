'use strict';

const fs = require('fs');
const path = require('path');
const { getTargetFilename, transformCommand, transformLib } = require('./transformer');

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
    const hookCommand = `node "${path.join(env.hooksDir, updateCheckHook.name)}"`;

    if (!settings.hooks || typeof settings.hooks !== 'object' || Array.isArray(settings.hooks)) settings.hooks = {};

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

  // Configure statusline only if none exists
  const statuslineHook = hookFiles.find(h => h.name === 'slashdo-statusline.js');
  if (statuslineHook && !settings.statusLine) {
    const statuslineCommand = `node "${path.join(env.hooksDir, statuslineHook.name)}"`;
    settings.statusLine = {
      type: 'command',
      command: statuslineCommand,
    };
    modified = true;
    actions.push({ name: 'settings/statusLine', status: dryRun ? 'would configure' : 'configured' });
  } else if (statuslineHook && settings.statusLine) {
    actions.push({ name: 'settings/statusLine', status: 'existing statusline preserved' });
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
    delete settings.statusLine;
    modified = true;
    actions.push({ name: 'settings/statusLine', status: dryRun ? 'would remove' : 'removed' });
  }

  if (!dryRun && modified) {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  }

  return actions;
}

function install({ env, packageDir, filterNames, dryRun, uninstall }) {
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

  for (const cmd of filtered) {
    const content = fs.readFileSync(cmd.absPath, 'utf8');
    const transformed = transformCommand(content, env, libDir);
    const targetRel = getTargetFilename(cmd.relPath, env);
    const targetPath = path.join(env.commandsDir, targetRel);

    if (filesAreEqual(targetPath, transformed)) {
      results.upToDate++;
      results.actions.push({ name: `/do:${cmd.name}`, status: 'up to date' });
      continue;
    }

    const isNew = !fs.existsSync(targetPath);
    if (dryRun) {
      results.actions.push({
        name: `/do:${cmd.name}`,
        status: isNew ? 'would install' : 'would update',
        target: targetPath,
      });
    } else {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, transformed, 'utf8');
      results.actions.push({
        name: `/do:${cmd.name}`,
        status: isNew ? 'installed' : 'updated',
        target: targetPath,
      });
    }
    if (isNew) results.installed++;
    else results.updated++;
  }

  if (env.libDir) {
    for (const lib of libFiles) {
      const content = fs.readFileSync(lib.absPath, 'utf8');
      const transformed = transformLib(content, env);
      const targetPath = path.join(env.libDir, lib.relPath);

      if (filesAreEqual(targetPath, transformed)) {
        results.upToDate++;
        results.actions.push({ name: `lib/${lib.name}`, status: 'up to date' });
        continue;
      }

      const isNew = !fs.existsSync(targetPath);
      if (dryRun) {
        results.actions.push({
          name: `lib/${lib.name}`,
          status: isNew ? 'would install' : 'would update',
          target: targetPath,
        });
      } else {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, transformed, 'utf8');
        results.actions.push({
          name: `lib/${lib.name}`,
          status: isNew ? 'installed' : 'updated',
          target: targetPath,
        });
      }
      if (isNew) results.installed++;
      else results.updated++;
    }
  }

  if (env.supportsHooks && env.hooksDir) {
    for (const hook of hookFiles) {
      const content = fs.readFileSync(hook.absPath, 'utf8');
      const targetPath = path.join(env.hooksDir, hook.relPath);

      if (filesAreEqual(targetPath, content)) {
        results.upToDate++;
        results.actions.push({ name: `hook/${hook.name}`, status: 'up to date' });
        continue;
      }

      const isNew = !fs.existsSync(targetPath);
      if (dryRun) {
        results.actions.push({
          name: `hook/${hook.name}`,
          status: isNew ? 'would install' : 'would update',
          target: targetPath,
        });
      } else {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, content, 'utf8');
        results.actions.push({
          name: `hook/${hook.name}`,
          status: isNew ? 'installed' : 'updated',
          target: targetPath,
        });
      }
      if (isNew) results.installed++;
      else results.updated++;
    }

    // Register hooks in settings.json (only for full installs, not filtered command installs)
    if (!filterNames?.length) {
      const settingsActions = registerHooksInSettings(env, hookFiles, dryRun);
      results.actions.push(...settingsActions);
    }
  }

  // Clean up renamed commands
  for (const [oldName, newName] of Object.entries(RENAMED_COMMANDS)) {
    const oldRelPath = path.join('do', oldName + '.md');
    const oldTargetRel = getTargetFilename(oldRelPath, env);
    const oldTargetPath = path.join(env.commandsDir, oldTargetRel);

    if (fs.existsSync(oldTargetPath)) {
      if (dryRun) {
        results.actions.push({ name: `/do:${oldName}`, status: `would migrate → /do:${newName}` });
      } else {
        fs.unlinkSync(oldTargetPath);
        results.actions.push({ name: `/do:${oldName}`, status: `migrated → /do:${newName}` });
      }
    }
  }

  // Clean up obsolete hooks from prior versions
  if (env.supportsHooks && env.hooksDir) {
    for (const oldName of OBSOLETE_HOOKS) {
      const oldTargetPath = path.join(env.hooksDir, oldName);

      if (fs.existsSync(oldTargetPath)) {
        if (dryRun) {
          results.actions.push({ name: `hook/${oldName}`, status: 'would remove (obsolete)' });
        } else {
          fs.unlinkSync(oldTargetPath);
          results.actions.push({ name: `hook/${oldName}`, status: 'removed (obsolete)' });
        }
      }
    }
  }

  if (!dryRun && env.versionFile) {
    const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
    fs.writeFileSync(env.versionFile, pkg.version, 'utf8');
  }

  return results;
}

function doUninstall(commands, libFiles, hookFiles, env, results, dryRun, filterNames) {
  for (const cmd of commands) {
    const targetRel = getTargetFilename(cmd.relPath, env);
    const targetPath = path.join(env.commandsDir, targetRel);

    if (!fs.existsSync(targetPath)) continue;

    if (dryRun) {
      results.actions.push({ name: `/do:${cmd.name}`, status: 'would remove', target: targetPath });
    } else {
      fs.unlinkSync(targetPath);
      results.actions.push({ name: `/do:${cmd.name}`, status: 'removed', target: targetPath });
    }
    results.removed++;
  }

  if (env.libDir) {
    for (const lib of libFiles) {
      const targetPath = path.join(env.libDir, lib.relPath);
      if (!fs.existsSync(targetPath)) continue;

      if (dryRun) {
        results.actions.push({ name: `lib/${lib.name}`, status: 'would remove', target: targetPath });
      } else {
        fs.unlinkSync(targetPath);
        results.actions.push({ name: `lib/${lib.name}`, status: 'removed', target: targetPath });
      }
      results.removed++;
    }
  }

  if (env.supportsHooks && env.hooksDir) {
    for (const hook of hookFiles) {
      const targetPath = path.join(env.hooksDir, hook.relPath);
      if (!fs.existsSync(targetPath)) continue;

      if (dryRun) {
        results.actions.push({ name: `hook/${hook.name}`, status: 'would remove', target: targetPath });
      } else {
        fs.unlinkSync(targetPath);
        results.actions.push({ name: `hook/${hook.name}`, status: 'removed', target: targetPath });
      }
      results.removed++;
    }

    // Clean up obsolete hooks that may have been installed by prior versions
    for (const oldName of OBSOLETE_HOOKS) {
      const oldPath = path.join(env.hooksDir, oldName);
      if (fs.existsSync(oldPath)) {
        if (dryRun) {
          results.actions.push({ name: `hook/${oldName}`, status: 'would remove (obsolete)' });
        } else {
          fs.unlinkSync(oldPath);
          results.actions.push({ name: `hook/${oldName}`, status: 'removed (obsolete)' });
        }
        results.removed++;
      }
    }

    // Deregister hooks and clean up cache only for full uninstalls
    if (!filterNames?.length) {
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
  }

  if (!dryRun && env.versionFile && fs.existsSync(env.versionFile)) {
    fs.unlinkSync(env.versionFile);
  }

  return results;
}

function list({ env, packageDir }) {
  const commandsDir = path.join(packageDir, 'commands');
  const commands = collectCommands(commandsDir);
  const items = [];

  for (const cmd of commands) {
    const content = fs.readFileSync(cmd.absPath, 'utf8');
    const transformed = transformCommand(content, env, path.join(packageDir, 'lib'));
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
