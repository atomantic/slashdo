# Unreleased Changes

## Added

- `do:replan` now performs drift detection: a new agent checks each still-pending PLAN.md item against recent commits to flag cases where executing the item as written would remove or regress a feature added since the item appeared. Drifted items are never auto-modified — autonomous mode annotates them with a `> ⚠️ DRIFT:` blockquote (collision + commit SHA) and surfaces them in the summary; `--interactive` mode walks each one individually with three explicit human choices: **replan** (drafts a rewrite for approval), **examine** (leaves annotated), or **delete**.

## Changed

- `do:rpr` now uses a single persistent `Monitor` for the entire session — one stream that emits an event for each new Copilot review AND each CI bucket transition. Previously the skill implicitly encouraged spawning a fresh background poll per review loop iteration, which produced 5+ active subshell tasks across a multi-round PR. The "CI Health Check During Review Polling" section is collapsed into a tighter "CI failure handling" section since the monitor surfaces failures as events without a separate poll.

## Fixed

## Removed
