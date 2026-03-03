'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { parseArgs } = require('../bin/cli');

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

  it('empty argv returns defaults', () => {
    const args = parseArgs([]);
    assert.deepEqual(args.envs, []);
    assert.equal(args.list, false);
    assert.equal(args.dryRun, false);
    assert.equal(args.uninstall, false);
    assert.equal(args.help, false);
    assert.deepEqual(args.commands, []);
  });

  it('ignores unknown flags starting with -', () => {
    const args = parseArgs(['--unknown-flag']);
    assert.deepEqual(args.commands, []);
    assert.equal(args.help, false);
  });
});
