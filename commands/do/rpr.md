---
description: Resolve PR review feedback with parallel agents
argument-hint: "[--interactive]"
---

**Default mode: fully autonomous.** Fetches review feedback, fixes issues, pushes, resolves threads, and loops Copilot reviews without prompting. Auto-skips on timeout/errors after retries.

**`--interactive` mode:** Pauses on Copilot review timeout and repeated errors to ask the user how to proceed.

# Resolve PR Review Feedback

Address the latest code review feedback on the current branch's pull request using parallel sub-agents.

## Steps

1. **Get the current PR and determine repo ownership**: Use `gh pr view --json number,url,reviewDecision,reviews,headRefName,baseRefName` to find the PR for this branch. Parse owner/name from `gh repo view --json owner,name`. Also check the PR's base repository owner — if the PR targets an upstream repo you don't own (i.e., a fork-to-upstream PR), note this as `is_fork_pr=true`. You can detect this by comparing the PR URL's owner against your authenticated user (`gh api user --jq .login`).

2. **Check for existing code review** (only if `is_fork_pr=false`): Before requesting a new review, check if there's already a completed Copilot review or a pending Copilot review in progress. Query the PR's review requests and recent reviews:
   ```bash
   gh api graphql -f query='{ repository(owner: "OWNER", name: "REPO") { pullRequest(number: PR_NUM) { reviewRequests(first: 10) { nodes { requestedReviewer { ... on Bot { login } } } } reviews(last: 20) { nodes { state body author { login } submittedAt } } } } }'
   ```
   - **If at least one completed Copilot review exists** (a review in `reviews.nodes` authored by `copilot-pull-request-reviewer`): Skip requesting a new review — proceed directly to step 3 to fetch and address the existing feedback threads.
   - **If a Copilot review is currently pending** (Copilot appears in `reviewRequests.nodes[].requestedReviewer` as `copilot-pull-request-reviewer`): Treat the review as in progress. Poll for completion using the "Poll for review completion" section below, and consider it complete once a new Copilot review appears in `reviews.nodes` with a `submittedAt` timestamp later than the latest Copilot review timestamp you observed before starting to poll. Then proceed to step 3.
   - **If no Copilot review exists and no Copilot review is currently requested**: Request a new Copilot review per the "Requesting GitHub Copilot Code Review" section below, poll until complete, then proceed.
   - **Skip this step entirely for fork-to-upstream PRs** — you don't have permission to request reviewers on repos you don't own.

   **While waiting for review**: The persistent monitor (see "Poll for review completion" below) emits CI bucket transitions as events, so you'll be notified of failures without a separate poll. Fix any CI failures before the review completes (see "CI failure handling").

3. **Fetch review comments**: Use `gh api graphql` with stdin JSON to get all unresolved review threads. **CRITICAL: Do NOT use `$variables` in GraphQL queries — shell expansion consumes `$` signs.** Always inline values and pipe JSON via stdin:
   ```bash
   echo '{"query":"{ repository(owner: \"OWNER\", name: \"REPO\") { pullRequest(number: PR_NUM) { reviewThreads(first: 100) { nodes { id isResolved comments(first: 10) { nodes { body path line author { login } } } } } } } }"}' | gh api graphql --input -
   ```
   Save results to `/tmp/pr_threads.json` for parsing.

   **Thread-count tracking**: Count and report total unresolved threads upfront (e.g., "Found 7 unresolved review threads"). After resolution, report how many were addressed vs. remaining (e.g., "Resolved 5/7 threads, 2 left unaddressed"). This prevents partial sessions from going unnoticed across context resets.

4. **Spawn parallel sub-agents to address feedback**:
   - For small PRs (1-3 unresolved threads), handle fixes inline instead of spawning agents
   - For larger PRs, spawn one `Agent` call (general-purpose type) per review thread (or group closely related threads on the same file into one agent)
   - Spawn one additional `Agent` call for an **independent code quality review** of all files changed in the PR (`gh pr diff --name-only`)
   - Launch all Agent calls **in parallel** (multiple tool calls in a single response) and wait for all to return
   - **Model selection**: Use `model: "sonnet"` for all sub-agents — thread fixes and code quality reviews are well-scoped tasks that don't require Opus. Only escalate to `model: "opus"` if a thread involves genuinely complex architectural reasoning that Sonnet cannot resolve.
   - Each thread-fixing agent should:
     - Read the file and understand the context of the feedback
     - Make the requested code changes if they are accurate and warranted
     - Look for further opportunities to DRY up affected code
     - Return what was changed and the thread ID that was addressed
   - The code quality reviewer should:
     - Read all changed files in the PR
     - Check for: style violations, missing error handling, dead code, DRY violations, security issues
     - Apply fixes directly and return what was changed
   - After all agents return, review their changes for conflicts or overlapping edits

5. **Run tests**: Run the project's test suite to verify all changes pass. Do not proceed if tests fail — fix issues first.

6. **Commit and push**:
   - Stage all changed files and commit with a descriptive message summarizing what was addressed. Do not include co-author info.
   - Push to the branch.

7. **Resolve conversations**: For each addressed thread, resolve it via GraphQL mutation using stdin JSON. Track resolution count against the total from step 3. **Never use `$variables` in the query — inline the thread ID directly**:
   ```bash
   echo '{"query":"mutation { resolveReviewThread(input: {threadId: \"THREAD_ID_HERE\"}) { thread { id isResolved } } }"}' | gh api graphql --input -
   ```

8. **Decide whether to loop** (only if `is_fork_pr=false`): After pushing fixes, evaluate whether another Copilot review is worth running before requesting one. **Skip for fork-to-upstream PRs.**

   **Worthiness evaluation**: Classify all threads addressed in the last round and decide:
   - **Stop and merge** if ALL of the following are true:
     - Every finding was a trivial nitpick — style preferences, naming suggestions, "consider..." language, minor formatting, or repeats of already-dismissed feedback
     - No finding touched correctness, security, logic, data integrity, or API contracts
     - You made fewer than 3 actual code changes in the last round
   - **Request another review** if any finding was substantive — logic bugs, security issues, missing guards, contract violations, or meaningful refactors

   If stopping: print "All remaining findings are nitpicks — skipping further review loop" and proceed to step 9. If looping: request a fresh Copilot review per the "Requesting GitHub Copilot Code Review" section, then wait on the *existing* persistent monitor (do not start a second one) for the `copilot review:` event, then repeat from step 3.

   **While waiting for review**: The monitor's CI events surface failures as they happen — see "CI failure handling".

   **Repeated-comment dedup**: When fetching threads after a new Copilot review round, compare each new unresolved thread's comment body and file/line against threads from the previous round that were intentionally left unresolved (replied to as non-issues or disagreements). If all new unresolved threads are repeats of previously-dismissed feedback, treat the review as clean (no new actionable comments) and exit the loop.

9. **Report summary**: Print a table of all threads addressed with file, line, and a brief description of the fix. Include a final count line: "Resolved X/Y threads." If any threads remain unresolved, list them with reasons (unclear feedback, disagreement, requires user input).

10. **Documentation recommendations**: After printing the summary, run the Documentation Recommendations phase against the issues addressed in this session. Surface concrete suggestions for project documentation updates (CLAUDE.md, CONTRIBUTING.md, README.md, in-tree comments) that would prevent the same class of issue in future PRs. **Read-only on project docs — surface suggestions only, never auto-edit.**

!`cat ~/.claude/lib/post-review-doc-recommendations.md`

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

**Use ONE persistent `Monitor` for the entire rpr session, not a fresh background poll per loop iteration.** Spawning a new poller per round produces a thicket of subshell tasks (you can end up with 5+ active background bash tasks across a single rpr session) — wasteful, confusing in the task list, and easy to lose track of.

Start the monitor *once* (right after the first review request, or at session entry if a review is already pending). It tracks the most-recent Copilot review timestamp it has observed and emits exactly one event per *new* review that lands. In the same loop, transition-detect CI checks so you also get one event per CI bucket flip — no separate CI poll needed.

```bash
# Replace OWNER/REPO/PR_NUM with literals — no shell variables inside the GraphQL query string.
# SEED_TS defaults to the documented far-past sentinel so an unsubstituted placeholder
# still works correctly (lexicographic comparison against a "2026-..." timestamp). Override
# only if you want to skip past reviews you've already processed.
Monitor:
  description: "PR PR_NUM — Copilot reviews + CI"
  timeout_ms: 1800000   # 30 min; raise if your reviews are routinely slower
  persistent: true
  command: |
    latest="1970-01-01T00:00:00Z"   # override with the last seen submittedAt to skip already-seen reviews
    # Seed CI baseline once so the first tick doesn't fire a spurious burst of "ci:" events
    # for every check that was already in a terminal bucket when the monitor started.
    s0=$(gh pr checks PR_NUM --json name,bucket 2>/dev/null || echo '[]')
    ci_prev=$(jq -r '.[] | select(.bucket!="pending") | "\(.name): \(.bucket)"' <<<"$s0" 2>/dev/null | sort)
    while true; do
      # New Copilot reviews since `latest`? Iterate in ascending order so that
      # if multiple reviews land between ticks each one emits its own event,
      # and `latest` advances to the most recent (max) — not the earliest.
      new_list=$(echo "{\"query\":\"{ repository(owner: \\\"OWNER\\\", name: \\\"REPO\\\") { pullRequest(number: PR_NUM) { reviews(last: 5) { nodes { author { login } submittedAt } } } } }\"}" \
        | gh api graphql --input - 2>/dev/null \
        | jq -r --arg t "$latest" '[.data.repository.pullRequest.reviews.nodes[]? | select(.author.login=="copilot-pull-request-reviewer") | select(.submittedAt > $t) | .submittedAt] | sort | .[]')
      if [ -n "$new_list" ]; then
        while IFS= read -r ts; do
          echo "copilot review: $ts"
          latest="$ts"
        done <<<"$new_list"
      fi
      # CI bucket transitions on the same tick.
      # Note: a check that goes fail → pending → fail (same terminal bucket as before)
      # produces no event — the bucket value didn't actually change. If you need to
      # detect re-failures, watch `gh run list` for new attempts on the failed check.
      s=$(gh pr checks PR_NUM --json name,bucket 2>/dev/null || echo '[]')
      cur=$(jq -r '.[] | select(.bucket!="pending") | "\(.name): \(.bucket)"' <<<"$s" 2>/dev/null | sort)
      comm -13 <(echo "$ci_prev") <(echo "$cur") | sed 's/^/ci: /'
      ci_prev=$cur
      sleep 25
    done
```

When you push a fix and want another review, just *request* it (the API call above) and keep working — the existing monitor will emit `copilot review: <timestamp>` when it lands. **Do not start a second monitor**; if you've drifted into "I should poll for the next one," stop and use the running one instead.

**Stop the monitor only when you're done with the rpr loop** (use `TaskStop` with the monitor's id), or let it time out naturally.

**Poll cadence + "stuck" threshold**: the monitor uses a fixed 25 s tick (covers the typical 30–90 s review latency without burning quota). The cadence itself is *not* dynamic. What *is* dynamic is the **stuck threshold**: if a review hasn't landed after **3× the historical average latency for this PR** (minimum 90 s, maximum 5 min), the rpr loop should surface it via a one-shot status check and treat it as stuck rather than slow — that decision lives in the rpr loop body, not in the monitor's sleep.

The review is "complete" when a new `copilot review:` event fires. If no event arrives by the deadline you set: **Default mode**: auto-skip and continue. **Interactive mode (`--interactive`)**: ask the user whether to continue waiting, re-request, or skip.

**Error detection**: After a review event fires, fetch the review body and check for error text such as "Copilot encountered an error" or "unable to review this pull request". If found, this is NOT a successful review — log a warning, re-request the review (same API call above), and let the existing monitor catch the retry's completion event. Allow up to 3 error retries. After 3 failures: **Default mode**: auto-skip and continue. **Interactive mode (`--interactive`)**: ask the user whether to continue or skip.

## CI failure handling

The persistent monitor (see "Poll for review completion" above) emits one event per CI check bucket transition — `ci: lint: pass`, `ci: test (20.x): fail`, etc. — without you needing a separate poll. On a failure event:

1. Fetch logs for the failing check:
   ```bash
   RUN_ID="$(gh pr checks PR_NUM --json name,conclusion,detailsUrl \
     --jq '.[] | select(.conclusion=="FAILURE") | .detailsUrl | capture("/runs/(?<id>[0-9]+)") | .id' \
     | head -n1)"
   gh run view "$RUN_ID" --log-failed
   ```
2. Fix the failure, run tests locally to confirm, commit, and push. The Copilot review request typically re-applies to the new commit; if not, re-request after the push.

Fixing CI failures early avoids burning a Copilot review cycle on code that won't ship anyway.

## Notes

- Only resolve threads where you've actually addressed the feedback
- If feedback is unclear or incorrect, leave a reply comment instead of resolving
- Always run tests before committing — never push code with known failures
- **Never dismiss findings as "out of scope" or "not modified in this PR."** If a review identifies a real issue, fix it — regardless of whether the current PR touched that code. Evaluate every finding on its merits. Don't leave trash on the floor.
