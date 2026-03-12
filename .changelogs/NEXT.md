# Unreleased Changes

## Added

- Entity type-change validation: checklist item + review deep check for invariant revalidation on discriminator changes
- Data migration semantic preservation: checklist item + review deep check for schedule/state/trigger fidelity
- Checklist: caller/callee resolve/reject contract disagreement and async EventEmitter handlers
- Checklist: interactive prompts blocking non-interactive/CI contexts (TTY detection)
- Checklist: security/sanitization functions covering only one input format
- Checklist: unbounded subprocess output buffering, naive command string splitting, lazy-migration concurrency
- Checklist: broadened imports check to include non-existent framework utility classes (CSS, directives, component props)
- Checklist: broadened coupled-state check to cover `useState(prop)` going stale on async prop updates
- Checklist: broadened serialization boundary check for datetime timezone mixing (UTC strings vs local-time Date methods)
- Checklist: prototype pollution via Object.assign/spread of user-controlled objects
- Checklist: broadened missing-value semantics to cover sanitization-null-as-clear ambiguity
- Review process: bulk vs single-item operation parity deep check
- Review process: config value provenance for auto-upgrade deep check
- Checklist: self-rescheduling callback error resilience (one-shot timers permanently stopped by unhandled errors)
- Checklist: periodic operation skip must advance timing state (gated jobs re-triggering in tight loops)
- Checklist: shallow config merge dropping new default keys on upgrade
- Checklist: update endpoint field allowlists silently dropping new model fields
- Checklist: one-time migration idempotency guards (re-execution on every startup)
- Checklist: broadened object spread guard to cover non-object types (string/array spread corruption)
- Checklist: broadened validation/write-path trace to cover normalization invariants (raw persist paths)
- Checklist: broadened optimistic update rollback item to include duplicate-on-append prevention
- Checklist: broadened caller/callee semantics disagreement to cover decision/evaluation contracts (gate skip semantics)
- Review process: raw/bypass write path normalization audit deep check
- Review process: self-rescheduling callback resilience deep check
- Review process: periodic operation skip behavior deep check
- Review process: migration/initialization idempotency deep check

## Changed

- `do:review` now only posts PR comments when the PR was opened by someone other than the current user

## Fixed

## Removed
