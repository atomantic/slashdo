## Phase 4c: Test Enhancement

**GATE: If `SIMPLIFY_ONLY=true`, SKIP this entire phase** (including 4c.3's `FILE_OWNER_MAP` update — the Phase 2 map is final). Report all four test-enhancement stats as `— (skipped: --simplify-only)` in the Phase 7 summary and proceed to Phase 5.

After Phase 4b, act on the test-audit findings and cover the Phase 3 remediation with tests.

### 4c.0: Record Start SHA

Before any test commit: `PHASE_4C_START_SHA="$(git -C {WORKTREE_DIR} rev-parse HEAD)"`.

### 4c.1: Test Audit Triage

**In issue mode the test-audit findings are on disk, not in this context.** The index
(`<id> | <SEVERITY> | <category> | <file:line> | <title>`) carries no
`[VACUOUS]`/`[WEAK]`/`[MISSING]` tag at all — triaging off it is not merely lossy, it
is impossible. Read `$SPOOL_DIR/tests.md` (the literal path from run state) and triage
off each finding's full body, populating `{VACUOUS_AND_WEAK_FINDINGS}` /
`{MISSING_FINDINGS}` from those bodies, never from the index titles. See
[lib/better-issue-mode.md](./better-issue-mode.md) for the full contract.

Sort the test-audit findings by tag, in priority order: `[VACUOUS]` (tests that assert nothing real), `[WEAK]` (missing important cases), `[MISSING]` (critical paths with no tests). Then list every file Phase 3 remediated whose changed behavior no existing test covers as `{REMEDIATED_FILES_WITHOUT_TESTS}`.

### 4c.2: Test Enhancement Execution

Spawn one general-purpose agent (using `REMEDIATION_MODEL_TIER`) in the worktree:

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

### 4c.3: Verification

On exit from this phase:
- `{TEST_CMD}` passes in `{WORKTREE_DIR}` (fix any failure in a new commit).
- `VACUOUS_TESTS_FIXED`, `WEAK_TESTS_STRENGTHENED`, `NEW_TEST_CASES`, and `NEW_TEST_FILES` are recorded.
- **`FILE_OWNER_MAP` is updated** for every file in `git diff --name-only "$PHASE_4C_START_SHA"..HEAD`: a file not already in the map is assigned to `tests`; a file already owned by another category stays there, so co-located test changes ship with the code they test and the `tests` branch holds only standalone test files.
