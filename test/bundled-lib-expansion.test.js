'use strict';

// Every `!cat ~/.claude/lib/<name>.md` shell expansion in a command or lib partial must
// resolve on a host WITHOUT a global slashdo install. A bundled install (a project
// vendors slashdo at lib/slashdo and symlinks .claude/commands/do/<cmd>.md into it) has
// no ~/.claude/lib, so each expansion carries a fallback that resolves the lib relative
// to the real location of the command that runs it:
//   cat ~/.claude/lib/<name>.md 2>/dev/null || cat "$(dirname "$(readlink -f .claude/commands/<cmd>.md)")/../../lib/<name>.md"
// A command runs its own expansions; a lib partial's expansions run through the command
// that reads it (`!read lib/<partial>`), so the named command must include that partial.
// This test fails on a missing fallback, a fallback naming a missing command, a fallback
// that does not reach the lib from the command's real location, or a lib partial whose
// caller does not include it.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const COMMANDS_DIR = path.join(ROOT, 'commands');
const LIB_DIR = path.join(ROOT, 'lib');

const EXPANSION_RE = /!`cat ~\/\.claude\/lib\/([A-Za-z0-9._-]+\.md)([^`]*)`/g;
const FALLBACK_RE = /^ 2>\/dev\/null \|\| cat "\$\(dirname "\$\(readlink -f \.claude\/commands\/([A-Za-z0-9._\/-]+\.md)\)"\)\/((?:\.\.\/)+)lib\/([A-Za-z0-9._-]+\.md)"$/;

function listMarkdown(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return listMarkdown(path.join(dir, entry.name), rel);
    return entry.name.endsWith('.md') ? [rel] : [];
  });
}

// Every expansion under commands/ and lib/, with the file it lives in (relative to ROOT).
function allExpansions() {
  const sources = [
    ...listMarkdown(COMMANDS_DIR).map(rel => ({ file: `commands/${rel}`, abs: path.join(COMMANDS_DIR, rel) })),
    ...listMarkdown(LIB_DIR).map(rel => ({ file: `lib/${rel}`, abs: path.join(LIB_DIR, rel) })),
  ];
  return sources.flatMap(({ file, abs }) => {
    const text = fs.readFileSync(abs, 'utf8');
    return [...text.matchAll(EXPANSION_RE)].map(match => ({
      file,
      lib: match[1],
      suffix: match[2],
      line: text.slice(0, match.index).split('\n').length,
    }));
  });
}

describe('bundled-install lib expansions', () => {
  const all = allExpansions();

  it('finds lib expansions to check', () => {
    assert.ok(all.length > 0, 'expected at least one !cat ~/.claude/lib/ expansion');
  });

  it('every expansion names a library that ships in lib/', () => {
    for (const { lib, file, line } of all) {
      assert.ok(fs.existsSync(path.join(LIB_DIR, lib)), `${file}:${line} expands missing lib/${lib}`);
    }
  });

  it('every expansion carries a fallback that resolves from the real location of its named command', () => {
    for (const { file, lib, suffix, line } of all) {
      const match = FALLBACK_RE.exec(suffix);
      assert.ok(match, `${file}:${line} has an unresolvable ~/.claude/lib/${lib} expansion (no bundled-install fallback)`);
      const [, cmdRel, up, fallbackLib] = match;
      assert.equal(fallbackLib, lib, `${file}:${line} fallback names lib/${fallbackLib}, not lib/${lib}`);

      const cmdAbs = path.join(COMMANDS_DIR, cmdRel);
      assert.ok(fs.existsSync(cmdAbs), `${file}:${line} fallback names missing command commands/${cmdRel}`);
      const resolved = path.resolve(path.dirname(cmdAbs), up + 'lib', lib);
      assert.ok(fs.existsSync(resolved), `${file}:${line} fallback resolves to missing ${path.relative(ROOT, resolved)}`);
      assert.equal(resolved, path.join(LIB_DIR, lib), `${file}:${line} fallback does not reach lib/${lib}`);

      if (file.startsWith('commands/')) {
        assert.equal(`commands/${cmdRel}`, file,
          `${file}:${line} fallback must name its own command file, not commands/${cmdRel}`);
      } else {
        const callerText = fs.readFileSync(cmdAbs, 'utf8');
        const partial = path.basename(file);
        assert.ok(callerText.includes(`lib/${partial}`),
          `${file}:${line} is a lib partial, but its fallback caller commands/${cmdRel} never includes lib/${partial}`);
      }
    }
  });
});
