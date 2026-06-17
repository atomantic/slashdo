# Unreleased Changes

## Added

- **`--review-mode <series|parallel>` for the multi-reviewer review loop (default `series`).** When `--review-with` lists more than one reviewer, they now run **in series by default** — each reviewer runs to completion (review → fix → verify → push) before the next starts, so a later reviewer reviews against the earlier ones' committed fixes and can catch problems a fix introduced. This makes the reviewer list's order meaningful (put the highest-signal reviewer first) and is why series is the default. The opt-in `parallel` mode runs every reviewer's review concurrently against one frozen baseline and then applies the deduped union of findings in a single pass — faster, but no reviewer sees another's fixes (and `--reviewer-applies` / the stop-modes are ignored, since concurrent reviewers can't share a working tree and there's no first-finisher to stop on). Available on `/do:pr`, `/do:review`, `/do:better`, `/do:better-swift`, `/do:depfree`, and `/do:release` (and forwarded by `/do:next` and `/do:pr-better`); settable as a saved default via `/do:config --review-mode <series|parallel>`. `/do:rpr` is unaffected (its parallelism is review-thread resolution, not reviewer dispatch).

## Changed

## Fixed

## Removed
