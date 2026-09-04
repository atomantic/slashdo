---
description: Audit and remediate repository code in isolated worktrees, with per-category PRs, CI checks, and optional reviewer loops
argument-hint: "[--interactive] [--scan-only] [--simplify-only] [--no-merge] [--review-with <agent>[,<agent>...]] [--review-iterations <n>] [--review-mode <series|parallel>] [--review-stop-on-findings|--review-stop-on-clean] [--reviewer-applies] [--strict|--nuclear] [--issues|--no-issues] [--issues-label <name>] [path filter or focus areas]"
---

# Better — Audit and remediate

Audit the requested scope, consolidate evidence, fix actionable findings in an isolated worktree, verify, and publish one PR per category. Default: autonomous, Balanced model profile. `!read lib/<name>.md` paths resolve from this slashdo package root in source checkouts; installed commands supply host-specific paths. Read only the reference for the phase or mode you are entering; a required reference that cannot be read is a blocker for that step, never permission to skip a gate. Preserve existing caller overrides (`pr-better` ships one PR; `better-swift` supplies platform inputs).

## Start

Parse arguments and saved defaults before choosing phases. Explicit flags override saved defaults; `--review-with none` disables saved reviewers. The options reference contains reviewer grammar and validation.

!read lib/better-options.md

Only with `--simplify-only` / `--refactor-only`, read the scope, finding gates, and hard behavior-preservation contract before discovery. It implies strict mode and skips test enhancement.

!read lib/better-simplify.md

## Workflow

Execute applicable steps in order. Reading this list does not request loading every reference now.

0. Discover the repository, VCS host, stack/UI, commands, and initial state. Read model-tier guidance when dispatching agents; set `AUDIT_MODEL_TIER=medium` and `REMEDIATION_MODEL_TIER=medium` by default. Under `--interactive`, offer Quality (`heavy`/`heavy`), Balanced (`medium`/`medium`), or Budget (`light`/`medium`); assign the chosen pair to those variables and record `MODEL_PROFILE`; otherwise never pause for a profile. If the host cannot select a tier, inherit the session and report it.

!read lib/better-discovery.md

1. Audit only applicable scopes. Workers read their own lens and receive only their task context; tests follow the other scopes. Carry the compact finding index and literal spool path in issue mode.

!read lib/better-audit.md

2. Consolidate, deduplicate, assign one owner per file, and record disposition. `--issues` chooses the tracker instead of PLAN.md; it does not stop remediation. **`--scan-only --issues` files every surviving finding before stopping.** Scan-only never creates a worktree or edits code. If no actionable findings remain, report deferred work and stop.

!read lib/better-plan.md

3. Remediate CRITICAL/HIGH/MEDIUM code findings in the isolated worktree; create shared foundations before dependent workers. LOW findings stay tracked. Keep overlapping files with one worker.

!read lib/better-remediation.md

4. Resolve pipeline inputs, then run build/tests and internal review. Fix failures before publication. No feature or behavior changes are permitted in simplify-only mode.

!read lib/better-pipeline-inputs.md
!read lib/better-verification.md

4c. Only outside simplify-only mode, enhance tests for demonstrated gaps and update file ownership. `pr-better` completes this before merging the worktree back.

!read lib/better-test-enhancement.md

5. Publish category PRs and verify CI. `--no-merge` stops publication after PR creation; GitLab stops after MR creation. Both proceed to safe finalization to restore the stash and retain open-PR artifacts. Missing expected checks, failed pushes, and failing checks cannot authorize review or merge.

!read lib/better-pr-and-ci.md

6. Only on GitHub, with reviewers configured and without `--no-merge`, run each PR's selected review loop. No reviewer means leave PRs open. Required inconclusive/dirty review blocks merge; explicit optional/stop/cap semantics come from the shared wrapper. Recheck current head, CI, and review status after any new commits or rebase.

!read lib/better-review-loop.md

7. Report outcomes and clean up only artifacts proven safe to remove. Retain branches for open PRs and work needed to resume a blocked run; retain spooled bodies after filing errors.

!read lib/better-cleanup.md

## Run state and recovery

Preserve phase, complete file ownership, findings, flags/defaults, repository/worktree paths, model tiers, build/test commands, spool path, PR/head/review/CI outcomes, and created branches across compaction. Before compaction read the full state checklist:

!read lib/better-state.md

Agent failure leaves a reported coverage gap. Validate uncertain findings before fixing. Try a build/CI fix only within scope; cap CI remediation at three attempts per PR and leave blocked PRs open. Do not delete or overwrite a pre-existing worktree; resume only when its ownership and matching task are proven, otherwise choose a unique run path. Preserve unrelated user changes and stop the affected phase with a resumable report if recovery is unsafe. Interactive choices apply only when `--interactive` was explicitly requested and a human is available.
