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
    // "Never opens a spool file" is unsatisfiable on the =<20 inline path, which has
    // no body to file unless it reads one — so the rule is that a body is never
    // *rewritten*, and the inline path lifts it verbatim into --body-file.
    assert.match(partial, /\*\*The orchestrator never \*rewrites\* a spooled\nbody\*\*/);
    for (const body of [readCommand('better.md'), readCommand('better-swift.md')]) {
      assert.match(body, /still lifting each id's block verbatim out of its spool file/);
      assert.match(body, /still `--body-file`ing each block\nverbatim out of the spool/);
    }
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

  it('sends the spooled bodies on to the remediation workers', () => {
    // --issues explicitly does not change what the run does, so remediation still runs.
    // Its {FINDINGS} block is built by the orchestrator, which now holds only index
    // lines — a worker handed those alone remediates from a bare one-line title.
    for (const body of [readCommand('better.md'), readCommand('better-swift.md')]) {
      assert.match(body, /\*\*In issue mode the finding bodies are on disk, not in this context\.\*\*/);
      // <slug> not <category-slug>: Conflict avoidance merges two categories into one
      // worker, so it must open every spool file its ids name, not just its own.
      assert.match(body, /read the full body for each of its ids out of `\$SPOOL_DIR\/<slug>\.md`, where/);
      assert.match(body, /must open every spool file its ids name/);
      // 4c.1 triages on a [VACUOUS]/[WEAK]/[MISSING] tag the index line does not carry,
      // so that phase cannot run off the index at all.
      assert.match(body, /carries no `\[VACUOUS\]`\/`\[WEAK\]`\/`\[MISSING\]` tag at all/);
      assert.match(body, /Read `\$SPOOL_DIR\/tests\.md`/);
    }
  });

  it('keeps the spool alive until the phases that read it have returned', () => {
    // Filing is not the end of the run: a remediating --issues run reads these same
    // bodies again in Phase 3c and Phase 4c, so deleting the directory at the end of
    // Phase 2 leaves every downstream worker with an empty path.
    assert.match(partial, /only once nothing\ndownstream still needs the bodies/);
    assert.match(partial, /a `--scan-only` run may remove it as soon as the report\nis printed/);
    for (const body of [readCommand('better.md'), readCommand('better-swift.md')]) {
      assert.match(body, /must not be removed until Phase 4c has returned/);
    }
  });

  it('bounds the fan-out at one filer per category and retries rate limits', () => {
    assert.match(partial, /never shard a single category across agents/);
    assert.match(partial, /sleep\n60s and retry that one issue, up to 3 attempts/);
  });
});
