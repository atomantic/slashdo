'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
// A command's contract spans the file plus the lib docs it includes (`!read` and
// `!cat` alike): those are one document to the agent, so a cross-reference fix
// belongs in the same check as everything else it points at.
const { readCommandDocs } = require('./helpers/command-docs');

const root = path.join(__dirname, '..');
const next = readCommandDocs('next.md', { eager: true });
const swarm = fs.readFileSync(path.join(root, 'lib', 'next-swarm.md'), 'utf8');

// Regression tests for #296: next.md / next-swarm.md carried stale cross-references
// left over from the lib/plan-issue-mode.md split and the next-swarm.md extraction.
// Each check below pins the corrected text so the drift can't silently return.
describe('#296 — Phase 7 "Abandoned a claim" teardown', () => {
  it('names Phase 2 abort/yield alongside Phase 3 skip / Phase 3.5 reject in the heading', () => {
    // The old heading only listed "Phase 3 skip / Phase 3.5 reject", even though the
    // Phase 2 claim-failed hard-stop and the race-lost yield also land on this same
    // teardown block for their local worktree/branch cleanup.
    assert.match(
      next,
      /\*\*Abandoned a claim \(Phase 2 abort\/yield, Phase 3 skip, or Phase 3\.5 reject — no PR, work discarded\)\?\*\*/,
    );
  });

  it('describes Phase 2 abort/yield as retracting the remote branch inline, not doing the full teardown', () => {
    // The stale note claimed Phase 2's abort branches did "the same teardown inline,
    // before any branch is published" — wrong on both counts: the claim branch IS
    // published (pushed) before the assignee step, and the abort/yield branches only
    // retract the REMOTE branch inline, leaving local worktree/branch cleanup to this
    // block (run from the main repo, not from inside the worktree).
    assert.doesNotMatch(
      next,
      /Issues-mode abort branches in Phase 2 do the same teardown inline, before any branch is published/,
    );
    assert.match(
      next,
      /Phase 2's abort\/yield branches[\s\S]*?retract the remote branch inline[\s\S]*?leave the local worktree and branch for this same teardown, run from the main repo/,
    );
  });

  it('drops the dead --auto-merge polling clause from the PR-merged read-back', () => {
    // Phase 6 never merges with --auto-merge (GitHub waits on required CI then merges
    // directly; GitLab waits on the pipeline then merges) — the "if you nonetheless
    // merged with --auto-merge, poll every 30s..." clause described dead guidance for
    // a code path Phase 6 forbids.
    assert.doesNotMatch(next, /if you nonetheless merged with `--auto-merge`/);
    assert.doesNotMatch(next, /poll every 30s for up to 30 minutes/);
  });
});

describe('#296 — Phase 7 parent-epic re-evaluation', () => {
  it('no longer claims lib/epic-children.md is inlined in Phase 1', () => {
    // Phase 1 step 3 only `!read`s lib/epic-children.md on demand, when a candidate is
    // itself an epic — a run that ships a non-epic issue never loads it, so "inlined in
    // Phase 1" falsely told the model the content was already in context.
    assert.doesNotMatch(next, /inlined in Phase 1/);
  });

  it('tells the model to read epic-children.md now if this run never loaded it', () => {
    assert.match(
      next,
      /read that file now if this run never loaded it \(Phase 1 step 3 only reads it on-demand/,
    );
  });
});

describe('#296 — next-swarm.md A1 delegates to Phase 1 issues mode by name, not "below"', () => {
  it('does not claim Phase 1 — issues mode is "below" (next-swarm.md is a separate file)', () => {
    assert.doesNotMatch(swarm, /Phase 1 — issues mode\*\* below/);
  });

  it('explicitly runs next.md\'s Phase 1 — issues mode section to build the queue', () => {
    assert.match(
      swarm,
      /A1 — Build the eligible queue by running `next\.md`'s `### Phase 1 — issues mode`/,
    );
    assert.match(
      swarm,
      /its shared issue-mode setup read, GitLab `jq` probe, the collaborator fetch when `COLLAB_MODE` is on, then steps 1–4/,
    );
  });
});

describe('#296 — next-swarm.md jq probe no longer contradicts "reuse Phase 1 verbatim"', () => {
  it('scopes the "Phase 1 probe never runs" framing to the A1e explicit-list path', () => {
    // The old text said "Swarm replaces Phases 1-7, so the Phase 1 probe never runs" —
    // true only for A1e (the explicit-list path, which never runs Phase 1's own setup);
    // A1's auto-pick path now explicitly runs that setup (including its jq probe).
    assert.doesNotMatch(swarm, /Swarm replaces Phases 1–7, so the\n\s*Phase 1 probe never runs/);
    assert.match(
      swarm,
      /This backstops the \*\*A1e\*\*\s*\n\s*\(explicit-list\) path, which never runs `next\.md`'s Phase 1 issues-mode setup/,
    );
  });

  it('still probes for jq on GitLab before the swarm batch is built', () => {
    assert.match(swarm, /if \[ "\$CLI_TOOL" = glab \]; then\n\s*command -v jq >\/dev\/null 2>&1 \|\| \{/);
  });
});
