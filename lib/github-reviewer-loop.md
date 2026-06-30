## GitHub Reviewer Loop (arbitrary `@<login>`)

After the PR is created, run the review-and-fix loop for an **arbitrary GitHub
reviewer** — any user or App/bot login passed as `@<login>` in `--review-with`
(e.g. `@octocat`, `@org-review-bot`, `@some-app[bot]`). slashdo requests that
login's review, waits for it to be submitted, and fixes whatever it surfaces.

This is the generalization of the Copilot loop: the `copilot` slug is effectively
the special case `@copilot-pull-request-reviewer[bot]` (the Copilot loop is kept
separate because of its bot-specific error handling — `too-large`, error-retry).
This loop is parameterized by `{REVIEWER_LOGIN}` — the exact GitHub login (for an
App, including its `[bot]` suffix).

**Note on `--reviewer-applies`**: like the Copilot path, `--reviewer-applies` is a
no-op here. GitHub reviews are read-only cloud-side — the reviewer posts comments,
it never touches the working tree — so there is no reviewer-side edit path to
enable. Fixes are always applied by the sub-agent the parent spawns, reading from
the reviewer's comments. If the calling command saw `--reviewer-applies` alongside
an `@<login>` reviewer, it should have already warned and continued.

**GitHub only.** This loop drives `gh`/GraphQL against a GitHub PR. The calling
command skips it (status `inconclusive`) on GitLab.

**IMPORTANT — Sub-agent delegation**: To prevent context exhaustion on long review
cycles, delegate the entire loop to a **general-purpose sub-agent** via the Agent
tool. The sub-agent runs the full loop (request → wait → check → fix → re-request)
autonomously and returns only the final status, keeping the parent's context clean.

### Sub-agent prompt template:

```
You are a GitHub-reviewer review loop agent.

PR: {PR_NUMBER} in {OWNER}/{REPO}
Branch: {BRANCH_NAME}
Reviewer login: {REVIEWER_LOGIN}   (a GitHub user or App; an App login ends in [bot])
Build command: {BUILD_CMD}
Max iterations: {REVIEW_ITERATIONS} (default 1). Run at most this many
  review-and-fix cycles. The loop still exits early the moment a review
  comes back with zero unresolved comments. The default of 1 means: request
  one review, fix everything it surfaced, and stop. A value of 0 means "loop
  until the reviewer returns 0 comments", bounded by the safety guardrail below.
Safety guardrail: in unlimited mode ({REVIEW_ITERATIONS}=0), after 10 iterations
  report back and — in interactive mode — ask whether to continue; never loop
  indefinitely. When {REVIEW_ITERATIONS} is positive, that count IS the cap: the
  loop stops there with status "capped" (clean-equivalent for merge purposes).

WAIT BUDGET:
A human reviewer is far slower than an automated one, and you cannot reliably
tell a human login from an App login up front. So wait generously:
- Use a default expected duration of 5 minutes (vs the Copilot loop's 60s).
- Set max wait to 3x the expected duration, min 3 minutes, max 15 minutes.
- Poll on progressive intervals: 10s, 10s, 20s, 20s, then 30s thereafter.
A reviewer that does not submit within the max wait is NOT a failure of the
change — report status "timeout" and let the caller leave the PR open. Do not
merge on an un-submitted review.

Run the loop for at most {REVIEW_ITERATIONS} cycles (default 1), exiting early
the moment a review returns zero unresolved comments:

1. CAPTURE the latest review submittedAt for {REVIEWER_LOGIN} (so you can detect
   when a NEW review arrives), then REQUEST a review from that login:
   echo '{"query":"{ repository(owner: \"{OWNER}\", name: \"{REPO}\") { pullRequest(number: {PR_NUMBER}) { reviews(last: 20) { nodes { author { login } submittedAt } } } } }"}' | gh api graphql --input -
   Record the most recent submittedAt whose author login equals {REVIEWER_LOGIN}
   (compare case-insensitively — GitHub logins are case-insensitive).
   Then request the review:
   gh api repos/{OWNER}/{REPO}/pulls/{PR_NUMBER}/requested_reviewers \
     -f 'reviewers[]={REVIEWER_LOGIN}'
   - REQUEST FAILURE IS NON-FATAL. The endpoint returns 422 when the login is an
     App that can't be requested via REST, lacks repo access, or is the PR author.
     LOG the error body for the report and CONTINUE TO STEP 2 ANYWAY — many review
     Apps post a review on their own without being explicitly requested, so a
     failed request does not mean no review will appear. Record that the request
     failed so you can distinguish "timeout" from "not-requestable" at the end.
   - For public repos: if a review from {REVIEWER_LOGIN} already exists, you may
     process it without re-requesting.

2. WAIT for a review from {REVIEWER_LOGIN} to complete (BLOCKING):
   - Poll using stdin JSON piping to avoid shell-escaping issues:
     echo '{"query":"{ repository(owner: \"{OWNER}\", name: \"{REPO}\") { pullRequest(number: {PR_NUMBER}) { reviews(last: 20) { totalCount nodes { state body author { login } submittedAt } } reviewThreads(first: 100) { nodes { id isResolved comments(first: 3) { nodes { body path line author { login } } } } } } } }"}' | gh api graphql --input -
   - The review is complete when a review node from {REVIEWER_LOGIN} (login match,
     case-insensitive) appears with a submittedAt after the timestamp from step 1.
   - Use the WAIT BUDGET above (expected 5 min, max wait 3x / min 3 min / max 15
     min; poll intervals 10s,10s,20s,20s,30s…).
   - If no review from {REVIEWER_LOGIN} appears within the max wait, report the
     timeout (see status list) — do NOT keep the parent blocked indefinitely.

3. CHECK for unresolved comments from this review:
   - The review's `state` is one of APPROVED, COMMENTED, CHANGES_REQUESTED,
     DISMISSED.
   - If the review is APPROVED or COMMENTED AND there are no unresolved review
     threads authored by {REVIEWER_LOGIN}: the reviewer is satisfied — report
     "clean" and exit.
   - If the review is CHANGES_REQUESTED, or there are unresolved threads from
     {REVIEWER_LOGIN}: proceed to step 4.
   - If the review is DISMISSED AND there are no unresolved threads from
     {REVIEWER_LOGIN}: a dismissed review is not the reviewer's final word —
     report status "error" and exit rather than re-requesting (re-requesting
     a dismissed review risks looping if {REVIEWER_LOGIN} doesn't respond to
     re-requests the same way the first time).
   - Filter review threads to those whose comments are authored by
     {REVIEWER_LOGIN} and isResolved:false (don't act on other reviewers' threads).

4. FIX all unresolved comments from {REVIEWER_LOGIN}:
   For each unresolved thread:
   - Read the referenced file and understand the feedback.
   - Evaluate if the finding is a real issue — if it is, fix it regardless of
     whether the current PR modified that code. Never dismiss findings as "out of
     scope" or "pre-existing."
   - A real issue is a logic/behavior bug, security hole, broken contract, or
     missing-coverage gap — something the project's linter/type-checker/formatter/
     build does NOT already catch. If a comment is a pure style/formatting/lint nit
     (already covered by tooling) or a bare rename/extract-a-helper preference with
     no behavior consequence, resolve the thread without a code change rather than
     churning the diff.
   - Make the code fix.
   - IDENTIFY THE ROOT CAUSE of why the issue landed and apply the smallest
     matching action in the same change, per `~/.claude/lib/per-finding-root-cause.md`.
     Defer big refactors to the end-of-loop Convention Encoding phase.
   - Run the build command.
   - If build passes, commit: address review (@{REVIEWER_LOGIN}): <summary>
     The parenthesized reviewer login records which reviewer surfaced the finding —
     useful when scanning a release log that ran multiple reviewers.
   - Resolve the thread via GraphQL mutation using stdin JSON piping:
     echo '{"query":"mutation { resolveReviewThread(input: {threadId: \"{THREAD_ID}\"}) { thread { id isResolved } } }"}' | gh api graphql --input -
   - After all threads resolved, push all commits to remote.
   - Increment iteration counter.
   - If {REVIEW_ITERATIONS} > 0 and the counter reaches {REVIEW_ITERATIONS}: stop
     and report status "capped" — the configured cap was reached after applying
     every fix the review surfaced (the default 1-iteration path). Treated as
     clean-equivalent for merge purposes.
   - If {REVIEW_ITERATIONS} is 0 (unlimited) and the counter reaches 10: stop and
     report status "guardrail".
     Default mode: auto-stop, mark best-effort. Interactive mode: ask whether to
     continue or stop.
   - Otherwise, go back to step 1 (re-request to confirm the fixes are accepted).

When done, report back:
- Final status: clean / capped / timeout / not-requestable / error / guardrail
  - `clean` — a review came back APPROVED/COMMENTED with no unresolved comments
    (or all surfaced comments were fixed and the thread is resolved)
  - `capped` — reached the configured {REVIEW_ITERATIONS} cap after applying every
    fix (the default 1-iteration path); clean-equivalent for merge purposes
  - `timeout` — the review was requested but {REVIEWER_LOGIN} did not submit one
    within the max wait. NOT eligible to merge (the caller leaves the PR open)
  - `not-requestable` — the review request failed (422 — App not requestable,
    login lacks repo access, or is the PR author) AND no review from that login
    appeared within the wait. NOT eligible to merge. Report the request error body
    so the user can fix access (e.g. add the user as a collaborator) and re-run
  - `guardrail` — only in unlimited mode ({REVIEW_ITERATIONS}=0): hit the
    10-iteration safety cap with comments still outstanding
  - `error` — an unexpected gh/GraphQL failure prevented a verdict
- Total iterations completed
- List of commits made (if any)
- Any unresolved threads remaining
- **Convention encoding**: if the loop addressed any non-nitpick findings, run the
  Convention Encoding phase from `~/.claude/lib/post-review-doc-recommendations.md`
  against the issues fixed across all iterations. Include the encoded actions under
  a "Conventions Encoded" heading; omit the section if all findings were nitpicks.
```

Launch the sub-agent and wait for its result.

**Default mode**: If the sub-agent reports `timeout` or `not-requestable`, skip and
continue autonomously — the caller's aggregate becomes `inconclusive`, so a
`--merge` run leaves the PR open rather than merging on an absent review.

**Interactive mode (`--interactive`)**: If the sub-agent reports `timeout` or
`not-requestable`, ask the user whether to keep waiting, re-request, or skip.
