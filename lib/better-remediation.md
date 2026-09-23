## Phase 3: Worktree Remediation

Only CRITICAL, HIGH, and MEDIUM findings are remediated. LOW findings are filed as issues, not auto-remediated. Test Quality & Coverage findings belong to Phase 4c.

### 3a: Setup

- If `IS_DIRTY` is true, stash first: `git stash --include-untracked -m "{BRANCH_PREFIX}: pre-scan stash"`.
- Reuse the `DATE` recorded in [0d](./better-discovery.md), suffix included — never recompute it here. The staging worktree is `WORKTREE_DIR=../{BRANCH_PREFIX}-{DATE}` on a new branch `{BRANCH_PREFIX}/{DATE}`.

### 3b: Foundation Utilities

Skip when Phase 2 identified no Foundation work. Otherwise you (the orchestrator), not an agent, create every Foundation utility before any worker spawns. On exit:
- Code extracted from an existing module leaves a backward-compatible re-export at its original location.
- `{BUILD_CMD}` passes in `{WORKTREE_DIR}`.
- The utilities are committed with only their specific files staged: `refactor: add shared utilities for {purpose}`.

### 3c: Parallel Remediation

One worker per actionable category in the caller's Phase 2 map, batched to the host's available slots (cap concurrency, not coverage). Resolve `REMEDIATION_MODEL_TIER` per the model-tier guidance and pass it as each agent's `model`. <!-- if:teams -->Use `TeamCreate` named `{BRANCH_PREFIX}-{DATE}` with one `TaskCreate` per category; each teammate marks its task complete via `TaskUpdate`.<!-- else -->Spawn them as parallel general-purpose `Agent` calls and wait for all to return.<!-- /if:teams -->

Category rules (a caller with a narrower roster supplies its own):
- Dependency Freedom — write the replacement, update every import, remove the package from the manifest, and regenerate the lock file; no source file may still reference it.
- UX — fix layout, markup, and CSS mechanics without redesigning, above-the-fold first; consolidation preserves rendered output, copy, and design intent. A needed design decision picks the variant with the most call sites, noted in the commit message.
- Structural Ambition — apply the specific reframing each finding names; a "cleaner version of the same idea" does not count. An infeasible reframing is left as-is with the reason in the commit message, never replaced by a cosmetic change.
- Cognitive Load — apply the named transformation and nothing else; a rename covers every call site in the same commit.

**Ownership:** every file has exactly one worker. When two categories touch the same file, one worker gets both sets of findings — Security takes validation logic, DRY takes import consolidation, and Dependency Freedom takes files that are solely import/usage sites of a removed package. Build `{FINDINGS}` from the spool per [lib/better-issue-mode.md](./better-issue-mode.md)'s Phase 3 rule.

Instantiate each worker from this template:

!read lib/remediation-agent-template.md
