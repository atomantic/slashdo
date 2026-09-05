# Test Quality & Coverage
   Uses Batch 1 findings as context to prioritize.
   Focus areas:

   **Coverage gaps:**
   - Missing test files for critical modules, untested edge cases, tests that only cover happy paths
   - Areas with high complexity (identified by agents 1-5) but no tests
   - Remediation changes from agents 1-7 that lack corresponding test coverage

   **Vacuous tests (tests that don't actually test anything):**
   - Tests that assert on mocked return values instead of real behavior (testing the mock, not the code)
   - Tests that only check truthiness (`assert.ok(result)`) when they should verify specific values or shapes
   - Tests with assertions that can never fail (e.g., asserting a hardcoded value equals itself, asserting `typeof x === 'object'` on a literal `{}`)
   - Tests that re-implement the logic under test instead of importing the real function — these pass even when real code regresses
   - `it('should work', ...)` tests with no meaningful assertion or with assertions commented out
   - Tests that mock the module they're testing (testing mock behavior, not real behavior)

   **Weak test patterns:**
   - Tests that verify implementation details (internal state, private methods, call counts) instead of observable behavior
   - Tests where all assertions pass even if the function under test returns `null`/`undefined`/empty — verify by mentally substituting a no-op and checking if the test would still pass
   - Integration tests that mock so aggressively they become unit tests of glue code
   - Tests missing negative cases (invalid input, error paths, boundary conditions)
   - Tests with shared mutable state between cases (`beforeEach` that doesn't reset, module-level variables)

   Report each finding with a severity prefix `**[CRITICAL]**`, `**[HIGH]**`, `**[MEDIUM]**`, or `**[LOW]**` followed immediately by a quality prefix `[VACUOUS]`, `[WEAK]`, or `[MISSING]` (for example, `**[HIGH][VACUOUS]**`) to distinguish quality issues from coverage gaps while keeping the format consistent with other agents. Include the specific test name and file:line for existing test issues.
