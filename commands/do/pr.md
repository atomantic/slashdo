---
description: Commit, push, and open a PR (GitHub) or merge request (GitLab) against the repo's default branch — optionally auto-merging once reviews and CI pass (--merge)
argument-hint: "[--review-with <agent>[,<agent>...]] [--review-iterations <n>] [--review-mode <series|parallel>] [--review-stop-on-findings|--review-stop-on-clean] [--reviewer-applies] [--merge|--no-merge|--merge=<method>] [--merge-method <method>]"
---

## Parse Arguments

!`cat ~/.claude/lib/review-flags.md 2>/dev/null || cat "$(dirname "$(readlink -f .claude/commands/do/pr.md)")/../../lib/review-flags.md"`

Parse `$ARGUMENTS` for the merge flags (auto-merge is opt-in; by default the command opens the PR and stops):
- `--merge` — once the review loop returns a mergeable status **and** CI is green, auto-merge the PR. Record `MERGE_ENABLED=true`.
- `--merge=<method>` — same as `--merge`, pinning `<method>` ∈ {`squash`, `rebase`, `merge`}. Record `MERGE_ENABLED=true` and `MERGE_METHOD=<method>`. Abort on an unknown method with `--merge=<method> must be one of squash, rebase, merge (got: {value}).`
- `--no-merge` — leave the PR open for manual merge. Record `MERGE_ENABLED=false`. If both `--merge` and `--no-merge` appear, abort with `--merge and --no-merge cannot be combined`.
- `--merge-method <method>` — pin the method without restating `--merge` (useful when `--merge` comes from a saved default). `<method>` ∈ {`squash`, `rebase`, `merge`}; otherwise abort with `--merge-method must be one of squash, rebase, merge (got: {value}).` Record `MERGE_METHOD`. If `--merge=<method>` and `--merge-method <method>` name **different** methods, abort with `--merge=<method> and --merge-method specify conflicting methods ({first} vs {second})`; identical methods are accepted.
- If neither `--merge` nor `--no-merge` is present, leave `MERGE_ENABLED` unset for now — the saved-defaults step fills it from the `merge` key; only if still unset after that does `MERGE_ENABLED=false` apply. Likewise leave `MERGE_METHOD` unset for the saved `merge-method` default, then the repo-default fallback at merge time.

Then apply any **saved defaults** (set via `/do:config`) to the flags the user did NOT pass — an explicit flag, or `--review-with none`, always overrides a saved default. `/do:pr` additionally reads the `merge` and `merge-method` keys here. A method supplied via `--merge=<method>` counts as typing `merge-method`: if `MERGE_METHOD` is already set from it, skip the saved `merge-method` default (injecting it would override the explicit choice or trip the conflict abort above):

!`cat ~/.claude/lib/review-config-defaults.md 2>/dev/null || cat "$(dirname "$(readlink -f .claude/commands/do/pr.md)")/../../lib/review-config-defaults.md"`

!`cat ~/.claude/lib/config-defaults-issues-merge.md 2>/dev/null || cat "$(dirname "$(readlink -f .claude/commands/do/pr.md)")/../../lib/config-defaults-issues-merge.md"`

## Detect VCS Host

Determine whether this repo lives on GitHub or GitLab so the right CLI is used for every host-specific step below. Use the shared preflight: the **`origin` remote is authoritative**, ambient credentials never select the forge, unsupported remotes stop, and the selected CLI must be able to read this checkout.

!read lib/vcs-host.md

Print: `VCS host: {VCS_HOST} (via {CLI_TOOL})`.

## Detect Branches

1. **Default branch** — resolve it git-natively, the way `/do:next` does: it costs no API round-trip and still works during an auth hiccup. Ask the forge only when both git lookups come back empty (GitHub: `gh repo view --json defaultBranchRef -q '.defaultBranchRef.name'`; GitLab: `glab repo view -F json`, reading `.default_branch`):
   ```bash
   DEFAULT_BRANCH="$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@' || true)"
   [ -n "$DEFAULT_BRANCH" ] || DEFAULT_BRANCH="$(git remote show origin 2>/dev/null | sed -n '/HEAD branch: (unknown)$/d; s/.*HEAD branch: //p')"
   echo "DEFAULT_BRANCH=$DEFAULT_BRANCH"
   ```
2. **Current branch** — `git branch --show-current`. If it is the default branch, create a feature branch named for the work (following the project's branch-naming convention when it has one) before committing.
3. The PR (GitHub) / merge request (GitLab) targets the default branch.

Print: `PR flow: {current_branch} → {default_branch}`

## One local review per delivery

Local review runs once per delivery, before the PR/MR opens. Read the lifecycle rules now and apply check 1 (an open PR/MR already exists) before anything else; check 2 and the record step apply at the points named below.

!read lib/pre-pr-review-lifecycle.md

## Commit and Push

- Commit all changes to the current branch. The project's own commit conventions (CLAUDE.md / AGENTS.md / CONTRIBUTING, or the style of its recent history) come first; these are the fallback:

!`cat ~/.claude/lib/commit-conventions.md 2>/dev/null || cat "$(dirname "$(readlink -f .claude/commands/do/pr.md)")/../../lib/commit-conventions.md"`

- **Fetch the default branch and review against the remote-tracking ref; do not rebase by default.** Run `git fetch origin {default_branch}` (not `git fetch origin {default_branch}:{default_branch}`, which rewrites the user's local default branch and fails in a linked worktree whose parent repo has it checked out). Record `origin/{default_branch}` as `{REVIEW_BASE}` and pass it to the review loops as their `{BASE_BRANCH}`. `git diff {REVIEW_BASE}...HEAD` is anchored on the merge-base, so a branch that is merely behind already diffs to only its own changes.
  - **Default-branch movement alone is not a reason to rebase.** A conflict-free branch keeps its HEAD, and with it the validation and reviews recorded against that HEAD. Where the host permits merging a branch that is behind, publish and merge it as it is.
  - **Update the branch only for a concrete reason:** (1) it conflicts with the default branch (`git merge-tree --write-tree {REVIEW_BASE} HEAD` exits non-zero — git ≥ 2.38, otherwise trial-merge and abort — or the host reports the PR as conflicting); (2) the host enforces an up-to-date branch (strict required status checks); or (3) there is evidenced integration risk: base-only commits (`git diff --name-only HEAD...{REVIEW_BASE}`) touch files, symbols or generated artifacts this branch also changes (`git diff --name-only {REVIEW_BASE}...HEAD`) in a way a textual merge would not flag.
  - To update the branch, `git rebase {REVIEW_BASE}`. A conflict is a step to resolve, not a reason to stop: follow [lib/rebase-conflict-resolution.md](../../lib/rebase-conflict-resolution.md) and continue the rebase until it completes. Only that playbook's last-resort, evidence-backed ambiguity may abort it.
  - **A changed HEAD invalidates head-bound results.** After a rebase that changes HEAD, rerun the affected validation, required hosted reviews and checks on the new HEAD before merging. Before the PR exists, the lifecycle note no longer matches, so the local review covers the new head too; once the PR is open, a rebase does not restart the local phase.
- Push the branch. Use `--force-with-lease` (never a bare `--force`) only if a rebase above rewrote already-pushed history:

!read lib/upstream-push.md

Now apply the lifecycle's check 2 (the local phase already finished on this HEAD).

## Local validation policy

Follow the target repository's declared local gate before each push: lint/format checks, fast structural invariants and focused tests for changed behavior. Broad transitive validation (full server, browser, database, build or smoke suites) is opt-in unless the repository requires it locally. Batch bounded review corrections before rerunning the affected focused checks. Report exactly what ran and what is left to hosted CI: a focused pass is not full-suite proof and must not be reported as one. Required hosted checks, configured reviews and the repository's merge safety gates still apply.

## Local Code Review (REQUIRED GATE)

This gate is required whenever the lifecycle checks did not skip it.

<review_gate>

1. Read the commit messages to understand what this change claims to do.
2. List the changed files with `git diff --name-only {REVIEW_BASE}...{current_branch}` (the base resolved in "Commit and Push").
3. For every changed file, read the whole file, not only the diff hunks, and review it under the review preferences below. Each finding quotes the specific line and names the concrete wrong outcome; a style preference is not a finding.
4. Check that the code delivers what the commits claim.
5. Print a review summary table: | finding | file | line | severity | fixable |
6. Fix the findings, run the local gate and focused tests for the changed paths (Local validation policy above), then commit and push the fixes with the upstream-push procedure above. Uncommitted fixes would not be in the PR.
7. Continue to "Pre-PR Local Reviews" only after printing the summary table.

If the diff touches more than 15 files, delegate later batches to a sub-agent to keep context clean.

</review_gate>

Review preferences to apply to each file:

!`cat ~/.claude/lib/review-preferences.md 2>/dev/null || cat "$(dirname "$(readlink -f .claude/commands/do/pr.md)")/../../lib/review-preferences.md"`

## Pre-PR Local Reviews

Partition `REVIEW_AGENTS` into two ordered sublists, preserving relative order:

- `LOCAL_AGENTS` — every entry that is neither `copilot` nor an `@<login>`: `codex`, `agy`, `claude`, `grok`, `pi`, `cursor`, `opencode`, `ollama[…]`, `cmd[<invocation>]`. These review the working tree locally and need no PR.
- `PR_SIDE_AGENTS` — `copilot` plus every `@<login>` entry; these review the PR cloud-side and need it to exist.

Unless the lifecycle checks skipped this phase, and when `LOCAL_AGENTS` is non-empty, run the **multi-reviewer wrapper** (under "Reviewer loop bodies" below) over `LOCAL_AGENTS` now, before the PR is created, so every local reviewer's fixes land before the PR opens. Pass `{REVIEW_STOP_MODE}`, `{REVIEW_MODE}`, `{REVIEWER_APPLIES}`, `{REVIEW_ITERATIONS}` and `{REVIEW_MODELS}` (the saved per-agent default models; every local reviewer but `cmd` reads it). Record the result as `LOCAL_OVERALL_STATUS` (`clean` when `LOCAL_AGENTS` is empty).

- `dirty` (broken build, test failure, rejected): stop before creating the PR and print the proximate failure.
- `clean`, `partial` or `inconclusive`: proceed. A non-clean local pass is a signal to the user, not a block on PR creation.

Then record the finished phase per the lifecycle rules.

## Open the PR

- **Confirm the branch's commits reached the remote.** The review gate and the local reviewers commit fixes onto this branch; if a push step was missed, the PR opens without them, and a clean `git status` says nothing about committed-but-unpushed work. `git log --oneline @{u}..HEAD` must be empty. If it is not, or the branch has no upstream of its own yet, run the upstream-push procedure above again (it handles the unpublished, local-upstream and inherited-base cases and the one retry on a non-fast-forward), then re-check. If that retry rebased the branch, run the Local Code Review gate on what the rebase brought in before creating the PR. If commits are still unpushed, do not create the PR: print the unpushed SHAs and the push error and stop. `/do:pr` is also invoked by `/do:next` and `/do:pr-better`, so leave the expected branch checked out and fully rebased rather than stopping mid-rebase.
- Create the PR / merge request from `{current_branch}` to `{default_branch}`:
  - GitHub: `gh pr create --base {default_branch} --head {current_branch} --title "..." --body "..."`
  - GitLab: `glab mr create --source-branch {current_branch} --target-branch {default_branch} --title "..." --description "..."` (add `--yes` to skip the interactive prompt; `--remove-source-branch` if the project deletes merged branches)
- **Title and description follow the project.** When the repository has a PR/MR template (`.github/PULL_REQUEST_TEMPLATE.md` or a file under `.github/PULL_REQUEST_TEMPLATE/`, the same names at the repo root or under `docs/`, or `.gitlab/merge_request_templates/` on GitLab), fill in its sections; passing `--body`/`--description` bypasses the template, so the CLI will not apply it for you. Follow any title or body rules in the project's CLAUDE.md / AGENTS.md / CONTRIBUTING. With neither, write what changed and why, how it was verified (what ran locally, what is left to CI), and a closing reference for any issue it completes.
- Capture the PR/MR URL and number for the steps below and the final report. If creation fails, report the error and stop; a re-run finds the lifecycle note and retries only the creation.

## Run the PR-side Reviews

**If `PR_SIDE_AGENTS` is empty**, skip this section: set `PR_SIDE_OVERALL_STATUS=clean` (skipped — no PR-side pass requested) and continue to "Compute OVERALL_STATUS".

Execution order is always the local phase, then the PR-side phase, however the user interleaved the list. A stop mode carries across that boundary only when all of these hold, so the skip can never drop the only reviewer looking at the current head or one the user listed earlier:

- the local phase ran in this invocation with a non-empty `LOCAL_AGENTS` (not skipped or restored by the lifecycle checks);
- every `PR_SIDE_AGENTS` entry comes after every `LOCAL_AGENTS` entry in the original `--review-with` order (`codex,copilot` or `codex,agy,@octocat`, not `@octocat,codex`);
- the local phase satisfied `{REVIEW_STOP_MODE}`: the wrapper returned `partial` (its own stop mode already fired), or, with `on-clean`, it returned `clean` and its passes added no commits (a clean phase that made fixes has not satisfied on-clean: the next reviewer still has to check them), or, with `on-findings`, its passes added at least one commit.

When they do, set `PR_SIDE_OVERALL_STATUS=clean` (skipped — already satisfied by the local phase) and continue to "Compute OVERALL_STATUS". With `REVIEW_STOP_MODE=all` (the default) there is no cross-phase skip.

**On GitHub**, read the shared host helper before dispatching any PR-side reviewer. The VCS preflight has already seeded `{GH_HOST}` from the checkout; the helper keeps that value, applies its fallbacks when needed, and confirms authentication.

!read lib/gh-host.md

Hand off to the **multi-reviewer wrapper** (under "Reviewer loop bodies" below) over `PR_SIDE_AGENTS` with:

- `{PR_SIDE_AGENTS}` — `copilot` and/or `@<login>` entries, in order
- `{REVIEW_STOP_MODE}` (it still applies within this phase), `{REVIEW_MODE}`, `{REVIEWER_APPLIES}`, `{REVIEW_ITERATIONS}` (the copilot / `@<login>` cycle cap)
- `{CODE_HOST}` and `{CR_NOUN}` — from "Detect VCS Host"; they select the host-side verbs and name the PR/MR in messages
- `{PR_NUMBER}` — the PR number (GitHub) or MR iid (GitLab) from "Open the PR"
- `{GH_HOST}` — from "Detect VCS Host" (unused on GitLab)
- `{WAIT_SCHEDULE}` — per host-side entry, the default for that reviewer kind ("Wait schedules" in the host-reviewer file); this command does not override it.

**On GitLab**, `@<login>` entries run the same request → poll → fix → resolve flow against the MR through the GitLab verbs. `copilot` is GitHub's own reviewer, so the wrapper records a `copilot` entry on a GitLab MR as `skipped`, which makes the phase `inconclusive` unless the entry is `~opt`.

Record the result as `PR_SIDE_OVERALL_STATUS`.

## Compute OVERALL_STATUS

**If `REVIEW_AGENTS` resolved empty** (no flag and no saved default, or `--review-with none`), set `OVERALL_STATUS=clean`: the Local Code Review gate plus CI is the merge gate, as in `/do:release`, and there is no multi-reviewer aggregate to report.

Otherwise combine `LOCAL_OVERALL_STATUS` and `PR_SIDE_OVERALL_STATUS` (each `clean` when its agent list was empty); the first matching rule wins:

1. `dirty` — either phase is `dirty`
2. `inconclusive` — either phase is `inconclusive`
3. `partial` — either phase is `partial`
4. `clean` — both phases are `clean`

## Merge the PR (only when merge mode is enabled)

**If `MERGE_ENABLED` is not `true`, skip this section**: report the PR/MR URL plus the review summary and stop.

When `MERGE_ENABLED=true`, the merge needs all three of the review result, the unpushed-commits check, and CI:

1. **Review gate** — consume `{OVERALL_STATUS}` the way `/do:release` does:
   - `clean` — eligible (includes the no-reviewer path above, copilot `too-large`, and `capped` from any of the four loops — an explicitly configured cap, `~max=<n>` or `--review-iterations`, reached after applying every fix; a *built-in* cap is `guardrail`, which is inconclusive).
   - `partial` — eligible only when an explicit `--review-stop-on-findings`/`--review-stop-on-clean` flag was set.
   - `inconclusive` or `dirty` — do not merge. Leave the PR open and report the proximate status and URL; a requested reviewer that never produced a verdict is not a clean review.
2. **Unpushed-commits gate** — do not merge while the local branch is ahead of its remote. If reviewer or fix commits never reached the remote, the reviewed and CI-tested tree is not the tree the merge lands, and the merge silently drops those fixes while every signal reads green:

   ```bash
   if git rev-parse --abbrev-ref --symbolic-full-name @{u} >/dev/null 2>&1; then
     UNPUSHED="$(git log --oneline @{u}..HEAD)"
     if [ -n "$UNPUSHED" ]; then
       echo "Not merging: these commits are not on the remote:"; echo "$UNPUSHED"
       exit 1
     fi
   fi
   ```

   If it exits non-zero, report the unpushed SHAs and leave the PR open. Skip the gate when the branch has no upstream. It is independent of `{OVERALL_STATUS}`.
3. **Merge through the shared merge gate.** Inputs: `{PR}` is the PR/MR number, `{GIT}` is `git`, `{MODE}` is `queue` (the merge lands once required checks pass, even after this session ends, and falls back to watching in this session when the host has auto-merge off), `{MERGE_METHOD}` comes from Parse Arguments (it may be unset), and `{LINKED_WORKTREE}` is unset, so the gate resolves it. The gate reports whether the PR **merged**, is **queued**, or was **left open**:

!read lib/merge-gate.md

4. After a **completed** merge, sync the default branch locally with `git checkout {default_branch} && git pull --rebase --autostash`, but only when `LINKED_WORKTREE=0`. In a linked worktree that checkout fails for the same reason `--delete-branch` does (the parent repo already has `{default_branch}` checked out): skip the sync, say so, and let the caller's cleanup sync the parent repo. When the merge is only **queued**, skip the sync too and say so.

**Report the final status**: the PR/MR URL, the multi-reviewer aggregate report (per-pass status table plus overall status), and — when merge mode was enabled — whether the PR merged, is queued to auto-merge on green CI, or was left open (with why).

## Reviewer loop bodies

Both review phases above ("Pre-PR Local Reviews" and "Run the PR-side Reviews") drive the same multi-reviewer wrapper — the only difference is the agent list each passes in (`LOCAL_AGENTS` vs `PR_SIDE_AGENTS`). The wrapper and the single-reviewer loop bodies it dispatches to are read on demand here — skip all of them when both agent lists are empty.

### Multi-reviewer wrapper

Read when either agent list is non-empty:

!read lib/multi-reviewer-loop.md

### Inner loop bodies (referenced by the wrapper)

Read only the bodies for reviewer kinds present in the agent list.

For every `copilot` or `@<login>` entry, read the shared host-reviewer template (its sub-agent runs the `{CODE_HOST}` verb file):

!read lib/host-reviewer-loop.md

Only for `copilot` entries on GitHub, also read the Copilot delta:

!read lib/copilot-review-loop.md

Only for an entry that is none of `copilot`, `ollama`, or `@<login>` (every other slug — the fixed CLIs and `cmd[<invocation>]` alike — dispatches through this one loop; a future addition needs no new gate here):

!read lib/local-agent-review-loop.md

Only for `ollama` entries:

!read lib/ollama-review-loop.md
