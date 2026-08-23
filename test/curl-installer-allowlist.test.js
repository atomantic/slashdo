'use strict';

// Guard against silent drift between the repo and the curl-installer allowlists.
//
// install.sh and uninstall.sh hard-code LIBS and COMMANDS arrays. When a new
// lib/*.md or commands/do/*.md is added without updating both arrays, curl-
// installed users get a broken or missing command (the file is never copied;
// a command spec's `!cat ~/.claude/lib/<name>.md` fails at runtime, or the
// command itself is absent). The npm installer (src/installer.js) enumerates
// both dirs dynamically, so it doesn't catch this drift — only this test does.
//
// Scope: this file only diffs the bash array literals as text. The scripts'
// actual runtime behavior (files written, settings.json merged, uninstall
// removal) is covered end-to-end in test/install-sh.test.js.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');

function parseArray(shellScriptPath, name) {
  const content = fs.readFileSync(shellScriptPath, 'utf8');
  // Match NAME=( ... ) including newlines/whitespace. Comments inside the
  // parens are tolerated — strip them before tokenizing.
  const match = content.match(new RegExp(`^${name}=\\(([\\s\\S]*?)\\)`, 'm'));
  if (!match) throw new Error(`${name}=( ... ) not found in ${shellScriptPath}`);
  return match[1]
    .replace(/#[^\n]*/g, '')
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseLibsArray(shellScriptPath) {
  return parseArray(shellScriptPath, 'LIBS');
}

function parseCommandsArray(shellScriptPath) {
  return parseArray(shellScriptPath, 'COMMANDS');
}

function dirEntries(...segments) {
  return fs
    .readdirSync(path.join(REPO_ROOT, ...segments))
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, ''))
    .sort();
}

function libDirEntries() {
  return dirEntries('lib');
}

function commandDirEntries() {
  return dirEntries('commands', 'do');
}

function hookDirEntries() {
  return fs
    .readdirSync(path.join(REPO_ROOT, 'hooks'))
    .filter((f) => f.endsWith('.js'))
    .map((f) => f.replace(/\.js$/, ''))
    .sort();
}

describe('curl-installer LIBS allowlist', () => {
  const expected = libDirEntries();

  it('install.sh LIBS matches lib/*.md exactly', () => {
    const actual = parseLibsArray(path.join(REPO_ROOT, 'install.sh')).sort();
    assert.deepEqual(actual, expected,
      `install.sh LIBS drift — add missing entries or remove stale ones.\n` +
      `  In lib/ but not LIBS: ${expected.filter((x) => !actual.includes(x)).join(', ') || '(none)'}\n` +
      `  In LIBS but not lib/: ${actual.filter((x) => !expected.includes(x)).join(', ') || '(none)'}`);
  });

  it('uninstall.sh LIBS matches lib/*.md exactly', () => {
    const actual = parseLibsArray(path.join(REPO_ROOT, 'uninstall.sh')).sort();
    assert.deepEqual(actual, expected,
      `uninstall.sh LIBS drift — keep in sync with install.sh.\n` +
      `  In lib/ but not LIBS: ${expected.filter((x) => !actual.includes(x)).join(', ') || '(none)'}\n` +
      `  In LIBS but not lib/: ${actual.filter((x) => !expected.includes(x)).join(', ') || '(none)'}`);
  });
});

describe('curl-installer HOOKS allowlist', () => {
  const expected = hookDirEntries();

  for (const script of ['install.sh', 'uninstall.sh']) {
    it(`${script} HOOKS matches hooks/*.js exactly`, () => {
      const actual = parseArray(path.join(REPO_ROOT, script), 'HOOKS').sort();
      assert.deepEqual(actual, expected,
        `${script} HOOKS drift — a hook missing here is never delivered to curl-installed users.\n` +
        `  In hooks/ but not HOOKS: ${expected.filter((x) => !actual.includes(x)).join(', ') || '(none)'}\n` +
        `  In HOOKS but not hooks/: ${actual.filter((x) => !expected.includes(x)).join(', ') || '(none)'}`);
    });
  }
});

describe('curl-installer COMMANDS allowlist', () => {
  const expected = commandDirEntries();

  it('install.sh COMMANDS matches commands/do/*.md exactly', () => {
    const actual = parseCommandsArray(path.join(REPO_ROOT, 'install.sh')).sort();
    assert.deepEqual(actual, expected,
      `install.sh COMMANDS drift — add missing entries or remove stale ones.\n` +
      `  In commands/do/ but not COMMANDS: ${expected.filter((x) => !actual.includes(x)).join(', ') || '(none)'}\n` +
      `  In COMMANDS but not commands/do/: ${actual.filter((x) => !expected.includes(x)).join(', ') || '(none)'}`);
  });

  it('uninstall.sh COMMANDS matches commands/do/*.md exactly', () => {
    const actual = parseCommandsArray(path.join(REPO_ROOT, 'uninstall.sh')).sort();
    assert.deepEqual(actual, expected,
      `uninstall.sh COMMANDS drift — keep in sync with install.sh.\n` +
      `  In commands/do/ but not COMMANDS: ${expected.filter((x) => !actual.includes(x)).join(', ') || '(none)'}\n` +
      `  In COMMANDS but not commands/do/: ${actual.filter((x) => !expected.includes(x)).join(', ') || '(none)'}`);
  });
});

describe('curl-installer OpenCode temporary files', () => {
  // The OpenCode rewrite stages every download before writing the target. The
  // behavioral coverage — cleanup, concurrent installs, and never writing
  // through a pre-existing TMPDIR path — lives in test/install-sh.test.js;
  // this keeps the cheap source-level guard against a predictable name
  // creeping back in.
  it('derives its temporary paths from mktemp, never from a literal', () => {
    const installer = fs.readFileSync(path.join(REPO_ROOT, 'install.sh'), 'utf8');
    // Ignore comments so the rule reads the code, not the prose about it.
    const code = installer.split('\n').filter((line) => !line.trim().startsWith('#')).join('\n');

    assert.match(code, /mktemp -d "\$\{TMPDIR:-\/tmp\}\/slashdo-install\.XXXXXX"/,
      'the OpenCode staging directory must come from mktemp -d');
    assert.match(code, /mktemp "\$\(dirname "\$dest"\)\/\.slashdo-tmp\.XXXXXX"/,
      'destination writes must stage through mktemp in the destination directory');
    assert.doesNotMatch(code, /\/tmp\/slashdo/, 'no predictable /tmp/slashdo-* path');
  });
});

// ── Shared settings.json mutation ───────────────────────────────────
//
// install.sh and uninstall.sh each used to inline a hand-translated `node -e`
// copy of src/installer.js's registerHooksInSettings/deregisterHooksFromSettings,
// and the copies drifted: a malformed `settings.hooks` was reset to {} instead
// of skipped, and four distinct statusline outcomes collapsed into one flat
// message (issue #166). Both scripts now fetch src/settings-hooks.js and call
// it, so there is one implementation. These guards keep it that way; the
// behavioral parity check lives in test/install-sh.test.js.

const SHARED_MODULE = 'src/settings-hooks.js';

function readRepoFile(name) {
  return fs.readFileSync(path.join(REPO_ROOT, name), 'utf8');
}

describe('curl installer shares src/settings-hooks.js', () => {
  for (const [script, entryPoint] of [
    ['install.sh', 'applyDefaultHooks'],
    ['uninstall.sh', 'removeDefaultHooks'],
  ]) {
    it(`${script} fetches the shared module and calls ${entryPoint}()`, () => {
      const content = readRepoFile(script);
      assert.ok(content.includes(`fetch_file "${SHARED_MODULE}"`),
        `${script} must fetch ${SHARED_MODULE} rather than reimplementing it`);
      assert.ok(content.includes(`settingsHooks.${entryPoint}(`),
        `${script} must call ${entryPoint}() from the fetched module`);
    });

    it(`${script} does not reimplement the settings.json mutation or its inputs`, () => {
      const content = readRepoFile(script);
      // Markers of a hand-rolled copy: mutating settings.json from shell-embedded
      // JS, or re-deriving the paths and hook list the module owns.
      for (const marker of [
        'settings.hooks', 'settings.statusLine', 'autoUpdate', 'JSON.parse', 'JSON.stringify',
      ]) {
        assert.ok(!content.includes(marker),
          `${script} contains "${marker}" — settings.json mutation and the values it acts on ` +
          `belong in ${SHARED_MODULE}, not in a second shell-embedded copy that can drift`);
      }
    });
  }

  it('the shared module stays dependency-free so the curl path can fetch it alone', () => {
    // Both scripts fetch exactly one file into an empty temp dir, with no
    // node_modules and no siblings: anything but a Node builtin fails to
    // resolve at install time.
    const BUILTINS = ['fs', 'os', 'path'];
    const requires = [...readRepoFile(SHARED_MODULE).matchAll(/require\(['"]([^'"]+)['"]\)/g)]
      .map((m) => m[1]);
    assert.deepEqual(requires.filter((r) => !BUILTINS.includes(r)), [],
      `${SHARED_MODULE} may only require ${BUILTINS.join('/')} — a sibling module or npm ` +
      `package resolves to nothing when the curl installer fetches this file on its own`);
  });

  it('src/installer.js uses the shared module instead of its own copy', () => {
    const content = readRepoFile('src/installer.js');
    assert.ok(content.includes("require('./settings-hooks')"),
      'src/installer.js must require ./settings-hooks so npm and curl share one implementation');
    assert.ok(!content.includes('function registerHooksInSettings'),
      'src/installer.js must not redefine registerHooksInSettings');
  });
});
