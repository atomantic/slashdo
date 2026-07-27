'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const readLib = (name) => fs.readFileSync(path.join(__dirname, '..', 'lib', name), 'utf8');

describe('review-loop parse contracts', () => {
  it('requires structured local-agent verdicts without weakening Codex handling', () => {
    const body = readLib('local-agent-review-loop.md');
    assert.match(body, /after stripping blank lines, the result must be either exactly `NO FINDINGS`/);
    assert.match(body, /Treat a missing, malformed, or contradictory result .* `STATUS=no-verdict`/);
    assert.match(body, /For `codex`, retain its native severity-tagged output handling/);
    assert.doesNotMatch(body, /If the log contains `NO FINDINGS` \(or no actionable findings/);
  });

  it('classifies an unparseable verdict as inconclusive, not a hard error', () => {
    // A reviewer that ran fine but answered in prose left the TREE fine too, so it
    // must not fire the wrapper's hard-error short-circuit (which skips every
    // remaining reviewer) and must stay excusable by `~opt`, whose documented
    // contract names "no-verdict" as an inconclusive status it excludes from the
    // merge gate. Mapping it to `cli-error` would break both promises at once.
    const body = readLib('local-agent-review-loop.md');
    assert.match(body, /`no-verdict` is \*\*inconclusive, not a hard error\*\*/);
    assert.match(body, /# clean \/ capped \/ no-verdict \/ guardrail \/ cli-error/);

    const wrapper = readLib('multi-reviewer-loop.md');
    assert.match(wrapper, /Local-agent loop: `clean \| capped \| no-verdict \| guardrail \| cli-error/);
    // Present in the inconclusive enumerations that gate the merge...
    assert.match(wrapper, /local-agent `guardrail`\/`no-verdict`, ollama `incomplete`/);
    // ...and absent from the hard-error short-circuit set.
    assert.doesNotMatch(
      wrapper,
      /if the inner loop returns `cli-error`, `broken-build`, `test-failed`, `rejected`, or `no-verdict`/,
    );
  });

  it('keeps reviewer stderr out of the log the verdict parser validates', () => {
    // The strict verdict contract above rejects anything that is not `NO FINDINGS`
    // or a complete FINDING block, so a merged CLI banner/progress line on stderr
    // would turn a clean review into a parse failure and block the merge.
    const body = readLib('local-agent-review-loop.md');
    assert.match(body, /> "\$LOG_FILE" 2> "\$ERR_FILE"/);
    assert.doesNotMatch(body, /\{INVOCATION\} > "\$LOG_FILE" 2>&1/);
  });

  it('treats malformed Ollama output as a coverage gap rather than an empty review', () => {
    const body = readLib('ollama-review-loop.md');
    assert.match(body, /PARSE_ERRORS=0/);
    assert.match(body, /is a \*\*parse error\*\*, not a clean file/);
    assert.match(body, /`STATUS=incomplete`, never `clean`/);
    assert.match(body, /REVIEW_ERRORS \+ PARSE_ERRORS >= REVIEWABLE/);
    assert.doesNotMatch(body, /Treat a section that fails to parse .* as no findings/);
  });

  it('guards the Ollama total-failure branch against a zero-reviewable diff', () => {
    // A rename-only diff skips every file as empty-diff, leaving REVIEWABLE=0 with
    // zero errors. An unguarded `0 >= 0` would report the hard-error `cli-error`
    // and block the merge on a diff that simply had nothing to review.
    const body = readLib('ollama-review-loop.md');
    const matches = body.match(/`REVIEWABLE > 0` and `REVIEW_ERRORS \+ PARSE_ERRORS >= REVIEWABLE`/g) || [];
    assert.equal(matches.length, 2, 'both total-failure checks must carry the REVIEWABLE > 0 guard');
    assert.match(body, /counted in at most ONE of REVIEW_ERRORS \/ PARSE_ERRORS/);
  });

  it('threads the per-reviewer ~max cap through to the loops that honor it', () => {
    // `~max` only works if the wrapper resolves each entry's cap and both inner
    // loops read it instead of their old hardcoded MAX_ITERATIONS=3.
    const wrapper = readLib('multi-reviewer-loop.md');
    assert.match(wrapper, /Ollama loop: `clean \| capped/);
    assert.match(wrapper, /\{MAX_EXPLICIT\}/);

    for (const name of ['local-agent-review-loop.md', 'ollama-review-loop.md']) {
      const body = readLib(name);
      assert.doesNotMatch(
        body,
        /Initialize `ITERATION=0`, `MAX_ITERATIONS=3`/,
        `${name} must take MAX_ITERATIONS from the caller, not hardcode 3`,
      );
      assert.match(body, /`MAX_EXPLICIT`/, `${name} must distinguish capped from guardrail`);
    }
  });

  it('lets ~opt excuse no-verdict and lets capped satisfy partial', () => {
    // Two ways a new status gets stranded: added to a loop's status set but not to
    // the aggregate rules that consume it. A ~opt no-verdict must reach the
    // optional-inconclusive exclusion, and a stop-mode run whose only pass returned
    // capped must match `partial` — otherwise it matches NO rule at all (`clean`
    // excludes stop-short-circuited runs) and the merge is blocked.
    const wrapper = readLib('multi-reviewer-loop.md');
    assert.match(
      wrapper,
      /\{OPTIONAL\}` is true and whose status is inconclusive \(`timeout`\/`error`\/`guardrail`\/`no-verdict`/,
    );
    assert.match(wrapper, /`no-verdict` — a local agent that ran but did not answer in the verdict format/);
    assert.match(
      wrapper,
      /- `partial` — .*every executed pass returned a clean-equivalent status — `clean`, copilot `too-large`, or `capped`/,
    );
  });
});
