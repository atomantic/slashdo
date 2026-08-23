'use strict';

// Exercises hooks/slashdo-check-update.js — the auto-update/version-check logic
// that actually runs in production. It used to be an inline `-e` string no test
// could reach; runUpdateCheck() now takes fs/execSync/clock as dependencies, so
// every branch below is driven directly against a temp home directory.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const {
  LOCK_STALE_MS,
  NPM_VIEW_COMMAND,
  INSTALL_COMMAND,
  resolvePaths,
  compareVersions,
  isUpdateAvailable,
  runUpdateCheck,
} = require('../hooks/slashdo-check-update');

const HOOK_PATH = path.resolve(__dirname, '..', 'hooks', 'slashdo-check-update.js');

// ── semver comparison ───────────────────────────────────────────────

describe('check-update compareVersions', () => {
  it('orders 1.9.0 → 1.10.0 as a minor bump, not a downgrade', () => {
    // The case a lexical/string compare gets backwards ('1.9.0' > '1.10.0').
    assert.equal(compareVersions('1.9.0', '1.10.0'), 'minor');
    assert.equal(compareVersions('1.10.0', '1.9.0'), null);
  });

  it('orders double-digit patch segments numerically', () => {
    assert.equal(compareVersions('1.9.2', '1.9.10'), 'patch');
    assert.equal(compareVersions('1.9.10', '1.9.2'), null);
  });

  it('orders double-digit major segments numerically', () => {
    assert.equal(compareVersions('9.0.0', '10.0.0'), 'major');
  });

  it('ignores a prerelease suffix', () => {
    assert.equal(compareVersions('1.0.0', '1.0.0-beta.1'), null);
    assert.equal(compareVersions('1.0.0-beta.1', '1.0.1'), 'patch');
  });

  it('returns null for unparseable versions rather than guessing', () => {
    assert.equal(compareVersions('not-a-version', '1.0.0'), null);
    assert.equal(compareVersions('1.0.0', 'not-a-version'), null);
  });
});

describe('check-update isUpdateAvailable', () => {
  it('flags a newer semver', () => {
    assert.equal(isUpdateAvailable('1.9.0', '1.10.0'), true);
  });

  it('does not flag an equal or older latest', () => {
    assert.equal(isUpdateAvailable('1.10.0', '1.10.0'), false);
    assert.equal(isUpdateAvailable('1.10.0', '1.9.0'), false);
  });

  it('does not flag when the latest lookup failed', () => {
    assert.equal(isUpdateAvailable('1.0.0', null), false);
  });

  it('falls back to inequality when a version is unparseable', () => {
    assert.equal(isUpdateAvailable('nightly', '1.0.0'), true);
    assert.equal(isUpdateAvailable('nightly', 'nightly'), false);
  });
});

// ── runUpdateCheck ──────────────────────────────────────────────────

describe('runUpdateCheck', () => {
  let tmpDir;
  let paths;
  let calls;

  const NOW = 1750000000000;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slashdo-check-update-'));
    paths = resolvePaths(tmpDir);
    fs.mkdirSync(paths.cacheDir, { recursive: true });
    calls = [];
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // execSync stub: `npm view` answers with `latest`, the install command runs
  // `onInstall` (default: succeed and bump the version file, as the real
  // installer does).
  function makeExecSync({ latest, onInstall, npmViewThrows } = {}) {
    return (command) => {
      calls.push(command);
      if (command === NPM_VIEW_COMMAND) {
        if (npmViewThrows) throw new Error('offline');
        return latest + '\n';
      }
      if (command === INSTALL_COMMAND) {
        if (onInstall) return onInstall();
        fs.writeFileSync(paths.versionFile, latest + '\n', 'utf8');
        return '';
      }
      throw new Error('unexpected command: ' + command);
    };
  }

  function run(execSyncStub) {
    return runUpdateCheck({
      fs,
      execSync: execSyncStub,
      paths,
      now: () => NOW,
      pid: 4242,
    });
  }

  function writeInstalled(version) {
    fs.writeFileSync(paths.versionFile, version + '\n', 'utf8');
  }

  function writeConfig(config) {
    fs.writeFileSync(paths.configFile, JSON.stringify(config), 'utf8');
  }

  function readCache() {
    return JSON.parse(fs.readFileSync(paths.cacheFile, 'utf8'));
  }

  it('short-circuits when slashdo is not installed', () => {
    const result = run(makeExecSync({ latest: '2.0.0' }));

    assert.equal(result.status, 'not-installed');
    assert.deepEqual(calls, [], 'must not hit the network when nothing is installed');
    assert.equal(fs.existsSync(paths.cacheFile), false, 'must not write a cache file');
  });

  it('writes update_available:true when a newer version exists and auto-update is off', () => {
    writeInstalled('1.9.0');

    const result = run(makeExecSync({ latest: '1.10.0' }));

    assert.equal(result.status, 'written');
    assert.deepEqual(calls, [NPM_VIEW_COMMAND], 'must not install when auto-update is off');
    assert.deepEqual(readCache(), {
      update_available: true,
      command: '/do:update',
      installed: '1.9.0',
      latest: '1.10.0',
      checked: Math.floor(NOW / 1000),
    });
  });

  it('writes update_available:false when already current', () => {
    writeInstalled('1.10.0');

    run(makeExecSync({ latest: '1.10.0' }));

    assert.equal(readCache().update_available, false);
  });

  it('treats an explicit autoUpdate:false config as off', () => {
    writeInstalled('1.0.0');
    writeConfig({ autoUpdate: false });

    run(makeExecSync({ latest: '2.0.0' }));

    assert.deepEqual(calls, [NPM_VIEW_COMMAND]);
    assert.equal(readCache().update_available, true);
  });

  it('records latest:unknown when the npm lookup fails', () => {
    writeInstalled('1.0.0');

    run(makeExecSync({ npmViewThrows: true }));

    assert.deepEqual(readCache(), {
      update_available: false,
      command: '/do:update',
      installed: '1.0.0',
      latest: 'unknown',
      checked: Math.floor(NOW / 1000),
    });
  });

  it('ignores a corrupt config file instead of throwing', () => {
    writeInstalled('1.0.0');
    fs.writeFileSync(paths.configFile, '{not json', 'utf8');

    run(makeExecSync({ latest: '2.0.0' }));

    assert.deepEqual(calls, [NPM_VIEW_COMMAND], 'corrupt config must read as auto-update off');
    assert.equal(readCache().update_available, true);
  });

  // ── auto-update path ──────────────────────────────────────────────

  it('installs via npx, clears the flag, and releases the lock when auto-update is on', () => {
    writeInstalled('1.9.0');
    writeConfig({ autoUpdate: true });

    const result = run(makeExecSync({ latest: '1.10.0' }));

    assert.deepEqual(calls, [NPM_VIEW_COMMAND, INSTALL_COMMAND]);
    assert.equal(result.autoUpdated, true);
    assert.deepEqual(readCache(), {
      update_available: false,
      command: '/do:update',
      installed: '1.10.0',
      latest: '1.10.0',
      checked: Math.floor(NOW / 1000),
    });
    assert.equal(fs.existsSync(paths.lockFile), false, 'lock must be released');
  });

  it('surfaces the hint and releases the lock when the install fails', () => {
    writeInstalled('1.9.0');
    writeConfig({ autoUpdate: true });

    const result = run(makeExecSync({
      latest: '1.10.0',
      onInstall: () => { throw new Error('npx exploded'); },
    }));

    assert.equal(result.autoUpdated, false);
    assert.equal(readCache().update_available, true, 'failed install must fall back to the hint');
    assert.equal(readCache().installed, '1.9.0');
    assert.equal(fs.existsSync(paths.lockFile), false, 'lock must be released even on failure');
  });

  it('defers to a fresh lock without installing or writing the cache', () => {
    writeInstalled('1.9.0');
    writeConfig({ autoUpdate: true });
    fs.writeFileSync(paths.lockFile, '999', 'utf8');

    const result = run(makeExecSync({ latest: '1.10.0' }));

    assert.equal(result.status, 'deferred');
    assert.deepEqual(calls, [NPM_VIEW_COMMAND], 'the lock holder installs, not us');
    assert.equal(fs.existsSync(paths.cacheFile), false,
      'a deferring session must not clobber the holder\'s result');
    assert.equal(fs.readFileSync(paths.lockFile, 'utf8'), '999',
      'the holder\'s lock must be left alone');
  });

  it('reclaims a stale lock and installs', () => {
    writeInstalled('1.9.0');
    writeConfig({ autoUpdate: true });
    fs.writeFileSync(paths.lockFile, '999', 'utf8');
    const stale = new Date(NOW - LOCK_STALE_MS - 60000);
    fs.utimesSync(paths.lockFile, stale, stale);

    const result = run(makeExecSync({ latest: '1.10.0' }));

    assert.equal(result.status, 'written');
    assert.deepEqual(calls, [NPM_VIEW_COMMAND, INSTALL_COMMAND]);
    assert.equal(readCache().update_available, false);
    assert.equal(fs.existsSync(paths.lockFile), false);
    assert.deepEqual(
      fs.readdirSync(paths.cacheDir).filter((f) => f.includes('.stale.')),
      [],
      'the renamed stale lock must be cleaned up, not left behind');
  });

  it('does not touch the lock at all when auto-update is off', () => {
    writeInstalled('1.9.0');

    run(makeExecSync({ latest: '1.10.0' }));

    assert.equal(fs.existsSync(paths.lockFile), false);
  });

  it('does not lock or install when auto-update is on but no update exists', () => {
    writeInstalled('1.10.0');
    writeConfig({ autoUpdate: true });

    run(makeExecSync({ latest: '1.10.0' }));

    assert.deepEqual(calls, [NPM_VIEW_COMMAND]);
    assert.equal(fs.existsSync(paths.lockFile), false);
  });
});

// ── worker wiring ───────────────────────────────────────────────────
//
// The unit tests above inject dependencies; these run the hook file itself so a
// broken real-fs/real-home wiring can't pass. `npm` is stubbed on PATH so the
// check stays hermetic (no network, no npx install).

describe('check-update worker entrypoint', { skip: process.platform === 'win32' }, () => {
  let tmpDir;
  let paths;
  let binDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slashdo-check-update-e2e-'));
    paths = resolvePaths(tmpDir);
    fs.mkdirSync(paths.cacheDir, { recursive: true });
    binDir = path.join(tmpDir, 'bin');
    fs.mkdirSync(binDir);
    const npmStub = path.join(binDir, 'npm');
    fs.writeFileSync(npmStub, '#!/bin/sh\necho 9.9.9\n', 'utf8');
    fs.chmodSync(npmStub, 0o755);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function runHook(args) {
    return spawnSync(process.execPath, [HOOK_PATH].concat(args), {
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: tmpDir,
        USERPROFILE: tmpDir,
        PATH: binDir + path.delimiter + process.env.PATH,
      },
    });
  }

  it('writes the cache against the real home directory', () => {
    fs.writeFileSync(paths.versionFile, '1.9.0\n', 'utf8');

    const proc = runHook(['--worker']);

    assert.equal(proc.status, 0, proc.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(paths.cacheFile, 'utf8')).latest, '9.9.9');
    assert.equal(JSON.parse(fs.readFileSync(paths.cacheFile, 'utf8')).update_available, true);
  });

  it('exits quietly with no version file', () => {
    const proc = runHook(['--worker']);

    assert.equal(proc.status, 0, proc.stderr);
    assert.equal(fs.existsSync(paths.cacheFile), false);
  });

  it('never breaks SessionStart when the home directory is unwritable', () => {
    // No .claude dir and a home path that cannot be created under.
    const unwritable = path.join(tmpDir, 'nope');
    fs.writeFileSync(unwritable, 'not a directory', 'utf8');

    const proc = spawnSync(process.execPath, [HOOK_PATH], {
      encoding: 'utf8',
      env: { ...process.env, HOME: unwritable, USERPROFILE: unwritable },
    });

    assert.equal(proc.status, 0, proc.stderr);
  });
});
