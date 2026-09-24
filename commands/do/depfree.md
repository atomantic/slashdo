---
description: Audit third-party dependencies and remove unnecessary ones by writing replacement code
argument-hint: "[--interactive] [--scan-only] [--no-merge] [--heavy] [--review-with <agent>[,<agent>...]] [--review-iterations <n>] [--review-mode <series|parallel>] [--review-stop-on-findings|--review-stop-on-clean] [--reviewer-applies] [--issues-label <name>] [specific packages to evaluate]"
---

# Depfree — Dependency Freedom Audit

Audit all third-party dependencies, classify them as acceptable (large, widely-audited) or suspect (small, replaceable), analyze actual usage of suspect dependencies, and replace them with owned code where feasible.

Every small library is an attack surface. In default mode, large, widely-audited libraries (express, react, d3, three.js, next, vue, fastify, lodash-es, etc.) are acceptable; smaller ones, or ones where only a helper function is used, get replaced with owned code. Heavy mode raises the bar much higher.

**Default mode: fully autonomous.** Balanced model profile, no prompting. **`--interactive`** pauses for classification approval, replacement review, and merge confirmation.

Parse `$ARGUMENTS` for:
- **`--interactive`**: pause at each decision point for user approval
- **`--scan-only`**: run Phase 0 + 1 + 2 only (audit and plan), skip remediation — no worktree, no code changes, no PRs. Every surviving finding is filed as a labelled tracker issue before the run exits, not just the deferred subset (see the Phase 2 gate)
- **`--no-merge`**: run through PR creation, skip the review loop and merge
- **`--heavy`**: aggressive mode — only keep foundational frameworks and language runtimes; replace everything else that is feasibly replaceable (see Heavy Mode)

The `--review-with`, `--review-stop-on-findings`/`--review-stop-on-clean`, `--review-mode`, `--reviewer-applies`, and `--review-iterations` grammar governing the Phase 5c review loop on the PR — entry syntax, per-reviewer `~opt`/`~max=`/`~effort=` suffixes, dedupe rules, and model-bracket forwarding — is owned by the shared partial below; do not restate it here:

!`cat ~/.claude/lib/review-flags.md`

After parsing the review flags above, apply any **saved defaults** (set via `/do:config`) to the flags the user did NOT pass (the review flags **and** `--issues-label`) — an explicit flag, or `--review-with none`, always overrides a saved default:

!`cat ~/.claude/lib/review-config-defaults.md`

!`cat ~/.claude/lib/config-defaults-issues-merge.md`

- **`--issues-label <name>`**: the label on the GitHub/GitLab issues deferred removals are filed as (see Phase 2). Set `PLAN_LABEL` from `--issues-label`, else the saved `issues-label` default, else `plan`. A saved `issues` key is ignored.
- **`--issues`**: deprecated no-op; print once: `--issues is now the default (PLAN.md mode was removed); the flag can be dropped.`
- **`--no-issues`**: abort with `--no-issues is no longer supported: PLAN.md mode was removed. slashdo records work only in the project's issue tracker.`
- **Specific packages**: limit audit scope to named packages (e.g., "chalk dotenv")

Set `HEAVY_MODE` to `true` if `--heavy` was passed, `false` otherwise.

## Configuration

### Default Mode (autonomous)

Use the **Balanced** model profile automatically (`AUDIT_MODEL_TIER=medium`, `REMEDIATION_MODEL_TIER=medium`).

### Interactive Mode (`--interactive`)

Present the user with configuration options using `AskUserQuestion`:

```
AskUserQuestion([{
  question: "Which model profile for audit and remediation agents?",
  header: "Model",
  multiSelect: false,
  options: [
    { label: "Quality", description: "Strongest available model for all agents — fewest false positives, best results, highest cost" },
    { label: "Balanced (Recommended)", description: "Workhorse model for audit and remediation — good quality at moderate cost" },
    { label: "Budget", description: "Cheapest model for audit, workhorse for remediation — fastest and cheapest" }
  ]
}])
```

Record the selection as `MODEL_PROFILE` and derive two **tiers**:
- `AUDIT_MODEL_TIER`: `heavy` / `medium` / `light` based on profile
- `REMEDIATION_MODEL_TIER`: `heavy` / `medium` / `medium` based on profile

**These are tiers, not model names — resolve each against the host you're running on**, per [lib/model-tiers.md](../../lib/model-tiers.md). `heavy` means **this host's strongest available model, named by its alias** (on Claude Code, `model: "opus"`); never write a fully-qualified version ID. A host that can't set a per-agent model runs at the session default — state it and continue. If a `heavy` dispatch is rejected because the account lacks that tier, retry once with `model` omitted, note the degrade, and continue.

> **Three unrelated things here are called "tier" or "heavy":** `AUDIT_MODEL_TIER`/`REMEDIATION_MODEL_TIER` select **which model an agent runs on**; dependency **Tier 1/2/3** (Phase 1b) rates **how replaceable a package is**; `HEAVY_MODE` (`--heavy`) sets **how aggressive the removal bar is**. `--heavy` does *not* raise the model tier.

## Heavy Mode (`--heavy`)

"Own everything we feasibly can": only foundational frameworks, core platform tooling, and language-level runtimes survive. When `HEAVY_MODE` is `true`:

1. **Tier 1 is narrowed** to foundational frameworks and runtimes (see Phase 1b); lodash, chalk, dotenv, commander, yargs, uuid, axios, etc. move to Tier 2 or 3.
2. **EVALUATE recommendations become REMOVE** — when in doubt, replace.
3. **Complexity ceiling rises** to 300 lines per replacement (default: agents bail at ~2x estimate). Only truly infeasible replacements (deep domain expertise, crypto primitives, protocol parsers) are skipped.
4. **Maintenance status is irrelevant** — the question is "can we own this code?"
5. **DevDependencies get equal priority** with production dependencies (overriding the Phase 1a deprioritization).

## Compaction Guidance

When compacting during this workflow, always preserve:
- The `DEPENDENCY_MAP` (complete classification of all dependencies)
- The `PRIOR_DECISIONS` map loaded from `./docs/DEPS.md`
- All REMOVABLE findings with package names and usage details
- The current phase number and what phases remain
- All PR numbers and URLs created so far
- `BUILD_CMD`, `TEST_CMD`, `PROJECT_TYPE`, `WORKTREE_DIR`, `REPO_DIR` values
- `VCS_HOST`, `CLI_TOOL`, `GH_HOST`, `TRACKER_AVAILABLE`, `DEFAULT_BRANCH`, `CURRENT_BRANCH`
- `HEAVY_MODE` flag


## Phase 0: Discovery & Setup

### 0a: VCS Host Detection
Resolve `VCS_HOST` and `CLI_TOOL` here, before any phase reaches for a forge CLI:

!read lib/vcs-host.md

- **When `VCS_HOST=github`, also derive `GH_HOST` from the `origin` remote** and carry it in state, following the shared derivation (and its per-host auth precheck) included below. The Phase 6 host-side reviewer loops' GitHub verbs use `gh api`, which ignores the repo remote and defaults to github.com — on a GitHub Enterprise repo `GH_HOST` must be forwarded to them or they poll the wrong host and time out.
- **Record `TRACKER_AVAILABLE` once.** `true` when the tracker gate's `TRACKER_CLI` is set and reaches this repo with its issues feature enabled; otherwise `false`. Deferred removals are filed as issues only when it is `true`; when `false` the run continues, files nothing, and lists every deferred removal (title, one-line rationale, `file:line`) in the final report under "Deferred (not filed — no issue tracker available)". Never write PLAN.md as a fallback.

**GitHub only — skip the snippet below entirely on GitLab**, whose `glab` calls resolve the host from the remote themselves and where its `gh auth` precheck would abort the run.

!`cat ~/.claude/lib/gh-host.md`

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

### 0e: Load Prior Decisions

Read `{REPO_DIR}/docs/DEPS.md` if it exists — the decision record from prior `/do:depfree` runs, used to skip re-evaluation of already-audited dependencies.

Parse the file into `PRIOR_DECISIONS` — a map keyed by package name, with values:
- `decision`: one of `KEPT_TIER1`, `KEPT_AUDITED`, `KEPT_TRANSITIVE`, `REMOVED`, `REVERTED`, `SKIPPED_INFEASIBLE`
- `major_version`: the major version that was evaluated (e.g., `18` for react@18.x)
- `mode`: the mode the decision was made under (`default`, `heavy`, or `both`)
- `reason`: the rationale recorded
- `decision_date`: ISO date the decision was made

If the file does not exist, set `PRIOR_DECISIONS` to an empty map. The file is created in Phase 4c only when remediation runs (i.e., `--scan-only` was not passed).

A prior decision is **valid for skipping re-evaluation** when ALL of these are true:
1. The package is still in the manifest at the same major version
2. The recorded mode matches the current run mode (a `default` decision does NOT skip a `heavy` run; `both` skips either; `heavy` skips a `default` run)
3. The decision is not `REMOVED` or `REVERTED` (those packages should not be in the manifest; if they are, treat as new)

Otherwise, the dependency is re-evaluated in Phase 1 normally.


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

Then run the whole-tree vulnerability audit **once** (`npm audit --json`, `cargo audit --json`, `pip-audit -f json`, etc., per `PROJECT_TYPE`) and index the results as `VULN_MAP`, keyed by **package name + installed version** (not name alone — a monorepo or lock file can carry multiple versions of the same package, and a finding against one version must not be attributed to another). Phase 1c's per-package usage analysis reads from `VULN_MAP` instead of re-running the audit for every Tier 2/3 dependency.

### 1b: Classify Dependencies

For each dependency, first check `PRIOR_DECISIONS` (from Phase 0e). If a valid prior decision exists for the package + major version + mode, carry it forward:
- `KEPT_TIER1` → classify as **Tier 1** (skip further audit)
- `KEPT_AUDITED` → classify as **Tier 2** with recommendation **KEEP** (skip Phase 1c usage analysis)
- `KEPT_TRANSITIVE` → classify as **Tier 2** with recommendation **KEEP (transitive)** (skip Phase 1c usage analysis and Phase 1d transitive check; the prior `Kept Via` chain is recorded)
- `SKIPPED_INFEASIBLE` → classify as **Tier 2** with recommendation **KEEP** (skip Phase 1c usage analysis)

Record carried-forward decisions in `DEPENDENCY_MAP` with a `from_prior: true` flag. Print one line per skipped dependency: `↻ {package}@{major} — carrying forward prior {decision} ({decision_date})`.

For all other dependencies (no prior decision, major version bump, or mode escalation from default → heavy), classify into one of three tiers:

**Tier 1 — ACCEPTABLE (keep without question):**
Large, widely-audited, foundational libraries. Examples by ecosystem:

**Default mode:**
- **Node.js**: react, next, vue, express, fastify, hono, typescript, eslint, prettier, webpack, vite, jest, vitest, mocha, d3, three, prisma, drizzle, @types/*, tailwindcss, postcss
- **Rust**: tokio, serde, clap, reqwest, hyper, tracing, sqlx, axum, actix-web
- **Python**: django, flask, fastapi, sqlalchemy, pandas, numpy, scipy, pytest, requests, httpx, pydantic
- **Go**: standard library (no third-party needed for most things)
- **Ruby**: rails, rspec, sidekiq, puma, devise
- Any dependency with >10M weekly downloads (npm) or equivalent popularity metric for the ecosystem

**Heavy mode (`HEAVY_MODE=true`) — Tier 1 is restricted to foundational frameworks, core platform tooling, and runtimes:**
- **Node.js**: react, next, vue, express, fastify, typescript, webpack, vite, tailwindcss, postcss, prisma, drizzle
- **Rust**: tokio, serde, hyper, sqlx, axum, actix-web
- **Python**: django, flask, fastapi, sqlalchemy, pandas, numpy, scipy, pydantic
- **Go**: standard library only
- **Ruby**: rails, puma
- Download count is NOT a factor — popularity does not exempt a library from replacement
- Libraries that are wrappers, utilities, CLIs, or single-purpose tools are Tier 2 or 3 regardless of popularity
- Linting/formatting tools (eslint, prettier) in heavy mode: remain Tier 1 when required by CI or organization-wide standards (do not attempt replacement); otherwise treat as Tier 2 (audit usage, but do not rewrite their behavior)
- Examples of libraries that DROP from Tier 1 in heavy mode: lodash, chalk, commander, dotenv, uuid, axios, moment, requests, clap, tracing — any single-purpose wrapper or utility collection, regardless of ecosystem or popularity, moves to Tier 2/3 for evaluation

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

Skip any dependency with `from_prior: true`. For all remaining Tier 2 and Tier 3 dependencies, launch parallel Explore agents (using `AUDIT_MODEL_TIER`) to determine actual usage:

Each agent should:
1. Search all source files for imports/requires of the package
2. List every function, class, constant, or type imported from it
3. Count call sites per imported symbol
4. Assess complexity of replacement:
   - **Trivial** (<20 lines): simple wrapper, single utility function, type alias
   - **Moderate** (20-100 lines): multi-function utility, needs tests, edge cases to handle
   - **Complex** (100-300 lines): significant logic, crypto, parsing, protocol implementation
   - **Infeasible** (300+ lines or requires deep domain expertise): keep the dependency
5. Look up known vulnerabilities for the package's installed version in the whole-tree `VULN_MAP` from Phase 1a (do not re-run the audit per package)
6. Check last publish date and maintenance status
7. Check for **consolidation opportunities**: does this package overlap in purpose with another dependency (two state managers, two HTTP clients, two date libraries, two test runners)? If so, flag which kept dependency could absorb this one's usage

Report format:
```
- **{package-name}** — Tier {2|3}
  - Imports: {list of imported symbols}
  - Call sites: {count} across {N} files
  - Functions used: {list with brief description of each}
  - Replacement complexity: {Trivial|Moderate|Complex|Infeasible}
  - Maintenance: {last publish date, open issues, known CVEs}
  - Recommendation: **REMOVE** / **KEEP** / **EVALUATE**
  - Consolidation target: {kept dependency that covers the same purpose, if any — e.g., "redux" for zustand, "dayjs" for moment}
  - Replacement sketch: {brief description of how to replace, if REMOVE}
```

Wait for all agents to complete before proceeding.

### 1d: Transitive Dependency Check

Removing a direct dependency that remains in the lock file as a transitive dep of a kept package provides zero supply chain benefit — the code is still installed and executable. For each REMOVE candidate:

1. Check if it appears as a transitive dependency of any Tier 1 or kept Tier 2 package (a nested entry under a kept package's tree, not just the project root):
   - **Node.js (npm)**: `npm ls {package}`
   - **Node.js (yarn)**: `yarn why {package}`
   - **Node.js (pnpm)**: `pnpm why {package}`
   - **Rust**: `cargo tree -i {package}`
   - **Python**: `pipdeptree -r -p {package}` or `uv pip tree --invert | grep {package}` (record the full chain)
   - **Go**: `go mod graph | grep {package}`
   - **Ruby**: `bundle why {gem}`
2. If it IS transitive of a kept package, determine the **removal motivation**:
   - **Supply chain only** (flagged purely for attack surface reduction) → downgrade to **KEEP (transitive)** — removing the direct entry doesn't remove the code from the lock file or the runtime.
   - **Consolidation** (overlaps in purpose with another kept dependency, e.g., zustand→redux, moment→dayjs, lodash→native utils) → keep the **REMOVE** recommendation — the value is eliminating redundant usage from *our* code. Record the consolidation target (e.g., "consolidate state management into redux").
   - Record the dependency chain in either case, root-to-leaf (e.g., `@react-three/fiber → tunnel-rat → zustand`)
3. Exception: if the direct dependency pulls a **different major version** than the transitive one, keep the REMOVE recommendation but note the version difference.

Update `DEPENDENCY_MAP` with transitive check results before proceeding to Phase 2.


## Phase 2: Replacement Plan

> Keep the replacement plan (steps 2–5 below) as your **in-run working plan in
> context** — the plan is never written to a file. For any removal you **defer**,
> file a labeled tracker issue — see the disposition partial below. Report the
> created and reused issue numbers (`#<n>`) in the Phase 2 summary. Reuse
> `CLI_TOOL` from Phase 0.

Unless `TRACKER_AVAILABLE=false`, read the tracker setup and filing partials now:

!read lib/plan-issue-setup.md
!read lib/plan-issue-filing.md

1. Fetch `EXISTING_ISSUES` per those partials (skip when `TRACKER_AVAILABLE=false`).
2. Filter to only REMOVE recommendations from Phase 1c/1d (exclude any downgraded to KEEP (transitive) in Phase 1d)
3. For EVALUATE recommendations: **Default mode** — treat as KEEP (conservative). **Heavy mode** — treat as REMOVE (see Heavy Mode). **Interactive mode** — present to user via `AskUserQuestion` for each. If both `--interactive` and `--heavy` are set, still prompt for each EVALUATE item (interactive takes precedence), but present REMOVE as the default suggestion
4. Group removable dependencies by replacement strategy:
   - **Native replacement**: built-in API replaces the library (e.g., `crypto.randomUUID()`)
   - **Inline replacement**: write a small utility function (e.g., ANSI color wrapper)
   - **Consolidation**: multiple small deps replaced by one owned utility module
5. Estimate total lines of replacement code needed
6. **Disposition.** A planned removal not carried out this run is **deferred** (under `--scan-only`, the gate below files everything instead): file each as a labeled issue, deduped against `EXISTING_ISSUES`, per the partials above — or, when `TRACKER_AVAILABLE=false`, hold them for the final report's "Deferred (not filed — no issue tracker available)" list.

7. Print summary table:
```
| Status     | Count | Examples                          |
|------------|-------|-----------------------------------|
| Acceptable | ...   | react, express, typescript, ...   |
| Kept       | ...   | {packages kept with reasons}      |
| Removable  | ...   | {packages to remove}              |
| Total      | ...   |                                   |
```

**GATE: If `--scan-only` was passed, STOP HERE** — but not before doing the one thing a scan-only run exists to do: **file every surviving finding as an issue first**, then print the summary and exit. (When `TRACKER_AVAILABLE=false`, list them under "Deferred (not filed — no issue tracker available)" instead.)

**Filing every surviving finding** means all of them, not just the ones the disposition rules would defer — the filed issues ARE the run's output. Apply the disposition partial's labels, dedup-against-`EXISTING_ISSUES`, and title/body rules, and report the created and reused `#<number>`s in the summary. Do not open a worktree or write any code.

**GATE: If no removable dependencies were found, print "All dependencies are justified" and exit.**

**Interactive mode**: Present the removal plan via `AskUserQuestion`:
```
AskUserQuestion([{
  question: "Dependency removal plan:\n{summary of packages to remove}\n\nProceed with replacement?",
  options: [
    { label: "Proceed", description: "Remove all listed dependencies and write replacement code" },
    { label: "Review individually", description: "Let me approve/reject each removal" },
    { label: "Abort", description: "Stop here without making changes" }
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

For each dependency to remove, spawn a general-purpose agent (using `REMEDIATION_MODEL_TIER`) with these instructions:

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
3. Run `{BUILD_CMD}` to verify compilation — the manifest still lists `{PACKAGE_NAME}` at this point, so the module resolves normally; that's expected
4. Run `{TEST_CMD}` to verify tests pass
5. If tests reference the removed package directly (mocking it, importing test helpers from it), update those tests too
6. Commit your code changes. **Do NOT touch the manifest** ({package.json, Cargo.toml, pyproject.toml, go.mod, Gemfile, etc.) or any lock file — every agent in this batch runs in the same `{WORKTREE_DIR}` in parallel, so a shared manifest edited by more than one agent races (partial writes, lost edits, index.lock contention). The orchestrator removes all replaced packages from the manifest in one pass, in Phase 3c, after every agent here has finished
</task>

<guardrails>
- The replacement must preserve behavior for all currently-used call sites and documented invariants
- You may omit handling for input shapes or edge cases that are provably unreachable based on {USAGE_DETAILS}, but do not narrow behavior for any actual call site
- Do NOT introduce new dependencies to replace old ones
- Do NOT use `git add -A` or `git add .` — stage specific files only
- Do NOT edit the manifest or lock file — see step 6 above
- Keep replacement code minimal
- If replacement is more complex than estimated (>2x the estimated lines), report back and skip — do not force a bad replacement. In `HEAVY_MODE`, use the raised ceiling from Heavy Mode above (300 lines) instead of the 2x estimate — only skip if replacement requires deep domain expertise (crypto primitives, binary protocol parsers, codec implementations) or exceeds that ceiling
- Place shared utility replacements in a sensible location (e.g., `src/utils/`, `lib/`, `internal/`) following existing project conventions
- Commit each replacement independently: `refactor: replace {package} with owned {utility/code}`. If `git commit` fails on a transient `index.lock` (another agent committing at the same instant), wait briefly and retry once before reporting failure
</guardrails>
```

**Parallelization**: Launch up to 5 agents in parallel; batch if >5 dependencies. Assign each agent a non-overlapping set of dependencies (if two would modify the same files, group them into one agent). Agents never edit the manifest or lock file (step 6 above), so manifest contention cannot occur regardless of grouping; grouping still avoids two agents editing the same source files.

### 3c: Lock File Update

After all replacement agents complete, run these steps once, in the orchestrator — never inside a parallel agent:

1. Remove all replaced packages from the manifest, in one pass:
   ```bash
   cd {WORKTREE_DIR}
   # Edit package.json / Cargo.toml / pyproject.toml / go.mod / Gemfile / etc.
   # to drop every dependency in {REMOVED_PACKAGES}
   ```
   Commit the manifest change on its own: `git -C {WORKTREE_DIR} commit -m "chore: remove replaced dependencies from manifest"`.
2. Refresh the lock file to match the new manifest:
   ```bash
   cd {WORKTREE_DIR}
   # Node.js (npm): refresh lockfile only, without running lifecycle scripts
   npm install --package-lock-only --ignore-scripts
   # Node.js (yarn Berry, 2.x+): refresh lockfile only
   # yarn install --mode=update-lockfile
   # Node.js (pnpm):
   # pnpm install --lockfile-only --ignore-scripts
   # Rust: refresh Cargo.lock for the removed entries only, without upgrading anything else
   # cargo update --workspace
   # Python (Poetry 2.x — `poetry lock --no-update` was removed; plain `poetry lock` only
   # touches entries affected by the pyproject.toml change):
   # poetry lock
   # Python (pip-tools):
   # pip-compile requirements.in
   ```
3. Commit the lock file update:
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
2. Review the diff for behavior parity with the removed library — same inputs/outputs, edge cases the original handled, no new security or performance regressions (e.g. a naive regex replacing a sanitization library, or O(n^2) code replacing an optimized parser), and correct error handling at system boundaries
3. Fix any issues found, commit each fix separately

### 4c: Update DEPS.md

Write the consolidated decision record to `{WORKTREE_DIR}/docs/DEPS.md`. Create the `docs/` directory if it does not exist.

Build the new file from:
1. **All carried-forward entries** from `PRIOR_DECISIONS` whose packages are still in the manifest at the same major version (preserve `decision_date` and `mode`)
2. **New decisions** from this run:
   - Each Tier 1 package → `KEPT_TIER1`
   - Each Tier 2 package with KEEP recommendation → `KEPT_AUDITED`
   - Each Tier 2/3 package downgraded to KEEP (transitive) in Phase 1d → `KEPT_TRANSITIVE`
   - Each successfully removed package → `REMOVED`
   - Each reverted package (replacement failed in 4a) → `REVERTED`
   - Each skipped package (replacement infeasible / >2x estimate / >300 lines in heavy) → `SKIPPED_INFEASIBLE`
3. **Mode merging**: if a prior decision was `default` and this run is `heavy` (or vice versa) and both runs reached the same conclusion for the same package + major version, set `mode` to `both`. Otherwise the new run's mode overwrites.

Use this layout:

```markdown
# Dependency Audit Decisions

Auto-maintained by `/do:depfree`. Records prior audit decisions so repeat runs
skip re-evaluation. Re-audit triggers: major version bump, heavy-mode run after
default-mode decision, or manual deletion of an entry.

Last updated: {YYYY-MM-DD}

## Kept — Tier 1 (foundational)

| Package | Major | Mode | Reviewed | Reason |
|---------|-------|------|----------|--------|
| ...     | ...   | ...  | ...      | ...    |

## Kept — Tier 2 (audited)

| Package | Major | Mode | Reviewed | Reason |
|---------|-------|------|----------|--------|

## Kept — Transitive

| Package | Major | Mode | Reviewed | Kept Via |
|---------|-------|------|----------|----------|

## Removed

| Package | Major | Mode | Removed | Replacement |
|---------|-------|------|---------|-------------|

## Reverted (replacement failed, kept in manifest)

| Package | Major | Mode | Reviewed | Reason |
|---------|-------|------|----------|--------|

## Skipped (replacement infeasible)

| Package | Major | Mode | Reviewed | Reason |
|---------|-------|------|----------|--------|
```

Sort each section alphabetically by package name.

Commit the change (only if the file actually changed):
```bash
git -C {WORKTREE_DIR} add -- docs/DEPS.md
if ! git -C {WORKTREE_DIR} diff --cached --quiet -- docs/DEPS.md; then
  git -C {WORKTREE_DIR} commit -m "docs: update DEPS.md with audit decisions"
fi
```

### 4d: Verify No Phantom Dependencies

Confirm no source file still imports/requires/uses a removed package. A bare word match (`grep -r "$pkg"`) is too noisy for a package name that also reads as an English word or a common identifier (`uuid`, `debug`, `color`) — it flags legitimate hits inside the very replacement files this run just wrote (a comment, a variable named after the concept, a string literal) as well as unrelated code. Anchor the match to actual import syntax instead, per ecosystem, and exclude the removed package's own manifest/lock entries (already handled in 3c) and generated/vendor directories:
```bash
cd {WORKTREE_DIR}
for pkg in {REMOVED_PACKAGES}; do
  grep -rnE "(^|[^.$_[:alnum:]])(import .*['\"]${pkg}(/|['\"])|require\(['\"]${pkg}(/|['\"])|from ['\"]${pkg}(/|['\"]))" \
    --include='*.ts' --include='*.js' --include='*.tsx' --include='*.jsx' \
    --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=build . \
    && echo "WARN: $pkg still imported (JS/TS)"
  grep -rnE "^[[:space:]]*(from|import) ${pkg}([. ]|$)" \
    --include='*.py' --exclude-dir=.venv --exclude-dir=venv . \
    && echo "WARN: $pkg still imported (Python)"
  grep -rnE "^[[:space:]]*use ${pkg//-/_}(::| |;)" \
    --include='*.rs' --exclude-dir=target . \
    && echo "WARN: $pkg still used (Rust)"
  grep -rnE "\"[^\"]*/${pkg}\"" \
    --include='*.go' --exclude-dir=vendor . \
    && echo "WARN: $pkg still imported (Go)"
  grep -rnE "require ['\"]${pkg}['\"]" \
    --include='*.rb' --exclude-dir=vendor . \
    && echo "WARN: $pkg still required (Ruby)"
done
```
Run only the ecosystem block(s) matching `{PROJECT_TYPE}`. Fix any remaining references; a hit inside a comment or a string literal that isn't an actual import is not a phantom dependency — confirm by reading the flagged line before treating it as one.


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
HEAVY_HEADING=""
if [ "$HEAVY_MODE" = "true" ]; then
  HEAVY_SUFFIX=" (heavy mode)"
  HEAVY_HEADING=" (Heavy Mode)"
fi

PR_TITLE="refactor: remove {N} unnecessary dependencies${HEAVY_SUFFIX}"
PR_BODY="## Depfree Audit — Dependency Removal${HEAVY_HEADING}

### Summary
Removed {N} unnecessary third-party dependencies and replaced with owned code.
Estimated supply chain attack surface reduction: {N} packages ({transitive count} including transitive deps).

### Dependencies Removed
| Package | Replacement | Lines of Owned Code |
|---------|-------------|-------------------|
{table of removed packages}

### Dependencies Kept (audited)
{count} dependencies audited and kept with rationale (recorded in `docs/DEPS.md`).

### Replacement Code
{bulleted list of new utility files or inline changes}

### Verification
- [ ] Build passes
- [ ] All tests pass
- [ ] No phantom references to removed packages
- [ ] Lock file updated
- [ ] \`docs/DEPS.md\` updated with audit decisions
"

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

**GATE: If `--no-merge` was passed, skip straight to Phase 6 cleanup** (skip 5b, 5c, 5d). Print the PR/MR URL and summary first. Phase 6 still runs — in particular its stash restore — so a `--no-merge` run never strands the pre-audit stash; only the merge and its cleanup-owned remote-branch deletion are skipped (the PR/MR itself, and its branch, are left exactly as opened).

### 5b: CI Verification

1. Wait 30 seconds for CI/the pipeline to start.
2. Poll status:
   - **GitHub:**
     ```bash
     gh pr checks {PR_NUMBER}
     ```
     Poll every 30 seconds, max 10 minutes.
   - **GitLab:**
     ```bash
     glab ci status --wait --branch depfree/{DATE}
     ```
     This blocks until the head pipeline finishes (`success`/`failed`/`canceled`/etc). GitLab has no separate list of required checks.
3. If CI/the pipeline fails:
   - Fetch failure logs, diagnose, fix, commit, push
   - Max 3 fix attempts before informing the user

### 5c: Review Loop

**GATE — no reviewer requested: If `REVIEW_AGENTS` is empty** (no `--review-with` was passed), **skip this phase AND the Phase 5d merge.** There is no default reviewer. Leave the PR open for manual review, print its URL and summary, then proceed to Phase 6 cleanup.

Otherwise, run the **multi-reviewer loop** over `REVIEW_AGENTS`, in order, with the parsed `{REVIEW_STOP_MODE}`, `{REVIEW_MODE}` (series default — reviewers run one-at-a-time so each sees the prior's fixes; `parallel` collects reviews concurrently then applies the union once), `{REVIEWER_APPLIES}`, and `{REVIEW_ITERATIONS}` (the last caps copilot and `@<login>` passes only; local-agent and ollama passes use their own fixed iteration caps). Read the wrapper, then only the inner loop bodies it dispatches to for the reviewer kinds in `REVIEW_AGENTS`.

For each host-side entry, resolve the caller-owned `{WAIT_SCHEDULE}` before dispatch:

- `copilot` — use the previous Copilot review duration on this PR (default 60 seconds if none); max wait 3x that duration, minimum 90 seconds, maximum 5 minutes; poll every 5s, 5s, 10s, 10s, then 15s.
- `@<login>` — expected duration 5 minutes; max wait 3x that duration, minimum 3 minutes, maximum 15 minutes; poll every 10s, 10s, 20s, 20s, then 30s.

Forward only the selected schedule as `{WAIT_SCHEDULE}`; never give one pass both schedules.

!read lib/multi-reviewer-loop.md

### Inner loop bodies (referenced by the wrapper)

Read only the bodies for reviewer kinds present in the agent list.

For every `copilot` or `@<login>` entry, read the shared host-reviewer template (its sub-agent runs the `{CODE_HOST}` verb file):

!read lib/host-reviewer-loop.md

Only for `copilot` entries on GitHub, also read the Copilot delta:

!read lib/copilot-review-loop.md

Only for an entry that is none of `copilot`, `ollama`, or `@<login>` (every other slug — the fixed CLIs and `cmd[<invocation>]` alike — dispatches through this one loop; a future addition needs no new gate here):

!read lib/local-agent-review-loop.md

Only for `ollama` entries:

!read lib/ollama-review-loop.md

Pass: `{REVIEW_AGENTS}`, `{REVIEW_STOP_MODE}`, `{REVIEW_MODE}`, `{REVIEWER_APPLIES}`, `{REVIEW_MODELS}` (the saved per-agent default models resolved in Parse Arguments — every local reviewer but `cmd` reads it; without it a saved `review-models` default is silently ignored), `{PR_NUMBER}`, `{OWNER}/{REPO}`, `{GH_HOST}` (so the host-side loops' `gh api` calls hit the right host on GitHub Enterprise), the per-entry `{WAIT_SCHEDULE}` selected above, `depfree/{DATE}` (the branch the local-agent loop checks out), `{BUILD_CMD}`, and `{REVIEW_ITERATIONS}` (default 1 — one pass, returning `capped`, which counts as clean for the merge gate below; 0 = run until 0 comments, bounded by the 10-iteration guardrail).

### 5d: Merge

Reached only when a review loop ran (`REVIEW_AGENTS` non-empty) — Phase 5c's own "no reviewer requested" gate covers the no-reviewer case on both hosts. Consume the multi-reviewer wrapper's `{OVERALL_STATUS}`:

**Default mode**: proceed to the merge gate below when `{OVERALL_STATUS}` is `clean` (or `partial` under an explicit stop-mode). On `inconclusive` (a requested reviewer timed out, errored, hit its guardrail, or was skipped — including a missing CLI binary) or `dirty` (broken build / failed tests / reject), leave the PR open, set `MERGE_OUTCOME=left open`, report the status, and skip the merge gate.
**Interactive mode**: Ask the user for merge approval, showing `{OVERALL_STATUS}`, before running the gate.

Merge through the **shared merge gate** — it resolves the repo's actual allowed merge method (never hardcodes `--merge`, which a squash-only or rebase-only repo rejects), waits on required CI, merges, and reads the result back instead of trusting the merge command's exit status. Run it from inside `{WORKTREE_DIR}` with `{PR}` = `{PR_NUMBER}`, `{GIT}` = `git` (already running in the worktree), `{MODE}` = `wait` (Phase 6 needs the confirmed read-back to decide whether deleting the branch is safe), `{LINKED_WORKTREE}` = `1`, and `{MERGE_METHOD}` unset (depfree has no `--merge-method` flag, so the gate falls back to the repo's allowed method):

!read lib/merge-gate.md

Record the gate's outcome as `MERGE_OUTCOME` (`merged`, `queued`, or `left open`). The gate itself deletes the remote head once — and only once — it reads back `MERGED` (its step 5); Phase 6 never deletes it again.


## Phase 6: Cleanup

Reached from every path through Phase 5: after 5d's merge gate (any `MERGE_OUTCOME`), from the `--no-merge` gate, or from 5c's "no reviewer requested" gate. `MERGE_OUTCOME` is `merged` only when 5d's gate confirmed it there; every other path leaves it unset, which this phase treats as **the PR/MR is still open** — closing an open PR by deleting its head branch is the exact bug this phase exists to avoid.

1. **If `MERGE_OUTCOME=merged`:** the merge gate already deleted the remote head (its step 5). Remove the worktree and delete the local branch:
   ```bash
   git worktree remove {WORKTREE_DIR}
   git branch -d depfree/{DATE}
   ```
   Use `-d`, not `-D` — a refusal here means the local branch carries commits the gate's merge doesn't account for (e.g. a squash merge rewrote the SHA); investigate before forcing.

   **Otherwise** (`MERGE_OUTCOME` unset, `queued`, or `left open` — covers `--no-merge`, no reviewer requested, and `inconclusive`/`dirty` review results, on either host): the PR/MR is still open. **Do not** remove the worktree, and do not delete the local or remote branch — deleting the head branch of an open PR/MR closes it. Report `{WORKTREE_DIR}` and the branch name as retained for later review/merge.
2. **Restore stashed changes, on the branch that made them, in `{REPO_DIR}` — never in `{WORKTREE_DIR}`, and never after checking out a different branch there.** All remediation happened in the worktree; this phase never runs `git checkout` in `{REPO_DIR}`, because doing so would move the user off whatever branch (`{CURRENT_BRANCH}`) they were on when the run started, and popping the stash after such a checkout would apply it to the wrong branch. If Phase 3a stashed (`IS_DIRTY` was true):
   ```bash
   git -C {REPO_DIR} stash pop
   ```
   Run this on **every** path through this phase — including `--no-merge` and every "PR left open" branch above — not only after a successful merge, so a run never strands the pre-audit stash. `{REPO_DIR}` remains on `{CURRENT_BRANCH}` throughout the entire command; nothing in this command checks it out elsewhere.
3. File each removal that was reverted or skipped after Phase 2 as a deferred issue (deduped against `EXISTING_ISSUES`, per the Phase 2 partials); when `TRACKER_AVAILABLE=false`, add it to the "Deferred (not filed — no issue tracker available)" list instead.
4. Print the final summary, with the PR link (noting when `MERGE_OUTCOME` is unset that the PR/MR is still open rather than merged), the created and reused issue numbers for deferred removals, and (when `TRACKER_AVAILABLE=false`) the "Deferred (not filed — no issue tracker available)" list:

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

## Notes

- This command complements `/do:better` — `depfree` for dependency hygiene, `better` for code quality
- All remediation happens in an isolated worktree. Phase 3a may stash a dirty tree directly in `{REPO_DIR}` before the worktree exists, but Phase 6 always restores that stash on `{CURRENT_BRANCH}` without ever checking out another branch there — so by the time the command finishes, the user's branch and working tree are exactly as they were when it started, on every exit path (`--no-merge`, no reviewer, merged, or left open, on either host)
- `docs/DEPS.md` is the persistent decision log (read in Phase 0e, rewritten in Phase 4c). Major version bumps and heavy-mode escalations bypass it; manually delete an entry to force re-audit
- **Default vs. heavy mode aggressiveness**: see Heavy Mode above
- Replacement code should be minimal — don't over-engineer utilities that replace single-purpose packages
- For monorepos, audit the root manifest and each workspace package manifest
