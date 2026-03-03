# Unreleased Changes

## Added

- Test suite with 97 tests using `node:test` (zero devDependencies) covering transformer, version-check, environments, installer, and CLI modules
- CI steps for `npm test` (Node 18+) and shellcheck validation of shell scripts

## Changed

- Refactored `/do:rpr` from team-based coordination (TeamCreate/SendMessage/TaskCreate) to parallel sub-agents for universal compatibility across all 4 environments
- Added `supportsTeams` capability flag to environment definitions (true for Claude Code only)
- Enhanced `/do:review` to require code flow analysis and software engineering principle evaluation (DRY, YAGNI, SOLID, SoC, naming) before per-file checklist
- Removed redundant instructions across push, fpr, pr, rpr, and better commands (duplicate co-author rules, duplicate Important sections, verbose model rationale)

## Fixed

- Copilot review loop now detects error responses ("Copilot encountered an error") and retries instead of treating them as clean reviews with zero comments
- Removed redundant "read CLAUDE.md" instructions from review, release, and better commands — project conventions are already in context

## Removed
