# Release NEXT

Released: YYYY-MM-DD

## Highlights
- **Grok Build support.** slashdo now installs into xAI's Grok Build CLI (`grok`). It's detected automatically when `~/.grok` exists, or target it explicitly with `npx slash-do@latest --env grok`.

## Added
- **`grok` environment** — installs commands as Agent Skills under `~/.grok/skills/<do-cmd>/SKILL.md`, the same SKILL.md-per-directory format used for Codex and the Antigravity CLI (Grok Build auto-loads skills from that directory). Like those environments, install requires Node.js (`npx slash-do@latest --env grok`) because lib content is inlined into each skill; the curl installer detects Grok Build and points users at the npx command. The config-path token is rewritten to `~/.grok/.slashdo-config.json` so `/do:config` defaults resolve correctly.

## Full Changelog
**Full Diff**: https://github.com/atomantic/slashdo/compare/v3.21.1...NEXT
