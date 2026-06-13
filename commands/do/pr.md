---
description: Commit, push, and open a PR (GitHub) or merge request (GitLab) against the repo's default branch
argument-hint: "[--review-with <agent>[,<agent>...]] [--review-iterations <n>] [--review-stop-on-findings|--review-stop-on-clean] [--reviewer-applies]"
---

## Parse Arguments

Parse `$ARGUMENTS` for `--review-with <agent[,agent,...]>`:
- Accepted values per slot: `copilot`, `codex`, `agy` (aliases `gemini` / `antigravity` — all run the Antigravity CLI's `agy` binary), `claude`, `ollama`
- `ollama` reviews with a local Ollama model. Bare `ollama` auto-selects the most capable installed coding model; pin a specific installed model with the bracket form `ollama[<model>]`, e.g. `ollama[qwen2.5-coder:32b]`. Strip the bracket suffix into a per-entry `OLLAMA_MODEL` (empty for bare `ollama`) and keep the base slug `ollama`.
- **Reserved value `none`:** the token `none` (case-insensitive) is not a reviewer slug. `--review-with none` means *no external reviewer this run* — set `REVIEW_AGENTS=[]`, skip the slug validation below, and skip applying any saved `review-with` default. This is the explicit escape hatch over a default saved via `/do:config`.
- The value may be a single agent or a **comma-separated, ordered list** (e.g. `--review-with codex,agy,copilot`). Split on `,`, trim whitespace around each slug. Normalize `gemini`/`antigravity` → `agy`.
- Record the resulting list as `REVIEW_AGENTS`. **There is no default reviewer.** If `--review-with` is omitted, set `REVIEW_AGENTS=[]` — no external review pass runs (the Local Code Review gate below still runs unconditionally). Whatever you list is exactly what runs, in order: `--review-with codex` runs codex only; copilot is never added implicitly.
- Dedupe preserving first-occurrence order (compare on the normalized slug — for `ollama` the bracket suffix is part of the identity, so `ollama[a]` and `ollama[b]` are distinct while two bare `ollama`s collapse); if duplicates were dropped, print: `Note: deduped --review-with list to {final list}.`
- If any value is not in the accepted set, abort with a usage error: `Unknown --review-with value: {value}. Use one of: copilot, codex, agy, claude, ollama.`

Parse `$ARGUMENTS` for the stop-mode flags (mutually exclusive):
- `--review-stop-on-findings` — stop the multi-reviewer loop after the first reviewer that fixed at least one finding (subsequent reviewers in the list are skipped).
- `--review-stop-on-clean` — stop after the first reviewer that reports a clean pass with zero findings.
- If neither is present, set `REVIEW_STOP_MODE=all` (default — always run every listed reviewer in order).
- If both are present, abort with: `--review-stop-on-findings and --review-stop-on-clean cannot be combined`.

Parse `$ARGUMENTS` for `--reviewer-applies` (boolean, no value):
- Record as `REVIEWER_APPLIES=true` if present, otherwise `REVIEWER_APPLIES=false` (default).
- This flag picks who applies fixes the reviewer surfaces: by default the orchestrating thread (this session) reads the reviewer's findings and applies fixes itself; with `--reviewer-applies` the reviewing CLI applies fixes in the working tree directly. See `lib/local-agent-review-loop.md` "Editing mode" for the rationale and trade-offs.
- The flag is **not supported on the copilot path** because Copilot reviews are read-only by design (cloud-side comments, no working-tree access). If `REVIEW_AGENTS` contains `copilot` and `REVIEWER_APPLIES=true`, print a warning (`--reviewer-applies has no effect on the copilot pass; fixes there are always applied by the orchestrator's sub-agent`) and continue — the flag still takes effect on the non-copilot passes in the list.
- The flag is **also a no-op on the ollama path** because Ollama is non-agentic (`ollama run` returns text and cannot edit files), so the orchestrator always applies the fixes. If `REVIEW_AGENTS` contains an `ollama` entry and `REVIEWER_APPLIES=true`, print a warning (`--reviewer-applies has no effect on the ollama pass; Ollama is non-agentic, so the orchestrator always applies the fixes`) and continue — the flag still takes effect on the codex/agy/claude passes in the list.

Parse `$ARGUMENTS` for `--review-iterations <n>` (affects the copilot pass only):
- Record as `REVIEW_ITERATIONS`. If `--review-iterations` is omitted, default to `1` — a single Copilot review-and-fix pass (request one review, fix everything it surfaces, stop).
- Must be a non-negative integer. Any positive `n` runs at most `n` review-and-fix cycles, still exiting early if a review returns 0 comments. `0` means "loop until Copilot returns 0 comments" (the legacy behavior, bounded by the copilot loop's 10-iteration safety guardrail).
- If the value is missing or not a non-negative integer, abort with: `--review-iterations must be a non-negative integer (got: {value}).`
- This flag has no effect on local-agent reviewers (`codex`/`gemini`/`claude`); they keep their own fixed 3-iteration cap.

Then apply any **saved defaults** (set via `/do:config`) to the flags above that the user did NOT pass on this invocation — an explicit flag, or `--review-with none`, always overrides a saved default:

!`cat ~/.claude/lib/review-config-defaults.md`

## Detect VCS Host

Determine whether this repo lives on GitHub or GitLab so the right CLI is used for every host-specific step below. The **`origin` remote URL is the authoritative signal** of which host the repo is on — `auth status` only tells you which CLI is usable, not where the repo lives (a developer may have `gh` authenticated globally while working in a GitLab repo). So detect from the remote first, then confirm the matching CLI is authenticated:

1. Read the remote host: `git remote get-url origin`. If the host is a GitLab instance (e.g. `gitlab.com`, or a self-hosted GitLab), set `VCS_HOST=gitlab` and `CLI_TOOL=glab`; otherwise (GitHub or ambiguous) set `VCS_HOST=github` and `CLI_TOOL=gh`.
2. Confirm the matching CLI is authenticated: `gh auth status` for GitHub, `glab auth status` for GitLab. If it is not, abort with: "`/do:pr` detected a {VCS_HOST} repo but `{CLI_TOOL}` is not authenticated. Run `{CLI_TOOL} auth login`."
3. If there is no `origin` remote at all, fall back to whichever CLI is authenticated (`gh` first, then `glab`); if neither is authenticated, abort with: "`/do:pr` needs an authenticated `gh` (GitHub) or `glab` (GitLab). Run `gh auth login` or `glab auth login`."

Print: `VCS host: {VCS_HOST} (via {CLI_TOOL})`.

## Detect Branches

1. **Detect the default branch**:
   - GitHub: `gh repo view --json defaultBranchRef -q '.defaultBranchRef.name'`
   - GitLab: `glab repo view -F json 2>/dev/null` and read `.default_branch` (fallback: `git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@'`)
   - This yields the repo's default branch (e.g., `main`, `master`, `develop`)
2. **Determine the current branch** — use `git branch --show-current`
3. If you're already on the default branch, commit to a new feature branch named after the work being done
4. The PR (GitHub) / merge request (GitLab) will target the **default branch** as base

Print: `PR flow: {current_branch} → {default_branch}`

## Commit and Push

- Commit all changes to the current branch
- Keep commit message concise and do not use co-author information
- Push the branch to remote: `git pull --rebase --autostash && git push -u origin {current_branch}`

## Local Code Review (REQUIRED GATE)

This review catches bugs that Copilot misses — incomplete pattern copying is the #1 source of post-merge review feedback. Skipping costs more time in review cycles than it saves.

<review_gate>

1. Read commit messages to understand what this change claims to do
2. Run `git diff {default_branch}...{current_branch}` to get the list of changed files
3. For every changed file:
   a. Read the entire file using the Read tool (not just diff hunks)
   b. Check it against the tiered checklist below (always check Tiers 1+4; check Tiers 2-3 when relevance filters match)
   c. For each finding, quote the specific code line and explain why it's a problem
4. After reviewing all files, verify: does the code actually deliver what the commits claim?
5. Print a review summary table (see do:review for format)
6. Fix any issues, run tests, and verify tests cover the changed code paths
7. Only after printing the review summary may you proceed to "Open the PR"

If the diff touches more than 15 files, delegate later batches to a subagent to keep context clean.

</review_gate>

Checklist to apply to each file:

!`cat ~/.claude/lib/code-review-checklist.md`

Verification — confirm before proceeding:
- [ ] Read every changed file in full (not just diffs)
- [ ] Checked each file against the relevant checklist tiers
- [ ] Quoted specific code for each finding
- [ ] Printed a review summary table with findings

## Open the PR

- Create a PR / merge request from `{current_branch}` to `{default_branch}`:
  - GitHub: `gh pr create --base {default_branch} --head {current_branch} --title "..." --body "..."`
  - GitLab: `glab mr create --source-branch {current_branch} --target-branch {default_branch} --title "..." --description "..."` (add `--yes` to skip the interactive prompt; `--remove-source-branch` if the project deletes merged branches)
- Create a rich PR/MR description
- Capture the resulting PR/MR URL to report at the end

## Run the Review Loop

**If `REVIEW_AGENTS` is empty** (no `--review-with` was passed), skip this entire section — the Local Code Review gate above was the only review. Report the PR/MR URL and stop; there is no multi-reviewer aggregate to report.

Otherwise, hand off to the **multi-reviewer loop** with the parsed inputs:

- `{REVIEW_AGENTS}` — ordered list of the agents passed via `--review-with` (non-empty; the empty case was handled above)
- `{REVIEW_STOP_MODE}` — `all` (default) | `on-findings` | `on-clean`
- `{REVIEWER_APPLIES}` — boolean
- `{REVIEW_ITERATIONS}` — non-negative integer (default `1`); copilot iteration cap (`0` = loop until clean)

The wrapper runs each reviewer in order, deciding when to stop per the stop-mode. Each individual pass uses the matching single-reviewer loop:

- `copilot` → Copilot cloud review loop (`lib/copilot-review-loop.md`). **GitHub only** — Copilot cloud review has no GitLab equivalent. When `VCS_HOST=gitlab` and `REVIEW_AGENTS` contains `copilot`, print a warning (`copilot review is GitHub-only and was skipped on this GitLab MR; use a local-agent reviewer (codex/agy/claude) instead`) and skip the copilot pass — continue with the remaining (host-agnostic) reviewers in the list.
- `codex` | `agy` | `claude` → local-agent headless review loop (`lib/local-agent-review-loop.md`) — host-agnostic; the local CLI reviews the working tree directly and does not care whether the remote is GitHub or GitLab. The local CLI runs its installed review command (`/do:review` under claude, `/do-review` under agy) or an equivalent self-contained review prompt against the branch; this main thread then verifies its output, runs build + tests, and pushes the verified fixes
- `ollama` → Ollama local-model review loop (`lib/ollama-review-loop.md`) — host-agnostic and fully offline. The orchestrator resolves the model (auto-select or the `ollama[<model>]` override), feeds the per-file diff to `ollama run`, parses the findings, applies the fixes itself (Ollama is non-agentic — always review-only), then verifies build + tests and pushes

### Multi-reviewer wrapper

!`cat ~/.claude/lib/multi-reviewer-loop.md`

### Inner loop bodies (referenced by the wrapper)

!`cat ~/.claude/lib/copilot-review-loop.md`

!`cat ~/.claude/lib/local-agent-review-loop.md`

!`cat ~/.claude/lib/ollama-review-loop.md`

**Report the final status** to the user including the PR/MR URL and the multi-reviewer aggregate report (per-pass status table plus overall status).
