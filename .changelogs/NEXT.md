# Unreleased Changes

## Added

- **`--strict` / `--nuclear` flag for `do:review`, `do:better`, and `do:pr-better`.** Opt-in structural-ambition lens that looks for "code judo" simplifications the existing runtime/security/contract agents miss. Adds a 6th agent to `do:review` and a 9th agent to `do:better` (Test Quality stays at #8 so existing references don't shift). Flags presumptive blockers: file pushed past 1000 lines, new ad-hoc conditional bolted onto an unrelated flow, thin wrappers / identity abstractions, feature logic leaking into shared modules, bespoke duplicates of canonical helpers, and cast-heavy / `any`-heavy boundaries. In `do:better`, blocker-tier findings are promoted to CRITICAL and remediated under a new `structural` PR category. New `lib/review-structural-ambition.md` defines the agent prompt with concrete review phrasing; new "Structural ambition" subsection in `lib/code-review-checklist.md` flows the same lens into `do:better` Phase 4b internal review and `do:pr` review gates.

## Changed

## Fixed

## Removed
