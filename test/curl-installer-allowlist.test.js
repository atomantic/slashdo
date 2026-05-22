'use strict';

// Guard against silent drift between lib/ and the curl-installer allowlists.
//
// install.sh and uninstall.sh hard-code a LIBS array. When a new lib/*.md is
// added without updating both arrays, curl-installed users get a broken
// command (the file is never copied; the command spec's `!cat ~/.claude/lib/<name>.md`
// fails at runtime). The npm installer (src/installer.js) enumerates lib/
// dynamically, so it doesn't catch this drift — only this test does.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');

function parseLibsArray(shellScriptPath) {
  const content = fs.readFileSync(shellScriptPath, 'utf8');
  // Match LIBS=( ... ) including newlines/whitespace. Comments inside the
  // parens are tolerated — strip them before tokenizing.
  const match = content.match(/^LIBS=\(([\s\S]*?)\)/m);
  if (!match) throw new Error(`LIBS=( ... ) not found in ${shellScriptPath}`);
  return match[1]
    .replace(/#[^\n]*/g, '')
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function libDirEntries() {
  return fs
    .readdirSync(path.join(REPO_ROOT, 'lib'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, ''))
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
