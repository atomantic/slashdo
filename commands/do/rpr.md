---
description: Resolve PR/MR review feedback with parallel agents
argument-hint: "[--interactive] [--review-with <agent>[,<agent>...]] [--reviewer-applies] [--issues-label <name>]"
---

**Default mode: fully autonomous.** Fetches review feedback, fixes issues, pushes, resolves threads, and loops reviews without prompting. Auto-skips on timeout/errors after retries.

**`--interactive` mode:** Pauses on review timeout and repeated errors to ask the user how to proceed.

# Resolve PR Review Feedback

Address the latest review feedback on the current branch's PR (GitHub) or merge request (GitLab) using parallel sub-agents. On GitLab a "thread" is a resolvable MR discussion. **Thread resolution is reviewer-agnostic** — rpr resolves every unresolved thread it has addressed, whoever authored it (Copilot, a human, another bot). `--review-with` controls only which reviewer rpr *requests* (and re-requests in the loop).

## Parse Arguments

!`cat ~/.claude/lib/review-flags.md`

rpr-only consequences of the grammar above:
- `{ENTRY_MAX}` is forwarded as `{MAX_ITERATIONS}` and `{ENTRY_EFFORT}` as `{REVIEW_EFFORT}` / `{OLLAMA_EFFORT}` to the **local-agent** and **Ollama** loops it dispatches (the same loops `/do:pr` uses); neither reaches rpr's `copilot` entry, which runs rpr's own bespoke request/monitor flow, not the shared multi-reviewer loop. rpr does not support `--review-iterations`; use the per-entry `~max=<n>` suffix instead. `--review-mode` and the `--review-stop-on-*` flags likewise have no effect — rpr dispatches each listed reviewer directly rather than through the shared wrapper.
- **`@<login>` entries are accepted by the parser but never requested** — rpr's only reviewer-request path is its bespoke Copilot flow (arbitrary-reviewer dispatch is a tracked follow-up). Drop any `@<login>` entry from `REVIEW_AGENTS` after parsing/dedup, whether typed or inherited from a saved `review-with` default, and print `Note: @<login> is not yet supported by /do:rpr — dropped from --review-with.` If that leaves an explicitly typed `--review-with` empty, set `REVIEW_AGENTS=[]` and run the no-reviewer path — do **not** fall through to the saved default. If `--review-with` is omitted and `REVIEW_AGENTS` is still unset after the saved-defaults step, rpr requests no new review and just resolves the PR's existing unresolved threads.

After parsing the flags above, apply any **saved defaults** (set via `/do:config`) to `review-with` / `reviewer-applies` / `issues-label` the user did not pass. Precedence: explicit flag (or `--review-with none`) > saved `review-with` default > `REVIEW_AGENTS=[]` (see step 2 and step 8). rpr ignores saved `review-iterations` / `review-stop-mode` (it does not support those flags):

!`cat ~/.claude/lib/review-config-defaults.md`

Parse `$ARGUMENTS` for `--issues-label <name>`: a **deferred** finding (see Finding Disposition) is filed as a tracker issue — GitHub, GitLab, or Jira (`/do:config --tracker`). Set `PLAN_LABEL` from `--issues-label`, else the saved `issues-label` default, else `plan` (a saved `issues` key is ignored). `--issues` is a deprecated no-op: print once `--issues is now the default (PLAN.md mode was removed); the flag can be dropped.` `--no-issues` aborts with `--no-issues is no longer supported: PLAN.md mode was removed. slashdo records work only in the project's issue tracker.`

## Detect Code Host

Select the forge from the `origin` remote with the shared preflight (`{COMMAND}` = `/do:rpr`). Every host step below either runs a verb from the selected host's verb file (`cr-state`, `reply-thread`, `resolve-thread`, `ci-status`) or is an inline form labeled with its host:

!read lib/vcs-host.md

Only when `CODE_HOST=github`, derive `GH_HOST` and read the GitHub verbs:

!read lib/gh-host.md
!read lib/host-github.md

Only when `CODE_HOST=gitlab`, read the GitLab verbs:

!read lib/host-gitlab.md

## Steps

1. **Get the current {CR_NOUN} and determine repo ownership**:
   - **GitHub**: `gh pr view --json number,url,reviewDecision,reviews,headRefName,baseRefName` finds the PR for this branch; parse owner/name from `gh repo view --json owner,name`. **Derive the GitHub API host once as `GH_HOST`** using the shared snippet above — `gh api` ignores the repo remote and defaults to github.com, so every `gh api` call below carries `--hostname GH_HOST` (`gh pr`/`gh repo` resolve the host themselves). If the PR's owner differs from `gh api --hostname GH_HOST user --jq .login` (a fork-to-upstream PR), note `is_fork_pr=true`.
   - **GitLab**: capture `glab mr view --output json` (the MR for the current branch) to a file and check its exit status, then parse the file with `jq`. `.iid` is the `PR_NUMBER` every verb takes. Also read `.web_url`, `.state`, `.source_branch` (head branch), `.target_branch` (base branch), and `.source_project_id` / `.target_project_id`. If there is no MR for this branch, or its `.state` is not `opened`, stop with `No open MR for branch <branch>.` A fork MR (`.source_project_id` ≠ `.target_project_id`) sets `is_fork_pr=true`. The GitLab verbs address this checkout's project (`projects/:id`), so compare `glab api "projects/:id"`'s `.id` with `.target_project_id`. If they differ, stop with `/do:rpr: GitLab MR !<iid> belongs to project <target_project_id>, but the GitLab verbs address this checkout's project <id> (projects/:id) — run /do:rpr from a clone of the target project.`

2. **Check for existing code review and decide which reviewer (if any) to request** (only if `is_fork_pr=false`).

   **On GitLab**, drop every `copilot` entry from `REVIEW_AGENTS` and print `copilot is GitHub's reviewer and is unavailable on this gitlab MR — skipped.` GitLab has no Copilot reviewer, so the review-request query below and the "Requesting GitHub Copilot Code Review" section never run there. `HAS_COPILOT_REVIEW` and `COPILOT_REVIEW_PENDING` stay false. The local-CLI and `ollama` bullets below still apply unchanged, because they review the local checkout. Then continue with the `REVIEW_AGENTS` dispatch below.

   **On GitHub**, query the PR's review requests and recent reviews:
   ```bash
   gh api --hostname GH_HOST graphql -f query='{ repository(owner: "OWNER", name: "REPO") { pullRequest(number: PR_NUM) { reviewRequests(first: 10) { nodes { requestedReviewer { ... on Bot { login } } } } reviews(last: 50) { nodes { state body author { login } submittedAt } } } } }'
   ```
   Record `HAS_EXISTING_REVIEW` (**any** completed review — copilot bot, human, or other bot), `HAS_COPILOT_REVIEW` (a **completed** `copilot-pull-request-reviewer` review — a node in `reviews.nodes`, NOT merely a pending request), and `COPILOT_REVIEW_PENDING` (Copilot in `reviewRequests.nodes[].requestedReviewer` with no completed Copilot review yet — this must NOT set `HAS_COPILOT_REVIEW`, or threads would be resolved before Copilot has posted anything). Then dispatch on `REVIEW_AGENTS`:

   - **If `REVIEW_AGENTS` is empty** (no `--review-with`, no saved default, or an explicit `none`): request **no** review. Proceed straight to step 3 and resolve whatever unresolved threads the PR already carries.
   - **If `REVIEW_AGENTS` contains an entry that is none of `ollama`, `copilot`, or `@<login>`** (the fixed local CLIs and `cmd[<invocation>]` alike): run the **local-agent review loop** (`lib/local-agent-review-loop.md`, "Local-Agent Review Loop" below) for each such agent against the PR branch, forwarding `REVIEWER_APPLIES` (forced `false` for `cmd`) and that entry's `{REVIEW_MODEL}`/`{REVIEW_EFFORT}` (or `{REVIEWER_CMD}` in place of both, for `cmd`), and `{MAX_ITERATIONS}` / `{MAX_EXPLICIT}` (from `~max=<n>`; the built-in `3` / `false` when none). This produces findings (and, in reviewer-applies mode, fixes) locally — it does **not** request a Copilot cloud review. Then proceed to step 3 to resolve any pre-existing threads as well.
   - **If `REVIEW_AGENTS` contains `ollama`:** run the **Ollama review loop** (`lib/ollama-review-loop.md`, "Ollama Review Loop" below) for each `ollama` entry against the locally checked-out PR branch, forwarding `{OLLAMA_MODEL}`, `{OLLAMA_EFFORT}`, and `{MAX_ITERATIONS}` / `{MAX_EXPLICIT}` as above. Ollama is always review-only: the orchestrator applies its findings locally, and no Copilot review is requested. Then proceed to step 3.
   - Local-CLI and `ollama` entries do not exclude `copilot`: if `REVIEW_AGENTS` also contains `copilot`, additionally run the Copilot path below.
   - **If `REVIEW_AGENTS` contains `copilot`** (only ever because you asked for it — typed or saved): a `copilot~max=<n>` cap applies here too — see the cap-accounting rule in step 8; rpr accepts no `--review-iterations`, so `~max` is the only budget signal, and each Copilot round counts against it.
     - **A completed Copilot review exists** (`HAS_COPILOT_REVIEW`): skip requesting a new one — proceed to step 3.
     - **A Copilot review is currently pending** (`COPILOT_REVIEW_PENDING`): treat it as in progress. Poll per "Poll for review completion" and consider it complete once a new Copilot review appears in `reviews.nodes` with a `submittedAt` later than the latest Copilot review timestamp observed before polling. Then proceed to step 3.
     - **No Copilot review exists, but a non-Copilot review does** (`HAS_EXISTING_REVIEW && !HAS_COPILOT_REVIEW`): **do NOT request a Copilot review** — rpr summons Copilot only when Copilot is already in play or the PR has no review at all. Proceed directly to step 3.
     - **No review of any kind exists** (`!HAS_EXISTING_REVIEW`): request a new Copilot review per "Requesting GitHub Copilot Code Review" below, poll until complete, then proceed.
   - **Skip this step entirely for fork-to-upstream PRs** — you can't request reviewers on repos you don't own. Still proceed to step 3.

   **While waiting for review** (GitHub; GitLab has no review wait): the persistent monitor ("Poll for review completion") emits CI bucket transitions as events; fix any CI failures before the review completes ("CI failure handling").

3. **Fetch review comments**: run the `cr-state` verb and keep the unresolved threads, whoever wrote them:
   - **GitHub**: fill in `{OWNER}`/`{REPO}`/`{PR_NUMBER}`/`{GH_HOST}`, then keep `reviewThreads.nodes[]` with `isResolved == false`. Each thread's conversation is `comments.nodes`.
   - **GitLab**: `{PR_NUMBER}` is the MR iid, and `{REVIEWER_LOGIN}` is empty because rpr reads only threads. The verb reads `glab api "projects/:id/merge_requests/{PR_NUMBER}/discussions"`. Keep `.threads[]` with `resolved == false`: the unresolved resolvable MR discussions. Each discussion's conversation is `.comments`, and its anchor is `.path`/`.line` (`null` for a discussion on the MR as a whole).

   Save the unresolved threads (ID, path, line, author, conversation) to `/tmp/pr_threads.json` for parsing.

   **Thread-count tracking**: report the total unresolved threads upfront (e.g., "Found 7 unresolved review threads") and, after resolution, addressed vs. remaining (e.g., "Resolved 5/7 threads, 2 left unaddressed"), so partial sessions don't go unnoticed across context resets.

4. **Spawn parallel sub-agents to address feedback**:
   - For small PRs (1-3 unresolved threads), handle fixes inline instead of spawning agents — the independent code quality review below still runs, as its own inline pass rather than a spawned agent.
   - For larger PRs, spawn one `Agent` call (general-purpose type) per review thread (or group closely related threads on the same file into one agent)
   - Spawn one additional `Agent` call for an **independent code quality review** of all files changed in the {CR_NOUN} (GitHub: `gh pr diff --name-only`; GitLab: `git fetch origin <target_branch>` then `git diff --name-only FETCH_HEAD...HEAD`)
   - Launch all Agent calls **in parallel** (multiple tool calls in a single response) and wait for all to return
   - **Model selection**: run all sub-agents at the **`medium` tier**; escalate a thread to **`heavy`** only for genuinely complex architectural reasoning. Resolve tiers against the host per [lib/model-tiers.md](../../lib/model-tiers.md) (`heavy` = this host's strongest model by alias — `model: "opus"` on Claude Code — never a pinned version ID).
   - Each thread-fixing agent should:
     - Read the file and understand the context of the feedback
     - Make the requested code changes if they are accurate and warranted
     - **Identify the root cause** of why the issue landed and apply the smallest matching action **in the same change**, per `~/.claude/lib/review-fix-conventions.md`; defer big refactors and cross-cutting patterns to the end-of-loop Convention Encoding phase.
     - Return what was changed, the thread ID that was addressed, and the root-cause action taken (or "none — one-off")
   - The code quality reviewer is **one additional agent that reviews all changed files for logic defects the threads missed (no style nits)** — a real bug, a missing error-handling path, a broken contract, a security issue — under the same `~/.claude/lib/finding-disposition.md` rules the thread agents use. It should:
     - Read all changed files in the PR
     - For each issue found, also apply the smallest root-cause action per `~/.claude/lib/review-fix-conventions.md`
     - Apply fixes directly and return what was changed plus the root-cause actions taken
   - After all agents return, review their changes for conflicts or overlapping edits

5. **Convention encoding**: after all thread fixes and the independent code quality review return, run the end-of-cycle phase from `~/.claude/lib/review-fix-conventions.md` against the issues addressed this round. Apply encoded actions on the checked-out PR branch before testing or delivery so they ship with the fixes.

6. **Run tests**: Run the project's test suite after convention encoding. Do not proceed if tests fail — fix issues first.

7. **Commit and push**:
   - Stage all changed files and commit as `address review (<reviewer>): <summary>`, where `<reviewer>` is the thread author's login (e.g. `copilot`, a human's login), or `self` when the fix came from the inline/quality pass with no single thread author. Do not include co-author info.
   - Push to the branch.
   - **GitLab**: no persistent monitor is running to report CI (it only waits on Copilot), so check the pushed head's pipeline now, per "CI failure handling".

8. **Resolve conversations**: For each addressed thread, run the `resolve-thread` verb with its thread ID (GitHub: the review-thread node `id`; GitLab: the discussion `id`). Track resolution count against the total from step 3. A thread you leave open gets a reply through the `reply-thread` verb instead: a concrete reason it is not a real issue (Finding Disposition's "reply"), or the question when the feedback is unclear. A deferred finding's reply names the filed issue (by key, `PROJ-123`, on a Jira tracker). Replies go in the thread itself, never in a new top-level comment, on either host. A failed verb is a failure: report it, and never count that thread as resolved.

9. **Decide whether to loop** (only if `is_fork_pr=false` — **skip for fork-to-upstream PRs**): after pushing fixes, evaluate whether another review round is worth running.

   **Re-request gate (which reviewer, if any):**
   - **If `REVIEW_AGENTS` is empty, there is no reviewer to re-request.** Skip the worthiness evaluation and proceed to step 10.
    - **Only re-request a Copilot review if Copilot is the reviewer actually in play** (on GitHub; step 2 already dropped `copilot` on GitLab) — `REVIEW_AGENTS` contains `copilot` **and** the threads you just resolved came from a Copilot review (`HAS_COPILOT_REVIEW`). If the round resolved only non-Copilot threads (e.g. a human review), do NOT request a Copilot review — proceed to step 10. A `copilot~max=<n>` cap bounds this re-request loop under the accounting below; rpr's Copilot loop is bespoke and does not dispatch through the shared reviewer loop, so nothing else enforces the budget — count each requested Copilot round and stop once `n` is spent.
   - For a **local CLI** (none of `ollama`, `copilot`, or `@<login>` — the fixed CLIs and `cmd[<invocation>]` alike) or `ollama` entry, "another round" means re-running that entry's loop (local-agent, or Ollama with `{OLLAMA_MODEL}` against the locally checked-out PR branch) — not a Copilot request. Each loop manages its cap (`{MAX_ITERATIONS}`, built-in `3` unless `~max=<n>` moved it) *within* one dispatch, so typically one pass suffices; loop again only if the last round made substantive fixes **and** the entry has budget left.
   - **A per-entry `~max=<n>` is a total budget, not a per-dispatch one — for every reviewer type, including `copilot` and `@<login>`.** An inner loop enforces the cap only within its own dispatch, so handing the same entry a fresh `n` every outer round would let `--review-with ollama~max=1` run unbounded. Track each entry's **rounds spent so far** across this outer loop (sum the iterations its inner loop reported on every dispatch); for an entry whose cap was explicitly configured (`{MAX_EXPLICIT}=true`, `n ≥ 1`), stop re-dispatching once the total reaches `n`, and forward the *remaining* budget (`n - spent`), not `n`, on any subsequent dispatch. An entry on its built-in default cap or on `~max=0` (unlimited) is stopped only by the worthiness evaluation below; so is an uncapped `copilot` entry, which has **no** built-in per-entry cap in rpr.

   **Worthiness evaluation** (applies to whichever reviewer is in play): apply `~/.claude/lib/review-convergence-gate.md` to the last round's landed findings.

   If it converges: print "Review loop converged — skipping further rounds" and proceed to step 10. If looping with Copilot: request a fresh Copilot review per "Requesting GitHub Copilot Code Review", wait on the *existing* persistent monitor (never a second one) for the `copilot review:` event, then repeat from step 3 (the monitor's CI events surface failures meanwhile — see "CI failure handling"). If looping with a local CLI or `ollama`: re-run its loop, then repeat from step 3.

   **Repeated-comment dedup**: after a new Copilot round, compare each new unresolved thread's body and file/line against the previous round's intentionally-unresolved threads (replied to as non-issues or disagreements). If every new unresolved thread is a repeat of dismissed feedback, treat the review as clean and exit the loop.

10. **Report summary**: Print a table of all threads addressed with file, line, and a brief description of the fix. Include a final count line: "Resolved X/Y threads." If any threads remain unresolved, list them with reasons (unclear feedback, disagreement, requires user input). List deferred findings with their issue numbers (keys on Jira), or as unfiled per `plan-issue-setup.md`'s no-tracker rule. Append the `## Conventions Encoded` section produced by step 5, after the verified commit and push.

!`cat ~/.claude/lib/finding-disposition.md`

Only when a finding is being deferred:

!read lib/vcs-host.md
!read lib/plan-issue-setup.md
!read lib/plan-issue-filing.md

!`cat ~/.claude/lib/review-fix-conventions.md`

## Local-Agent Review Loop (for `--review-with codex|agy|claude|grok|pi|cursor|opencode|cmd[<invocation>]`)

When `REVIEW_AGENTS` names a local CLI, step 2 (and the step-8 re-request) runs that agent's review against the PR branch via the shared local-agent loop. Pass `{REVIEW_AGENT}`, `{REVIEWER_APPLIES}`, that entry's resolved `{REVIEW_MODEL}` (its `<agent>[<model>]` bracket, else the saved `review-models[slug]` default resolved above — project over global — else empty (CLI default for other agents; no slashdo model override for OpenCode); without this, `--review-with=codex[o3]` would silently run the CLI's default model), its `{REVIEW_EFFORT}` (from `~effort=<level>`; empty when unset — the loop's effort-carrier table maps it to each CLI's accepted form), the PR branch (`headRefName`), the base branch (`baseRefName`), and the project `{BUILD_CMD}`. The loop verifies build + tests in the main thread before pushing; afterward, continue to step 3.

Read only when `REVIEW_AGENTS` contains one of those slugs (`cmd` included):

!read lib/local-agent-review-loop.md

## Ollama Review Loop (for `--review-with ollama[<model>]`)

When `REVIEW_AGENTS` names `ollama`, step 2 (and the step-8 re-request) runs the Ollama review loop against the locally checked-out PR branch (it reviews a local `git diff`). Pass `{OLLAMA_MODEL}` (empty = auto-select), `{OLLAMA_EFFORT}` (from `~effort=<level>`; empty when unset), the PR branch (`headRefName`), the base branch (`baseRefName`), and the project `{BUILD_CMD}`. The loop is always review-only (Ollama is non-agentic): it emits findings, the orchestrator applies them, and the main thread verifies build + tests before pushing.

Read only when `REVIEW_AGENTS` contains `ollama`:

!read lib/ollama-review-loop.md

## Requesting GitHub Copilot Code Review (legacy — on GitHub, when `copilot` is in `REVIEW_AGENTS`)

Runs **only** when `copilot` was asked for explicitly (typed flag or saved default). Do NOT use `@copilot review` in a PR comment — that triggers the **Copilot coding agent**, which opens a new PR instead of reviewing.

### Request via API
```bash
gh api --hostname GH_HOST repos/OWNER/REPO/pulls/PR_NUM/requested_reviewers -f 'reviewers[]=copilot-pull-request-reviewer[bot]'
```

The reviewer name MUST include the `[bot]` suffix; without it the API returns a 422 "not a collaborator" error. Verify `Copilot` appears in the response's `requested_reviewers` array.

### Poll for review completion

**Use ONE persistent `Monitor` for the entire rpr session, not a fresh background poll per loop iteration.** Start it *once* (right after the first review request, or at session entry if a review is already pending). It tracks the most-recent Copilot review timestamp it has observed and emits exactly one event per *new* review, and transition-detects CI checks in the same loop — one event per CI bucket flip, no separate CI poll.

```bash
# Replace OWNER/REPO/PR_NUM/GH_HOST with literals (no shell $variables in the GraphQL query
# string); GH_HOST goes in `--hostname GH_HOST`, outside the query. `gh pr checks --json
# name,bucket` buckets are: pass, fail, cancel, skipping, pending — emitted verbatim in
# `ci: <name>: <bucket>` events.
Monitor:
  description: "PR PR_NUM — Copilot reviews + CI"
  timeout_ms: 1800000   # 30 min; raise if your reviews are routinely slower
  persistent: true
  command: |
    # Seed the review baseline from the current max submittedAt so tick 1 doesn't replay
    # every historical Copilot review as if it just landed. Retry until GraphQL + jq succeed.
    latest=""
    latest_seeded=""
    while [ -z "$latest_seeded" ]; do
      raw=$(echo "{\"query\":\"{ repository(owner: \\\"OWNER\\\", name: \\\"REPO\\\") { pullRequest(number: PR_NUM) { reviews(last: 50) { nodes { author { login } submittedAt } } } } }\"}" \
        | gh api --hostname GH_HOST graphql --input - 2>/dev/null)
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
    # Seed the CI baseline once too, so tick 1 doesn't fire a spurious burst for every check
    # already in a terminal bucket when the monitor started.
    ci_prev=""
    ci_prev_seeded=""
    while [ -z "$ci_prev_seeded" ]; do
      s0=$(gh pr checks PR_NUM --json name,bucket 2>/dev/null)
      if [ -z "$s0" ]; then
        sleep 5
        continue
      fi
      if ci_raw=$(jq -r '.[] | select(.bucket!="pending") | "\(.name): \(.bucket)"' <<<"$s0"); then
        ci_prev=$(printf '%s\n' "$ci_raw" | sort)
        ci_prev_seeded=1
      else
        sleep 5
      fi
    done
    while true; do
      new_list=$(echo "{\"query\":\"{ repository(owner: \\\"OWNER\\\", name: \\\"REPO\\\") { pullRequest(number: PR_NUM) { reviews(last: 50) { nodes { author { login } submittedAt } } } } }\"}" \
        | gh api --hostname GH_HOST graphql --input - 2>/dev/null \
        | jq -r --arg t "$latest" '[.data.repository.pullRequest.reviews.nodes[]? | select(.author.login=="copilot-pull-request-reviewer") | select(.submittedAt > $t) | .submittedAt] | sort | .[]')
      if [ -n "$new_list" ]; then
        while IFS= read -r ts; do
          echo "copilot review: $ts"
          latest="$ts"
        done <<<"$new_list"
      fi
      # `gh pr checks` exits non-zero when any check is failing, so capture output
      # unconditionally rather than `|| echo '[]'` (which would concatenate onto it).
      s=$(gh pr checks PR_NUM --json name,bucket 2>/dev/null)
      if [ -z "$s" ]; then
        sleep 25
        continue
      fi
      if cur_raw=$(jq -r '.[] | select(.bucket!="pending") | "\(.name): \(.bucket)"' <<<"$s"); then
        cur=$(printf '%s\n' "$cur_raw" | sort)
        comm -13 <(printf '%s' "$ci_prev" | grep -v '^$' || true) <(printf '%s' "$cur" | grep -v '^$' || true) | sed 's/^/ci: /'
        ci_prev=$cur
      fi
      sleep 25
    done
```

When you push a fix and want another review, just *request* it (the API call above) and keep working — the existing monitor emits `copilot review: <timestamp>` when it lands. **Do not start a second monitor.** Stop it only when the rpr loop is done (`TaskStop` with the monitor's id), or let it time out.

**Poll cadence + "stuck" threshold**: the monitor's tick is a fixed 25 s (covers the typical 30–90 s review latency). The **stuck threshold** is a fixed 10 minutes: if a review hasn't landed by then, surface it via a one-shot status check and treat it as stuck — that decision lives in the rpr loop body, not in the monitor's sleep.

The review is "complete" when a new `copilot review:` event fires. If no event arrives by the deadline you set: **Default mode**: auto-skip and continue. **Interactive mode (`--interactive`)**: ask the user whether to continue waiting, re-request, or skip.

**Error detection**: after a review event fires, fetch the review body and check for error text such as "Copilot encountered an error" or "unable to review this pull request". If found, log a warning, re-request the review (same API call above), and let the existing monitor catch the retry. Allow up to 3 error retries. After 3 failures: **Default mode**: auto-skip and continue. **Interactive mode (`--interactive`)**: ask the user whether to continue or skip.

## CI failure handling

**GitHub**: the persistent monitor emits one event per CI check bucket transition — `ci: lint: pass`, `ci: test (20.x): fail`, etc. On a failure event:

1. Fetch logs for the failing check, using the monitor's `bucket` vocabulary (`pass` / `fail` / `cancel` / `skipping` / `pending`; `fail` fires the `ci: <name>: fail` event):
   ```bash
   RUN_ID="$(gh pr checks PR_NUM --json name,bucket,detailsUrl \
     --jq '.[] | select(.bucket=="fail") | .detailsUrl | capture("/runs/(?<id>[0-9]+)") | .id' \
     | head -n1)"
   gh run view "$RUN_ID" --log-failed
   ```
2. Fix the failure, run tests locally to confirm, commit, and push. The Copilot review request typically re-applies to the new commit; if not, re-request after the push.

**GitLab**: no monitor runs, so after each step-6 push, run the `ci-status` verb. Block on `glab ci status --wait --branch <source_branch>` until the pipeline finishes. Then read `cr-state`'s `.pipeline`, and trust its `status` only when `.pipeline.sha` is the head you pushed. A `null` pipeline means the project runs no CI for this MR, so there is nothing to check. On `failed`:

1. Fetch the failed jobs' logs for `.pipeline.id`. Capture the `glab api` call and check its exit status before parsing with `jq` (never pipe `glab api` into `jq`):
   ```bash
   JOBS_FILE="$(mktemp)" && trap 'rm -f "$JOBS_FILE"' EXIT
   glab api "projects/:id/pipelines/PIPELINE_ID/jobs?scope[]=failed" > "$JOBS_FILE" \
     || { echo "could not list the failed jobs of pipeline PIPELINE_ID"; exit 1; }
   for JOB_ID in $(jq -r '.[].id' "$JOBS_FILE"); do glab ci trace "$JOB_ID"; done
   ```
2. Fix the failure, run tests locally to confirm, commit, push, and check the new pipeline the same way. After 3 red pipelines in a row, stop fixing CI and list the failing jobs in the step-9 summary.

## Notes

- If feedback is unclear or incorrect, leave a reply in the thread (the `reply-thread` verb) instead of resolving
- **Never dismiss findings as "out of scope" or "not modified in this PR."** If a review identifies a real issue, fix it — regardless of whether the current PR touched that code.
- **Default to fixing findings in this PR; defer to a tracker issue only when a fix is genuinely large/architectural or too risky to land here.** See the "Finding Disposition" guidance loaded above for the fix-now / reply / defer decision.
