'use strict';

// Claude Code treats `$0`, `$1`, ... in a slash-command body as positional-argument
// placeholders, so `/do:next --swarm` rendered `awk ... substr($0, 1, 6)` as
// `substr(--swarm, 1, 6)` (issue #454). Command bodies must carry no `$<digit>`
// token; shell helpers use "$@"/"$*", and awk/field extraction uses cut/sed/grep.
// lib/ partials are not argument-expanded, so they are out of scope.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const commandsDir = path.join(__dirname, '..', 'commands');

function mdFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return mdFiles(full);
    return entry.name.endsWith('.md') ? [full] : [];
  });
}

describe('command bodies carry no positional $<digit> tokens', () => {
  for (const file of mdFiles(commandsDir)) {
    it(path.relative(commandsDir, file), () => {
      const hits = fs.readFileSync(file, 'utf8').split('\n')
        .map((line, i) => ({ line, n: i + 1 }))
        .filter(({ line }) => /\$[0-9]/.test(line))
        .map(({ line, n }) => `${n}: ${line.trim()}`);
      assert.deepEqual(hits, [], 'rewrite with "$@" / "$*" or cut/sed/grep');
    });
  }
});

describe('in_flight() matcher (next.md), executed', () => {
  const next = fs.readFileSync(path.join(commandsDir, 'do', 'next.md'), 'utf8');
  const def = next.split('\n').find((line) => line.startsWith('in_flight() {'));
  const check = (refs, id) => execFileSync('sh', ['-c',
    `IN_FLIGHT_REFS='${refs.join('\n')}'\n${def}\nin_flight '${id}' && echo HIT || echo MISS\n`],
  { encoding: 'utf8' }).trim() === 'HIT';

  it('detects issue-12 but not issue-123, feature/12, or a Jira neighbor', () => {
    assert.ok(check(['origin/next/issue-12'], '12'));
    assert.ok(!check(['next/issue-123'], '12'));
    assert.ok(!check(['feature/12'], '12'));
    assert.ok(check(['next/issue-proj-12'], 'PROJ-12'));
    assert.ok(!check(['next/issue-PROJ-123'], 'PROJ-12'));
  });
});
