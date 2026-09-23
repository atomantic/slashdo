## Phase 4c: Test Enhancement

**GATE: If `SIMPLIFY_ONLY=true`, SKIP this entire phase** per the simplify contract and proceed to Phase 5.

After Phase 4b, act on the test-audit findings and cover the Phase 3 remediation with tests.

1. Before any test commit, record `PHASE_4C_START_SHA` (`git -C {WORKTREE_DIR} rev-parse HEAD`).
2. Triage the test-audit findings by tag, in priority order `[VACUOUS]`, `[WEAK]`, `[MISSING]` from the spooled bodies per [lib/better-issue-mode.md](./better-issue-mode.md) — the index carries no tag. List every Phase 3 remediated file whose changed behavior no existing test covers as `{REMEDIATED_FILES_WITHOUT_TESTS}`.
3. Spawn one general-purpose agent (using `REMEDIATION_MODEL_TIER`) in the worktree:

```
You are a test enhancement agent working in {WORKTREE_DIR}.
Project type: {PROJECT_TYPE}. Test command: {TEST_CMD}.

Fix these vacuous/weak tests:
{VACUOUS_AND_WEAK_FINDINGS}

Write tests for these gaps:
{MISSING_FINDINGS}

Write tests for these remediated files:
{REMEDIATED_FILES_WITHOUT_TESTS}

Every new test must fail against a temporarily broken implementation of the
behavior it covers (e.g. return a constant, flip a conditional). Restore the
code immediately; the break is never committed. {TEST_CMD} must pass, then
commit only test files as `test: {description of what's tested}`. Report the
counts of vacuous tests fixed, weak tests strengthened, new test cases, and
new test files.
```

On exit from this phase:
- `{TEST_CMD}` passes in `{WORKTREE_DIR}` (fix any failure in a new commit).
- `VACUOUS_TESTS_FIXED`, `WEAK_TESTS_STRENGTHENED`, `NEW_TEST_CASES`, and `NEW_TEST_FILES` are recorded.
- **`FILE_OWNER_MAP` is updated** for every file in `git diff --name-only "$PHASE_4C_START_SHA"..HEAD`: a file not already in the map is assigned to `tests`; a file already owned by another category stays there, so co-located test changes ship with the code they test.
