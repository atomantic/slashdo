# Unreleased Changes

## Added

## Changed

- `do:rpr`: added thread-count tracking — reports total unresolved threads upfront, tracks resolution progress, and includes final "Resolved X/Y" summary with reasons for any unaddressed threads
- `do:rpr`, `do:review`, copilot review loop: review agents now fix real issues found in code regardless of whether the current PR modified that code — no more "out of scope" dismissals
- `improve:review`: 7 new checklist items (SSRF, push event scoping, cache scope, validation-runtime conflation, file writes without dir, invariant flag relationships, boolean serialization round-trip), 6 broadened items, and 9 new deep checks in review process

## Fixed

## Removed
