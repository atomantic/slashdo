## Host Reviewer Loop

This is the single sub-agent template for a reviewer handle on the project's
code host: an `@<login>` user, App, or bot. It is host-neutral. Every
host operation is a named verb, and `{CODE_HOST}` (from `vcs-host.md`;
`github` when the caller never resolved it) selects which verb file the
sub-agent runs. Both verb files define the same verbs with the same outputs, so
this loop never names `gh` or `glab` itself.

Read the verb file for `{CODE_HOST}` now, and paste its full text into the
sub-agent prompt as `{HOST_VERBS}`. Only when `{CODE_HOST}=github` (or unset):

!read lib/host-github.md

Only when `{CODE_HOST}=gitlab`:

!read lib/host-gitlab.md

The `copilot` slug uses the same template with `REVIEWER_LOGIN` set to
`copilot-pull-request-reviewer[bot]` and the Copilot-specific delta in
`copilot-review-loop.md`. Copilot is a GitHub product, so it runs only when
`CODE_HOST=github`; the multi-reviewer wrapper records it `skipped` on any other
host.

**`--reviewer-applies` is a no-op here**: host reviews are read-only
cloud-side, so there is no reviewer-side edit path. Fixes are always applied by
the sub-agent the parent spawns, reading from the reviewer's comments. The
calling command should already have warned and continued.

**Sub-agent delegation**: delegate the entire loop to a **general-purpose
sub-agent** via the Agent tool so long review cycles don't exhaust the parent's
context. The sub-agent runs the full loop (request → wait → check → fix →
re-request) autonomously and returns only the final status.

### Sub-agent prompt template:

```
You are a host-reviewer loop agent.

Code host: {CODE_HOST}   ({CR_NOUN} = PR on github, MR on gitlab)
{CR_NOUN}: {PR_NUMBER} in {OWNER}/{REPO}   (the MR iid on GitLab)
Branch: {BRANCH_NAME}
Reviewer login: {REVIEWER_LOGIN}   (exact username on {CODE_HOST}; GitHub App
  logins include [bot])
Build command: {BUILD_CMD}
GitHub API host: {GH_HOST}   (github only: pass `--hostname {GH_HOST}` on EVERY
  `gh api` call; omit the flag when empty. See `~/.claude/lib/gh-host.md`.)

HOST VERBS: run every verb named below (`cr-state`, `request-review`,
  `resolve-thread`) in the {CODE_HOST} form given here. A failed verb is a
  failure: never substitute another host's form or read an empty result as
  success.
{HOST_VERBS}

Max iterations: {REVIEW_ITERATIONS} (default 1). Run at most this many
  review-and-fix cycles, exiting early the moment a review comes back with zero
  unresolved comments. The default of 1 means: request one review, fix
  everything it surfaced, and stop. 0 means "loop until the reviewer returns 0
  comments", bounded by the safety guardrail below.
  The caller resolves this value: a per-entry `~max=<n>` suffix on the
  `--review-with` token (e.g. `@org-review-bot~max=3`) wins over the run's
  `--review-iterations`, which wins over the default of 1. Either source is
  user-configured, so reaching the cap here is "capped", never "guardrail".
  See `~/.claude/lib/multi-reviewer-loop.md`.
Safety guardrail: in unlimited mode ({REVIEW_ITERATIONS}=0), after 10 iterations
  report back and — in interactive mode — ask whether to continue; never loop
  indefinitely. When {REVIEW_ITERATIONS} is positive, that count IS the cap: the
  loop stops there with status "capped" (clean-equivalent for merge purposes).

WAIT SCHEDULE:
{WAIT_SCHEDULE}

Run the loop for at most {REVIEW_ITERATIONS} cycles (default 1), exiting early
the moment a review returns zero unresolved comments:

1. CAPTURE the baseline with `cr-state`: the {CR_NOUN}'s current head SHA, and
   {REVIEWER_LOGIN}'s reviews (compare logins case-insensitively), each with its
   submittedAt, the commit SHA it reviewed, its state, and its body. Record the
   most recent submittedAt as the baseline.
   - On every pass, reuse a review from {REVIEWER_LOGIN} only when its
     reviewed commit equals the current head SHA. Skip the request and
     wait, and proceed to step 3 with that review. Otherwise run
     `request-review` for {REVIEWER_LOGIN}. A newer submittedAt never makes a
     review of an older commit current.
   - REQUEST FAILURE IS NON-FATAL. Record the error body and continue polling;
     some review Apps post without a successful request.

2. WAIT for a NEW review from {REVIEWER_LOGIN} to complete (BLOCKING — only
   reached when no current-head review was reused in step 1):
   - Poll with `cr-state`. It re-reads the head SHA on every poll because the
     head can move during the wait.
   - The review is complete only when a login-matching review has a submittedAt
     after step 1's baseline **AND** its reviewed commit equals this poll's
     head SHA. A later submission for an older commit does not qualify; keep
     polling.
   - Use the caller-supplied WAIT SCHEDULE for this entry and iteration.
   - If no qualifying review appears within the max wait, report
     `not-requestable` when the request failed, otherwise `timeout`, and leave
     the {CR_NOUN} open.

3. CHECK for unresolved comments from this review:
   - The review's state is one of APPROVED, COMMENTED, CHANGES_REQUESTED,
     DISMISSED (the verb file maps its host's native states onto these).
   - Filter the threads from `cr-state` to those authored by {REVIEWER_LOGIN}
     and unresolved; do not act on other reviewers' threads.
   - The review's top-level body is feedback too. Treat actionable body text
     as a finding even when there are no inline threads.
   - Unresolved threads always route to step 4, regardless of review state,
     including DISMISSED.
   - If there are unresolved threads, OR the review is CHANGES_REQUESTED, OR a
     non-DISMISSED review's body contains actionable feedback, proceed to step 4.
   - If the review is DISMISSED, ignore its body but still fix unresolved
     threads. If it has none, report status `error` and exit rather than
     re-requesting.
   - Otherwise, if the review is APPROVED or COMMENTED with no unresolved threads
     and no actionable body feedback, report `clean` and exit.

4. FIX all unresolved comments from {REVIEWER_LOGIN}, plus any actionable review
   body from step 3:
   - A body-only finding has no thread ID; address and commit it like any other
     finding, but do not run `resolve-thread` for it.
   For each unresolved thread:
   - Read the referenced file and understand the feedback.
   - Evaluate if the finding is a real issue — if it is, fix it regardless of
     whether the current {CR_NOUN} modified that code. Never dismiss findings as
     "out of scope" or "pre-existing."
   - A real issue is a logic/behavior bug, security hole, broken contract, or
     missing-coverage gap that the project's linter/type-checker/formatter/build
     does not catch. Resolve a tooling-covered style nit or a bare
     rename/extract-a-helper preference without churning the diff.
   - Make the code fix.
   - IDENTIFY THE ROOT CAUSE and apply the smallest matching action in the same
     change, per `~/.claude/lib/review-fix-conventions.md`. Defer big refactors
     to the end-of-loop Convention Encoding phase.
   - Run the build command.
   - If build passes, commit: address review (@{REVIEWER_LOGIN}): <summary>
   - Resolve the thread with `resolve-thread`.
   - After all threads are resolved, push all commits to remote.
   - Increment the iteration counter.
   - If {REVIEW_ITERATIONS} > 0 and the counter reaches {REVIEW_ITERATIONS}, stop
     and report `capped` after applying every fix. This is clean-equivalent for
     the caller's merge gate.
   - If {REVIEW_ITERATIONS}=0 and the counter reaches 10, report `guardrail`.
     Default mode auto-stops; interactive mode asks whether to continue.
   - CONVERGENCE GATE (unlimited mode, before the guardrail): apply
     `~/.claude/lib/review-convergence-gate.md`. If the round resolved only
     marginal feedback, report `clean`; only a round with at least one substantive
     fix earns another request.
   - Otherwise, go back to step 1.

When done, report back:
- Final status: clean / capped / timeout / not-requestable / error / guardrail
  - `clean` — a current-head review had no unresolved threads or actionable body
    feedback
  - `capped` — the configured iteration cap was reached after applying every fix
  - `timeout` — no qualifying current-head review arrived within the wait budget
  - `not-requestable` — the request failed and no qualifying review arrived
  - `guardrail` — unlimited mode reached 10 iterations with work outstanding
  - `error` — an unexpected host API failure prevented a verdict
- Total iterations completed
- List of commits made, if any
- Any unresolved threads remaining
- **Convention encoding**: run the end-of-cycle phase from
  `~/.claude/lib/review-fix-conventions.md` against all issues fixed across the
  iterations and always print `Conventions Encoded`, using its explicit
  no-conventions message when nothing qualifies.
```

Launch the sub-agent and wait for its result.

**Default mode**: If the sub-agent reports `timeout` or `not-requestable`, skip
and continue autonomously; the caller's aggregate becomes `inconclusive`.

**Interactive mode (`--interactive`)**: If the sub-agent reports `timeout` or
`not-requestable`, ask whether to keep waiting, re-request, or skip.
