---
description: Resolve PR review feedback with parallel agents
argument-hint: "[--interactive] [--review-with <agent>[,<agent>...]] [--reviewer-applies] [--issues] [--issues-label <name>]"
---

**Default mode: fully autonomous.** Fetches review feedback, fixes issues, pushes, resolves threads, and loops reviews without prompting. Auto-skips on timeout/errors after retries.

**`--interactive` mode:** Pauses on review timeout and repeated errors to ask the user how to proceed.

# Resolve PR Review Feedback

Address the latest code review feedback on the current branch's pull request using parallel sub-agents. **Thread resolution is reviewer-agnostic** — rpr resolves every unresolved review thread it has addressed, no matter who authored it (Copilot, a human reviewer, or another bot). What `--review-with` controls is which reviewer rpr *requests* (and re-requests in the loop), not which threads it will resolve.

## Parse Arguments

Parse `$ARGUMENTS` for `--review-with <agent[,agent,...]>`:
- Accepted slugs: `copilot`, `codex`, `agy` (aliases `gemini` / `antigravity` — all run the Antigravity CLI's `agy` binary), `claude`, `ollama` (bare `ollama` auto-selects the most capable installed coding model; `ollama[<model>]` pins a specific installed model, e.g. `ollama[qwen2.5-coder:32b]` — strip the bracket into a per-entry `OLLAMA_MODEL`) (comma-separated, ordered list; split on `,`, trim whitespace, normalize `gemini`/`antigravity` → `agy`, dedupe preserving first-occurrence order, with the `ollama` bracket suffix part of the dedup identity). Abort on an unknown slug with `Unknown --review-with value: {value}. Use one of: copilot, codex, agy, claude, ollama.`
- Record as `REVIEW_AGENTS`. **rpr's default is `copilot`** (its established identity is driving a Copilot review to clean) — but the default is *conditional*: see step 2 and step 8. If `--review-with` is omitted, leave `REVIEW_AGENTS` unset for now — the saved-defaults step below fills it from config if a default exists; **only if it is still unset after that** does rpr's conditional `copilot` default apply (`REVIEW_AGENTS=[copilot]`). This ordering is what lets a saved `review-with` default take precedence over the built-in copilot default.
- If `REVIEW_AGENTS` names a **local CLI** (`codex`/`agy`/`claude`, in any combination, with or without `copilot`), rpr requests each non-copilot reviewer via the **local-agent review loop** (`lib/local-agent-review-loop.md`) against the PR branch instead of requesting a Copilot cloud review for that slug. An `ollama` entry instead goes through the **Ollama review loop** (`lib/ollama-review-loop.md`) — it requires the PR branch checked out locally, since the loop reviews a local `git diff`. `copilot` entries still go through the Copilot request/poll path below.

Parse `$ARGUMENTS` for `--reviewer-applies` (boolean): record `REVIEWER_APPLIES=true`/`false` (default `false`). Forwarded to any local-agent review loop; no effect on the Copilot path (a warning is printed if combined with a copilot-only list) or the ollama path (Ollama is non-agentic — always review-only).

After parsing the flags above, apply any **saved defaults** (set via `/do:config`) to `review-with` / `reviewer-applies` if the user did not pass them. Precedence for rpr: an explicit flag (or `--review-with none`) wins; otherwise a saved `review-with` default applies; otherwise rpr's built-in **conditional `copilot`** default takes over (see step 2 and step 8). rpr ignores saved `review-iterations` / `review-stop-mode` (it does not support those flags):

!`cat ~/.claude/lib/review-config-defaults.md`

Parse `$ARGUMENTS` for `--issues` / `--issues-label <name>`: when a finding is **deferred** to the plan (see Finding Disposition), file it as a GitHub/GitLab issue instead of a PLAN.md line. Record `ISSUE_MODE=true`/`false` and `PLAN_LABEL` (default `plan`).

## Steps

1. **Get the current PR and determine repo ownership**: Use `gh pr view --json number,url,reviewDecision,reviews,headRefName,baseRefName` to find the PR for this branch. Parse owner/name from `gh repo view --json owner,name`. Also check the PR's base repository owner — if the PR targets an upstream repo you don't own (i.e., a fork-to-upstream PR), note this as `is_fork_pr=true`. You can detect this by comparing the PR URL's owner against your authenticated user (`gh api user --jq .login`).

2. **Check for existing code review and decide which reviewer (if any) to request** (only if `is_fork_pr=false`): Query the PR's review requests and recent reviews:
   ```bash
   gh api graphql -f query='{ repository(owner: "OWNER", name: "REPO") { pullRequest(number: PR_NUM) { reviewRequests(first: 10) { nodes { requestedReviewer { ... on Bot { login } } } } reviews(last: 50) { nodes { state body author { login } submittedAt } } } } }'
   ```
   Note whether **any** completed review exists (from a copilot bot, a human, or another bot) — call this `HAS_EXISTING_REVIEW` — and specifically whether a **completed** `copilot-pull-request-reviewer` review exists (a node in `reviews.nodes`, NOT merely a pending review request) — call this `HAS_COPILOT_REVIEW`. Track a Copilot review that is only **pending** (Copilot present in `reviewRequests.nodes[].requestedReviewer` with no completed Copilot review yet) separately as `COPILOT_REVIEW_PENDING` — a pending-only review must NOT set `HAS_COPILOT_REVIEW`, or the "completed review exists" branch below would fire and resolve threads before Copilot has posted anything. Then dispatch on `REVIEW_AGENTS`:

   - **If `REVIEW_AGENTS` contains a local CLI (`codex`/`agy`/`claude`):** run the **local-agent review loop** (`lib/local-agent-review-loop.md`, referenced below) for each such agent against the PR branch, forwarding `REVIEWER_APPLIES`. This produces findings (and, in reviewer-applies mode, fixes) locally — it does **not** request a Copilot cloud review for those slugs. Then proceed to step 3 to fetch and resolve any pre-existing unresolved threads as well. (If `REVIEW_AGENTS` also contains `copilot`, additionally run the Copilot path below.)
   - **If `REVIEW_AGENTS` contains `copilot` (including the default):**
     - **A completed Copilot review exists** (`HAS_COPILOT_REVIEW`): skip requesting a new one — proceed to step 3 to address its threads.
     - **A Copilot review is currently pending** (`COPILOT_REVIEW_PENDING` — Copilot in `reviewRequests.nodes[].requestedReviewer`, with no completed Copilot review yet): treat it as in progress. Poll per "Poll for review completion" and consider it complete once a new Copilot review appears in `reviews.nodes` with a `submittedAt` later than the latest Copilot review timestamp observed before polling. Then proceed to step 3.
     - **No Copilot review exists, but a non-Copilot review does** (`HAS_EXISTING_REVIEW && !HAS_COPILOT_REVIEW` — e.g. a human reviewed the PR): **do NOT request a Copilot review.** Proceed directly to step 3 and resolve the existing (non-Copilot) threads. rpr only summons Copilot when Copilot is already the reviewer in play, or when the PR has no review at all (next bullet).
     - **No review of any kind exists** (`!HAS_EXISTING_REVIEW`): request a new Copilot review per "Requesting GitHub Copilot Code Review" below (rpr's default-Copilot identity for an un-reviewed PR), poll until complete, then proceed.
   - **Skip this step entirely for fork-to-upstream PRs** — you don't have permission to request reviewers on repos you don't own. Still proceed to step 3 to resolve any threads already on the PR.

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
     - **Identify the root cause** of why the issue landed (missing lint rule, missing comment at the canonical site, misleading name, API that invites the mistake, etc.) per `~/.claude/lib/per-finding-root-cause.md` and apply the smallest matching action **in the same change**. Defer big refactors and cross-cutting patterns to the end-of-loop Convention Encoding phase.
     - Look for further opportunities to DRY up affected code
     - Return what was changed, the thread ID that was addressed, and the root-cause action taken (or "none — one-off")
   - The code quality reviewer should:
     - Read all changed files in the PR
     - Check for: style violations, missing error handling, dead code, DRY violations, security issues
     - For each issue found, also apply the smallest root-cause action per `~/.claude/lib/per-finding-root-cause.md`
     - Apply fixes directly and return what was changed plus the root-cause actions taken
   - After all agents return, review their changes for conflicts or overlapping edits

5. **Run tests**: Run the project's test suite to verify all changes pass. Do not proceed if tests fail — fix issues first.

6. **Commit and push**:
   - Stage all changed files and commit with a descriptive message summarizing what was addressed. Do not include co-author info.
   - Push to the branch.

7. **Resolve conversations**: For each addressed thread, resolve it via GraphQL mutation using stdin JSON. Track resolution count against the total from step 3. **Never use `$variables` in the query — inline the thread ID directly**:
   ```bash
   echo '{"query":"mutation { resolveReviewThread(input: {threadId: \"THREAD_ID_HERE\"}) { thread { id isResolved } } }"}' | gh api graphql --input -
   ```

8. **Decide whether to loop** (only if `is_fork_pr=false`): After pushing fixes, evaluate whether another review round is worth running. **Skip for fork-to-upstream PRs.**

   **Re-request gate (which reviewer, if any):**
   - **Only re-request a Copilot review if Copilot is the reviewer actually in play** — i.e. `REVIEW_AGENTS` contains `copilot` **and** the threads you just resolved came from a Copilot review (`HAS_COPILOT_REVIEW`). If the round resolved only non-Copilot threads (e.g. a human review), do NOT request a Copilot review — resolve and proceed to step 9. (rpr summons Copilot only when Copilot is already reviewing.)
   - If `REVIEW_AGENTS` names a **local CLI** (`codex`/`agy`/`claude`), "another round" means re-running that agent's local-agent review loop — not a Copilot request. The local-agent loop manages its own fixed iteration cap, so typically one pass suffices; loop again only if you made substantive fixes that warrant a fresh local pass.

   **Worthiness evaluation** (applies to whichever reviewer is in play): Classify all threads/findings addressed in the last round and decide:
   - **Stop and merge** if ALL of the following are true:
     - Every finding was a trivial nitpick — style preferences, naming suggestions, "consider..." language, minor formatting, or repeats of already-dismissed feedback
     - No finding touched correctness, security, logic, data integrity, or API contracts
     - You made fewer than 3 actual code changes in the last round
   - **Request another review** if any finding was substantive — logic bugs, security issues, missing guards, contract violations, or meaningful refactors

   If stopping: print "All remaining findings are nitpicks — skipping further review loop" and proceed to step 9. If looping with Copilot: request a fresh Copilot review per the "Requesting GitHub Copilot Code Review" section, then wait on the *existing* persistent monitor (do not start a second one) for the `copilot review:` event, then repeat from step 3. If looping with a local CLI: re-run its local-agent review loop, then repeat from step 3.

   **While waiting for review**: The monitor's CI events surface failures as they happen — see "CI failure handling".

   **Repeated-comment dedup**: When fetching threads after a new Copilot review round, compare each new unresolved thread's comment body and file/line against threads from the previous round that were intentionally left unresolved (replied to as non-issues or disagreements). If all new unresolved threads are repeats of previously-dismissed feedback, treat the review as clean (no new actionable comments) and exit the loop.

9. **Report summary**: Print a table of all threads addressed with file, line, and a brief description of the fix. Include a final count line: "Resolved X/Y threads." If any threads remain unresolved, list them with reasons (unclear feedback, disagreement, requires user input).

10. **Convention encoding**: After printing the summary, run the Convention Encoding phase against the issues addressed in this session. For each recurring pattern, apply the **smallest** code-level action that makes the convention self-evident (in-tree comment at the canonical site, a clarifying rename, or a surgical refactor that removes the footgun). CLAUDE.md / AGENTS.md additions are a **fallback** — used only when the convention can't be expressed locally. Encoded actions land in the same branch as the rpr fixes.

!`cat ~/.claude/lib/finding-disposition.md`

!`cat ~/.claude/lib/plan-issue-mode.md`

!`cat ~/.claude/lib/per-finding-root-cause.md`

!`cat ~/.claude/lib/post-review-doc-recommendations.md`

!`cat ~/.claude/lib/graphql-escaping.md`

## Local-Agent Review Loop (for `--review-with codex|agy|claude`)

When `REVIEW_AGENTS` names a local CLI, step 2 (and the step-8 re-request) runs that agent's review against the PR branch via the shared local-agent loop instead of requesting a Copilot cloud review. Pass `{REVIEW_AGENT}`, `{REVIEWER_APPLIES}`, the PR branch (`headRefName`), the base branch (`baseRefName`), and the project `{BUILD_CMD}`. The loop verifies build + tests in the main thread before pushing; afterward, continue to step 3 to resolve any pre-existing threads.

!`cat ~/.claude/lib/local-agent-review-loop.md`

## Ollama Review Loop (for `--review-with ollama[ model]`)

When `REVIEW_AGENTS` names `ollama`, step 2 (and the step-8 re-request) runs the Ollama review loop against the locally checked-out PR branch instead of requesting a Copilot cloud review. Pass `{OLLAMA_MODEL}` (empty = auto-select), the PR branch (`headRefName`) checked out locally, the base branch (`baseRefName`), and the project `{BUILD_CMD}`. The loop is always review-only (Ollama is non-agentic): it emits findings, the orchestrator applies them, and the main thread verifies build + tests before pushing.

!`cat ~/.claude/lib/ollama-review-loop.md`

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
# The monitor uses `gh pr checks` with `--json name,bucket` throughout. The `bucket` field
# groups checks into a small fixed vocabulary: `pass`, `fail`, `cancel`, `skipping`, `pending`
# — see `gh pr checks --help`. The emitted `ci: <name>: <bucket>` events embed that vocabulary
# verbatim, so the rpr loop body should switch on those exact values.
Monitor:
  description: "PR PR_NUM — Copilot reviews + CI"
  timeout_ms: 1800000   # 30 min; raise if your reviews are routinely slower
  persistent: true
  command: |
    # Seed the review baseline from the current max submittedAt so the first tick does NOT
    # replay every historical Copilot review on the PR as if it just landed. (If we left
    # this at the epoch sentinel, the very first tick would emit `copilot review:` for every
    # past review, which contradicts the "exactly one event per *new* review" invariant.)
    # Retry until the GraphQL call AND jq both succeed — a one-shot seed that falls back to
    # the epoch sentinel on transient failure would silently replay history on tick 1.
    # `latest` ends up as either the real max timestamp or — only if no Copilot reviews
    # exist yet on this PR — the documented far-past sentinel.
    latest=""
    latest_seeded=""
    while [ -z "$latest_seeded" ]; do
      raw=$(echo "{\"query\":\"{ repository(owner: \\\"OWNER\\\", name: \\\"REPO\\\") { pullRequest(number: PR_NUM) { reviews(last: 50) { nodes { author { login } submittedAt } } } } }\"}" \
        | gh api graphql --input - 2>/dev/null)
      if [ -z "$raw" ]; then
        sleep 5
        continue
      fi
      if latest=$(jq -r '[.data.repository.pullRequest.reviews.nodes[]? | select(.author.login=="copilot-pull-request-reviewer") | .submittedAt] | max // "1970-01-01T00:00:00Z"' <<<"$raw"); then
        latest_seeded=1
      else
        sleep 5
      fi
    done
    # Seed CI baseline once so the first tick doesn't fire a spurious burst of "ci:" events
    # for every check that was already in a terminal bucket when the monitor started. If the
    # first `gh pr checks` call fails (network blip) OR jq itself fails (malformed JSON,
    # missing jq) we'd be left with an empty ci_prev and the next tick would emit a burst
    # for every existing check. Check the two exit statuses separately so we retry on a
    # genuine failure but accept a legitimately-empty "no checks yet" snapshot.
    ci_prev=""
    ci_prev_seeded=""
    while [ -z "$ci_prev_seeded" ]; do
      s0=$(gh pr checks PR_NUM --json name,bucket 2>/dev/null)
      if [ -z "$s0" ]; then
        sleep 5
        continue
      fi
      # Capture jq's exit status BEFORE piping to sort. `if cur=$(jq ... | sort)` would
      # only capture sort's exit (last command in the pipeline) without `set -o pipefail`,
      # masking jq failures and letting an empty cur overwrite the baseline. Two-step
      # capture is explicit and portable.
      if ci_raw=$(jq -r '.[] | select(.bucket!="pending") | "\(.name): \(.bucket)"' <<<"$s0"); then
        ci_prev=$(printf '%s\n' "$ci_raw" | sort)
        ci_prev_seeded=1
      else
        sleep 5
      fi
    done
    while true; do
      # New Copilot reviews since `latest`? Iterate in ascending order so that
      # if multiple reviews land between ticks each one emits its own event,
      # and `latest` advances to the most recent (max) — not the earliest.
      # NOTE: the GraphQL `author.login` field returns `copilot-pull-request-reviewer`
      # *without* a `[bot]` suffix — even though `__typename: Bot`. The `[bot]` form
      # is only required when *requesting* a review via the REST API (see step 1 above).
      # `last: 50` leaves comfortable headroom for fast multi-round sessions where
      # Copilot reviews interleave with reviews from other reviewers. The GraphQL
      # `reviews` connection has no native author filter, so the select() runs *after*
      # the last-N window — meaning the practical Copilot-event headroom is "however
      # many of the last 50 reviews happen to be from Copilot". At 25 s per tick and 50
      # nodes of trailing history, dropping a Copilot review off the back would require
      # >50 reviews in 25 s, which is far outside normal multi-round behaviour. If a
      # workflow ever pushes against that limit, raise the cap further; the response is
      # tiny so 100 or 200 is also viable.
      new_list=$(echo "{\"query\":\"{ repository(owner: \\\"OWNER\\\", name: \\\"REPO\\\") { pullRequest(number: PR_NUM) { reviews(last: 50) { nodes { author { login } submittedAt } } } } }\"}" \
        | gh api graphql --input - 2>/dev/null \
        | jq -r --arg t "$latest" '[.data.repository.pullRequest.reviews.nodes[]? | select(.author.login=="copilot-pull-request-reviewer") | select(.submittedAt > $t) | .submittedAt] | sort | .[]')
      if [ -n "$new_list" ]; then
        while IFS= read -r ts; do
          echo "copilot review: $ts"
          latest="$ts"
        done <<<"$new_list"
      fi
      # CI bucket transitions on the same tick.
      # Event semantics: an event fires when the bucket *string* for a check changes
      # after filtering out `pending`. So `fail → cancel` (or any terminal → different
      # terminal) DOES fire. But `fail → pending → fail` (same terminal bucket either
      # side of a re-run) does NOT — the comm diff sees no change because the pending
      # tick was filtered out. If the rpr loop needs to learn that a re-run finished
      # but landed on the same bucket, watch `gh run list` for new attempts on the
      # failed check rather than relying on a `ci:` event.
      # `gh pr checks` exits non-zero (code 8) when any check is failing — which is exactly
      # the case we want to detect. We must NOT use `|| echo '[]'` here: when gh exits 8,
      # command substitution would concatenate gh's real JSON output with the literal `[]`,
      # producing malformed input that breaks jq. Capture the output unconditionally; only
      # substitute `[]` when the captured output is empty (transport failure, not check
      # failure). Then check jq's exit status separately before updating `ci_prev` — if jq
      # fails we keep the previous baseline so the next tick doesn't emit a spurious burst
      # for every check still in a terminal bucket.
      # Treat an empty `s` as a transient transport failure (gh exit / network blip) and
      # SKIP the ci_prev update entirely — coercing empty to '[]' would parse cleanly,
      # produce an empty cur, and overwrite the baseline. The next successful tick would
      # then surface every existing check as "new" and emit a spurious burst, defeating
      # the whole seed-loop purpose.
      s=$(gh pr checks PR_NUM --json name,bucket 2>/dev/null)
      if [ -z "$s" ]; then
        sleep 25
        continue
      fi
      # Pipefail-avoidance pattern: capture jq's output and exit status BEFORE piping to
      # sort, so a jq failure preserves the baseline rather than overwriting it with the
      # empty string that sort would happily exit 0 on.
      if cur_raw=$(jq -r '.[] | select(.bucket!="pending") | "\(.name): \(.bucket)"' <<<"$s"); then
        cur=$(printf '%s\n' "$cur_raw" | sort)
        # Use `printf '%s'` (no trailing newline) so an empty ci_prev / cur feeds zero
        # lines to comm rather than one blank line. Without this, `echo "$x"` always
        # emits at least a newline, so comm -13 would surface that blank line as "new"
        # on tick 2, producing a spurious `ci: ` event (just the prefix) whenever a
        # baseline transitions empty → empty or empty → populated.
        comm -13 <(printf '%s' "$ci_prev" | grep -v '^$' || true) <(printf '%s' "$cur" | grep -v '^$' || true) | sed 's/^/ci: /'
        ci_prev=$cur
      fi
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

1. Fetch logs for the failing check. Use the same `bucket` field the monitor uses (the
   `gh pr checks` bucket vocabulary is `pass` / `fail` / `cancel` / `skipping` / `pending`;
   `fail` is the one that fires the `ci: <name>: fail` event):
   ```bash
   RUN_ID="$(gh pr checks PR_NUM --json name,bucket,detailsUrl \
     --jq '.[] | select(.bucket=="fail") | .detailsUrl | capture("/runs/(?<id>[0-9]+)") | .id' \
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
- **Default to fixing findings in this PR; defer to PLAN.md only when a fix is genuinely large/architectural or too risky to land here.** Don't park a fixable finding in PLAN.md just because it's more than a one-liner — if you could fix it now, you must. See the "Finding Disposition" guidance loaded above for the fix-now / reply / defer decision.
