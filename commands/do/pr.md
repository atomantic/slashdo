---
description: Commit, push, and open a PR (GitHub) or merge request (GitLab) against the repo's default branch — optionally auto-merging once reviews and CI pass (--merge)
argument-hint: "[--review-with <agent>[,<agent>...]] [--review-iterations <n>] [--review-mode <series|parallel>] [--review-stop-on-findings|--review-stop-on-clean] [--reviewer-applies] [--merge|--no-merge|--merge=<method>] [--merge-method <method>]"
---

## Parse Arguments

!`cat ~/.claude/lib/review-flags.md`

Parse `$ARGUMENTS` for the merge flags (auto-merge is opt-in; the historical default opens the PR and stops):
- `--merge` — once the review loop returns a mergeable status **and** CI is green, auto-merge the PR. Record `MERGE_ENABLED=true`.
- `--merge=<method>` — same as `--merge`, pinning `<method>` ∈ {`squash`, `rebase`, `merge`}. Record `MERGE_ENABLED=true` and `MERGE_METHOD=<method>`. Abort on an unknown method with `--merge=<method> must be one of squash, rebase, merge (got: {value}).`
- `--no-merge` — leave the PR open for manual merge. Record `MERGE_ENABLED=false`. If both `--merge` and `--no-merge` appear, abort with `--merge and --no-merge cannot be combined`.
- `--merge-method <method>` — pin the method without restating `--merge` (useful when `--merge` comes from a saved default). `<method>` ∈ {`squash`, `rebase`, `merge`}; otherwise abort with `--merge-method must be one of squash, rebase, merge (got: {value}).` Record `MERGE_METHOD`. If `--merge=<method>` and `--merge-method <method>` name **different** methods, abort with `--merge=<method> and --merge-method specify conflicting methods ({first} vs {second})`; identical methods are accepted.
- If neither `--merge` nor `--no-merge` is present, leave `MERGE_ENABLED` unset for now — the saved-defaults step fills it from the `merge` key; only if still unset after that does `MERGE_ENABLED=false` apply. Likewise leave `MERGE_METHOD` unset for the saved `merge-method` default, then the repo-default fallback at merge time.

Then apply any **saved defaults** (set via `/do:config`) to the flags the user did NOT pass — an explicit flag, or `--review-with none`, always overrides a saved default. `/do:pr` additionally reads the `merge` and `merge-method` keys here. A method supplied via `--merge=<method>` counts as typing `merge-method`: if `MERGE_METHOD` is already set from it, skip the saved `merge-method` default (injecting it would override the explicit choice or trip the conflict abort above):

!`cat ~/.claude/lib/review-config-defaults.md`

!`cat ~/.claude/lib/config-defaults-issues-merge.md`

## Detect VCS Host

Determine whether this repo lives on GitHub or GitLab so the right CLI is used for every host-specific step below. Use the shared preflight: the **`origin` remote is authoritative**, ambient credentials never select the forge, unsupported remotes stop, and the selected CLI must be able to read this checkout.

!read lib/vcs-host.md

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

- Commit all changes to the current branch, following these conventions:

!`cat ~/.claude/lib/commit-conventions.md`

- **Sync the branch onto the latest `origin/{default_branch}` first.** Reviewers diff the branch against `{REVIEW_BASE}` (`git diff {REVIEW_BASE}...HEAD`) anchored on the merge-base; an un-rebased branch makes them flag unrelated changes that landed on the default branch since it was cut:
  - `git fetch origin {default_branch}:{default_branch}` to fast-forward the **local** `{default_branch}` ref (a plain `git fetch origin {default_branch}` only moves the remote-tracking ref, which the reviewers don't diff against). **In a linked worktree it can still fail** — `fatal: refusing to fetch into branch 'refs/heads/{default_branch}' checked out at …` means the *parent* repo holds it, the normal state when `/do:next` or a claim flow invoked `/do:pr`. That is not a divergence: fall back to `git fetch origin {default_branch}` and `git rebase origin/{default_branch}`, and have the reviewers diff `origin/{default_branch}...HEAD`. **Record the resolved base as `{REVIEW_BASE}`** — `{default_branch}` normally, `origin/{default_branch}` on this fallback — and pass it to the review loops as their `{BASE_BRANCH}` input; that is the only name they read. If your local `{default_branch}` has diverged from origin and cannot fast-forward (unusual), surface that and stop rather than forcing it.
  - `git rebase {default_branch}` to replay this branch's commits on top.
  - If the rebase hits conflicts, **resolve them and continue the rebase**. Do not abort or stop merely because conflicts exist. Follow [lib/rebase-conflict-resolution.md](../../lib/rebase-conflict-resolution.md): inspect the replayed commit and both sides, resolve human-authored sources semantically, regenerate generated artifacts from their canonical inputs (for example `server/lib/apiRouteCatalog.generated.json`), run the focused checks, stage the resolution, and repeat `git rebase --continue` until complete. Only the playbook's last-resort, evidence-backed ambiguity may abort the rebase; a generated-file conflict alone never qualifies.
  - After a clean rebase, `git diff {REVIEW_BASE}...HEAD` shows only this branch's own changes.
- Push the branch (use `--force-with-lease` if the rebase rewrote already-pushed history; never a bare `--force`). **Which form depends on whether the branch's upstream names a remote** — `-u` *rewrites* `branch.<name>.remote`/`.merge`, so using it unconditionally would re-point an existing upstream at `origin/{current_branch}` and defeat the config-derived guard under "Open the PR". Discriminate on `branch.<name>.remote`, **not** on whether `@{u}` resolves: a branch tracking a *local* ref (`branch.<name>.remote=.`, what `git branch --set-upstream-to=main` produces) resolves `@{u}` fine, and would be pushed into the local repository:

  ```bash
  BR="$(git branch --show-current)"
  PUSH_REMOTE="$(git config --get "branch.$BR.remote")"
  ```

  - **Not yet published to a remote** — `PUSH_REMOTE` is empty (no upstream at all) **or** `.` (upstream is a local branch): `git push -u origin {current_branch}`, which publishes the branch and re-points a local upstream at the remote.
  - **A genuine remote upstream** (`PUSH_REMOTE` is a real remote name): push to the ref that upstream names, derived from config exactly as "Open the PR" does — never `-u`, and never a destination built from the local branch name (an upstream of `upstream/feature-x` or `origin/pr-123-head` must keep pointing there).

## Local Code Review (REQUIRED GATE)

<review_gate>

1. Read commit messages to understand what this change claims to do
2. Run `git diff {REVIEW_BASE}...{current_branch}` to get the list of changed files — the base resolved in "Commit and Push" (`origin/{default_branch}` on the linked-worktree fallback; the un-advanced local ref would enumerate every file that landed on the default branch outside this branch)
3. For every changed file:
   a. Read the entire file using the Read tool (not just diff hunks)
   b. Review it under the review preferences below
   c. For each finding, quote the specific code line and explain why it's a problem
4. After reviewing all files, verify: does the code actually deliver what the commits claim?
5. Print a review summary table: | finding | file | line | severity | fixable |
6. Fix any issues, run tests, verify tests cover the changed code paths, then **commit and push those fixes** — using the upstream-derived push described under "Open the PR" below, never a bare `git push` and never a destination built from the local branch name. Leaving the fixes uncommitted is invisible to that section's assertion, which compares against the upstream ref and so only ever sees *committed* work
7. Only after printing the review summary may you proceed to "Pre-PR Local Reviews"

If the diff touches more than 15 files, delegate later batches to a subagent to keep context clean.

</review_gate>

Review preferences to apply to each file:

!`cat ~/.claude/lib/review-preferences.md`

Verification — confirm before proceeding:
- [ ] Read every changed file in full (not just diffs)
- [ ] Every finding names a concrete wrong outcome, not a style preference
- [ ] Quoted specific code for each finding
- [ ] Printed a review summary table with findings

## Pre-PR Local Reviews

Partition `REVIEW_AGENTS` into two ordered sublists, preserving relative order:

- `LOCAL_AGENTS` — every entry that is neither `copilot` nor an `@<login>`: `codex`, `agy`, `claude`, `grok`, `pi`, `cursor`, `opencode`, `ollama[…]`, `cmd[<invocation>]`. These review the working tree locally and need no PR.
- `PR_SIDE_AGENTS` — `copilot` plus every `@<login>` entry; these review the PR cloud-side and need it to exist.

**If `LOCAL_AGENTS` is non-empty**, run the multi-reviewer loop now, **before the PR is created**, over `LOCAL_AGENTS` only, so every local reviewer's fixes land before the PR opens. Pass `{REVIEW_STOP_MODE}`, `{REVIEW_MODE}`, `{REVIEWER_APPLIES}`, `{REVIEW_ITERATIONS}` (no effect on local agents, but forward for consistency), and `{REVIEW_MODELS}` (the saved per-agent default models — every local reviewer but `cmd` reads it). Record the result as `LOCAL_OVERALL_STATUS`.

- If `LOCAL_OVERALL_STATUS` is `dirty` (broken build / test failure / rejected), **abort before creating the PR** — print the proximate failure and stop.
- Any other status (`clean`, `partial`, `inconclusive`) allows proceeding — a non-clean local pass is a signal to the user, not a hard block on PR creation.

**If `LOCAL_AGENTS` is empty**, skip this section.

This phase drives the **multi-reviewer wrapper** (under "Reviewer loop bodies" below) over `LOCAL_AGENTS`, dispatching:

- `codex` | `agy` | `claude` | `grok` | `pi` | `cursor` | `opencode` | `cmd` → local-agent headless review loop (`lib/local-agent-review-loop.md`) — host-agnostic. The local CLI runs a self-contained single-agent review prompt against the branch (codex uses its built-in `codex review`) — deliberately **not** the `/do:review` multi-sub-agent skill, which hangs under a headless/print-mode invocation; this main thread then verifies its output, runs build + tests, and pushes the verified fixes
- `ollama` → Ollama local-model review loop (`lib/ollama-review-loop.md`) — host-agnostic and fully offline. The orchestrator resolves the model, feeds the per-file diff to `ollama run`, parses the findings, applies the fixes itself (Ollama is non-agentic), then verifies build + tests and pushes

## Open the PR

- **First, assert the branch's commits reached the remote.** The Local Code Review gate and every pre-PR local reviewer commit their fixes onto this branch; if a push step didn't run, `gh pr create` opens a PR missing those fixes. Confirm `git log --oneline @{u}..HEAD` is empty; if it isn't, push first — deriving the destination from the branch's upstream config exactly as `lib/multi-reviewer-loop.md` step 5 does, as **one block** (shell variables do not persist across Bash calls):

  ```bash
  BR="$(git branch --show-current)"
  PUSH_REMOTE="$(git config --get "branch.$BR.remote")"
  PUSH_BRANCH="$(git config --get "branch.$BR.merge")"   # already a full refs/heads/<name>
  if [ -z "$PUSH_REMOTE" ] || [ "$PUSH_REMOTE" = "." ]; then
    # Upstream is a LOCAL branch (branch.<n>.remote=".", what `git branch
    # --set-upstream-to=main` produces) or absent — there is no remote to push to.
    echo "REFUSING TO CREATE THE PR — '$BR' tracks a local ref, not a remote; publish it first (git push -u origin $BR)"
    exit 1
  fi
  git push "$PUSH_REMOTE" "HEAD:$PUSH_BRANCH"
  ```

  The `"$PUSH_REMOTE" = "."` guard is load-bearing: on a local upstream `@{u}` resolves, so the no-upstream carve-out never fires, and an unguarded push runs `git push . HEAD:refs/heads/main` — which silently fast-forwards the *local* default branch, exits 0, leaves `@{u}..HEAD` empty, and opens a PR for a branch never pushed to any remote.

  Never a bare `git push` (under `push.default=matching` it fans out to every same-named local branch), and never `git push origin {current_branch}` (it hardcodes the *local* branch name as the destination: on a differently-named or non-origin upstream it pushes a spurious branch, leaves the real PR head stale, and `@{u}..HEAD` stays non-empty while the push "succeeded"). On a non-fast-forward, retry once behind `git pull --rebase --autostash`. If that rebase conflicts, **resolve it through [lib/rebase-conflict-resolution.md](../../lib/rebase-conflict-resolution.md), continue until the rebase completes, rerun the focused checks affected by the resolution, then retry the same upstream-derived push**. Do not classify an active rebase conflict as a push failure and do not stop merely to ask the user to resolve it — `/do:pr` is invoked programmatically by `/do:next` and `/do:pr-better`, so leave the expected branch checked out and fully rebased. **If the push still fails after that one retry, do NOT create the PR** — print the unpushed SHAs and the push error and stop. Skip the check only when the branch has no upstream (`git rev-parse --abbrev-ref --symbolic-full-name @{u} >/dev/null 2>&1` fails — detached HEAD or no origin); a *local* upstream resolves, so the check runs and the `"."` guard stops it. `git status` is not a substitute — a clean tree says nothing about committed-but-unpushed commits.
- Create a PR / merge request from `{current_branch}` to `{default_branch}`:
  - GitHub: `gh pr create --base {default_branch} --head {current_branch} --title "..." --body "..."`
  - GitLab: `glab mr create --source-branch {current_branch} --target-branch {default_branch} --title "..." --description "..."` (add `--yes` to skip the interactive prompt; `--remove-source-branch` if the project deletes merged branches)
- Create a rich PR/MR description
- Capture the resulting PR/MR URL to report at the end

## Run the PR-side Reviews

**If `PR_SIDE_AGENTS` is empty**, skip this entire section: set `PR_SIDE_OVERALL_STATUS=clean` (skipped — no PR-side pass requested) and continue to "Compute OVERALL_STATUS".

Execution order is always local phase, then PR-side phase, however the user interleaved them. A stop-mode short-circuit may honor the user's whole ordered list across that boundary, but ONLY when it can't skip a reviewer the user listed earlier:

- **Preconditions for any cross-phase skip — both must hold**:
  1. `LOCAL_AGENTS` must be **non-empty and have actually run**. With an empty `LOCAL_AGENTS`, precondition 2 is vacuously true and `LOCAL_OVERALL_STATUS` defaults to `clean` with zero commits only because no local phase ran; treating that as a satisfied stop-mode would skip the *only* requested reviewer in a PR-side-only list (e.g. `--review-with @org-review-bot --review-stop-on-clean --merge`). `LOCAL_AGENTS` empty ⇒ no cross-phase skip, regardless of `{REVIEW_STOP_MODE}`.
  2. Every `PR_SIDE_AGENTS` entry must appear *after* every `LOCAL_AGENTS` entry in the original `--review-with` order (e.g. `codex,copilot` or `codex,agy,@octocat`, not `@octocat,codex` or `copilot,agy`).
  If either fails, run `PR_SIDE_AGENTS` in full.
- When both hold, check whether the local phase already satisfied `{REVIEW_STOP_MODE}`. Track `LOCAL_PHASE_START_SHA` (the commit before the local phase ran): `LOCAL_OVERALL_STATUS=clean` alone is ambiguous — it covers both "found nothing" and "found something, fixed it, re-review confirmed clean" — and the per-pass stop-mode table treats those oppositely:
  - `REVIEW_STOP_MODE=on-clean`: skip `PR_SIDE_AGENTS` only if `LOCAL_OVERALL_STATUS` is `partial` (the local wrapper's own stop-mode already fired on a zero-change clean pass), **or** `LOCAL_OVERALL_STATUS` is `clean` AND **zero commits** were added between `LOCAL_PHASE_START_SHA` and HEAD. If `clean` but commits WERE added, do **not** skip — per the per-pass on-clean rule ("clean AND made zero changes" is required to stop) the next reviewer in the ordered list — a `PR_SIDE_AGENTS` entry — must still run. When the skip applies, set `PR_SIDE_OVERALL_STATUS=clean` (skipped — already satisfied by the local phase) and continue to "Compute OVERALL_STATUS".
  - `REVIEW_STOP_MODE=on-findings`: skip `PR_SIDE_AGENTS` the same way if `LOCAL_OVERALL_STATUS` is `partial`, OR at least one commit was added between `LOCAL_PHASE_START_SHA` and HEAD.
- `REVIEW_STOP_MODE=all` (default): no cross-phase skip — always run `PR_SIDE_AGENTS` when non-empty.

**On GitHub, when `PR_SIDE_AGENTS` is non-empty**, read the shared host helper before dispatching any PR-side reviewer. The VCS preflight has already seeded `{GH_HOST}` from the checkout; the helper preserves that value, applies its fallbacks when needed, and confirms authentication.

!read lib/gh-host.md

When no cross-phase skip applies, hand off to the **multi-reviewer wrapper** (under "Reviewer loop bodies" below) over `PR_SIDE_AGENTS` with:

- `{PR_SIDE_AGENTS}` — `copilot` and/or `@<login>` entries, in order
- `{REVIEW_STOP_MODE}`, `{REVIEW_MODE}`, `{REVIEWER_APPLIES}`, `{REVIEW_ITERATIONS}` (the copilot / `@<login>` cycle cap)
- `{GH_HOST}` — from "Detect VCS Host", so the loops target the right GitHub host
- `{WAIT_SCHEDULE}` — the single schedule selected below for the current GitHub-side entry

For each GitHub-side entry, resolve the caller-owned `{WAIT_SCHEDULE}` before dispatch:

- `copilot` — use the previous Copilot review duration on this PR (default 60 seconds if none); max wait 3x that duration, minimum 90 seconds, maximum 5 minutes; poll every 5s, 5s, 10s, 10s, then 15s.
- `@<login>` — expected duration 5 minutes; max wait 3x that duration, minimum 3 minutes, maximum 15 minutes; poll every 10s, 10s, 20s, 20s, then 30s.

Forward only the selected schedule as `{WAIT_SCHEDULE}`; never give one pass both schedules.

The stop-mode flags still apply **within** this wrapper invocation (e.g. stopping after the first of several `@<login>` entries that comes back clean); the cross-phase check only handles the boundary. Reviewer types:

- `copilot` → shared GitHub-reviewer template plus the Copilot delta (`lib/github-reviewer-loop.md`, `lib/copilot-review-loop.md`)
- `@<login>` → shared GitHub-reviewer template (`lib/github-reviewer-loop.md`), forwarding `{REVIEWER_LOGIN}`

**GitHub only** — both drive `gh`/GraphQL against a GitHub PR. When `VCS_HOST=gitlab` and `PR_SIDE_AGENTS` is non-empty, print a warning (`copilot and @<login> reviewers are GitHub-only and were skipped on this GitLab MR; use a local-agent reviewer (codex/agy/claude/grok/pi/cursor/opencode, or cmd[<invocation>] for anything else) instead`) and set `PR_SIDE_OVERALL_STATUS=inconclusive`.

Record the result as `PR_SIDE_OVERALL_STATUS`.

## Compute OVERALL_STATUS

**If `REVIEW_AGENTS` was empty** (`REVIEW_AGENTS` resolved empty: no flag and no saved default, or `--review-with none`), skip the two review phases above and set `OVERALL_STATUS=clean` — the Local Code Review gate plus CI is the merge gate, exactly as `/do:release` treats it; there is no multi-reviewer aggregate to report.

Otherwise combine `LOCAL_OVERALL_STATUS` (from "Pre-PR Local Reviews", or `clean` when `LOCAL_AGENTS` was empty) and `PR_SIDE_OVERALL_STATUS` (from "Run the PR-side Reviews", or `clean` when `PR_SIDE_AGENTS` was empty) into a single `OVERALL_STATUS` using this precedence — first matching rule wins:

1. `dirty` — either phase is `dirty`
2. `inconclusive` — either phase is `inconclusive`
3. `partial` — either phase is `partial`
4. `clean` — both phases are `clean`

## Merge the PR (only when merge mode is enabled)

**If `MERGE_ENABLED` is not `true`, skip this section** — report the PR/MR URL plus the review summary and stop (the historical `/do:pr` behavior).

When `MERGE_ENABLED=true`, gate the merge on **all three** of the review result, the unpushed-commits check, and CI:

1. **Review gate** — consume the review loop's `{OVERALL_STATUS}` exactly as `/do:release` does:
   - `clean` — eligible (includes the no-reviewer path above, copilot `too-large`, and `capped` from any of the four loops — an explicitly configured cap, `~max=<n>` or `--review-iterations`, reached after applying every fix; a *built-in* cap is `guardrail`, which is inconclusive).
   - `partial` — eligible only when an explicit `--review-stop-on-findings`/`--review-stop-on-clean` flag was set.
   - `inconclusive` or `dirty` — **do NOT merge.** Leave the PR open and report the proximate status + URL. A requested reviewer that never produced a verdict is not a clean review.
2. **Unpushed-commits gate** — **refuse to merge while the local branch is ahead of its remote.** If PR-side reviewer or post-push fix commits never reached `origin`, the reviewed and CI-tested tree is not the tree the merge lands, and merging silently drops those fixes while every signal reads green:

   ```bash
   if git rev-parse --abbrev-ref --symbolic-full-name @{u} >/dev/null 2>&1; then
     UNPUSHED="$(git log --oneline @{u}..HEAD)"
     if [ -n "$UNPUSHED" ]; then
       echo "REFUSING TO MERGE — these commits are not on the remote:"; echo "$UNPUSHED"
       exit 1
     fi
   fi
   ```

   The snippet fails closed on purpose. If it exits non-zero, **do not merge**: report the unpushed SHAs, leave the PR open, and say the branch has local work to push. Skip the gate when the branch has no upstream. It is independent of `{OVERALL_STATUS}`.
3. **Merge through the shared merge gate.** Inputs: `{PR}` is the PR/MR number, `{GIT}` is `git`, `{MODE}` is `queue` (the merge lands once required checks pass, even after this session ends, and falls back to watching in this session when the host has auto-merge off), `{MERGE_METHOD}` comes from Parse Arguments (it may be unset), and `{LINKED_WORKTREE}` is unset, so the gate resolves it. When `LINKED_WORKTREE=1`, the gate's step 5 deletes the remote head after a confirmed merge. The gate reports whether the PR **merged**, is **queued**, or was **left open**:

!read lib/merge-gate.md

4. After a **completed** merge, sync the default branch locally with `git checkout {default_branch} && git pull --rebase --autostash`, **only when `LINKED_WORKTREE=0`.** In a linked worktree, that checkout fails for the same reason `--delete-branch` does: the parent repo already has `{default_branch}` checked out. Skip the sync, say so, and let the caller's cleanup phase sync the parent repo. When the merge is only **queued**, also skip the local sync and say so.

Never merge on `dirty`/`inconclusive`, never merge while the branch has unpushed commits, never merge before required checks pass, and never override branch protection — `--auto` respects it, and the in-session fallback waits on `gh pr checks`.

**Report the final status** to the user including the PR/MR URL, the multi-reviewer aggregate report (per-pass status table plus overall status), and — when merge mode was enabled — whether the PR merged, is queued to auto-merge on green CI, or was left open (with why).

## Reviewer loop bodies

Both review phases above ("Pre-PR Local Reviews" and "Run the PR-side Reviews") drive the same multi-reviewer wrapper — the only difference is the agent list each passes in (`LOCAL_AGENTS` vs `PR_SIDE_AGENTS`). The wrapper and the single-reviewer loop bodies it dispatches to are read on demand here — skip all of them when both agent lists are empty.

### Multi-reviewer wrapper

Read when either agent list is non-empty:

!read lib/multi-reviewer-loop.md

### Inner loop bodies (referenced by the wrapper)

Read only the bodies for reviewer kinds present in the agent list.

For every `copilot` or `@<login>` entry, read the shared GitHub-reviewer template:

!read lib/github-reviewer-loop.md

Only for `copilot` entries, also read the Copilot delta:

!read lib/copilot-review-loop.md

Only for an entry that is none of `copilot`, `ollama`, or `@<login>` (every other slug — the fixed CLIs and `cmd[<invocation>]` alike — dispatches through this one loop; a future addition needs no new gate here):

!read lib/local-agent-review-loop.md

Only for `ollama` entries:

!read lib/ollama-review-loop.md
