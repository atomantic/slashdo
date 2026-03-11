# Unreleased Changes

## Added

- Checklist: entity type-change invariant revalidation and stale field cleanup
- Checklist: data migration semantic preservation (schedule, enabled state, trigger behavior)
- Checklist: caller/callee resolve/reject contract disagreement and async EventEmitter handlers
- Checklist: interactive prompts blocking non-interactive/CI contexts (TTY detection)
- Checklist: security/sanitization functions covering only one input format
- Checklist: unbounded subprocess output buffering
- Checklist: naive whitespace splitting of command strings breaking quoted args
- Checklist: read-only API paths triggering lazy migration writes without concurrency protection
- Review process: type-discriminated entity validation deep check
- Review process: data migration semantic preservation deep check

## Changed

- `do:review` now only posts PR comments when the PR was opened by someone other than the current user

## Fixed

## Removed
