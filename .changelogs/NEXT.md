# Unreleased Changes

## Added

## Changed

## Fixed

- `/do:update` now refreshes `~/.claude/cache/slashdo-update-check.json` immediately after writing the new `.slashdo-version`, so the `⬆ /do:update` statusline badge clears right after running the update. Previously the cache stayed stale until the next session's background `npm view` finished, causing the badge to persist through the current session and reappear once on the following TUI restart.

## Removed
