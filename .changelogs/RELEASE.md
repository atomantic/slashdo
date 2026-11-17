# Release v4.5.0

Released: 2026-11-16

## Highlights

- **`/do:next --swarm` protects issues you named.** When an explicit `--swarm` list is larger than the concurrency cap and runs in waves, issues in wave 2 or later are now reserved (labeled in-progress) as soon as they pass vetting. A second `/do:next` run or a scheduled agent can no longer claim an issue you named while earlier waves are still shipping.

## Changed

- The worker for a reserved later-wave member runs the ownership gate with `CLAIM_RESERVED=1`, which accepts that one in-progress label and still refuses an assignee, an existing branch, an open PR, or a failed read.
- Reservations that go unused are released when the swarm run reconciles.

## Full Changelog

**Full Diff**: https://github.com/atomantic/slashdo/compare/v4.4.0...v4.5.0
