## Copilot Code Review Loop

After the PR is created, run the Copilot review-and-fix loop.

**Note on `--reviewer-applies`**: the `--reviewer-applies` flag (which routes edits through the reviewing CLI rather than the orchestrator) is a no-op on this path. Copilot reviews are read-only by design — they generate comments cloud-side without working-tree access — so there is no reviewer-side edit path to enable. If the calling command saw `--reviewer-applies` alongside `--review-with copilot`, it should have already printed a warning and continued; this loop's behavior is unchanged either way. Fixes are always applied by the sub-agent the parent spawns (see "Sub-agent prompt template" below), reading from Copilot's comments.

**IMPORTANT — Sub-agent delegation**: To prevent context exhaustion on long review cycles, delegate the entire review loop to a **general-purpose sub-agent** via the Agent tool. The sub-agent runs the full loop (request → wait → check → fix → re-request) autonomously and returns only the final status. This keeps the parent agent's context clean.

### Sub-agent prompt template:

```
You are a Copilot review loop agent.

PR: {PR_NUMBER} in {OWNER}/{REPO}
Branch: {BRANCH_NAME}
Build command: {BUILD_CMD}
Max iterations: {REVIEW_ITERATIONS} (default 1). Run at most this many
  review-and-fix cycles. The loop still exits early the moment a review
  returns 0 comments. The default of 1 means: request one review, fix
  everything it surfaced, and stop — without spending another cycle to
  re-confirm. A value of 0 means "loop until Copilot returns 0 comments"
  (the legacy behavior), bounded by the safety guardrail below.
Safety guardrail: this applies only in unlimited mode ({REVIEW_ITERATIONS}
  is 0). After 10 iterations, report back and — in interactive mode — ask
  the user whether to continue or stop; never loop indefinitely without
  confirmation. When {REVIEW_ITERATIONS} is a positive number, that count
  IS the cap: the loop stops there with status "capped" (see the status
  list below — treated as clean-equivalent for merge purposes).

TIMEOUT SCHEDULE:
When running parallel PR reviews (do:better), use shorter waits to avoid
blocking other PRs:
- Iteration 1: max wait 3 minutes
- Iteration 2: max wait 2 minutes
- Iteration 3: max wait 90 seconds
- Iteration 4: max wait 60 seconds
- Iteration 5+: max wait 45 seconds
When running a single-PR review (do:pr, do:release), use dynamic timing:
check the previous Copilot review duration on this PR. If no prior
review exists, default to 60 seconds. Set max wait to 3x the expected
duration (minimum 90 seconds, maximum 5 minutes); only large diffs
(200+ changed lines) should approach the max. Copilot reviews on small
diffs typically land in 30-90 seconds; large diffs may take longer.
Use progressive poll intervals: 5s, 5s, 10s, 10s, then 15s thereafter —
an early first check avoids burning a full minute on a review that's
already sitting in the API. For parallel PR reviews (do:better), use
the decreasing timeout schedule above with a 15-second poll interval.

Run the following loop for at most {REVIEW_ITERATIONS} review-and-fix
cycles (default 1), exiting early the moment a review returns zero new
comments. When {REVIEW_ITERATIONS} is 0, loop until zero new comments
(bounded by the 10-iteration safety guardrail):

1. CAPTURE the latest Copilot review submittedAt timestamp (so you can
   detect when a NEW review arrives):
   echo '{"query":"{ repository(owner: \"{OWNER}\", name: \"{REPO}\") { pullRequest(number: {PR_NUMBER}) { reviews(last: 5) { nodes { author { login } submittedAt } } } } }"}' | gh api graphql --input -
   Record the most recent submittedAt from copilot-pull-request-reviewer[bot].
   Then REQUEST a Copilot review:
   gh api repos/{OWNER}/{REPO}/pulls/{PR_NUMBER}/requested_reviewers \
     -f 'reviewers[]=copilot-pull-request-reviewer[bot]'
   CRITICAL: The reviewer name MUST include the [bot] suffix.
   - For public repos: check if a review already exists before requesting
   - If no Copilot reviewer is configured, report back and exit

2. WAIT for the review to complete (BLOCKING):
   - Poll using stdin JSON piping to avoid shell-escaping issues:
     echo '{"query":"{ repository(owner: \"{OWNER}\", name: \"{REPO}\") { pullRequest(number: {PR_NUMBER}) { reviews(last: 5) { totalCount nodes { state body author { login } submittedAt } } reviewThreads(first: 100) { nodes { id isResolved comments(first: 3) { nodes { body path line author { login } } } } } } } }"}' | gh api graphql --input -
   - The review is complete when a new Copilot review node appears with a
     submittedAt after the timestamp captured in step 1
   - For parallel PR reviews (do:better): use the DECREASING TIMEOUT for
     the current iteration number
   - For single-PR reviews (do:pr, do:release): use dynamic timing based on
     the previous Copilot review duration on this PR (3x that, min 90 sec,
     max 5 min). If no prior review exists, default expected duration to
     60 seconds. Use progressive poll intervals (5s, 5s, 10s, 10s, then
     15s thereafter)
   - Error detection: if the review body contains "exceeds the maximum
     number of lines", treat this as a terminal complete state — do NOT
     re-request, do NOT retry. Report status "too-large" and exit the loop
     immediately (proceed to merge as if zero comments).
   - If the review body contains "Copilot encountered an error" or
     "unable to review this pull request", re-request (step 1) and resume
     polling. Max 3 error retries before reporting failure.
   - If no review appears after max wait, report the timeout.
     **Default mode**: skip and continue. **Interactive mode (`--interactive`)**: ask the user what to do

3. CHECK for unresolved comments:
   - Filter review threads for isResolved: false
   - First verify the review was successful: check that the latest Copilot
     review body does NOT contain error text. If it does, go back to step 1.
   - If zero comments (body says "generated 0 comments" or no unresolved
     threads): PR is clean — report success and exit
   - If unresolved comments exist: proceed to step 4

4. FIX all unresolved review comments:
   For each unresolved thread:
   - Read the referenced file and understand the feedback
   - Evaluate if the finding is a real issue — if it is, fix it regardless of whether the current PR modified that code. Never dismiss findings as "out of scope" or "pre-existing."
   - A real issue is a logic/behavior bug, security hole, broken contract, or missing-coverage gap — something the project's linter/type-checker/formatter/build does NOT already catch. If a comment is a pure style/formatting/lint nit (already covered by tooling) or a bare rename/extract-a-helper preference with no behavior consequence, resolve the thread without a code change rather than churning the diff for it. Spend fix effort on findings that name a concrete wrong outcome.
   - Make the code fix
   - IDENTIFY THE ROOT CAUSE of why the issue landed (missing lint rule, missing comment at the canonical site, misleading name, API that invites the mistake, etc.) per `~/.claude/lib/per-finding-root-cause.md` and apply the smallest matching action in the same change. Defer big refactors and cross-cutting patterns to the end-of-loop Convention Encoding phase.
   - Run the build command
   - If build passes, commit: address review (copilot): <summary>
     The parenthesized agent name records which reviewer surfaced the finding — useful when scanning the log of a release that ran multiple reviewers.
   - Resolve the thread via GraphQL mutation using stdin JSON piping:
     echo '{"query":"mutation { resolveReviewThread(input: {threadId: \"{THREAD_ID}\"}) { thread { id isResolved } } }"}' | gh api graphql --input -
   - After all threads resolved, push all commits to remote
   - Increment iteration counter
   - If {REVIEW_ITERATIONS} > 0 and the iteration counter reaches
     {REVIEW_ITERATIONS}: stop the loop and report back with status
     "capped" — the configured review-iteration cap was reached after
     applying every fix the review surfaced. This is the default path (1
     iteration). Treated as clean-equivalent for merge purposes: you
     applied all the fixes, you just didn't spend another cycle
     re-confirming zero comments.
   - If {REVIEW_ITERATIONS} is 0 (unlimited) and the iteration counter
     reaches 10: stop the loop and report back with status "guardrail".
     **Default mode**: auto-stop and mark as best-effort.
     **Interactive mode (`--interactive`)**: ask the user whether to continue or stop
   - Otherwise, go back to step 1

When done, report back:
- Final status: clean / capped / timeout / error / guardrail / too-large
  - `clean` — a review returned 0 comments (PR is confirmed clean)
  - `capped` — reached the configured {REVIEW_ITERATIONS} cap after applying every fix (the default 1-iteration path); treated as clean-equivalent for merge purposes
  - `guardrail` — only in unlimited mode ({REVIEW_ITERATIONS}=0): hit the 10-iteration safety cap with comments still outstanding
  - `too-large` — PR exceeded Copilot's 20 000-line limit; treated as clean
  - `timeout` / `error` — the review did not complete
- Total iterations completed
- List of commits made (if any)
- Any unresolved threads remaining
- **Convention encoding**: if the loop addressed any non-nitpick findings, run the Convention Encoding phase from `~/.claude/lib/post-review-doc-recommendations.md` against the issues fixed across all iterations. For each recurring pattern, apply the smallest code-level action that makes the convention self-evident (in-tree comment, clarifying rename, or surgical refactor). CLAUDE.md / AGENTS.md additions are a fallback only — used when the convention can't be expressed locally. Include the encoded actions (and any fallback suggestions) in the final report under a "Conventions Encoded" heading. If all findings were nitpicks (or no findings landed), omit the section.
```

Launch the sub-agent and wait for its result.

**Default mode**: If the sub-agent reports a timeout or error, skip the timed-out review and continue autonomously.

**Interactive mode (`--interactive`)**: If the sub-agent reports a timeout or error, ask the user whether to continue waiting, re-request the review, or skip.
