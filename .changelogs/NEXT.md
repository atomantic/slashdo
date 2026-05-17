# Unreleased Changes

## Added

- `do:replan` now performs drift detection: a new agent checks each still-pending PLAN.md item against recent commits to flag cases where executing the item as written would remove or regress a feature added since the item appeared. Drifted items are never auto-modified — autonomous mode annotates them with a `> ⚠️ DRIFT:` blockquote (collision + commit SHA) and surfaces them in the summary; `--interactive` mode walks each one individually with three explicit human choices: **replan** (drafts a rewrite for approval), **examine** (leaves annotated), or **delete**.

## Changed

## Fixed

## Removed
