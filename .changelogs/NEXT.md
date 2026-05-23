# Unreleased Changes

## Added

- **`--reviewer-applies` flag for `do:release`, `do:pr`, and `do:pr-better`.** Opt-in toggle that picks who applies fixes during the local-agent review loop (`--review-with codex|gemini|claude`). Default behavior changes: previously the local CLI (`gemini`/`claude`) ran slashdo's `/do:review` end-to-end — finding issues *and* applying fixes autonomously — while only the `codex` path routed findings back through the orchestrator. Now all three CLIs default to **review-only**: the orchestrating thread reads the CLI's findings log and applies fixes itself, keeping author and verifier in the same session. Pass `--reviewer-applies` to restore the prior "the reviewing CLI edits the working tree" behavior — useful when you specifically want gemini's or claude's *judgment* in the patch, not the orchestrator's interpretation of their findings. On the copilot path the flag is a no-op (Copilot reviews are read-only cloud-side comments) and emits a warning if passed. New "Editing mode" section in `lib/local-agent-review-loop.md` documents the trade-offs; the invocation table now branches by mode (claude/gemini swap prompt suffix, codex swaps between `codex review` for review-only and `codex exec -a never` for reviewer-applies).

## Changed

## Fixed

## Removed
