'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const readCommand = (name) => fs.readFileSync(path.join(root, 'commands', 'do', name), 'utf8');
const partial = fs.readFileSync(path.join(root, 'lib', 'plan-issue-mode.md'), 'utf8');

// `--issues` at audit scale spools each finding's ready-to-file body to disk and
// returns only an index line, so the orchestrator never re-emits a body it would
// truncate. These contracts pin the parts of that path whose failure is silent:
// a spool file the filers can't find, or one an agent overwrote.
describe('bulk issue-filing spool contracts', () => {
  it('tells the orchestrator to carry the printed spool path, not re-derive it', () => {
    // mktemp -d in a later Bash call makes a DIFFERENT directory, so the filer
    // agents would look in an empty one and report every finding as missing.
    for (const body of [partial, readCommand('better.md'), readCommand('better-swift.md')]) {
      assert.match(body, /SPOOL_DIR="\$\(mktemp -d "\$\{TMPDIR:-\/tmp\}\/slashdo-issues-XXXXXX"\)"; echo "\$SPOOL_DIR"/);
    }
    assert.match(partial, /Record the printed path in run state/);
  });

  it('keeps SPOOL_DIR in both audit commands\' compaction-survival lists', () => {
    // Compaction mid-audit that drops SPOOL_DIR strands every spooled body.
    for (const name of ['better.md', 'better-swift.md']) {
      assert.match(readCommand(name), /^- `SPOOL_DIR` \(issue mode only/m, name);
    }
  });

  it('requires appending after the first spool write', () => {
    // An agent spooling across more than one Bash call that reaches for `cat >`
    // again truncates everything already written — the exact tail-dropping the
    // spool path exists to prevent.
    for (const body of [readCommand('better.md'), readCommand('better-swift.md')]) {
      assert.match(body, /every later one must use `>>`/);
    }
    assert.match(partial, /`cat >` once, `cat >>` thereafter/);
  });

  it('keeps the finding bodies out of the orchestrator', () => {
    assert.match(partial, /\*\*The orchestrator never opens a spool file\.\*\*/);
    assert.match(partial, /\*\*A filer never rewrites a\nbody\*\*/);
  });

  it('never reports an errored finding as filed', () => {
    // A filer that hit a rate limit or a malformed block filed nothing; counting
    // it as created loses the finding with no trace.
    assert.match(partial, /\*\*Any id\nthat came back `ERROR` was not filed\*\*/);
    assert.match(partial, /Leave\n`SPOOL_DIR` on disk when any error occurred/);
    for (const body of [readCommand('better.md'), readCommand('better-swift.md')]) {
      assert.match(body, /\*\*An id a filer returned as `ERROR` was not\nfiled\*\*/);
    }
  });

  it('bounds the fan-out at one filer per category and retries rate limits', () => {
    assert.match(partial, /never shard a single category across agents/);
    assert.match(partial, /sleep\n60s and retry that one issue, up to 3 attempts/);
  });
});
