# Structural Ambition _(strict mode only — dispatch only when `STRICT_MODE=true`, otherwise skip)_
Read the structural lens before auditing this scope:

!read lib/review-structural-ambition.md

   Focus: missed code-judo simplifications (reframings that delete whole branches/modes/helpers), file-size growth past 1000 lines, ad-hoc conditionals bolted onto unrelated flows, thin wrappers / identity abstractions, boundary leaks (feature logic in shared modules), bespoke duplicates of canonical helpers, cast-heavy / `any`-heavy / optional-soup contracts, sequential orchestration where the parallel/atomic shape is obviously cleaner.
   Report findings using the standard severity format. The skill file's presumptive blockers (file pushed past 1000 lines, spaghetti growth in existing code, thin wrappers, boundary leaks, canonical-helper duplication) must be marked `[CRITICAL]` so Phase 2 picks them up for remediation. Every finding must name a concrete suggested reframing — drop findings that only say "could be cleaner" without a path. Tag this agent's category as `structural` for Phase 2 ownership mapping.
