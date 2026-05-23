# Unreleased Changes

## Added

- **Comma-separated `--review-with` lists across `do:pr`, `do:release`, `do:pr-better`, and `do:review`.** Pass an ordered list of reviewers (e.g. `--review-with codex,gemini,copilot`) and each runs in sequence, with the next pass reviewing the branch as the previous left it. Single-agent invocations still work — they become a list of one.
- **`--review-stop-on-findings` / `--review-stop-on-clean` flags** to gate the multi-reviewer loop. Default behavior remains "always run every listed reviewer in order"; the new flags short-circuit on the first reviewer that fixes something / reports clean, respectively. Mutually exclusive.
- **`--review-with` support on `/do:review`.** Previously only `do:pr` / `do:release` / `do:pr-better` accepted it. On `do:review` the listed agents run *after* the host CLI's existing self-review (the multi-agent flow), adding additional perspectives. The host CLI is no longer assumed to be claude — `do:review` may be hosted by claude, codex, or gemini, and any of `claude,codex,gemini,copilot` can be named in the delegation list.
- New `lib/multi-reviewer-loop.md` library file orchestrating the sequential reviewer dispatch, stop-mode decisions, and aggregate status reporting (`clean` / `partial` / `dirty`). Registered in both `install.sh` and `uninstall.sh` allowlists.

## Changed

- `do:release` merge gate now consumes the multi-reviewer aggregate `{OVERALL_STATUS}` plus per-agent checks (copilot review-submitted confirmation, local-agent clean-iteration confirmation). A `dirty` status from any executed pass blocks the merge in default mode and prompts in `--interactive`.
- README "Review loop flags" section rewritten to cover all four commands and the new flag set.

## Fixed

## Removed
