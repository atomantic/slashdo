---
description: Unified DevSecOps audit, remediation, per-category PRs, CI verification, and Copilot review loop with worktree isolation
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

### 0e: Browser Authentication (GitHub only)
If `VCS_HOST` is `github`, proactively verify browser authentication for the Copilot review loop later:
1. Navigate to the repo URL using `browser_navigate` via Playwright MCP
2. Take a snapshot and check for user avatar/menu indicating logged-in state
3. If NOT logged in: navigate to `https://github.com/login`, inform the user **"Please log in to GitHub in the browser. I'll wait for you to complete authentication."**, and use `AskUserQuestion` to wait for the user to confirm they've logged in
4. Do NOT close the browser — it stays open for the entire session
5. Record `BROWSER_AUTHENTICATED = true` once confirmed

This ensures the browser is ready before we need it in Phase 6, avoiding interruptions mid-flow.

## Phase 1: Unified Audit

Project conventions are already in your context. Pass relevant conventions to each agent.

Launch 7 Explore agents in two batches. Each agent must report findings in this format:
```
- **[CRITICAL/HIGH/MEDIUM/LOW]** `file:line` - Description. Suggested fix: ... Complexity: Simple/Medium/Complex
```

**IMPORTANT: Context requirement for audit agents.** When flagging an issue, agents MUST read at least 30 lines of surrounding context to confirm the issue is real. Common false positives to watch for:
- A Promise `.then()` chain that appears "unawaited" but IS collected into an array and awaited via `Promise.all` downstream
- A value that appears "unvalidated" but IS checked by a guard clause earlier in the function or by the caller
- A pattern that looks like an anti-pattern in isolation but IS idiomatic for the specific framework or library being used
- An `async` function called without `await` that IS intentionally fire-and-forget (the return value is unused by design)

If the surrounding context shows the code is correct, do NOT flag it.

### Batch 1 (5 parallel Explore agents via Task tool):

**Model**: Pass `AUDIT_MODEL` as the `model` parameter on each agent. If `AUDIT_MODEL` is `opus`, omit the parameter to inherit from session.

1. **Security & Secrets**
   Sources: authentication checks, credential exposure, infrastructure security, input validation, dependency health
   Focus: hardcoded credentials, API keys, exposed secrets, authentication bypasses, disabled security checks, PII exposure, injection vulnerabilities (SQL/command/path traversal), insecure CORS configurations, missing auth checks, unsanitized user input in file paths or queries, known CVEs in dependencies (check `npm audit` / `cargo audit` / `pip-audit` / `go vuln` output), abandoned or unmaintained dependencies, overly permissive dependency version ranges

2. **Code Quality & Style**
   Sources: code brittleness, convention violations, test workarounds, logging & observability
   Focus: magic numbers, brittle conditionals, hardcoded execution paths, test-specific hacks, narrow implementations that pass specific cases but lack generality, dead/unreachable code, unused imports/variables, violations of CLAUDE.md conventions (try/catch usage, window.alert/confirm, class-based code where functional preferred), anti-patterns specific to the detected tech stack, inconsistent or missing structured logging (raw `console.log`/`print` in production code instead of a logger), missing log levels or correlation IDs, swallowed errors (empty catch blocks, `.catch(() => {})`, bare `except: pass`), missing request/response logging at API boundaries

3. **DRY & YAGNI**
   Sources: duplication patterns, speculative abstractions
   Focus: duplicate code blocks, copy-paste patterns, redundant implementations, repeated inline logic (count duplications per pattern, e.g., "DATA_DIR declared 20+ times"), speculative abstractions, unused features, over-engineered solutions, premature optimization, YAGNI violations

4. **Architecture & SOLID**
   Sources: structural violations, coupling analysis, modularity, API contract quality
   Focus: Single Responsibility violations (god files >500 lines, functions >50 lines doing multiple things), tight coupling between modules, circular dependencies, mixed concerns in single files, dependency inversion violations, classes/modules with too many responsibilities (>20 public methods), deep nesting (>4 levels), long parameter lists, modules reaching into other modules' internals, inconsistent API error response shapes across endpoints, list endpoints missing pagination, missing rate limiting on public endpoints, inconsistent request/response envelope patterns

5. **Bugs, Performance & Error Handling**
   Sources: runtime safety, resource management, async correctness, performance, race conditions
   Focus: missing `await` on async calls, unhandled promise rejections, null/undefined access without guards, off-by-one errors, incorrect comparison operators, mutation of shared state, resource leaks (unbounded caches/maps, unclosed connections/streams), `process.exit()` in library code, async routes without error forwarding, missing AbortController on data fetching, N+1 query patterns (loading related records inside loops), O(n²) or worse algorithms in hot paths, unbounded result sets (missing LIMIT/pagination on DB queries), missing database indexes on frequently queried columns, race conditions (TOCTOU, double-submit without idempotency keys, concurrent writes to shared state without locks, stale-read-then-write patterns), missing connection pooling or pool exhaustion

### Batch 2 (2 agents after Batch 1 completes):

**Model**: Same `AUDIT_MODEL` as Batch 1.

6. **Stack-Specific**
   Dynamically focus based on `PROJECT_TYPE` detected in Phase 0:
   - **Node/React**: missing cleanup in useEffect, stale closures, unstable deps arrays, duplicate hooks across components, re-created functions inside render, missing AbortController, bundle size concerns (large imports that could be tree-shaken or lazy-loaded)
   - **Rust**: unsafe blocks, lifetime issues, unwrap() in non-test code, clippy warnings
   - **Python**: mutable default arguments, bare except clauses, missing type hints on public APIs, sync I/O in async contexts
   - **Go**: unchecked errors, goroutine leaks, defer in loops, context propagation gaps
   - **Web projects (any stack)**: accessibility issues — missing alt text on images, broken keyboard navigation, missing ARIA labels on interactive elements, insufficient color contrast, form inputs without associated labels
   - General: framework-specific security issues, language-specific gotchas, domain-specific compliance, environment variable hygiene (missing `.env.example`, required env vars not validated at startup, secrets in config files that should be in env)

7. **Test Coverage**
   Uses Batch 1 findings as context to prioritize:
   Focus: missing test files for critical modules, untested edge cases, tests that only cover happy paths, mocked dependencies that hide real bugs, areas with high complexity (identified by agents 1-5) but no tests, test files that don't actually assert anything meaningful

Wait for ALL agents to complete before proceeding.

## Phase 2: Plan Generation

1. Read the existing `PLAN.md` (create if it doesn't exist)
2. Consolidate all findings from Phase 1, deduplicating across agents (same file:line flagged by multiple agents → keep the most specific description)
3. Identify **shared utility extractions** — patterns duplicated 3+ times that should become reusable functions. Group these as "Foundation" work for Phase 3b.
4. **Build the file ownership map** (CRITICAL for Phase 5):
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
### Test Coverage (tracked, not auto-remediated)
```

6. Print a summary table:
```
| Category          | CRITICAL | HIGH | MEDIUM | LOW | Total |
|-------------------|----------|------|--------|-----|-------|
| Security          | ...      | ...  | ...    | ... | ...   |
| Code Quality      | ...      | ...  | ...    | ... | ...   |
| DRY & YAGNI       | ...      | ...  | ...    | ... | ...   |
| Architecture      | ...      | ...  | ...    | ... | ...   |
| Bugs & Perf       | ...      | ...  | ...    | ... | ...   |
| Stack-Specific    | ...      | ...  | ...    | ... | ...   |
| Test Coverage     | ...      | ...  | ...    | ... | ...   |
| TOTAL             | ...      | ...  | ...    | ... | ...   |
```

**GATE: If `--scan-only` was passed, STOP HERE.** Print the summary and exit.

## Phase 3: Worktree Remediation

Only proceed with CRITICAL, HIGH, and MEDIUM findings. LOW and Test Coverage findings remain tracked in PLAN.md but are not auto-remediated.

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
```
You are {agent-name} on team better-{DATE}.

Your task: Fix all {CATEGORY} findings from the Good audit.
Working directory: {WORKTREE_DIR} (this is a git worktree — all work happens here)

Project type: {PROJECT_TYPE}
Build command: {BUILD_CMD}
Test command: {TEST_CMD}

Foundation utilities available (if created):
{list of utility files with brief descriptions}

Findings to address:
{filtered list of CRITICAL/HIGH/MEDIUM findings for this category}

FINDING VALIDATION — verify before fixing:
- Before fixing each finding, READ the file and at least 30 lines of surrounding
  context to confirm the issue is genuine.
- Check whether the flagged code is already correct (e.g., a Promise chain that
  IS properly awaited downstream, a value that IS validated earlier in the function,
  a pattern that IS idiomatic for the framework).
- If the existing code is already correct, SKIP the fix and report it as a
  false positive with a brief explanation of why the original code is fine.
- Do not make changes that are semantically equivalent to the original code
  (e.g., wrapping a .then() chain in an async IIFE adds noise without fixing anything).

COMMIT STRATEGY — commit early and often:
- After completing each logical group of related fixes, stage those files
  and commit immediately with a descriptive conventional commit message.
- Each commit should be independently valid (build should pass).
- Run {BUILD_CMD} in {WORKTREE_DIR} before each commit to verify.
- Use `git -C {WORKTREE_DIR} add <specific files>` — never `git add -A` or `git add .`
- Use `git -C {WORKTREE_DIR} commit -m "prefix: description"`
- Use conventional commit prefixes: fix:, refactor:, feat:, security:
- Do NOT include co-author or generated-by annotations in commits.
- Do NOT bump the version — that happens once at the end.

After all fixes:
- Ensure all changes are committed (no uncommitted work)
- Mark your task as completed via TaskUpdate
- Report: commits made, files modified, findings addressed, any skipped issues

CONFLICT AVOIDANCE:
- Only modify files listed in your assigned findings
- If you need to modify a file assigned to another agent, skip that change and report it
```

### Conflict avoidance:
- Review all findings before task assignment. If two categories touch the same file, assign both sets of findings to the same agent.
- Security agent gets priority on validation logic; DRY agent gets priority on import consolidation.

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

## Phase 5: Per-Category PR Creation

Instead of one mega PR, create **separate branches and PRs for each category**. This enables independent review, targeted CI, and granular merge decisions.

### 5a: Build the Category Branches

Using the `FILE_OWNER_MAP` from Phase 2, create one branch per category:

For each category that has findings:
1. Switch to `{DEFAULT_BRANCH}`: `git checkout {DEFAULT_BRANCH}`
2. Create a category branch: `git checkout -b better/{CATEGORY_SLUG}`
   - Use slugs: `security`, `code-quality`, `dry`, `arch-bugs`, `stack-specific`
3. For each file assigned to this category in `FILE_OWNER_MAP`:
   - **Modified files**: `git checkout origin/better/{DATE} -- {file_path}`
   - **New files (Added)**: `git checkout origin/better/{DATE} -- {file_path}`
   - **Deleted files**: `git rm {file_path}`
4. Commit all staged changes with a descriptive message:
   ```bash
   git commit -m "{prefix}: {category summary}"
   ```
5. Push the branch: `git push -u origin better/{CATEGORY_SLUG}`

**CRITICAL: File isolation rule** — each file must appear in exactly ONE branch. If a file has changes from multiple categories (e.g., `server/index.js` with both security and stack-specific changes), assign the whole file to one category based on the file ownership map. Do not split file-level changes across PRs.

**CRITICAL: Cross-PR dependency check** — after building all branches, verify each branch builds independently:
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

**IMPORTANT — Sub-agent delegation**: To prevent context exhaustion on long review cycles with multiple PRs, delegate each PR's review loop to a **separate general-purpose sub-agent** via the Agent tool. Launch sub-agents in parallel (one per PR). Each sub-agent runs the full loop (request → wait → check → fix → re-request) autonomously and returns only the final status.

### 6.0: Verify browser authentication

If `BROWSER_AUTHENTICATED` is not true (e.g., Phase 0e was skipped or failed):
1. Navigate to the first PR URL using `browser_navigate`
2. Check for user avatar/menu
3. If not logged in: navigate to `https://github.com/login`, inform the user **"Please log in to GitHub in the browser. I'll wait for you to confirm."**, and use `AskUserQuestion` to wait

### 6.1: Determine review request method

**Try the API first** on any one PR:
```bash
gh api repos/{OWNER}/{REPO}/pulls/{PR_NUMBER}/requested_reviewers \
  -f 'reviewers[]=copilot-pull-request-reviewer[bot]'
```

If this returns 422 ("not a collaborator"), record `REVIEW_METHOD=playwright`. Otherwise record `REVIEW_METHOD=api`.

### 6.2: Launch parallel sub-agents (one per PR)

For each PR, spawn a general-purpose sub-agent with:

```
You are a Copilot review loop agent for PR {PR_NUMBER}.

Repository: {OWNER}/{REPO}
Branch: better/{CATEGORY_SLUG}
Build command: {BUILD_CMD}
Review request method: {REVIEW_METHOD}
Max iterations: 5

DECREASING TIMEOUT SCHEDULE (shorter than single-PR review since multiple
PRs are reviewed in parallel — see do:rpr for single-PR dynamic timing):
- Iteration 1: max wait 5 minutes
- Iteration 2: max wait 4 minutes
- Iteration 3: max wait 3 minutes
- Iteration 4: max wait 2 minutes
- Iteration 5+: max wait 1 minute
Poll interval: 30 seconds for all iterations.

Run the following loop until Copilot returns zero new comments or you hit
the max iteration limit:

1. CAPTURE the latest Copilot review timestamp, then REQUEST a new review:
   - First, capture the latest Copilot review timestamp via GraphQL:
     echo '{"query":"{ repository(owner: \"{OWNER}\", name: \"{REPO}\") { pullRequest(number: {PR_NUMBER}) { reviews(last: 20) { nodes { author { login } submittedAt } } } } }"}' | gh api graphql --input -
   - Find the most recent submittedAt where author.login is
     copilot-pull-request-reviewer[bot] and record as LAST_COPILOT_SUBMITTED_AT.
   - If no prior Copilot review exists, record LAST_COPILOT_SUBMITTED_AT=NONE
     and treat the next Copilot review as NEW regardless of timestamp.
   - Then REQUEST:
     If REVIEW_METHOD is "api":
       gh api repos/{OWNER}/{REPO}/pulls/{PR_NUMBER}/requested_reviewers \
         -f 'reviewers[]=copilot-pull-request-reviewer[bot]'
     If REVIEW_METHOD is "playwright":
       Navigate to the PR URL, click the "Reviewers" gear button, click the
       Copilot menuitemradio option, verify sidebar shows "Awaiting requested
       review from Copilot"

2. WAIT for the review (BLOCKING):
   - Poll using stdin JSON piping (avoid shell-escaping issues):
     echo '{"query":"{ repository(owner: \"{OWNER}\", name: \"{REPO}\") { pullRequest(number: {PR_NUMBER}) { reviews(last: 5) { totalCount nodes { state body author { login } submittedAt } } reviewThreads(first: 100) { nodes { id isResolved comments(first: 3) { nodes { body path line author { login } } } } } } } }"}' | gh api graphql --input -
   - Complete when a new copilot-pull-request-reviewer[bot] review appears
     with submittedAt after LAST_COPILOT_SUBMITTED_AT captured in step 1
     (or, if LAST_COPILOT_SUBMITTED_AT=NONE, when the first
     copilot-pull-request-reviewer[bot] review for this loop appears)
   - Use the DECREASING TIMEOUT for the current iteration number
   - Error detection: if review body contains "Copilot encountered an error"
     or "unable to review", re-request and resume. Max 3 error retries.
   - If no review after max wait, report timeout and exit

3. CHECK for unresolved threads:
   Fetch threads via stdin JSON piping:
     echo '{"query":"{ repository(owner: \"{OWNER}\", name: \"{REPO}\") { pullRequest(number: {PR_NUMBER}) { reviewThreads(first: 100) { nodes { id isResolved comments(first: 10) { nodes { body path line author { login } } } } } } } }"}' | gh api graphql --input -
   - Verify review was successful (no error text in body)
   - If zero comments / no unresolved threads: report success and exit
   - If unresolved threads exist: proceed to step 4

4. FIX all unresolved threads:
   For each unresolved thread:
   - Read the referenced file and understand the feedback
   - Evaluate: valid feedback → make the fix; informational/false positive →
     resolve without changes
   - If fixing:
     git checkout better/{CATEGORY_SLUG}
     # make changes
     git add <specific files>
     git commit -m "address Copilot review feedback"
     git push
   - Resolve thread via stdin JSON piping:
     echo '{"query":"mutation { resolveReviewThread(input: {threadId: \"{THREAD_ID}\"}) { thread { id isResolved } } }"}' | gh api graphql --input -
   - After all threads resolved, increment iteration and go back to step 1

When done, report back:
- Final status: clean / max-iterations-reached / timeout / error
- Total iterations completed
- List of commits made (if any)
- Any unresolved threads remaining
```

Launch all PR sub-agents in parallel. Wait for all to complete.

### 6.3: Handle sub-agent results

For each sub-agent result:
- **clean**: mark PR as ready to merge
- **timeout**: ask the user whether to continue waiting, re-request, or skip
- **max-iterations-reached**: inform the user "Reached max review iterations (5) on PR #{number}. Remaining issues may need manual review."
- **error**: inform the user and ask whether to retry or skip

### 6.4: Merge

For each PR that has passed CI and review (in dependency order if applicable):
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

## Phase 7: Cleanup

1. Remove the worktree:
   ```bash
   git worktree remove {WORKTREE_DIR}
   ```
2. Delete local branches (only if merged):
   ```bash
   git branch -d better/{DATE}
   git branch -d better/security better/code-quality better/dry better/arch-bugs better/stack-specific
   ```
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
| Test Coverage      | ...      | (tracked only) | ...     |        |          |
| TOTAL              | ...      | ...   | ...     | N PRs    |        |          |
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
- **Browser not authenticated**: use `AskUserQuestion` to ask the user to log in — never skip this or close the browser
- **Merge conflict after prior PR merged**: rebase the branch onto the updated default branch, push with `--force-with-lease`, re-run CI

!`cat ~/.claude/lib/graphql-escaping.md`

## Notes

- This command is project-agnostic: it reads CLAUDE.md for project-specific conventions and auto-detects the tech stack
- All remediation happens in an isolated worktree — the user's working directory is never modified
- **One PR per category** — each category gets its own branch and PR for independent review and merge
- Each file appears in exactly ONE PR (file ownership map) to prevent merge conflicts between PRs
- When extracting modules, always add backward-compatible re-exports in the original module to prevent cross-PR breakage
- Version bump happens exactly once on the first category branch based on aggregate commit analysis
- Only CRITICAL, HIGH, and MEDIUM findings are auto-remediated; LOW and Test Coverage remain tracked in PLAN.md
- GitLab projects skip the Copilot review loop entirely (Phase 6) and stop after MR creation
- CI must pass on each PR before requesting Copilot review or merging
