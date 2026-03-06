---
description: Unified DevSecOps audit, remediation, test enhancement, per-category PRs, CI verification, and Copilot review loop with worktree isolation
argument-hint: "[--scan-only] [--no-merge] [path filter or focus areas]"
---

# Better — Unified DevSecOps Pipeline

Run the full DevSecOps lifecycle: audit the codebase with 7 deduplicated agents, consolidate findings, remediate in an isolated worktree, create **separate PRs per category** with SemVer bump, verify CI, run Copilot review loops, and merge.

Parse `$ARGUMENTS` for:
- **`--scan-only`**: run Phase 0 + 1 + 2 only (audit and plan), skip remediation
- **`--no-merge`**: run through PR creation (Phase 5), skip Copilot review and merge
- **Path filter**: limit scanning scope to specific directories or files
- **Focus areas**: e.g., "security only", "DRY and bugs"

## Configuration

Before starting the pipeline, present the user with configuration options using `AskUserQuestion`:

```
AskUserQuestion([
  {
    question: "Which model profile for audit and remediation agents?",
    header: "Model",
    multiSelect: false,
    options: [
      { label: "Quality", description: "Opus for all agents — fewest false positives, best fixes (highest cost, 7+ Opus agents)" },
      { label: "Balanced (Recommended)", description: "Sonnet for audit and remediation — good quality at moderate cost" },
      { label: "Budget", description: "Haiku for audit, Sonnet for remediation — fastest and cheapest" }
    ]
  }
])
```

Record the selection as `MODEL_PROFILE` and derive agent models from this table:

| Agent Role | Quality | Balanced | Budget |
|------------|---------|----------|--------|
| Audit agents (7 Explore agents, Phase 1) | opus | sonnet | haiku |
| Remediation agents (general-purpose, Phase 3) | opus | sonnet | sonnet |

Derive two variables:
- `AUDIT_MODEL`: `opus` / `sonnet` / `haiku` based on profile
- `REMEDIATION_MODEL`: `opus` / `sonnet` / `sonnet` based on profile

When the resolved model is `opus`, **omit** the `model` parameter on the Agent/Task call so the agent inherits the session's Opus version. This avoids version conflicts when organizations pin specific Opus versions.

### Model Profile Rationale

Opus reduces false positives in audit (judgment-heavy). Sonnet is the floor for code-writing agents (remediation). Haiku works for fast first-pass pattern scanning but may produce more false positives — remediation agents (Sonnet+) validate before fixing.

## Compaction Guidance

When compacting during this workflow, always preserve:
- The `FILE_OWNER_MAP` (complete, not summarized)
- All CRITICAL/HIGH findings with file:line references
- The current phase number and what phases remain
- All PR numbers and URLs created so far
- `BUILD_CMD`, `TEST_CMD`, `PROJECT_TYPE`, `WORKTREE_DIR` values
- `VCS_HOST`, `CLI_TOOL`, `DEFAULT_BRANCH`, `CURRENT_BRANCH`
- `TEST_ENHANCEMENT_STATS` (vacuous fixed, weak strengthened, new cases, new files)


## Phase 0: Discovery & Setup

Detect the project environment before any scanning or remediation.

### 0a: VCS Host Detection
Run `gh auth status` to check GitHub CLI. If it fails, run `glab auth status` for GitLab.
- Set `VCS_HOST` to `github` or `gitlab`
- Set `CLI_TOOL` to `gh` or `glab`
- If neither is authenticated, warn the user and halt

### 0b: Project Type Detection
Check for project manifests to determine the tech stack:
- `package.json` → Node.js (check for `next`, `react`, `vue`, `express`, etc.)
- `Cargo.toml` → Rust
- `pyproject.toml` / `requirements.txt` → Python
- `go.mod` → Go
- `pom.xml` / `build.gradle` → Java/Kotlin
- `Gemfile` → Ruby
- `*.csproj` / `*.sln` → .NET

Record the detected stack as `PROJECT_TYPE` for agent context.

### 0c: Build & Test Command Detection
Derive build and test commands from the project type:
- Node.js: check `package.json` scripts for `build`, `test`, `typecheck`, `lint`
- Rust: `cargo build`, `cargo test`
- Python: `pytest`, `python -m pytest`
- Go: `go build ./...`, `go test ./...`
- If ambiguous, check project conventions already in context for documented commands

Record as `BUILD_CMD` and `TEST_CMD`.

### 0d: State Snapshot
- Record `CURRENT_BRANCH` via `git rev-parse --abbrev-ref HEAD`
- Record `DEFAULT_BRANCH` via `gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name'` (or `glab` equivalent)
- Record `IS_DIRTY` via `git status --porcelain`
- Check for `.changelog/` directory → `HAS_CHANGELOG`
- Check for existing `../better-*` worktrees: `git worktree list`. If found, inform the user and ask whether to resume (use existing worktree) or clean up (remove it and start fresh)


<audit_instructions>

## Phase 1: Unified Audit

Project conventions are already in your context. Pass relevant conventions to each agent.

Launch 7 Explore agents in two batches. Each agent must report findings in this format:
```
- **[CRITICAL/HIGH/MEDIUM/LOW]** `file:line` - Description. Suggested fix: ... Complexity: Simple/Medium/Complex
```

**Context requirement.** Before flagging, read at least 30 lines of surrounding context to confirm the issue is real. Common false positives to watch for:
- A Promise `.then()` chain that appears "unawaited" but IS collected into an array and awaited via `Promise.all` downstream
- A value that appears "unvalidated" but IS checked by a guard clause earlier in the function or by the caller
- A pattern that looks like an anti-pattern in isolation but IS idiomatic for the specific framework or library being used
- An `async` function called without `await` that IS intentionally fire-and-forget (the return value is unused by design)

If the surrounding context shows the code is correct, do NOT flag it.

If uncertain whether something is a genuine issue, report it as **[UNCERTAIN]** with your reasoning. The consolidation phase will evaluate these separately. Fewer confident findings is better than padding with questionable ones.

<approach>
For each potential finding:
1. Read the file and 30+ lines of surrounding context
2. Quote the specific code that demonstrates the issue
3. Explain why it's a problem given the context
4. Only then classify severity and suggest a fix
Skip step 4 if steps 1-3 reveal the code is correct.
</approach>

### Batch 1 (5 parallel Explore agents via Task tool):

**Model**: Pass `AUDIT_MODEL` as the `model` parameter on each agent. If `AUDIT_MODEL` is `opus`, omit the parameter to inherit from session.

1. **Security & Secrets**
   Sources: authentication checks, credential exposure, infrastructure security, input validation, dependency health
   Focus: hardcoded credentials, API keys, exposed secrets, authentication bypasses, disabled security checks, PII exposure, injection vulnerabilities (SQL/command/path traversal), insecure CORS configurations, missing auth checks, unsanitized user input in file paths or queries, known CVEs in dependencies (check `npm audit` / `cargo audit` / `pip-audit` / `go vuln` output), abandoned or unmaintained dependencies, overly permissive dependency version ranges
   OWASP Top 10 framing: broken auth (session fixation, credential stuffing), security misconfiguration (default creds, debug mode in prod), SSRF (user-controlled URLs in server fetch without allowlist), mass assignment (request bodies bound to models without field allowlist)
   Supply chain: lockfile committed + frozen installs in CI, no untrusted postinstall scripts

2. **Code Quality & Style**
   Sources: code brittleness, convention violations, test workarounds, logging & observability
   Focus: magic numbers, brittle conditionals, hardcoded execution paths, test-specific hacks, narrow implementations that pass specific cases but lack generality, dead/unreachable code, unused imports/variables, violations of CLAUDE.md conventions (try/catch usage, window.alert/confirm, class-based code where functional preferred), anti-patterns specific to the detected tech stack, inconsistent or missing structured logging (raw `console.log`/`print` in production code instead of a logger), missing log levels or correlation IDs, swallowed errors (empty catch blocks, `.catch(() => {})`, bare `except: pass`), missing request/response logging at API boundaries

3. **DRY & YAGNI**
   Sources: duplication patterns, speculative abstractions
   Focus: duplicate code blocks, copy-paste patterns, redundant implementations, repeated inline logic (count duplications per pattern, e.g., "DATA_DIR declared 20+ times"), speculative abstractions, unused features, over-engineered solutions, premature optimization, YAGNI violations

4. **Architecture & SOLID**
   Sources: structural violations, coupling analysis, modularity, API contract quality
   Focus: Single Responsibility violations (god files >500 lines, functions >50 lines doing multiple things), tight coupling between modules, circular dependencies, mixed concerns in single files, dependency inversion violations, classes/modules with too many responsibilities (>20 public methods), deep nesting (>4 levels), long parameter lists, modules reaching into other modules' internals, inconsistent API error response shapes across endpoints, list endpoints missing pagination, missing rate limiting on public endpoints, inconsistent request/response envelope patterns
   API contract consistency: breaking response shape changes without versioning, inconsistent error envelopes across endpoints, missing deprecation headers on sunset endpoints

5. **Bugs, Performance & Error Handling**
   Sources: runtime safety, resource management, async correctness, performance, race conditions
   Focus: missing `await` on async calls, unhandled promise rejections, null/undefined access without guards, off-by-one errors, incorrect comparison operators, mutation of shared state, resource leaks (unbounded caches/maps, unclosed connections/streams), `process.exit()` in library code, async routes without error forwarding, missing AbortController on data fetching, N+1 query patterns (loading related records inside loops), O(n²) or worse algorithms in hot paths, unbounded result sets (missing LIMIT/pagination on DB queries), missing database indexes on frequently queried columns, race conditions (TOCTOU, double-submit without idempotency keys, concurrent writes to shared state without locks, stale-read-then-write patterns), missing connection pooling or pool exhaustion
   Resilience: external calls without timeouts, missing fallback for unavailable downstream services, retry without backoff ceiling/jitter, missing health check endpoints
   Observability: production paths without structured logging, error logs missing reproduction context (request ID, input params), async flows without correlation IDs

### Batch 2 (2 agents after Batch 1 completes):

**Model**: Same `AUDIT_MODEL` as Batch 1.

6. **Stack-Specific**
   Dynamically focus based on `PROJECT_TYPE` detected in Phase 0:
   - **Node/React**: missing cleanup in useEffect, stale closures, unstable deps arrays, duplicate hooks across components, re-created functions inside render, missing AbortController, bundle size concerns (large imports that could be tree-shaken or lazy-loaded)
   - **Rust**: unsafe blocks, lifetime issues, unwrap() in non-test code, clippy warnings
   - **Python**: mutable default arguments, bare except clauses, missing type hints on public APIs, sync I/O in async contexts
   - **Go**: unchecked errors, goroutine leaks, defer in loops, context propagation gaps
   - **Web projects (any stack)**: accessibility issues — missing alt text on images, broken keyboard navigation, missing ARIA labels on interactive elements, insufficient color contrast, form inputs without associated labels
   - **Database migrations**: exclusive-lock ALTER TABLE on large tables, CREATE INDEX without CONCURRENTLY, missing down migrations or untested rollback paths
   - General: framework-specific security issues, language-specific gotchas, domain-specific compliance, environment variable hygiene (missing `.env.example`, required env vars not validated at startup, secrets in config files that should be in env)

7. **Test Quality & Coverage**
   Uses Batch 1 findings as context to prioritize.
   Focus areas:

   **Coverage gaps:**
   - Missing test files for critical modules, untested edge cases, tests that only cover happy paths
   - Areas with high complexity (identified by agents 1-5) but no tests
   - Remediation changes from agents 1-6 that lack corresponding test coverage

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

Wait for ALL agents to complete before proceeding.

</audit_instructions>

<plan_and_remediate>

## Phase 2: Plan Generation

1. Read the existing `PLAN.md` (create if it doesn't exist)
2. Consolidate all findings from Phase 1, deduplicating across agents (same file:line flagged by multiple agents → keep the most specific description)
3. Identify **shared utility extractions** — patterns duplicated 3+ times that should become reusable functions. Group these as "Foundation" work for Phase 3b.
4. **Build the file ownership map** (required by Phase 5 for conflict-free PRs):
   - For each finding, record which file(s) it touches
   - Assign each file to exactly ONE category (its primary category)
   - If a file is touched by multiple categories, assign it to the category with the highest-severity finding for that file
   - Record the mapping as `FILE_OWNER_MAP` — this ensures no two PRs modify the same file
   - If a module extraction creates a new file (e.g., extracting `mediaConvert.js` from `dbCrud.js`), add a backward-compatible re-export in the original file so other PRs don't break
5. Add a new section to PLAN.md: `## Better Audit - {YYYY-MM-DD}`

```markdown
## Better Audit - {date}

Summary: {N} findings across {M} files. {X} shared utilities to extract.

### Foundation — Shared Utilities
For each utility: name, purpose, files it replaces, signature sketch.

### File Ownership Map
| File | Primary Category | Reason |
For each file touched by multiple categories, document why it was assigned to one.

### Security & Secrets
- [ ] **[CRITICAL]** `file:line` - Description — Fix: ... (Complexity: Simple/Medium/Complex)

### Code Quality
- [ ] **[HIGH]** `file:line` - Description — Fix: ...

### DRY & YAGNI
- [ ] **[MEDIUM]** `file:line` - Description — Fix: ...

### Architecture & SOLID
### Bugs, Performance & Error Handling
### Stack-Specific
### Test Quality & Coverage
```

6. Print a summary table (short labels → full category → branch slug):
   - Security → Security & Secrets → `security`
   - Code Quality → Code Quality & Style → `code-quality`
   - DRY & YAGNI → DRY & YAGNI → `dry`
   - Architecture → Architecture & SOLID → `architecture`
   - Bugs & Perf → Bugs, Performance & Error Handling → `bugs-perf`
   - Stack-Specific → Stack-Specific → `stack-specific`
   - Tests → Test Quality & Coverage → `tests`

```
| Category          | CRITICAL | HIGH | MEDIUM | LOW | Total |
|-------------------|----------|------|--------|-----|-------|
| Security          | ...      | ...  | ...    | ... | ...   |
| Code Quality      | ...      | ...  | ...    | ... | ...   |
| DRY & YAGNI       | ...      | ...  | ...    | ... | ...   |
| Architecture      | ...      | ...  | ...    | ... | ...   |
| Bugs & Perf       | ...      | ...  | ...    | ... | ...   |
| Stack-Specific    | ...      | ...  | ...    | ... | ...   |
| Tests             | ...      | ...  | ...    | ... | ...   |
| TOTAL             | ...      | ...  | ...    | ... | ...   |
```

**GATE: If `--scan-only` was passed, STOP HERE.** Print the summary and exit.

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

This phase is done by the team lead (you) directly — NOT delegated to agents — because all subsequent agents depend on these files existing and compiling.

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

1. Use `TeamCreate` with name `better-{DATE}`
2. Use `TaskCreate` for each category that has CRITICAL, HIGH, or MEDIUM findings. Possible categories:
   - Security & Secrets
   - Code Quality & Style
   - DRY & YAGNI
   - Architecture & SOLID
   - Bugs, Performance & Error Handling
   - Stack-Specific
3. Only create tasks for categories that have actionable findings
4. Spawn up to 5 general-purpose agents as teammates. **Pass `REMEDIATION_MODEL` as the `model` parameter on each agent.** If `REMEDIATION_MODEL` is `opus`, omit the parameter to inherit from session.

### Agent instructions template:

!`cat ~/.claude/lib/remediation-agent-template.md`

### Conflict avoidance:
- Review all findings before task assignment. If two categories touch the same file, assign both sets of findings to the same agent.
- Security agent gets priority on validation logic; DRY agent gets priority on import consolidation.

</plan_and_remediate>

<verification_and_pr>

## Phase 4: Verification

After all agents complete:

1. Run the full build in the worktree:
   ```bash
   cd {WORKTREE_DIR} && {BUILD_CMD}
   ```
2. Run tests in the worktree:
   ```bash
   cd {WORKTREE_DIR} && {TEST_CMD}
   ```
3. If build or tests fail:
   - Identify which commits caused the failure via `git bisect` or manual review
   - Attempt to fix in a new commit: `fix: resolve build/test failure from {category} changes`
   - If unfixable, revert the problematic commit(s): `git -C {WORKTREE_DIR} revert <sha>` and note which findings were skipped
4. Shut down all agents via `SendMessage` with `type: "shutdown_request"`
5. Clean up team via `TeamDelete`

## Phase 4b: Internal Code Review

Before creating PRs, run a deep code review on all remediation changes to catch issues that automated agents may have introduced.

1. Generate the diff of all changes in the worktree:
   ```bash
   cd {WORKTREE_DIR} && git diff {DEFAULT_BRANCH}...HEAD
   ```
2. Review the diff against the code review checklist:
   ```
   !`cat ~/.claude/lib/code-review-checklist.md`
   ```
3. For each issue found:
   - Fix in a new commit: `fix: {description of review finding}`
   - Re-run `{BUILD_CMD}` and `{TEST_CMD}` to verify
4. Present a summary of review findings and fixes to the user via `AskUserQuestion`:
   ```
   AskUserQuestion([{
     question: "Code review complete. {N} issues found and fixed. {list}. Proceed to PR creation?",
     options: [
       { label: "Proceed", description: "Create per-category PRs" },
       { label: "Show diff", description: "Show the full diff for manual review before proceeding" },
       { label: "Abort", description: "Stop here — I'll review manually" }
     ]
   }])
   ```
5. If "Show diff" selected, print the diff and re-ask. If "Abort", stop and print the worktree path.

## Phase 4c: Test Enhancement

After internal code review passes, evaluate and enhance the project's test suite. This phase acts on Agent 7's findings AND ensures all remediation work from Phase 3 has proper test coverage.

### 4c.0: Record Start SHA

Before any test enhancement commits, capture the current HEAD so Phase 4c changes can be diffed later:
```bash
cd {WORKTREE_DIR}
PHASE_4C_START_SHA="$(git rev-parse HEAD)"
```

### 4c.1: Test Audit Triage

Review Agent 7 findings from Phase 1 and categorize them:

1. **`[VACUOUS]` findings** — tests that exist but don't test real behavior. These are the highest priority because they create a false sense of safety.
2. **`[WEAK]` findings** — tests that partially cover behavior but miss important cases. Strengthen with additional assertions and edge cases.
3. **`[MISSING]` findings** — no tests exist for critical paths. Write new test files or add test cases to existing files.

Additionally, scan all remediation changes from Phase 3:
- For each file modified by remediation agents, check if corresponding tests exist
- If tests exist, verify they cover the specific behavior that was fixed/changed
- If no tests exist for a remediated module, flag for new test creation

### 4c.2: Test Enhancement Execution

Spawn a general-purpose agent (using `REMEDIATION_MODEL`) in the worktree to fix and write tests. The agent instructions:

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
   - Ensure you have no unstaged changes (`git diff` is clean)
   - Apply a small, obvious, and **uncommitted** change to the code under test (e.g., return a constant, flip a conditional)
   - Run `{TEST_CMD}` and confirm the new test FAILS
   - Immediately restore the code: `git checkout -- {file_path}`
   - Confirm the worktree is clean again (`git diff` shows no changes)
   This is the key quality gate — a test that does not fail when the code is broken is worthless.
3. After confirming the code is restored and the worktree is clean, commit passing tests: `test: {description of what's tested}`
```

### 4c.3: Verification

After the test agent completes:

1. Run the full test suite:
   ```bash
   cd {WORKTREE_DIR} && {TEST_CMD}
   ```
2. If tests fail, fix in a new commit
3. Count new/fixed tests and record as `TEST_ENHANCEMENT_STATS`:
   - Vacuous tests fixed
   - Weak tests strengthened
   - New test cases added
   - New test files created
4. **Update `FILE_OWNER_MAP`** — Phase 4c may have created or modified test files that were not in the Phase 2 map. Before Phase 5 assembles branches:
   - List all files changed by Phase 4c commits: `git diff --name-only {PHASE_4C_START_SHA}..HEAD`
   - For each file not already in `FILE_OWNER_MAP`, assign it to the `tests` category
   - For each file already owned by another category, leave it in that category (the test changes are co-located with the code they test and will ship in the same PR)

## Phase 5: Per-Category PR Creation

Instead of one mega PR, create **separate branches and PRs for each category**. This enables independent review, targeted CI, and granular merge decisions.

### 5a: Build the Category Branches

Using the `FILE_OWNER_MAP` from Phase 2, create one branch per category:

For each category that has findings:
1. Switch to `{DEFAULT_BRANCH}`: `git checkout {DEFAULT_BRANCH}`
2. Create a category branch: `git checkout -b better/{CATEGORY_SLUG}`
   - Use slugs: `security`, `code-quality`, `dry`, `architecture`, `bugs-perf`, `stack-specific`, `tests`
3. For each file assigned to this category in `FILE_OWNER_MAP`:
   - **Modified files**: `git checkout origin/better/{DATE} -- {file_path}`
   - **New files (Added)**: `git checkout origin/better/{DATE} -- {file_path}`
   - **Deleted files**: `git rm {file_path}`
4. Commit all staged changes with a descriptive message:
   ```bash
   git commit -m "{prefix}: {category summary}"
   ```
5. Push the branch: `git push -u origin better/{CATEGORY_SLUG}`

**File isolation rule** (one file per branch) — each file must appear in exactly ONE branch. If a file has changes from multiple categories (e.g., `server/index.js` with both security and stack-specific changes), assign the whole file to one category based on the file ownership map. Do not split file-level changes across PRs.

**Cross-PR dependency check** — verify each branch builds independently:
```bash
git checkout better/{CATEGORY_SLUG} && {BUILD_CMD}
```
If a branch fails because it imports from a new module created in another branch:
- Add a backward-compatible re-export in the original module (in the branch that has the original module)
- Or move the new module file to the branch that needs it
- Or revert the import change to use the original module path

### 5b: Version Bump

Only if ALL category branches pass build:
1. Pick the first category branch (e.g., `better/security`) for the version bump
2. Analyze all commits across ALL category branches to determine the aggregate SemVer bump:
   - Any `breaking:` or `BREAKING CHANGE` → **major**
   - Any `feat:` → **minor**
   - Otherwise (fix:, refactor:, security:, chore:) → **patch**
3. Bump the version on that branch:
   ```bash
   git checkout better/{FIRST_CATEGORY}
   npm version {LEVEL} --no-git-tag-version
   git add package.json package-lock.json
   git commit -m "chore: bump version to {NEW_VERSION}"
   git push
   ```
4. If `HAS_CHANGELOG`, update changelog and include in the commit.

### 5c: Create PRs

For each category branch, create a PR:

**GitHub:**
```bash
gh pr create --head better/{CATEGORY_SLUG} --base {DEFAULT_BRANCH} \
  --title "{prefix}: {short description}" \
  --body "$(cat <<'EOF'
## Better Audit — {Category Name}

### Summary
{count} findings addressed across {files} files.

### Changes
{bulleted list of changes with severity levels}

### Files Modified
{list of files}

### Merge Order
{dependency info if applicable, e.g., "Depends on Security PR for shared helper exports" or "Independent — can be merged in any order"}
EOF
)"
```

**GitLab:**
```bash
glab mr create --source-branch better/{CATEGORY_SLUG} --target-branch {DEFAULT_BRANCH} \
  --title "{prefix}: {short description}" --description "..."
```

Record all `PR_NUMBERS` and `PR_URLS` in a map: `{category: {number, url}}`.

**GATE: If `--no-merge` was passed, STOP HERE.** Print all PR URLs and summary.

**GATE: If `VCS_HOST` is `gitlab`, STOP HERE.** Print all MR URLs and summary. GitLab does not support the Copilot review loop.

## Phase 5d: CI Verification

After creating all PRs, verify CI passes on each one:

1. Wait 30 seconds for CI to start
2. For each PR, poll CI status:
   ```bash
   gh pr checks {PR_NUMBER}
   ```
   Poll every 30 seconds, max 10 minutes per PR.

3. If CI **passes** on all PRs → proceed to Phase 6

4. If CI **fails** on any PR:
   a. Fetch the failure logs:
      ```bash
      gh run view {RUN_ID} --job {JOB_ID} --log-failed
      ```
   b. Analyze the failure — common causes:
      - **Missing imports**: a file imports from a module in another PR's branch. Fix by adding a backward-compatible re-export or reverting the import.
      - **Missing exports**: a module removed an export that other code still references. Fix by adding a re-export.
      - **Test failures**: a test depends on code changed in the PR. Fix the test or the code.
   c. Switch to the failing branch:
      ```bash
      git checkout better/{CATEGORY_SLUG}
      ```
   d. Make the fix, commit, and push:
      ```bash
      git add <specific files>
      git commit -m "fix: resolve CI failure - {description}"
      git push
      ```
   e. Re-poll CI until it passes or max retries (3) are exhausted
   f. If CI still fails after 3 fix attempts, inform the user and continue with other PRs

## Phase 6: Copilot Review Loop (GitHub only)

Maximum 5 iterations per PR to prevent infinite loops.

**Sub-agent delegation** (prevents context exhaustion): delegate each PR's review loop to a **separate general-purpose sub-agent** via the Agent tool. Launch sub-agents in parallel (one per PR). Each sub-agent runs the full loop (request → wait → check → fix → re-request) autonomously and returns only the final status.

### 6.1: Launch parallel sub-agents (one per PR)

For each PR, spawn a general-purpose sub-agent using the shared review loop template:

!`cat ~/.claude/lib/copilot-review-loop.md`

Pass each sub-agent the PR-specific variables: `{PR_NUMBER}`, `{OWNER}/{REPO}`, `better/{CATEGORY_SLUG}`, and `{BUILD_CMD}`.

Launch all PR sub-agents in parallel. Wait for all to complete.

### 6.2: Handle sub-agent results

For each sub-agent result:
- **clean**: mark PR as ready to merge
- **timeout**: ask the user whether to continue waiting, re-request, or skip
- **max-iterations-reached**: inform the user "Reached max review iterations (5) on PR #{number}. Remaining issues may need manual review."
- **error**: inform the user and ask whether to retry or skip

### 6.3: Merge Gate (MANDATORY)

**Do NOT merge any PR until Copilot review has completed (approved or commented) on ALL PRs, or the user explicitly approves skipping.**

Present the review status summary to the user via `AskUserQuestion`:
```
AskUserQuestion([{
  question: "Copilot review status:\n{for each PR: #number - status (approved/comments/pending/timeout)}\n\nHow would you like to proceed?",
  options: [
    { label: "Merge approved PRs", description: "Merge only PRs with passing review" },
    { label: "Merge all", description: "Merge all PRs regardless of review status" },
    { label: "Wait", description: "Wait longer for pending reviews" },
    { label: "Don't merge", description: "Leave PRs open for manual review" }
  ]
}])
```

Only proceed with merging based on the user's selection. Never auto-merge without user confirmation.

### 6.4: Merge

For each PR approved for merge (in dependency order if applicable):
```bash
gh pr merge {PR_NUMBER} --merge
```

Verify each merge:
```bash
gh pr view {PR_NUMBER} --json state,mergedAt
```

If merge fails (e.g., branch protection, merge conflicts from a prior PR):
- If merge conflict: rebase the branch and retry
  ```bash
  git checkout better/{CATEGORY_SLUG}
  git pull --rebase origin {DEFAULT_BRANCH}
  git push --force-with-lease
  ```
  Then re-run CI check before merging.
- If branch protection: inform the user and suggest manual merge

</verification_and_pr>

## Phase 7: Cleanup

1. Remove the worktree:
   ```bash
   git worktree remove {WORKTREE_DIR}
   ```
2. Delete local AND remote branches (only categories that were created and merged). Use the tracked list of branches from Phase 5 rather than a fixed list:
   ```bash
   git branch -d better/{DATE}
   for slug in {CREATED_CATEGORY_SLUGS}; do
     git branch -d "better/$slug" 2>/dev/null || true
     git push origin --delete "better/$slug" 2>/dev/null || true
   done
   ```
   The `|| true` guards prevent errors from interrupting cleanup when a branch was never created or was already deleted.
3. Restore stashed changes (if stashed in Phase 3a):
   ```bash
   git stash pop
   ```
4. Update PLAN.md:
   - Mark completed findings with `[x]`
   - Add PR links to each category section header
   - Note any skipped findings with reasons
5. Print the final summary table:

```
| Category           | Findings | Fixed | Skipped | PR       | CI     | Review   |
|--------------------|----------|-------|---------|----------|--------|----------|
| Security & Secrets | ...      | ...   | ...     | #number  | pass   | approved |
| Code Quality       | ...      | ...   | ...     | #number  | pass   | approved |
| DRY & YAGNI        | ...      | ...   | ...     | #number  | pass   | approved |
| Architecture       | ...      | ...   | ...     | #number  | pass   | approved |
| Bugs & Perf        | ...      | ...   | ...     | #number  | pass   | approved |
| Stack-Specific     | ...      | ...   | ...     | #number  | pass   | approved |
| Tests              | ...      | ...   | ...     | #number  | pass   | approved |
| TOTAL              | ...      | ...   | ...     | N PRs    |        |          |

Test Enhancement Stats (from TEST_ENHANCEMENT_STATS):
- Vacuous tests fixed: {TEST_ENHANCEMENT_STATS.vacuous_fixed}
- Weak tests strengthened: {TEST_ENHANCEMENT_STATS.weak_strengthened}
- New test cases added: {TEST_ENHANCEMENT_STATS.new_cases}
- New test files created: {TEST_ENHANCEMENT_STATS.new_files}
```

## Error Recovery

- **Agent failure**: continue with remaining agents, note gaps in the summary
- **Build failure in worktree**: attempt fix in a new commit; if unfixable, revert problematic commits and ask the user
- **Push failure**: `git pull --rebase --autostash` then retry push
- **CI failure on PR**: investigate logs, fix in a new commit, push, re-check (max 3 attempts per PR)
- **Cross-PR dependency breakage**: add backward-compatible re-exports or move shared files to the PR that creates them
- **Copilot timeout** (review not received within decreasing timeout window): inform user, offer to merge without review approval or wait longer
- **Copilot review loop exceeds 5 iterations per PR**: stop iterating on that PR, inform user, proceed to merge
- **Existing worktree found at startup**: ask user — resume (reuse worktree) or cleanup (remove and start fresh)
- **No findings above LOW**: skip Phases 3-7, print "No actionable findings" with the LOW summary
- **Merge conflict after prior PR merged**: rebase the branch onto the updated default branch, push with `--force-with-lease`, re-run CI

!`cat ~/.claude/lib/graphql-escaping.md`

## Notes

- This command is project-agnostic: it reads CLAUDE.md for project-specific conventions and auto-detects the tech stack
- All remediation happens in an isolated worktree — the user's working directory is never modified
- **One PR per category** — each category gets its own branch and PR for independent review and merge
- Each file appears in exactly ONE PR (file ownership map) to prevent merge conflicts between PRs
- When extracting modules, always add backward-compatible re-exports in the original module to prevent cross-PR breakage
- Version bump happens exactly once on the first category branch based on aggregate commit analysis
- Only CRITICAL, HIGH, and MEDIUM findings are auto-remediated for code categories; LOW findings remain tracked in PLAN.md
- Test Quality & Coverage findings are remediated in Phase 4c with a dedicated test enhancement agent that verifies tests fail when code is broken
- GitLab projects skip the Copilot review loop entirely (Phase 6) and stop after MR creation
- CI must pass on each PR before requesting Copilot review or merging
