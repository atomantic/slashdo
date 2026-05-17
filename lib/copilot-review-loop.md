## Copilot Code Review Loop

After the PR is created, run the Copilot review-and-fix loop.

**IMPORTANT — Sub-agent delegation**: To prevent context exhaustion on long review cycles, delegate the entire review loop to a **general-purpose sub-agent** via the Agent tool. The sub-agent runs the full loop (request → wait → check → fix → re-request) autonomously and returns only the final status. This keeps the parent agent's context clean.

### Sub-agent prompt template:

```
You are a Copilot review loop agent.

PR: {PR_NUMBER} in {OWNER}/{REPO}
Branch: {BRANCH_NAME}
Build command: {BUILD_CMD}
Max iterations: unlimited (loop until Copilot returns 0 comments)
Safety guardrail: after 10 iterations, report back and ask the user
whether to continue or stop — never loop indefinitely without confirmation.

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

Run the following loop until Copilot returns zero new comments:

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
   - Make the code fix
   - Run the build command
   - If build passes, commit: address review: <summary>
   - Resolve the thread via GraphQL mutation using stdin JSON piping:
     echo '{"query":"mutation { resolveReviewThread(input: {threadId: \"{THREAD_ID}\"}) { thread { id isResolved } } }"}' | gh api graphql --input -
   - After all threads resolved, push all commits to remote
   - Increment iteration counter
   - If iteration counter reaches 10, stop the loop and report back with
     status "guardrail". **Default mode**: auto-stop and mark as best-effort.
     **Interactive mode (`--interactive`)**: ask the user whether to continue or stop
   - Otherwise, go back to step 1

When done, report back:
- Final status: clean / timeout / error / guardrail / too-large (PR exceeded Copilot's 20 000-line limit — treated as clean)
- Total iterations completed
- List of commits made (if any)
- Any unresolved threads remaining
- **Documentation recommendations**: if the loop addressed any non-nitpick findings, run the Documentation Recommendations phase from `~/.claude/lib/post-review-doc-recommendations.md` against the issues fixed across all iterations. Include the resulting suggestions in the report under a "Documentation Recommendations" heading. Surface suggestions only — do NOT auto-edit CLAUDE.md, README.md, or any project documentation. If all findings were nitpicks (or no findings landed), omit the section.
```

Launch the sub-agent and wait for its result.

**Default mode**: If the sub-agent reports a timeout or error, skip the timed-out review and continue autonomously.

**Interactive mode (`--interactive`)**: If the sub-agent reports a timeout or error, ask the user whether to continue waiting, re-request the review, or skip.
