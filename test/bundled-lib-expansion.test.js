'use strict';

// Every `!cat ~/.claude/lib/<name>.md` shell expansion in a command must resolve on a
// host WITHOUT a global slashdo install. A bundled install (a project vendors slashdo
// at lib/slashdo and symlinks .claude/commands/do/<cmd>.md into it) has no
// ~/.claude/lib, so each expansion carries a fallback that resolves the lib relative to
// the command file's real location:
//   cat ~/.claude/lib/<name>.md 2>/dev/null || cat "$(dirname "$(readlink -f .claude/commands/<rel>)")/<../ x depth>lib/<name>.md"
// This test fails if an expansion lacks that fallback, names a missing lib, or whose
// fallback would not reach the lib from the command's real location.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const COMMANDS_DIR = path.join(ROOT, 'commands');
const LIB_DIR = path.join(ROOT, 'lib');

const EXPANSION_RE = /!`cat ~\/\.claude\/lib\/([A-Za-z0-9._-]+\.md)([^`]*)`/g;

function listMarkdown(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return listMarkdown(path.join(dir, entry.name), rel);
    return entry.name.endsWith('.md') ? [rel] : [];
  });
}

function expansionsIn(rel) {
  const text = fs.readFileSync(path.join(COMMANDS_DIR, rel), 'utf8');
  return [...text.matchAll(EXPANSION_RE)].map(match => ({
    lib: match[1],
    suffix: match[2],
    line: text.slice(0, match.index).split('\n').length,
  }));
}

describe('bundled-install lib expansions', () => {
  const commands = listMarkdown(COMMANDS_DIR);
  const all = commands.flatMap(rel => expansionsIn(rel).map(e => ({ ...e, rel })));

  it('finds lib expansions to check', () => {
    assert.ok(all.length > 0, 'expected at least one !cat ~/.claude/lib/ expansion');
  });

  it('every expansion names a library that ships in lib/', () => {
    for (const { lib, rel, line } of all) {
      assert.ok(fs.existsSync(path.join(LIB_DIR, lib)),
        `commands/${rel}:${line} expands missing lib/${lib}`);
    }
  });

  it('every expansion carries a bundle-relative fallback for the command\'s own real location', () => {
    for (const { lib, rel, suffix, line } of all) {
      const depth = rel.split('/').length; // commands/do/x.md -> 2 hops up to the package root
      const up = '../'.repeat(depth);
      const expected = ` 2>/dev/null || cat "$(dirname "$(readlink -f .claude/commands/${rel})")/${up}lib/${lib}"`;
      assert.equal(suffix, expected,
        `commands/${rel}:${line} has an unresolvable ~/.claude/lib/${lib} expansion `
        + '(no bundled-install fallback, or a fallback that does not match the command path)');
    }
  });

  it('the bundle-relative fallback resolves to the shipped library from the real command path', () => {
    for (const { lib, rel, line } of all) {
      const resolved = path.resolve(COMMANDS_DIR, path.dirname(rel), '../'.repeat(rel.split('/').length) + 'lib', lib);
      assert.ok(fs.existsSync(resolved),
        `commands/${rel}:${line} fallback resolves to missing ${path.relative(ROOT, resolved)}`);
    }
  });
});
