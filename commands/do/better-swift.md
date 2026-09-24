---
description: SwiftUI DevSecOps audit, remediation, test enhancement, per-category PRs, CI verification, and an optional multi-reviewer review loop with worktree isolation — optimized for multi-platform Swift/SwiftUI apps (iOS, macOS, watchOS, tvOS, visionOS)
argument-hint: "[--interactive] [--scan-only] [--simplify-only] [--strict] [--no-merge] [--review-with <agent>[,<agent>...]] [--review-iterations <n>] [--review-mode <series|parallel>] [--review-stop-on-findings|--review-stop-on-clean] [--reviewer-applies] [--issues-label <name>] [path filter or focus areas]"
---

# Better Swift — Unified DevSecOps Pipeline for SwiftUI Apps

Run the canonical `/do:better` lifecycle for a Swift/SwiftUI multi-platform project: audit with the Swift caller inputs, consolidate and remediate in an isolated worktree, enhance tests, publish one PR per category, verify CI, and run the requested review loop. The shared `lib/better-*.md` partials own phase procedures; `lib/swift-pipeline-inputs.md` supplies the Swift discovery, scope, remediation, test, and pipeline values.

Default mode is autonomous and has no prompts. There is no default reviewer: without `--review-with`, external review and auto-merge are skipped and PRs remain open for manual review. `--interactive` enables the shared decision prompts.

## Start

Parse arguments and saved defaults through the shared options contract:

!read lib/better-options.md

`--simplify-only`, `--refactor-only`, `--strict`, and `--nuclear` are unsupported by this Swift caller; reject any of them before Phase 0 rather than applying the generic mode gates.

Read the Swift caller inputs before entering the workflow. Their phase-labelled sections are data and guardrails for the canonical partials, not forked phase procedures:

!read lib/swift-pipeline-inputs.md

Read the shared spool/filer contract once, before Phase 1 touches the spool or tracker:

!read lib/better-issue-mode.md

## Workflow

Execute the canonical phases in order. Read each partial when its phase applies; the Swift input file supplies the differences between `/do:better` and this caller.

0. Discover the repository, VCS host, Swift project/build system, platforms, deployment targets, commands, and initial state. Keep the shared worktree ownership and no-prompt recovery rules.

!read lib/better-discovery.md

1. Run the selected Swift audit scopes with the shared evidence, deduplication, and issue-spool contract.

!read lib/better-audit.md

2. Consolidate findings, record the Swift category map and Foundation work, build `FILE_OWNER_MAP`, and stop after scan-only filing when requested.

!read lib/better-plan.md

3. Create the uniquely owned `better-swift/{DATE}` staging worktree and run the shared remediation workers with the Swift guardrails.

!read lib/better-remediation.md

4. Resolve the shared pipeline inputs, run all-platform build/tests, and perform the Swift-specific internal review before publication.

!read lib/better-verification.md

4c. Enhance tests for demonstrated gaps and update the file ownership map using the Swift test conventions.

!read lib/better-test-enhancement.md

5. Create the Swift category PRs, bump the Swift version through the supplied procedure, and verify CI.

!read lib/better-pr-and-ci.md

6. Run the selected review loop only when requested, on GitHub or GitLab alike; leave PRs open when no reviewer is selected or the result is inconclusive.

!read lib/better-review-loop.md

7. Restore only safe artifacts, retain worktrees and branches needed by open PRs, remove the issue spool when safe, and print the supplied Swift summary.

!read lib/better-cleanup.md

## Run state and recovery

Preserve the shared state checklist, including the complete file ownership map, finding evidence, Swift platform and deployment values, gotcha entries, spool path, PR heads, CI results, and review outcomes:

!read lib/better-state.md
