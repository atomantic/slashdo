---
description: Audit third-party dependencies and remove unnecessary ones by writing replacement code
argument-hint: "[--interactive] [--scan-only] [--no-merge] [--heavy|--extreme] [--review-with <agent>[,<agent>...]] [--review-iterations <n>] [--review-mode <series|parallel>] [--review-stop-on-findings|--review-stop-on-clean] [--reviewer-applies] [--issues-label <name>] [specific packages to evaluate]"
---

# Depfree — Dependency Freedom Audit

Audit all third-party dependencies, classify them as acceptable (large, widely-audited) or suspect (small, replaceable), analyze actual usage of suspect dependencies, and replace them with owned code where feasible.

Every small library is an attack surface. In default mode, large, widely-audited libraries (express, react, d3, three.js, next, vue, fastify, lodash-es, etc.) are acceptable; smaller ones, or ones where only a helper function is used, get replaced with owned code. Heavy mode raises the bar much higher. Extreme mode aims at zero dependencies: it puts the strongest available model on every agent and asks it to own even large libraries whose used surface can be rebuilt and proven.

**Default mode: fully autonomous.** Balanced model profile, no prompting. **`--interactive`** pauses for classification approval, replacement review, and merge confirmation.

Parse `$ARGUMENTS` for:
- **`--interactive`**: pause at each decision point for user approval
- **`--scan-only`**: run Phase 0 + 1 + 2 only (audit and plan), skip remediation — no worktree, no code changes, no PRs. Every surviving finding is filed as a labelled tracker issue before the run exits, not just the deferred subset (see the Phase 2 gate)
- **`--no-merge`**: run through PR creation, skip the review loop and merge
- **`--heavy`**: aggressive mode — only keep foundational frameworks and language runtimes; replace everything else that is feasibly replaceable (see Heavy Mode)
- **`--extreme`**: zero-dependency mode — everything Heavy Mode does, plus: the strongest model tier on every agent at maximum reasoning effort, no size ceiling on a replacement, and large libraries (HTTP frameworks, utility suites, client libraries, parsers) become candidates when their *used* surface can be rebuilt behind a parity test suite (see Extreme Mode). `--extreme` implies `--heavy`; passing both is fine

The `--review-with`, `--review-stop-on-findings`/`--review-stop-on-clean`, `--review-mode`, `--reviewer-applies`, and `--review-iterations` grammar governing the Phase 5c review loop on the PR — entry syntax, per-reviewer `~opt`/`~max=`/`~effort=` suffixes, dedupe rules, and model-bracket forwarding — is owned by the shared partial below; do not restate it here:

!`cat ~/.claude/lib/review-flags.md`

After parsing the review flags above, apply any **saved defaults** (set via `/do:config`) to the flags the user did NOT pass (the review flags **and** `--issues-label`) — an explicit flag, or `--review-with none`, always overrides a saved default:

!`cat ~/.claude/lib/review-config-defaults.md`

!`cat ~/.claude/lib/config-defaults-issues-merge.md`

- **`--issues-label <name>`**: the label on the GitHub/GitLab issues deferred removals are filed as (see Phase 2). Set `PLAN_LABEL` from `--issues-label`, else the saved `issues-label` default, else `plan`. A saved `issues` key is ignored.
- **`--issues`**: deprecated no-op; print once: `--issues is now the default (PLAN.md mode was removed); the flag can be dropped.`
- **`--no-issues`**: abort with `--no-issues is no longer supported: PLAN.md mode was removed. slashdo records work only in the project's issue tracker.`
- **Specific packages**: limit audit scope to named packages (e.g., "chalk dotenv")

Set `DEPFREE_MODE` to `extreme` if `--extreme` was passed, else `heavy` if `--heavy` was passed, else `default`. Set `HEAVY_MODE` to `true` when `DEPFREE_MODE` is `heavy` or `extreme` (every Heavy Mode rule applies under extreme), and `EXTREME_MODE` to `true` only when `DEPFREE_MODE` is `extreme`. Modes are ordered `default` < `heavy` < `extreme`; the order matters for prior-decision reuse (Phase 0e) and for `docs/DEPS.md` (Phase 4c).

## Configuration

### Dependency policy

Before discovery, load the project/global `depfree-allow` lists and resolve their
union using the shared procedure. This policy takes precedence over every mode's
removal rules below, including `--extreme`:

!read lib/depfree-policy.md

### Default Mode (autonomous)

Use the **Balanced** model profile automatically (`AUDIT_MODEL_TIER=medium`, `REMEDIATION_MODEL_TIER=medium`).

### Extreme Mode model profile (`--extreme`)

`--extreme` **forces the Quality profile**: `AUDIT_MODEL_TIER=heavy`, `REMEDIATION_MODEL_TIER=heavy`, and reasoning effort `max` on every agent brief (per [lib/model-tiers.md](../../lib/model-tiers.md): carry the effort level in the brief text; pass it as a dispatch parameter only where the dispatch API has one). Under `--interactive --extreme`, skip the model-profile question below — print `Extreme mode: using the Quality profile (strongest model, max effort) for audit and remediation agents.` and continue with the remaining interactive gates. Replacing a large library is exactly the work where a weaker model produces a confident, subtly wrong reimplementation, so this is the one mode that is not allowed to run cheap.

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

> **Three unrelated things here are called "tier" or "heavy":** `AUDIT_MODEL_TIER`/`REMEDIATION_MODEL_TIER` select **which model an agent runs on**; dependency **Tier 1/2/3** (Phase 1b) rates **how replaceable a package is**; `HEAVY_MODE` (`--heavy`) sets **how aggressive the removal bar is**. `--heavy` does *not* raise the model tier. `--extreme` is the exception: it raises both the removal bar and the model tier, because the two are inseparable at that bar.

## Heavy Mode (`--heavy`)

"Own everything we feasibly can": only foundational frameworks, core platform tooling, and language-level runtimes survive. When `HEAVY_MODE` is `true`:

1. **Tier 1 is narrowed** to foundational frameworks and runtimes (see Phase 1b); lodash, chalk, dotenv, commander, yargs, uuid, axios, etc. move to Tier 2 or 3.
2. **EVALUATE recommendations become REMOVE** — when in doubt, replace.
3. **Complexity ceiling rises** to 300 lines per replacement (default: agents bail at ~2x estimate). Only truly infeasible replacements (deep domain expertise, crypto primitives, protocol parsers) are skipped.
4. **Maintenance status is irrelevant** — the question is "can we own this code?"
5. **DevDependencies get equal priority** with production dependencies (overriding the Phase 1a deprioritization).

## Extreme Mode (`--extreme`)

"Zero dependencies is the goal; every package still in the manifest needs a reason that survives a strong model trying to remove it." Every Heavy Mode rule above applies, and in addition, when `EXTREME_MODE` is `true`:

1. **Tier 1 collapses to what cannot be owned responsibly.** Only these stay Tier 1 without a usage audit:
   - The language runtime, its standard library, the package manager, and the compiler/transpiler the build cannot run without.
   - **Security-sensitive protocol and primitive implementations**: TLS, cryptographic primitives and key exchange, authentication protocols (OAuth client flows are *not* in this class — they are HTTP plus signing, and are candidates), database wire protocols with authentication (`pg`, `mysql2`, `mongodb`), compression and media codecs with conformance suites you cannot run. Reimplementing these trades a reviewed implementation for an unreviewed one.
   - **Native bindings to the OS or hardware** (PTYs, GPU, USB, sensors) where the replacement would be a native addon.
   - **Linting/formatting/test-running tools required by CI** — the Heavy Mode rule stands; rewriting a test runner is not dependency freedom.
   Everything else is Tier 2 or 3 — including frameworks, UI libraries, rendering and math libraries, client SDKs, parsers, ORMs, and build plugins. A **web framework** (express, fastify, koa, hono) whose used surface is routing, middleware chaining, static files, and body parsing is a candidate. A **UI framework** (react, vue, svelte) is a candidate only when the application's component tree is small enough that a design (rule 3) can name every construct it uses; otherwise classify it `SKIPPED_INFEASIBLE` with a design sketch and file it (rule 6), so the decision is recorded rather than assumed.
2. **No line ceiling.** The Heavy Mode 300-line ceiling and the default 2x-estimate bail-out are replaced by a **parity gate**: a replacement ships when every call site's behavior is covered by a test that fails against a stub and passes against the owned code, the full build and test suite pass, and no new dependency was introduced. Size is reported, never used as a reason to stop.
3. **Design before code for any Complex or larger replacement.** Before writing a replacement estimated above ~100 lines (Phase 1c "Complex" or anything that was "Infeasible" under heavy rules), the remediation agent writes a short **replacement design** into its commit message body or a `docs/deps/<package>.md` note: the exact used surface (symbols, options, behaviors relied on), the owned module's public API, the parity test plan, the edge cases the original handled that the call sites reach, the edge cases provably unreachable (and therefore omitted), and the risk the swap carries. The design is the reviewer's checklist in Phase 4b.
4. **Consolidate before replacing.** Phase 2 plans the owned-module layout across *all* removals first (one `http/` module for a framework plus its body parser plus its static server; one `text/` module for the string utilities), so three removals do not produce three overlapping utilities.
5. **One package per agent, at most 3 agents in flight, each dispatched at `REMEDIATION_MODEL_TIER=heavy` with effort `max` in the brief.** A large replacement needs the whole context window; grouping is only for packages whose replacement is a single shared module.
6. **Nothing is silently skipped.** A package that stays after an extreme run is one of: `KEPT_POLICY` with its current allowlist pattern, `KEPT_TIER1` under the collapsed definition in rule 1, `KEPT_AUDITED` with a reason a reviewer could argue with (not "popular" or "large"), or `SKIPPED_INFEASIBLE` **with a design sketch and a filed tracker issue** naming what a future run would need (a conformance suite, a native addon, a product-level rewrite). `REVERTED` is allowed only after a genuine parity failure the agent could not fix; record the failing test.
7. **Transitive downgrades narrow.** Phase 1d's `KEEP (transitive)` downgrade applies only when the kept parent is Tier 1 under rule 1 or kept by current policy. A candidate that is transitive of another Tier 2/3 removal candidate stays `REMOVE`, because the parent is on the same list.
8. **Verification deepens.** Phase 4a runs the project's end-to-end or smoke suite when one exists, not only the unit suite, and Phase 4b's parity review is a second `heavy`-tier agent reading the design from rule 3 against the diff.

Extreme mode is slower and more expensive than heavy mode by design. It is the mode for a repository whose stated goal is owning its stack; run it with `--scan-only` first when the goal is a plan rather than a PR.

## Compaction Guidance

When compacting during this workflow, always preserve:
- The `DEPENDENCY_MAP` (complete classification of all dependencies)
- The `PRIOR_DECISIONS` map loaded from `./docs/DEPS.md`
- `DEPFREE_ALLOW` (the union of global and project policy patterns) and every `from_policy` decision
- All REMOVABLE findings with package names and usage details
- The current phase number and what phases remain
- All PR numbers and URLs created so far
- `BUILD_CMD`, `TEST_CMD`, `PROJECT_TYPE`, `WORKTREE_DIR`, `REPO_DIR` values
- `VCS_HOST`, `CLI_TOOL`, `GH_HOST`, `TRACKER_AVAILABLE`, `DEFAULT_BRANCH`, `CURRENT_BRANCH`
- `DEPFREE_MODE`, `HEAVY_MODE`, and `EXTREME_MODE` flags, and `AUDIT_MODEL_TIER` / `REMEDIATION_MODEL_TIER`
- Under extreme mode, every replacement design written so far (Extreme Mode rule 3)


## Phase 0: Discovery & Setup

### 0a: VCS Host Detection
Resolve `VCS_HOST` and `CLI_TOOL` here, before any phase reaches for a forge CLI:

!read lib/vcs-host.md

- **When `VCS_HOST=github`, also derive `GH_HOST` from the `origin` remote** and carry it in state, following the shared derivation (and its per-host auth precheck) included below. The Phase 6 host-side reviewer loops' GitHub verbs use `gh api`, which ignores the repo remote and defaults to github.com — on a GitHub Enterprise repo `GH_HOST` must be forwarded to them or they poll the wrong host and time out.
- **Record `TRACKER_AVAILABLE` once.** `true` when the tracker gate's `TRACKER_CLI` is set and reaches this repo with its issues feature enabled; otherwise `false`. Deferred removals are filed as issues only when it is `true`; when `false` the run continues, files nothing, and lists every deferred removal (title, one-line rationale, `file:line`) in the final report under "Deferred (not filed — no issue tracker available)". Never write PLAN.md as a fallback. On a Jira tracker it is `true` only when the Jira Pre-flight below passes (`{COMMAND}` = `/do:depfree`); a failed one prints its message and records `false`. Filed removals are then referenced by key (`PROJ-123`), not `#<n>`.

Only on a Jira tracker (`TRACKER=jira`), read the Jira backend and run its Pre-flight in place of the tracker gate:

!read lib/tracker-jira.md

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
- `decision`: one of `KEPT_POLICY`, `KEPT_TIER1`, `KEPT_AUDITED`, `KEPT_TRANSITIVE`, `REMOVED`, `REVERTED`, `SKIPPED_INFEASIBLE`
- `major_version`: the major version that was evaluated (e.g., `18` for react@18.x)
- `mode`: the mode the decision was made under (`default`, `heavy`, `extreme`, or the legacy `both`, which reads as `heavy`)
- `reason`: the rationale recorded
- `decision_date`: ISO date the decision was made

If the file does not exist, set `PRIOR_DECISIONS` to an empty map. The file is created in Phase 4c only when remediation runs (i.e., `--scan-only` was not passed).

A prior decision is **valid for skipping re-evaluation** when ALL of these are true:
1. The package is still in the manifest at the same major version
2. The recorded mode is **at least as strict** as the current run mode, on the order `default` < `heavy` < `extreme` (a `default` decision does NOT skip a `heavy` run; a `heavy` decision skips a `default` run but NOT an `extreme` run; an `extreme` decision skips any run; legacy `both` counts as `heavy`)
3. The decision is not `REMOVED` or `REVERTED` (those packages should not be in the manifest; if they are, treat as new)
4. Under `EXTREME_MODE`, the decision is not `SKIPPED_INFEASIBLE` — infeasibility is re-tested on every extreme run, because the bar it was measured against (model capability, runtime built-ins) moves
5. The decision is not `KEPT_POLICY` — current config is always checked again; an old policy row never authorizes keeping a package after its allowance was removed
6. The decision is not `KEPT_TRANSITIVE` — a kept-parent chain can disappear when policy or removal candidates change. Reclassify these packages normally and rerun Phase 1d against this run's kept-parent graph; never skip analysis based on a cached chain

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

For each dependency, first apply `depfreePolicyDecision(packageName, DEPFREE_ALLOW)`
from the shared policy procedure. A match is **KEEP** with `decision: KEPT_POLICY`,
`reason: policy allowlist`, `from_policy: true`, and the matching `policy_pattern`;
record it as kept Tier 2 and skip all remaining tier/removal rules and Phase 1c.
This applies in default, heavy, and extreme modes, across all workspace manifests
and installed versions. It also applies when the user named the package explicitly.

For non-matches, check `PRIOR_DECISIONS` (from Phase 0e). If a valid prior decision exists for the package + major version + mode, carry it forward:
- `KEPT_TIER1` → classify as **Tier 1** (skip further audit)
- `KEPT_AUDITED` → classify as **Tier 2** with recommendation **KEEP** (skip Phase 1c usage analysis)
- `SKIPPED_INFEASIBLE` → classify as **Tier 2** with recommendation **KEEP** (skip Phase 1c usage analysis)

Record carried-forward decisions in `DEPENDENCY_MAP` with a `from_prior: true` flag. Print one line per skipped dependency: `↻ {package}@{major} — carrying forward prior {decision} ({decision_date})`.

For all other dependencies (no prior decision, major version bump, or mode escalation — default → heavy, or either → extreme), classify into one of three tiers. **Under `EXTREME_MODE`, the Tier 1 lists below are replaced by Extreme Mode rule 1**; the heavy-mode Tier 2/3 expansions still apply, and every package not covered by rule 1 is at least Tier 2:

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

Skip any dependency with `from_policy: true` or `from_prior: true`. For all remaining Tier 2 and Tier 3 dependencies, launch parallel Explore agents (using `AUDIT_MODEL_TIER`) to determine actual usage:

Each agent should:
1. Search all source files for imports/requires of the package
2. List every function, class, constant, or type imported from it
3. Count call sites per imported symbol
4. Assess complexity of replacement:
   - **Trivial** (<20 lines): simple wrapper, single utility function, type alias
   - **Moderate** (20-100 lines): multi-function utility, needs tests, edge cases to handle
   - **Complex** (100-300 lines): significant logic, crypto, parsing, protocol implementation
   - **Infeasible** (300+ lines or requires deep domain expertise): keep the dependency
   - **Under `EXTREME_MODE`** the line counts describe, they do not gate: rate **Infeasible** only for the classes Extreme Mode rule 1 keeps (security-sensitive protocols and primitives, native bindings, CI-required tooling). A 2,000-line used surface with a clear design is **Complex**, and the report must sketch the owned module's API and the parity test plan so Phase 2 can plan consolidation
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

Always include policy-kept packages as kept parents in the dependency graph and
record their transitive footprint, even when there are no REMOVE candidates.
Their recommendation remains **KEEP**; this phase never makes them candidates.
Do not count packages still installed through a policy-kept parent as eliminated.

Removing a direct dependency that remains in the lock file as a transitive dep of a kept package provides zero supply chain benefit — the code is still installed and executable. For each REMOVE candidate:

1. Check if it appears as a transitive dependency of any Tier 1 or kept Tier 2 package (a nested entry under a kept package's tree, not just the project root):
   - **Node.js (npm)**: `npm ls {package}`
   - **Node.js (yarn)**: `yarn why {package}`
   - **Node.js (pnpm)**: `pnpm why {package}`
   - **Rust**: `cargo tree -i {package}`
   - **Python**: `pipdeptree -r -p {package}` or `uv pip tree --invert | grep {package}` (record the full chain)
   - **Go**: `go mod graph | grep {package}`
   - **Ruby**: `bundle why {gem}`
2. If it IS transitive of a kept package, determine the **removal motivation** (under `EXTREME_MODE`, a parent only counts as "kept" when it is Tier 1 under Extreme Mode rule 1 or `from_policy: true` — a parent that is itself a Tier 2/3 removal candidate does not shelter its children):
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
2. Filter to only REMOVE recommendations from Phase 1c/1d (exclude any downgraded to KEEP (transitive) in Phase 1d). Exclude `from_policy: true` from REMOVE, EVALUATE, deferred findings, and remediation, regardless of mode
3. For EVALUATE recommendations: **Default mode** — treat as KEEP (conservative). **Heavy mode** — treat as REMOVE (see Heavy Mode). **Interactive mode** — present to user via `AskUserQuestion` for each. If both `--interactive` and `--heavy` are set, still prompt for each EVALUATE item (interactive takes precedence), but present REMOVE as the default suggestion
4. Group removable dependencies by replacement strategy:
   - **Native replacement**: built-in API replaces the library (e.g., `crypto.randomUUID()`)
   - **Inline replacement**: write a small utility function (e.g., ANSI color wrapper)
   - **Consolidation**: multiple small deps replaced by one owned utility module
   - **Owned subsystem** (`EXTREME_MODE` only): a large library's used surface rebuilt as an owned module with its own parity suite (an HTTP router + middleware chain, a date formatter, a markdown renderer). Record the module boundary now so sibling removals land in the same module (Extreme Mode rule 4) — this grouping decides agent assignment in Phase 3b
5. Estimate total lines of replacement code needed (reported for every mode; a gate in none of the extreme-mode paths)
6. **Disposition.** A planned removal not carried out this run is **deferred** (under `--scan-only`, the gate below files everything instead): file each as a labeled issue, deduped against `EXISTING_ISSUES`, per the partials above — or, when `TRACKER_AVAILABLE=false`, hold them for the final report's "Deferred (not filed — no issue tracker available)" list.

7. Print summary table:
```
| Status     | Count | Examples                          |
|------------|-------|-----------------------------------|
| Acceptable | ...   | react, express, typescript, ...   |
| Kept       | ...   | {packages kept with reasons}      |
| Policy kept | ...  | {packages kept: policy allowlist} |
| Removable  | ...   | {packages to remove}              |
| Total      | ...   |                                   |
```

The Policy kept row is a subset of Kept, not an extra contribution to Total.
Print each policy-kept package and matching pattern with reason `policy allowlist`,
including on scan-only and "All dependencies are justified" exits.

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
Depfree mode: {DEPFREE_MODE}
Reasoning effort: {max under EXTREME_MODE; otherwise omit this line}
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
- If replacement is more complex than estimated (>2x the estimated lines), report back and skip — do not force a bad replacement. In `HEAVY_MODE`, use the raised ceiling from Heavy Mode above (300 lines) instead of the 2x estimate — only skip if replacement requires deep domain expertise (crypto primitives, binary protocol parsers, codec implementations) or exceeds that ceiling. In `EXTREME_MODE` there is no size ceiling: the only skip is an Extreme Mode rule 1 class, and a skip must come back with a design sketch (what the owned module would be, what blocks it) rather than a size
- `EXTREME_MODE` parity gate (Extreme Mode rules 2–3): for a Complex-or-larger replacement, write the replacement design FIRST (used surface, owned API, parity test plan, reachable vs. provably-unreachable edge cases, risk) and put it in the commit body or `docs/deps/{PACKAGE_NAME}.md`; then write the parity tests so they FAIL against a stub and PASS against the owned code before switching any call site; the replacement is done only when every call site's behavior has such a test. Work extra hard here — reread the library's source for the behaviors your call sites depend on (option defaults, error shapes, ordering guarantees, encoding edge cases) instead of guessing from its README
- Place shared utility replacements in a sensible location (e.g., `src/utils/`, `lib/`, `internal/`) following existing project conventions; under `EXTREME_MODE`, in the module boundary Phase 2 recorded for this package's group
- Commit each replacement independently: `refactor: replace {package} with owned {utility/code}`. If `git commit` fails on a transient `index.lock` (another agent committing at the same instant), wait briefly and retry once before reporting failure
</guardrails>
```

**Parallelization**: Launch up to 5 agents in parallel; batch if >5 dependencies. Assign each agent a non-overlapping set of dependencies (if two would modify the same files, group them into one agent). Agents never edit the manifest or lock file (step 6 above), so manifest contention cannot occur regardless of grouping; grouping still avoids two agents editing the same source files. **Under `EXTREME_MODE`: at most 3 agents in flight, one package (or one Phase 2 "owned subsystem" group) per agent, every agent at `REMEDIATION_MODEL_TIER=heavy` with effort `max` in the brief** (Extreme Mode rule 5) — a large replacement needs the agent's whole context window, and a cheaper tier here is how a confident, subtly wrong reimplementation ships.

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
   Under `EXTREME_MODE`, also run the project's end-to-end or smoke suite when it documents one (Extreme Mode rule 8) — a framework swap can pass every unit test and still break request handling only an integration path exercises.
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
3. Under `EXTREME_MODE`, dispatch this review to a second `heavy`-tier agent (effort `max`) rather than doing it inline, giving it each replacement's design note (Extreme Mode rule 3) as the checklist: every behavior the design lists as relied-upon must have a parity test, every edge case it lists as unreachable must actually be unreachable from the call sites, and the owned module must introduce no new dependency
4. Fix any issues found, commit each fix separately

### 4c: Update DEPS.md

Write the consolidated decision record to `{WORKTREE_DIR}/docs/DEPS.md`. Create the `docs/` directory if it does not exist.

Build the new file from:
1. **All carried-forward entries** from `PRIOR_DECISIONS` whose packages are still in the manifest at the same major version (preserve `decision_date` and `mode`), excluding old `KEPT_POLICY` and `KEPT_TRANSITIVE` rows and entries superseded by current policy
2. **New decisions** from this run:
   - Each `from_policy: true` package → `KEPT_POLICY` in **Kept — Policy allowlist**, with reason `policy allowlist` and the matching pattern. This takes precedence over all other decisions for that package
   - Each non-policy Tier 1 package → `KEPT_TIER1`
   - Each non-policy Tier 2 package with KEEP recommendation → `KEPT_AUDITED`
   - Each Tier 2/3 package downgraded to KEEP (transitive) in Phase 1d → `KEPT_TRANSITIVE`
   - Each successfully removed package → `REMOVED`
   - Each reverted package (replacement failed in 4a) → `REVERTED`
   - Each skipped package (replacement infeasible / >2x estimate / >300 lines in heavy / an Extreme Mode rule 1 class in extreme, with its design sketch in the reason) → `SKIPPED_INFEASIBLE`
3. **Mode recording**: write the mode the decision was reached under (`default`, `heavy`, or `extreme`). When a prior decision at a stricter mode already covers this package + major version with the same conclusion, keep the stricter mode — never downgrade an `extreme` row to `heavy` because a heavy run agreed with it. The legacy `both` value is read as `heavy` and rewritten as `heavy` on the next run that touches the row.

Use this layout:

```markdown
# Dependency Audit Decisions

Auto-maintained by `/do:depfree`. Records prior audit decisions so repeat runs
skip re-evaluation. Re-audit triggers: major version bump, a run in a stricter
mode than the row records (default < heavy < extreme), or manual deletion of an
entry. Extreme runs always re-test `SKIPPED_INFEASIBLE` rows. Policy rows are
recomputed from current config in every mode; removing an allowance triggers
normal classification, regardless of the row's version or mode. Transitive rows
are re-evaluated against the current kept-parent graph on every run.

Last updated: {YYYY-MM-DD}

## Kept — Policy allowlist

| Package | Major | Mode | Reviewed | Reason | Pattern |
|---------|-------|------|----------|--------|---------|
| ...     | ...   | ...  | ...      | policy allowlist | ... |

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
if [ "$EXTREME_MODE" = "true" ]; then
  HEAVY_SUFFIX=" (extreme mode)"
  HEAVY_HEADING=" (Extreme Mode)"
elif [ "$HEAVY_MODE" = "true" ]; then
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

### Dependencies Kept
{count} dependencies kept with rationale (recorded in `docs/DEPS.md`), including {policy count} kept by policy allowlist (list package names and matching patterns; these were not usage-audited).

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
- `@<login>` — a login ending in `[bot]` is an automated reviewer: expected duration 5 minutes; max wait 3x that duration, minimum 3 minutes, maximum 15 minutes; poll every 10s, 10s, 20s, 20s, then 30s. Any other login is presumed human: max wait 4 hours; poll every 30s for the first 5 minutes, then every 60s.

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
| {package}        | Kept     | {reason, including policy allowlist + matching pattern} | — |
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
- **Replacement too complex**: if an agent reports that replacement exceeds 2x estimated complexity, skip that dependency and keep it with a note. Under `EXTREME_MODE` size is not a reason to skip; an agent that stalls on a large replacement is re-dispatched once with the design note it produced so far, and only an Extreme Mode rule 1 class is recorded `SKIPPED_INFEASIBLE` (with the design sketch and a filed issue)
- **Test failure from replacement**: if tests fail and the fix isn't obvious, revert the replacement — a working dependency is better than broken owned code
- **Existing worktree found at startup**: ask user — resume or clean up

## Notes

- This command complements `/do:better` — `depfree` for dependency hygiene, `better` for code quality
- All remediation happens in an isolated worktree. Phase 3a may stash a dirty tree directly in `{REPO_DIR}` before the worktree exists, but Phase 6 always restores that stash on `{CURRENT_BRANCH}` without ever checking out another branch there — so by the time the command finishes, the user's branch and working tree are exactly as they were when it started, on every exit path (`--no-merge`, no reviewer, merged, or left open, on either host)
- `docs/DEPS.md` is the persistent decision log (read in Phase 0e, rewritten in Phase 4c). Major version bumps and mode escalations (default → heavy → extreme) bypass ordinary prior decisions; manually delete an entry to force re-audit. Current `depfree-allow` policy still wins in every mode; remove the allowance from its config scope to audit that package
- **Default vs. heavy vs. extreme aggressiveness**: see Heavy Mode and Extreme Mode above. Extreme is the only mode that also raises the model tier
- Replacement code should be minimal — don't over-engineer utilities that replace single-purpose packages
- For monorepos, audit the root manifest and each workspace package manifest
