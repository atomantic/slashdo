---
description: Audit and remediate repository code in isolated worktrees, with per-category PRs, CI checks, and optional reviewer loops
argument-hint: "[--interactive] [--scan-only] [--simplify-only] [--no-merge] [--review-with <agent>[,<agent>...]] [--review-iterations <n>] [--review-mode <series|parallel>] [--review-stop-on-findings|--review-stop-on-clean] [--reviewer-applies] [--strict|--nuclear] [--issues-label <name>] [path filter or focus areas]"
---

# Better — Audit and remediate

Audit the requested scope, consolidate evidence, fix actionable findings in an isolated worktree, verify, and publish one PR per category. Default: autonomous, Balanced model profile. `!read lib/<name>.md` paths resolve from this slashdo package root in source checkouts; installed commands supply host-specific paths. Read only the reference for the phase or mode you are entering; a required reference that cannot be read is a blocker for that step, never permission to skip a gate. Preserve existing caller overrides (`pr-better` ships one PR; `better-swift` supplies platform inputs).

## Start

Parse arguments and saved defaults before choosing phases. Explicit flags override saved defaults; `--review-with none` disables saved reviewers.

!read lib/better-options.md

Only with `--simplify-only` / `--refactor-only`, read the scope, finding gates, per-phase overrides, and hard behavior-preservation contract before discovery. It implies strict mode and skips test enhancement.

!read lib/better-simplify.md

## Workflow

Execute applicable steps in order. Reading this list does not request loading every reference now.

0. Discover the repository, VCS host, stack/UI, commands, and initial state. Set `AUDIT_MODEL_TIER=medium` and `REMEDIATION_MODEL_TIER=medium` by default. Under `--interactive`, offer Quality (`heavy`/`heavy`), Balanced (`medium`/`medium`), or Budget (`light`/`medium`); assign the chosen pair and record `MODEL_PROFILE`; otherwise never pause for a profile.

!read lib/better-discovery.md

Read the shared spool/filer contract once, before any phase below touches it:

!read lib/better-issue-mode.md

1. Audit only applicable scopes; workers receive only their own scope and task context, and spool their findings.

!read lib/better-audit.md

2. Consolidate, deduplicate, assign one owner per file, and record disposition; deferred findings become tracker issues. Scan-only files every surviving finding, stops here, and never creates a worktree or edits code. If no actionable findings remain, report deferred work and stop.

!read lib/better-plan.md

3. Resolve the pipeline inputs Phases 3–7 substitute, then remediate CRITICAL/HIGH/MEDIUM code findings in the isolated worktree, one owner per file.

!read lib/better-pipeline-inputs.md
!read lib/better-remediation.md

4. Run build/tests and internal review. Fix failures before publication.

!read lib/better-verification.md

4c. Only outside simplify-only mode, enhance tests for demonstrated gaps and update file ownership. `pr-better` completes this before merging the worktree back.

!read lib/better-test-enhancement.md

5. Publish category PRs and verify CI. `--no-merge` and GitLab stop after PR/MR creation and proceed to safe finalization.

!read lib/better-pr-and-ci.md

6. Only on GitHub, with reviewers configured and without `--no-merge`, run each PR's selected review loop. No reviewer means leave PRs open. Merge only what the Phase 6 merge gate permits.

!read lib/better-review-loop.md

7. Report outcomes and clean up only artifacts proven safe to remove.

!read lib/better-cleanup.md

## Run state and recovery

Before compaction, read the list of run state to preserve:

!read lib/better-state.md

Agent failure leaves a reported coverage gap. Try a build/CI fix only within scope. Never delete or overwrite a pre-existing worktree or unrelated user changes; stop the affected phase with a resumable report if recovery is unsafe. Interactive choices apply only when `--interactive` was explicitly requested and a human is available.
