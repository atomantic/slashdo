## Compaction Guidance

When compacting during this workflow, always preserve:
- The `FILE_OWNER_MAP` (complete, not summarized)
- All CRITICAL/HIGH findings with file:line references
- The current phase number and what phases remain
- All PR numbers and URLs created so far
- `BUILD_CMD`, `TEST_CMD`, `PROJECT_TYPE`, `WORKTREE_DIR`, `REPO_DIR` values
- `VCS_HOST`, `CLI_TOOL`, `GH_HOST`, `DEFAULT_BRANCH`, `CURRENT_BRANCH`
- `STRICT_MODE` (true/false — determines whether the Structural Ambition agent runs and whether structural findings are promoted to CRITICAL)
- `SIMPLIFY_ONLY` (true/false — determines the narrowed audit roster, the five-category set, the behavior-preservation contract, and the Phase 4c skip)
- `HOT_FILES` and `PRIOR_REJECTIONS` when `SIMPLIFY_ONLY=true` (the churn ranking and do-not-re-propose list — both feed the finding gates and are expensive to re-derive)
- `HAS_UI` (true/false — determines whether the UX Consistency & Responsive Layout agent runs and whether the `ux` category exists downstream)
- `PHASE_4C_START_SHA` (needed for FILE_OWNER_MAP update in Phase 4c.3)
- `VACUOUS_TESTS_FIXED`, `WEAK_TESTS_STRENGTHENED`, `NEW_TEST_CASES`, `NEW_TEST_FILES`
- `SPOOL_DIR` (issue mode only — the literal spool path Phase 1 created; it cannot be re-derived, and the bodies are read four times: Phase 2 step 3's Foundation grouping, the Phase 2 filer agents, the Phase 3c remediation workers, and the Phase 4c.1 triage — so it outlives filing and is removed in Phase 7, not before)
- `CREATED_CATEGORY_SLUGS` (list of branch slugs created in Phase 5)
