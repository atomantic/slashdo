# Unreleased Changes

## Added

- `--review-iterations <n>` flag to cap how many Copilot review-and-fix cycles run. Accepted by `do:pr`, `do:release`, `do:review`, `do:pr-better` (forwarded to `do:pr`), and the direct-loop audit commands `do:better`, `do:better-swift`, and `do:depfree`. `0` restores the legacy "loop until 0 comments" behavior (bounded by the 10-iteration safety guardrail); positive `n` runs at most `n` cycles, still exiting early on a zero-comment review.
- New Copilot loop terminal status `capped` — the configured iteration cap was reached after applying every fix the review surfaced. Treated as clean-equivalent for merge purposes (rolls up into the multi-reviewer wrapper's `OVERALL_STATUS=clean`).

## Changed

- **Default Copilot review behavior is now a single review-and-fix pass** (`--review-iterations` defaults to `1`) instead of looping until Copilot returns zero comments. Request one review, apply all its fixes, then stop. The unlimited-loop behavior remains available via `--review-iterations 0`. Affects `lib/copilot-review-loop.md`, `lib/multi-reviewer-loop.md`, and every command that runs the Copilot loop. The 10-iteration safety guardrail now applies only in unlimited mode.

## Fixed

## Removed
