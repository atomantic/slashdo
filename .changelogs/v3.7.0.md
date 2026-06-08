# Unreleased Changes

## Added

- Opt-in **auto-update**: on install, slashdo asks whether to auto-update when a new version is detected (default: yes, Claude Code only). When enabled, the SessionStart update-check hook silently runs `npx slash-do@latest` on detecting a newer version instead of just showing the `⬆ /do:update` statusline hint; on failure it falls back to the hint. The preference is stored in `~/.claude/.slashdo-config.json`. New `--auto-update` / `--no-auto-update` flags set the choice without prompting, and existing installs from before this feature are asked on their next run. (new `src/config.js`)

## Changed

## Fixed

## Removed
