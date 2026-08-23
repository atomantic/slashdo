'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'commands', 'do');

// A command file is front matter (--- … ---) followed by the body. A spliced-in copy of
// a file's own head — the failure mode of a careless bulk edit, e.g. a JS replacement
// string in which the two-character sequence dollar-backtick expands to "everything
// before the match" — drops a second front-matter block into the middle of the body.
// Left in, the command ships two contradictory sets of instructions that an agent reads
// and acts on, and nothing else in this suite would notice.
//
// Counting `---` alone is not the invariant: goals.md uses horizontal rules legitimately.
// The front-matter KEYS are what must not recur.
const FRONT_MATTER_KEY = /^(description|argument-hint|allowed-tools|model|name):/;

describe('command file structure', () => {
  const files = fs.readdirSync(dir).filter((n) => n.endsWith('.md'));

  it('finds the command files', () => {
    assert.ok(files.length > 10, `expected the do/ command set, got ${files.length}`);
  });

  for (const name of files) {
    it(`${name} carries exactly one front-matter block`, () => {
      const lines = fs.readFileSync(path.join(dir, name), 'utf8').split('\n');
      assert.equal(lines[0], '---', `front matter must open on line 1: ${name}`);
      const close = lines.indexOf('---', 1);
      assert.ok(close > 0, `unterminated front matter in ${name}`);

      const strays = [];
      for (let i = close + 1; i < lines.length; i += 1) {
        if (FRONT_MATTER_KEY.test(lines[i])) strays.push(i + 1);
      }
      assert.deepEqual(
        strays,
        [],
        `front-matter keys reappear after line ${close + 1} in ${name} (lines ` +
          `${strays.join(', ')}) — part of the file was almost certainly spliced in twice`,
      );
    });
  }
});
