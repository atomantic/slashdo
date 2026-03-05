# Unreleased Changes

## Added

## Changed

- `lib/code-review-checklist.md`: Added checks for orphaned resources on delete, stale mutation returns, missing await on async cleanup, destructive UI confirmation; broadened schema partial depth and duplicated utility checks
- `commands/do/review.md`: Added deep checks for deletion lifecycle cleanup, update schema depth, mutation return value freshness, responsibility relocation audit, read-after-write consistency, and auth gate verification on restricted route groups
- `lib/code-review-checklist.md`: Added checks for data model field name divergence across write paths, fire-and-forget write consistency, responsibility relocation breaking dependents, read-after-write eventual consistency, missing auth gates on restricted routes, and destructive composite attribute overwrites

## Fixed

## Removed
