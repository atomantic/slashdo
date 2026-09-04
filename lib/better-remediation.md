## Phase 3: Worktree Remediation

Only proceed with CRITICAL, HIGH, and MEDIUM findings for code remediation. LOW findings remain tracked in PLAN.md but are not auto-remediated. Test Quality & Coverage findings are handled separately in Phase 4c.

### 3a: Setup

1. If `IS_DIRTY` is true: `git stash --include-untracked -m "better: pre-scan stash"`
2. Set `DATE` to today's date in YYYY-MM-DD format
3. Create the worktree:
   ```bash
   git worktree add ../better-{DATE} -b better/{DATE}
   ```
4. Set `WORKTREE_DIR` to `../better-{DATE}`

### 3b: Foundation Utilities

This phase is done by you (the orchestrator) directly — NOT delegated to agents — because all subsequent agents depend on these files existing and compiling.

1. Create each shared utility file identified in Phase 2's "Foundation" section
2. When extracting functions from an existing module, **add a backward-compatible re-export** in the original module:
   ```js
   // Re-export for backward compatibility (extracted to newModule.js)
   export { extractedFunction } from "./newModule.js";
   ```
   This prevents cross-PR import breakage when different PRs modify different files.
3. Run `{BUILD_CMD}` in the worktree to verify compilation:
   ```bash
   cd {WORKTREE_DIR} && {BUILD_CMD}
   ```
4. If build fails, fix issues before proceeding
5. Commit in the worktree:
   ```bash
   git -C {WORKTREE_DIR} add <specific files>
   git -C {WORKTREE_DIR} commit -m "refactor: add shared utilities for {purpose}"
   ```

If no shared utilities were identified, skip this step.

### 3c: Parallel Remediation

Remediation runs in parallel, one worker per category that has CRITICAL, HIGH, or MEDIUM findings. Possible categories (only act on those with actionable findings):
- Security & Secrets
- Code Quality & Style
- DRY & YAGNI
- Architecture & SOLID
- Bugs, Performance & Error Handling
- Stack-Specific
- Dependency Freedom
- UX Consistency & Responsive Layout _(UI projects only)_ — remediation must be conservative and verifiable: fix layout, markup, and CSS mechanics without redesigning. Above-the-fold fixes come first (reserve dimensions, fix LCP loading, unblock first paint). When consolidating one-off values to design tokens or shared components, change call sites mechanically and preserve rendered output — never change copy or visual design intent. If a finding requires a design decision (e.g., which of two button styles is canonical), pick the variant with the most call sites and note the choice in the commit message
- Structural Ambition _(strict mode only)_ — remediation worker must apply the specific reframing named in each finding (extract module, collapse condition chain, delete wrapper, move logic to canonical layer). Do NOT settle for "cleaner version of the same idea" — if the finding says "delete this branch by reframing X as Y," the fix must actually delete the branch. If a reframing turns out to be infeasible after investigation, leave the finding as-is and document why in the commit message rather than substituting a cosmetic change — and when `SIMPLIFY_ONLY=true`, also record the rejection per [gate 4](./better-simplify.md) so the next run doesn't re-propose it
- Cognitive Load & Readability _(simplify-only mode)_ — remediation worker applies the named transformation (extract, invert, rename, table-ize, early-return, split file) and nothing else. A rename must be applied at every call site in the same commit; an extraction must leave a backward-compatible re-export at the original path

**When `SIMPLIFY_ONLY=true`**, only `code-quality`, `dry`, `architecture`, `structural`, and `cognitive-load` have findings, so only those workers spawn — and every worker also gets the behavior-preservation rule verbatim from [Simplify-Only Mode](./better-simplify.md) appended to its instructions.

<!-- if:teams -->
1. Use `TeamCreate` with name `better-{DATE}`.
2. Use `TaskCreate` for each category above that has actionable findings.
3. Spawn up to 5 general-purpose agents as teammates. **Resolve `REMEDIATION_MODEL_TIER` to this host's model per [lib/model-tiers.md](./model-tiers.md) and pass it as the `model` parameter on each agent.** If `REMEDIATION_MODEL_TIER` is `heavy`, pass this host's strongest alias (`model: "opus"` on Claude Code). Each teammate marks its task complete via `TaskUpdate` when done.
<!-- else -->
1. Spawn up to 5 general-purpose `Agent` sub-agents — one per category above that has actionable findings. **Resolve `REMEDIATION_MODEL_TIER` to this host's model per [lib/model-tiers.md](./model-tiers.md) and pass it as the `model` parameter on each `Agent` call.** If `REMEDIATION_MODEL_TIER` is `heavy`, pass this host's strongest alias (`model: "opus"` on Claude Code).
2. Launch all `Agent` calls **in parallel** (multiple tool calls in a single response) and wait for all to return. Each sub-agent returns its results directly — no task board or shutdown step is needed.
<!-- /if:teams -->

**In issue mode the finding bodies are on disk, not in this context.** Phase 1 spooled
them and returned only index lines, so a `{FINDINGS}` block built from those lines alone
hands the worker a one-line title with no evidence and no suggested fix. Build `{FINDINGS}`
from each worker's index lines **plus the literal `SPOOL_DIR` path**, and instruct the
worker to read the full body for each of its ids out of `$SPOOL_DIR/<slug>.md`, where
`<slug>` is the category on **that id's own index line** — **Conflict avoidance** below
merges two categories' findings into one worker when they touch the same file, so such a
worker must open every spool file its ids name, not just the one matching its own category.
Read the bodies before fixing. "The orchestrator never rewrites a spooled body" keeps the bodies out of
*this* context — it does not license remediating from titles.

### Agent instructions template:

!read lib/remediation-agent-template.md

### Dependency Freedom agent — special instructions:
The Dependency Freedom remediation agent has a unique task: for each removable dependency, it must (1) write replacement code (utility function or inline native API call), (2) update ALL import/require statements across the codebase, (3) remove the package from the manifest, and (4) regenerate the lock file (`npm install` / `cargo update` / etc.). After all replacements, verify no source file still references the removed package. See `/do:depfree` Phase 3b for the full agent template.

### Conflict avoidance:
- Review all findings before task assignment. If two categories touch the same file, assign both sets of findings to the same agent.
- Security agent gets priority on validation logic; DRY agent gets priority on import consolidation.
- Dependency Freedom agent gets priority on files that are solely import/usage sites of a removed package.
