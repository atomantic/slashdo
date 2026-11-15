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

Hold aside every `do:pr` review flag: `--review-with <agent[,agent,...]>`, `--review-iterations <n>`, `--review-mode <series|parallel>`, `--review-stop-on-findings`/`--review-stop-on-clean`, and `--reviewer-applies`. Take each token (and its value, where it takes one) verbatim out of `$ARGUMENTS` so it is not passed to `do:better`. The two stop flags are mutually exclusive: if both are present, abort before running anything with `--review-stop-on-findings and --review-stop-on-clean cannot be combined`, since otherwise the whole audit would run before `do:pr` rejected them. Forward the held-aside tokens unchanged to Phase B; `do:pr`'s own parsing ([lib/review-flags.md](../../lib/review-flags.md)) is the single source of truth for their grammar and every other abort message, so do not re-validate them here.

All remaining flags (`--interactive`, `--simplify-only`, `--strict`, path filter, focus areas) pass through to `do:better` verbatim. `--simplify-only` narrows the audit to refactoring, architecture, DRY, simplification, and cognitive load, and holds every fix to `do:better`'s behavior-preservation contract — the resulting PR is a pure refactor of the branch.

Constraints applied automatically:
- **`--scan-only` is incompatible** — if the user passes it, refuse and explain that pr-better must remediate
- **`--no-merge` is incompatible** — pr-better always produces a PR, but as one combined PR via `do:pr`

## Pre-flight

1. Run `git branch --show-current` for `{CURRENT_BRANCH}`. Resolve the default branch from git alone, because this guard runs before `do:better` or `do:pr` detect the host: run `git remote set-head origin --auto` (it refreshes an `origin/HEAD` left stale by a remote default-branch rename), then read `git symbolic-ref --short refs/remotes/origin/HEAD` and strip the `origin/` prefix. If either step fails or the result is empty, stop with recovery guidance instead of assuming a name such as `main`: Phase A commits to the current branch, and a wrong guess would defeat step 2.
2. If the current branch is the resolved default branch, halt and tell the user: pr-better needs a feature branch — either create one first or run `/do:better` directly to produce per-category PRs from default
3. Run `git status --porcelain` — if dirty, the do:better Phase 3a stash will handle it, but warn the user that uncommitted changes will be stashed and restored after the audit

## Phase A: Run do:better (constrained to "Commit directly")

Execute the `do:better` workflow defined in `~/.claude/commands/do/better.md` through Phase 4c, for the requested paths/focus (including the narrowed structural scopes under `--simplify-only`, where `do:better` itself skips Phase 4c): discovery, audit, plan, worktree setup, remediation, build/test verification, internal code review, and test enhancement, as `do:better` specifies.

Then stop following that workflow. Do not read its Phase 5–7 references (`better-pr-and-ci`, `better-review-loop`, `better-cleanup`): there are no category branches here, so the per-category split, its `FILE_OWNER_MAP` update in Phase 4c, the per-category review loop, and branch cleanup do not apply. `FILE_OWNER_MAP` itself is still built in Phase 2, because remediation uses it to give each file one worker.

At Phase 4b's decision point, do not ask the user; always take the **Commit directly** path from [lib/better-verification.md](../../lib/better-verification.md): merge `{BRANCH_PREFIX}/{DATE}` into `{CURRENT_BRANCH}` in `{REPO_DIR}`, remove `{WORKTREE_DIR}` and the staging branch only after a clean merge (on a conflict, keep both, give the user the resolve-then-remove commands, and stop before Phase B), and restore the Phase 3a stash if one was taken. No version bump is made; the user's PR carries any bump through the project's normal release flow.

Finish Phase A with the housekeeping the skipped phases would have done:
- Remove `SPOOL_DIR` (by its literal recorded path), unless any issue filer returned `ERROR`; then keep it and print its path.
- Note any skipped findings with reasons, and the issues filed for deferred findings (or, with no tracker, the "Deferred (not filed — no issue tracker available)" list).
- Print the summary table described in the **Final Summary Table** section of the pipeline inputs, with the PR fields blank until Phase B fills them.

## Phase B: Run do:pr

After Phase A leaves all fixes committed on `{CURRENT_BRANCH}`, hand off to the workflow defined in `~/.claude/commands/do/pr.md`, forwarding the review flags held aside during argument forwarding unchanged — so the chosen reviewer(s), stop-mode, dispatch mode, editing mode, and iteration cap all run on the combined PR exactly as `do:pr` itself would apply them ([lib/review-flags.md](../../lib/review-flags.md); if no review flag was passed, `do:pr` still applies its saved `review-with` default, if any; without one, the self-review gate at step 3 is the only review):

1. **Detect branches** — already done in pre-flight, reuse those values
2. **Commit and push** — commit any remaining staged changes, then run `do:pr`'s "Commit and Push" step as written. `do:pr` owns when to rebase, how to resolve a rebase conflict, and how to push; this command adds nothing to those rules.
3. **Local code review (required gate)** — run the full review gate from `do:pr`. Phase 4b reviewed the remediation worktree; the `do:pr` gate reviews the whole branch as it will ship, including the commits that predate this run, so it is not redundant.
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
- The user's existing feature commits remain intact; do:better remediation is added as additional commits on top.
- If do:better finds zero actionable CRITICAL/HIGH/MEDIUM findings, skip Phase A's Phase 3-4 entirely and run only Phase B (`do:pr`) — the audit served as a quality gate even when nothing needed fixing.
