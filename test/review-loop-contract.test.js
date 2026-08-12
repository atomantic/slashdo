'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const readLib = (name) => fs.readFileSync(path.join(__dirname, '..', 'lib', name), 'utf8');
const readCommand = (name) => fs.readFileSync(path.join(__dirname, '..', 'commands', 'do', name), 'utf8');

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

  it('asserts each pass pushed its fixes, and skips the check without an upstream', () => {
    // Every inner loop pushes its own fix commits as its last step and nothing
    // downstream re-checks it, so an improvised loop body leaves the fixes local
    // while the reviewer still reports clean and CI still passes on the stale
    // pushed tree. The assertion must compare against the UPSTREAM ref (a clean
    // working tree says nothing about committed-but-unpushed commits) and must
    // no-op on a never-pushed branch, which /do:review and /do:better allow.
    const wrapper = readLib('multi-reviewer-loop.md');
    assert.match(wrapper, /\*\*Assert the pass's fixes reached the remote\.\*\*/);
    assert.match(wrapper, /UNPUSHED="\$\(git log --oneline @\{u\}\.\.HEAD\)"/);
    assert.match(wrapper, /if UPSTREAM="\$\(git rev-parse --abbrev-ref --symbolic-full-name @\{u\} 2>\/dev\/null\)"; then/);
    assert.match(wrapper, /UNPUSHED=""   # no upstream — nothing to assert/);
    assert.match(wrapper, /`git status` is not a substitute/);
    assert.match(wrapper, /\*\*record the pass as `push-failed`\*\*/);
    // The union apply in parallel mode is the only writer, so it needs the same guard.
    assert.match(wrapper, /\*\*Assert the applied fixes reached the remote\*\*/);
  });

  it('routes push-failed to inconclusive and refuses to let ~opt excuse it', () => {
    // Same stranding failure the ~opt/capped test above guards: a status added to
    // the dispatch step but never wired into the aggregate rules is inert. And
    // push-failed specifically must NOT follow the optional-inconclusive exclusion
    // — an optional reviewer's fixes sitting unpushed still mean the merged tree
    // is not the reviewed tree.
    const wrapper = readLib('multi-reviewer-loop.md');
    assert.match(
      wrapper,
      /\*\*or any pass at all — optional included — whose status is `push-failed`\*\*/,
      'the inconclusive rule must consume push-failed regardless of {OPTIONAL}',
    );
    assert.match(wrapper, /- \*\*`push-failed`\.\*\* An optional reviewer's \*findings\* are still real fixes/);
    // Inconclusive, not a verdict: it can never satisfy a stop-mode short-circuit.
    assert.match(wrapper, /`no-verdict`\/`skipped`\/`not-requestable`\/`push-failed`/);
    // The `inconclusive` bullet ends by excusing ~opt passes. Unqualified, that
    // sentence flatly contradicts the push-failed carve-out two clauses earlier and
    // an orchestrator could read it as license to merge an ~opt reviewer's stranded
    // fixes — so the exemption must name the statuses it applies to.
    // Structural, not verbatim: a reworded but still-unqualified exemption
    // ("Optional passes are ignored here.") would reintroduce the same
    // contradiction while a literal-string guard kept passing.
    assert.doesNotMatch(
      wrapper,
      /whose status is `push-failed`[\s\S]{0,600}?(Passes marked `~opt` are ignored here\.|`~opt` passes are ignored here\.|are ignored here \(see)/,
      'any ~opt exemption following the push-failed clause must name the statuses it covers',
    );
    assert.match(wrapper, /but never for `push-failed`, which lands the aggregate here regardless of `\{OPTIONAL\}`/);
    // A hard-error must keep its own status: rewriting it to push-failed would
    // silence the hard-error short-circuit and downgrade the aggregate from dirty
    // to inconclusive, past do:pr's "abort before creating the PR on dirty" gate.
    assert.match(wrapper, /\*\*except a hard-error\*\* \(`cli-error`\/`broken-build`\/`test-failed`\/`rejected`\), which keeps its own status/);
    // The consumers that restate the aggregate rule must agree with it.
    assert.match(readCommand('release.md'), /or `push-failed`, a pass whose fix commits never reached the remote/);
  });

  it('scopes the push assertion to the pass and never pushes by fan-out', () => {
    // Two ways this check could do damage rather than prevent it: publishing
    // deliberately-unpushed local commits on a pass that committed nothing (it is a
    // "did the push step run" check, not a "sync my branch" command), and a bare
    // `git push`, which under push.default=matching fans out to every same-named
    // local branch — including a release branch that may auto-tag and publish.
    const wrapper = readLib('multi-reviewer-loop.md');
    assert.match(wrapper, /if \[ "\$PASS_START_SHA" = "\$\(git rev-parse HEAD\)" \]; then/);
    assert.match(wrapper, /`PARALLEL_START_SHA == HEAD`/, 'parallel mode needs the same zero-commit scoping');
    // The destination must come from @{u}, never from the local branch name:
    // `git push origin HEAD` resolves <dst> to refs/heads/<local-name>, so when the
    // upstream is named differently it pushes a spurious branch, leaves the PR head
    // stale, and @{u}..HEAD stays non-empty — #134's failure inside its own guard.
    assert.match(wrapper, /PUSH_REMOTE="\$\{UPSTREAM%%\/\*\}"; PUSH_BRANCH="\$\{UPSTREAM#\*\/\}"/);
    assert.match(wrapper, /git push "\$PUSH_REMOTE" "HEAD:refs\/heads\/\$PUSH_BRANCH"/);
    assert.match(wrapper, /not a bare `git push`, and not `git push origin HEAD`/);
    assert.doesNotMatch(
      wrapper,
      /push with `git push origin HEAD`/,
      'the push target must be derived from the upstream ref, not the local branch name',
    );

    const pr = readCommand('pr.md');
    assert.match(pr, /`git push origin \{current_branch\}` — an explicit refspec, never a bare `git push`/);
    // Without a stop-on-failure clause the orchestrator falls through to gh pr create
    // and opens exactly the stale pre-review PR this guard exists to prevent.
    assert.match(pr, /\*\*If the push still fails after that one retry, do NOT create the PR\*\*/);
  });

  it('blocks PR creation and merge on unpushed commits in do:pr', () => {
    // Backstop for the two moments where unpushed review fixes become user-visible
    // damage: a PR opened from the pre-review tree, and a merge that lands it.
    const pr = readCommand('pr.md');
    assert.match(pr, /\*\*First, assert the branch's commits reached the remote\.\*\*/);
    assert.match(pr, /\*\*Unpushed-commits gate\*\* — \*\*refuse to merge while the local branch is ahead of its remote\.\*\*/);
    assert.match(pr, /git log --oneline @\{u\}\.\.HEAD {3}# must be empty to merge/);
    assert.match(pr, /Never merge on `dirty`\/`inconclusive`, never merge while the branch has unpushed commits/);
  });
});
