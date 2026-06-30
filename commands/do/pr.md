---
description: Commit, push, and open a PR (GitHub) or merge request (GitLab) against the repo's default branch — optionally auto-merging once reviews and CI pass (--merge)
argument-hint: "[--review-with <agent>[,<agent>...]] [--review-iterations <n>] [--review-mode <series|parallel>] [--review-stop-on-findings|--review-stop-on-clean] [--reviewer-applies] [--merge|--no-merge|--merge=<method>] [--merge-method <method>]"
---

## Parse Arguments

Parse `$ARGUMENTS` for `--review-with <agent[,agent,...]>`:
- Accepted values per slot: `copilot`, `codex`, `agy` (aliases `gemini` / `antigravity` — all run the Antigravity CLI's `agy` binary), `claude`, `ollama`, or an arbitrary GitHub login `@<login>`
- `ollama` reviews with a local Ollama model. Bare `ollama` auto-selects the most capable installed coding model; pin a specific installed model with the bracket form `ollama[<model>]`, e.g. `ollama[qwen2.5-coder:32b]`. Strip the bracket suffix into a per-entry `OLLAMA_MODEL` (empty for bare `ollama`) and keep the base slug `ollama`.
- `@<login>` requests a review from an **arbitrary GitHub reviewer** — any user or App/bot login (e.g. `@octocat`, `@org-review-bot`, `@some-app[bot]`). slashdo requests their review on the PR and waits for it, fixing what it surfaces (same request → poll → fix → resolve flow as `copilot`). Strip the leading `@` into a per-entry `REVIEWER_LOGIN`; the login must match `^[A-Za-z0-9][A-Za-z0-9-]*(\[bot\])?$` (reject otherwise with the unknown-value abort below). GitHub only (skipped on GitLab). slashdo never posts an approval itself — it only requests, waits, and fixes.
- **Reserved value `none`:** the token `none` (case-insensitive) is not a reviewer slug. `--review-with none` means *no external reviewer this run* — set `REVIEW_AGENTS=[]`, skip the slug validation below, and skip applying any saved `review-with` default. This is the explicit escape hatch over a default saved via `/do:config`.
- The value may be a single agent or a **comma-separated, ordered list** (e.g. `--review-with codex,agy,copilot`). Split on `,`, trim whitespace around each slug. Normalize `gemini`/`antigravity` → `agy`.
- Record the resulting list as `REVIEW_AGENTS`. **There is no built-in default reviewer.** If `--review-with` is omitted, leave `REVIEW_AGENTS` **unset for now** — the saved-defaults step below fills it from `/do:config` if a default exists, and **only if it is still unset after that** does the built-in default apply (`REVIEW_AGENTS=[]` — no external review pass; the Local Code Review gate below still runs unconditionally). Whatever ends up in the list is exactly what runs, in order: `--review-with codex` runs codex only; copilot is never added implicitly.
- Dedupe preserving first-occurrence order (compare on the normalized slug — for `ollama` the bracket suffix is part of the identity, so `ollama[a]` and `ollama[b]` are distinct while two bare `ollama`s collapse; for `@<login>` the login is the identity, compared lowercased, so `@Octocat`/`@octocat` collapse while distinct logins stay separate); if duplicates were dropped, print: `Note: deduped --review-with list to {final list}.`
- If any value is not in the accepted set, abort with a usage error: `Unknown --review-with value: {value}. Use one of: copilot, codex, agy, claude, ollama, @<login>.`

Parse `$ARGUMENTS` for the stop-mode flags (mutually exclusive):
- `--review-stop-on-findings` — stop the multi-reviewer loop after the first reviewer that fixed at least one finding (subsequent reviewers in the list are skipped).
- `--review-stop-on-clean` — stop after the first reviewer that reports a clean pass with zero findings.
- If neither is present, set `REVIEW_STOP_MODE=all` (default — always run every listed reviewer in order).
- If both are present, abort with: `--review-stop-on-findings and --review-stop-on-clean cannot be combined`.

Parse `$ARGUMENTS` for `--review-mode <series|parallel>` (how the multi-reviewer loop dispatches its reviewers):
- `series` (default) — reviewers run one-at-a-time in list order, each reviewing against the prior reviewer's committed fixes. This is the recommended mode.
- `parallel` — reviewers' reviews run concurrently against one frozen baseline, then the orchestrator applies the deduped union of findings once. Faster, but no reviewer sees another's fixes; `--reviewer-applies` and the stop-modes are ignored in this mode (the loop warns).
- If `--review-mode` is omitted, leave `REVIEW_MODE` **unset for now** — the saved-defaults step below fills it from the `review-mode` default; the built-in default is `series`.
- If the value is anything other than `series` or `parallel`, abort with: `--review-mode must be one of series, parallel (got: {value}).`

Parse `$ARGUMENTS` for `--reviewer-applies` (boolean, no value):
- Record as `REVIEWER_APPLIES=true` if present, otherwise `REVIEWER_APPLIES=false` (default).
- This flag picks who applies fixes the reviewer surfaces: by default the orchestrating thread (this session) reads the reviewer's findings and applies fixes itself; with `--reviewer-applies` the reviewing CLI applies fixes in the working tree directly. See `lib/local-agent-review-loop.md` "Editing mode" for the rationale and trade-offs.
- The flag is **not supported on the GitHub-side review paths** (`copilot` and `@<login>`) because those reviews are read-only by design (cloud-side comments, no working-tree access). If `REVIEW_AGENTS` contains `copilot` or an `@<login>` entry and `REVIEWER_APPLIES=true`, print a warning (`--reviewer-applies has no effect on the copilot/@<login> passes; fixes there are always applied by the orchestrator's sub-agent`) and continue — the flag still takes effect on the local passes in the list.
- The flag is **also a no-op on the ollama path** because Ollama is non-agentic (`ollama run` returns text and cannot edit files), so the orchestrator always applies the fixes. If `REVIEW_AGENTS` contains an `ollama` entry and `REVIEWER_APPLIES=true`, print a warning (`--reviewer-applies has no effect on the ollama pass; Ollama is non-agentic, so the orchestrator always applies the fixes`) and continue — the flag still takes effect on the codex/agy/claude passes in the list.

Parse `$ARGUMENTS` for `--review-iterations <n>` (affects the GitHub-side passes — `copilot` and `@<login>` — only):
- Record as `REVIEW_ITERATIONS`. If `--review-iterations` is omitted, default to `1` — a single review-and-fix pass per GitHub-side reviewer (request one review, fix everything it surfaces, stop).
- Must be a non-negative integer. Any positive `n` runs at most `n` review-and-fix cycles per GitHub-side reviewer, still exiting early if a review returns 0 comments. `0` means "loop until that reviewer returns 0 comments" (the legacy behavior, bounded by each loop's own 10-iteration safety guardrail).
- If the value is missing or not a non-negative integer, abort with: `--review-iterations must be a non-negative integer (got: {value}).`
- This flag has no effect on local-agent reviewers (`codex`/`gemini`/`claude`) or `ollama`; they keep their own fixed iteration caps.

Parse `$ARGUMENTS` for the merge flags (control whether the PR is auto-merged after review — opt-in; the historical default is to open the PR and stop):
- `--merge` — once the review loop returns a mergeable status **and** CI is green, auto-merge the PR. Record `MERGE_ENABLED=true`.
- `--merge=<method>` — same as `--merge`, and pin the method: `<method>` ∈ {`squash`, `rebase`, `merge`}. Record `MERGE_ENABLED=true` and `MERGE_METHOD=<method>`. Abort on an unknown method with `--merge=<method> must be one of squash, rebase, merge (got: {value}).`
- `--no-merge` — leave the PR open for manual merge. Record `MERGE_ENABLED=false`. `--merge` and `--no-merge` are mutually exclusive; if both appear, abort with `--merge and --no-merge cannot be combined`.
- `--merge-method <method>` — pin the method without restating `--merge` (useful when `--merge` comes from a saved default). `<method>` ∈ {`squash`, `rebase`, `merge`}; abort on anything else with `--merge-method must be one of squash, rebase, merge (got: {value}).` Record `MERGE_METHOD`. If both `--merge=<method>` and `--merge-method <method>` are given with **different** methods, abort with `--merge=<method> and --merge-method specify conflicting methods ({first} vs {second})`; identical methods are accepted.
- If neither `--merge` nor `--no-merge` is present, leave `MERGE_ENABLED` **unset for now** — the saved-defaults step below fills it from `/do:config` (`merge` key); only if it is still unset after that does the built-in default apply (`MERGE_ENABLED=false` — open the PR and stop). Likewise leave `MERGE_METHOD` unset so it is filled from the saved `merge-method` default, then the repo-default fallback at merge time.

Then apply any **saved defaults** (set via `/do:config`) to the flags above that the user did NOT pass on this invocation — an explicit flag, or `--review-with none`, always overrides a saved default. `/do:pr` additionally reads the `merge` and `merge-method` keys here (resolve `MERGE_ENABLED` from `merge` and `MERGE_METHOD` from `merge-method` when the user didn't type them). Note that supplying a method via the `--merge=<method>` shorthand counts as typing `merge-method` for this step — if `MERGE_METHOD` is already set from `--merge=<method>`, leave it as-is and skip the saved `merge-method` default (don't inject it, which would override the explicit choice or trip the `--merge=<method>` vs `--merge-method` conflict abort):

!`cat ~/.claude/lib/review-config-defaults.md`

## Detect VCS Host

Determine whether this repo lives on GitHub or GitLab so the right CLI is used for every host-specific step below. The **`origin` remote URL is the authoritative signal** of which host the repo is on — `auth status` only tells you which CLI is usable, not where the repo lives (a developer may have `gh` authenticated globally while working in a GitLab repo). So detect from the remote first, then confirm the matching CLI is authenticated:

1. Read the remote host: `git remote get-url origin`. If the host is a GitLab instance (e.g. `gitlab.com`, or a self-hosted GitLab), set `VCS_HOST=gitlab` and `CLI_TOOL=glab`; otherwise (GitHub or ambiguous) set `VCS_HOST=github` and `CLI_TOOL=gh`.
2. Confirm the matching CLI is authenticated: `gh auth status --active` for GitHub, `glab auth status` for GitLab. (`--active` scopes the check to the active account — a bare `gh auth status` exits non-zero if any *other* configured account has a stale token, falsely reporting you as unauthenticated.) If it is not, abort with: "`/do:pr` detected a {VCS_HOST} repo but `{CLI_TOOL}` is not authenticated. Run `{CLI_TOOL} auth login`."
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
- **Sync the branch onto the latest `origin/{default_branch}` first.** Reviewers below diff the branch against the **local** `{default_branch}` ref (`git diff {default_branch}...HEAD`), anchored on the merge-base. If `origin/{default_branch}` moved forward since this branch was cut and the branch was never rebased, reviewers evaluate against a stale base and flag unrelated changes that landed on the default branch outside this branch's work. Rebase to eliminate that noise:
  - `git fetch origin {default_branch}:{default_branch}` to fast-forward the **local** `{default_branch}` ref (and its remote-tracking ref) to match origin. A plain `git fetch origin {default_branch}` only moves the remote-tracking ref — the reviewers diff against the *local* ref, so it must be the one advanced, or the merge-base stays stale and the noise remains. This works because the flow already moved you to a feature branch (Detect Branches step 3), so the default branch isn't checked out. If your local `{default_branch}` has diverged from origin and the fetch can't fast-forward it (unusual), surface that and stop rather than forcing it.
  - `git rebase {default_branch}` to replay this branch's commits on top of the now-current default branch.
  - If the rebase hits conflicts, **abort** (`git rebase --abort`) and stop — print the conflicting files and ask the user to resolve them, rather than guessing at a merge. Do not proceed to review against a half-rebased tree.
  - After a clean rebase the branch's merge-base with the refreshed local `{default_branch}` is current, so `git diff {default_branch}...HEAD` shows only this branch's own changes.
- Push the branch to remote: `git push -u origin {current_branch}` (use `--force-with-lease` if the rebase above rewrote already-pushed history; never a bare `--force`)

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
7. Only after printing the review summary may you proceed to "Pre-PR Local Reviews"

If the diff touches more than 15 files, delegate later batches to a subagent to keep context clean.

</review_gate>

Checklist to apply to each file:

!`cat ~/.claude/lib/code-review-checklist.md`

Verification — confirm before proceeding:
- [ ] Read every changed file in full (not just diffs)
- [ ] Checked each file against the relevant checklist tiers
- [ ] Quoted specific code for each finding
- [ ] Printed a review summary table with findings

## Pre-PR Local Reviews

Partition `REVIEW_AGENTS` into two ordered sublists, preserving their original relative order:

- `LOCAL_AGENTS` — every entry that is neither `copilot` nor an `@<login>` GitHub reviewer: `codex`, `agy`, `claude`, `ollama[…]`. These review the working tree locally and do not need a PR to exist.
- `PR_SIDE_AGENTS` — the GitHub-side reviewers that review the PR cloud-side and therefore need it to exist: `copilot` plus every `@<login>` entry (preserve their relative order)

**If `LOCAL_AGENTS` is non-empty**, run the multi-reviewer loop now, **before the PR is created**, using only `LOCAL_AGENTS`. Local reviewers work against the working tree / pushed branch and do not require a PR to exist — running them first means every local reviewer's fixes land before the PR is opened, instead of trickling in as new commits after reviewers report back. Pass the same flags: `{REVIEW_STOP_MODE}`, `{REVIEW_MODE}`, `{REVIEWER_APPLIES}`, `{REVIEW_ITERATIONS}` (no effect on local agents, but forward for consistency). Record the result as `LOCAL_OVERALL_STATUS`.

- If `LOCAL_OVERALL_STATUS` is `dirty` (broken build / test failure / rejected), **abort before creating the PR** — print the proximate failure and stop. The branch is not in a state worth opening a PR against.
- Any other status (`clean`, `partial`, `inconclusive`) allows proceeding — a non-clean local pass is a signal to the user, not a hard block on PR creation (the user may still want a Copilot review).

**If `LOCAL_AGENTS` is empty**, skip this section.

This phase drives the **multi-reviewer wrapper** (defined under "Reviewer loop bodies" below) over `LOCAL_AGENTS`. The local-agent reviewer types it dispatches:

- `codex` | `agy` | `claude` → local-agent headless review loop (`lib/local-agent-review-loop.md`) — host-agnostic; the local CLI reviews the working tree directly and does not care whether the remote is GitHub or GitLab. The local CLI runs a self-contained single-agent review prompt against the branch (codex uses its built-in `codex review`) — deliberately **not** the `/do:review` multi-sub-agent skill, which hangs under a headless/print-mode invocation; this main thread then verifies its output, runs build + tests, and pushes the verified fixes
- `ollama` → Ollama local-model review loop (`lib/ollama-review-loop.md`) — host-agnostic and fully offline. The orchestrator resolves the model (auto-select or the `ollama[<model>]` override), feeds the per-file diff to `ollama run`, parses the findings, applies the fixes itself (Ollama is non-agentic — always review-only), then verifies build + tests and pushes

## Open the PR

- Create a PR / merge request from `{current_branch}` to `{default_branch}`:
  - GitHub: `gh pr create --base {default_branch} --head {current_branch} --title "..." --body "..."`
  - GitLab: `glab mr create --source-branch {current_branch} --target-branch {default_branch} --title "..." --description "..."` (add `--yes` to skip the interactive prompt; `--remove-source-branch` if the project deletes merged branches)
- Create a rich PR/MR description
- Capture the resulting PR/MR URL to report at the end

## Run the PR-side Reviews

**If `PR_SIDE_AGENTS` is empty** (no `copilot` and no `@<login>` in `--review-with`), skip this entire section. Set `PR_SIDE_OVERALL_STATUS=clean` (skipped — no PR-side pass requested) and continue to "Compute OVERALL_STATUS".

Otherwise, hand off to the **multi-reviewer loop** using only `PR_SIDE_AGENTS` with the parsed inputs:

- `{PR_SIDE_AGENTS}` — `copilot` and/or `@<login>` entries, in order
- `{REVIEW_STOP_MODE}`, `{REVIEW_MODE}`, `{REVIEWER_APPLIES}`, `{REVIEW_ITERATIONS}`

These reviewers need the PR to exist (they review cloud-side), which is why they run here, after "Open the PR", rather than in the pre-PR phase. This phase drives the same **multi-reviewer wrapper** (under "Reviewer loop bodies" below), this time over `PR_SIDE_AGENTS`. Note that `--review-stop-on-findings` / `--review-stop-on-clean` apply *within* each phase's wrapper invocation; a stop-mode short-circuit during the local phase does not skip the PR-side pass, since the two phases run as separate wrapper invocations:

- `copilot` → Copilot cloud review loop (`lib/copilot-review-loop.md`)
- `@<login>` → GitHub-reviewer loop (`lib/github-reviewer-loop.md`), forwarding `{REVIEWER_LOGIN}`

**GitHub only** — both PR-side reviewer types drive `gh`/GraphQL against a GitHub PR and have no GitLab equivalent. When `VCS_HOST=gitlab` and `PR_SIDE_AGENTS` is non-empty, print a warning (`copilot and @<login> reviewers are GitHub-only and were skipped on this GitLab MR; use a local-agent reviewer (codex/agy/claude) instead`) and set `PR_SIDE_OVERALL_STATUS=inconclusive`.

Record the result as `PR_SIDE_OVERALL_STATUS`.

## Compute OVERALL_STATUS

**If `REVIEW_AGENTS` was empty** (no `--review-with` was passed at all), skip the two review phases above and set `OVERALL_STATUS=clean` — the Local Code Review gate plus CI is the merge gate, exactly as `/do:release` treats it; there is no multi-reviewer aggregate to report.

Otherwise combine `LOCAL_OVERALL_STATUS` (from "Pre-PR Local Reviews", or `clean` when `LOCAL_AGENTS` was empty) and `PR_SIDE_OVERALL_STATUS` (from "Run the PR-side Reviews", or `clean` when `PR_SIDE_AGENTS` was empty) into a single `OVERALL_STATUS` using this precedence — first matching rule wins:

1. `dirty` — either phase is `dirty`
2. `inconclusive` — either phase is `inconclusive`
3. `partial` — either phase is `partial`
4. `clean` — both phases are `clean`

## Merge the PR (only when merge mode is enabled)

**If `MERGE_ENABLED` is not `true`, skip this section** — report the PR/MR URL plus the review summary and stop. This is the historical `/do:pr` behavior: open the PR and hand it back for manual merge.

When `MERGE_ENABLED=true`, gate the merge on **both** the review result and CI:

1. **Review gate** — consume the review loop's `{OVERALL_STATUS}` exactly as `/do:release` does:
   - `clean` — eligible (this includes the no-reviewer path above, which set `OVERALL_STATUS=clean` on a passing Local Code Review gate, and copilot `too-large`/`capped`).
   - `partial` — eligible only when an explicit `--review-stop-on-findings`/`--review-stop-on-clean` flag was set (the user opted into the short-circuit).
   - `inconclusive` or `dirty` — **do NOT merge.** Leave the PR open and report the proximate status + URL so the user can intervene. A requested reviewer that never produced a verdict is not a clean review.
2. **Resolve the merge method** into `{MERGE_METHOD}`: the explicit flag or saved `merge-method` default if set; otherwise query `gh repo view --json mergeCommitAllowed,squashMergeAllowed,rebaseMergeAllowed` and pick from the repo's allowed methods — if exactly one is allowed use it; if several are, prefer `squash`, then `merge`, then `rebase`. State the chosen method. (GitLab: omit the method flag and let `glab` use the project default.)
3. **Merge once CI is green** — GitHub (`gh`):
   - First try GitHub-native auto-merge, so the merge lands when required checks pass even if this session ends: `gh pr merge {number} --auto --{MERGE_METHOD} --delete-branch`.
   - If that errors because auto-merge is not enabled on the repo (e.g. `gh` reports auto-merge is not allowed / not enabled), **fall back to watching checks in-session, then merging directly**: `gh pr checks {number} --required --watch --fail-fast` — scope the watch to **required** checks only so an optional/non-required job's failure or slowness can't block a merge that branch protection would allow; on success run `gh pr merge {number} --{MERGE_METHOD} --delete-branch`. If a required check **fails**, apply the **CI flake handling** routine (one conservative re-run on the same commit — see `~/.claude/lib/ci-flake-handling.md`): if the same SHA passes on the single re-run, treat it as a flake and proceed with the merge (logging which check flaked); if it fails again, leave the PR open and report which check failed — do not merge. (If `gh` reports no required checks exist on the branch, the required-CI gate is vacuously satisfied — merge directly.)
   - GitLab (`glab`): `glab mr merge {number} --auto-merge --yes --remove-source-branch` (merges when the pipeline succeeds). If the installed `glab` doesn't support `--auto-merge`, fall back to polling `glab ci status` until the pipeline passes, then `glab mr merge {number} --yes`.
4. **Verify** the result: `gh pr view {number} --json state,mergedAt` (GitLab: `glab mr view {number}`). Distinguish *merged now* from *queued to auto-merge on green CI*.
5. After a **completed** merge, switch back and sync the default branch locally: `git checkout {default_branch} && git pull --rebase --autostash`. When the merge is merely **queued** (native auto-merge, checks still running), skip the local sync — the merge hasn't happened yet — and say so.

Never merge on `dirty`/`inconclusive`, never merge before required checks pass, and never override branch protection — `--auto` respects it, and the in-session fallback waits on `gh pr checks`.

**Report the final status** to the user including the PR/MR URL, the multi-reviewer aggregate report (per-pass status table plus overall status), and — when merge mode was enabled — whether the PR merged, is queued to auto-merge on green CI, or was left open (with why).

## Reviewer loop bodies

Both review phases above ("Pre-PR Local Reviews" and "Run the PR-side Reviews") drive the same multi-reviewer wrapper — the only difference is the agent list each passes in (`LOCAL_AGENTS` vs `PR_SIDE_AGENTS`). The wrapper and the single-reviewer loop bodies it dispatches to are defined once here:

### Multi-reviewer wrapper

!`cat ~/.claude/lib/multi-reviewer-loop.md`

### Inner loop bodies (referenced by the wrapper)

!`cat ~/.claude/lib/copilot-review-loop.md`

!`cat ~/.claude/lib/github-reviewer-loop.md`

!`cat ~/.claude/lib/local-agent-review-loop.md`

!`cat ~/.claude/lib/ollama-review-loop.md`

### CI flake handling (referenced by the merge gate)

!`cat ~/.claude/lib/ci-flake-handling.md`
