'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const shellQuote = (value) => `'${value.replace(/'/g, `'\\''`)}'`;

function waitForJson(file, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      sleep(25);
    }
  }
  throw new Error(`Timed out waiting for ${file}`);
}

function assertInstalledDocsUseCustomRoot(configDir, { completePaths = false } = {}) {
  const quotedRoot = shellQuote(configDir);
  const installedDocs = [
    ...fs.readdirSync(path.join(configDir, 'commands', 'do')).map((name) =>
      path.join(configDir, 'commands', 'do', name)),
    ...fs.readdirSync(path.join(configDir, 'lib')).map((name) =>
      path.join(configDir, 'lib', name)),
  ];
  for (const file of installedDocs) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /~\/\.claude(?:\/|[^A-Za-z0-9_-]|$)/, file);
  }
  const command = fs.readFileSync(path.join(configDir, 'commands', 'do', 'next.md'), 'utf8');
  const expectedPath = completePaths
    ? shellQuote(path.join(configDir, 'lib', 'gh-host.md'))
    : `${quotedRoot}/lib/gh-host.md`;
  assert.ok(command.includes(`!\`cat ${expectedPath}\``));
}

function assertRegisteredCommandsRun(configDir, env) {
  const settings = JSON.parse(fs.readFileSync(path.join(configDir, 'settings.json'), 'utf8'));
  for (const command of [settings.hooks.SessionStart[0].hooks[0].command, settings.statusLine.command]) {
    const run = spawnSync('sh', ['-c', command], { encoding: 'utf8', env, input: '{}', timeout: 5000 });
    assert.equal(run.status, 0, run.stderr);
  }
}

describe('curl installer CLAUDE_CONFIG_DIR support', () => {
  it('creates an explicitly configured root when it does not exist', { timeout: 30000 }, () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'slashdo-custom-home-'));
    const configDir = path.join(home, 'not-yet-created');
    const env = { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: configDir };

    try {
      const installed = spawnSync('bash', [path.join(repoRoot, 'install.sh')], {
        cwd: repoRoot,
        encoding: 'utf8',
        env,
        timeout: 20000,
      });
      assert.equal(installed.status, 0, installed.stderr || installed.stdout);
      assert.ok(fs.existsSync(path.join(configDir, 'commands', 'do', 'next.md')));
      assert.equal(fs.existsSync(path.join(home, '.claude')), false);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('installs, registers, and uninstalls entirely within the custom root', { timeout: 30000 }, () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'slashdo-custom-home-'));
    const configDir = path.join(home, "claude's profile");
    const env = { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: configDir };

    try {
      fs.mkdirSync(configDir);
      const installed = spawnSync('bash', [path.join(repoRoot, 'install.sh')], {
        cwd: repoRoot,
        encoding: 'utf8',
        env,
        timeout: 20000,
      });
      assert.equal(installed.status, 0, installed.stderr || installed.stdout);

      assert.ok(fs.existsSync(path.join(configDir, 'commands', 'do', 'next.md')));
      assert.ok(fs.existsSync(path.join(configDir, 'lib', 'plan-issue-mode.md')));
      assert.ok(fs.existsSync(path.join(configDir, 'hooks', 'slashdo-check-update.js')));
      assert.ok(fs.existsSync(path.join(configDir, '.slashdo-config.json')));
      const settings = JSON.parse(fs.readFileSync(path.join(configDir, 'settings.json'), 'utf8'));
      assert.equal(settings.hooks.SessionStart[0].hooks[0].command,
        `node ${shellQuote(path.join(configDir, 'hooks', 'slashdo-check-update.js'))}`);
      assert.equal(settings.statusLine.command,
        `node ${shellQuote(path.join(configDir, 'hooks', 'slashdo-statusline.js'))}`);
      assert.equal(fs.existsSync(path.join(home, '.claude')), false);

      const command = fs.readFileSync(path.join(configDir, 'commands', 'do', 'next.md'), 'utf8');
      assert.ok(command.includes(`${shellQuote(configDir)}/lib`));
      assert.ok(!command.includes('~/.claude/lib/'));
      assertInstalledDocsUseCustomRoot(configDir);
      assertRegisteredCommandsRun(configDir, env);

      // The hook deliberately exits when no installed-version marker exists.
      // Seed it here so this test can focus on the shared config-root handoff.
      fs.writeFileSync(path.join(configDir, '.slashdo-version'), '1.0.0\n');
      const fakeBin = path.join(home, 'bin');
      fs.mkdirSync(fakeBin);
      const fakeNpm = path.join(fakeBin, 'npm');
      fs.writeFileSync(fakeNpm, '#!/bin/sh\necho 99.0.0\n');
      fs.chmodSync(fakeNpm, 0o755);
      const hook = path.join(configDir, 'hooks', 'slashdo-check-update.js');
      const hookRun = spawnSync(process.execPath, [hook], {
        encoding: 'utf8',
        env: { ...env, PATH: fakeBin },
        timeout: 10000,
      });
      assert.equal(hookRun.status, 0, hookRun.stderr);
      const cacheFile = path.join(configDir, 'cache', 'slashdo-update-check.json');
      const cache = waitForJson(cacheFile);

      const statusline = path.join(configDir, 'hooks', 'slashdo-statusline.js');
      const rendered = spawnSync(process.execPath, [statusline], {
        encoding: 'utf8',
        input: JSON.stringify({
          model: { display_name: 'Opus' },
          workspace: { current_dir: repoRoot },
        }),
        env,
        timeout: 5000,
      });
      assert.equal(rendered.status, 0, rendered.stderr);
      if (cache.notice) {
        assert.ok(rendered.stdout.includes(cache.notice));
      } else {
        assert.equal(cache.update_available, true);
        assert.match(rendered.stdout, /⬆ \/do:update/);
      }

      const uninstalled = spawnSync('bash', [path.join(repoRoot, 'uninstall.sh')], {
        cwd: repoRoot,
        encoding: 'utf8',
        env,
        timeout: 20000,
      });
      assert.equal(uninstalled.status, 0, uninstalled.stderr || uninstalled.stdout);
      assert.equal(fs.existsSync(path.join(configDir, 'commands', 'do', 'next.md')), false);
      assert.equal(fs.existsSync(path.join(configDir, 'hooks', 'slashdo-check-update.js')), false);
      const cleanedSettings = JSON.parse(fs.readFileSync(path.join(configDir, 'settings.json'), 'utf8'));
      assert.equal(cleanedSettings.hooks, undefined);
      assert.equal(cleanedSettings.statusLine, undefined);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('rewrites and quotes the custom root through the npm installer', { timeout: 30000 }, () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'slashdo-custom-home-'));
    const configDir = path.join(home, "claude's profile");
    const env = { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: configDir };

    try {
      fs.mkdirSync(configDir);
      const installed = spawnSync(process.execPath, [path.join(repoRoot, 'bin', 'cli.js'),
        '--env', 'claude', '--no-auto-update'], {
        cwd: repoRoot,
        encoding: 'utf8',
        env,
        timeout: 20000,
      });
      assert.equal(installed.status, 0, installed.stderr || installed.stdout);
      assertInstalledDocsUseCustomRoot(configDir, { completePaths: true });
      assertRegisteredCommandsRun(configDir, env);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
