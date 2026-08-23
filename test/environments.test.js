'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { getEnv, allEnvNames, allEnvAliases, canonicalEnvName, ENVIRONMENTS } = require('../src/environments');

// ── getEnv ──────────────────────────────────────────────────────────

describe('getEnv', () => {
  it('returns claude env config', () => {
    const env = getEnv('claude');
    assert.equal(env.name, 'Claude Code');
    assert.equal(env.format, 'yaml-frontmatter');
    assert.equal(env.namespacing, 'subdirectory');
  });

  it('resolves every Claude path from CLAUDE_CONFIG_DIR', () => {
    const configDir = path.join(os.tmpdir(), 'slashdo-custom-claude');
    const script = `
      const { getEnv } = require(${JSON.stringify(require.resolve('../src/environments'))});
      process.stdout.write(JSON.stringify(getEnv('claude')));
    `;
    const result = spawnSync(process.execPath, ['-e', script], {
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
    });

    assert.equal(result.status, 0, result.stderr);
    const env = JSON.parse(result.stdout);
    assert.equal(env.commandsDir, path.join(configDir, 'commands'));
    assert.equal(env.libDir, path.join(configDir, 'lib'));
    assert.equal(env.hooksDir, path.join(configDir, 'hooks'));
    assert.equal(env.settingsFile, path.join(configDir, 'settings.json'));
    assert.equal(env.versionFile, path.join(configDir, '.slashdo-version'));
    assert.equal(env.configFile, path.join(configDir, '.slashdo-config.json'));
    assert.equal(env.configPath, path.join(configDir, '.slashdo-config.json'));
    assert.equal(env.libPathPrefix, `${path.join(configDir, 'lib')}${path.sep}`);
  });

  it('returns opencode env config', () => {
    const env = getEnv('opencode');
    assert.equal(env.name, 'OpenCode');
    assert.equal(env.namespacing, 'flat');
  });

  it('returns antigravity env config', () => {
    const env = getEnv('antigravity');
    assert.equal(env.name, 'Antigravity CLI');
    assert.equal(env.format, 'yaml-frontmatter');
    assert.equal(env.namespacing, 'directory');
  });

  it('resolves gemini and agy aliases to the antigravity env', () => {
    const antigravity = getEnv('antigravity');
    assert.equal(getEnv('gemini'), antigravity);
    assert.equal(getEnv('agy'), antigravity);
  });

  it('returns codex env config', () => {
    const env = getEnv('codex');
    assert.equal(env.name, 'Codex');
    assert.equal(env.format, 'yaml-frontmatter');
    assert.equal(env.namespacing, 'directory');
  });

  it('returns grok env config', () => {
    const env = getEnv('grok');
    assert.equal(env.name, 'Grok Build');
    assert.equal(env.format, 'yaml-frontmatter');
    assert.equal(env.namespacing, 'directory');
  });

  it('returns null for unknown env name', () => {
    assert.equal(getEnv('unknown'), null);
    assert.equal(getEnv(''), null);
  });

  it('resolves gemini-legacy to the legacy cleanup env (not listed in allEnvNames)', () => {
    const env = getEnv('gemini-legacy');
    assert.ok(env, 'gemini-legacy should resolve');
    assert.equal(env.name, 'Gemini CLI (legacy)');
    const names = allEnvNames();
    assert.ok(!names.includes('gemini-legacy'), 'gemini-legacy must not appear in allEnvNames()');
  });
});

// ── canonicalEnvName ────────────────────────────────────────────────

describe('canonicalEnvName', () => {
  it('maps the gemini and agy aliases to antigravity', () => {
    assert.equal(canonicalEnvName('gemini'), 'antigravity');
    assert.equal(canonicalEnvName('agy'), 'antigravity');
  });

  it('passes canonical names through unchanged', () => {
    assert.equal(canonicalEnvName('antigravity'), 'antigravity');
    assert.equal(canonicalEnvName('claude'), 'claude');
    assert.equal(canonicalEnvName('unknown'), 'unknown');
  });
});

// ── allEnvNames ─────────────────────────────────────────────────────

describe('allEnvNames', () => {
  it('returns all five environment names', () => {
    const names = allEnvNames();
    assert.equal(names.length, 5);
    assert.ok(names.includes('claude'));
    assert.ok(names.includes('opencode'));
    assert.ok(names.includes('antigravity'));
    assert.ok(names.includes('codex'));
    assert.ok(names.includes('grok'));
  });

  it('does not list aliases as canonical names', () => {
    const names = allEnvNames();
    assert.ok(!names.includes('gemini'));
    assert.ok(!names.includes('agy'));
  });
});

describe('allEnvAliases', () => {
  it('exposes the gemini and agy aliases', () => {
    const aliases = allEnvAliases();
    assert.ok(aliases.includes('gemini'));
    assert.ok(aliases.includes('agy'));
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
    assert.equal(ENVIRONMENTS.antigravity.supportsHooks, false);
    assert.equal(ENVIRONMENTS.codex.supportsHooks, false);
    assert.equal(ENVIRONMENTS.grok.supportsHooks, false);
  });

  it('only claude supports teams', () => {
    assert.equal(ENVIRONMENTS.claude.supportsTeams, true);
    assert.equal(ENVIRONMENTS.opencode.supportsTeams, false);
    assert.equal(ENVIRONMENTS.antigravity.supportsTeams, false);
    assert.equal(ENVIRONMENTS.codex.supportsTeams, false);
    assert.equal(ENVIRONMENTS.grok.supportsTeams, false);
  });

  it('all envs have supportsTeams boolean', () => {
    for (const name of allEnvNames()) {
      const env = ENVIRONMENTS[name];
      assert.equal(typeof env.supportsTeams, 'boolean', `${name} missing supportsTeams`);
    }
  });
});

// ── claudeEnv parity ────────────────────────────────────────────────

describe('settings-hooks claudeEnv', () => {
  const { claudeEnv } = require('../src/settings-hooks');

  it('derives the same Claude paths ENVIRONMENTS.claude owns', () => {
    // src/settings-hooks.js re-derives these so the curl installer can fetch it
    // as a single dependency-free file. This pins the two together — moving
    // ~/.claude in src/environments.js must move it there too, or install.sh
    // and the npm installer would write different files (issue #166).
    const env = claudeEnv();
    assert.equal(env.settingsFile, ENVIRONMENTS.claude.settingsFile);
    assert.equal(env.hooksDir, ENVIRONMENTS.claude.hooksDir);
    assert.equal(env.configFile, ENVIRONMENTS.claude.configFile);
  });
});
