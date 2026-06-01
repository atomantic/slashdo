# Unreleased Changes

## Added

## Changed

## Fixed

- **Local-agent review loop: documented that `agy`/`claude` reviewers take the prompt as an argument, never via stdin.** Added an explicit guardrail to `lib/local-agent-review-loop.md` so the orchestrator passes `"$LOCAL_PROMPT"` as the positional argument to `-p` and never pipes it (`echo … | agy -p`, `agy -p < file`). Piping makes `agy` exit with `agy --print takes the prompt as an argument, not stdin`, which previously forced a wasted second invocation. The `> "$LOG_FILE"` redirect captures the reviewer's output and is unrelated to how the prompt goes in.

## Removed
