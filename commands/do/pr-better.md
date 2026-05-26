---
description: Run a full do:better audit/remediation on the current branch, commit fixes directly to it, then open a single PR with do:pr
argument-hint: "[--interactive] [--review-with <agent>[,<agent>...]] [--review-iterations <n>] [--review-stop-on-findings|--review-stop-on-clean] [--reviewer-applies] [path filter or focus areas]"
---

# PR-Better — Better Audit + Single PR

Run the full `do:better` DevSecOps audit and remediation, but **commit all fixes directly to the current branch** instead of creating per-category PRs. Then hand off to `do:pr` so the entire result ships as one cohesive PR (with the self-review gate always, plus a multi-reviewer loop **only if** `--review-with` lists one or more agents — there is no default reviewer; omit the flag and only the self-review runs).

This is the right command when:
- You want the full `do:better` quality bar on a feature branch you're about to ship
- You want a single PR (not 8 per-category PRs) so reviewers see one cohesive change
- You're already on a feature branch and want all audit fixes folded into the same PR as your feature work

## Argument Forwarding

Split `$ARGUMENTS` into groups before forwarding — every `do:pr` review flag must be extracted and held aside so `do:better` doesn't reject it:
- **`--review-with <agent[,agent,...]>`** is a `do:pr` flag, NOT a `do:better` flag. Extract it from `$ARGUMENTS`, record the value as `REVIEW_AGENT_ARG` (the full `--review-with <value>` token pair preserved verbatim including any comma-separated list, or empty string if not supplied), and remove it from the string passed to `do:better`.
- **`--review-stop-on-findings`** and **`--review-stop-on-clean`** are `do:pr` flags and are **mutually exclusive**. If both are present in `$ARGUMENTS`, abort with the same error `do:pr` would surface: `--review-stop-on-findings and --review-stop-on-clean cannot be combined` — do NOT silently drop one or forward only one (that would shift the error surface to an unrelated `do:better`/`do:pr` failure). If exactly one is present, extract it, record as `REVIEW_STOP_ARG` (the literal flag token, or empty string if absent), and remove it from the string passed to `do:better`.
- **`--reviewer-applies`** is also a `do:pr` flag, NOT a `do:better` flag. Extract it from `$ARGUMENTS`, record as `REVIEWER_APPLIES_ARG` (the literal token `--reviewer-applies`, or empty string if not supplied), and remove it from the string passed to `do:better`.
- **`--review-iterations <n>`** is a `do:pr` flag, NOT a `do:better` flag. Extract it from `$ARGUMENTS`, record the value as `REVIEW_ITERATIONS_ARG` (the full `--review-iterations <value>` token pair preserved verbatim, or empty string if not supplied), and remove it from the string passed to `do:better`. Leave validation to `do:pr` — forward the token as-is so `do:pr` surfaces the canonical `--review-iterations must be a non-negative integer` error.
- All remaining flags (`--interactive`, path filter, focus areas) pass through to `do:better` verbatim.

Constraints applied automatically:
- **`--scan-only` is incompatible** — if the user passes it, refuse and explain that pr-better must remediate
- **`--no-merge` is incompatible** — pr-better always produces a PR, but as one combined PR via `do:pr`

## Pre-flight

1. Run `git branch --show-current` and `gh repo view --json defaultBranchRef -q '.defaultBranchRef.name'`
2. If the current branch is the default branch, halt and tell the user: pr-better needs a feature branch — either create one first or run `/do:better` directly to produce per-category PRs from default
3. Run `git status --porcelain` — if dirty, the do:better Phase 3a stash will handle it, but warn the user that uncommitted changes will be stashed and restored after the audit

## Phase A: Run do:better (constrained to "Commit directly")

Execute the full `do:better` workflow defined in `~/.claude/commands/do/better.md` with these mandatory deviations:

### Phase 0 → 4a: unchanged
Run discovery, audit (all 8 agents, plus the Structural Ambition agent when `--strict`/`--nuclear` is passed), plan generation, worktree setup, foundation utilities, parallel remediation, build/test verification, and internal code review exactly as specified in `do:better`.

### Phase 4b: Force the "Commit directly" path

When you reach Phase 4b's decision point, **do not present the AskUserQuestion** and **do not proceed to per-category PR creation**. Instead, always take the "Commit directly" path:

- Ensure all worktree changes are committed in `better/{DATE}`
- Return to `{REPO_DIR}`, check out `{CURRENT_BRANCH}`, and merge `better/{DATE}` into it:
  ```bash
  cd {REPO_DIR}
  git checkout {CURRENT_BRANCH}
  if git merge better/{DATE}; then
    git worktree remove {WORKTREE_DIR}
    git branch -D better/{DATE}
  else
    echo "Merge conflict — resolve in {REPO_DIR}, then run:"
    echo "  git worktree remove {WORKTREE_DIR}"
    echo "  git branch -D better/{DATE}"
    # halt and surface the conflict to the user
  fi
  ```
- If a merge conflict surfaces, stop here and ask the user to resolve before continuing to Phase B
- Restore the stash if Phase 3a stashed changes (`git stash pop`)

### Phase 4c: Test Enhancement

Run Phase 4c (test enhancement) **before** the merge-back if the worktree is still active, so the new/fixed tests ship in the same merge. The Phase 4c.3 `FILE_OWNER_MAP` update is unnecessary in pr-better (we're not building per-category branches), so skip that step.

### Phases 5, 6, 7: SKIP entirely

Do not create category branches. Do not bump the version (the user's PR is responsible for any version bump via the project's normal release flow). Do not run the Copilot review loop here — `do:pr` will run it once on the combined PR. Do not delete branches you didn't create.

The only Phase 7-equivalent housekeeping that applies:
- Update PLAN.md to mark completed findings by flipping `- [ ]` → `- [x]` — **preserve the `[<slug>]` ID** on each line (only the box character changes, the slug stays). Note any skipped findings with reasons. Stage these changes so the next phase commits them as part of the PR. See [lib/plan-id-format.md](../../lib/plan-id-format.md).
- Print the final summary table from Phase 7 (with PR fields blank — they'll be filled by Phase B).

## Phase B: Run do:pr

After Phase A leaves all fixes committed on `{CURRENT_BRANCH}`, hand off to the workflow defined in `~/.claude/commands/do/pr.md`, forwarding all four review flags extracted in argument forwarding — `REVIEW_AGENT_ARG` (the `--review-with <value>` pair, possibly comma-separated), `REVIEW_STOP_ARG` (the stop-mode flag, if any), `REVIEWER_APPLIES_ARG` (the `--reviewer-applies` token, if passed), and `REVIEW_ITERATIONS_ARG` (the `--review-iterations <value>` pair, if passed) — so the chosen reviewer(s), stop-mode, editing mode, and copilot iteration cap all run on the combined PR:

1. **Detect branches** — already done in pre-flight, reuse those values
2. **Commit and push** — commit any remaining staged changes (e.g., the PLAN.md update), then `git pull --rebase --autostash && git push -u origin {current_branch}`
3. **Local Code Review (REQUIRED GATE)** — run the full review gate from `do:pr`. The do:better Phase 4b internal review covered the worktree diff against the default branch, but the do:pr review gate also covers any prior commits on the feature branch that predate this run. Do not skip it.
4. **Open the PR** — create a single PR with a description that summarizes both:
   - The original feature work on the branch (from prior commits)
   - The do:better audit findings now folded in (categories, counts, severity)
5. **Review loop** — runs once on the combined PR via the standard `do:pr` flow. If `REVIEW_AGENT_ARG` is empty (no `--review-with` was passed), `do:pr` runs **no** external review loop — there is no default reviewer; the self-review gate at step 3 is the only review. When one or more agents are listed, `do:pr` routes review execution through the multi-reviewer wrapper, even for a single agent (which becomes a one-item list dispatching to the matching inner loop: the copilot loop for `copilot`, the local-agent loop for `codex`/`gemini`/`claude`). Multi-agent lists (e.g., `--review-with codex,gemini,copilot`) run each entry in order through the same wrapper. `REVIEW_STOP_ARG` controls when to stop early (default: run all). If `REVIEWER_APPLIES_ARG` is also set, do:pr passes the flag through so the chosen CLI (not the orchestrator) applies fixes — on the copilot path the flag is a no-op (a warning is printed). `REVIEW_ITERATIONS_ARG` caps the copilot review-and-fix cycles (default `1`) when copilot is in the list.

## Final Report

Print:
- The do:better summary table (categories, findings fixed/skipped) — with the PR column populated by the single PR URL
- Test enhancement stats (vacuous fixed, weak strengthened, new cases, new files)
- The PR URL
- Final review status (clean / comments addressed / left open)

## Notes

- This is **not** equivalent to running `/do:better --no-merge` then `/do:pr`. `--no-merge` still creates per-category branches and PRs (it just skips the Copilot/merge step). pr-better never creates per-category branches at all.
- Conflict-avoidance machinery from do:better Phase 5 (FILE_OWNER_MAP, backward-compatible re-exports across PRs) is unnecessary here — everything lands on one branch in one merge.
- The user's existing feature commits remain intact; do:better remediation is added as additional commits on top.
- If do:better finds zero actionable CRITICAL/HIGH/MEDIUM findings, skip Phase A's Phase 3-4 entirely and run only Phase B (`do:pr`) — the audit served as a quality gate even when nothing needed fixing.
