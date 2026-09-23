## Phase 3: Worktree Remediation

Only CRITICAL, HIGH, and MEDIUM findings are remediated. LOW findings stay tracked in PLAN.md (or the tracker) and are not auto-remediated. Test Quality & Coverage findings belong to Phase 4c.

### 3a: Setup

- If `IS_DIRTY` is true, stash first: `git stash --include-untracked -m "better: pre-scan stash"`.
- `DATE` is today (`YYYY-MM-DD`). The staging worktree is `WORKTREE_DIR=../better-{DATE}` on a new branch `better/{DATE}` (`git worktree add ../better-{DATE} -b better/{DATE}`).

### 3b: Foundation Utilities

Skip when Phase 2 identified no Foundation work. Otherwise you (the orchestrator), not an agent, create every shared utility from Phase 2's "Foundation" section before any worker spawns. On exit:
- Code extracted from an existing module leaves a backward-compatible re-export at its original location.
- `{BUILD_CMD}` passes in `{WORKTREE_DIR}`.
- The utilities are committed with only their specific files staged: `refactor: add shared utilities for {purpose}`.

### 3c: Parallel Remediation

One worker per category with CRITICAL, HIGH, or MEDIUM findings: Security & Secrets, Code Quality & Style, DRY & YAGNI, Architecture & SOLID, Bugs, Performance & Error Handling, Stack-Specific, and the categories below, which carry their own rules:
- Dependency Freedom — for each removable dependency: write the replacement (utility or native API call), update every import/require, remove the package from the manifest, and regenerate the lock file; no source file may still reference it. See `/do:depfree` Phase 3b for the full agent template.
- UX Consistency & Responsive Layout _(UI projects only)_ — conservative and verifiable: fix layout, markup, and CSS mechanics without redesigning. Above-the-fold fixes first (reserve dimensions, fix LCP loading, unblock first paint). Consolidating one-off values into design tokens or shared components changes call sites mechanically and preserves rendered output; never change copy or visual design intent. When a finding needs a design decision (e.g., which of two button styles is canonical), pick the variant with the most call sites and note the choice in the commit message.
- Structural Ambition _(strict mode only)_ — apply the specific reframing each finding names (extract module, collapse condition chain, delete wrapper, move logic to canonical layer); a "cleaner version of the same idea" does not count. If the finding says "delete this branch by reframing X as Y," the branch is deleted. A reframing that proves infeasible is left as-is with the reason in the commit message, never replaced by a cosmetic change — and when `SIMPLIFY_ONLY=true`, recorded as a rejection per [gate 4](./better-simplify.md).
- Cognitive Load & Readability _(simplify-only mode)_ — apply the named transformation (extract, invert, rename, table-ize, early-return, split file) and nothing else. A rename covers every call site in the same commit; an extraction leaves a backward-compatible re-export at the original path.

**When `SIMPLIFY_ONLY=true`**, only the `code-quality`, `dry`, `architecture`, `structural`, and `cognitive-load` workers spawn, and each also gets the behavior-preservation rule verbatim from [Simplify-Only Mode](./better-simplify.md).

**Ownership:** every file has exactly one worker. When two categories touch the same file, one worker gets both sets of findings — Security takes validation logic, DRY takes import consolidation, and Dependency Freedom takes files that are solely import/usage sites of a removed package.

<!-- if:teams -->
Use `TeamCreate` named `better-{DATE}` and one `TaskCreate` per category with actionable findings, then spawn up to 5 general-purpose teammates. **Resolve `REMEDIATION_MODEL_TIER` to this host's model per [lib/model-tiers.md](./model-tiers.md) and pass it as the `model` parameter on each agent** (`heavy` → this host's strongest alias, `model: "opus"` on Claude Code). Each teammate marks its task complete via `TaskUpdate`.
<!-- else -->
Spawn up to 5 general-purpose `Agent` sub-agents in parallel (multiple tool calls in one response), one per category with actionable findings, and wait for all to return. **Resolve `REMEDIATION_MODEL_TIER` to this host's model per [lib/model-tiers.md](./model-tiers.md) and pass it as the `model` parameter on each `Agent` call** (`heavy` → this host's strongest alias, `model: "opus"` on Claude Code).
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
