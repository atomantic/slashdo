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

// ── paths ───────────────────────────────────────────────────────────

describe('check-update resolvePaths', () => {
  it('writes a cache file the statusline will actually pick up', () => {
    // hooks/slashdo-statusline.js only reads cache entries ending in
    // '-update-check.json'; renaming this file silently kills the ⬆ badge.
    const paths = resolvePaths('/home/someone');

    assert.equal(paths.cacheFile,
      path.join('/home/someone', '.claude', 'cache', 'slashdo-update-check.json'));
    assert.ok(paths.cacheFile.endsWith('-update-check.json'));
    assert.equal(paths.versionFile, path.join('/home/someone', '.claude', '.slashdo-version'));
    assert.equal(paths.configFile, path.join('/home/someone', '.claude', '.slashdo-config.json'));
    assert.equal(paths.lockFile, path.join(paths.cacheDir, 'slashdo-update.lock'));
  });
});

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

  it('returns null for a short version instead of comparing against a missing segment', () => {
    assert.equal(compareVersions('1.0', '1.0.1'), null);
    assert.equal(compareVersions('1.0.1', '1.0'), null);
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

  it('still flags an update when the installed version is short or empty', () => {
    // compareVersions cannot rank these, so the hint must win over silence —
    // otherwise a truncated .slashdo-version would pin the user forever.
    assert.equal(isUpdateAvailable('1.0', '1.0.1'), true);
    assert.equal(isUpdateAvailable('', '1.0.0'), true);
  });
});

// ── runUpdateCheck ──────────────────────────────────────────────────

describe('runUpdateCheck', () => {
  let tmpDir;
  let paths;
  let calls;
  let options_;

  const NOW = 1750000000000;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slashdo-check-update-'));
    paths = resolvePaths(tmpDir);
    fs.mkdirSync(paths.cacheDir, { recursive: true });
    calls = [];
    options_ = [];
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // execSync stub: `npm view` answers with `latest`, the install command runs
  // `onInstall` (default: succeed and bump the version file, as the real
  // installer does).
  function makeExecSync({ latest, onInstall, npmViewThrows } = {}) {
    return (command, options) => {
      calls.push(command);
      options_.push({ command, options });
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

  it('runs the exact npm and npx commands, each with a bounded timeout', () => {
    // Asserted as LITERALS, not via the imported constants: comparing the module
    // against itself would let '--env claude' (which keeps the non-TTY install
    // out of the interactive multi-env prompt) or '-y' be dropped silently.
    writeInstalled('1.9.0');
    writeConfig({ autoUpdate: true });

    run(makeExecSync({ latest: '1.10.0' }));

    assert.deepEqual(calls, [
      'npm view slash-do version',
      'npx -y slash-do@latest --env claude',
    ]);
    assert.equal(options_[0].options.timeout, 5000, 'npm view must not hang session start');
    assert.equal(options_[0].options.encoding, 'utf8');
    assert.equal(options_[1].options.timeout, 120000,
      'an unbounded install would hold the lock past LOCK_STALE_MS');
    assert.equal(options_[1].options.stdio, 'ignore');
    assert.ok(options_.every((c) => c.options.windowsHide === true));
  });

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

  it('still writes the cache when the lock cannot be created at all', () => {
    // EACCES/EROFS is not EEXIST: there is no other session holding the lock and
    // therefore nobody who will write the authoritative result. Deferring here
    // would hide the update hint for good.
    writeInstalled('1.9.0');
    writeConfig({ autoUpdate: true });
    const readOnlyFs = {
      ...fs,
      openSync: (file, flags) => {
        if (file === paths.lockFile) {
          const err = new Error('EACCES');
          err.code = 'EACCES';
          throw err;
        }
        return fs.openSync(file, flags);
      },
    };

    const result = runUpdateCheck({
      fs: readOnlyFs,
      execSync: makeExecSync({ latest: '1.10.0' }),
      paths,
      now: () => NOW,
      pid: 4242,
    });

    assert.equal(result.status, 'written');
    assert.deepEqual(calls, [NPM_VIEW_COMMAND], 'no lock means no install');
    assert.equal(readCache().update_available, true, 'the hint must still reach the statusline');
  });

  it('does not install when it loses the race to reclaim a stale lock', () => {
    // Two sessions both see the same stale lock. The rename is what picks a
    // single winner — the loser's renameSync throws ENOENT and it must NOT go on
    // to install. A plain unlink-then-recreate would let both through.
    writeInstalled('1.9.0');
    writeConfig({ autoUpdate: true });
    fs.writeFileSync(paths.lockFile, '999', 'utf8');
    const stale = new Date(NOW - LOCK_STALE_MS - 60000);
    fs.utimesSync(paths.lockFile, stale, stale);
    const losingFs = {
      ...fs,
      renameSync: () => {
        const err = new Error('ENOENT'); // the other reclaimer renamed it first
        err.code = 'ENOENT';
        throw err;
      },
    };

    const result = runUpdateCheck({
      fs: losingFs,
      execSync: makeExecSync({ latest: '1.10.0' }),
      paths,
      now: () => NOW,
      pid: 4242,
    });

    assert.deepEqual(calls, [NPM_VIEW_COMMAND], 'the reclaim winner installs, not us');
    assert.equal(result.status, 'deferred');
    assert.equal(fs.existsSync(paths.cacheFile), false);
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

// How long the slow `npm view` stub sleeps. A parent that returns sooner
// provably did not wait for its worker.
const SLOW_NPM_MS = 2000;

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
    writeNpmStub('');
  });

  // `npm view slash-do version` without the network. `prelude` lets one test make
  // it slow enough to observe that the parent did not wait for it.
  function writeNpmStub(prelude) {
    const npmStub = path.join(binDir, 'npm');
    fs.writeFileSync(npmStub, '#!/bin/sh\n' + prelude + 'echo 9.9.9\n', 'utf8');
    fs.chmodSync(npmStub, 0o755);
  }

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // The SessionStart entrypoint detaches its worker, so the cache file appears
  // after the parent has already exited.
  async function waitForCache(timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        // existsSync goes true as soon as the fd is created, so the payload may
        // not have landed yet — keep polling rather than failing on a short read.
        return JSON.parse(fs.readFileSync(paths.cacheFile, 'utf8'));
      } catch (e) {}
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('worker never wrote ' + paths.cacheFile);
  }

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

  it('spawns the worker from the SessionStart entrypoint, creating the cache dir', async () => {
    // No --worker: this is the argv the installed SessionStart hook actually
    // runs. It must return immediately and leave a detached child that does the
    // work, so poll for the cache file the child writes.
    fs.rmSync(paths.cacheDir, { recursive: true });
    fs.writeFileSync(paths.versionFile, '1.9.0\n', 'utf8');
    writeNpmStub('sleep ' + SLOW_NPM_MS / 1000 + '\n');

    const started = Date.now();
    const proc = runHook([]);
    const parentMs = Date.now() - started;
    assert.equal(proc.status, 0, proc.stderr);
    // The npm stub sleeps SLOW_NPM_MS. If the parent waited on its child at all,
    // it could not have returned this fast — this is the 'never blocks session
    // start' contract that detached + unref() provides.
    assert.ok(parentMs < SLOW_NPM_MS, 'SessionStart returned in ' + parentMs + 'ms');

    const cache = await waitForCache();
    assert.equal(cache.latest, '9.9.9');
    assert.equal(cache.update_available, true);
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
