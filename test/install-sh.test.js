'use strict';

// End-to-end tests for the curl installer scripts themselves.
//
// test/curl-installer-allowlist.test.js only diffs the LIBS/COMMANDS bash array
// literals against the repo as text — it never executes either script. These
// tests actually run install.sh and uninstall.sh against a sandbox HOME (the
// same mkdtemp pattern test/installer.test.js uses for the npm path) and assert
// on the resulting filesystem and settings.json state.
//
// LOCAL_MODE: install.sh copies from its sibling commands//lib/ dirs when they
// exist (install.sh:11-16), so running the repo's own script needs no network.
// Tests that must exercise the curl path copy install.sh to a bare directory,
// which flips it to remote mode, and shadow `curl` via PATH.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile, execFileSync } = require('child_process');

const { ENVIRONMENTS } = require('../src/environments');
const { install: npmInstall } = require('../src/installer');

const REPO_ROOT = path.resolve(__dirname, '..');
const INSTALL_SH = path.join(REPO_ROOT, 'install.sh');
const UNINSTALL_SH = path.join(REPO_ROOT, 'uninstall.sh');

// ── Helpers ─────────────────────────────────────────────────────────

const tmpDirs = [];

function makeHome(envDirs = ['.claude']) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'slashdo-sh-'));
  tmpDirs.push(home);
  for (const dir of envDirs) fs.mkdirSync(path.join(home, dir), { recursive: true });
  return home;
}

function makeTmpdir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slashdo-shtmp-'));
  tmpDirs.push(dir);
  return dir;
}

// Run a script with a sandboxed HOME. Returns { status, stdout }; a non-zero
// exit is reported rather than thrown so tests can assert on failure paths.
function runScript(script, { home, tmpdir, pathPrefix } = {}) {
  const env = {
    PATH: pathPrefix ? `${pathPrefix}:${process.env.PATH}` : process.env.PATH,
    HOME: home,
    TMPDIR: tmpdir || home,
  };
  try {
    const stdout = execFileSync('bash', [script], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { status: 0, stdout };
  } catch (e) {
    return { status: e.status, stdout: (e.stdout || '') + (e.stderr || '') };
  }
}

const runInstall = (opts) => runScript(INSTALL_SH, opts);
const runUninstall = (opts) => runScript(UNINSTALL_SH, opts);

function readSettings(home) {
  return JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'));
}

function writeSettings(home, settings) {
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify(settings, null, 2) + '\n');
}

// The bash arrays are the installer's own allowlists; reuse them so these tests
// stay honest when commands or libs are added.
function parseArray(scriptPath, name) {
  const content = fs.readFileSync(scriptPath, 'utf8');
  const match = content.match(new RegExp(`^${name}=\\(([\\s\\S]*?)\\)`, 'm'));
  if (!match) throw new Error(`${name}=( ... ) not found in ${scriptPath}`);
  return match[1].replace(/#[^\n]*/g, '').split(/\s+/).map((s) => s.trim()).filter(Boolean);
}

const COMMANDS = parseArray(INSTALL_SH, 'COMMANDS');
const LIBS = parseArray(INSTALL_SH, 'LIBS');
const HOOKS = ['slashdo-check-update', 'slashdo-statusline'];

function strayTempFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.startsWith('.slashdo-tmp.'));
}

// A `curl` that writes a partial body to the -o target and then fails, standing
// in for a transfer that dies mid-flight.
function makeFailingCurl() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slashdo-bin-'));
  tmpDirs.push(dir);
  const stub = path.join(dir, 'curl');
  fs.writeFileSync(stub, [
    '#!/bin/sh',
    'dest=""; prev=""',
    'for a in "$@"; do',
    '  [ "$prev" = "-o" ] && dest="$a"',
    '  prev="$a"',
    'done',
    '[ -n "$dest" ] && printf TRUNCATED > "$dest"',
    'exit 1',
    '',
  ].join('\n'));
  fs.chmodSync(stub, 0o755);
  return dir;
}

// Copy install.sh somewhere with no sibling commands//lib/, forcing remote mode.
function remoteModeInstaller() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slashdo-remote-'));
  tmpDirs.push(dir);
  const dest = path.join(dir, 'install.sh');
  fs.copyFileSync(INSTALL_SH, dest);
  return dest;
}

after(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

// ── install.sh: Claude Code ─────────────────────────────────────────

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
  });

  it('installs every command in the COMMANDS allowlist', () => {
    for (const cmd of COMMANDS) {
      const file = path.join(home, '.claude', 'commands', 'do', `${cmd}.md`);
      assert.ok(fs.existsSync(file), `${cmd}.md should be installed`);
      assert.equal(
        fs.readFileSync(file, 'utf8'),
        fs.readFileSync(path.join(REPO_ROOT, 'commands', 'do', `${cmd}.md`), 'utf8'),
        `${cmd}.md should be copied verbatim`
      );
    }
  });

  it('installs every lib in the LIBS allowlist', () => {
    for (const lib of LIBS) {
      assert.ok(fs.existsSync(path.join(home, '.claude', 'lib', `${lib}.md`)), `${lib}.md should be installed`);
    }
  });

  it('installs the hook files', () => {
    for (const hook of HOOKS) {
      assert.ok(fs.existsSync(path.join(home, '.claude', 'hooks', `${hook}.js`)), `${hook}.js should be installed`);
    }
  });

  it('installs world-readable files, not mktemp-private ones', () => {
    const mode = fs.statSync(path.join(home, '.claude', 'commands', 'do', 'push.md')).mode & 0o777;
    assert.equal(mode, 0o644);
  });

  it('leaves no staging temp files behind', () => {
    for (const dir of ['commands/do', 'lib', 'hooks']) {
      assert.deepEqual(strayTempFiles(path.join(home, '.claude', ...dir.split('/'))), []);
    }
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

describe('install.sh — Claude Code re-install', () => {
  it('is idempotent: a second run reports "already configured" and leaves settings.json byte-identical', () => {
    const home = makeHome();
    runInstall({ home });
    const settingsPath = path.join(home, '.claude', 'settings.json');
    const first = fs.readFileSync(settingsPath, 'utf8');

    const second = runInstall({ home });
    assert.equal(second.status, 0, second.stdout);
    assert.match(second.stdout, /already configured/);
    assert.equal(fs.readFileSync(settingsPath, 'utf8'), first);
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
    const settingsPath = path.join(home, '.claude', 'settings.json');
    fs.writeFileSync(settingsPath, '{ not json');

    const result = runInstall({ home });
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, /skipped \(settings\.json parse error\)/);
    assert.equal(fs.readFileSync(settingsPath, 'utf8'), '{ not json');
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
    const home = makeHome([]);
    const result = runInstall({ home });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /No supported AI coding environments detected/);
  });
});

// ── install.sh: atomicity (bugs-perf-01) ────────────────────────────

describe('install.sh — atomic writes', () => {
  it('leaves the previously installed file intact when a transfer fails mid-write', () => {
    const home = makeHome();
    runInstall({ home });

    const pushPath = path.join(home, '.claude', 'commands', 'do', 'push.md');
    const before = fs.readFileSync(pushPath, 'utf8');
    assert.ok(before.length > 100, 'sanity: push.md should have real content');

    // Remote mode + a curl that truncates its target and then fails.
    const remote = runScript(remoteModeInstaller(), { home, pathPrefix: makeFailingCurl() });

    assert.match(remote.stdout, /failed/, 'the stubbed curl should make fetches fail');
    assert.equal(fs.readFileSync(pushPath, 'utf8'), before, 'push.md must not be truncated by a failed fetch');
    assert.ok(!fs.readFileSync(pushPath, 'utf8').includes('TRUNCATED'));
  });

  it('cleans up its staging temp files after a failed transfer', () => {
    const home = makeHome();
    runInstall({ home });
    runScript(remoteModeInstaller(), { home, pathPrefix: makeFailingCurl() });

    for (const dir of ['commands/do', 'lib', 'hooks']) {
      assert.deepEqual(
        strayTempFiles(path.join(home, '.claude', ...dir.split('/'))),
        [],
        `${dir} should have no leftover .slashdo-tmp.* files`
      );
    }
  });
});

// ── install.sh: temp file safety (bugs-perf-02 / security-02) ───────

describe('install.sh — temp file safety', () => {
  it('uses no fixed, guessable temp paths', () => {
    // Strip comments so the rule reads the code, not the prose explaining it.
    const code = fs.readFileSync(INSTALL_SH, 'utf8')
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n');
    assert.doesNotMatch(code, /\/tmp\/slashdo/, 'staging must not use a predictable /tmp/slashdo-* name');
    assert.match(code, /mktemp -d/, 'staging directory must come from mktemp');
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
    const baselineHome = makeHome(['.claude', '.config/opencode']);
    runInstall({ home: baselineHome, tmpdir: makeTmpdir() });
    const baseline = fs.readFileSync(
      path.join(baselineHome, '.config', 'opencode', 'commands', 'do-next.md'),
      'utf8'
    );
    assert.ok(baseline.includes('~/.config/opencode/lib/'), 'sanity: OpenCode rewrite should have applied');

    const homes = [makeHome(['.claude', '.config/opencode']), makeHome(['.claude', '.config/opencode'])];
    await Promise.all(homes.map((home) => new Promise((resolve, reject) => {
      execFile('bash', [INSTALL_SH], { env: { PATH: process.env.PATH, HOME: home, TMPDIR: tmpdir } },
        (err) => (err ? reject(err) : resolve()));
    })));

    for (const home of homes) {
      for (const cmd of COMMANDS) {
        const file = path.join(home, '.config', 'opencode', 'commands', `do-${cmd}.md`);
        assert.ok(fs.existsSync(file), `${file} should exist`);
        assert.ok(fs.statSync(file).size > 0, `${file} should not be empty`);
      }
      assert.equal(
        fs.readFileSync(path.join(home, '.config', 'opencode', 'commands', 'do-next.md'), 'utf8'),
        baseline,
        'concurrent installs must produce identical output'
      );
    }
    assert.deepEqual(fs.readdirSync(tmpdir), [], 'both staging dirs should be cleaned up');
  });
});

// ── install.sh vs src/installer.js: settings.json parity (dry-03) ───

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
    ['SessionStart of an unexpected shape', { hooks: { SessionStart: { nope: true } } }],
    ['unparseable settings.json', '{ not json'],
  ];

  // Both writers embed absolute hook paths; swap the sandbox root for a token
  // so only the structural result is compared.
  function normalize(text, home) {
    return text.split(path.join(home, '.claude')).join('<CLAUDE>');
  }

  function claudeEnvFor(home) {
    return {
      ...ENVIRONMENTS.claude,
      commandsDir: path.join(home, '.claude', 'commands'),
      libDir: path.join(home, '.claude', 'lib'),
      hooksDir: path.join(home, '.claude', 'hooks'),
      settingsFile: path.join(home, '.claude', 'settings.json'),
      versionFile: path.join(home, '.claude', '.slashdo-version'),
      configFile: path.join(home, '.claude', '.slashdo-config.json'),
    };
  }

  function seed(home, initial) {
    if (initial === null) return;
    const settingsPath = path.join(home, '.claude', 'settings.json');
    fs.writeFileSync(settingsPath, typeof initial === 'string' ? initial : JSON.stringify(initial, null, 2) + '\n');
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

      const shSettings = path.join(shHome, '.claude', 'settings.json');
      const jsSettings = path.join(jsHome, '.claude', 'settings.json');
      assert.equal(fs.existsSync(shSettings), fs.existsSync(jsSettings), 'both should agree on whether settings.json exists');
      if (!fs.existsSync(shSettings)) return;

      assert.equal(
        normalize(fs.readFileSync(shSettings, 'utf8'), shHome),
        normalize(fs.readFileSync(jsSettings, 'utf8'), jsHome),
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
    fs.writeFileSync(mine, 'mine\n');
    const myLib = path.join(home, '.claude', 'lib', 'my-own-lib.md');
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

  it('leaves an unparseable settings.json untouched', () => {
    const home = makeHome();
    runInstall({ home });
    const settingsPath = path.join(home, '.claude', 'settings.json');
    fs.writeFileSync(settingsPath, '{ not json');

    const result = runUninstall({ home });
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, /parse error/);
    assert.equal(fs.readFileSync(settingsPath, 'utf8'), '{ not json');
  });

  it('reports nothing to remove on a clean Claude directory', () => {
    const home = makeHome();
    const result = runUninstall({ home });
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, /nothing to remove/);
  });

  it('exits cleanly when no environment is present', () => {
    const home = makeHome([]);
    const result = runUninstall({ home });
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
