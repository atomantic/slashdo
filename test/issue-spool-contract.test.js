'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { inlineLibContent } = require('../src/transformer');

const root = path.join(__dirname, '..');
// The spool contract is on the command as an agent actually reads it, which now
// includes the shared `lib/better-*.md` pipeline partials the audit commands
// `!cat`. Resolve those includes so a contract keeps holding wherever the prose
// lives — inline in the command, or in a partial both commands share.
const readCommand = (name) => {
  const raw = fs.readFileSync(path.join(root, 'commands', 'do', name), 'utf8');
  return inlineLibContent(raw, path.join(root, 'lib'));
};
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
      assert.match(body, /the bodies are read four times/);
      assert.match(body, /is removed in Phase 7, not before/);
      // ...and something must actually remove it: the partial delegates removal to the
      // command, so with no removal step every --issues run leaks a directory holding
      // the full text of every finding.
      assert.match(body, /\*\*Issue mode — remove the spool\.\*\*/);
      assert.match(body, /rm -rf "\$SPOOL_DIR"/);
      assert.match(body, /\*\*Unless any filer returned `ERROR`\*\*/);
      // A scan-only run has no Phase 3c/4c, so filing is its last read.
      assert.match(body, /a scan-only run has no Phase 3c or 4c to read the bodies/);
    }
  });

  it('names what delimits a spooled block', () => {
    // A body's quoted evidence can legitimately contain "## " lines inside a fence, so
    // a filer splitting on a bare ^## truncates the body and files a partial issue —
    // the exact truncation the spool path exists to prevent.
    assert.match(partial, /A \*\*block\*\* runs from a line matching/);
    assert.match(partial, /\*\*not a bare `\^## `\*\*/);
    assert.match(partial, /No line inside a body may begin with `## \[` at\ncolumn 0/);
  });

  it('reads the DRY bodies for the Foundation grouping', () => {
    // Phase 2 step 3 groups shared-utility extractions, which needs duplication counts
    // and call-site lists that exist only in the bodies — and Phase 3b, which builds
    // from that list, is run by the orchestrator itself.
    for (const body of [readCommand('better.md'), readCommand('better-swift.md')]) {
      assert.match(body, /\*\*Step 3 is the exception\*\*/);
      assert.match(body, /read `\$SPOOL_DIR\/dry\.md`/);
    }
  });

  it('bounds the fan-out at one filer per category and retries rate limits', () => {
    assert.match(partial, /never shard a single category across agents/);
    assert.match(partial, /sleep\n60s and retry that one issue, up to 3 attempts/);
  });
});
