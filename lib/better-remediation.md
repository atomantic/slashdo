## Phase 3: Worktree Remediation

Only CRITICAL, HIGH, and MEDIUM findings are remediated. LOW findings stay tracked in PLAN.md (or the tracker) and are not auto-remediated. Test Quality & Coverage findings belong to Phase 4c.

### Inputs

The caller resolves `{BRANCH_PREFIX}`, `{PIPELINE_LABEL}`, `{CATEGORY_SLUGS}`, `{BUILD_CMD}`, `{WORKTREE_DIR}`, and the shared run state before Phase 3.

### 3a: Setup

- If `IS_DIRTY` is true, stash first: `git stash --include-untracked -m "{BRANCH_PREFIX}: pre-scan stash"`.
- Use the `DATE` already recorded in [0d](./better-discovery.md) (today's date, plus any suffix 0d added to keep it unique against `git worktree list`) — do not recompute or reset it here, or a second run on the same day collides with the worktree/branch 0d already resolved. The staging worktree is `WORKTREE_DIR=../{BRANCH_PREFIX}-{DATE}` on a new branch `{BRANCH_PREFIX}/{DATE}` (`git worktree add ../{BRANCH_PREFIX}-{DATE} -b {BRANCH_PREFIX}/{DATE}`).

### 3b: Foundation Utilities

Skip when Phase 2 identified no Foundation work. Otherwise you (the orchestrator), not an agent, create every shared utility from Phase 2's "Foundation" section before any worker spawns. On exit:
- Code extracted from an existing module leaves a backward-compatible re-export at its original location.
- `{BUILD_CMD}` passes in `{WORKTREE_DIR}`.
- The utilities are committed with only their specific files staged: `refactor: add shared utilities for {purpose}`.

### 3c: Parallel Remediation

One worker per actionable category in the caller's Phase 2 map, using the caller's `{CATEGORY_SLUGS}`. The generic pipeline's categories carry the rules below; a caller with a narrower roster supplies its own category-specific rules without adding categories it did not select:
- Dependency Freedom — for each removable dependency: write the replacement (utility or native API call), update every import/require, remove the package from the manifest, and regenerate the lock file; no source file may still reference it.
- UX Consistency & Responsive Layout _(UI projects only)_ — conservative and verifiable: fix layout, markup, and CSS mechanics without redesigning. Above-the-fold fixes first (reserve dimensions, fix LCP loading, unblock first paint). Consolidating one-off values into design tokens or shared components changes call sites mechanically and preserves rendered output; never change copy or visual design intent. When a finding needs a design decision (e.g., which of two button styles is canonical), pick the variant with the most call sites and note the choice in the commit message.
- Structural Ambition _(strict mode only)_ — apply the specific reframing each finding names (extract module, collapse condition chain, delete wrapper, move logic to canonical layer); a "cleaner version of the same idea" does not count. If the finding says "delete this branch by reframing X as Y," the branch is deleted. A reframing that proves infeasible is left as-is with the reason in the commit message, never replaced by a cosmetic change — and when `SIMPLIFY_ONLY=true`, recorded as a rejection per [gate 4](./better-simplify.md).
- Cognitive Load & Readability _(simplify-only mode)_ — apply the named transformation (extract, invert, rename, table-ize, early-return, split file) and nothing else. A rename covers every call site in the same commit; an extraction leaves a backward-compatible re-export at the original path.

**When `SIMPLIFY_ONLY=true`**, only the `code-quality`, `dry`, `architecture`, `structural`, and `cognitive-load` workers spawn, and each also gets the behavior-preservation rule verbatim from [Simplify-Only Mode](./better-simplify.md).

**Ownership:** every file has exactly one worker. When two categories touch the same file, one worker gets both sets of findings — Security takes validation logic, DRY takes import consolidation, and Dependency Freedom takes files that are solely import/usage sites of a removed package.

<!-- if:teams -->
Use `TeamCreate` named `{BRANCH_PREFIX}-{DATE}` and one `TaskCreate` per actionable category, then spawn one teammate per category, batched to the host's available slots (do not infer an arbitrary subset to save tokens — cap concurrency, not coverage, matching the Phase 1 audit fan-out). **Resolve `REMEDIATION_MODEL_TIER` to this host's model per [lib/model-tiers.md](./model-tiers.md) and pass it as the `model` parameter on each agent** (`heavy` → this host's strongest alias, `model: "opus"` on Claude Code). Each teammate marks its task complete via `TaskUpdate`.
<!-- else -->
Spawn one general-purpose `Agent` sub-agent per category with actionable findings, in parallel (multiple tool calls in one response) batched to the host's available slots, and wait for all to return. **Resolve `REMEDIATION_MODEL_TIER` to this host's model per [lib/model-tiers.md](./model-tiers.md) and pass it as the `model` parameter on each `Agent` call** (`heavy` → this host's strongest alias, `model: "opus"` on Claude Code).
<!-- /if:teams -->

**In issue mode the finding bodies are on disk, not in this context.** Build `{FINDINGS}`
from each worker's index lines **plus the literal `SPOOL_DIR` path**, and instruct the
worker to read the full body for each of its ids out of `$SPOOL_DIR/<slug>.md`, where
`<slug>` is the category on **that id's own index line** — the ownership rule above
merges two categories' findings into one worker when they touch the same file, so such a
worker must open every spool file its ids name, not just the one matching its own category.
See [lib/better-issue-mode.md](./better-issue-mode.md) for the full contract.

### Agent instructions template:

!read lib/remediation-agent-template.md
