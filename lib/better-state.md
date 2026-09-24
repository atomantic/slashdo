## Run State

Preserve across compaction, complete and unsummarized:
- The current phase and the phases that remain
- `FILE_OWNER_MAP` (complete)
- All CRITICAL/HIGH findings with file:line references, and every finding's disposition
- Flags and saved defaults as resolved: `STRICT_MODE`, `SIMPLIFY_ONLY`, `HAS_UI`, `REVIEW_AGENTS` and the other review settings, `--interactive`, `--no-merge`
- `HOT_FILES` and `PRIOR_REJECTIONS` (when `SIMPLIFY_ONLY=true`)
- `REPO_DIR`, `WORKTREE_DIR`, `DATE`, whether Phase 3a stashed
- `VCS_HOST`, `CLI_TOOL`, `GH_HOST`, `TRACKER_AVAILABLE`, `DEFAULT_BRANCH`, `CURRENT_BRANCH`
- `PROJECT_TYPE`, `BUILD_CMD`, `TEST_CMD`, `AUDIT_MODEL_TIER`, `REMEDIATION_MODEL_TIER`
- Caller-specific discovery values when present: `PLATFORMS`, `DEPLOYMENT_TARGETS`, `BUILD_SYSTEM`, `SCHEME`, `WORKSPACE_OR_PROJECT`, `GOTCHA_ENTRIES_IN_SCOPE`, and per-platform command variables
- `PHASE_4C_START_SHA`, `VACUOUS_TESTS_FIXED`, `WEAK_TESTS_STRENGTHENED`, `NEW_TEST_CASES`, `NEW_TEST_FILES`
- `SPOOL_DIR` (the literal spool path; it cannot be re-derived, and the bodies are read four times (Phase 2 Foundation grouping, Phase 2 filers, Phase 3c workers, Phase 4c triage), so it is removed in Phase 7, not before)
- `CREATED_CATEGORY_SLUGS`, and every PR's number, URL, pushed HEAD, CI result, and review status
