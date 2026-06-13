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
