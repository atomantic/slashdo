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
    if (entry.isFile() && entry.name.endsWith('.md')) {
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
    return doUninstall(filtered, libFiles, hookFiles, env, results, dryRun);
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
  }

  if (!dryRun && env.versionFile) {
    const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
    fs.writeFileSync(env.versionFile, pkg.version, 'utf8');
  }

  return results;
}

function doUninstall(commands, libFiles, hookFiles, env, results, dryRun) {
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
