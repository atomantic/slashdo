# Unreleased Changes

## Added
- Multi-agent review architecture: `/do:review` now dispatches 3 parallel agents (surface scan, security audit, cross-file tracing) instead of one monolithic reviewer
- New lib files: `review-surface-scan.md`, `review-security-audit.md`, `review-cross-file-tracing.md`
- New checklist items: hand-rolled format validators, subprocess output stream completeness, CSS overlay pointer-event conflicts, SSRF redirect/DNS rebinding vectors
- `/improve:review` now evaluates the full multi-agent architecture (agent balance, scope drift, coverage gaps) and can move items between agents

## Changed
- `commands/do/review.md` refactored from monolithic reviewer to orchestrator that dispatches and deduplicates across 3 focused agents
- `.claude/commands/improve/review.md` rewritten to update master checklist + all agent files + orchestrator
- `install.sh` LIBS array includes the 3 new review agent files

## Fixed

## Removed
