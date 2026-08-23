'use strict';

// The curl installer (install.sh) is npm-free, so this hook has to run on
// machines where npm/npx are simply not on PATH. These tests drive it with a
// PATH that resolves nothing, which is how that user's machine looks.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Synchronous sleep — these tests wait on a detached background child, and the
// node:test callbacks here are sync.
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const hook = path.resolve(__dirname, '../hooks/slashdo-check-update.js');

function makeHome(installedVersion) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'slashdo-check-update-'));
  fs.mkdirSync(path.join(home, '.claude', 'cache'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', '.slashdo-version'), `${installedVersion}\n`, 'utf8');
  return home;
}

function cacheFileFor(home) {
  return path.join(home, '.claude', 'cache', 'slashdo-update-check.json');
}

// The hook spawns a detached background child, so the cache lands after the
// parent exits. Poll for it rather than guessing at a sleep duration.
function runHookAndReadCache(home, { expectAfter = 0 } = {}) {
  const result = spawnSync(process.execPath, [hook], {
    encoding: 'utf8',
    timeout: 10000,
    // PATH resolves nothing: no npm, no npx. node is spawned by absolute path.
    env: { HOME: home, USERPROFILE: home, PATH: path.join(home, 'no-such-bin') },
  });
  assert.equal(result.status, 0, 'hook must never fail the session start');

  const cacheFile = cacheFileFor(home);
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      const stat = fs.statSync(cacheFile);
      if (stat.mtimeMs > expectAfter) {
        return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      }
    } catch (e) {}
    sleep(25);
  }
  throw new Error('background update check never wrote the cache file');
}

describe('slashdo update check without npm', () => {
  it('records npm-unavailable instead of a bare "no update" result', () => {
    const home = makeHome('1.0.0');

    const cache = runHookAndReadCache(home);

    assert.equal(cache.update_check, 'npm-unavailable');
    assert.equal(cache.update_available, false);
    assert.equal(cache.latest, 'unknown');
    assert.equal(cache.installed, '1.0.0');
    assert.match(cache.notice, /npm/);

    fs.rmSync(home, { recursive: true, force: true });
  });

  it('surfaces the notice once, not on every session', () => {
    const home = makeHome('1.0.0');

    const first = runHookAndReadCache(home);
    assert.ok(first.notice, 'first run should warn');

    const second = runHookAndReadCache(home, { expectAfter: fs.statSync(cacheFileFor(home)).mtimeMs });
    assert.equal(second.update_check, 'npm-unavailable', 'state stays readable for /do:help');
    assert.equal(second.notice, undefined, 'already warned — no permanent statusline nag');

    fs.rmSync(home, { recursive: true, force: true });
  });

  it('stays silent when slashdo is not installed', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'slashdo-check-update-none-'));
    fs.mkdirSync(path.join(home, '.claude', 'cache'), { recursive: true });

    const result = spawnSync(process.execPath, [hook], {
      encoding: 'utf8',
      timeout: 10000,
      env: { HOME: home, USERPROFILE: home, PATH: path.join(home, 'no-such-bin') },
    });

    assert.equal(result.status, 0);
    sleep(500);
    assert.ok(!fs.existsSync(cacheFileFor(home)), 'no version file means no cache write');

    fs.rmSync(home, { recursive: true, force: true });
  });
});
