---
description: Scan codebase to infer product requirements and generate a detailed PRD.md (default: fully autonomous; use --interactive to review with user)
argument-hint: "[--interactive] [--refresh] [focus hint, e.g. 'just the CLI']"
---

# PRD — Generate a PRD.md from Codebase Analysis

Shorthand for `/do:goals --prd`: scan the codebase and generate a detailed `PRD.md` (Product Requirements Document) instead of the strategic `GOALS.md` — functional and non-functional requirements, explicit exclusions, and acceptance criteria.

## Execution

Run the workflow defined in `~/.claude/commands/do/goals.md` **verbatim**, with `--prd` forced on — whether or not it appears in `$ARGUMENTS`. Its [PRD.md Structure](goals.md#prdmd-structure---prd) section and every other `--prd`-mode deviation (Discovery's Agent 4, Synthesis, Validation 3g-3j, Refresh Mode) is the specification. This command adds none of its own.

Argument handling:
- Pass `$ARGUMENTS` through to `do:goals` verbatim, with `--prd` added if not already present. It parses every flag itself, including `--interactive`, `--refresh`, and focus hints — there is nothing to extract or re-validate here.
- `--prd` in `$ARGUMENTS` is redundant but harmless — do not error on it.

## Notes

- See `/do:goals` for the full specification, including the GOALS.md vs PRD.md vs PLAN.md boundary rules.
