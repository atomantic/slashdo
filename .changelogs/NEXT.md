# Unreleased Changes

## Added

## Changed

- Copilot review loop now delegates to sub-agents to prevent context exhaustion on long review cycles
- Review wait timeouts decrease per iteration: 5min → 4min → 3min → 2min → 1min
- Poll interval reduced from 60s to 30s for faster review detection
- `do:better` Phase 6 launches parallel sub-agents (one per PR) for concurrent review loops

## Fixed

## Removed
