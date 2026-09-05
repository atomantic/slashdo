'use strict';

// End-to-end tests for the curl installer scripts themselves.
//
// test/curl-installer-allowlist.test.js only diffs the LIBS/COMMANDS bash array
// literals against the repo as text — it never executes either script. These
// tests actually run install.sh and uninstall.sh against a sandbox HOME (the
// same mkdtemp pattern test/installer.test.js uses for the npm path) and assert
// on the resulting filesystem and settings.json state.
//
// Expected inventory is derived from commands/do/ and lib/ on disk, never from
// the bash arrays under test — otherwise deleting an entry from COMMANDS would
// silently delete its coverage too.
//
// Two source modes are exercised. LOCAL_MODE: install.sh copies from its
// sibling commands//lib/ dirs when they exist (install.sh:11-16), so running the
// repo's own script needs no network. Remote mode: install.sh is copied to a
// bare directory, which makes it fall back to curl, and `curl` is shadowed via
// PATH by a stub that serves the repo (or fails on demand).

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile, execFileSync, spawn, spawnSync } = require('child_process');

const { ENVIRONMENTS } = require('../src/environments');
const { install: npmInstall } = require('../src/installer');

const REPO_ROOT = path.resolve(__dirname, '..');
const INSTALL_SH = path.join(REPO_ROOT, 'install.sh');
const UNINSTALL_SH = path.join(REPO_ROOT, 'uninstall.sh');
const BASE_URL = 'https://raw.githubusercontent.com/atomantic/slashdo/main';

// ── Expected inventory (from the repo, not from the scripts) ────────

function mdNames(...segments) {
  return fs
    .readdirSync(path.join(REPO_ROOT, ...segments))
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.slice(0, -3))
    .sort();
}

const COMMANDS = mdNames('commands', 'do');
const LIBS = mdNames('lib');
const HOOKS = fs
  .readdirSync(path.join(REPO_ROOT, 'hooks'))
  .filter((f) => f.endsWith('.js'))
  .map((f) => f.slice(0, -3))
  .sort();

// The OpenCode install pipes every file through sed; this is the same rewrite
// expressed in JS, so a drift in either direction fails.
function rewriteForOpencode(text) {
  return text
    .split('~/.claude/lib/').join('~/.config/opencode/lib/')
    .replace(/~\/\.claude\/commands\/do\/([A-Za-z0-9._-]+)\.md/g, '~/.config/opencode/commands/do-$1.md')
    .split('~/.claude/.slashdo-config.json').join('~/.config/opencode/.slashdo-config.json');
}

const readRepo = (...segments) => {
  const text = fs.readFileSync(path.join(REPO_ROOT, ...segments), 'utf8');
  // !read is portable source syntax; native hosts receive actionable read paths.
  return segments.at(-1).endsWith('.md')
    ? text.replace(/^!read lib\/([\w.-]+\.md)$/gm,
      'Read `~/.claude/lib/$1` before performing this step; required when this step applies.')
    : text;
};

// ── Sandbox helpers ─────────────────────────────────────────────────

const tmpDirs = [];

function mkTmp(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function makeHome(envDirs = ['.claude']) {
  const home = mkTmp('slashdo-sh-');
  for (const dir of envDirs) fs.mkdirSync(path.join(home, dir), { recursive: true });
  return home;
}

const makeTmpdir = () => mkTmp('slashdo-shtmp-');

function childEnv({ home, tmpdir, pathPrefix }) {
  return {
    PATH: pathPrefix ? `${pathPrefix}:${process.env.PATH}` : process.env.PATH,
    HOME: home,
    TMPDIR: tmpdir || home,
  };
}

// Run a script with a sandboxed HOME. Returns { status, stdout } with stderr
// folded in, so tests can assert on failure paths and on shell diagnostics.
// `stdin: true` pipes the script the way the documented `curl ... | bash`
// install does, which leaves BASH_SOURCE unset.
function runScript(script, opts = {}) {
  const { stdin = false, cwd } = opts;
  const result = spawnSync('bash', stdin ? [] : [script], {
    env: childEnv(opts),
    cwd,
    encoding: 'utf8',
    input: stdin ? fs.readFileSync(script, 'utf8') : undefined,
  });
  return { status: result.status, stdout: (result.stdout || '') + (result.stderr || '') };
}

const runInstall = (opts) => runScript(INSTALL_SH, opts);
const runUninstall = (opts) => runScript(UNINSTALL_SH, opts);

const settingsPathOf = (home) => path.join(home, '.claude', 'settings.json');
const readSettings = (home) => JSON.parse(fs.readFileSync(settingsPathOf(home), 'utf8'));
const writeSettings = (home, settings) =>
  fs.writeFileSync(settingsPathOf(home), JSON.stringify(settings, null, 2) + '\n');

function strayTempFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.startsWith('.slashdo-tmp.'));
}

function stagingDirs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) =>
    f.startsWith('slashdo-claude.') || f.startsWith('slashdo-install.') || f.startsWith('slashdo-mod.')
  );
}

const claudeSubdirs = (home) => ['commands/do', 'lib', 'hooks'].map((d) => path.join(home, '.claude', ...d.split('/')));

// ── curl stubs (remote mode) ────────────────────────────────────────

function makeCurlStub(body) {
  const dir = mkTmp('slashdo-bin-');
  const stub = path.join(dir, 'curl');
  fs.writeFileSync(stub, [
    '#!/bin/sh',
    '# Parse the `curl -fsSL <url> -o <dest>` call install.sh makes.',
    'url=""; dest=""; prev=""',
    'for a in "$@"; do',
    '  if [ "$prev" = "-o" ]; then dest="$a"',
    '  else',
    '    case "$a" in',
    '      -*) ;;',
    '      *) [ -z "$url" ] && url="$a" ;;',
    '    esac',
    '  fi',
    '  prev="$a"',
    'done',
    `rel=\${url#${BASE_URL}/}`,
    body,
    '',
  ].join('\n'));
  fs.chmodSync(stub, 0o755);
  return dir;
}

// Serves the repo over the "network" — the success path, without a network.
const makeServingCurl = () => makeCurlStub(
  `[ -f "${REPO_ROOT}/$rel" ] || exit 22\ncp "${REPO_ROOT}/$rel" "$dest"`
);

const makeServingCurlWithoutSettingsHooks = () => makeCurlStub(
  `[ "$rel" = "src/settings-hooks.js" ] && exit 22\n[ -f "${REPO_ROOT}/$rel" ] || exit 22\ncp "${REPO_ROOT}/$rel" "$dest"`
);

const makeServingCurlWithoutHook = (hook) => makeCurlStub(
  `[ "$rel" = "hooks/${hook}.js" ] && exit 22\n[ -f "${REPO_ROOT}/$rel" ] || exit 22\ncp "${REPO_ROOT}/$rel" "$dest"`
);

// Writes a partial body and then fails, standing in for a dead transfer.
const makeFailingCurl = () => makeCurlStub('[ -n "$dest" ] && printf TRUNCATED > "$dest"\nexit 1');

// Same, but hangs afterwards so a test can interrupt the install mid-write.
const makeHangingCurl = () => makeCurlStub('[ -n "$dest" ] && printf TRUNCATED > "$dest"\nsleep 30\nexit 1');

// Copy install.sh somewhere with no sibling commands//lib/, forcing remote mode.
function remoteModeInstaller() {
  const dest = path.join(mkTmp('slashdo-remote-'), 'install.sh');
  fs.copyFileSync(INSTALL_SH, dest);
  return dest;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

after(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

// ── install.sh: Claude Code, local mode ─────────────────────────────

describe('install.sh — Claude Code fresh install', () => {
  let home;
  let result;

  before(() => {
    home = makeHome();
    result = runInstall({ home });
  });

  it('exits successfully and reports local mode', () => {
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, /Source:.*local/);
    assert.doesNotMatch(result.stdout, /failed/);
    // Colors belong in the printf format string; passed through %s they reach
    // the terminal as the literal text \033[0;32m.
    assert.ok(!result.stdout.includes('\\033'), 'no uninterpreted escape sequences in the output');
  });

  it('installs every command with native required-read paths', () => {
    for (const cmd of COMMANDS) {
      const file = path.join(home, '.claude', 'commands', 'do', `${cmd}.md`);
      assert.ok(fs.existsSync(file), `${cmd}.md should be installed`);
      assert.equal(fs.readFileSync(file, 'utf8'), readRepo('commands', 'do', `${cmd}.md`), `${cmd}.md content`);
    }
  });

  it('installs every library with native required-read paths', () => {
    for (const lib of LIBS) {
      const file = path.join(home, '.claude', 'lib', `${lib}.md`);
      assert.ok(fs.existsSync(file), `${lib}.md should be installed`);
      assert.equal(fs.readFileSync(file, 'utf8'), readRepo('lib', `${lib}.md`), `${lib}.md content`);
    }
  });

  it('installs the hook files verbatim', () => {
    for (const hook of HOOKS) {
      const file = path.join(home, '.claude', 'hooks', `${hook}.js`);
      assert.ok(fs.existsSync(file), `${hook}.js should be installed`);
      assert.equal(fs.readFileSync(file, 'utf8'), readRepo('hooks', `${hook}.js`), `${hook}.js content`);
    }
  });

  it('installs files with the mode the umask implies, not mktemp-private 0600', () => {
    const umask = parseInt(execFileSync('sh', ['-c', 'umask'], { encoding: 'utf8' }).trim(), 8);
    const expected = 0o666 & ~umask;
    for (const file of ['commands/do/push.md', 'lib/model-tiers.md', 'hooks/slashdo-statusline.js']) {
      const mode = fs.statSync(path.join(home, '.claude', ...file.split('/'))).mode & 0o777;
      assert.equal(mode, expected, `${file} should be ${expected.toString(8)}, not mktemp-private`);
    }
  });

  it('leaves no staging temp files behind', () => {
    for (const dir of claudeSubdirs(home)) assert.deepEqual(strayTempFiles(dir), []);
  });

  it('defaults auto-update to enabled in .slashdo-config.json', () => {
    const config = JSON.parse(fs.readFileSync(path.join(home, '.claude', '.slashdo-config.json'), 'utf8'));
    assert.equal(config.autoUpdate, true);
  });

  it('registers the SessionStart hook and the statusline in settings.json', () => {
    const settings = readSettings(home);
    const commands = settings.hooks.SessionStart.flatMap((g) => g.hooks.map((h) => h.command));
    assert.equal(commands.length, 1);
    assert.match(commands[0], /slashdo-check-update\.js/);
    assert.match(settings.statusLine.command, /slashdo-statusline\.js/);
    assert.equal(settings.statusLine.type, 'command');
  });
});

describe('install.sh — OpenCode fresh install', () => {
  it('installs commands and libs with the OpenCode path rewrite applied', () => {
    const home = makeHome(['.claude', '.config/opencode']);
    const result = runInstall({ home });
    assert.equal(result.status, 0, result.stdout);

    for (const cmd of COMMANDS) {
      const file = path.join(home, '.config', 'opencode', 'commands', `do-${cmd}.md`);
      assert.ok(fs.existsSync(file), `do-${cmd}.md should be installed`);
      assert.equal(
        fs.readFileSync(file, 'utf8'),
        rewriteForOpencode(readRepo('commands', 'do', `${cmd}.md`)),
        `do-${cmd}.md should have the OpenCode rewrite applied`
      );
    }
    for (const lib of LIBS) {
      const file = path.join(home, '.config', 'opencode', 'lib', `${lib}.md`);
      assert.ok(fs.existsSync(file), `${lib}.md should be installed`);
      assert.equal(fs.readFileSync(file, 'utf8'), rewriteForOpencode(readRepo('lib', `${lib}.md`)), `${lib}.md content`);
    }
    assert.ok(
      COMMANDS.some((c) => fs.readFileSync(
        path.join(home, '.config', 'opencode', 'commands', `do-${c}.md`), 'utf8'
      ).includes('~/.config/opencode/lib/')),
      'at least one command should carry a rewritten lib path (guards a no-op rewrite)'
    );
  });

  it('rewrites command execution references to installed OpenCode filenames', () => {
    const home = makeHome(['.claude', '.config/opencode']);
    const result = runInstall({ home });
    assert.equal(result.status, 0, result.stdout);

    let sawExecRef = false;
    for (const cmd of COMMANDS) {
      const file = path.join(home, '.config', 'opencode', 'commands', `do-${cmd}.md`);
      const content = fs.readFileSync(file, 'utf8');
      assert.doesNotMatch(
        content, /~\/\.claude\/commands\/do\//,
        `do-${cmd}.md should not contain a dangling ~/.claude/commands/do/ reference`
      );
      for (const match of content.matchAll(/~\/\.config\/opencode\/commands\/(do-[A-Za-z0-9._-]+\.md)/g)) {
        sawExecRef = true;
        const targetFile = path.join(home, '.config', 'opencode', 'commands', match[1]);
        assert.ok(fs.existsSync(targetFile), `${match[1]} referenced by do-${cmd}.md should exist`);
      }
    }
    assert.ok(sawExecRef, 'at least one command should carry a resolved execution reference (guards a no-op assertion)');
  });
});

// ── install.sh: remote (curl) mode ──────────────────────────────────

describe('install.sh — remote mode', () => {
  it('installs the same tree over curl as it does from a local checkout', () => {
    const home = makeHome(['.claude', '.config/opencode']);
    const result = runScript(remoteModeInstaller(), { home, pathPrefix: makeServingCurl() });

    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, /Source:.*github/);
    assert.doesNotMatch(result.stdout, /failed/);

    for (const cmd of COMMANDS) {
      assert.equal(
        fs.readFileSync(path.join(home, '.claude', 'commands', 'do', `${cmd}.md`), 'utf8'),
        readRepo('commands', 'do', `${cmd}.md`),
        `${cmd}.md should be fetched intact`
      );
      assert.equal(
        fs.readFileSync(path.join(home, '.config', 'opencode', 'commands', `do-${cmd}.md`), 'utf8'),
        rewriteForOpencode(readRepo('commands', 'do', `${cmd}.md`)),
        `do-${cmd}.md should be fetched and rewritten`
      );
    }
    for (const lib of LIBS) {
      assert.equal(
        fs.readFileSync(path.join(home, '.claude', 'lib', `${lib}.md`), 'utf8'),
        readRepo('lib', `${lib}.md`),
        `${lib}.md should be fetched intact`
      );
      assert.equal(
        fs.readFileSync(path.join(home, '.config', 'opencode', 'lib', `${lib}.md`), 'utf8'),
        rewriteForOpencode(readRepo('lib', `${lib}.md`)),
        `opencode lib/${lib}.md should be fetched and rewritten`
      );
    }
    for (const hook of HOOKS) {
      assert.equal(
        fs.readFileSync(path.join(home, '.claude', 'hooks', `${hook}.js`), 'utf8'),
        readRepo('hooks', `${hook}.js`),
        `${hook}.js should be fetched intact`
      );
    }
    assert.match(readSettings(home).statusLine.command, /slashdo-statusline\.js/);
  });
});

describe('install.sh — piped from stdin (curl | bash)', () => {
  it('fetches from GitHub, not from the caller directory', () => {
    const home = makeHome();
    // A directory that merely looks like a checkout. BASH_SOURCE is unset for a
    // piped script, so a SCRIPT_DIR that silently falls back to CWD would
    // install these files — from any repo that happens to have those dir names.
    const decoy = mkTmp('slashdo-decoy-');
    fs.mkdirSync(path.join(decoy, 'commands', 'do'), { recursive: true });
    fs.mkdirSync(path.join(decoy, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(decoy, 'commands', 'do', 'push.md'), 'DECOY\n');

    const result = runScript(INSTALL_SH, {
      home,
      cwd: decoy,
      stdin: true,
      pathPrefix: makeServingCurl(),
    });

    assert.equal(result.status, 0, result.stdout);
    assert.doesNotMatch(result.stdout, /unbound variable/, 'set -u must not trip on an unset BASH_SOURCE');
    assert.match(result.stdout, /Source:.*github/);
    assert.equal(
      fs.readFileSync(path.join(home, '.claude', 'commands', 'do', 'push.md'), 'utf8'),
      readRepo('commands', 'do', 'push.md'),
      'a piped install must fetch from GitHub, not from whatever the CWD holds'
    );
  });
});

describe('install.sh — Claude Code re-install', () => {
  it('is idempotent: a second run reports "already configured" and leaves settings.json byte-identical', () => {
    const home = makeHome();
    runInstall({ home });
    const first = fs.readFileSync(settingsPathOf(home), 'utf8');

    const second = runInstall({ home });
    assert.equal(second.status, 0, second.stdout);
    assert.match(second.stdout, /already configured/);
    assert.equal(fs.readFileSync(settingsPathOf(home), 'utf8'), first);
  });

  it('removes superseded command files from earlier versions', () => {
    const home = makeHome();
    const oldCmd = path.join(home, '.claude', 'commands', 'do', 'makegood.md');
    fs.mkdirSync(path.dirname(oldCmd), { recursive: true });
    fs.writeFileSync(oldCmd, 'stale\n');

    const result = runInstall({ home });
    assert.equal(result.status, 0, result.stdout);
    assert.ok(!fs.existsSync(oldCmd), 'superseded command should be removed');
  });
});

describe('install.sh — settings.json edge cases', () => {
  it('preserves a user statusline it does not own', () => {
    const home = makeHome();
    writeSettings(home, { statusLine: { type: 'command', command: 'node /my/own/statusline.js' } });

    runInstall({ home });
    assert.equal(readSettings(home).statusLine.command, 'node /my/own/statusline.js');
  });

  it('upgrades a gsd-statusline entry to slashdo-statusline', () => {
    const home = makeHome();
    fs.mkdirSync(path.join(home, '.claude', 'hooks'), { recursive: true });
    writeSettings(home, { statusLine: { type: 'command', command: 'node "/x/gsd-statusline.js"' } });

    runInstall({ home });
    assert.match(readSettings(home).statusLine.command, /slashdo-statusline\.js/);
  });

  it('appends into an existing SessionStart group without dropping user hooks', () => {
    const home = makeHome();
    writeSettings(home, {
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: 'echo user-hook' }] }],
        PreToolUse: [{ hooks: [{ type: 'command', command: 'echo pre' }] }],
      },
    });

    runInstall({ home });
    const settings = readSettings(home);
    const commands = settings.hooks.SessionStart.flatMap((g) => g.hooks.map((h) => h.command));
    assert.ok(commands.includes('echo user-hook'), 'user hook must survive');
    assert.ok(commands.some((c) => c.includes('slashdo-check-update')), 'slashdo hook must be registered');
    assert.deepEqual(settings.hooks.PreToolUse, [{ hooks: [{ type: 'command', command: 'echo pre' }] }]);
  });

  it('leaves an unparseable settings.json untouched', () => {
    const home = makeHome();
    fs.writeFileSync(settingsPathOf(home), '{ not json');

    const result = runInstall({ home });
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, /settings\.json: skipped \(parse error\)/);
    assert.equal(fs.readFileSync(settingsPathOf(home), 'utf8'), '{ not json');
  });

  it('does not clobber a settings.hooks value of an unexpected shape', () => {
    const home = makeHome();
    writeSettings(home, { hooks: ['not', 'an', 'object'] });

    const result = runInstall({ home });
    assert.equal(result.status, 0, result.stdout);
    assert.deepEqual(readSettings(home).hooks, ['not', 'an', 'object']);
  });
});

describe('install.sh — no supported environment', () => {
  it('exits non-zero with guidance when nothing is detected', () => {
    const result = runInstall({ home: makeHome([]) });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /No supported AI coding environments detected/);
  });
});

// ── install.sh: atomic writes ───────────────────────────────────────

describe('install.sh — atomic writes', () => {
  it('leaves the previously installed file intact when a transfer fails mid-write', () => {
    const home = makeHome();
    runInstall({ home });

    const pushPath = path.join(home, '.claude', 'commands', 'do', 'push.md');
    const before = fs.readFileSync(pushPath, 'utf8');
    assert.ok(before.length > 100, 'sanity: push.md should have real content');

    const remote = runScript(remoteModeInstaller(), { home, pathPrefix: makeFailingCurl() });

    // A failed fetch is reported per file, and a Claude install that cannot
    // register its hooks now fails closed instead of claiming completion.
    assert.equal(remote.status, 1, remote.stdout);
    assert.match(remote.stdout, /failed/, 'the stubbed curl should make fetches fail');
    assert.doesNotMatch(remote.stdout, /Done!/);

    assert.equal(fs.readFileSync(pushPath, 'utf8'), before, 'push.md must not be truncated by a failed fetch');
    assert.doesNotMatch(fs.readFileSync(pushPath, 'utf8'), /TRUNCATED/);
  });

  it('cleans up its staging temp files after a failed transfer, in both destinations and TMPDIR', () => {
    const home = makeHome(['.claude', '.config/opencode']);
    const tmpdir = makeTmpdir();
    runInstall({ home, tmpdir: makeTmpdir() });

    runScript(remoteModeInstaller(), { home, tmpdir, pathPrefix: makeFailingCurl() });

    for (const dir of claudeSubdirs(home)) {
      assert.deepEqual(strayTempFiles(dir), [], `${dir} should have no leftover .slashdo-tmp.* files`);
    }
    for (const dir of ['commands', 'lib']) {
      assert.deepEqual(strayTempFiles(path.join(home, '.config', 'opencode', dir)), [], `opencode/${dir} leftovers`);
    }
    assert.deepEqual(fs.readdirSync(tmpdir), [], 'the OpenCode staging dir should be removed even when fetches fail');
  });

  it('fails closed when hook registration cannot fetch its shared module', () => {
    const home = makeHome();
    const remote = runScript(remoteModeInstaller(), {
      home,
      pathPrefix: makeServingCurlWithoutSettingsHooks(),
    });

    assert.equal(remote.status, 1, remote.stdout);
    assert.match(remote.stdout, /could not fetch src\/settings-hooks\.js/);
    assert.doesNotMatch(remote.stdout, /Done!/);
  });

  it('fails closed when either required hook file cannot download', () => {
    const home = makeHome();
    const remote = runScript(remoteModeInstaller(), {
      home,
      pathPrefix: makeServingCurlWithoutHook('slashdo-check-update'),
    });

    assert.equal(remote.status, 1, remote.stdout);
    assert.match(remote.stdout, /hooks\/slashdo-check-update\.js|hook\/slashdo-check-update\.js/);
    assert.doesNotMatch(remote.stdout, /Done!/);
    assert.equal(fs.existsSync(path.join(home, '.claude', 'settings.json')), false,
      'settings must not be registered when the SessionStart hook is missing');
  });

  it('removes the in-flight temp file when the install is interrupted', { timeout: 60000 }, async () => {
    const home = makeHome();
    runInstall({ home });

    const cmdDir = path.join(home, '.claude', 'commands', 'do');
    const pushPath = path.join(cmdDir, 'push.md');
    const before = fs.readFileSync(pushPath, 'utf8');

    const child = spawn('bash', [remoteModeInstaller()], {
      env: childEnv({ home, pathPrefix: makeHangingCurl() }),
      detached: true,
      stdio: 'ignore',
    });
    const exited = new Promise((resolve) => child.on('exit', resolve));

    try {
      // Wait until the private staging directory exists, so the signal lands
      // while a write is genuinely in flight rather than before or after it.
      const deadline = Date.now() + 20000;
      while (stagingDirs(home).length === 0 && Date.now() < deadline) await sleep(25);
      assert.ok(stagingDirs(home).length > 0, 'expected an in-flight staging directory to interrupt');

      process.kill(-child.pid, 'SIGTERM');
      await Promise.race([exited, sleep(20000)]);
    } finally {
      // Never leave a detached installer (or its hanging curl) behind holding
      // the sandbox open past the after() hook.
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
    }

    assert.deepEqual(strayTempFiles(cmdDir), [], 'the interrupted temp file should be cleaned up');
    assert.deepEqual(stagingDirs(home), [], 'the interrupted private staging directory should be cleaned up');
    assert.equal(fs.readFileSync(pushPath, 'utf8'), before, 'the previously installed file must survive');
  });
});

// ── install.sh: temp file safety ────────────────────────────────────

describe('install.sh — temp file safety', () => {
  it('derives every temp path from mktemp, never a literal', () => {
    // Strip comments so the rule reads the code, not the prose explaining it.
    const code = fs.readFileSync(INSTALL_SH, 'utf8')
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n');
    assert.doesNotMatch(code, /\/tmp\/slashdo/, 'staging must not use a predictable /tmp/slashdo-* name');
    assert.match(code, /mktemp -d "\$\{TMPDIR:-\/tmp\}\/slashdo-install\.XXXXXX"/, 'staging dir must come from mktemp -d');
    assert.match(code, /mktemp "\$\(dirname "\$dest"\)\/\.slashdo-tmp\.XXXXXX"/, 'file staging must come from mktemp');
  });

  it('never writes through a pre-existing path in TMPDIR', () => {
    const home = makeHome(['.claude', '.config/opencode']);
    const tmpdir = makeTmpdir();
    // The names the installer used to hard-code, plus the current prefix.
    const decoys = [
      ...COMMANDS.map((c) => `slashdo-${c}.md`),
      ...LIBS.map((l) => `slashdo-lib-${l}.md`),
      'slashdo-install.XXXXXX',
    ];
    for (const name of decoys) fs.writeFileSync(path.join(tmpdir, name), 'DECOY\n');

    const result = runInstall({ home, tmpdir });
    assert.equal(result.status, 0, result.stdout);

    for (const name of decoys) {
      assert.equal(fs.readFileSync(path.join(tmpdir, name), 'utf8'), 'DECOY\n', `${name} must not be written through`);
    }
    assert.deepEqual(fs.readdirSync(tmpdir).sort(), decoys.slice().sort(), 'no staging leftovers beside the decoys');
  });

  it('does not claim success when the staging directory cannot be created', { skip: process.getuid && process.getuid() === 0 ? 'root ignores directory permissions' : false }, () => {
    const home = makeHome(['.config/opencode']);
    const tmpdir = makeTmpdir();
    fs.chmodSync(tmpdir, 0o500); // readable and traversable, but not writable
    try {
      const result = runScript(INSTALL_SH, { home, tmpdir });
      assert.equal(result.status, 1, 'a staging failure must propagate to the installer exit status');
      assert.match(result.stdout, /could not create a temp directory/);
      assert.doesNotMatch(result.stdout, /Done!/, 'a zero-file install must not report success');
    } finally {
      fs.chmodSync(tmpdir, 0o700);
    }
  });

  it('removes its staging directory on exit', () => {
    const home = makeHome(['.claude', '.config/opencode']);
    const tmpdir = makeTmpdir();

    const result = runInstall({ home, tmpdir });
    assert.equal(result.status, 0, result.stdout);
    assert.deepEqual(fs.readdirSync(tmpdir), [], 'TMPDIR should be empty after the install');
  });

  it('two installs sharing one TMPDIR do not corrupt each other', async () => {
    const tmpdir = makeTmpdir();
    const homes = [makeHome(['.claude', '.config/opencode']), makeHome(['.claude', '.config/opencode'])];

    await Promise.all(homes.map((home) => new Promise((resolve, reject) => {
      execFile('bash', [INSTALL_SH], { env: childEnv({ home, tmpdir }) }, (err) => (err ? reject(err) : resolve()));
    })));

    for (const home of homes) {
      for (const cmd of COMMANDS) {
        assert.equal(
          fs.readFileSync(path.join(home, '.config', 'opencode', 'commands', `do-${cmd}.md`), 'utf8'),
          rewriteForOpencode(readRepo('commands', 'do', `${cmd}.md`)),
          `do-${cmd}.md must be complete after a concurrent install`
        );
      }
    }
    assert.deepEqual(fs.readdirSync(tmpdir), [], 'both staging dirs should be cleaned up');
  });
});

// ── install.sh vs src/installer.js: settings.json parity ────────────

describe('install.sh / src/installer.js settings.json parity', () => {
  // install.sh embeds its own copy of the hook-merging logic because the curl
  // path cannot require() src/installer.js. These cases pin the two together.
  const SCENARIOS = [
    ['fresh settings.json', null],
    ['existing custom statusline', { statusLine: { type: 'command', command: 'node /my/own/statusline.js' } }],
    ['existing unrelated SessionStart hook', {
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo user-hook' }] }] },
    }],
    ['existing unrelated hook event', {
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo pre' }] }] },
    }],
    ['multiple SessionStart groups', {
      hooks: {
        SessionStart: [
          { matcher: 'startup', hooks: [{ type: 'command', command: 'echo a' }] },
          { hooks: [{ type: 'command', command: 'echo b' }] },
        ],
      },
    }],
    ['settings.hooks of an unexpected shape', { hooks: ['nope'] }],
    ['settings.hooks as a string', { hooks: 'nope' }],
    ['settings.hooks as null', { hooks: null }],
    ['settings.hooks as a number', { hooks: 0 }],
    ['SessionStart of an unexpected shape', { hooks: { SessionStart: { nope: true } } }],
    ['SessionStart as null', { hooks: { SessionStart: null } }],
    ['unparseable settings.json', '{ not json'],
  ];

  // Both writers embed absolute hook paths; swap the sandbox root for a token
  // so only the structural result is compared.
  const normalize = (text, home) => text.split(path.join(home, '.claude')).join('<CLAUDE>');

  function claudeEnvFor(home) {
    return {
      ...ENVIRONMENTS.claude,
      commandsDir: path.join(home, '.claude', 'commands'),
      libDir: path.join(home, '.claude', 'lib'),
      hooksDir: path.join(home, '.claude', 'hooks'),
      settingsFile: settingsPathOf(home),
      versionFile: path.join(home, '.claude', '.slashdo-version'),
      configFile: path.join(home, '.claude', '.slashdo-config.json'),
    };
  }

  function seed(home, initial) {
    if (initial === null) return;
    fs.writeFileSync(
      settingsPathOf(home),
      typeof initial === 'string' ? initial : JSON.stringify(initial, null, 2) + '\n'
    );
  }

  for (const [label, initial] of SCENARIOS) {
    it(`produces the same settings.json as the npm installer — ${label}`, () => {
      const shHome = makeHome();
      seed(shHome, initial);
      const shResult = runInstall({ home: shHome });
      assert.equal(shResult.status, 0, shResult.stdout);

      const jsHome = makeHome();
      seed(jsHome, initial);
      npmInstall({ env: claudeEnvFor(jsHome), packageDir: REPO_ROOT, dryRun: false, autoUpdate: true });

      assert.equal(
        fs.existsSync(settingsPathOf(shHome)),
        fs.existsSync(settingsPathOf(jsHome)),
        'both should agree on whether settings.json exists'
      );
      if (!fs.existsSync(settingsPathOf(shHome))) return;

      assert.equal(
        normalize(fs.readFileSync(settingsPathOf(shHome), 'utf8'), shHome),
        normalize(fs.readFileSync(settingsPathOf(jsHome), 'utf8'), jsHome),
        `${label}: curl installer and npm installer diverged`
      );
    });
  }
});

// ── uninstall.sh ────────────────────────────────────────────────────

describe('uninstall.sh — Claude Code', () => {
  it('removes everything install.sh put in place', () => {
    const home = makeHome();
    runInstall({ home });

    const result = runUninstall({ home });
    assert.equal(result.status, 0, result.stdout);

    for (const cmd of COMMANDS) {
      assert.ok(!fs.existsSync(path.join(home, '.claude', 'commands', 'do', `${cmd}.md`)), `${cmd}.md should be gone`);
    }
    for (const lib of LIBS) {
      assert.ok(!fs.existsSync(path.join(home, '.claude', 'lib', `${lib}.md`)), `${lib}.md should be gone`);
    }
    for (const hook of HOOKS) {
      assert.ok(!fs.existsSync(path.join(home, '.claude', 'hooks', `${hook}.js`)), `${hook}.js should be gone`);
    }
    assert.ok(!fs.existsSync(path.join(home, '.claude', '.slashdo-config.json')));
  });

  it('keeps files it does not own', () => {
    const home = makeHome();
    runInstall({ home });
    const mine = path.join(home, '.claude', 'commands', 'do', 'my-own-command.md');
    const myLib = path.join(home, '.claude', 'lib', 'my-own-lib.md');
    fs.writeFileSync(mine, 'mine\n');
    fs.writeFileSync(myLib, 'mine\n');

    runUninstall({ home });
    assert.equal(fs.readFileSync(mine, 'utf8'), 'mine\n');
    assert.equal(fs.readFileSync(myLib, 'utf8'), 'mine\n');
  });

  it('deregisters only slashdo hooks, preserving user hooks in the same group', () => {
    const home = makeHome();
    runInstall({ home });

    const settings = readSettings(home);
    settings.hooks.SessionStart[0].hooks.push({ type: 'command', command: 'echo user-hook' });
    settings.hooks.SessionStart.push({ hooks: [{ type: 'command', command: 'echo other-group' }] });
    settings.hooks.PreToolUse = [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo pre' }] }];
    writeSettings(home, settings);

    runUninstall({ home });

    const after = readSettings(home);
    const commands = after.hooks.SessionStart.flatMap((g) => g.hooks.map((h) => h.command));
    assert.deepEqual(commands, ['echo user-hook', 'echo other-group']);
    assert.deepEqual(after.hooks.PreToolUse, [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo pre' }] }]);
    assert.ok(!('statusLine' in after), 'slashdo statusline should be removed');
  });

  it('drops the hooks key entirely when slashdo was the only hook', () => {
    const home = makeHome();
    runInstall({ home });

    runUninstall({ home });
    assert.ok(!('hooks' in readSettings(home)), 'empty hooks object should not be left behind');
  });

  it('preserves a statusline slashdo does not own', () => {
    const home = makeHome();
    writeSettings(home, { statusLine: { type: 'command', command: 'node /my/own/statusline.js' } });
    runInstall({ home });

    runUninstall({ home });
    assert.equal(readSettings(home).statusLine.command, 'node /my/own/statusline.js');
  });

  it('restores gsd-statusline when its hook file is still present', () => {
    const home = makeHome();
    const hooksDir = path.join(home, '.claude', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(hooksDir, 'gsd-statusline.js'), '// legacy\n');
    writeSettings(home, {
      statusLine: { type: 'command', command: `node "${path.join(hooksDir, 'gsd-statusline.js')}"` },
    });

    runInstall({ home });
    assert.match(readSettings(home).statusLine.command, /slashdo-statusline\.js/);

    runUninstall({ home });
    assert.match(readSettings(home).statusLine.command, /gsd-statusline\.js/);
  });

  it('leaves an unparseable settings.json untouched, and removes nothing', () => {
    const home = makeHome();
    runInstall({ home });
    fs.writeFileSync(settingsPathOf(home), '{ not json');

    const result = runUninstall({ home });
    // Deleting the hook files while settings.json still names them would make
    // Claude Code error on every session start, so nothing is removed.
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stdout, /parse error/);
    assert.match(result.stdout, /nothing was removed/);
    assert.equal(fs.readFileSync(settingsPathOf(home), 'utf8'), '{ not json');
    assert.ok(fs.existsSync(path.join(home, '.claude', 'hooks', 'slashdo-check-update.js')),
      'hooks named by a settings.json we could not edit must survive');
  });

  it('reports nothing to remove on a clean Claude directory', () => {
    const result = runUninstall({ home: makeHome() });
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, /nothing to remove/);
  });

  it('exits cleanly when no environment is present', () => {
    const result = runUninstall({ home: makeHome([]) });
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, /Nothing to uninstall/);
  });
});

describe('uninstall.sh — OpenCode', () => {
  it('removes the rewritten OpenCode commands and libs', () => {
    const home = makeHome(['.claude', '.config/opencode']);
    runInstall({ home });

    const result = runUninstall({ home });
    assert.equal(result.status, 0, result.stdout);

    for (const cmd of COMMANDS) {
      assert.ok(
        !fs.existsSync(path.join(home, '.config', 'opencode', 'commands', `do-${cmd}.md`)),
        `do-${cmd}.md should be gone`
      );
    }
    for (const lib of LIBS) {
      assert.ok(!fs.existsSync(path.join(home, '.config', 'opencode', 'lib', `${lib}.md`)), `${lib}.md should be gone`);
    }
  });
});
