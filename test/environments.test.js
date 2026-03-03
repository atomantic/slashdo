'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { getEnv, allEnvNames, ENVIRONMENTS } = require('../src/environments');

// ── getEnv ──────────────────────────────────────────────────────────

describe('getEnv', () => {
  it('returns claude env config', () => {
    const env = getEnv('claude');
    assert.equal(env.name, 'Claude Code');
    assert.equal(env.format, 'yaml-frontmatter');
    assert.equal(env.namespacing, 'subdirectory');
  });

  it('returns opencode env config', () => {
    const env = getEnv('opencode');
    assert.equal(env.name, 'OpenCode');
    assert.equal(env.namespacing, 'flat');
  });

  it('returns gemini env config', () => {
    const env = getEnv('gemini');
    assert.equal(env.name, 'Gemini CLI');
    assert.equal(env.format, 'toml');
  });

  it('returns codex env config', () => {
    const env = getEnv('codex');
    assert.equal(env.name, 'Codex');
    assert.equal(env.format, 'skill-md');
    assert.equal(env.namespacing, 'directory');
  });

  it('returns null for unknown env name', () => {
    assert.equal(getEnv('unknown'), null);
    assert.equal(getEnv(''), null);
  });
});

// ── allEnvNames ─────────────────────────────────────────────────────

describe('allEnvNames', () => {
  it('returns all four environment names', () => {
    const names = allEnvNames();
    assert.equal(names.length, 4);
    assert.ok(names.includes('claude'));
    assert.ok(names.includes('opencode'));
    assert.ok(names.includes('gemini'));
    assert.ok(names.includes('codex'));
  });
});

// ── Environment shape validation ────────────────────────────────────

describe('environment shape', () => {
  it('all envs have required base fields', () => {
    for (const name of allEnvNames()) {
      const env = ENVIRONMENTS[name];
      assert.ok(env.name, `${name} missing name`);
      assert.ok(env.commandsDir, `${name} missing commandsDir`);
      assert.ok(env.format, `${name} missing format`);
      assert.ok(env.namespacing, `${name} missing namespacing`);
      assert.ok('versionFile' in env, `${name} missing versionFile`);
    }
  });

  it('hook-supporting envs have hooksDir and settingsFile', () => {
    for (const name of allEnvNames()) {
      const env = ENVIRONMENTS[name];
      if (env.supportsHooks) {
        assert.ok(env.hooksDir, `${name} supports hooks but missing hooksDir`);
        assert.ok(env.settingsFile, `${name} supports hooks but missing settingsFile`);
      }
    }
  });

  it('non-hook envs have null hooksDir', () => {
    for (const name of allEnvNames()) {
      const env = ENVIRONMENTS[name];
      if (!env.supportsHooks) {
        assert.equal(env.hooksDir, null, `${name} does not support hooks but has hooksDir`);
      }
    }
  });

  it('only claude supports hooks', () => {
    assert.equal(ENVIRONMENTS.claude.supportsHooks, true);
    assert.equal(ENVIRONMENTS.opencode.supportsHooks, false);
    assert.equal(ENVIRONMENTS.gemini.supportsHooks, false);
    assert.equal(ENVIRONMENTS.codex.supportsHooks, false);
  });

  it('only claude supports teams', () => {
    assert.equal(ENVIRONMENTS.claude.supportsTeams, true);
    assert.equal(ENVIRONMENTS.opencode.supportsTeams, false);
    assert.equal(ENVIRONMENTS.gemini.supportsTeams, false);
    assert.equal(ENVIRONMENTS.codex.supportsTeams, false);
  });

  it('all envs have supportsTeams boolean', () => {
    for (const name of allEnvNames()) {
      const env = ENVIRONMENTS[name];
      assert.equal(typeof env.supportsTeams, 'boolean', `${name} missing supportsTeams`);
    }
  });
});
