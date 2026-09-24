---
description: Run a full do:better audit/remediation on the current branch, commit fixes directly to it, then open a single PR with do:pr
argument-hint: "[--interactive] [--simplify-only] [--strict|--nuclear] [--review-with <agent>[,<agent>...]] [--review-iterations <n>] [--review-mode <series|parallel>] [--review-stop-on-findings|--review-stop-on-clean] [--reviewer-applies] [path filter or focus areas]"
---

# PR-Better — Better Audit + Single PR

Run the full `do:better` DevSecOps audit and remediation, but **commit all fixes directly to the current branch** instead of creating per-category PRs. Then hand off to `do:pr` so the entire result ships as one cohesive PR (with the self-review gate always, plus a multi-reviewer loop when `--review-with` lists one or more agents or a saved reviewer default supplies them; without either, only the self-review runs).

This is the right command when:
- You want the full `do:better` quality bar on a feature branch you're about to ship
- You want a single PR (not a stack of per-category PRs) so reviewers see one cohesive change
- You're already on a feature branch and want all audit fixes folded into the same PR as your feature work

## Argument Forwarding

Hold aside every `do:pr` review flag — `--review-with <agent[,agent,...]>`, `--review-iterations <n>`, `--review-mode <series|parallel>`, `--review-stop-on-findings`/`--review-stop-on-clean` (**mutually exclusive**: if both are present, abort immediately, before running anything, with `--review-stop-on-findings and --review-stop-on-clean cannot be combined`), and `--reviewer-applies` — extracting each token (and its value, where it takes one) verbatim from `$ARGUMENTS` and removing it from the string passed to `do:better`. Forward the held-aside tokens unchanged to Phase B; `do:pr`'s own parsing ([lib/review-flags.md](../../lib/review-flags.md)) is the single source of truth for their grammar and every other abort message, so do not re-validate them here.

All remaining flags (`--interactive`, `--simplify-only`, `--strict`, path filter, focus areas) pass through to `do:better` verbatim. `--simplify-only` narrows the audit to refactoring, architecture, DRY, simplification, and cognitive load, and holds every fix to `do:better`'s behavior-preservation contract — the resulting PR is a pure refactor of the branch.

Constraints applied automatically:
- **`--scan-only` is incompatible** — if the user passes it, refuse and explain that pr-better must remediate
- **`--no-merge` is incompatible** — pr-better always produces a PR, but as one combined PR via `do:pr`

## Pre-flight

1. Run `git branch --show-current` for `{CURRENT_BRANCH}`. Refresh and detect the default branch host-agnostically for this guard — this runs before `do:better`/`do:pr`'s own VCS-host detection, so it must work on GitHub and GitLab alike without invoking either CLI. Always run `git remote set-head origin --auto` once and abort with recovery guidance if it fails; then read `git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@'`. Refreshing unconditionally prevents a stale `origin/HEAD` from surviving a remote default-branch rename. **Never assume a name (e.g. `main`) if the refreshed ref is empty** — a wrong guess here would misjudge step 2 and, if it happened to also survive into Phase B, rebase onto the wrong branch. If the refreshed default cannot be resolved, halt before Phase A; do not proceed to a workflow that may commit directly to the current branch. `do:pr` also performs host-authoritative detection in Phase B, but that later guard does not protect Phase A.
2. If the current branch is the resolved default branch, halt and tell the user: pr-better needs a feature branch — either create one first or run `/do:better` directly to produce per-category PRs from default
3. Run `git status --porcelain` — if dirty, the do:better Phase 3a stash will handle it, but warn the user that uncommitted changes will be stashed and restored after the audit

## Phase A: Run do:better (constrained to "Commit directly")

Execute the full `do:better` workflow defined in `~/.claude/commands/do/better.md`, through Phase 4c, for the requested paths/focus (including the narrowed structural scopes under `--simplify-only`): discovery, audit, plan generation, worktree setup, remediation, build/test verification, internal code review, and test enhancement — exactly as `do:better` specifies. The Phase 4c.3 `FILE_OWNER_MAP` update is unnecessary here (pr-better never builds per-category branches), so skip that step; everything else in Phase 4c runs normally, including under `--simplify-only`, where `do:better` itself skips the phase.

At Phase 4b's decision point, **do not present the `AskUserQuestion`** and **do not proceed to Phase 5** (per-category PR creation). Instead, always take the **"Commit directly"** path from [lib/better-verification.md](../../lib/better-verification.md): merge `{BRANCH_PREFIX}/{DATE}` into `{CURRENT_BRANCH}` in `{REPO_DIR}`, remove `{WORKTREE_DIR}` and the staging branch only after a clean merge (on a conflict, keep both and surface the resolve-then-remove commands to the user, then stop before Phase B), and restore the Phase 3a stash if one was taken.

This replaces Phases 5–7 entirely: no category branches, no version bump (the user's PR carries any version bump via the project's normal release flow), no per-category review loop (`do:pr` runs the review loop once on the combined PR in Phase B).

The only Phase 7-equivalent housekeeping that still applies here:
- Remove `SPOOL_DIR` per Phase 7's "Remove the spool" step (keep it when any filer returned `ERROR`).
- Note any skipped findings with reasons, and the issues filed for deferred findings (or, with no tracker, the "Deferred (not filed — no issue tracker available)" list).
- Print the final summary table from Phase 7's format (with PR fields blank — they'll be filled by Phase B).

## Phase B: Run do:pr

After Phase A leaves all fixes committed on `{CURRENT_BRANCH}`, hand off to the workflow defined in `~/.claude/commands/do/pr.md`, forwarding the review flags held aside during argument forwarding unchanged — so the chosen reviewer(s), stop-mode, dispatch mode, editing mode, and iteration cap all run on the combined PR exactly as `do:pr` itself would apply them ([lib/review-flags.md](../../lib/review-flags.md); if no review flag was passed, `do:pr` still applies its saved `review-with` default, if any; without one, the self-review gate at step 3 is the only review):

1. **Detect branches** — already done in pre-flight, reuse those values
2. **Commit and push** — commit any remaining staged changes, then run `do:pr`'s "Commit and Push" step verbatim: fast-forward the **local** `{default_branch}` ref to origin and rebase the branch onto it (`git fetch origin {default_branch}:{default_branch} && git rebase {default_branch}`), resolving and continuing through conflicts with [lib/rebase-conflict-resolution.md](../../lib/rebase-conflict-resolution.md), including regeneration of generated artifacts from their canonical inputs, so the reviewers below — which diff against the local `{default_branch}` — see a current base; then push using `do:pr`'s upstream-derived rules (`--force-with-lease` if the rebase rewrote pushed history). A rebase conflict is not a handoff or stop condition.
3. **Local Code Review (REQUIRED GATE)** — run the full review gate from `do:pr`. The do:better Phase 4b internal review covered the worktree diff against the default branch, but the do:pr review gate also covers any prior commits on the feature branch that predate this run. Do not skip it.
4. **Open the PR** — create a single PR with a description that summarizes both:
   - The original feature work on the branch (from prior commits)
   - The do:better audit findings now folded in (categories, counts, severity)
5. **Review loop** — runs once on the combined PR via `do:pr`'s standard multi-reviewer dispatch, using the flags forwarded above. `do:pr` owns the dispatch mechanics (series/parallel, stop-mode, `--reviewer-applies` scoping to the write-isolated `codex` pass, iteration caps) — this command does not restate them.

## Final Report

Print:
- The do:better summary table (categories, findings fixed/skipped) — with the PR column populated by the single PR URL
- Test enhancement stats (vacuous fixed, weak strengthened, new cases, new files)
- The PR URL
- Final review status (clean / comments addressed / left open)

## Notes

- This is **not** equivalent to running `/do:better --no-merge` then `/do:pr`. `--no-merge` still creates per-category branches and PRs (it just skips the Phase 6 review/merge step). pr-better never creates per-category branches at all.
- Conflict-avoidance machinery from do:better Phase 5 (FILE_OWNER_MAP, backward-compatible re-exports across PRs) is unnecessary here — everything lands on one branch in one merge.
- The user's existing feature commits remain intact; do:better remediation is added as additional commits on top.
- If do:better finds zero actionable CRITICAL/HIGH/MEDIUM findings, skip Phase A's Phase 3-4 entirely and run only Phase B (`do:pr`) — the audit served as a quality gate even when nothing needed fixing.
