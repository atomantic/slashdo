---
description: Resolve PR review feedback with parallel agents
---

# Resolve PR Review Feedback

Address the latest code review feedback on the current branch's pull request using a team-based approach.

## Steps

1. **Get the current PR and determine repo ownership**: Use `gh pr view --json number,url,reviewDecision,reviews,headRefName,baseRefName` to find the PR for this branch. Parse owner/name from `gh repo view --json owner,name`. Also check the PR's base repository owner — if the PR targets an upstream repo you don't own (i.e., a fork-to-upstream PR), note this as `is_fork_pr=true`. You can detect this by comparing the PR URL's owner against your authenticated user (`gh api user --jq .login`).

2. **Request Copilot code review** (only if `is_fork_pr=false`): Follow the "Requesting GitHub Copilot Code Review" section below to request a review, then poll until the review is complete before proceeding. **Skip this step entirely for fork-to-upstream PRs** — you don't have permission to request reviewers on repos you don't own.

3. **Fetch review comments**: Use `gh api graphql` with stdin JSON to get all unresolved review threads. **CRITICAL: Do NOT use `$variables` in GraphQL queries — shell expansion consumes `$` signs.** Always inline values and pipe JSON via stdin:
   ```bash
   echo '{"query":"{ repository(owner: \"OWNER\", name: \"REPO\") { pullRequest(number: PR_NUM) { reviewThreads(first: 100) { nodes { id isResolved comments(first: 10) { nodes { body path line author { login } } } } } } } }"}' | gh api graphql --input -
   ```
   Save results to `/tmp/pr_threads.json` for parsing.

4. **Spawn a team to address feedback in parallel**:
   - Create a team with `TeamCreate`
   - Create a task for each unresolved review thread using `TaskCreate`
   - Create an additional task for an **independent code quality review** of all files changed in the PR (`gh pr diff --name-only`)
   - Spawn sub-agents (general-purpose type) as teammates to handle each task in parallel:
     - One agent per review thread (or group closely related threads on the same file)
     - One dedicated agent for the code quality review
   - Each agent should:
     - Read the file and understand the context of the feedback
     - Make the requested code changes if they are accurate and warranted
     - Look for further opportunities to DRY up affected code
     - Report back what was changed and the thread ID that was addressed
   - The code quality reviewer should:
     - Read all changed files in the PR
     - Check for: style violations, missing error handling, dead code, DRY violations, security issues
     - Apply fixes directly and report what was changed
   - Wait for all agents to complete, then review their changes

5. **Run tests**: Run the project's test suite to verify all changes pass. Do not proceed if tests fail — fix issues first.

6. **Commit and push**:
   - Stage all changed files and commit with a descriptive message summarizing what was addressed. Do not include co-author info.
   - Push to the branch.

8. **Resolve conversations**: For each addressed thread, resolve it via GraphQL mutation using stdin JSON. **Never use `$variables` in the query — inline the thread ID directly**:
   ```bash
   echo '{"query":"mutation { resolveReviewThread(input: {threadId: \"THREAD_ID_HERE\"}) { thread { id isResolved } } }"}' | gh api graphql --input -
   ```

9. **Request another Copilot review** (only if `is_fork_pr=false`): After pushing fixes, request a fresh Copilot code review and repeat from step 3 until the review passes clean. **Skip for fork-to-upstream PRs.**

10. **Report summary**: Print a table of all threads addressed with file, line, and a brief description of the fix.

!`cat ~/.claude/lib/graphql-escaping.md`

## Requesting GitHub Copilot Code Review

**WARNING**: Do NOT use `@copilot review` in a PR comment — this triggers the **Copilot coding agent** which opens a new PR instead of performing a code review.

### Request via API
```bash
gh api repos/OWNER/REPO/pulls/PR_NUM/requested_reviewers -f 'reviewers[]=copilot-pull-request-reviewer[bot]'
```

**CRITICAL**: The reviewer name MUST include the `[bot]` suffix. Without it (e.g., `copilot-pull-request-reviewer`), the API returns a 422 "not a collaborator" error.

Verify the request was accepted by checking that `Copilot` appears in the response's `requested_reviewers` array.

### Poll for review completion

Poll every 30 seconds using GraphQL to check for a new review with a `submittedAt` timestamp after the request:
```bash
gh api graphql -f query='{ repository(owner: "OWNER", name: "REPO") { pullRequest(number: PR_NUM) { reviews(last: 3) { nodes { state body author { login } submittedAt } } reviewThreads(first: 100) { nodes { id isResolved comments(first: 3) { nodes { body path line author { login } } } } } } } }'
```

Copilot reviews typically take 60-120 seconds. The review is complete when a new `copilot-pull-request-reviewer` review node appears.

## Notes

- Only resolve threads where you've actually addressed the feedback
- If feedback is unclear or incorrect, leave a reply comment instead of resolving
- Do not include co-author info in commits
- For small PRs (1-3 threads), sub-agents may be overkill — use judgment on whether to spawn a team or handle inline
- Always run tests before committing — never push code with known failures
- Shut down the team after all work is complete
