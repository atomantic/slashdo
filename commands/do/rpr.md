---
description: Resolve PR review feedback with parallel agents
argument-hint: "[--interactive] [--review-with <agent>[,<agent>...]] [--reviewer-applies] [--issues|--no-issues] [--issues-label <name>]"
---

**Default mode: fully autonomous.** Fetches review feedback, fixes issues, pushes, resolves threads, and loops reviews without prompting. Auto-skips on timeout/errors after retries.

**`--interactive` mode:** Pauses on review timeout and repeated errors to ask the user how to proceed.

# Resolve PR Review Feedback

Address the latest review feedback on the current branch's PR using parallel sub-agents. **Thread resolution is reviewer-agnostic** — rpr resolves every unresolved thread it has addressed, whoever authored it (Copilot, a human, another bot). `--review-with` controls only which reviewer rpr *requests* (and re-requests in the loop).

## Parse Arguments

Parse `$ARGUMENTS` for `--review-with <agent[,agent,...]>`:
- Accepted slugs: `codex`, `agy` (aliases `gemini` / `antigravity` — the Antigravity CLI's `agy` binary), `claude`, `grok`, `pi`, `cursor` (alias `cursor-agent` — the Cursor Agent CLI), `opencode` (aliases `zen` / `opencode-zen` — the OpenCode CLI), `ollama` (bare `ollama` auto-selects the most capable installed coding model; `ollama[<model>]` pins one, e.g. `ollama[qwen2.5-coder:32b]` — strip the bracket into a per-entry `OLLAMA_MODEL`), `copilot` (**legacy** — GitHub's cloud Copilot review; supported when asked for, never selected implicitly), `cmd[<invocation>]` — an escape hatch for any harness not in this list (operator-authored shell command, read prompt on stdin, print the same verdict contract; always review-only; see `lib/local-agent-review-loop.md` "The `cmd` reviewer"), or an arbitrary GitHub login `@<login>`. `codex`/`claude`/`agy`/`grok`/`pi`/`cursor`/`opencode` also accept `<agent>[<model>]` (e.g. `codex[o3]`, `opencode[muse-1.3]`), stripped into a per-entry `REVIEW_MODEL` (empty → the reviewer's built-in default); `copilot` and `@<login>` take no model bracket. Split on `,` **outside the outermost brackets** — a `,` inside a `cmd[<invocation>]` or a nested `[<model>]` (e.g. `cursor[claude-opus-4-7[thinking=true,effort=high]]`) is part of the value, not a new entry; "outermost" is the first `[` to the last `]` of the token — trim whitespace, normalize `gemini`/`antigravity` → `agy`, `cursor-agent` → `cursor`, `zen`/`opencode-zen` → `opencode`, dedupe preserving first-occurrence order (for a model-taking agent — `codex`/`claude`/`agy`/`grok`/`pi`/`cursor`/`opencode`/`ollama` — the `[<model>]` bracket is part of the dedup identity; for `cmd`, the verbatim `[<invocation>]` is). Suffixes — stripped off the right of each token in any order before slug parsing, and excluded from the dedup identity: `~opt` (e.g. `ollama~opt`) marks that reviewer **optional/non-blocking** — still requested and its findings still fixed, but an inconclusive result from it never contributes a merge-blocking `inconclusive` aggregate (a hard-error still does); record as a per-entry `{OPTIONAL}` flag (`ollama~opt` == `ollama`, optional-wins on collapse). `~max=<n>` (e.g. `claude~max=2`) caps how many review → fix → re-review cycles **that one reviewer** runs. `~effort=<level>` (e.g. `codex[gpt-5.6-luna]~effort=max~opt`) sets its reasoning effort level (`low`, `medium`, `high`, `xhigh`, `max`). On a dedup collapse the survivor takes `~opt` if any had it, and cap/effort from the first that carried them. Reject a malformed suffix with `Invalid --review-with suffix on {entry}: ~max must be a non-negative integer and ~effort must be one of low, medium, high, xhigh, max, each appearing at most once; the only suffixes are ~opt, ~max=<n>, and ~effort=<level>.` rpr forwards `{ENTRY_MAX}` as `{MAX_ITERATIONS}` and `{ENTRY_EFFORT}` as `{REVIEW_EFFORT}` / `{OLLAMA_EFFORT}` to the **local-agent** and **Ollama** loops it dispatches (the same loops `/do:pr` uses); neither reaches rpr's `copilot` entry, which runs rpr's own bespoke request/monitor flow, not the shared Copilot loop. See `lib/multi-reviewer-loop.md`. Abort on an unknown slug with `Unknown --review-with value: {value}. Use one of: codex, agy, claude, grok, pi, cursor, opencode, ollama, copilot, cmd[<invocation>], @<login> (each optionally suffixed ~opt, ~max=<n>, and/or ~effort=<level>).` The reserved token `none` (case-insensitive) is **not** validated as a slug — `--review-with none` means no reviewer (`REVIEW_AGENTS=[]`) and overrides any saved `review-with` default.
- **`@<login>` entries are accepted by the parser but never requested** — rpr's only GitHub-side request path is its bespoke Copilot flow (arbitrary-reviewer dispatch is a tracked follow-up). Drop any `@<login>` entry from `REVIEW_AGENTS` after parsing/dedup, whether typed or inherited from a saved `review-with` default, and print `Note: @<login> is not yet supported by /do:rpr — dropped from --review-with.` If that leaves an explicitly typed `--review-with` empty, set `REVIEW_AGENTS=[]` and run the no-reviewer path — do **not** fall through to the saved default.
- Record as `REVIEW_AGENTS`. **There is no built-in default reviewer** — `copilot` is never added implicitly. If `--review-with` is omitted, leave `REVIEW_AGENTS` **unset for now**; the saved-defaults step below fills it from `/do:config`, and only if still unset after that is `REVIEW_AGENTS=[]` (rpr requests no new review and just resolves the PR's existing unresolved threads).

Parse `$ARGUMENTS` for `--reviewer-applies` (boolean): record `REVIEWER_APPLIES=true`/`false` (default `false`). Forwarded to the local-agent review loop, where it reaches only the `codex` pass — the one reviewer with a verified write-isolated profile; every other local reviewer (`claude`/`agy`/`grok`/`pi`/`cursor`/`opencode`/`cmd`) is forced back to review-only. No effect on the Copilot path (warn if combined with a copilot-only list) or the ollama path (Ollama is non-agentic — always review-only).

After parsing the flags above, apply any **saved defaults** (set via `/do:config`) to `review-with` / `reviewer-applies` / `issues` / `issues-label` the user did not pass. Precedence: explicit flag (or `--review-with none`) > saved `review-with` default > `REVIEW_AGENTS=[]` (see step 2 and step 8). rpr ignores saved `review-iterations` / `review-stop-mode` (it does not support those flags):

!`cat ~/.claude/lib/review-config-defaults.md`

Parse `$ARGUMENTS` for `--issues` / `--no-issues` / `--issues-label <name>`: when a finding is **deferred** to the plan (see Finding Disposition), file it as a GitHub/GitLab issue instead of a PLAN.md line. `--issues` sets `ISSUE_MODE=true`; `--no-issues` forces `ISSUE_MODE=false`. If the user passes **neither**, take `ISSUE_MODE` from the saved `issues` default resolved above (built-in default `false`). Set `PLAN_LABEL` from `--issues-label`, else the saved `issues-label` default, else `plan`.

!`cat ~/.claude/lib/gh-host.md`

## Steps

1. **Get the current PR and determine repo ownership**: `gh pr view --json number,url,reviewDecision,reviews,headRefName,baseRefName` finds the PR for this branch; parse owner/name from `gh repo view --json owner,name`. **Derive the GitHub API host once as `GH_HOST`** using the shared snippet above — `gh api` ignores the repo remote and defaults to github.com, so every `gh api` call below carries `--hostname GH_HOST` (`gh pr`/`gh repo` resolve the host themselves). If the PR's owner differs from `gh api --hostname GH_HOST user --jq .login` (a fork-to-upstream PR), note `is_fork_pr=true`.

2. **Check for existing code review and decide which reviewer (if any) to request** (only if `is_fork_pr=false`): Query the PR's review requests and recent reviews:
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

   **While waiting for review**: the persistent monitor ("Poll for review completion") emits CI bucket transitions as events; fix any CI failures before the review completes ("CI failure handling").

3. **Fetch review comments**: Use `gh api graphql` with stdin JSON to get all unresolved review threads. **Do NOT use `$variables` in GraphQL queries — shell expansion consumes `$` signs.** Inline values and pipe JSON via stdin:
   ```bash
   echo '{"query":"{ repository(owner: \"OWNER\", name: \"REPO\") { pullRequest(number: PR_NUM) { reviewThreads(first: 100) { nodes { id isResolved comments(first: 10) { nodes { body path line author { login } } } } } } } }"}' | gh api --hostname GH_HOST graphql --input -
   ```
   Save results to `/tmp/pr_threads.json` for parsing.

   **Thread-count tracking**: report the total unresolved threads upfront (e.g., "Found 7 unresolved review threads") and, after resolution, addressed vs. remaining (e.g., "Resolved 5/7 threads, 2 left unaddressed"), so partial sessions don't go unnoticed across context resets.

4. **Spawn parallel sub-agents to address feedback**:
   - For small PRs (1-3 unresolved threads), handle fixes inline instead of spawning agents
   - For larger PRs, spawn one `Agent` call (general-purpose type) per review thread (or group closely related threads on the same file into one agent)
   - Spawn one additional `Agent` call for an **independent code quality review** of all files changed in the PR (`gh pr diff --name-only`)
   - Launch all Agent calls **in parallel** (multiple tool calls in a single response) and wait for all to return
   - **Model selection**: run all sub-agents at the **`medium` tier**; escalate a thread to **`heavy`** only for genuinely complex architectural reasoning. Resolve tiers against the host per [lib/model-tiers.md](../../lib/model-tiers.md) (`heavy` = this host's strongest model by alias — `model: "opus"` on Claude Code — never a pinned version ID).
   - Each thread-fixing agent should:
     - Read the file and understand the context of the feedback
     - Make the requested code changes if they are accurate and warranted
     - **Identify the root cause** of why the issue landed (missing lint rule, missing comment at the canonical site, misleading name, API that invites the mistake, etc.) per `~/.claude/lib/per-finding-root-cause.md` and apply the smallest matching action **in the same change**; defer big refactors and cross-cutting patterns to the end-of-loop Convention Encoding phase.
     - Look for further opportunities to DRY up affected code
     - Return what was changed, the thread ID that was addressed, and the root-cause action taken (or "none — one-off")
   - The code quality reviewer should:
     - Read all changed files in the PR
     - Check for: style violations, missing error handling, dead code, DRY violations, security issues
     - For each issue found, also apply the smallest root-cause action per `~/.claude/lib/per-finding-root-cause.md`
     - Apply fixes directly and return what was changed plus the root-cause actions taken
   - After all agents return, review their changes for conflicts or overlapping edits

5. **Run tests**: Run the project's test suite. Do not proceed if tests fail — fix issues first.

6. **Commit and push**:
   - Stage all changed files and commit with a descriptive message summarizing what was addressed. Do not include co-author info.
   - Push to the branch.

7. **Resolve conversations**: For each addressed thread, resolve it via GraphQL mutation using stdin JSON. Track resolution count against the total from step 3. **Never use `$variables` in the query — inline the thread ID directly**:
   ```bash
   echo '{"query":"mutation { resolveReviewThread(input: {threadId: \"THREAD_ID_HERE\"}) { thread { id isResolved } } }"}' | gh api --hostname GH_HOST graphql --input -
   ```

8. **Decide whether to loop** (only if `is_fork_pr=false` — **skip for fork-to-upstream PRs**): after pushing fixes, evaluate whether another review round is worth running.

   **Re-request gate (which reviewer, if any):**
   - **If `REVIEW_AGENTS` is empty, there is no reviewer to re-request.** Skip the worthiness evaluation and proceed to step 9.
   - **Only re-request a Copilot review if Copilot is the reviewer actually in play** — `REVIEW_AGENTS` contains `copilot` **and** the threads you just resolved came from a Copilot review (`HAS_COPILOT_REVIEW`). If the round resolved only non-Copilot threads (e.g. a human review), do NOT request a Copilot review — proceed to step 9. A `copilot~max=<n>` cap bounds this re-request loop under the accounting below; rpr's Copilot loop is bespoke (not a dispatch into `lib/copilot-review-loop.md`), so nothing else enforces the budget — count each requested Copilot round and stop once `n` is spent.
   - For a **local CLI** (none of `ollama`, `copilot`, or `@<login>` — the fixed CLIs and `cmd[<invocation>]` alike) or `ollama` entry, "another round" means re-running that entry's loop (local-agent, or Ollama with `{OLLAMA_MODEL}` against the locally checked-out PR branch) — not a Copilot request. Each loop manages its cap (`{MAX_ITERATIONS}`, built-in `3` unless `~max=<n>` moved it) *within* one dispatch, so typically one pass suffices; loop again only if the last round made substantive fixes **and** the entry has budget left.
   - **A per-entry `~max=<n>` is a total budget, not a per-dispatch one — for every reviewer type, including `copilot` and `@<login>`.** An inner loop enforces the cap only within its own dispatch, so handing the same entry a fresh `n` every outer round would let `--review-with ollama~max=1` run unbounded. Track each entry's **rounds spent so far** across this outer loop (sum the iterations its inner loop reported on every dispatch); for an entry whose cap was explicitly configured (`{MAX_EXPLICIT}=true`, `n ≥ 1`), stop re-dispatching once the total reaches `n`, and forward the *remaining* budget (`n - spent`), not `n`, on any subsequent dispatch. An entry on its built-in default cap or on `~max=0` (unlimited) is stopped only by the worthiness evaluation below; so is an uncapped `copilot` entry, which has **no** built-in per-entry cap in rpr.

   **Worthiness evaluation** (applies to whichever reviewer is in play): Classify all threads/findings addressed in the last round and decide:
   - **Stop and merge** if ALL of the following are true:
     - Every finding was a trivial nitpick — style preferences, naming suggestions, "consider..." language, minor formatting, or repeats of already-dismissed feedback
     - No finding touched correctness, security, logic, data integrity, or API contracts
     - You made fewer than 3 actual code changes in the last round
   - **Request another review** if any finding was substantive — logic bugs, security issues, missing guards, contract violations, or meaningful refactors

   If stopping: print "All remaining findings are nitpicks — skipping further review loop" and proceed to step 9. If looping with Copilot: request a fresh Copilot review per "Requesting GitHub Copilot Code Review", wait on the *existing* persistent monitor (never a second one) for the `copilot review:` event, then repeat from step 3 (the monitor's CI events surface failures meanwhile — see "CI failure handling"). If looping with a local CLI or `ollama`: re-run its loop, then repeat from step 3.

   **Repeated-comment dedup**: after a new Copilot round, compare each new unresolved thread's body and file/line against the previous round's intentionally-unresolved threads (replied to as non-issues or disagreements). If every new unresolved thread is a repeat of dismissed feedback, treat the review as clean and exit the loop.

9. **Report summary**: Print a table of all threads addressed with file, line, and a brief description of the fix. Include a final count line: "Resolved X/Y threads." If any threads remain unresolved, list them with reasons (unclear feedback, disagreement, requires user input).

10. **Convention encoding**: after the summary, for each recurring pattern among the issues addressed this session, apply the **smallest** code-level action that makes the convention self-evident (in-tree comment at the canonical site, a clarifying rename, or a surgical refactor that removes the footgun). CLAUDE.md / AGENTS.md additions are a **fallback** for conventions that can't be expressed locally. Encoded actions land in the same branch as the rpr fixes.

!`cat ~/.claude/lib/finding-disposition.md`

Only when `ISSUE_MODE=true` and a finding is being deferred:

!read lib/plan-issue-mode.md

!`cat ~/.claude/lib/per-finding-root-cause.md`

!`cat ~/.claude/lib/post-review-doc-recommendations.md`

!`cat ~/.claude/lib/graphql-escaping.md`

## Local-Agent Review Loop (for `--review-with codex|agy|claude|grok|pi|cursor|opencode|cmd[<invocation>]`)

When `REVIEW_AGENTS` names a local CLI, step 2 (and the step-8 re-request) runs that agent's review against the PR branch via the shared local-agent loop. Pass `{REVIEW_AGENT}`, `{REVIEWER_APPLIES}`, that entry's resolved `{REVIEW_MODEL}` (its `<agent>[<model>]` bracket, else the saved `review-models[slug]` default resolved above — project over global — else empty → the reviewer's built-in default; without this, `--review-with=codex[o3]` would silently run the CLI's default model), its `{REVIEW_EFFORT}` (from `~effort=<level>`; empty when unset — the loop's effort-carrier table maps it to each CLI's accepted form), the PR branch (`headRefName`), the base branch (`baseRefName`), and the project `{BUILD_CMD}`. The loop verifies build + tests in the main thread before pushing; afterward, continue to step 3.

Read only when `REVIEW_AGENTS` contains one of those slugs (`cmd` included):

!read lib/local-agent-review-loop.md

## Ollama Review Loop (for `--review-with ollama[<model>]`)

When `REVIEW_AGENTS` names `ollama`, step 2 (and the step-8 re-request) runs the Ollama review loop against the locally checked-out PR branch (it reviews a local `git diff`). Pass `{OLLAMA_MODEL}` (empty = auto-select), `{OLLAMA_EFFORT}` (from `~effort=<level>`; empty when unset), the PR branch (`headRefName`), the base branch (`baseRefName`), and the project `{BUILD_CMD}`. The loop is always review-only (Ollama is non-agentic): it emits findings, the orchestrator applies them, and the main thread verifies build + tests before pushing.

Read only when `REVIEW_AGENTS` contains `ollama`:

!read lib/ollama-review-loop.md

## Requesting GitHub Copilot Code Review (legacy — only when `copilot` is in `REVIEW_AGENTS`)

Runs **only** when `copilot` was asked for explicitly (typed flag or saved default). Do NOT use `@copilot review` in a PR comment — that triggers the **Copilot coding agent**, which opens a new PR instead of reviewing.

### Request via API
```bash
gh api --hostname GH_HOST repos/OWNER/REPO/pulls/PR_NUM/requested_reviewers -f 'reviewers[]=copilot-pull-request-reviewer[bot]'
```

The reviewer name MUST include the `[bot]` suffix; without it the API returns a 422 "not a collaborator" error. Verify `Copilot` appears in the response's `requested_reviewers` array.

### Poll for review completion

**Use ONE persistent `Monitor` for the entire rpr session, not a fresh background poll per loop iteration.** Start it *once* (right after the first review request, or at session entry if a review is already pending). It tracks the most-recent Copilot review timestamp it has observed and emits exactly one event per *new* review, and transition-detects CI checks in the same loop — one event per CI bucket flip, no separate CI poll.

```bash
# Replace OWNER/REPO/PR_NUM/GH_HOST with literals — no shell variables inside the GraphQL query
# string. GH_HOST is the API host from step 1 (needed because `gh api` ignores the repo remote and
# defaults to github.com); it goes in `--hostname GH_HOST`, outside the query string.
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
        | gh api --hostname GH_HOST graphql --input - 2>/dev/null \
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

When you push a fix and want another review, just *request* it (the API call above) and keep working — the existing monitor emits `copilot review: <timestamp>` when it lands. **Do not start a second monitor.** Stop it only when the rpr loop is done (`TaskStop` with the monitor's id), or let it time out.

**Poll cadence + "stuck" threshold**: the monitor's tick is a fixed 25 s (covers the typical 30–90 s review latency). The **stuck threshold** is dynamic: if a review hasn't landed after **3× the historical average latency for this PR** (minimum 90 s, maximum 5 min), surface it via a one-shot status check and treat it as stuck — that decision lives in the rpr loop body, not in the monitor's sleep.

The review is "complete" when a new `copilot review:` event fires. If no event arrives by the deadline you set: **Default mode**: auto-skip and continue. **Interactive mode (`--interactive`)**: ask the user whether to continue waiting, re-request, or skip.

**Error detection**: after a review event fires, fetch the review body and check for error text such as "Copilot encountered an error" or "unable to review this pull request". If found, log a warning, re-request the review (same API call above), and let the existing monitor catch the retry. Allow up to 3 error retries. After 3 failures: **Default mode**: auto-skip and continue. **Interactive mode (`--interactive`)**: ask the user whether to continue or skip.

## CI failure handling

The persistent monitor emits one event per CI check bucket transition — `ci: lint: pass`, `ci: test (20.x): fail`, etc. On a failure event:

1. Fetch logs for the failing check, using the monitor's `bucket` vocabulary (`pass` / `fail` / `cancel` / `skipping` / `pending`; `fail` fires the `ci: <name>: fail` event):
   ```bash
   RUN_ID="$(gh pr checks PR_NUM --json name,bucket,detailsUrl \
     --jq '.[] | select(.bucket=="fail") | .detailsUrl | capture("/runs/(?<id>[0-9]+)") | .id' \
     | head -n1)"
   gh run view "$RUN_ID" --log-failed
   ```
2. Fix the failure, run tests locally to confirm, commit, and push. The Copilot review request typically re-applies to the new commit; if not, re-request after the push.

## Notes

- Only resolve threads where you've actually addressed the feedback
- If feedback is unclear or incorrect, leave a reply comment instead of resolving
- Always run tests before committing — never push code with known failures
- **Never dismiss findings as "out of scope" or "not modified in this PR."** If a review identifies a real issue, fix it — regardless of whether the current PR touched that code.
- **Default to fixing findings in this PR; defer to PLAN.md only when a fix is genuinely large/architectural or too risky to land here.** See the "Finding Disposition" guidance loaded above for the fix-now / reply / defer decision.
