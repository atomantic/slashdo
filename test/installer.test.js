'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { install, collectCommands, list } = require('../src/installer');

// Reach into internals we need to test directly
// These are not exported, so we require the file and test via the install() entrypoint
// For registerHooksInSettings / deregisterHooksFromSettings, we test indirectly through install/uninstall

const PACKAGE_DIR = path.resolve(__dirname, '..');

// ── Helpers ─────────────────────────────────────────────────────────

function makeTmpEnv(opts = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slashdo-inst-'));
  const env = {
    name: 'Test Env',
    commandsDir: path.join(tmpDir, 'commands'),
    libDir: opts.libDir !== undefined ? opts.libDir : path.join(tmpDir, 'lib'),
    hooksDir: opts.hooksDir !== undefined ? opts.hooksDir : path.join(tmpDir, 'hooks'),
    settingsFile: opts.settingsFile !== undefined ? opts.settingsFile : path.join(tmpDir, 'settings.json'),
    versionFile: path.join(tmpDir, '.slashdo-version'),
    format: opts.format || 'yaml-frontmatter',
    ext: opts.ext !== undefined ? opts.ext : '.md',
    namespacing: opts.namespacing || 'subdirectory',
    libPathPrefix: opts.libPathPrefix !== undefined ? opts.libPathPrefix : '~/.claude/lib/',
    supportsHooks: opts.supportsHooks !== undefined ? opts.supportsHooks : true,
    supportsCatInclusion: opts.supportsCatInclusion !== undefined ? opts.supportsCatInclusion : true,
  };
  return { tmpDir, env };
}

function cleanup(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

// ── collectCommands ─────────────────────────────────────────────────

describe('collectCommands', () => {
  it('collects .md files from do/ subdirectory', () => {
    const commands = collectCommands(path.join(PACKAGE_DIR, 'commands'));
    assert.ok(commands.length > 0, 'Should find commands');
    assert.ok(commands.every(c => c.name && c.relPath && c.absPath));
    assert.ok(commands.some(c => c.name === 'push'));
  });

  it('returns sorted by name', () => {
    const commands = collectCommands(path.join(PACKAGE_DIR, 'commands'));
    const names = commands.map(c => c.name);
    const sorted = [...names].sort();
    assert.deepEqual(names, sorted);
  });

  it('returns empty array for nonexistent directory', () => {
    const result = collectCommands('/tmp/nonexistent-slashdo-dir');
    assert.deepEqual(result, []);
  });

  it('returns empty array for directory with no do/ subdir', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slashdo-test-'));
    const result = collectCommands(tmpDir);
    assert.deepEqual(result, []);
    fs.rmSync(tmpDir, { recursive: true });
  });
});

// ── install (fresh install) ─────────────────────────────────────────

describe('install', () => {
  it('fresh install creates command files', () => {
    const { tmpDir, env } = makeTmpEnv();

    const results = install({ env, packageDir: PACKAGE_DIR, dryRun: false });
    assert.ok(results.installed > 0, 'Should install commands');
    assert.equal(results.updated, 0);

    // Verify a command file exists
    const pushPath = path.join(env.commandsDir, 'do', 'push.md');
    assert.ok(fs.existsSync(pushPath), 'push.md should exist');

    // Verify version file written
    assert.ok(fs.existsSync(env.versionFile), 'version file should exist');
    const version = fs.readFileSync(env.versionFile, 'utf8');
    assert.ok(version.match(/^\d+\.\d+\.\d+$/), 'version should be semver');

    cleanup(tmpDir);
  });

  it('re-install detects up to date files', () => {
    const { tmpDir, env } = makeTmpEnv();

    install({ env, packageDir: PACKAGE_DIR, dryRun: false });
    const results2 = install({ env, packageDir: PACKAGE_DIR, dryRun: false });

    assert.equal(results2.installed, 0);
    assert.equal(results2.updated, 0);
    assert.ok(results2.upToDate > 0, 'Should detect up-to-date files');

    cleanup(tmpDir);
  });

  it('detects updated files', () => {
    const { tmpDir, env } = makeTmpEnv();

    install({ env, packageDir: PACKAGE_DIR, dryRun: false });

    // Modify a file to trigger update
    const pushPath = path.join(env.commandsDir, 'do', 'push.md');
    fs.writeFileSync(pushPath, 'modified content', 'utf8');

    const results2 = install({ env, packageDir: PACKAGE_DIR, dryRun: false });
    assert.ok(results2.updated > 0, 'Should detect updated files');

    cleanup(tmpDir);
  });

  it('installs lib files when env.libDir is set', () => {
    const { tmpDir, env } = makeTmpEnv();

    install({ env, packageDir: PACKAGE_DIR, dryRun: false });

    const libFiles = fs.readdirSync(env.libDir).filter(f => f.endsWith('.md'));
    assert.ok(libFiles.length > 0, 'Should install lib files');

    cleanup(tmpDir);
  });

  it('installs hooks when env supports hooks', () => {
    const { tmpDir, env } = makeTmpEnv({ supportsHooks: true });

    install({ env, packageDir: PACKAGE_DIR, dryRun: false });

    assert.ok(fs.existsSync(env.hooksDir), 'hooks dir should exist');
    const hookFiles = fs.readdirSync(env.hooksDir);
    assert.ok(hookFiles.length > 0, 'Should install hook files');

    cleanup(tmpDir);
  });

  it('skips hooks when env does not support hooks', () => {
    const { tmpDir, env } = makeTmpEnv({ supportsHooks: false, hooksDir: null });

    install({ env, packageDir: PACKAGE_DIR, dryRun: false });

    // No hook-related actions
    const hookActions = env.hooksDir ? fs.readdirSync(env.hooksDir) : [];
    assert.equal(hookActions.length, 0);

    cleanup(tmpDir);
  });

  it('filtered install only installs specified commands', () => {
    const { tmpDir, env } = makeTmpEnv();

    const results = install({
      env,
      packageDir: PACKAGE_DIR,
      filterNames: ['push'],
      dryRun: false,
    });

    const cmdActions = results.actions.filter(a => a.name.startsWith('/do:'));
    assert.equal(cmdActions.length, 1);
    assert.ok(cmdActions[0].name.includes('push'));

    cleanup(tmpDir);
  });

  it('filtered install accepts do: prefix', () => {
    const { tmpDir, env } = makeTmpEnv();

    const results = install({
      env,
      packageDir: PACKAGE_DIR,
      filterNames: ['do:push'],
      dryRun: false,
    });

    const cmdActions = results.actions.filter(a => a.name.startsWith('/do:'));
    assert.equal(cmdActions.length, 1);

    cleanup(tmpDir);
  });

  it('dryRun does not write files', () => {
    const { tmpDir, env } = makeTmpEnv();

    const results = install({ env, packageDir: PACKAGE_DIR, dryRun: true });

    assert.ok(results.actions.some(a => a.status.startsWith('would ')));
    assert.ok(!fs.existsSync(path.join(env.commandsDir, 'do')), 'Should not create dirs in dry run');
    assert.ok(!fs.existsSync(env.versionFile), 'Should not write version file in dry run');

    cleanup(tmpDir);
  });
});

// ── install with different environments ─────────────────────────────

describe('install with env formats', () => {
  it('installs with flat namespacing (opencode style)', () => {
    const { tmpDir, env } = makeTmpEnv({
      namespacing: 'flat',
      libPathPrefix: '~/.config/opencode/lib/',
    });

    install({ env, packageDir: PACKAGE_DIR, dryRun: false });

    // Flat naming: do-push.md instead of do/push.md
    const files = fs.readdirSync(env.commandsDir);
    assert.ok(files.some(f => f.startsWith('do-')), 'Should use flat naming');

    cleanup(tmpDir);
  });

  it('installs with directory namespacing (codex style)', () => {
    const { tmpDir, env } = makeTmpEnv({
      namespacing: 'directory',
      format: 'skill-md',
      ext: null,
      libDir: null,
      libPathPrefix: null,
      supportsHooks: false,
      hooksDir: null,
      supportsCatInclusion: false,
    });

    install({ env, packageDir: PACKAGE_DIR, dryRun: false });

    // Directory naming: do-push/SKILL.md
    const dirs = fs.readdirSync(env.commandsDir);
    assert.ok(dirs.some(d => d.startsWith('do-')), 'Should create namespace dirs');
    const firstDir = dirs.find(d => d.startsWith('do-'));
    assert.ok(fs.existsSync(path.join(env.commandsDir, firstDir, 'SKILL.md')));

    cleanup(tmpDir);
  });

  it('installs with toml format (gemini style)', () => {
    const { tmpDir, env } = makeTmpEnv({
      format: 'toml',
      libPathPrefix: '~/.gemini/lib/',
      supportsHooks: false,
      hooksDir: null,
    });

    install({ env, packageDir: PACKAGE_DIR, dryRun: false });

    const pushPath = path.join(env.commandsDir, 'do', 'push.md');
    const content = fs.readFileSync(pushPath, 'utf8');
    assert.ok(content.startsWith('+++'), 'Should use TOML format');

    cleanup(tmpDir);
  });
});

// ── uninstall ───────────────────────────────────────────────────────

describe('uninstall', () => {
  it('removes installed files', () => {
    const { tmpDir, env } = makeTmpEnv();

    install({ env, packageDir: PACKAGE_DIR, dryRun: false });
    const pushPath = path.join(env.commandsDir, 'do', 'push.md');
    assert.ok(fs.existsSync(pushPath), 'push.md should exist before uninstall');

    const results = install({ env, packageDir: PACKAGE_DIR, uninstall: true, dryRun: false });
    assert.ok(results.removed > 0, 'Should remove files');
    assert.ok(!fs.existsSync(pushPath), 'push.md should be removed');

    cleanup(tmpDir);
  });

  it('uninstall nothing to remove', () => {
    const { tmpDir, env } = makeTmpEnv();

    const results = install({ env, packageDir: PACKAGE_DIR, uninstall: true, dryRun: false });
    assert.equal(results.removed, 0, 'Nothing to remove');

    cleanup(tmpDir);
  });

  it('dryRun uninstall does not delete files', () => {
    const { tmpDir, env } = makeTmpEnv();

    install({ env, packageDir: PACKAGE_DIR, dryRun: false });

    const results = install({ env, packageDir: PACKAGE_DIR, uninstall: true, dryRun: true });
    assert.ok(results.actions.some(a => a.status === 'would remove'));

    // Files should still exist
    const pushPath = path.join(env.commandsDir, 'do', 'push.md');
    assert.ok(fs.existsSync(pushPath), 'Files should not be deleted in dry run');

    cleanup(tmpDir);
  });

  it('removes version file on uninstall', () => {
    const { tmpDir, env } = makeTmpEnv();

    install({ env, packageDir: PACKAGE_DIR, dryRun: false });
    assert.ok(fs.existsSync(env.versionFile));

    install({ env, packageDir: PACKAGE_DIR, uninstall: true, dryRun: false });
    assert.ok(!fs.existsSync(env.versionFile), 'version file should be removed');

    cleanup(tmpDir);
  });

  it('removes cache file on uninstall', () => {
    const { tmpDir, env } = makeTmpEnv();

    // Create a cache file
    const cacheDir = path.join(path.dirname(env.hooksDir), 'cache');
    fs.mkdirSync(cacheDir, { recursive: true });
    const cacheFile = path.join(cacheDir, 'slashdo-update-check.json');
    fs.writeFileSync(cacheFile, '{}', 'utf8');

    install({ env, packageDir: PACKAGE_DIR, dryRun: false });
    install({ env, packageDir: PACKAGE_DIR, uninstall: true, dryRun: false });

    assert.ok(!fs.existsSync(cacheFile), 'cache file should be removed');

    cleanup(tmpDir);
  });
});

// ── registerHooksInSettings (via install) ───────────────────────────

describe('hook registration via install', () => {
  it('registers hooks in empty settings file', () => {
    const { tmpDir, env } = makeTmpEnv();
    // No settings file exists yet

    install({ env, packageDir: PACKAGE_DIR, dryRun: false });

    assert.ok(fs.existsSync(env.settingsFile), 'settings.json should be created');
    const settings = JSON.parse(fs.readFileSync(env.settingsFile, 'utf8'));
    assert.ok(settings.hooks, 'hooks should exist');
    assert.ok(Array.isArray(settings.hooks.SessionStart), 'SessionStart should be array');
    assert.ok(settings.statusLine, 'statusLine should be configured');
  });

  it('skips registration on corrupted settings.json', () => {
    const { tmpDir, env } = makeTmpEnv();
    fs.writeFileSync(env.settingsFile, '{not valid json!!!', 'utf8');

    // Should not throw
    const results = install({ env, packageDir: PACKAGE_DIR, dryRun: false });
    // settings.json should be unchanged (not overwritten)
    const content = fs.readFileSync(env.settingsFile, 'utf8');
    assert.equal(content, '{not valid json!!!');

    cleanup(tmpDir);
  });

  it('preserves existing statusLine', () => {
    const { tmpDir, env } = makeTmpEnv();
    const existingSettings = {
      statusLine: { type: 'command', command: 'my-custom-statusline' },
    };
    fs.writeFileSync(env.settingsFile, JSON.stringify(existingSettings), 'utf8');

    install({ env, packageDir: PACKAGE_DIR, dryRun: false });

    const settings = JSON.parse(fs.readFileSync(env.settingsFile, 'utf8'));
    assert.equal(settings.statusLine.command, 'my-custom-statusline');

    cleanup(tmpDir);
  });

  it('is idempotent — does not double-register hooks', () => {
    const { tmpDir, env } = makeTmpEnv();

    install({ env, packageDir: PACKAGE_DIR, dryRun: false });
    install({ env, packageDir: PACKAGE_DIR, dryRun: false });

    const settings = JSON.parse(fs.readFileSync(env.settingsFile, 'utf8'));
    // Count how many hooks reference slashdo-check-update
    let hookCount = 0;
    for (const group of settings.hooks.SessionStart) {
      if (group?.hooks) {
        hookCount += group.hooks.filter(h => h?.command?.includes('slashdo-check-update')).length;
      }
    }
    assert.equal(hookCount, 1, 'Should only register hook once');

    cleanup(tmpDir);
  });

  it('handles malformed entries in SessionStart array', () => {
    const { tmpDir, env } = makeTmpEnv();
    const malformedSettings = {
      hooks: {
        SessionStart: [null, 'string', 42, { hooks: 'not-array' }],
      },
    };
    fs.writeFileSync(env.settingsFile, JSON.stringify(malformedSettings), 'utf8');

    // Should not throw
    const results = install({ env, packageDir: PACKAGE_DIR, dryRun: false });
    assert.ok(results.actions.length > 0);

    cleanup(tmpDir);
  });

  it('dryRun does not modify settings.json', () => {
    const { tmpDir, env } = makeTmpEnv();
    fs.writeFileSync(env.settingsFile, '{}', 'utf8');

    install({ env, packageDir: PACKAGE_DIR, dryRun: true });

    const content = fs.readFileSync(env.settingsFile, 'utf8');
    assert.equal(content, '{}');

    cleanup(tmpDir);
  });
});

// ── deregisterHooksFromSettings (via uninstall) ─────────────────────

describe('hook deregistration via uninstall', () => {
  it('removes hooks from settings.json', () => {
    const { tmpDir, env } = makeTmpEnv();

    install({ env, packageDir: PACKAGE_DIR, dryRun: false });
    const settingsBefore = JSON.parse(fs.readFileSync(env.settingsFile, 'utf8'));
    assert.ok(settingsBefore.hooks);

    install({ env, packageDir: PACKAGE_DIR, uninstall: true, dryRun: false });

    const settingsAfter = JSON.parse(fs.readFileSync(env.settingsFile, 'utf8'));
    // hooks.SessionStart should be cleaned up
    assert.ok(!settingsAfter.hooks, 'hooks should be removed');
    assert.ok(!settingsAfter.statusLine, 'statusLine should be removed');

    cleanup(tmpDir);
  });

  it('skips deregistration on corrupted settings.json', () => {
    const { tmpDir, env } = makeTmpEnv();

    install({ env, packageDir: PACKAGE_DIR, dryRun: false });
    // Corrupt settings.json
    fs.writeFileSync(env.settingsFile, '{bad json', 'utf8');

    // Should not throw
    const results = install({ env, packageDir: PACKAGE_DIR, uninstall: true, dryRun: false });
    // settings.json should be unchanged
    assert.equal(fs.readFileSync(env.settingsFile, 'utf8'), '{bad json');

    cleanup(tmpDir);
  });

  it('handles missing settings.json', () => {
    const { tmpDir, env } = makeTmpEnv();

    // Install then remove settings.json manually
    install({ env, packageDir: PACKAGE_DIR, dryRun: false });
    fs.unlinkSync(env.settingsFile);

    // Should not throw
    install({ env, packageDir: PACKAGE_DIR, uninstall: true, dryRun: false });

    cleanup(tmpDir);
  });

  it('cleans up empty groups', () => {
    const { tmpDir, env } = makeTmpEnv();

    install({ env, packageDir: PACKAGE_DIR, dryRun: false });

    // Verify the hook is registered
    const before = JSON.parse(fs.readFileSync(env.settingsFile, 'utf8'));
    assert.ok(before.hooks.SessionStart.length > 0);

    install({ env, packageDir: PACKAGE_DIR, uninstall: true, dryRun: false });

    const after = JSON.parse(fs.readFileSync(env.settingsFile, 'utf8'));
    // Entire hooks key should be removed since SessionStart is now empty
    assert.ok(!after.hooks, 'Empty hooks should be cleaned up');

    cleanup(tmpDir);
  });
});

// ── filesAreEqual (via install behavior) ────────────────────────────

describe('filesAreEqual behavior', () => {
  it('up-to-date files are not reinstalled', () => {
    const { tmpDir, env } = makeTmpEnv();

    install({ env, packageDir: PACKAGE_DIR, dryRun: false });
    const results2 = install({ env, packageDir: PACKAGE_DIR, dryRun: false });

    assert.ok(results2.upToDate > 0);
    assert.equal(results2.installed, 0);
    assert.equal(results2.updated, 0);

    cleanup(tmpDir);
  });
});

// ── list ────────────────────────────────────────────────────────────

describe('list', () => {
  it('returns command list with descriptions', () => {
    const { tmpDir, env } = makeTmpEnv();

    const items = list({ env, packageDir: PACKAGE_DIR });
    assert.ok(items.length > 0, 'Should list commands');
    assert.ok(items[0].name, 'Items should have name');
    assert.ok(items[0].description, 'Items should have description');
    assert.ok(items[0].status, 'Items should have status');

    cleanup(tmpDir);
  });

  it('shows not installed for fresh env', () => {
    const { tmpDir, env } = makeTmpEnv();

    const items = list({ env, packageDir: PACKAGE_DIR });
    assert.ok(items.every(i => i.status === 'not installed'));

    cleanup(tmpDir);
  });

  it('shows up to date after install', () => {
    const { tmpDir, env } = makeTmpEnv();

    install({ env, packageDir: PACKAGE_DIR, dryRun: false });
    const items = list({ env, packageDir: PACKAGE_DIR });
    assert.ok(items.some(i => i.status === 'up to date'));

    cleanup(tmpDir);
  });
});

// ── renamed command cleanup ─────────────────────────────────────────

describe('renamed command cleanup', () => {
  it('removes old renamed commands during install', () => {
    const { tmpDir, env } = makeTmpEnv();

    // Create old command files
    const doDir = path.join(env.commandsDir, 'do');
    fs.mkdirSync(doDir, { recursive: true });
    fs.writeFileSync(path.join(doDir, 'cam.md'), 'old', 'utf8');
    fs.writeFileSync(path.join(doDir, 'good.md'), 'old', 'utf8');

    install({ env, packageDir: PACKAGE_DIR, dryRun: false });

    assert.ok(!fs.existsSync(path.join(doDir, 'cam.md')), 'cam.md should be removed');
    assert.ok(!fs.existsSync(path.join(doDir, 'good.md')), 'good.md should be removed');

    cleanup(tmpDir);
  });
});
