# Development Plan

For project mission, goals, and non-goals, see [GOALS.md](./GOALS.md).

## Backlog

- [ ] [autoupdate-concurrency] `hooks/slashdo-check-update.js` auto-update can fire from multiple concurrent Claude sessions at once, each spawning `npx slash-do@latest` against the same `~/.claude/`. Benign today (installer file writes are diff-based/idempotent and settings.json registration is already-registered-aware), but a lock/marker file would make it robust if install logic ever becomes non-idempotent.
