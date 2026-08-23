'use strict';

// Direct unit tests for the canonical settings.json mutation module.
//
// These two functions used to live inside src/installer.js and were only
// reachable through install()/uninstall(), which is why install.sh and
// uninstall.sh grew hand-translated copies that drifted (issue #166). Now that
// both install paths call this one module, its outcomes are worth pinning
// directly — especially the two behaviors the shell copies got wrong:
// a malformed `settings.hooks` must be left alone, not clobbered, and every
// statusline outcome must be reported distinctly.

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
  if (settings !== undefined) {
    fs.writeFileSync(settingsFile, typeof settings === 'string' ? settings : JSON.stringify(settings, null, 2));
  }
  return { settingsFile, hooksDir };
}

function readSettings(env) {
  return JSON.parse(fs.readFileSync(env.settingsFile, 'utf8'));
}

function statusOf(actions, name) {
  return actions.find((a) => a.name === name)?.status;
}

const slashdoStatusline = (env) => `node "${path.join(env.hooksDir, 'slashdo-statusline.js')}"`;

// ── registerHooksInSettings ─────────────────────────────────────────

describe('registerHooksInSettings', () => {
  it('registers the SessionStart hook and statusline in a fresh settings.json', () => {
    const env = makeEnv();
    const actions = registerHooksInSettings(env, HOOK_FILES, false);

    assert.equal(statusOf(actions, 'settings/SessionStart hook'), 'registered');
    assert.equal(statusOf(actions, 'settings/statusLine'), 'configured');

    const settings = readSettings(env);
    assert.match(settings.hooks.SessionStart[0].hooks[0].command, /slashdo-check-update/);
    assert.equal(settings.statusLine.command, slashdoStatusline(env));
  });

  it('leaves a malformed settings.hooks untouched instead of clobbering it', () => {
    // The curl installer used to reset a non-object `hooks` to {}, silently
    // discarding whatever the user had there. Skipping is the canonical behavior.
    const env = makeEnv({ hooks: 'some-string', otherSetting: true });
    const actions = registerHooksInSettings(env, HOOK_FILES, false);

    assert.equal(statusOf(actions, 'settings/hooks'), 'skipped (unexpected shape)');
    assert.deepEqual(readSettings(env), { hooks: 'some-string', otherSetting: true });
  });

  it('leaves an array settings.hooks untouched too', () => {
    const env = makeEnv({ hooks: ['nope'] });
    const actions = registerHooksInSettings(env, HOOK_FILES, false);

    assert.equal(statusOf(actions, 'settings/hooks'), 'skipped (unexpected shape)');
    assert.deepEqual(readSettings(env), { hooks: ['nope'] });
  });

  it('skips a malformed SessionStart but still configures the statusline', () => {
    const env = makeEnv({ hooks: { SessionStart: 'nope' } });
    const actions = registerHooksInSettings(env, HOOK_FILES, false);

    assert.equal(statusOf(actions, 'settings/SessionStart hook'), 'skipped (unexpected shape)');
    assert.equal(statusOf(actions, 'settings/statusLine'), 'configured');
    assert.equal(readSettings(env).hooks.SessionStart, 'nope');
  });

  it('skips a settings.json it cannot parse', () => {
    const env = makeEnv('{ not json');
    const actions = registerHooksInSettings(env, HOOK_FILES, false);

    assert.equal(statusOf(actions, 'settings.json'), 'skipped (parse error)');
    assert.equal(fs.readFileSync(env.settingsFile, 'utf8'), '{ not json');
  });

  it('reports each statusline outcome distinctly', () => {
    // The curl installer collapsed these four into a flat "updated"/"already
    // configured", so a user could not tell a preserved custom statusline from
    // one that was never inspected.
    const fresh = makeEnv();
    assert.equal(
      statusOf(registerHooksInSettings(fresh, HOOK_FILES, false), 'settings/statusLine'),
      'configured');

    const gsd = makeEnv({ statusLine: { type: 'command', command: 'node "/x/gsd-statusline.js"' } });
    assert.equal(
      statusOf(registerHooksInSettings(gsd, HOOK_FILES, false), 'settings/statusLine'),
      'upgraded (gsd→slashdo)');
    assert.equal(readSettings(gsd).statusLine.command, slashdoStatusline(gsd));

    const already = makeEnv();
    fs.writeFileSync(already.settingsFile,
      JSON.stringify({ statusLine: { type: 'command', command: slashdoStatusline(already) } }));
    assert.equal(
      statusOf(registerHooksInSettings(already, HOOK_FILES, false), 'settings/statusLine'),
      'already configured');

    const custom = makeEnv({ statusLine: { type: 'command', command: 'my-own-statusline' } });
    assert.equal(
      statusOf(registerHooksInSettings(custom, HOOK_FILES, false), 'settings/statusLine'),
      'existing statusline preserved');
    assert.equal(readSettings(custom).statusLine.command, 'my-own-statusline');
  });

  it('is a no-op on a second run', () => {
    const env = makeEnv();
    registerHooksInSettings(env, HOOK_FILES, false);
    const actions = registerHooksInSettings(env, HOOK_FILES, false);

    assert.equal(statusOf(actions, 'settings/SessionStart hook'), 'already registered');
    assert.equal(statusOf(actions, 'settings/statusLine'), 'already configured');
    assert.equal(readSettings(env).hooks.SessionStart[0].hooks.length, 1);
  });

  it('writes nothing in dry-run mode', () => {
    const env = makeEnv();
    const actions = registerHooksInSettings(env, HOOK_FILES, true);

    assert.equal(statusOf(actions, 'settings/SessionStart hook'), 'would register');
    assert.equal(statusOf(actions, 'settings/statusLine'), 'would configure');
    assert.equal(fs.existsSync(env.settingsFile), false);
  });

  it('returns nothing when the environment has no settings file', () => {
    assert.deepEqual(registerHooksInSettings({ settingsFile: null }, HOOK_FILES, false), []);
  });
});

// ── deregisterHooksFromSettings ─────────────────────────────────────

describe('deregisterHooksFromSettings', () => {
  it('removes what register added, leaving settings.json clean', () => {
    const env = makeEnv({ theme: 'dark' });
    registerHooksInSettings(env, HOOK_FILES, false);
    const actions = deregisterHooksFromSettings(env, false);

    assert.equal(statusOf(actions, 'settings/SessionStart hook'), 'deregistered');
    assert.equal(statusOf(actions, 'settings/statusLine'), 'removed');
    assert.deepEqual(readSettings(env), { theme: 'dark' });
  });

  it('preserves a foreign hook sharing the slashdo group', () => {
    const env = makeEnv();
    registerHooksInSettings(env, HOOK_FILES, false);
    const settings = readSettings(env);
    settings.hooks.SessionStart[0].hooks.push({ type: 'command', command: 'node other.js' });
    fs.writeFileSync(env.settingsFile, JSON.stringify(settings, null, 2));

    deregisterHooksFromSettings(env, false);

    assert.deepEqual(readSettings(env).hooks.SessionStart[0].hooks,
      [{ type: 'command', command: 'node other.js' }]);
  });

  it('downgrades back to gsd-statusline when its hook file still exists', () => {
    const env = makeEnv();
    registerHooksInSettings(env, HOOK_FILES, false);
    const gsdPath = path.join(env.hooksDir, 'gsd-statusline.js');
    fs.writeFileSync(gsdPath, '// gsd');

    const actions = deregisterHooksFromSettings(env, false);

    assert.equal(statusOf(actions, 'settings/statusLine'), 'downgraded (slashdo→gsd)');
    assert.equal(readSettings(env).statusLine.command, `node "${gsdPath}"`);
  });

  it('leaves a custom statusline alone', () => {
    const env = makeEnv({ statusLine: { type: 'command', command: 'my-own-statusline' } });
    deregisterHooksFromSettings(env, false);

    assert.equal(readSettings(env).statusLine.command, 'my-own-statusline');
  });

  it('skips a settings.json it cannot parse', () => {
    const env = makeEnv('{ not json');
    const actions = deregisterHooksFromSettings(env, false);

    assert.equal(statusOf(actions, 'settings.json'), 'skipped (parse error)');
    assert.equal(fs.readFileSync(env.settingsFile, 'utf8'), '{ not json');
  });

  it('writes nothing in dry-run mode', () => {
    const env = makeEnv();
    registerHooksInSettings(env, HOOK_FILES, false);
    const before = fs.readFileSync(env.settingsFile, 'utf8');

    const actions = deregisterHooksFromSettings(env, true);

    assert.equal(statusOf(actions, 'settings/SessionStart hook'), 'would deregister');
    assert.equal(statusOf(actions, 'settings/statusLine'), 'would remove');
    assert.equal(fs.readFileSync(env.settingsFile, 'utf8'), before);
  });

  it('returns nothing when settings.json does not exist', () => {
    const env = makeEnv();
    assert.deepEqual(deregisterHooksFromSettings(env, false), []);
  });
});
