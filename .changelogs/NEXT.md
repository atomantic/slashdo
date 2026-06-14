# Unreleased Changes

## Added

## Changed

- Review loops (`local-agent-review-loop`, `ollama-review-loop`): collapsed the `timeout`/`gtimeout`/none wrapper selection into a single deterministic one-liner folded into the pre-flight block, and added explicit "run it, don't narrate it" directives. Stops the reviewing agent from reasoning aloud about whether `timeout` is installed on macOS on every codex/ollama review.

## Fixed

## Removed
