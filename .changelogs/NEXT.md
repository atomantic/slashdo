# Unreleased Changes

## Added

- Test suite with 97 tests using `node:test` (zero devDependencies) covering transformer, version-check, environments, installer, and CLI modules
- CI steps for `npm test` (Node 18+) and shellcheck validation of shell scripts

## Changed

- Enhanced `/do:review` to require code flow analysis and software engineering principle evaluation (DRY, YAGNI, SOLID, SoC, naming) before per-file checklist

## Fixed

- Removed redundant "read CLAUDE.md" instructions from review, release, and better commands — project conventions are already in context

## Removed
