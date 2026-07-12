# Unreleased Changes

## Task planning
- **[issue-111] Enhance drafted issues before filing** — `/do:plan-task` gains a `--enhance-with <list>` flag that routes the drafted issue through a sequential pipeline of enhancement agents (`codex`, `claude`, `agy`, `grok`) before the approval gate, each sharpening the previous one's draft — a cheap second/third opinion for a more decision-complete issue. Grok is now a first-class enhancement agent.
