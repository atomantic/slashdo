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
