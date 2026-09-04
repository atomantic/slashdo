'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const { parseArgs, printListTable } = require('../bin/cli');

const cliPath = path.resolve(__dirname, '../bin/cli.js');

function captureLog(fn) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    fn();
  } finally {
    console.log = original;
  }
  return lines.join('\n');
}

describe('help output', () => {
  it('preserves the separator when the home directory is the filesystem root', () => {
    const output = execFileSync(process.execPath, [cliPath, '--help'], {
      encoding: 'utf8',
      env: { ...process.env, HOME: path.parse(process.cwd()).root },
    });

    assert.match(output, /\(~[/\\]\.claude[/\\]commands\)/);
  });
});

// ── parseArgs ───────────────────────────────────────────────────────

describe('parseArgs', () => {
  it('--help sets help flag', () => {
    const args = parseArgs(['--help']);
    assert.equal(args.help, true);
  });

  it('-h sets help flag', () => {
    const args = parseArgs(['-h']);
    assert.equal(args.help, true);
  });

  it('--list sets list flag', () => {
    const args = parseArgs(['--list']);
    assert.equal(args.list, true);
  });

  it('--dry-run sets dryRun flag', () => {
    const args = parseArgs(['--dry-run']);
    assert.equal(args.dryRun, true);
  });

  it('--uninstall sets uninstall flag', () => {
    const args = parseArgs(['--uninstall']);
    assert.equal(args.uninstall, true);
  });

  it('--env parses single environment', () => {
    const args = parseArgs(['--env', 'claude']);
    assert.deepEqual(args.envs, ['claude']);
  });

  it('--env parses comma-separated environments', () => {
    const args = parseArgs(['--env', 'claude,opencode']);
    assert.deepEqual(args.envs, ['claude', 'opencode']);
  });

  it('--env trims and lowercases values', () => {
    const args = parseArgs(['--env', ' Claude , OpenCode ']);
    assert.deepEqual(args.envs, ['claude', 'opencode']);
  });

  it('positional args become commands', () => {
    const args = parseArgs(['push', 'pr']);
    assert.deepEqual(args.commands, ['push', 'pr']);
  });

  it('strips do: prefix from commands', () => {
    const args = parseArgs(['do:push', 'do:pr']);
    assert.deepEqual(args.commands, ['push', 'pr']);
  });

  it('combined flags and args', () => {
    const args = parseArgs(['--dry-run', '--env', 'claude', 'push', '--list']);
    assert.equal(args.dryRun, true);
    assert.equal(args.list, true);
    assert.deepEqual(args.envs, ['claude']);
    assert.deepEqual(args.commands, ['push']);
  });

  it('--auto-update sets autoUpdate true', () => {
    const args = parseArgs(['--auto-update']);
    assert.equal(args.autoUpdate, true);
  });

  it('--no-auto-update sets autoUpdate false', () => {
    const args = parseArgs(['--no-auto-update']);
    assert.equal(args.autoUpdate, false);
  });

  it('autoUpdate is undefined when neither flag is passed', () => {
    const args = parseArgs(['--env', 'claude']);
    assert.equal(args.autoUpdate, undefined);
  });

  it('empty argv returns defaults', () => {
    const args = parseArgs([]);
    assert.deepEqual(args.envs, []);
    assert.equal(args.list, false);
    assert.equal(args.dryRun, false);
    assert.equal(args.uninstall, false);
    assert.equal(args.help, false);
    assert.equal(args.autoUpdate, undefined);
    assert.deepEqual(args.commands, []);
  });

  it('ignores unknown flags starting with -', () => {
    const args = parseArgs(['--unknown-flag']);
    assert.deepEqual(args.commands, []);
    assert.equal(args.help, false);
  });
});

// ── printListTable ────────────────────────────────────────────────

describe('printListTable', () => {
  it('appends the missing-dependency note when an item is unhealthy', () => {
    const output = captureLog(() => printListTable([
      { name: '/do:prd', status: 'unhealthy', description: 'PRD generator', missingDependencies: ['goals'] },
    ], 'Test Env'));

    assert.match(output, /\/do:prd\s+unhealthy\s+PRD generator \(requires \/do:goals — not installed for this host\)/);
  });

  it('leaves the description untouched when there are no missing dependencies', () => {
    const output = captureLog(() => printListTable([
      { name: '/do:push', status: 'up to date', description: 'Push and log changes' },
    ], 'Test Env'));

    assert.match(output, /\/do:push\s+up to date\s+Push and log changes$/m);
    assert.ok(!output.includes('requires'));
  });
});
