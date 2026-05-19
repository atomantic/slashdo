# Unreleased Changes

## Added

- **`--review-with copilot|codex|gemini|claude` flag on `do:pr` and `do:release`** (and pass-through in `do:pr-better`). Selects which agent performs the post-PR code review. `copilot` (default) preserves the existing Copilot cloud review loop; `codex`, `gemini`, and `claude` route to a new local-agent review loop in [`lib/local-agent-review-loop.md`](../lib/local-agent-review-loop.md). The local loop invokes the chosen CLI in **headless reckless mode** — `claude --dangerously-skip-permissions`, `codex exec -a never`, or `GEMINI_SANDBOX=false gemini --yolo` — captures output to a tempfile log, and runs unattended. Each invocation calls slashdo's installed `do:review` command directly (`/do:review` for claude and gemini, bare `do:review` for codex which uses skill namespacing), with a one-line override appended to switch commit messages to `address review: <summary>` and skip pushing. The orchestrating (main) agent then **verifies in-thread before pushing** — it inspects every new commit's diff for out-of-scope refactors, disabled tests, and secrets, runs the project build + tests, and only on a clean pass runs `git push`; any verification failure triggers `git reset --hard` back to the loop's baseline SHA and reports a non-clean status. Up to 3 iterations to catch recursive findings, then `guardrail`-stops. `do:release`'s merge gate now branches per agent: copilot keeps the "zero comments" rule, local-agent only merges on `STATUS=clean` (`guardrail` / `cli-error` / `broken-build` / `test-failed` / `rejected` block the merge in default mode).

## Changed

## Fixed

## Removed
