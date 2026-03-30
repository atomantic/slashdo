---
description: Audit third-party dependencies and remove unnecessary ones by writing replacement code
argument-hint: "[--interactive] [--scan-only] [--no-merge] [--heavy] [specific packages to evaluate]"
---

# Depfree — Dependency Freedom Audit

Audit all third-party dependencies, classify them as acceptable (large, widely-audited) or suspect (small, replaceable), analyze actual usage of suspect dependencies, and replace them with owned code where feasible.

Every small library is an attack surface. Supply chain compromises are real and common. Large, widely-audited libraries (express, react, d3, three.js, next, vue, fastify, lodash-es, etc.) are acceptable. But for smaller libraries or libraries where only one helper function is used, we should write the code ourselves.

**Default mode: fully autonomous.** Uses Balanced model profile, proceeds through all phases without prompting.

**`--interactive` mode:** Pauses for classification approval, replacement review, and merge confirmation.

Parse `$ARGUMENTS` for:
- **`--interactive`**: pause at each decision point for user approval
- **`--scan-only`**: run Phase 0 + 1 + 2 only (audit and plan), skip remediation
- **`--no-merge`**: run through PR creation, skip merge
- **`--heavy`**: aggressive mode — only keep foundational frameworks and language runtimes; replace everything else that is feasibly replaceable (see Heavy Mode below)
- **Specific packages**: limit audit scope to named packages (e.g., "chalk dotenv")

Set `HEAVY_MODE` to `true` if `--heavy` was passed, `false` otherwise.

## Configuration

### Default Mode (autonomous)

Use the **Balanced** model profile automatically (`AUDIT_MODEL=sonnet`, `REMEDIATION_MODEL=sonnet`).

### Interactive Mode (`--interactive`)

Present the user with configuration options using `AskUserQuestion`:

```
AskUserQuestion([{
  question: "Which model profile for audit and remediation agents?",
  header: "Model",
  multiSelect: false,
  options: [
    { label: "Quality", description: "Opus for all agents — fewest false positives, best replacements (highest cost)" },
    { label: "Balanced (Recommended)", description: "Sonnet for audit and remediation — good quality at moderate cost" },
    { label: "Budget", description: "Haiku for audit, Sonnet for remediation — fastest and cheapest" }
  ]
}])
```

Record the selection as `MODEL_PROFILE` and derive:
- `AUDIT_MODEL`: `opus` / `sonnet` / `haiku` based on profile
- `REMEDIATION_MODEL`: `opus` / `sonnet` / `sonnet` based on profile

When the resolved model is `opus`, **omit** the `model` parameter on the Agent call so the agent inherits the session's Opus version.

## Heavy Mode (`--heavy`)

Heavy mode shifts the philosophy from "remove obvious attack surface" to "own everything we feasibly can." The only dependencies that survive are foundational frameworks and language-level runtimes — the kind maintained by large teams with dedicated security processes. Everything else is a candidate for replacement.

Key behavioral changes when `HEAVY_MODE` is `true`:

1. **Tier 1 is narrowed** to only foundational frameworks and language runtimes (see Phase 1b overrides below). Libraries like lodash, chalk, dotenv, commander, yargs, uuid, axios, etc. are NOT Tier 1 in heavy mode — they move to Tier 2 or 3.
2. **EVALUATE recommendations become REMOVE** — the bias flips from "when in doubt, keep" to "when in doubt, replace."
3. **Complexity ceiling rises** — replacements up to 300 lines are acceptable (vs the default where agents bail at ~2x estimate). Only truly infeasible replacements (deep domain expertise, crypto primitives, protocol parsers) are skipped.
4. **Maintenance status is irrelevant** — even well-maintained small libraries are candidates. The question is "can we own this code?" not "is this library risky?"
5. **DevDependencies get equal priority** — build tools and test utilities are audited with the same aggression as production dependencies (overriding the default Phase 1a deprioritization of devDependencies).

## Compaction Guidance

When compacting during this workflow, always preserve:
- The `DEPENDENCY_MAP` (complete classification of all dependencies)
- All REMOVABLE findings with package names and usage details
- The current phase number and what phases remain
- All PR numbers and URLs created so far
- `BUILD_CMD`, `TEST_CMD`, `PROJECT_TYPE`, `WORKTREE_DIR`, `REPO_DIR` values
- `VCS_HOST`, `CLI_TOOL`, `DEFAULT_BRANCH`, `CURRENT_BRANCH`
- `HEAVY_MODE` flag


## Phase 0: Discovery & Setup

### 0a: VCS Host Detection
Run `gh auth status` to check GitHub CLI. If it fails, run `glab auth status` for GitLab.
- Set `VCS_HOST` to `github` or `gitlab`
- Set `CLI_TOOL` to `gh` or `glab`
- If neither is authenticated, warn the user and halt

### 0b: Project Type Detection
Check for project manifests to determine the tech stack:
- `package.json` → Node.js (check for `next`, `react`, `vue`, `express`, etc.)
- `Cargo.toml` → Rust
- `pyproject.toml` / `requirements.txt` / `setup.py` → Python
- `go.mod` → Go
- `pom.xml` / `build.gradle` → Java/Kotlin
- `Gemfile` → Ruby
- `*.csproj` / `*.sln` → .NET

Record the detected stack as `PROJECT_TYPE`.

### 0c: Build & Test Command Detection
Derive build and test commands from the project type:
- Node.js: check `package.json` scripts for `build`, `test`, `typecheck`, `lint`
- Rust: `cargo build`, `cargo test`
- Python: `pytest`, `python -m pytest`
- Go: `go build ./...`, `go test ./...`
- If ambiguous, check project conventions already in context

Record as `BUILD_CMD` and `TEST_CMD`.

### 0d: State Snapshot
- Record `REPO_DIR` via `git rev-parse --show-toplevel`
- Record `CURRENT_BRANCH` via `git rev-parse --abbrev-ref HEAD`
- Record `DEFAULT_BRANCH` via `gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name'` (or `glab` equivalent)
- Record `IS_DIRTY` via `git status --porcelain`


## Phase 1: Dependency Inventory

### 1a: Extract All Dependencies

Based on `PROJECT_TYPE`, extract the full dependency list:

**Node.js:**
- Read `package.json` → `dependencies` and `devDependencies`
- Note: `devDependencies` used only in build/test are lower priority but still worth auditing
- Check for workspace packages (monorepo) in `workspaces` field

**Rust:**
- Read `Cargo.toml` → `[dependencies]`, `[dev-dependencies]`, `[build-dependencies]`

**Python:**
- Read `pyproject.toml` → `[project.dependencies]`, `[project.optional-dependencies]`
- Or `requirements.txt`, `setup.py`

**Go:**
- Read `go.mod` → `require` block

**Ruby:**
- Read `Gemfile`

### 1b: Classify Dependencies

For each dependency, classify it into one of three tiers:

**Tier 1 — ACCEPTABLE (keep without question):**
Large, widely-audited, foundational libraries. Examples by ecosystem:

**Default mode:**
- **Node.js**: react, next, vue, express, fastify, hono, typescript, eslint, prettier, webpack, vite, jest, vitest, mocha, d3, three, prisma, drizzle, @types/*, tailwindcss, postcss
- **Rust**: tokio, serde, clap, reqwest, hyper, tracing, sqlx, axum, actix-web
- **Python**: django, flask, fastapi, sqlalchemy, pandas, numpy, scipy, pytest, requests, httpx, pydantic
- **Go**: standard library (no third-party needed for most things)
- **Ruby**: rails, rspec, sidekiq, puma, devise
- Any dependency with >10M weekly downloads (npm) or equivalent popularity metric for the ecosystem

**Heavy mode (`HEAVY_MODE=true`) — Tier 1 is restricted to foundational frameworks and runtimes only:**
- **Node.js**: react, next, vue, express, fastify, typescript, webpack, vite, tailwindcss, postcss, prisma, drizzle
- **Rust**: tokio, serde, hyper, sqlx, axum, actix-web
- **Python**: django, flask, fastapi, sqlalchemy, pandas, numpy, scipy, pydantic
- **Go**: standard library only
- **Ruby**: rails, puma
- Download count is NOT a factor — popularity does not exempt a library from replacement
- Libraries that are wrappers, utilities, CLIs, or single-purpose tools are Tier 2 or 3 regardless of popularity
- Linting/formatting tools (eslint, prettier) in heavy mode: remain Tier 1 when required by CI or organization-wide standards (do not attempt replacement); otherwise treat as Tier 2 (audit usage, but do not rewrite their behavior)
- Examples of libraries that DROP from Tier 1 in heavy mode: lodash, chalk, commander, yargs, dotenv, uuid, axios, node-fetch, glob, minimatch, semver, debug, winston, morgan, cors, helmet, body-parser, cookie-parser, compression, color, ora, inquirer, boxen, marked, highlight.js, moment, dayjs, date-fns, underscore, ramda, rxjs (if only basic operators used), jest (if vitest is also present — deduplicate), mocha, d3 (unless the visualization requires it), three (unless 3D rendering is core), rspec, sidekiq, devise, requests, httpx, pytest, clap, reqwest, tracing

**Tier 2 — SUSPECT (audit usage):**
Smaller libraries that may be doing something we can write ourselves.

**Default mode indicators:**
- <1M weekly downloads (npm) or equivalent
- Single-purpose utility (does one thing)
- We only use 1-2 functions from it
- Wrapper libraries that add thin abstractions over built-in APIs
- Libraries that replicate functionality available in newer language/runtime versions
- Abandoned or unmaintained (no commits in 12+ months, open security issues)

**Heavy mode additional indicators** (these move libraries INTO Tier 2 that would otherwise be Tier 1):
- Any library maintained by an individual or small team (not a major org/foundation)
- Any library where we use <50% of its API surface
- Utility collections where we use a handful of functions (lodash, ramda, underscore)
- HTTP clients when the runtime has built-in fetch (axios, node-fetch, got, superagent)
- Logging libraries (winston, pino, morgan, debug) — evaluate if a thin wrapper over console suffices
- CLI argument parsers (commander, yargs, minimist) — evaluate if process.argv parsing is feasible
- Test runners if multiple are present — deduplicate to one

**Tier 3 — REMOVABLE (strong candidate for replacement):**
Libraries where the cost of owning the code is clearly lower than the supply chain risk:

**Default mode:**
- We use a single function that's <50 lines to implement
- The library wraps a built-in API with minimal added value
- The library is unmaintained with known vulnerabilities
- The library's functionality is now available natively (e.g., `node:fs/promises` replacing `fs-extra` for most use cases, `structuredClone` replacing `lodash.cloneDeep`, `Array.prototype.flat` replacing `array-flatten`)
- Color/string utilities where we use 1-2 functions (e.g., using `chalk` just for `chalk.red()` when a 10-line ANSI wrapper suffices)
- UUID generation when `crypto.randomUUID()` is available
- Deep merge/clone when `structuredClone` suffices
- `dotenv` when the runtime supports `--env-file` natively
- `is-odd`, `is-number`, `left-pad` tier micro-packages

**Heavy mode — Tier 3 expands significantly:**
All of the above, PLUS:
- Any library where the replacement is <=300 lines of owned code (up from ~50 in default)
- Utility libraries where we use any subset of functions, even if heavily used (write an owned utils module)
- HTTP client wrappers — replace with native `fetch` + a thin owned wrapper
- Color/terminal libraries regardless of how many functions we use (chalk, colors, kleur, ansi-colors) — write an ANSI utility
- Argument parsers for CLIs with <20 flags — write a simple parser
- Environment loaders (dotenv, envalid, env-var) — use runtime flags or write a loader
- Date libraries if we use <10 functions (moment, dayjs, date-fns) — write owned date helpers
- Glob/path matching (glob, minimatch, micromatch) if usage is simple — use native `fs.glob` (Node 22+) or write a matcher
- String utilities (camelcase, slugify, pluralize, humanize) — write the specific transformations used
- Validation libraries where we use <30% of their schemas (joi, yup, zod) — write focused validators
- Retry/backoff libraries (p-retry, async-retry) — write a retry function
- Deep equality/diff (deep-equal, fast-deep-equal, deep-diff) — write what's needed for actual use cases
- Event emitter libraries (eventemitter3, mitt) — use native EventEmitter or EventTarget
- Markdown parsers if only rendering basic markdown — consider native or minimal owned parser

Record the full classification as `DEPENDENCY_MAP`.

### 1c: Usage Analysis (Tier 2 & 3 only)

For each Tier 2 and Tier 3 dependency, launch parallel Explore agents (using `AUDIT_MODEL`) to determine actual usage:

Each agent should:
1. Search all source files for imports/requires of the package
2. List every function, class, constant, or type imported from it
3. Count call sites per imported symbol
4. Assess complexity of replacement:
   - **Trivial** (<20 lines): simple wrapper, single utility function, type alias
   - **Moderate** (20-100 lines): multi-function utility, needs tests, edge cases to handle
   - **Complex** (100-300 lines): significant logic, crypto, parsing, protocol implementation
   - **Infeasible** (300+ lines or requires deep domain expertise): keep the dependency
5. Check if the package has known vulnerabilities: `npm audit`, `cargo audit`, `pip-audit`, etc.
6. Check last publish date and maintenance status

Report format:
```
- **{package-name}** — Tier {2|3}
  - Imports: {list of imported symbols}
  - Call sites: {count} across {N} files
  - Functions used: {list with brief description of each}
  - Replacement complexity: {Trivial|Moderate|Complex|Infeasible}
  - Maintenance: {last publish date, open issues, known CVEs}
  - Recommendation: **REMOVE** / **KEEP** / **EVALUATE**
  - Replacement sketch: {brief description of how to replace, if REMOVE}
```

Wait for all agents to complete before proceeding.


## Phase 2: Replacement Plan

1. Read the existing `PLAN.md` (create if it doesn't exist)
2. Filter to only REMOVE recommendations from Phase 1c
3. For EVALUATE recommendations: **Default mode** — treat as KEEP (conservative). **Heavy mode** — treat as REMOVE (aggressive). **Interactive mode** — present to user via `AskUserQuestion` for each. If both `--interactive` and `--heavy` are set, still prompt for each EVALUATE item (interactive takes precedence), but present REMOVE as the default suggestion
4. Group removable dependencies by replacement strategy:
   - **Native replacement**: built-in API replaces the library (e.g., `crypto.randomUUID()`)
   - **Inline replacement**: write a small utility function (e.g., ANSI color wrapper)
   - **Consolidation**: multiple small deps replaced by one owned utility module
5. Estimate total lines of replacement code needed
6. Add a new section to PLAN.md:

```markdown
## Depfree Audit - {YYYY-MM-DD}

Summary: {N} total dependencies. {A} acceptable (Tier 1), {B} audited and kept (Tier 2), {C} to remove (Tier 3).
Estimated replacement code: ~{lines} lines across {files} new/modified files.

### Dependencies to Remove
| Package | Tier | Used Functions | Call Sites | Replacement | Complexity | Risk |
|---------|------|---------------|------------|-------------|------------|------|
| ...     | ...  | ...           | ...        | ...         | ...        | ...  |

### Dependencies Kept (with rationale)
| Package | Tier | Reason Kept |
|---------|------|-------------|
| ...     | ...  | ...         |

### Replacement Tasks
For each dependency to remove:
- [ ] **{package}** — {strategy}. Replace {N} call sites in {M} files. Write {utility name} ({est. lines} lines). Complexity: {level}.
```

7. Print summary table:
```
| Status     | Count | Examples                          |
|------------|-------|-----------------------------------|
| Acceptable | ...   | react, express, typescript, ...   |
| Kept       | ...   | {packages kept with reasons}      |
| Removable  | ...   | {packages to remove}              |
| Total      | ...   |                                   |
```

**GATE: If `--scan-only` was passed, STOP HERE.** Print the summary and exit.

**GATE: If no removable dependencies were found, print "All dependencies are justified" and exit.**

**Interactive mode**: Present the removal plan via `AskUserQuestion`:
```
AskUserQuestion([{
  question: "Dependency removal plan:\n{summary of packages to remove}\n\nProceed with replacement?",
  options: [
    { label: "Proceed", description: "Remove all listed dependencies and write replacement code" },
    { label: "Review individually", description: "Let me approve/reject each removal" },
    { label: "Abort", description: "Stop here — I'll review the plan manually" }
  ]
}])
```

If "Review individually": present each dependency with REMOVE/KEEP options, then proceed with only approved removals.


## Phase 3: Worktree Remediation

### 3a: Setup

1. If `IS_DIRTY` is true: `git stash --include-untracked -m "depfree: pre-audit stash"`
2. Set `DATE` to today's date in YYYY-MM-DD format
3. Create the worktree:
   ```bash
   git worktree add ../depfree-{DATE} -b depfree/{DATE}
   ```
4. Set `WORKTREE_DIR` to `../depfree-{DATE}`

### 3b: Write Replacement Code

For each dependency to remove, spawn a general-purpose agent (using `REMEDIATION_MODEL`) with these instructions:

```
<context>
Project type: {PROJECT_TYPE}
Build command: {BUILD_CMD}
Test command: {TEST_CMD}
Working directory: {WORKTREE_DIR} (this is a git worktree — all work happens here)
</context>

<task>
Remove the dependency on `{PACKAGE_NAME}` and replace with owned code.

Current usage:
{USAGE_DETAILS from Phase 1c — imported symbols, call sites, files}

Replacement strategy: {STRATEGY from Phase 2}

Steps:
1. Write the replacement code (utility function, inline replacement, or native API call)
2. Update ALL import/require statements across the codebase to use the new code
3. Remove the package from the manifest ({package.json, Cargo.toml, etc.})
4. Run `{BUILD_CMD}` to verify compilation
5. Run `{TEST_CMD}` to verify tests pass
6. If tests reference the removed package directly (mocking it, importing test helpers from it), update those tests too
</task>

<guardrails>
- The replacement must preserve behavior for all currently-used call sites and documented invariants
- You may omit handling for input shapes or edge cases that are provably unreachable based on {USAGE_DETAILS}, but do not narrow behavior for any actual call site
- Do NOT introduce new dependencies to replace old ones
- Do NOT use `git add -A` or `git add .` — stage specific files only
- Keep replacement code minimal
- If replacement is more complex than estimated (>2x the estimated lines), report back and skip — do not force a bad replacement. In `HEAVY_MODE`, the ceiling is 300 lines per replacement — only skip if replacement requires deep domain expertise (crypto primitives, binary protocol parsers, codec implementations) or exceeds 300 lines
- Place shared utility replacements in a sensible location (e.g., `src/utils/`, `lib/`, `internal/`) following existing project conventions
- Commit each replacement independently: `refactor: replace {package} with owned {utility/code}`
</guardrails>
```

**Parallelization**: Launch up to 5 agents in parallel. If >5 dependencies to remove, batch them. Assign each agent a non-overlapping set of dependencies (no two agents should modify the same files — if overlap exists, group those dependencies into one agent).

### 3c: Lock File Update

After all replacement agents complete:
1. Remove all replaced packages from the lock file:
   ```bash
   cd {WORKTREE_DIR}
   # Node.js: refresh lockfile only, without running lifecycle scripts
   npm install --package-lock-only --ignore-scripts
   # Or: yarn install --mode=update-lockfile --ignore-scripts
   # Or: pnpm install --lockfile-only --ignore-scripts
   # Rust: let a check refresh Cargo.lock to reflect manifest changes only
   cargo check
   # Python: use the project's lock tool to refresh
   # poetry lock --no-update
   # pip-compile requirements.in
   ```
2. Commit the lock file update:
   ```bash
   git -C {WORKTREE_DIR} add {lock file}
   git -C {WORKTREE_DIR} commit -m "chore: update lock file after dependency removal"
   ```


## Phase 4: Verification

### 4a: Build & Test

1. Run the full build:
   ```bash
   cd {WORKTREE_DIR} && {BUILD_CMD}
   ```
2. Run all tests:
   ```bash
   cd {WORKTREE_DIR} && {TEST_CMD}
   ```
3. If build or tests fail:
   - Identify which replacement caused the failure
   - Attempt to fix in a new commit
   - If unfixable, revert the replacement commit AND re-add the dependency:
     ```bash
     git -C {WORKTREE_DIR} revert <sha>
     ```
     Note the reverted package as "kept — replacement failed"

### 4b: Internal Code Review

1. Generate the diff:
   ```bash
   cd {WORKTREE_DIR} && git diff {DEFAULT_BRANCH}...HEAD
   ```
2. Review all replacement code for:
   - Functional equivalence (does the replacement handle the same inputs/outputs?)
   - Missing edge cases that the original library handled
   - Security regressions (e.g., replacing a sanitization library with a naive regex)
   - Performance regressions (e.g., replacing an optimized parser with O(n^2) code)
   - Correct error handling at system boundaries
3. Fix any issues found, commit each fix separately

### 4c: Verify No Phantom Dependencies

Confirm no source file still references a removed package:
```bash
cd {WORKTREE_DIR}
for pkg in {REMOVED_PACKAGES}; do
  grep -r "$pkg" \
    --include='*.ts' \
    --include='*.js' \
    --include='*.tsx' \
    --include='*.jsx' \
    --include='*.py' \
    --include='*.rs' \
    --include='*.go' \
    --include='*.rb' \
    . && echo "WARN: $pkg still referenced"
done
```
Fix any remaining references.


## Phase 5: PR Creation

### 5a: Push & Create PR

```bash
cd {WORKTREE_DIR}
git push -u origin depfree/{DATE}
```

Create the PR:

**GitHub:**
```bash
HEAVY_SUFFIX=""
if [ "$HEAVY_MODE" = "true" ]; then HEAVY_SUFFIX=" (heavy mode)"; fi

PR_TITLE="refactor: remove {N} unnecessary dependencies${HEAVY_SUFFIX}"
PR_BODY="$(cat <<'EOF'
## Depfree Audit — Dependency Removal__HEAVY__

### Summary
Removed {N} unnecessary third-party dependencies and replaced with owned code.
Estimated supply chain attack surface reduction: {N} packages ({transitive count} including transitive deps).

### Dependencies Removed
| Package | Replacement | Lines of Owned Code |
|---------|-------------|-------------------|
{table of removed packages}

### Dependencies Kept (audited)
{count} dependencies audited and kept with rationale. See PLAN.md for details.

### Replacement Code
{bulleted list of new utility files or inline changes}

### Verification
- [ ] Build passes
- [ ] All tests pass
- [ ] No phantom references to removed packages
- [ ] Lock file updated
EOF
)"
PR_BODY="${PR_BODY//__HEAVY__/$HEAVY_SUFFIX}"

gh pr create --head depfree/{DATE} --base {DEFAULT_BRANCH} \
  --title "$PR_TITLE" \
  --body "$PR_BODY"
```

**GitLab:**
```bash
glab mr create --source-branch depfree/{DATE} --target-branch {DEFAULT_BRANCH} \
  --title "refactor: remove {N} unnecessary dependencies" --description "..."
```

Record `PR_NUMBER` and `PR_URL`.

**GATE: If `--no-merge` was passed, STOP HERE.** Print the PR URL and summary.

### 5b: CI Verification

1. Wait 30 seconds for CI to start
2. Poll CI status:
   ```bash
   gh pr checks {PR_NUMBER}
   ```
   Poll every 30 seconds, max 10 minutes.
3. If CI fails:
   - Fetch failure logs, diagnose, fix, commit, push
   - Max 3 fix attempts before informing the user

### 5c: Copilot Review Loop (GitHub only)

If `VCS_HOST` is `github`, run the Copilot review loop using the shared template:

!`cat ~/.claude/lib/copilot-review-loop.md`

Pass: `{PR_NUMBER}`, `{OWNER}/{REPO}`, `depfree/{DATE}`, and `{BUILD_CMD}`.

### 5d: Merge

**Default mode**: Auto-merge if review is clean.
**Interactive mode**: Ask user for merge approval.

```bash
gh pr merge {PR_NUMBER} --merge
```


## Phase 6: Cleanup

1. Remove the worktree:
   ```bash
   git worktree remove {WORKTREE_DIR}
   ```
2. Delete the local branch:
   ```bash
   git checkout {DEFAULT_BRANCH}
   git branch -D depfree/{DATE}
   if git ls-remote --exit-code --heads origin "depfree/{DATE}" >/dev/null 2>&1; then
       git push origin --delete "depfree/{DATE}"
   else
       echo "warning: remote branch depfree/{DATE} not found or already deleted"
   fi
   ```
3. Restore stashed changes if applicable:
   ```bash
   git stash pop
   ```
4. Update PLAN.md:
   - Mark completed removals with `[x]`
   - Add PR link
   - Note any packages that were reverted
5. Print the final summary:

```
| Package          | Status   | Replacement              | Lines |
|------------------|----------|--------------------------|-------|
| {package}        | Removed  | {utility/native API}     | {N}   |
| {package}        | Kept     | {reason}                 | —     |
| {package}        | Reverted | {reason for failure}     | —     |

Total dependencies before: {before}
Total dependencies after:  {after}
Packages removed: {count}
Owned replacement code: ~{lines} lines
Transitive deps eliminated: ~{count} (estimated)
```


## Error Recovery

- **Agent failure**: continue with remaining agents, note gaps in the summary
- **Build failure in worktree**: attempt fix; if unfixable, revert the problematic replacement and re-add the dependency
- **Push failure**: `git pull --rebase --autostash` then retry push
- **CI failure on PR**: investigate logs, fix, push (max 3 attempts)
- **Replacement too complex**: if an agent reports that replacement exceeds 2x estimated complexity, skip that dependency and keep it with a note
- **Test failure from replacement**: if tests fail and the fix isn't obvious, revert the replacement — a working dependency is better than broken owned code
- **Existing worktree found at startup**: ask user — resume or clean up

!`cat ~/.claude/lib/graphql-escaping.md`

## Notes

- This command complements `/do:better` — run `depfree` for dependency hygiene, `better` for code quality
- All remediation happens in an isolated worktree — the user's working directory is never modified
- **Default mode**: the threshold for "acceptable" libraries is deliberately generous — the goal is to remove obvious attack surface, not to rewrite everything
- **Heavy mode**: the threshold narrows to foundational frameworks only — the goal is to own as much code as feasibly possible, eliminating supply chain risk from individual maintainers and small projects
- Replacement code should be minimal and focused — don't over-engineer utilities that replace single-purpose packages
- **Default mode**: when in doubt, keep the dependency. A maintained library is better than a buggy reimplementation
- **Heavy mode**: when in doubt, replace it. Write owned code unless the replacement requires crypto primitives, binary protocol parsing, or deep domain expertise that would be unsafe to reimplement
- **Default mode**: devDependencies are lower priority since they don't ship to production. **Heavy mode**: devDependencies are audited on par with production deps — unmaintained build tools still pose supply chain risk
- For monorepos, audit the root manifest and each workspace package manifest
