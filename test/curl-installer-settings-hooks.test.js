'use strict';

// Guard against install.sh / uninstall.sh re-growing their own copy of the
// settings.json hook-registration algorithm.
//
// Both scripts used to inline a hand-translated `node -e` reimplementation of
// src/installer.js's registerHooksInSettings/deregisterHooksFromSettings, and
// the copies drifted: a malformed `settings.hooks` was clobbered instead of
// skipped, and the four distinct statusline outcomes collapsed into one flat
// message (issue #166). They now fetch src/settings-hooks.js and call it, so
// there is exactly one implementation. This test keeps it that way.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SHARED_MODULE = 'src/settings-hooks.js';

function readScript(name) {
  return fs.readFileSync(path.join(REPO_ROOT, name), 'utf8');
}

describe('curl installer shares src/settings-hooks.js', () => {
  for (const [script, exported] of [
    ['install.sh', 'registerHooksInSettings'],
    ['uninstall.sh', 'deregisterHooksFromSettings'],
  ]) {
    it(`${script} fetches the shared module and calls ${exported}()`, () => {
      const content = readScript(script);
      assert.ok(content.includes(`fetch_file "${SHARED_MODULE}"`),
        `${script} must fetch ${SHARED_MODULE} rather than reimplementing it`);
      assert.ok(content.includes(`{ ${exported} } = require(process.argv[1])`),
        `${script} must call ${exported}() from the fetched module`);
    });

    it(`${script} does not reimplement the settings.json mutation`, () => {
      const content = readScript(script);
      // Markers of a hand-rolled copy: mutating the SessionStart array or the
      // statusLine object directly from shell-embedded JS.
      for (const marker of ['settings.hooks.SessionStart', 'settings.statusLine =']) {
        assert.ok(!content.includes(marker),
          `${script} contains "${marker}" — settings.json mutation belongs in ${SHARED_MODULE}, ` +
          `not in a second shell-embedded copy that can drift from it`);
      }
    });
  }

  it('the shared module stays dependency-free so the curl path can fetch it alone', () => {
    // install.sh/uninstall.sh fetch exactly one file; a require() of another
    // repo module would resolve to a missing path at install time.
    const content = fs.readFileSync(path.join(REPO_ROOT, SHARED_MODULE), 'utf8');
    const requires = [...content.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((m) => m[1]);
    assert.deepEqual(requires.filter((r) => r.startsWith('.')), [],
      `${SHARED_MODULE} must not require() sibling modules — the curl installer fetches it on its own`);
  });

  it('src/installer.js uses the shared module instead of its own copy', () => {
    const content = fs.readFileSync(path.join(REPO_ROOT, 'src/installer.js'), 'utf8');
    assert.ok(content.includes("require('./settings-hooks')"),
      'src/installer.js must require ./settings-hooks so npm and curl share one implementation');
    assert.ok(!content.includes('function registerHooksInSettings'),
      'src/installer.js must not redefine registerHooksInSettings');
  });
});
