## GitHub Reviewer Loop

This is the single sub-agent template for a GitHub user, App, or bot login. The
`copilot` slug uses the same template with `REVIEWER_LOGIN` set to
`copilot-pull-request-reviewer[bot]` and the Copilot-specific delta in
`copilot-review-loop.md`.

**`--reviewer-applies` is a no-op here**: GitHub reviews are read-only
cloud-side, so there is no reviewer-side edit path. Fixes are always applied by
the sub-agent the parent spawns, reading from the reviewer's comments. The
calling command should already have warned and continued.

**GitHub only.** This loop drives `gh`/GraphQL against a GitHub PR. The calling
command skips it (status `inconclusive`) on GitLab.

**Sub-agent delegation**: delegate the entire loop to a **general-purpose
sub-agent** via the Agent tool so long review cycles don't exhaust the parent's
context. The sub-agent runs the full loop (request → wait → check → fix →
re-request) autonomously and returns only the final status.

### Sub-agent prompt template:

```
You are a GitHub-reviewer loop agent.

PR: {PR_NUMBER} in {OWNER}/{REPO}
Branch: {BRANCH_NAME}
Reviewer login: {REVIEWER_LOGIN}   (exact GitHub login; App logins include [bot])
Build command: {BUILD_CMD}
GitHub API host: {GH_HOST}   (pass `--hostname {GH_HOST}` on EVERY `gh api` call.
  If {GH_HOST} is empty/unset, omit the flag. See `~/.claude/lib/gh-host.md`.)
GraphQL calls: inline literal values in JSON on stdin and pass `--input -`; never
  put shell-expandable `$variables` in a query string.
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

1. CAPTURE the latest review data for {REVIEWER_LOGIN}, then REQUEST a review
   from that login when no current-head review already exists:
   echo '{"query":"{ repository(owner: \"{OWNER}\", name: \"{REPO}\") { pullRequest(number: {PR_NUMBER}) { headRefOid reviews(last: 20) { nodes { author { login } submittedAt commit { oid } } } } } }"}' | gh api --hostname {GH_HOST} graphql --input -
   Record the most recent submittedAt whose author login equals {REVIEWER_LOGIN}
   (compare case-insensitively), plus each review's `commit.oid` and the PR's
   current `headRefOid`.
   - On every pass, reuse a review from {REVIEWER_LOGIN} only when its
     `commit.oid` equals the current `headRefOid`. Fetch its full detail once with
     step 2's query, skip the request
     and wait, and proceed to step 3. Otherwise request a fresh review. A newer
     `submittedAt` never makes a review of an older commit current.
   gh api --hostname {GH_HOST} repos/{OWNER}/{REPO}/pulls/{PR_NUMBER}/requested_reviewers \
     -f 'reviewers[]={REVIEWER_LOGIN}'
   - REQUEST FAILURE IS NON-FATAL. Record the error body and continue polling;
     some review Apps post without a successful request.

2. WAIT for a NEW review from {REVIEWER_LOGIN} to complete (BLOCKING — only
   reached when no current-head review was reused in step 1):
   - Poll using stdin JSON piping. This query includes `headRefOid` and each
     review's `commit.oid` because the PR head can move during the wait:
     echo '{"query":"{ repository(owner: \"{OWNER}\", name: \"{REPO}\") { pullRequest(number: {PR_NUMBER}) { headRefOid reviews(last: 20) { totalCount nodes { state body author { login } submittedAt commit { oid } } } reviewThreads(first: 100) { nodes { id isResolved comments(first: 3) { nodes { body path line author { login } } } } } } } }"}' | gh api --hostname {GH_HOST} graphql --input -
   - The review is complete only when a login-matching review has a submittedAt
     after step 1's baseline **AND** its `commit.oid` equals this poll's
     `headRefOid`. A later submission for an older commit does not qualify; keep
     polling.
   - Use the caller-supplied WAIT SCHEDULE for this entry and iteration.
   - If no qualifying review appears within the max wait, report
     `not-requestable` when the request failed, otherwise `timeout`, and leave
     the PR open.

3. CHECK for unresolved comments from this review:
   - The review's `state` is one of APPROVED, COMMENTED, CHANGES_REQUESTED,
     DISMISSED.
   - Filter review threads to those whose comments are authored by
     {REVIEWER_LOGIN} and isResolved:false; do not act on other reviewers' threads.
   - The review's top-level `body` is feedback too. Treat actionable body text
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
   - A body-only finding has no `threadId`; address and commit it like any other
     finding, but do not run the thread-resolution mutation for it.
   For each unresolved thread:
   - Read the referenced file and understand the feedback.
   - Evaluate if the finding is a real issue — if it is, fix it regardless of
     whether the current PR modified that code. Never dismiss findings as "out of
     scope" or "pre-existing."
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
   - Resolve the thread via GraphQL mutation using stdin JSON piping:
     echo '{"query":"mutation { resolveReviewThread(input: {threadId: \"{THREAD_ID}\"}) { thread { id isResolved } } }"}' | gh api --hostname {GH_HOST} graphql --input -
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
  - `error` — an unexpected gh/GraphQL failure prevented a verdict
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
