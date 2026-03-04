## Copilot Code Review Loop

After the PR is created, run the Copilot review-and-fix loop.

**IMPORTANT — Sub-agent delegation**: To prevent context exhaustion on long review cycles, delegate the entire review loop to a **general-purpose sub-agent** via the Agent tool. The sub-agent runs the full loop (request → wait → check → fix → re-request) autonomously and returns only the final status. This keeps the parent agent's context clean.

### Sub-agent prompt template:

```
You are a Copilot review loop agent.

PR: #{PR_NUMBER} in {OWNER}/{REPO}
Branch: {BRANCH_NAME}
Build command: {BUILD_CMD}
Max iterations: 5

TIMEOUT SCHEDULE:
When running parallel PR reviews (do:better), use shorter waits to avoid
blocking other PRs:
- Iteration 1: max wait 5 minutes
- Iteration 2: max wait 4 minutes
- Iteration 3: max wait 3 minutes
- Iteration 4: max wait 2 minutes
- Iteration 5+: max wait 1 minute
When running a single-PR review (do:pr, do:release), use dynamic timing:
check the previous Copilot review duration on this PR and wait up to 2x
that (minimum 5 minutes, maximum 20 minutes). Copilot reviews can take
10-15 minutes for large diffs.
Poll interval: 30 seconds for all iterations.

Run the following loop until Copilot returns zero new comments or you hit
the max iteration limit:

1. CAPTURE the latest Copilot review submittedAt timestamp (so you can
   detect when a NEW review arrives):
   echo '{"query":"{ repository(owner: \"{OWNER}\", name: \"{REPO}\") { pullRequest(number: {PR_NUMBER}) { reviews(last: 5) { nodes { author { login } submittedAt } } } } }"}' | gh api graphql --input -
   Record the most recent submittedAt from copilot-pull-request-reviewer.
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
     the previous Copilot review duration on this PR (2x that, min 5 min,
     max 20 min)
   - Error detection: if the review body contains "Copilot encountered an
     error" or "unable to review this pull request", re-request (step 1)
     and resume polling. Max 3 error retries before reporting failure.
   - If no review appears after max wait, report the timeout — the parent
     agent will ask the user what to do

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
   - Make the code fix
   - Run the build command
   - If build passes, commit: address review: <summary>
   - Resolve the thread via GraphQL mutation using stdin JSON piping:
     echo '{"query":"mutation { resolveReviewThread(input: {threadId: \"{THREAD_ID}\"}) { thread { id isResolved } } }"}' | gh api graphql --input -
   - After all threads resolved, push all commits to remote
   - Increment iteration counter and go back to step 1

When done, report back:
- Final status: clean / max-iterations-reached / timeout / error
- Total iterations completed
- List of commits made (if any)
- Any unresolved threads remaining
```

Launch the sub-agent and wait for its result. If the sub-agent reports a timeout or error, **ask the user** whether to continue waiting, re-request the review, or skip — never proceed without user approval when the review loop fails.
