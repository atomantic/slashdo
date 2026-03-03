# PLAN: Teams → Sub-agents Refactor + Environment Compatibility

## Goal
Refactor `do:rpr` from team-based coordination (TeamCreate/SendMessage/TaskCreate) to
parallel sub-agents (Agent tool only). This makes it universally compatible across all
4 environments (Claude Code, OpenCode, Gemini CLI, Codex) without conditional logic.

Also add a `supportsTeams` capability flag to `src/environments.js` for future use by
`do:better` and other team-heavy commands.

## Changes

### 1. Refactor `commands/do/rpr.md` — Teams → Sub-agents [DONE]
- [x] Remove `TeamCreate`, `SendMessage`, `TaskCreate`, `TaskUpdate`, `TaskList` references
- [x] Replace step 4 (spawn a team) with parallel `Agent` sub-agent calls
- [x] Remove "Shut down the team after all work is complete" note
- [x] Keep the small-PR escape hatch ("for small PRs, sub-agents may be overkill")
- [x] Preserve all other behavior (GraphQL escaping, fork detection, copilot loop, thread resolution)

### 2. Add `supportsTeams` to `src/environments.js` [DONE]
- [x] `claude: supportsTeams: true`
- [x] `opencode: supportsTeams: false`
- [x] `gemini: supportsTeams: false`
- [x] `codex: supportsTeams: false`

### 3. Add tests for the new environment flag [DONE]
- [x] Update existing environment tests to cover `supportsTeams` (99/99 pass)

## Out of Scope (future work)
- Refactoring `do:better` (complex multi-phase team workflow, needs conditional blocks)
- Transformer-level `<!-- if:teams -->` conditional rendering
- Per-environment command variants
