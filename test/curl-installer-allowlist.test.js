'use strict';

// Guard against silent drift between the repo and the curl installer's file list.
//
// install.sh and uninstall.sh have no node and cannot list a GitHub directory,
// so they read install-manifest.txt, which scripts/build-install-manifest.js
// generates from commands/do/, lib/ and hooks/. A file added or removed without
// regenerating it would never reach (or never leave) a curl-installed machine;
// the npm installer (src/installer.js) reads the tree directly and cannot catch
// that, so this test does.
//
// Scope: the manifest, its generator, and the scripts' source text. Their
// runtime behavior (files written, settings.json merged, uninstall removal,
// manifest failure modes) is covered end-to-end in test/install-sh.test.js.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  MANIFEST_FILE, buildManifest, parseManifest, readCommitted,
} = require('../scripts/build-install-manifest');

const REPO_ROOT = path.resolve(__dirname, '..');
const REGENERATE = 'node scripts/build-install-manifest.js';

const shipped = (dir, ext) => fs.readdirSync(path.join(REPO_ROOT, dir), { withFileTypes: true })
  .filter((entry) => entry.isFile() && !entry.name.startsWith('.') && (!ext || entry.name.endsWith(ext)))
  .map((entry) => entry.name)
  .sort();

describe('install-manifest.txt', () => {
  const committed = readCommitted();
  const manifest = parseManifest(committed);

  it(`is what \`${REGENERATE}\` generates from the tree`, () => {
    assert.equal(committed, buildManifest(REPO_ROOT, committed),
      `${MANIFEST_FILE} is out of date — run \`${REGENERATE}\` and commit the result`);
  });

  for (const [section, dir, ext] of [
    ['commands', 'commands/do', '.md'],
    ['libs', 'lib', null],
    ['hooks', 'hooks', '.js'],
  ]) {
    it(`lists exactly the files under ${dir}/ in [${section}], none of them retired`, () => {
      assert.deepEqual([...manifest[section]].sort(), shipped(dir, ext));
      const current = new Set(manifest[section]);
      assert.deepEqual(manifest[`retired-${section}`].filter((name) => current.has(name)), []);
    });
  }

  it('keeps the retired names the scripts hard-coded before the manifest existed', () => {
    // Retired names are never pruned, so these must stay for as long as the file exists.
    const seeded = {
      'retired-commands': ['cam', 'good', 'makegoals', 'makegood', 'optimize-md'].map((n) => `${n}.md`),
      'retired-libs': ['better-audit-architecture', 'code-review-checklist', 'github-reviewer-loop',
        'graphql-escaping', 'plan-id-format', 'replan-issues'].map((n) => `${n}.md`),
      'retired-hooks': ['update-check.md'],
    };
    for (const [section, names] of Object.entries(seeded)) {
      for (const name of names) assert.ok(manifest[section].includes(name), `${section} lost ${name}`);
    }
  });

  it('ships in the npm package beside the scripts that read it', () => {
    const { files } = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    assert.ok(files.includes(MANIFEST_FILE), `package.json "files" must include ${MANIFEST_FILE}`);
  });
});

describe('build-install-manifest.js', () => {
  function tree(t, files) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slashdo-manifest-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    for (const dir of ['commands/do', 'lib', 'hooks']) fs.mkdirSync(path.join(root, dir), { recursive: true });
    for (const file of files) fs.writeFileSync(path.join(root, file), 'x\n');
    return root;
  }

  it('carries every name that leaves the tree into retired-*, and never prunes it', (t) => {
    const root = tree(t, ['commands/do/a.md', 'commands/do/b.md', 'lib/one.md', 'lib/two.sh', 'hooks/h.js']);
    const first = buildManifest(root, null);
    assert.deepEqual(parseManifest(first).libs, ['one.md', 'two.sh'], 'lib entries keep their extension');

    fs.rmSync(path.join(root, 'commands/do/b.md'));
    fs.rmSync(path.join(root, 'lib/two.sh'));
    const second = parseManifest(buildManifest(root, first));
    assert.deepEqual(second.commands, ['a.md']);
    assert.deepEqual(second['retired-commands'], ['b.md']);
    assert.deepEqual(second['retired-libs'], ['two.sh']);

    // A later run still remembers b.md and two.sh, though neither manifest's
    // current section has them any more.
    fs.rmSync(path.join(root, 'lib/one.md'));
    const third = parseManifest(buildManifest(root, buildManifest(root, first)));
    assert.deepEqual(third['retired-libs'], ['one.md', 'two.sh']);
    assert.deepEqual(third['retired-commands'], ['b.md']);
  });

  it('un-retires a name that comes back', (t) => {
    const root = tree(t, ['commands/do/a.md', 'lib/one.md', 'hooks/h.js']);
    const previous = buildManifest(root, null).replace('[retired-libs]\n', () => '[retired-libs]\nback.md\n');
    fs.writeFileSync(path.join(root, 'lib/back.md'), 'x\n');
    const next = parseManifest(buildManifest(root, previous));
    assert.deepEqual(next.libs, ['back.md', 'one.md']);
    assert.deepEqual(next['retired-libs'], []);
  });

  it('refuses a filename the shell scripts would reject', (t) => {
    const root = tree(t, ['commands/do/a.md', 'lib/has space.md', 'hooks/h.js']);
    assert.throws(() => buildManifest(root, null), /only accepts/);
  });

  it('--check accepts the committed manifest', () => {
    execFileSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'build-install-manifest.js'), '--check']);
  });
});

describe('curl installer scripts read the manifest, not hand-kept lists', () => {
  const scripts = ['install.sh', 'uninstall.sh'].map((name) => [name, fs.readFileSync(path.join(REPO_ROOT, name), 'utf8')]);
  const manifestBlock = (text) => text.match(/^# ── install manifest ──[\s\S]*?^# ── end install manifest ──$/m)?.[0];

  it('starts every file list empty, to be filled from install-manifest.txt', () => {
    for (const [name, text] of scripts) {
      for (const list of ['COMMANDS', 'LIBS', 'HOOKS', 'OLD_COMMANDS', 'OLD_LIBS', 'OLD_HOOKS']) {
        assert.match(text, new RegExp(`^${list}=\\(\\)$`, 'm'), `${name} must declare ${list}=() and fill it from the manifest`);
        assert.doesNotMatch(text, new RegExp(`^${list}=\\(\\s*[^)\\s]`, 'm'), `${name} hand-keeps ${list}`);
      }
    }
  });

  it('shares one manifest parser between install.sh and uninstall.sh', () => {
    const [[, install], [, uninstall]] = scripts;
    assert.ok(manifestBlock(install), 'install.sh must carry the manifest block');
    assert.equal(manifestBlock(uninstall), manifestBlock(install),
      'the manifest blocks in install.sh and uninstall.sh drifted; keep them identical');
  });
});

describe('curl installer atomic_write', () => {
  // Executes the real functions: the destination directory comes from parameter
  // expansion, which must still work for a bare filename with no slash.
  it('stages beside the destination, with or without a directory part', (t) => {
    const installer = fs.readFileSync(path.join(REPO_ROOT, 'install.sh'), 'utf8');
    const fn = (name) => installer.match(new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}$`, 'm'))[0];
    const mode = installer.match(/^FILE_MODE=.*$/m)[0];
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slashdo-atomic-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.mkdirSync(path.join(dir, 'sub'));
    fs.writeFileSync(path.join(dir, 'src'), 'payload\n');
    const script = [
      'set -euo pipefail', 'ACTIVE_TMP=""', mode, fn('allocate_temp'), fn('atomic_write'),
      'atomic_write bare.txt cp src', 'atomic_write sub/nested.txt cp src', `atomic_write "${dir}/abs.txt" cp src`,
    ].join('\n');
    execFileSync('bash', ['-c', script], { cwd: dir });
    for (const file of ['bare.txt', 'sub/nested.txt', 'abs.txt']) {
      assert.equal(fs.readFileSync(path.join(dir, file), 'utf8'), 'payload\n', file);
    }
    const leftovers = [dir, path.join(dir, 'sub')].flatMap((d) => fs.readdirSync(d).filter((f) => f.startsWith('.slashdo-tmp.')));
    assert.deepEqual(leftovers, []);
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

    assert.match(code, /mktemp "\$@"/, 'the allocation helper must use mktemp');
    assert.match(code, /allocate_temp STAGE_DIR -d "\$\{TMPDIR:-\/tmp\}\/slashdo-install\.XXXXXX"/,
      'the OpenCode staging directory must come from mktemp -d');
    assert.match(code, /allocate_temp ACTIVE_TMP "\$dir\/\.slashdo-tmp\.XXXXXX"/,
      'destination writes must stage through mktemp in the destination directory');
    assert.match(code, /dir="\$\{dest%\/\*\}"/,
      'the destination directory comes from parameter expansion, not a dirname fork per file');
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
