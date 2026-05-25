# Development Plan

For project mission, goals, and non-goals, see [GOALS.md](./GOALS.md).

## Backlog

- [ ] [consume-supportsteams-in-do-better] **Consume `supportsTeams` in `do:better`.** The flag is defined in `src/environments.js` and covered by tests, but nothing reads it. Gate the `TeamCreate` audit phase in `commands/do/better.md` on `supportsTeams`, falling back to the parallel sub-agent pattern (already used by `do:rpr`) when `false`, so `do:better` works in OpenCode/Gemini/Codex.

## Future / Ideas

- Transformer-level `<!-- if:teams -->` conditional rendering — let a single command source emit team-based vs sub-agent variants per environment (the mechanism that would back the `do:better` gating above).
- Per-environment command variants.
