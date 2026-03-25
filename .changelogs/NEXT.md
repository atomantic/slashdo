# Unreleased Changes

## Added

- All commands now support `--interactive` flag to opt into user prompts and approval checkpoints

## Changed

- **BREAKING**: All commands are now non-interactive by default — they run fully autonomously without user prompts
  - `do:better`: uses Balanced model profile automatically, auto-merges PRs with clean reviews, auto-stops at guardrails
  - `do:better-swift`: same autonomous behavior as `do:better`, optimized for Swift
  - `do:goals`: generates GOALS.md from codebase scan without user clarification; LOW confidence goals marked as `(inferred)`
  - `do:release`: auto-detects branches, auto-determines version bump from commits, proceeds through review and merge
  - `do:replan`: archives done items, removes stale items, adds suggested items without prompting
  - `do:rpr`: auto-skips on Copilot review timeout/errors after retries instead of prompting
- `do:rpr`: added thread-count tracking — reports total unresolved threads upfront, tracks resolution progress, and includes final "Resolved X/Y" summary with reasons for any unaddressed threads
- `do:rpr`, `do:review`, copilot review loop: review agents now fix real issues found in code regardless of whether the current PR modified that code — no more "out of scope" dismissals
- `improve:review`: 7 new checklist items (SSRF, push event scoping, cache scope, validation-runtime conflation, file writes without dir, invariant flag relationships, boolean serialization round-trip), 6 broadened items, and 9 new deep checks in review process

## Fixed

## Removed
