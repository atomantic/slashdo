'use strict';

// Exercises hooks/slashdo-check-update.js — the auto-update/version-check logic
// that actually runs in production. It used to be an inline `-e` string no test
// could reach; runUpdateCheck() now takes fs/execSync/execFileSync/clock as
// dependencies, so every branch below is driven directly against a temp home
// directory.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const {
  LOCK_STALE_MS,
  NOTICE_REPEAT_S,
  NPM_VIEW_COMMAND,
  NOTICES,
  NPM_VIEW_ARGS,
  buildInstallArgs,
  probeCommand,
  resolvePaths,
  compareVersions,
  isInstallableVersion,
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
    assert.equal(paths.versionFile, path.join('/home/someone', '.claude', '.slashdo-version'));
    assert.equal(paths.configFile, path.join('/home/someone', '.claude', '.slashdo-config.json'));
    assert.equal(paths.lockFile, path.join(paths.cacheDir, 'slashdo-update.lock'));
  });

  it('puts everything under CLAUDE_CONFIG_DIR when one is set', () => {
    const paths = resolvePaths('/home/someone', '/elsewhere/claude');

    assert.equal(paths.cacheFile, path.join('/elsewhere/claude', 'cache', 'slashdo-update-check.json'));
    assert.equal(paths.versionFile, path.join('/elsewhere/claude', '.slashdo-version'));
    assert.equal(paths.configFile, path.join('/elsewhere/claude', '.slashdo-config.json'));
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

describe('check-update isInstallableVersion', () => {
  it('accepts exact semver values from the registry', () => {
    assert.equal(isInstallableVersion('1.2.3'), true);
    assert.equal(isInstallableVersion('1.2.3-beta.1'), true);
    assert.equal(isInstallableVersion('1.2.3+build.7'), true);
  });

  it('rejects values that are not a single package version', () => {
    assert.equal(isInstallableVersion('1.2'), false);
    assert.equal(isInstallableVersion('1.2.3\n2.0.0'), false);
    assert.equal(isInstallableVersion('1.2.3 && touch compromised'), false);
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

  // PATH probes still use execSync, while npm/npx receive argv through
  // execFileSync so registry output can never become shell syntax.
  function makeExec({ latest, onInstall, npmViewThrows, missing = [] } = {}) {
    const execSync = (command, options) => {
      calls.push(command);
      options_.push({ command, options });
      for (const cmd of ['npm', 'npx']) {
        if (command === probeCommand(cmd) || command === probeCommand(cmd, 'win32')) {
          if (missing.includes(cmd)) throw new Error('not found');
          return '';
        }
      }
      throw new Error('unexpected shell command: ' + command);
    };

    const execFileSync = (command, args, options) => {
      const invocation = [command, ...args].join(' ');
      calls.push(invocation);
      options_.push({ command: invocation, args, options });
      const windowsShell = args[0] === '/d' && args[1] === '/s' && args[2] === '/c';
      const commandLine = windowsShell ? args[3].split(' ') : null;
      const invokedCommand = windowsShell ? commandLine[0] : command;
      const invokedArgs = windowsShell ? commandLine.slice(1) : args;
      if (invokedCommand === 'npm' && JSON.stringify(invokedArgs) === JSON.stringify(NPM_VIEW_ARGS)) {
        if (npmViewThrows) throw new Error('offline');
        return latest + '\n';
      }
      if (invokedCommand === 'npx' && JSON.stringify(invokedArgs) === JSON.stringify(buildInstallArgs(latest))) {
        if (onInstall) return onInstall();
        fs.writeFileSync(paths.versionFile, latest + '\n', 'utf8');
        return '';
      }
      throw new Error('unexpected file command: ' + invocation);
    };

    return { execSync, execFileSync };
  }

  // The probes run before every real command; assertions below care about the
  // commands that do work, so filter the noise out.
  function realCalls() {
    const probes = ['npm', 'npx'].flatMap((cmd) => [probeCommand(cmd), probeCommand(cmd, 'win32')]);
    return calls.filter((c) => !probes.includes(c));
  }

  function run(execDeps, options = {}) {
    return runUpdateCheck({
      fs,
      ...execDeps,
      paths,
      now: () => NOW,
      pid: 4242,
      ...options,
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

  it('resolves an exact version and runs npm/npx through argument-safe calls', () => {
    // Asserted as LITERALS, not via the imported constants: comparing the module
    // against itself would let '--env claude' (which keeps the non-TTY install
    // out of the interactive multi-env prompt) or '--yes' be dropped silently.
    writeInstalled('1.9.0');
    writeConfig({ autoUpdate: true });

    run(makeExec({ latest: '1.10.0' }));

    assert.deepEqual(realCalls(), [
      'npm view slash-do version',
      'npx --yes --ignore-scripts slash-do@1.10.0 --env claude',
    ]);
    const optionsFor = (command) => options_.find((c) => c.command === command).options;
    assert.equal(optionsFor(NPM_VIEW_COMMAND).timeout, 5000, 'npm view must not hang session start');
    assert.equal(optionsFor(NPM_VIEW_COMMAND).encoding, 'utf8');
    assert.equal(optionsFor('npx --yes --ignore-scripts slash-do@1.10.0 --env claude').timeout, 120000,
      'an unbounded install would hold the lock past LOCK_STALE_MS');
    assert.equal(optionsFor('npx --yes --ignore-scripts slash-do@1.10.0 --env claude').stdio, 'ignore');
    assert.deepEqual(options_.find((c) => c.command ===
      'npx --yes --ignore-scripts slash-do@1.10.0 --env claude').args,
    ['--yes', '--ignore-scripts', 'slash-do@1.10.0', '--env', 'claude']);
    assert.equal(optionsFor(probeCommand('npm')).timeout, 5000, 'even the PATH probe is bounded');
    assert.ok(options_.every((c) => c.options.windowsHide === true));
  });

  it('uses cmd.exe for npm shims on Windows without changing the package arguments', () => {
    writeInstalled('1.9.0');
    writeConfig({ autoUpdate: true });

    const result = run(makeExec({ latest: '1.10.0' }), {
      platform: 'win32',
      windowsShell: 'cmd.exe',
    });

    assert.equal(result.autoUpdated, true);
    assert.deepEqual(realCalls(), [
      'cmd.exe /d /s /c npm view slash-do version',
      'cmd.exe /d /s /c npx --yes --ignore-scripts slash-do@1.10.0 --env claude',
    ]);
    assert.deepEqual(options_.filter((entry) => entry.command.startsWith('cmd.exe ')).map((entry) => entry.args), [
      ['/d', '/s', '/c', 'npm view slash-do version'],
      ['/d', '/s', '/c', 'npx --yes --ignore-scripts slash-do@1.10.0 --env claude'],
    ]);
  });

  it('short-circuits when slashdo is not installed', () => {
    const result = run(makeExec({ latest: '2.0.0' }));

    assert.equal(result.status, 'not-installed');
    assert.deepEqual(realCalls(), [], 'must not hit the network when nothing is installed');
    assert.equal(fs.existsSync(paths.cacheFile), false, 'must not write a cache file');
  });

  it('writes update_available:true when a newer version exists and auto-update is off', () => {
    writeInstalled('1.9.0');

    const result = run(makeExec({ latest: '1.10.0' }));

    assert.equal(result.status, 'written');
    assert.deepEqual(realCalls(), [NPM_VIEW_COMMAND], 'must not install when auto-update is off');
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

    run(makeExec({ latest: '1.10.0' }));

    assert.equal(readCache().update_available, false);
  });

  it('treats an explicit autoUpdate:false config as off', () => {
    writeInstalled('1.0.0');
    writeConfig({ autoUpdate: false });

    run(makeExec({ latest: '2.0.0' }));

    assert.deepEqual(realCalls(), [NPM_VIEW_COMMAND]);
    assert.equal(readCache().update_available, true);
  });

  it('records latest:unknown and lookup-failed when the npm lookup fails', () => {
    writeInstalled('1.0.0');

    run(makeExec({ npmViewThrows: true }));

    assert.deepEqual(readCache(), {
      update_available: false,
      command: '/do:update',
      installed: '1.0.0',
      latest: 'unknown',
      checked: Math.floor(NOW / 1000),
      // Offline is transient, so it is recorded but carries no user-facing notice.
      update_check: 'lookup-failed',
    });
  });

  it('reports npm-unavailable rather than a bare no-update result', () => {
    writeInstalled('1.0.0');

    run(makeExec({ latest: '2.0.0', missing: ['npm'] }));

    assert.deepEqual(realCalls(), [], 'no npm on PATH means nothing to shell out to');
    const cache = readCache();
    assert.equal(cache.update_check, 'npm-unavailable');
    assert.equal(cache.update_available, false);
    assert.equal(cache.notice, NOTICES['npm-unavailable']);
    assert.equal(cache.notice_at, Math.floor(NOW / 1000));
  });

  it('suppresses the badge and keeps warning when npx is missing', () => {
    writeInstalled('1.0.0');

    run(makeExec({ latest: '2.0.0', missing: ['npx'] }));

    const cache = readCache();
    assert.equal(cache.update_check, 'npx-unavailable');
    assert.equal(cache.latest, '2.0.0', 'the newer version is still recorded');
    // /do:update wraps npx too, so the badge would be a second dead end.
    assert.equal(cache.update_available, false);
    assert.equal(cache.notice, NOTICES['npx-unavailable']);
  });

  it('does not probe for npx when there is nothing to install', () => {
    writeInstalled('2.0.0');

    run(makeExec({ latest: '2.0.0' }));

    assert.ok(!calls.includes(probeCommand('npx')), 'no update means no reason to probe npx');
    assert.equal(readCache().update_check, undefined);
  });

  it('holds the npm-unavailable notice inside the repeat window, then warns again', () => {
    writeInstalled('1.0.0');
    const nowS = Math.floor(NOW / 1000);
    const runAt = (ms) => runUpdateCheck({
      fs,
      ...makeExec({ latest: '2.0.0', missing: ['npm'] }),
      paths,
      now: () => ms,
      pid: 4242,
    });

    runAt(NOW);
    assert.equal(readCache().notice, NOTICES['npm-unavailable']);

    runAt(NOW + 1000);
    assert.equal(readCache().notice, undefined, 'already warned this window');
    assert.equal(readCache().notice_at, nowS, 'and the window carries forward');

    runAt(NOW + (NOTICE_REPEAT_S + 1) * 1000);
    assert.equal(readCache().notice, NOTICES['npm-unavailable'], 'the window expires');
  });

  it('ignores a corrupt config file instead of throwing', () => {
    writeInstalled('1.0.0');
    fs.writeFileSync(paths.configFile, '{not json', 'utf8');

    run(makeExec({ latest: '2.0.0' }));

    assert.deepEqual(realCalls(), [NPM_VIEW_COMMAND], 'corrupt config must read as auto-update off');
    assert.equal(readCache().update_available, true);
  });

  // ── auto-update path ──────────────────────────────────────────────

  it('installs via npx, clears the flag, and releases the lock when auto-update is on', () => {
    writeInstalled('1.9.0');
    writeConfig({ autoUpdate: true });

    const result = run(makeExec({ latest: '1.10.0' }));

    assert.deepEqual(realCalls(), [
      NPM_VIEW_COMMAND,
      'npx --yes --ignore-scripts slash-do@1.10.0 --env claude',
    ]);
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

    const result = run(makeExec({
      latest: '1.10.0',
      onInstall: () => { throw new Error('npx exploded'); },
    }));

    assert.equal(result.autoUpdated, false);
    assert.equal(readCache().update_available, true, 'failed install must fall back to the hint');
    assert.equal(readCache().installed, '1.9.0');
    assert.equal(fs.existsSync(paths.lockFile), false, 'lock must be released even on failure');
  });

  it('surfaces the hint when the command exits successfully without installing the target version', () => {
    writeInstalled('1.9.0');
    writeConfig({ autoUpdate: true });

    const result = run(makeExec({ latest: '1.10.0', onInstall: () => '' }));

    assert.equal(result.autoUpdated, false);
    assert.equal(readCache().update_available, true, 'a stale install must not clear the update hint');
    assert.equal(readCache().installed, '1.9.0');
    assert.equal(fs.existsSync(paths.lockFile), false, 'lock must be released after verification failure');
  });

  it('does not execute a malformed registry version', () => {
    writeInstalled('1.9.0');
    writeConfig({ autoUpdate: true });

    const result = run(makeExec({ latest: '1.10.0 && touch compromised' }));

    assert.equal(result.autoUpdated, false);
    assert.deepEqual(realCalls(), [NPM_VIEW_COMMAND]);
    assert.ok(!calls.some((call) => call.startsWith('npx ')), 'malformed metadata must not reach npx');
    assert.equal(result.result.update_check, 'invalid-version');
    assert.equal(result.result.update_available, false);
    assert.match(result.result.notice, /invalid version/);
  });

  it('defers to a fresh lock without installing or writing the cache', () => {
    writeInstalled('1.9.0');
    writeConfig({ autoUpdate: true });
    fs.writeFileSync(paths.lockFile, '999', 'utf8');

    const result = run(makeExec({ latest: '1.10.0' }));

    assert.equal(result.status, 'deferred');
    assert.deepEqual(realCalls(), [NPM_VIEW_COMMAND], 'the lock holder installs, not us');
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

    const result = run(makeExec({ latest: '1.10.0' }));

    assert.equal(result.status, 'written');
    assert.deepEqual(realCalls(), [
      NPM_VIEW_COMMAND,
      'npx --yes --ignore-scripts slash-do@1.10.0 --env claude',
    ]);
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
      ...makeExec({ latest: '1.10.0' }),
      paths,
      now: () => NOW,
      pid: 4242,
    });

    assert.equal(result.status, 'written');
    assert.deepEqual(realCalls(), [NPM_VIEW_COMMAND], 'no lock means no install');
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
      ...makeExec({ latest: '1.10.0' }),
      paths,
      now: () => NOW,
      pid: 4242,
    });

    assert.deepEqual(realCalls(), [NPM_VIEW_COMMAND], 'the reclaim winner installs, not us');
    assert.equal(result.status, 'deferred');
    assert.equal(fs.existsSync(paths.cacheFile), false);
  });

  it('writes the cache when the reclaim frees the lock but cannot retake it', () => {
    // renameSync won, so the stale lock is gone and nobody is installing. If the
    // rest of the reclaim then fails, deferring would leave this cycle with no
    // cache write at all — there is no holder left to write the real answer.
    writeInstalled('1.9.0');
    writeConfig({ autoUpdate: true });
    fs.writeFileSync(paths.lockFile, '999', 'utf8');
    const stale = new Date(NOW - LOCK_STALE_MS - 60000);
    fs.utimesSync(paths.lockFile, stale, stale);
    const brokenUnlinkFs = {
      ...fs,
      unlinkSync: () => {
        const err = new Error('EPERM');
        err.code = 'EPERM';
        throw err;
      },
    };

    const result = runUpdateCheck({
      fs: brokenUnlinkFs,
      ...makeExec({ latest: '1.10.0' }),
      paths,
      now: () => NOW,
      pid: 4242,
    });

    assert.equal(result.status, 'written');
    assert.deepEqual(realCalls(), [NPM_VIEW_COMMAND], 'we never took the lock, so we must not install');
    assert.equal(readCache().update_available, true);
  });

  it('defers when a new session takes the freed slot before we can retake it', () => {
    // Mirror of the case above: the reclaim frees the lock, but another session
    // creates a fresh one in the gap. That session installs and writes the real
    // cache, so we must defer to it rather than clobber its result.
    writeInstalled('1.9.0');
    writeConfig({ autoUpdate: true });
    fs.writeFileSync(paths.lockFile, '999', 'utf8');
    const stale = new Date(NOW - LOCK_STALE_MS - 60000);
    fs.utimesSync(paths.lockFile, stale, stale);
    let opens = 0;
    const racedFs = {
      ...fs,
      openSync: (file, flags) => {
        if (file === paths.lockFile) {
          opens++;
          const err = new Error('EEXIST'); // first: the stale lock; second: the new one
          err.code = 'EEXIST';
          throw err;
        }
        return fs.openSync(file, flags);
      },
    };

    const result = runUpdateCheck({
      fs: racedFs,
      ...makeExec({ latest: '1.10.0' }),
      paths,
      now: () => NOW,
      pid: 4242,
    });

    assert.equal(opens, 2, 'the reclaim must have retried the acquire');
    assert.equal(result.status, 'deferred');
    assert.deepEqual(realCalls(), [NPM_VIEW_COMMAND], 'the new lock holder installs, not us');
    assert.equal(fs.existsSync(paths.cacheFile), false);
  });

  it('does not touch the lock at all when auto-update is off', () => {
    writeInstalled('1.9.0');

    run(makeExec({ latest: '1.10.0' }));

    assert.equal(fs.existsSync(paths.lockFile), false);
  });

  it('does not lock or install when auto-update is on but no update exists', () => {
    writeInstalled('1.10.0');
    writeConfig({ autoUpdate: true });

    run(makeExec({ latest: '1.10.0' }));

    assert.deepEqual(realCalls(), [NPM_VIEW_COMMAND]);
    assert.equal(fs.existsSync(paths.lockFile), false);
  });
});

// ── worker wiring ───────────────────────────────────────────────────
//
// The unit tests above inject dependencies; these run the hook file itself so a
// broken real-fs/real-home wiring can't pass. `npm` is stubbed on PATH so the
// check stays hermetic (no network, no npx install).

// How long the slow `npm view` stub sleeps, used to observe that the parent does
// not wait for its worker. Must stay under the hook's own 5s npm view timeout,
// or the worker gives up on the stub and records latest:'unknown'.
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
    assert.equal(JSON.parse(fs.readFileSync(paths.cacheFile, 'utf8')).latest, '9.9.9');
    assert.equal(JSON.parse(fs.readFileSync(paths.cacheFile, 'utf8')).update_available, true);
  });

  it('spawns the worker from the SessionStart entrypoint, creating the cache dir', async () => {
    // No --worker: this is the argv the installed SessionStart hook actually
    // runs. It must return immediately and leave a detached child that does the
    // work, so poll for the cache file the child writes.
    fs.rmSync(paths.cacheDir, { recursive: true });
    fs.writeFileSync(paths.versionFile, '1.9.0\n', 'utf8');
    writeNpmStub('sleep ' + SLOW_NPM_MS / 1000 + '\n');

    const proc = runHook([]);
    assert.equal(proc.status, 0, proc.stderr);
    // The npm stub sleeps SLOW_NPM_MS, so the worker cannot have finished yet —
    // unless the parent waited for it, which is exactly what detached + unref()
    // exist to prevent. Asserting the ordering rather than an elapsed-time bound
    // keeps this from flaking on a loaded CI runner.
    assert.equal(fs.existsSync(paths.cacheFile), false,
      'SessionStart blocked until its worker had already written the cache');

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

// ── spawn-level: no npm / no npx on PATH ────────────────────────────
//
// The curl installer (install.sh) is npm-free, so this hook has to run on
// machines where npm/npx are simply not on PATH. These tests drive the real
// hook with a PATH that resolves nothing, which is how that user machine looks.

// Synchronous sleep — these tests wait on a detached background child, and the
// node:test callbacks here are sync.
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const hook = HOOK_PATH;

function makeHome(installedVersion) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'slashdo-check-update-'));
  fs.mkdirSync(path.join(home, '.claude', 'cache'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', '.slashdo-version'), `${installedVersion}\n`, 'utf8');
  return home;
}

function cacheFileFor(home) {
  return path.join(home, '.claude', 'cache', 'slashdo-update-check.json');
}

// A stub npm that reports a newer version, so the hook sees a real pending update.
function makeFakeNpmBin() {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slashdo-fake-npm-'));
  const fakeNpm = path.join(binDir, 'npm');
  fs.writeFileSync(fakeNpm, '#!/bin/sh\necho 99.0.0\n', 'utf8');
  fs.chmodSync(fakeNpm, 0o755);
  return binDir;
}

function readCacheRaw(home) {
  try {
    return fs.readFileSync(cacheFileFor(home), 'utf8');
  } catch (e) {
    return null;
  }
}

// The hook spawns a detached background child, so the cache lands after the
// parent exits. Poll for it rather than guessing at a sleep duration.
function runHookAndReadCache(home, { pathValue, settleMs = 3000 } = {}) {
  const before = readCacheRaw(home);
  const result = spawnSync(process.execPath, [hook], {
    encoding: 'utf8',
    timeout: 10000,
    // Default PATH resolves nothing: no npm, no npx. node is spawned by absolute path.
    env: { HOME: home, USERPROFILE: home, PATH: pathValue || path.join(home, 'no-such-bin') },
  });
  assert.equal(result.status, 0, 'hook must never fail the session start');

  const deadline = Date.now() + 8000;
  const settleUntil = Date.now() + settleMs;
  while (Date.now() < deadline) {
    const now = readCacheRaw(home);
    // A changed body proves the child ran. An unchanged one is also a legitimate
    // outcome (a re-run can write the same bytes), so accept it once the child has
    // had time to finish rather than polling mtime, whose filesystem granularity
    // could hide the second write entirely.
    if (now !== null && (now !== before || Date.now() >= settleUntil)) {
      try {
        return JSON.parse(now);
      } catch (e) {} // mid-write, try again
    }
    sleep(25);
  }
  throw new Error('background update check never wrote the cache file');
}

describe('slashdo update check without npm', () => {
  it('records npm-unavailable instead of a bare "no update" result', () => {
    const home = makeHome('1.0.0');

    try {
      const cache = runHookAndReadCache(home);

      assert.equal(cache.update_check, 'npm-unavailable');
      assert.equal(cache.update_available, false);
      assert.equal(cache.latest, 'unknown');
      assert.equal(cache.installed, '1.0.0');
      assert.match(cache.notice, /npm/);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('does not repeat the notice on the next session', () => {
    const home = makeHome('1.0.0');

    try {
      const first = runHookAndReadCache(home);
      assert.ok(first.notice, 'first run should warn');
      assert.ok(first.notice_at > 0, 'first run should stamp when it warned');

      const second = runHookAndReadCache(home);
      assert.equal(second.update_check, 'npm-unavailable', 'state stays readable for /do:help');
      assert.equal(second.notice, undefined, 'already warned — no per-session statusline nag');
      assert.equal(second.notice_at, first.notice_at, 'suppression window carries forward');
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('warns again once the suppression window has passed', () => {
    // A notice can be written and never rendered (custom statusline, or a second
    // session rewrites the cache first), so suppression has to expire.
    const home = makeHome('1.0.0');

    try {
      const first = runHookAndReadCache(home);
      const stale = { ...first, notice_at: first.notice_at - 8 * 24 * 60 * 60 };
      delete stale.notice;
      fs.writeFileSync(cacheFileFor(home), JSON.stringify(stale));

      const again = runHookAndReadCache(home);
      assert.match(again.notice, /npm/, 'a week-old notice should fire again');
      assert.ok(again.notice_at > stale.notice_at, 'and re-stamp the window');
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('flags npx-unavailable when an update exists but npx is missing', { skip: process.platform === 'win32' }, () => {
    // Auto-update is OFF here: the ⬆ /do:update hint the user would otherwise be
    // shown also runs npx, so the missing shim has to be reported on this path too.
    const home = makeHome('1.0.0');
    const binDir = makeFakeNpmBin();

    try {
      const cache = runHookAndReadCache(home, { pathValue: binDir });

      assert.equal(cache.update_check, 'npx-unavailable');
      assert.equal(cache.latest, '99.0.0', 'the newer version is still recorded');
      assert.match(cache.notice, /npx/);
      // No ⬆ badge: /do:update wraps npx, so it would be a second dead end.
      assert.equal(cache.update_available, false);

      // With the badge suppressed, the notice is the only signal left — it has to
      // survive into later sessions instead of being rate-limited into silence.
      const next = runHookAndReadCache(home, { pathValue: binDir });
      assert.match(next.notice, /npx/, 'a pending, unappliable update keeps warning');
    } finally {
      fs.rmSync(binDir, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('warns again when the reason changes, without waiting out the window', { skip: process.platform === 'win32' }, () => {
    const home = makeHome('1.0.0');
    const binDir = makeFakeNpmBin();

    try {
      const withNpm = runHookAndReadCache(home, { pathValue: binDir });
      assert.equal(withNpm.notice_state, 'npx-unavailable');

      // npm disappears too: a different, newly-true message the user has not seen.
      const withoutNpm = runHookAndReadCache(home);
      assert.equal(withoutNpm.update_check, 'npm-unavailable');
      assert.match(withoutNpm.notice, /npm/, 'a new reason is not swallowed by the window');
    } finally {
      fs.rmSync(binDir, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('stays silent when slashdo is not installed', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'slashdo-check-update-none-'));
    fs.mkdirSync(path.join(home, '.claude', 'cache'), { recursive: true });

    try {
      const result = spawnSync(process.execPath, [hook], {
        encoding: 'utf8',
        timeout: 10000,
        env: { HOME: home, USERPROFILE: home, PATH: path.join(home, 'no-such-bin') },
      });

      assert.equal(result.status, 0);
      sleep(500);
      assert.ok(!fs.existsSync(cacheFileFor(home)), 'no version file means no cache write');
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
