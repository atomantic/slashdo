'use strict';

// Unit tests for the shared settings.json mutation module.
//
// test/installer.test.js already covers the happy paths through install() /
// install({uninstall:true}) — fresh registration, parse-error skips, dry runs.
// This file owns what those cannot reach and what the hand-translated shell
// copies got wrong (issue #166): malformed input shapes that must be left
// alone rather than clobbered, and the statusline outcomes that must stay
// distinguishable from each other.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { registerHooksInSettings, deregisterHooksFromSettings } = require('../src/settings-hooks');

const HOOK_FILES = [
  { name: 'slashdo-check-update.js' },
  { name: 'slashdo-statusline.js' },
];

function makeEnv(settings) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slashdo-settings-'));
  const settingsFile = path.join(tmpDir, 'settings.json');
  const hooksDir = path.join(tmpDir, 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
  return { settingsFile, hooksDir };
}

function readSettings(env) {
  return JSON.parse(fs.readFileSync(env.settingsFile, 'utf8'));
}

function statusOf(actions, name) {
  return actions.find((a) => a.name === name)?.status;
}

const slashdoStatusline = (env) => `node "${path.join(env.hooksDir, 'slashdo-statusline.js')}"`;

// ── Malformed shapes are skipped, never clobbered ───────────────────

describe('registerHooksInSettings on malformed input', () => {
  for (const [label, hooks] of [['a string', 'some-string'], ['an array', ['nope']]]) {
    it(`leaves settings.hooks untouched when it is ${label}`, () => {
      // The curl installer used to reset a non-object `hooks` to {}, silently
      // discarding whatever the user had there. Skipping is the canonical behavior.
      const env = makeEnv({ hooks, otherSetting: true });
      const actions = registerHooksInSettings(env, HOOK_FILES, false);

      assert.equal(statusOf(actions, 'settings/hooks'), 'skipped (unexpected shape)');
      assert.deepEqual(readSettings(env), { hooks, otherSetting: true });
    });
  }

  it('skips a malformed SessionStart but still configures the statusline', () => {
    const env = makeEnv({ hooks: { SessionStart: 'nope' } });
    const actions = registerHooksInSettings(env, HOOK_FILES, false);

    assert.equal(statusOf(actions, 'settings/SessionStart hook'), 'skipped (unexpected shape)');
    assert.equal(statusOf(actions, 'settings/statusLine'), 'configured');
    assert.equal(readSettings(env).hooks.SessionStart, 'nope');
  });
});

// ── Every statusline outcome stays distinguishable ──────────────────

describe('registerHooksInSettings statusline outcomes', () => {
  // The curl installer collapsed these four into a flat "updated"/"already
  // configured", so a user could not tell a preserved custom statusline from
  // one that was never inspected.
  it('reports a fresh configure', () => {
    const env = makeEnv({});
    assert.equal(
      statusOf(registerHooksInSettings(env, HOOK_FILES, false), 'settings/statusLine'),
      'configured');
  });

  it('reports a gsd upgrade and rewrites the command', () => {
    const env = makeEnv({ statusLine: { type: 'command', command: 'node "/x/gsd-statusline.js"' } });
    assert.equal(
      statusOf(registerHooksInSettings(env, HOOK_FILES, false), 'settings/statusLine'),
      'upgraded (gsd→slashdo)');
    assert.equal(readSettings(env).statusLine.command, slashdoStatusline(env));
  });

  it('reports an already-slashdo statusline as already configured', () => {
    const env = makeEnv({});
    fs.writeFileSync(env.settingsFile,
      JSON.stringify({ statusLine: { type: 'command', command: slashdoStatusline(env) } }));
    assert.equal(
      statusOf(registerHooksInSettings(env, HOOK_FILES, false), 'settings/statusLine'),
      'already configured');
  });

  it('reports a custom statusline as preserved and leaves it alone', () => {
    const env = makeEnv({ statusLine: { type: 'command', command: 'my-own-statusline' } });
    assert.equal(
      statusOf(registerHooksInSettings(env, HOOK_FILES, false), 'settings/statusLine'),
      'existing statusline preserved');
    assert.equal(readSettings(env).statusLine.command, 'my-own-statusline');
  });
});

// ── Round trip ──────────────────────────────────────────────────────

describe('deregisterHooksFromSettings', () => {
  it('removes exactly what register added', () => {
    const env = makeEnv({ theme: 'dark' });
    registerHooksInSettings(env, HOOK_FILES, false);
    const actions = deregisterHooksFromSettings(env, false);

    assert.equal(statusOf(actions, 'settings/SessionStart hook'), 'deregistered');
    assert.equal(statusOf(actions, 'settings/statusLine'), 'removed');
    assert.deepEqual(readSettings(env), { theme: 'dark' });
  });

  it('preserves a foreign hook sharing the slashdo group', () => {
    const env = makeEnv({});
    registerHooksInSettings(env, HOOK_FILES, false);
    const settings = readSettings(env);
    settings.hooks.SessionStart[0].hooks.push({ type: 'command', command: 'node other.js' });
    fs.writeFileSync(env.settingsFile, JSON.stringify(settings, null, 2));

    deregisterHooksFromSettings(env, false);

    assert.deepEqual(readSettings(env).hooks.SessionStart[0].hooks,
      [{ type: 'command', command: 'node other.js' }]);
  });

  it('leaves a custom statusline alone', () => {
    const env = makeEnv({ statusLine: { type: 'command', command: 'my-own-statusline' } });
    deregisterHooksFromSettings(env, false);

    assert.equal(readSettings(env).statusLine.command, 'my-own-statusline');
  });
});
