'use strict';

const fs = require('fs');
const path = require('path');
const {
  getTargetFilename,
  transformCommand,
  transformLib,
  extractCommandDependencies,
  BUNDLED_LIB_DIR,
} = require('./transformer');
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

// A filtered install of a wrapper command (do:prd, do:simplify, do:pr-better)
// must not assume the workflow it delegates to (do:goals, do:better, do:pr)
// is already installed alongside it — that's exactly the "portable across
// installed hosts" gap this closes. Walk each requested command's raw source
// for command-delegation references and pull in whatever they name, so a
// command-only filtered install always ships its required dependencies too.
// Returns the expanded command list, the names pulled in only as a dependency
// (never requested directly, for status reporting), and the raw content this
// already read from disk (every command it visits ends up in the expanded
// set, so the install step below can reuse it instead of re-reading each file).
function expandWithCommandDependencies(requested, allCommands, knownNames) {
  const byName = new Map(allCommands.map(c => [c.name, c]));
  const included = new Set(requested.map(c => c.name));
  const dependencyNames = new Set();
  const rawContent = new Map();
  const queue = [...included];

  while (queue.length) {
    const name = queue.shift();
    const cmd = byName.get(name);
    if (!cmd) continue;
    const raw = fs.readFileSync(cmd.absPath, 'utf8');
    rawContent.set(name, raw);
    for (const dep of extractCommandDependencies(raw, knownNames)) {
      if (!included.has(dep)) {
        included.add(dep);
        dependencyNames.add(dep);
        queue.push(dep);
      }
    }
  }

  return {
    commands: allCommands.filter(c => included.has(c.name)),
    dependencyNames,
    rawContent,
  };
}

// The uninstall-side counterpart to expandWithCommandDependencies above: finds
// every command that (a) stays installed on disk for this env after the
// requested removal and (b) still names one of the commands being removed as
// a delegation dependency. Returns a Map of removed-name -> Set of dependent
// names still installed, empty when nothing would be stranded.
function findStrandedDependents(removing, allCommands, env, knownCommandNames) {
  const removingNames = new Set(removing.map(c => c.name));
  const stranded = new Map();

  for (const cmd of allCommands) {
    if (removingNames.has(cmd.name)) continue;
    const targetPath = path.join(env.commandsDir, getTargetFilename(cmd.relPath, env));
    if (!fs.existsSync(targetPath)) continue;

    const raw = fs.readFileSync(cmd.absPath, 'utf8');
    for (const dep of extractCommandDependencies(raw, knownCommandNames)) {
      if (!removingNames.has(dep)) continue;
      if (!stranded.has(dep)) stranded.set(dep, new Set());
      stranded.get(dep).add(cmd.name);
    }
  }

  return stranded;
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

function assertSafeBundlePath(targetPath, expectedType) {
  let stat;
  try {
    stat = fs.lstatSync(targetPath);
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }

  const isExpectedType = expectedType === 'directory' ? stat.isDirectory() : stat.isFile();
  if (stat.isSymbolicLink() || !isExpectedType) {
    throw new Error(`Refusing to traverse unsafe bundled lib ${expectedType}: ${targetPath}`);
  }
  return true;
}

function bundledLibsAreEqual(skillDir, expected) {
  const bundleDir = path.join(skillDir, BUNDLED_LIB_DIR);
  let bundleStat;
  try {
    bundleStat = fs.lstatSync(bundleDir);
  } catch (error) {
    return error.code === 'ENOENT' && expected.size === 0;
  }
  if (bundleStat.isSymbolicLink() || !bundleStat.isDirectory()) return false;

  let names;
  try {
    names = fs.readdirSync(bundleDir);
  } catch {
    return false;
  }
  if (names.length !== expected.size) return false;

  for (const [filename, content] of expected) {
    const targetPath = path.join(bundleDir, filename);
    let targetStat;
    try {
      targetStat = fs.lstatSync(targetPath);
    } catch {
      return false;
    }
    if (targetStat.isSymbolicLink() || !targetStat.isFile()) return false;
    try {
      if (fs.readFileSync(targetPath, 'utf8') !== content) return false;
    } catch {
      return false;
    }
  }
  return true;
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
// directive in SKILL.md points at a file that exists. The shared renderer has
// already resolved the full graph, including each file's sibling references.
function syncBundledLibs(commands, bundledByCommand, env, dryRun, results) {
  for (const cmd of commands) {
    const entry = bundledByCommand.get(cmd.relPath);
    if (!entry) continue;
    const contents = new Map(Object.entries(entry));

    const skillDir = path.dirname(path.join(env.commandsDir, getTargetFilename(cmd.relPath, env)));
    const skillExists = assertSafeBundlePath(skillDir, 'directory');
    const bundleDir = path.join(skillDir, BUNDLED_LIB_DIR);
    const bundleExists = skillExists && assertSafeBundlePath(bundleDir, 'directory');
    const existingNames = bundleExists ? fs.readdirSync(bundleDir) : [];

    // Validate the existing set before changing anything. The whole directory is
    // installer-owned, so a safe regular file not in `contents` is stale.
    for (const name of existingNames) {
      assertSafeBundlePath(path.join(bundleDir, name), 'file');
    }

    for (const [filename, content] of contents) {
      const targetPath = path.join(bundleDir, filename);
      assertSafeBundlePath(targetPath, 'file');
      syncFile({
        label: `/do:${cmd.name} ${BUNDLED_LIB_DIR}/${filename}`,
        content,
        targetPath,
        dryRun,
        results,
      });
    }

    for (const name of existingNames) {
      if (contents.has(name)) continue;
      removeFile({
        label: `/do:${cmd.name} ${BUNDLED_LIB_DIR}/${name}`,
        targetPath: path.join(bundleDir, name),
        dryRun,
        results,
      });
    }

    if (!dryRun && bundleExists && fs.readdirSync(bundleDir).length === 0) {
      fs.rmdirSync(bundleDir);
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

  const requested = filterNames?.length
    ? commands.filter(c => filterNames.includes(c.name) || filterNames.includes(`do:${c.name}`))
    : commands;

  const results = { installed: 0, updated: 0, upToDate: 0, removed: 0, actions: [] };
  const knownCommandNames = new Set(commands.map(c => c.name));

  if (uninstall) {
    // A full uninstall removes every command together, so nothing can be left
    // stranded. A filtered uninstall can remove a command other *remaining*
    // installed commands still delegate to — check the same reference graph
    // a filtered install already walks (expandWithCommandDependencies above),
    // just from the other direction.
    if (filterNames?.length) {
      const stranded = findStrandedDependents(requested, commands, env, knownCommandNames);
      if (stranded.size) {
        const details = [...stranded.entries()]
          .map(([dep, users]) => `/do:${dep} is required by ${[...users].map(u => `/do:${u}`).join(', ')}`)
          .join('; ');
        throw new Error(
          `Refusing to uninstall: ${details}. Uninstall the dependent command(s) too, ` +
          `or leave /do:${[...stranded.keys()].join(', /do:')} installed.`
        );
      }
    }
    return doUninstall(requested, libFiles, hookFiles, env, results, dryRun, filterNames);
  }

  const { commands: filtered, dependencyNames, rawContent } = filterNames?.length
    ? expandWithCommandDependencies(requested, commands, knownCommandNames)
    : { commands: requested, dependencyNames: new Set(), rawContent: new Map() };

  // Compile each command once; install/list share the resulting file contents.
  const bundledByCommand = new Map();

  syncFileSet(filtered, {
    getContent: (cmd) => {
      const files = {};
      const raw = rawContent.get(cmd.name) ?? fs.readFileSync(cmd.absPath, 'utf8');
      const content = transformCommand(raw, env, libDir, cmd.relPath,
        { files, commandNames: knownCommandNames });
      if (env.bundlesLibs) bundledByCommand.set(cmd.relPath, files);
      return content;
    },
    getTargetPath: cmd => path.join(env.commandsDir, getTargetFilename(cmd.relPath, env)),
    getLabel: cmd => dependencyNames.has(cmd.name)
      ? `/do:${cmd.name} (dependency)`
      : `/do:${cmd.name}`,
    dryRun,
    results,
  });

  if (env.bundlesLibs) {
    syncBundledLibs(filtered, bundledByCommand, env, dryRun, results);
  }

  if (env.libDir) {
    syncFileSet(libFiles, {
      getContent: lib => transformLib(fs.readFileSync(lib.absPath, 'utf8'), env, libDir),
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
  const bundledToRemove = [];
  if (env.bundlesLibs) {
    for (const cmd of commands) {
      const skillDir = path.dirname(path.join(env.commandsDir, getTargetFilename(cmd.relPath, env)));
      if (!assertSafeBundlePath(skillDir, 'directory')) continue;
      const bundleDir = path.join(skillDir, BUNDLED_LIB_DIR);
      if (!assertSafeBundlePath(bundleDir, 'directory')) continue;
      const names = fs.readdirSync(bundleDir);
      // Validate the whole set before uninstall removes anything. This keeps an
      // unexpected entry from causing a partial uninstall or escaping the skill.
      for (const name of names) {
        assertSafeBundlePath(path.join(bundleDir, name), 'file');
      }
      bundledToRemove.push({ cmd, bundleDir, names });
    }
  }

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
    for (const { cmd, bundleDir, names } of bundledToRemove) {
      for (const name of names) {
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

  if (env.namespacing === 'directory') {
    for (const cmd of commands) {
      const skillDir = path.dirname(path.join(env.commandsDir, getTargetFilename(cmd.relPath, env)));
      if (!dryRun && fs.existsSync(skillDir) && fs.readdirSync(skillDir).length === 0) {
        fs.rmdirSync(skillDir);
      }
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
  const libDir = path.join(packageDir, 'lib');
  const commands = collectCommands(commandsDir);
  const knownCommandNames = new Set(commands.map(c => c.name));
  const byName = new Map(commands.map(c => [c.name, c]));
  const items = [];

  for (const cmd of commands) {
    const content = fs.readFileSync(cmd.absPath, 'utf8');
    const files = {};
    const commandDependencies = new Set();
    const transformed = transformCommand(content, env, libDir, cmd.relPath,
      { files, commandNames: knownCommandNames, commandDependencies });
    const expectedBundles = env.bundlesLibs
      ? new Map(Object.entries(files))
      : null;
    const targetRel = getTargetFilename(cmd.relPath, env);
    const targetPath = path.join(env.commandsDir, targetRel);
    const installed = fs.existsSync(targetPath);

    let status;
    if (!installed) {
      status = 'not installed';
    } else if (filesAreEqual(targetPath, transformed)
      && (!expectedBundles
        || bundledLibsAreEqual(path.dirname(targetPath), expectedBundles))) {
      status = 'up to date';
    } else {
      status = 'changed';
    }

    // A command can render/copy fine and still be unhealthy: its rendered
    // content only proves it matches the packaged source, not that whatever
    // it delegates to (do:prd -> do:goals, etc.) actually landed in this
    // env's installed tree. Only meaningful once the command itself is
    // installed — "not installed" already covers the rest.
    const missingDependencies = installed
      ? [...commandDependencies].filter(depName => {
        const depCmd = byName.get(depName);
        if (!depCmd) return false;
        const depTargetPath = path.join(env.commandsDir, getTargetFilename(depCmd.relPath, env));
        return !fs.existsSync(depTargetPath);
      })
      : [];
    if (missingDependencies.length) status = 'unhealthy';

    const { parseFrontmatter } = require('./transformer');
    const { frontmatter } = parseFrontmatter(content);

    const item = {
      name: `/do:${cmd.name}`,
      status,
      description: frontmatter.description || '(no description)',
    };
    if (missingDependencies.length) item.missingDependencies = missingDependencies;
    items.push(item);
  }

  return items;
}

module.exports = { install, list, collectCommands };
