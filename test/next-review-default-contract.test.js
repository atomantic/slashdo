'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
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

  it('gates the merge on whether /do:pr returned an OVERALL_STATUS, not on which flags this run typed', () => {
    assert.match(
      next,
      /Gate on whether `\/do:pr` returned an `OVERALL_STATUS`, not on which review flags this run typed\./,
    );
    assert.match(
      next,
      /An external review can run even when `\/do:next` passed no `--review-with` — `\/do:pr` may have applied its own saved `--review-with` default/,
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
