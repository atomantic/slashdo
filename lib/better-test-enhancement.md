## Phase 4c: Test Enhancement

**GATE: If `SIMPLIFY_ONLY=true`, SKIP this entire phase** (including 4c.3's `FILE_OWNER_MAP` update — the Phase 2 map is final). Agent 8 never ran, so there are no test findings, and authoring new tests is not a simplification. Report all four test-enhancement stats as `— (skipped: --simplify-only)` in the Phase 7 summary and proceed to Phase 5.

After internal code review passes, evaluate and enhance the project's test suite. This phase acts on Agent 8's findings AND ensures all remediation work from Phase 3 has proper test coverage.

### 4c.0: Record Start SHA

Before any test enhancement commits, capture the current HEAD so Phase 4c changes can be diffed later:
```bash
cd {WORKTREE_DIR}
PHASE_4C_START_SHA="$(git rev-parse HEAD)"
```

### 4c.1: Test Audit Triage

**In issue mode Agent 8's findings are on disk, not in this context.** Phase 1 returned
only index lines, and the index (`<id> | <SEVERITY> | <category> | <file:line> | <title>`)
carries no `[VACUOUS]`/`[WEAK]`/`[MISSING]` tag at all — triaging off it is not merely
lossy, it is impossible. Read `$SPOOL_DIR/tests.md` (the literal path from run state) and
triage off each finding's full body, then populate `{VACUOUS_AND_WEAK_FINDINGS}` /
`{MISSING_FINDINGS}` from those bodies, never from the index titles.

Review Agent 8 (Test Quality & Coverage) findings from Phase 1 and categorize them:

1. **`[VACUOUS]` findings** — tests that exist but don't test real behavior. These are the highest priority because they create a false sense of safety.
2. **`[WEAK]` findings** — tests that partially cover behavior but miss important cases. Strengthen with additional assertions and edge cases.
3. **`[MISSING]` findings** — no tests exist for critical paths. Write new test files or add test cases to existing files.

Additionally, scan all remediation changes from Phase 3:
- For each file modified by remediation agents, check if corresponding tests exist
- If tests exist, verify they cover the specific behavior that was fixed/changed
- If no tests exist for a remediated module, flag for new test creation

### 4c.2: Test Enhancement Execution

Spawn a general-purpose agent (using `REMEDIATION_MODEL_TIER`) in the worktree to fix and write tests. Populate the template placeholders below from Phase 4c.1 triage output: `{VACUOUS_AND_WEAK_FINDINGS}` from `[VACUOUS]`/`[WEAK]` findings, `{MISSING_FINDINGS}` from `[MISSING]` findings, and `{REMEDIATED_FILES_WITHOUT_TESTS}` from the remediation-change scan. The agent instructions:

```
You are a test enhancement agent working in {WORKTREE_DIR}.
Project type: {PROJECT_TYPE}. Test command: {TEST_CMD}.

Your job is to fix weak/vacuous tests and write missing tests that verify REAL BEHAVIOR.

## Rules for writing good tests

1. **Test observable behavior, not implementation.** Assert on return values, side effects (files written, state changed), and error messages — never on internal variable names, call counts, or private method invocations.

2. **Every assertion must be falsifiable.** For each assertion you write, mentally substitute a broken implementation (returns null, returns wrong value, throws instead of succeeding, succeeds instead of throwing). If your assertion would still pass, it's vacuous — rewrite it.

3. **Prefer real modules over mocks.** Only mock at system boundaries (filesystem, network, time). If you must mock, assert on the arguments passed TO the mock, not on its return value.

4. **Test the edges.** Each test function needs at minimum:
   - Happy path with specific expected output
   - Empty/null/undefined input
   - Invalid input that should error
   - Boundary values (0, -1, MAX, empty string vs null)

5. **Use concrete expected values.** `assert.equal(result, 'expected string')` not `assert.ok(result)`. `assert.deepEqual(output, { key: 'value' })` not `assert.ok(typeof output === 'object')`.

6. **One behavior per test.** Each `it()` block tests exactly one scenario. The test name describes the scenario and expected outcome.

7. **No shared mutable state.** Each test must be independently runnable. Use `beforeEach` to create fresh fixtures. Never rely on test execution order.

## Task list

Fix these vacuous/weak tests:
{VACUOUS_AND_WEAK_FINDINGS}

Write tests for these gaps:
{MISSING_FINDINGS}

Write tests for these remediated files:
{REMEDIATED_FILES_WITHOUT_TESTS}

## Verification

After writing/fixing each test file:
1. Run `{TEST_CMD}` to verify all tests pass
2. For each NEW test, verify that it fails when the behavior under test is wrong:
   - Stage your test changes so they are protected: `git add path/to/test_file*`
   - Confirm your staged diff only includes the intended test changes: `git diff --cached`
   - Confirm there are no other unstaged changes in the worktree: `git diff` is clean
   - Apply a small, obvious, and **uncommitted** change to the code under test (e.g., return a constant, flip a conditional)
   - Run `{TEST_CMD}` and confirm the new test FAILS
   - Immediately restore only the temporary code change (do **not** touch the staged tests), for example:
     - `git restore path/to/code_under_test` **or**
     - `git checkout HEAD -- path/to/code_under_test`
   - Confirm the worktree has no remaining unstaged changes (`git diff` shows no changes) and that your staged test changes are still present (`git diff --cached`)
   This is the key quality gate — a test that does not fail when the code is broken is worthless.
3. After confirming the temporary code change is reverted and only the intended test changes are staged, commit the passing tests: `test: {description of what's tested}`
```

### 4c.3: Verification

After the test agent completes:

1. Run the full test suite:
   ```bash
   cd {WORKTREE_DIR} && {TEST_CMD}
   ```
2. If tests fail, fix in a new commit
3. Count new/fixed tests and record four variables:
   - `VACUOUS_TESTS_FIXED` — number of vacuous tests fixed
   - `WEAK_TESTS_STRENGTHENED` — number of weak tests strengthened
   - `NEW_TEST_CASES` — number of new test cases added
   - `NEW_TEST_FILES` — number of new test files created
4. **Update `FILE_OWNER_MAP`** — Phase 4c may have created or modified test files that were not in the Phase 2 map. Before Phase 5 assembles branches:
   - List all files changed by Phase 4c commits: `git diff --name-only "$PHASE_4C_START_SHA"..HEAD`
   - For each file not already in `FILE_OWNER_MAP`, assign it to the `tests` category
   - For each file already owned by another category, leave it in that category (co-located test changes ship with the code they test — the `tests` branch only contains standalone test files not owned by other categories)
