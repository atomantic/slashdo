## Shared Pipeline Inputs

Phases 3–7 are shared with `/do:better-swift`. The shared partials read four caller values:

- `{BRANCH_PREFIX}` = `better` (staging branch `better/{DATE}`, category branches `better/{CATEGORY_SLUG}`)
- `{PIPELINE_TITLE}` = `Better Audit`
- `{REVIEW_CHECKLIST}` = `Review Preferences` (the section below)
- `{CATEGORY_SLUGS}` = `security`, `code-quality`, `dry`, `architecture`, `bugs-perf`, `stack-specific`, `deps`, `tests`, `ux` (UI projects only), `structural` (strict mode only), and `cognitive-load` (simplify-only mode). When `SIMPLIFY_ONLY=true`, only the [`SIMPLIFY_CATEGORIES`](./better-simplify.md) slugs exist.

### Review Preferences

The preferences Phase 4b reviews the remediation diff under:

!read lib/review-preferences.md

### Final Summary Table

Phase 7 prints a table with columns `Category | Findings | Fixed | Skipped | PR | CI | Review`: one row per Phase 2 category that ran, by short label, then a `TOTAL` row (`N PRs` in its PR column). Categories that shipped in one combined PR show the same PR number. Leave out the rows Phase 2 left out (UX, Structural, Cognitive Load by their conditions); when `SIMPLIFY_ONLY=true`, keep only the [`SIMPLIFY_CATEGORIES`](./better-simplify.md) rows and report every Test Enhancement stat as `— (skipped: --simplify-only)`.
