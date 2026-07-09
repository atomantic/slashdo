# Release NEXT

Released: YYYY-MM-DD

## Highlights
- **Grok Build support.** slashdo now installs into xAI's Grok Build CLI (`grok`). It's detected automatically when `~/.grok` exists, or target it explicitly with `npx slash-do@latest --env grok`.

## Added
- **`grok` environment** — installs commands as Agent Skills under `~/.grok/skills/<do-cmd>/SKILL.md`, the same SKILL.md-per-directory format used for Codex and the Antigravity CLI (Grok Build auto-loads skills from that directory). Like those environments, install requires Node.js (`npx slash-do@latest --env grok`) because lib content is inlined into each skill; the curl installer detects Grok Build and points users at the npx command. The config-path token is rewritten to `~/.grok/.slashdo-config.json` so `/do:config` defaults resolve correctly.

## Fixed
- **Curl uninstaller now cleans up directory-namespaced Agent Skills environments.** `uninstall.sh` gained a shared helper that removes `~/.<env>/skills/do-<cmd>/` skill directories plus the env's `.slashdo-version` / `.slashdo-config.json`, wired up for both **Grok Build** (`~/.grok`) and **Codex** (`~/.codex`). Previously the curl uninstall path detected and cleaned only Claude Code, OpenCode, and Antigravity — a Codex user (and now a Grok Build user) following the documented `uninstall.sh` route was left with orphaned skill files. The npm uninstaller (`npx slash-do@latest --uninstall`) already handled these envs; this brings the curl path to parity.

## Full Changelog
**Full Diff**: https://github.com/atomantic/slashdo/compare/v3.21.1...NEXT
