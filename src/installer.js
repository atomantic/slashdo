'use strict';

const fs = require('fs');
const path = require('path');
const { getTargetFilename, transformCommand, transformLib, BUNDLED_LIB_DIR } = require('./transformer');
const { readConfig, writeConfig } = require('./config');
const {
  registerHooksInSettings,
  deregisterHooksFromSettings,
  SETTINGS_HOOKS_CACHE,
} = require('./settings-hooks');

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

// Writes the lib docs a command defers into `<skillDir>/lib/`, so the read
// directive in SKILL.md points at a file that exists. Transitive: a bundled lib
// may itself defer a sibling backend (local-agent cites ollama), so drain the set
// as it grows rather than iterating a snapshot.
function syncBundledLibs(commands, bundledByCommand, libDir, env, dryRun, results) {
  for (const cmd of commands) {
    const entry = bundledByCommand.get(cmd.relPath);
    if (!entry || entry.bundled.size === 0) continue;
    const { bundled: pending, present } = entry;

    const skillDir = path.dirname(path.join(env.commandsDir, getTargetFilename(cmd.relPath, env)));
    const written = new Set();
    // `pending` grows while draining when a bundled lib defers another.
    while (written.size < pending.size) {
      for (const filename of Array.from(pending)) {
        if (written.has(filename)) continue;
        written.add(filename);
        const absPath = path.join(libDir, filename);
        if (!fs.existsSync(absPath)) continue;
        syncFile({
          label: `/do:${cmd.name} ${BUNDLED_LIB_DIR}/${filename}`,
          content: transformLib(fs.readFileSync(absPath, 'utf8'), env, libDir, { bundled: pending, present }),
          targetPath: path.join(skillDir, BUNDLED_LIB_DIR, filename),
          dryRun,
          results,
        });
      }
    }
  }
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

  // Per-command set of lib docs to write beside its SKILL.md. Filled while each
  // command is transformed (getContent runs for every item, up-to-date ones
  // included), then drained below.
  const bundledByCommand = new Map();

  syncFileSet(filtered, {
    getContent: (cmd) => {
      const bundled = new Set();
      const present = new Set();
      const content = transformCommand(
        fs.readFileSync(cmd.absPath, 'utf8'), env, libDir, cmd.relPath, { bundled, present });
      if (env.bundlesLibs) bundledByCommand.set(cmd.relPath, { bundled, present });
      return content;
    },
    getTargetPath: cmd => path.join(env.commandsDir, getTargetFilename(cmd.relPath, env)),
    getLabel: cmd => `/do:${cmd.name}`,
    dryRun,
    results,
  });

  if (env.bundlesLibs) {
    syncBundledLibs(filtered, bundledByCommand, libDir, env, dryRun, results);
  }

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

  // Bundled lib docs live INSIDE the skill directory, so removing SKILL.md alone
  // would strand them (and leave the directory behind). Remove every file the
  // bundle dir holds, then the now-empty dir.
  if (env.bundlesLibs) {
    for (const cmd of commands) {
      const skillDir = path.dirname(path.join(env.commandsDir, getTargetFilename(cmd.relPath, env)));
      const bundleDir = path.join(skillDir, BUNDLED_LIB_DIR);
      if (!fs.existsSync(bundleDir)) continue;
      for (const name of fs.readdirSync(bundleDir)) {
        removeFile({
          label: `/do:${cmd.name} ${BUNDLED_LIB_DIR}/${name}`,
          targetPath: path.join(bundleDir, name),
          dryRun,
          results,
        });
      }
      if (!dryRun && fs.readdirSync(bundleDir).length === 0) fs.rmdirSync(bundleDir);
    }
  }

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

    // The curl installer caches this dependency-free module beside the hooks so
    // it can uninstall offline. It is slashdo-owned even though it is not part
    // of the npm package's source hook list.
    const settingsHooksCache = path.join(env.hooksDir, SETTINGS_HOOKS_CACHE);
    if (fs.existsSync(settingsHooksCache)) {
      if (dryRun) {
        results.actions.push({ name: `hook/${SETTINGS_HOOKS_CACHE}`, status: 'would remove', target: settingsHooksCache });
      } else {
        fs.unlinkSync(settingsHooksCache);
        results.actions.push({ name: `hook/${SETTINGS_HOOKS_CACHE}`, status: 'removed', target: settingsHooksCache });
      }
      results.removed++;
    }

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
