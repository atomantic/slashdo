## Copilot Code Review Loop

After the PR is created, run the Copilot review-and-fix loop:

1. **Request a Copilot review via API**
   ```bash
   gh api repos/OWNER/REPO/pulls/PR_NUM/requested_reviewers -f 'reviewers[]=copilot-pull-request-reviewer[bot]'
   ```
   **CRITICAL**: The reviewer name MUST include the `[bot]` suffix. Without it, the API returns a 422 "not a collaborator" error.
   - For **public repos**: Copilot review may trigger automatically on PR creation — check if a review already exists before requesting
   - If no Copilot reviewer is configured at all, inform the user and skip this loop

2. **Wait for the review to complete (BLOCKING — do not skip or proceed early)**
   - Record the current review count and latest `submittedAt` timestamp before waiting
   - Poll using `gh api graphql` to check the `reviews` array for a NEW review node (compare `submittedAt` timestamps or count):
     ```bash
     gh api graphql -f query='{ repository(owner: "OWNER", name: "REPO") { pullRequest(number: PR_NUM) { reviews(last: 3) { nodes { state body author { login } submittedAt } } reviewThreads(first: 100) { nodes { id isResolved comments(first: 3) { nodes { body path line author { login } } } } } } } }'
     ```
   - The review is complete when a new Copilot review node appears with a `submittedAt` after your latest push
   - **Error detection**: After a review appears, check the review `body` for error text such as "Copilot encountered an error" or "unable to review this pull request". If the review body contains this error, it is NOT a successful review — re-request the review (step 1) and resume polling. Log a warning so the user knows a retry occurred. Apply a maximum of 3 error retries before asking the user whether to continue waiting or skip.
   - **Do NOT proceed until the re-requested review has actually posted** — "Awaiting requested review" means it is still in progress
   - **Dynamic poll timing**: Before your first poll, check how long the most recent Copilot review on this PR took by comparing its `submittedAt` to the previous review's `submittedAt` (or to the PR creation time if it was the first review). Use that duration as your expected wait time. If no prior review exists, default to 5 minutes. Set poll interval to 60 seconds and max wait to **2x the expected duration** (minimum 5 minutes, maximum 20 minutes).
   - Copilot reviews can take **10-15 minutes** for large diffs — do NOT give up early
   - If no review appears after the max wait time, **ask the user** whether to continue waiting, re-request the review, or skip — **never proceed without user approval when the review loop fails**
   - If the review request silently disappears (reviewRequests becomes empty without a review being posted), re-request the review once and resume polling

3. **Check for unresolved comments**
   - Filter review threads for `isResolved: false`
   - **First, verify the review was successful**: check that the latest Copilot review body does NOT contain "Copilot encountered an error" or "unable to review". If it does, this is an error response — go back to step 1 (re-request) instead of proceeding. This check is critical because error reviews have no comments and no unresolved threads, making them look identical to a clean review.
   - Also count the total comments in the latest review (check the review body for "generated N comments")
   - If the latest review has **zero comments** (body says "generated 0 comments" or no unresolved threads exist): the PR is clean — exit the loop
   - If **there are unresolved comments**: proceed to fix them (step 4)

4. **Fix all unresolved review comments**
   For each unresolved thread:
   - Read the referenced file and understand the feedback
   - Make the code fix
   - Run the build (`npm run build` or the project's build command)
   - If build passes, commit with message `address review: <summary of changes>`
   - Resolve the thread via GraphQL mutation:
     ```bash
     gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: "THREAD_ID"}) { thread { id isResolved } } }'
     ```
   - After all threads are resolved, push all commits to remote
   - **Re-request a Copilot review** via API (same command as step 1)
   - **Go back to step 2** (wait for new review) — this loop MUST repeat until Copilot returns a review with zero new comments. Never proceed after only one round of fixes.
