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
   echo '{"query":"{ repository(owner: \"{OWNER}\", name: \"{REPO}\") { pullRequest(number: {PR_NUMBER}) { headRefOid reviews(last: 20) { nodes { author { login } submittedAt commit { oid } } } } } }"}' | gh api graphql --input -
   Record the most recent submittedAt whose author login equals {REVIEWER_LOGIN}
   (compare case-insensitively — GitHub logins are case-insensitive), and record
   `headRefOid` (the PR's current head commit) alongside each candidate review's
   own `commit.oid`.
   - **Only on this command's very first pass through step 1** (before this loop
     has ever requested or processed a review of its own — not on a re-loop back
     to step 1 after applying fixes): if a review from {REVIEWER_LOGIN} already
     exists at this point **AND its `commit.oid` equals the current `headRefOid`**
     (e.g. a review App that auto-posted against the exact commit the PR is on
     right now, or this command rerun without any new push since the prior
     review), set `EXISTING_REVIEW_FOUND=true` and skip straight to step 3 using
     that review — do NOT request a new one and do NOT wait in step 2. Step 2's
     wait condition is strictly "submittedAt *after* the timestamp captured
     here," so if you captured an already-existing review's own timestamp as the
     baseline, that same review can never satisfy "after itself" — waiting for
     it would time out despite it being a perfectly valid review to process.
     **The `commit.oid` check is load-bearing, not optional**: an existing
     review whose `commit.oid` does NOT match `headRefOid` reviewed a stale
     commit (e.g. new commits landed after a self-fix pass, or after a manual
     push) — treat this exactly like "no existing review" and fall through to
     requesting a fresh one below, so `{REVIEWER_LOGIN}` actually reviews
     current HEAD rather than letting `--merge` proceed on stale approval. On
     any later iteration (after this loop already requested and processed a
     review once), an "existing" review found here is the stale one from the
     prior iteration regardless of commit match — always request and wait for a
     genuinely new submission in that case, exactly as before this fix.
   - Otherwise (no existing review at current HEAD), request one:
   gh api repos/{OWNER}/{REPO}/pulls/{PR_NUMBER}/requested_reviewers \
     -f 'reviewers[]={REVIEWER_LOGIN}'
   - REQUEST FAILURE IS NON-FATAL. The endpoint returns 422 when the login is an
     App that can't be requested via REST, lacks repo access, or is the PR author.
     LOG the error body for the report and CONTINUE TO STEP 2 ANYWAY — many review
     Apps post a review on their own without being explicitly requested, so a
     failed request does not mean no review will appear. Record that the request
     failed so you can distinguish "timeout" from "not-requestable" at the end.

2. WAIT for a NEW review from {REVIEWER_LOGIN} to complete (BLOCKING — only
   reached when `EXISTING_REVIEW_FOUND` was not set in step 1):
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
   - Filter review threads to those whose comments are authored by
     {REVIEWER_LOGIN} and isResolved:false (don't act on other reviewers' threads).
   - **The review's top-level `body` is feedback too, not just its inline
     threads.** A reviewer (especially a human or a bot that prefers
     summary comments over inline threads) can leave the only actionable
     feedback in the review body with zero inline threads — do NOT report
     "clean" just because the inline-thread count is zero.
   - **Unresolved threads always route to step 4, regardless of review
     state** — including DISMISSED. Dismissing a review does not auto-resolve
     its inline comment threads, so a DISMISSED review can still have
     unresolved threads sitting there that genuinely need fixing; do not let
     the DISMISSED-specific bullet below swallow that case.
   - If there are unresolved threads from {REVIEWER_LOGIN}, OR the review is
     CHANGES_REQUESTED, OR the review is non-DISMISSED (APPROVED/COMMENTED/
     CHANGES_REQUESTED) AND its body contains actionable feedback: proceed to
     step 4. When the body is what triggered this, treat the body text itself
     as an additional finding to evaluate and address, exactly like an inline
     thread (skip this for a DISMISSED review's body — see below).
   - If the review is DISMISSED: ignore its body (a dismissed review's stated
     opinion isn't the reviewer's final word, so don't treat it as a fresh
     finding) but still check its unresolved threads per the bullet above. If
     it has unresolved threads, proceed to step 4 to fix them. If it has NO
     unresolved threads, report status "error" and exit rather than
     re-requesting (re-requesting a dismissed review risks looping if
     {REVIEWER_LOGIN} doesn't respond to re-requests the same way the first
     time).
   - Otherwise (APPROVED or COMMENTED, no unresolved threads, and the body is
     empty or purely complimentary/boilerplate — read it and use judgment,
     the same way you'd judge any other finding): the reviewer is satisfied —
     report "clean" and exit.

4. FIX all unresolved comments from {REVIEWER_LOGIN}, plus the review body if step 3
   flagged it as actionable:
   - **The review body has no `threadId`** — it isn't an inline comment, so there is
     nothing to resolve via the GraphQL mutation below. Address it like any other
     finding (read, evaluate, fix, commit), but skip the "resolve the thread" sub-step
     for it specifically; the only way to silence the same body content on the next
     poll is for the next review you request to come back without it (e.g. a fix
     commit followed by a fresh review).
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
  - `clean` — a review came back APPROVED or COMMENTED with no unresolved
    threads and no actionable body feedback (or all surfaced inline
    comments and body feedback were fixed)
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
