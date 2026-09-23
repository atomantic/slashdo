'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readCommandDocs } = require('./helpers/command-docs');

// #289: with neither --review-with nor --no-review typed, Phase 6 told the model
// to pick "a sensible reviewer" itself and pass it to /do:pr as --review-with=….
// That silently overrides a saved `review-with` default (review-config-defaults.md
// precedence #1 is an explicit flag) and can invoke a reviewer the user never
// configured — or one that isn't installed, which makes /do:pr's aggregate
// `inconclusive` and blocks the merge gate. The merge gate itself then assumed
// "no --review-with typed" meant "no external review ran", which is false once
// /do:pr applies its own saved default. These contracts pin the fix: the "neither"
// row forwards no review flags at all and never invents a reviewer, and the merge
// gate keys off whether /do:pr reported an OVERALL_STATUS.
const next = readCommandDocs('next.md', { eager: false });

describe('/do:next review defaults (#289)', () => {
  it('never tells the model to invent or pick a "sensible" reviewer', () => {
    assert.doesNotMatch(next, /sensible reviewer/i);
    assert.doesNotMatch(next, /decide in Phase 6 whether the diff warrants `\/simplify` and\/or an external review/);
  });

  it('the "neither" row forwards no review flags and lets /do:pr apply its saved default', () => {
    assert.match(
      next,
      /Then run `\/do:pr --no-merge` with \*\*no review flags at all\*\* — `\/do:pr` resolves its own saved `--review-with` default, if any\./,
    );
    assert.match(next, /\*\*Never pick or pass a reviewer here\.\*\*/);
  });

  it('Parse Arguments states /do:pr resolves the external reviewer, not Phase 6', () => {
    assert.match(
      next,
      /it never decides the external reviewer: `\/do:pr` applies its own saved `--review-with` default, if any, and no reviewer is invented here\./,
    );
  });

  it('gates the merge on the reported OVERALL_STATUS, not on which flags this run typed', () => {
    assert.match(
      next,
      /\*\*Gate on that report, not on which review flags this run typed\*\* — an external review can run even when `\/do:next` passed no `--review-with`, because `\/do:pr` may have applied its own saved `--review-with` default/,
    );
  });

  it("replaces the stale /simplify-is-optional note with the harness-built-in one-liner", () => {
    assert.doesNotMatch(next, /not part of a stock slashdo install/);
    assert.match(
      next,
      /`\/simplify` is the harness's built-in quality pass \(Claude Code ships one\); if absent, do the pass by hand\. It is \*\*not\*\* `\/do:simplify`/,
    );
  });
});

// #333: --no-review has nowhere to go once it reaches /do:pr (which has no
// --no-review flag of its own), so a saved `review-with` default still fired a
// reviewer the user explicitly opted out of. Swarm workers had the same bug one
// level removed. The merge gate also had a dead branch: /do:pr's "Compute
// OVERALL_STATUS" section always sets OVERALL_STATUS=clean when REVIEW_AGENTS is
// empty, so "no OVERALL_STATUS at all" never happens. These contracts pin the fix.
const pr = readCommandDocs('pr.md', { eager: false });
const swarm = fs.readFileSync(path.join(__dirname, '..', 'lib', 'next-swarm.md'), 'utf8');

describe('/do:next --no-review is translated to --review-with none, not forwarded (#333)', () => {
  it('the "neither" review-flags list no longer includes --no-review', () => {
    assert.doesNotMatch(
      next,
      /`--review-with` \/ `--review-iterations` \/ `--review-mode` \/ `--review-stop-on-findings` \/ `--review-stop-on-clean` \/ `--reviewer-applies` \/ `--no-review`/,
    );
  });

  it('Parse Arguments documents the translation to /do:pr --review-with none', () => {
    assert.match(
      next,
      /`--no-review` becomes `\/do:pr --no-merge --review-with none`/,
    );
  });

  it('the "--no-review" table row runs /do:pr with --review-with none', () => {
    assert.match(
      next,
      /\| `--no-review` \| `\/do:pr --no-merge --review-with none` — its Local Code Review gate still fires; no external pass, no `\/simplify` \|/,
    );
  });

  it('the merge gate has no dead "/do:pr reported no OVERALL_STATUS" branch', () => {
    assert.doesNotMatch(next, /reported no `OVERALL_STATUS`/);
    assert.match(next, /\*\*`\/do:pr` always reports an aggregate `OVERALL_STATUS`\*\*/);
  });

  it("/do:pr's empty-REVIEW_AGENTS note covers --review-with none, not just an omitted flag", () => {
    assert.match(
      pr,
      /\*\*If `REVIEW_AGENTS` was empty\*\* \(`REVIEW_AGENTS` resolved empty: no flag and no saved default, or `--review-with none`\)/,
    );
  });

  it('swarm passes workers an explicit --review-with none instead of --no-review', () => {
    assert.doesNotMatch(swarm, /`--reviewer-applies` \/ `--no-review`\)/);
    assert.match(
      swarm,
      /translating a run-level `--no-review` into an explicit `--review-with none` for every worker, never `--no-review` itself/,
    );
  });
});
