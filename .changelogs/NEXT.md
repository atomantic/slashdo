# Unreleased Changes

## Added

- `lib/remediation-agent-template.md`: Extracted reusable remediation agent template with data-before-instructions layout, XML-tagged sections, guardrails, and goal-oriented commit strategy

## Changed

- `lib/code-review-checklist.md`: Added checks for orphaned resources on delete, stale mutation returns, missing await on async cleanup, destructive UI confirmation; broadened schema partial depth and duplicated utility checks
- `commands/do/review.md`: Added deep checks for deletion lifecycle cleanup, update schema depth, mutation return value freshness, responsibility relocation audit, read-after-write consistency, and auth gate verification on restricted route groups
- `lib/code-review-checklist.md`: Added checks for data model field name divergence across write paths, fire-and-forget write consistency, responsibility relocation breaking dependents, read-after-write eventual consistency, missing auth gates on restricted routes, and destructive composite attribute overwrites
- `commands/do/release.md`, `commands/do/pr.md`, `commands/do/fpr.md`: Strengthened code review section with REQUIRED GATE language, explicit STOP instructions, per-file read requirements, and verification checklist to prevent skipping the deep review before opening PRs
- `commands/do/better.md`: Expanded audit agent focus (OWASP, supply chain, API contracts, resilience, observability, migration safety); optimized prompts for Claude 4.6 (reduced urgency language, added [UNCERTAIN] permission, investigate-before-answering pattern, data-before-instructions layout); extracted inline templates to shared lib files via !cat references (-103 lines)
- `lib/code-review-checklist.md`: Added supply chain & dependency health section, API versioning checks, migration safety, external service timeouts/fallbacks, observability items, cyclomatic complexity threshold

## Fixed

## Removed
