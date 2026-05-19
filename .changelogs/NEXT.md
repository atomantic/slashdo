# Unreleased Changes

## Added

- **`--review-with copilot|codex|gemini|claude` flag on `do:pr` and `do:release`** (and pass-through in `do:pr-better`). Selects which agent performs the post-PR code review. `copilot` (default) preserves the existing Copilot cloud review loop; `codex`, `gemini`, and `claude` route to a new local-agent review loop in [`lib/local-agent-review-loop.md`](../lib/local-agent-review-loop.md). The local loop invokes the chosen CLI in **headless reckless mode** — `claude --dangerously-skip-permissions`, `codex exec -a never`, or `GEMINI_SANDBOX=false gemini --yolo` — captures output to a tempfile log, and runs unattended. For `claude` and `gemini`, the invocation calls slashdo's installed `/do:review` command directly with a one-line override appended to switch commit messages to `address review: <summary>` and skip pushing. For `codex`, the loop uses codex's first-class **`codex review` subcommand** (rather than re-prompting through `codex exec`), so the review is authentically codex-flavored; if `codex review` exits without applying fixes, the orchestrating agent reads the review log and applies fixes itself before continuing. The orchestrating (main) agent then **verifies in-thread before pushing** — it inspects every new commit's diff for out-of-scope refactors, disabled tests, and secrets, runs the project build + tests, and only on a clean pass runs `git push`; any verification failure triggers `git reset --hard` back to the loop's baseline SHA and reports a non-clean status. Up to 3 iterations to catch recursive findings, then `guardrail`-stops. `do:release`'s merge gate now branches per agent: copilot keeps the "zero comments" rule, local-agent only merges on `STATUS=clean` (`guardrail` / `cli-error` / `broken-build` / `test-failed` / `rejected` block the merge in default mode).

## Changed

## Fixed

- **`install.sh` and `uninstall.sh` LIBS arrays** include `local-agent-review-loop` so the curl-bash install path (and local-mode `./install.sh`) actually delivers the new file to `~/.claude/lib/` and `~/.gemini/lib/`. Without this entry, `do:pr --review-with codex|gemini|claude` failed at the `!cat ~/.claude/lib/local-agent-review-loop.md` inclusion step with `No such file or directory`. Note: the `npx slash-do` installer is unaffected — it auto-discovers files in `lib/` via `collectLibFiles()`. Only the bash installer carries a hardcoded list.

## Removed
