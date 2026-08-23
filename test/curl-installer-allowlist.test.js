'use strict';

// Guard against silent drift between the repo and the curl-installer allowlists.
//
// install.sh and uninstall.sh hard-code LIBS and COMMANDS arrays. When a new
// lib/*.md or commands/do/*.md is added without updating both arrays, curl-
// installed users get a broken or missing command (the file is never copied;
// a command spec's `!cat ~/.claude/lib/<name>.md` fails at runtime, or the
// command itself is absent). The npm installer (src/installer.js) enumerates
// both dirs dynamically, so it doesn't catch this drift — only this test does.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

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

// ── Shared settings.json mutation ───────────────────────────────────
//
// install.sh and uninstall.sh used to inline a hand-translated `node -e` copy
// of src/installer.js's registerHooksInSettings/deregisterHooksFromSettings,
// and the copies drifted: a malformed `settings.hooks` was reset to {} instead
// of skipped, and four distinct statusline outcomes collapsed into one flat
// message (issue #166). Both scripts now fetch src/settings-hooks.js and call
// it. The end-to-end test below is the real parity check — it runs the scripts
// against a throwaway HOME; the source greps guard the structural invariants a
// behavior test cannot see (that the module stays fetchable and single-file).

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
          `${script} contains "${marker}" — settings.json mutation and the paths it acts on ` +
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

// End-to-end parity: run the real scripts against a throwaway HOME and compare
// the settings.json they produce with what the module produces directly. Both
// divergences in issue #166 would have failed here, and this is the check that
// survives a reimplementation written to dodge the source greps above.
describe('curl installer settings.json parity (end-to-end)', { skip: process.platform === 'win32' }, () => {
  const { registerHooksInSettings } = require('../src/settings-hooks');

  const ANSI = new RegExp('\\u001b\\[[0-9;]*m', 'g');

  function runScript(script, home) {
    return execFileSync('bash', [path.join(REPO_ROOT, script)], {
      cwd: REPO_ROOT,
      env: { ...process.env, HOME: home },
      encoding: 'utf8',
      timeout: 120000,
    }).replace(ANSI, '');
  }

  // One temp root per run — see test/settings-hooks.test.js.
  const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'slashdo-curl-'));

  function makeHome(settings) {
    const home = fs.mkdtempSync(path.join(TMP_ROOT, 'home-'));
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify(settings, null, 2));
    return home;
  }

  const settingsOf = (home) =>
    JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'));

  it('produces exactly what the module produces on the npm path', () => {
    const home = makeHome({ theme: 'dark' });
    runScript('install.sh', home);

    // Same starting state and same hooks dir, registered through the module directly.
    const mirror = makeHome({ theme: 'dark' });
    registerHooksInSettings(
      {
        settingsFile: path.join(mirror, '.claude', 'settings.json'),
        hooksDir: path.join(home, '.claude', 'hooks'),
      },
      [{ name: 'slashdo-check-update.js' }, { name: 'slashdo-statusline.js' }],
      false);

    assert.deepEqual(settingsOf(home), settingsOf(mirror));
  });

  it('skips a malformed settings.hooks instead of clobbering it', () => {
    const home = makeHome({ hooks: 'some-string', theme: 'dark' });
    const out = runScript('install.sh', home);

    assert.match(out, /settings\/hooks: skipped \(unexpected shape\)/);
    assert.equal(settingsOf(home).hooks, 'some-string');
    assert.equal(settingsOf(home).theme, 'dark');
  });

  it('reports a preserved custom statusline distinctly from one it configured', () => {
    const home = makeHome({ statusLine: { type: 'command', command: 'my-own-statusline' } });
    const out = runScript('install.sh', home);

    assert.match(out, /settings\/statusLine: existing statusline preserved/);
    assert.equal(settingsOf(home).statusLine.command, 'my-own-statusline');

    const uninstalled = runScript('uninstall.sh', home);
    assert.match(uninstalled, /settings\/SessionStart hook: deregistered/);
    assert.deepEqual(settingsOf(home), { statusLine: { type: 'command', command: 'my-own-statusline' } });
  });

  // The documented usage is `curl ... | bash`, where BASH_SOURCE[0] is unset.
  // An unguarded expansion resolves SCRIPT_DIR to the caller's cwd, so a repo
  // the user merely happens to be standing in would supply the files these
  // scripts install and execute. Piped execution must always fetch remotely.
  for (const script of ['install.sh', 'uninstall.sh']) {
    it(`${script} piped into bash never sources files from the caller's cwd`, () => {
      const home = makeHome({});
      const cwd = fs.mkdtempSync(path.join(TMP_ROOT, 'cwd-'));
      // A decoy checkout in the cwd, complete enough to satisfy every guard the
      // scripts apply before reaching the module. If they trust it, node runs
      // the file below.
      for (const dir of ['commands/do', 'lib', 'src', 'hooks', 'bin']) {
        fs.mkdirSync(path.join(cwd, dir), { recursive: true });
      }
      for (const hook of ['slashdo-check-update.js', 'slashdo-statusline.js']) {
        fs.writeFileSync(path.join(cwd, 'hooks', hook), '// decoy\n');
      }
      const marker = path.join(cwd, 'PWNED');
      fs.writeFileSync(path.join(cwd, 'src', 'settings-hooks.js'),
        `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x');\n` +
        'module.exports = { applyDefaultHooks: () => [], removeDefaultHooks: () => [], formatAction: () => "" };\n');

      // No network in CI: a curl stub makes every remote fetch fail, so the
      // only way the script can obtain the file is the cwd it must not trust.
      const stubDir = fs.mkdtempSync(path.join(TMP_ROOT, 'stub-'));
      fs.writeFileSync(path.join(stubDir, 'curl'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });

      let stdout;
      try {
        stdout = execFileSync('bash', ['-s'], {
          cwd,
          input: fs.readFileSync(path.join(REPO_ROOT, script), 'utf8'),
          env: { ...process.env, HOME: home, PATH: `${stubDir}${path.delimiter}${process.env.PATH}` },
          encoding: 'utf8',
          timeout: 120000,
        });
      } catch (e) {
        // Both scripts exit non-zero when settings.json could not be updated.
        stdout = e.stdout || '';
      }

      // Proves the script actually reached the settings step and found nothing
      // it was willing to use there — without this, a script that died on line
      // 3 would pass. install.sh reports the hooks it could not fetch either;
      // uninstall.sh names the module directly.
      assert.match(stdout, /settings\.json: (skipped \(hook files not found\)|could not read src\/settings-hooks\.js)/);
      assert.equal(fs.existsSync(marker), false,
        `${script} executed src/settings-hooks.js from the caller's cwd when piped into bash`);
    });
  }
});
