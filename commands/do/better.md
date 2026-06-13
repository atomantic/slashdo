---
description: Unified DevSecOps audit, remediation, test enhancement, per-category PRs, CI verification, and an optional multi-reviewer review loop with worktree isolation
argument-hint: "[--interactive] [--scan-only] [--no-merge] [--review-with <agent>[,<agent>...]] [--review-iterations <n>] [--review-stop-on-findings|--review-stop-on-clean] [--reviewer-applies] [--strict|--nuclear] [--issues] [--issues-label <name>] [path filter or focus areas]"
---

# Better — Unified DevSecOps Pipeline

Run the full DevSecOps lifecycle: audit the codebase with up to 10 deduplicated agents (8 core, plus a UX Consistency & Responsive Layout agent for UI-bearing projects and a Structural Ambition agent in strict mode), consolidate findings, remediate in an isolated worktree, create **separate PRs per category** with SemVer bump, verify CI, run the requested review loop(s), and merge.

**Default mode: fully autonomous.** Uses Balanced model profile, proceeds through all phases without prompting. **There is no default reviewer**: if `--review-with` is omitted, no external review runs and PRs are left open for manual review (no auto-merge). Pass `--review-with <agent>` to run a review loop and auto-merge PRs with clean reviews.

**`--interactive` mode:** Pauses for model profile selection, review findings approval, guardrail decisions, and merge confirmation.

Parse `$ARGUMENTS` for:
- **`--interactive`**: pause at each decision point for user approval
- **`--scan-only`**: run Phase 0 + 1 + 2 only (audit and plan), skip remediation
- **`--no-merge`**: run through PR creation (Phase 5), skip the review loop and merge
- **`--review-with <agent[,agent,...]>`**: which reviewer(s) run the Phase 6 review loop on each PR. Accepted slugs: `copilot`, `codex`, `agy` (aliases `gemini` / `antigravity` — all run the Antigravity CLI's `agy` binary), `claude`, `ollama` (bare `ollama` auto-selects the most capable installed coding model; `ollama[<model>]` pins a specific installed model, e.g. `ollama[qwen2.5-coder:32b]` — strip the bracket into a per-entry `OLLAMA_MODEL`) (comma-separated, ordered list; split on `,`, trim whitespace, normalize `gemini`/`antigravity` → `agy`, dedupe preserving first-occurrence order, with the `ollama` bracket suffix part of the dedup identity). Record as `REVIEW_AGENTS`. **There is no default** — if omitted, set `REVIEW_AGENTS=[]`: Phase 6 is skipped and PRs are left open without merging (see Phase 6). `copilot` is never added implicitly. Abort on an unknown slug with `Unknown --review-with value: {value}. Use one of: copilot, codex, agy, claude, ollama.` The reserved token `none` (case-insensitive) is **not** validated as a slug — `--review-with none` means no reviewer (set `REVIEW_AGENTS=[]`) and overrides any saved `review-with` default.
- **`--review-stop-on-findings`** / **`--review-stop-on-clean`** (mutually exclusive): forwarded to the multi-reviewer loop for each PR; control when a per-PR reviewer list stops early. Set `REVIEW_STOP_MODE` (`all` default, `on-findings`, or `on-clean`). If both are present, abort with `--review-stop-on-findings and --review-stop-on-clean cannot be combined`.
- **`--reviewer-applies`**: forwarded to each PR's review loop — the reviewing CLI applies fixes directly instead of the orchestrator (no effect on copilot passes). Record `REVIEWER_APPLIES=true`/`false`.
- **`--review-iterations <n>`**: cap how many review-and-fix cycles a **copilot** pass runs per PR (Phase 6); no effect on `codex`/`agy`/`claude` passes (fixed 3-iteration cap). Set `REVIEW_ITERATIONS` from this value; default `1` (one review pass per PR, exiting early on 0 comments). `0` = loop until Copilot returns 0 comments (legacy behavior, bounded by the 10-iteration guardrail). Must be a non-negative integer; otherwise abort with `--review-iterations must be a non-negative integer (got: {value}).`

After parsing the review flags above, apply any **saved defaults** (set via `/do:config`) to the review flags the user did NOT pass — an explicit flag, or `--review-with none`, always overrides a saved default:

!`cat ~/.claude/lib/review-config-defaults.md`

- **`--strict`** (alias: **`--nuclear`**): enable the Structural Ambition agent (10th audit agent) and promote its blocker-tier findings to CRITICAL severity for remediation. Flags file-size growth past 1000 lines, ad-hoc conditionals bolted onto unrelated flows, thin wrappers, boundary leaks, and missed code-judo simplifications. Set `STRICT_MODE=true` when present
- **`--issues`** / **`--issues-label <name>`**: track deferred findings as GitHub/GitLab issues instead of PLAN.md lines (see Phase 2). Record `ISSUE_MODE=true`/`false` and `PLAN_LABEL` (default `plan`).
- **Path filter**: limit scanning scope to specific directories or files
- **Focus areas**: e.g., "security only", "DRY and bugs"

## Configuration

### Default Mode (autonomous)

Use the **Balanced** model profile automatically (`AUDIT_MODEL=sonnet`, `REMEDIATION_MODEL=sonnet`).

### Interactive Mode (`--interactive`)

Present the user with configuration options using `AskUserQuestion`:

```
AskUserQuestion([
  {
    question: "Which model profile for audit and remediation agents?",
    header: "Model",
    multiSelect: false,
    options: [
      { label: "Quality", description: "Opus for all agents — fewest false positives, best fixes (highest cost, 8+ Opus agents)" },
      { label: "Balanced (Recommended)", description: "Sonnet for audit and remediation — good quality at moderate cost" },
      { label: "Budget", description: "Haiku for audit, Sonnet for remediation — fastest and cheapest" }
    ]
  }
])
```

Record the selection as `MODEL_PROFILE` and derive agent models from this table:

| Agent Role | Quality | Balanced | Budget |
|------------|---------|----------|--------|
| Audit agents (8–10 Explore agents, Phase 1) | opus | sonnet | haiku |
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
- `BUILD_CMD`, `TEST_CMD`, `PROJECT_TYPE`, `WORKTREE_DIR`, `REPO_DIR` values
- `VCS_HOST`, `CLI_TOOL`, `DEFAULT_BRANCH`, `CURRENT_BRANCH`
- `STRICT_MODE` (true/false — determines whether the Structural Ambition agent runs and whether structural findings are promoted to CRITICAL)
- `HAS_UI` (true/false — determines whether the UX Consistency & Responsive Layout agent runs and whether the `ux` category exists downstream)
- `PHASE_4C_START_SHA` (needed for FILE_OWNER_MAP update in Phase 4c.3)
- `VACUOUS_TESTS_FIXED`, `WEAK_TESTS_STRENGTHENED`, `NEW_TEST_CASES`, `NEW_TEST_FILES`
- `CREATED_CATEGORY_SLUGS` (list of branch slugs created in Phase 5)


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

Additionally, detect whether the project ships a user-facing UI:
- Web frontend dependencies (`react`, `vue`, `svelte`, `next`, `nuxt`, `astro`, `angular`, `solid-js`) or UI source files (`*.html`, `*.css`/`*.scss`, JSX/TSX, `*.vue`, `*.svelte`)
- Desktop shells (Electron, Tauri) or mobile UI code (React Native, Flutter)
- Server-rendered templates (ERB, Jinja, Blade, Razor, Go templates) that emit HTML

Record `HAS_UI=true`/`false` — this gates the UX Consistency & Responsive Layout audit agent (Phase 1, agent 9) and its `ux` category downstream.

### 0c: Build & Test Command Detection
Derive build and test commands from the project type:
- Node.js: check `package.json` scripts for `build`, `test`, `typecheck`, `lint`
- Rust: `cargo build`, `cargo test`
- Python: `pytest`, `python -m pytest`
- Go: `go build ./...`, `go test ./...`
- If ambiguous, check project conventions already in context for documented commands

Record as `BUILD_CMD` and `TEST_CMD`.

### 0d: State Snapshot
- Record `REPO_DIR` via `git rev-parse --show-toplevel`
- Record `CURRENT_BRANCH` via `git rev-parse --abbrev-ref HEAD`
- Record `DEFAULT_BRANCH` via `gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name'` (or `glab` equivalent)
- Record `IS_DIRTY` via `git status --porcelain`
- Check for `.changelog/` directory → `HAS_CHANGELOG`
- Check for existing `../better-*` worktrees: `git worktree list`. If found, inform the user and ask whether to resume (use existing worktree) or clean up (remove it and start fresh)


<audit_instructions>

## Phase 1: Unified Audit

Project conventions are already in your context. Pass relevant conventions to each agent.

Launch the Explore agents in two batches (8 core agents; agent 9 runs only when `HAS_UI=true`, agent 10 only when `STRICT_MODE=true`). Each agent must report findings in this format:
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

### Batch 2 (3–5 agents after Batch 1 completes):

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

7. **Dependency Freedom**
   Audit all third-party dependencies for necessity. Every small library is an attack surface — supply chain compromises are real and common.
   Focus:
   - Extract the full dependency list from the project manifest (`package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, `Gemfile`, etc.)
   - Classify each dependency into tiers:
     - **Acceptable**: large, widely-audited libraries (react, express, d3, three.js, next, vue, fastify, typescript, eslint, prisma, tailwindcss, tokio, serde, django, flask, pandas, etc.) — skip these
     - **Suspect**: smaller libraries where we may only use 1-2 functions, wrappers over built-in APIs, single-purpose utilities
     - **Removable**: libraries where the used functionality is <50 lines to implement, wraps a now-native API (e.g., `crypto.randomUUID()` replacing uuid, `structuredClone` replacing lodash.cloneDeep, `Array.prototype.flat` replacing array-flatten, `node:fs/promises` replacing fs-extra for most uses), unmaintained with known vulnerabilities, or micro-packages (is-odd, is-number, left-pad tier)
   - For each suspect/removable dependency: search all source files for imports, list every function/class/type used, count call sites, assess replacement complexity (Trivial <20 lines, Moderate 20-100, Complex 100-300, Infeasible 300+)
   - Check maintenance status: last publish date, open security issues, known CVEs
   - Report format: `**[SEVERITY]** {package-name} — {Tier}. Uses: {functions}. Call sites: {N} in {M} files. Replacement: {complexity}. Reason: {why removable}`
   - Severity mapping: unmaintained with CVEs → CRITICAL, unmaintained without CVEs → HIGH, replaceable single-function usage → MEDIUM, suspect but complex replacement → LOW

8. **Test Quality & Coverage**
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

9. **UX Consistency & Responsive Layout** _(UI projects only — dispatch only when `HAS_UI=true`, otherwise skip)_
   Sources: page/screen entry points (routes, top-level views, landing pages), layout components, global styles, design tokens/theme files, shared component library

   **Above-the-fold UX (highest priority — bump severity one tier when a finding affects initial-viewport content):**
   - Primary content or call-to-action pushed below the fold at common viewports (360×640 mobile, 768×1024 tablet, 1280×800 desktop) by oversized hero media, stacked banners, tall nav bars, or notice pileups (cookie consent + announcement + promo)
   - Layout shift in initial-viewport content: images/embeds/ads without explicit `width`/`height` or `aspect-ratio`, web fonts without `font-display` fallback, late-injected banners that push content down after first paint
   - The likely LCP element lazy-loaded (`loading="lazy"` on the hero image), gated behind client-side hydration, or blocked by a render-blocking resource
   - Critical interactions (search, primary nav, main CTA) requiring scroll or hidden behind disclosure UI on mobile
   - Blank or spinner-only first paint: above-the-fold loading states with no skeleton or reserved dimensions

   **Responsive layout:**
   - Fixed pixel widths/heights on containers that break below ~400px or above ~1440px; missing or incorrect viewport meta tag
   - Horizontal overflow risks: flex rows without wrap fallback, tables, long unbroken strings, absolutely-positioned elements with fixed offsets
   - Breakpoint gaps: components styled for some breakpoints but not the project's full breakpoint scale; one-off media queries that don't match the shared scale
   - `100vh` on mobile (browser chrome eats the viewport) without `dvh`/`svh` fallback
   - Images without responsive `srcset`/`sizes`; raster assets far larger than their rendered size
   - Touch targets under 44×44px; hover-only interactions with no touch equivalent
   - Text truncated where wrapping is expected (`overflow: hidden` + `white-space: nowrap` on variable-length or user-generated content)

   **UX consistency:**
   - One-off spacing/typography/color values where a design-token or theme scale exists (count occurrences per pattern, e.g., "hardcoded hex colors in 14 components")
   - Multiple bespoke implementations of the same UI concept: divergent button styles, duplicate modal/dialog variants, parallel form-field components
   - Inconsistent loading/empty/error state handling across views (some skeletons, some spinners, some nothing)
   - Inconsistent feedback patterns: form validation messaging, toast vs inline errors, disabled vs hidden controls
   - Missing or inconsistent focus/hover/active states across interactive components

   Note: general accessibility (alt text, ARIA, contrast) belongs to the Stack-Specific agent — flag accessibility here only when it is also a layout failure (touch target size, content clipped at zoom or small viewports). Tag this agent's category as `ux` for Phase 2 ownership mapping.

10. **Structural Ambition** _(strict mode only — dispatch only when `STRICT_MODE=true`, otherwise skip)_
   Sources: `~/.claude/lib/review-structural-ambition.md` — read this file and use its full content as the agent's instructions.
   Focus: missed code-judo simplifications (reframings that delete whole branches/modes/helpers), file-size growth past 1000 lines, ad-hoc conditionals bolted onto unrelated flows, thin wrappers / identity abstractions, boundary leaks (feature logic in shared modules), bespoke duplicates of canonical helpers, cast-heavy / `any`-heavy / optional-soup contracts, sequential orchestration where the parallel/atomic shape is obviously cleaner.
   Report findings using the standard severity format. The skill file's presumptive blockers (file pushed past 1000 lines, spaghetti growth in existing code, thin wrappers, boundary leaks, canonical-helper duplication) must be marked `[CRITICAL]` so Phase 2 picks them up for remediation. Every finding must name a concrete suggested reframing — drop findings that only say "could be cleaner" without a path. Tag this agent's category as `structural` for Phase 2 ownership mapping.

Wait for ALL agents to complete before proceeding.

</audit_instructions>

<plan_and_remediate>

## Phase 2: Plan Generation

> **Issue mode (`--issues`):** Keep the consolidated findings (steps 2–4 below) as
> your **in-run working plan in context** — do **not** create or write the
> `## Better Audit` section to `PLAN.md`, and skip step 1's "read/create PLAN.md".
> The tracker, not `PLAN.md`, is the source of truth for already-known work, so the
> disposition partial below has you fetch the open issues into `EXISTING_ISSUES`
> during setup. When consolidating findings (step 2), **dedup against
> `EXISTING_ISSUES`** as well as across agents: a finding that already has an open
> issue is not new — reuse that issue's `#<number>` instead of filing a duplicate.
> Remediation (Phase 3+) proceeds from that in-context plan exactly as normal. The
> only persistent records are issues: for any finding you **defer** (don't
> remediate this run, per the finding-disposition rules), file a labeled tracker
> issue instead of a PLAN.md line — see the disposition partial below. Report the
> created **and** reused issue numbers (`#<n>`) in the Phase 2 summary where you'd
> report slugs. Setup (VCS host + label + `EXISTING_ISSUES` fetch) is covered by the
> partial: reuse `CLI_TOOL` from Phase 0a.

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
- [ ] [sec-routes-pr-validation] **[CRITICAL]** `file:line` - Description — Fix: ... (Complexity: Simple/Medium/Complex)

### Code Quality
- [ ] [quality-utils-error-paths] **[HIGH]** `file:line` - Description — Fix: ...

### DRY & YAGNI
- [ ] [dry-cli-output-dedup] **[MEDIUM]** `file:line` - Description — Fix: ...

### Architecture & SOLID
### Bugs, Performance & Error Handling
### Stack-Specific
### Dependency Freedom
### Test Quality & Coverage
### UX Consistency & Responsive Layout  _(only when HAS_UI=true)_
### Structural Ambition  _(only when STRICT_MODE=true)_
```

**Every appended `- [ ]` line MUST include a unique `[<slug>]` ID** so concurrent agents (`feature-ideas`, `plan-task`, manual fix-up sessions) can claim distinct findings via worktree branch names. Slug rules per [lib/plan-id-format.md](../../lib/plan-id-format.md): lowercase kebab-case derived from the title text, ≤50 chars, unique against every `[slug]` already in PLAN.md. Recommended pattern for audit findings: `<category-prefix>-<file-basename>-<short-hint>` (e.g. `[sec-routes-pr-validation]`, `[dry-cli-output-dedup]`). _(Issue mode skips slugs entirely — the issue number is the ID.)_

!`cat ~/.claude/lib/plan-issue-mode.md`

6. Print a summary table (short labels → full category → branch slug):
   - Security → Security & Secrets → `security`
   - Code Quality → Code Quality & Style → `code-quality`
   - DRY & YAGNI → DRY & YAGNI → `dry`
   - Architecture → Architecture & SOLID → `architecture`
   - Bugs & Perf → Bugs, Performance & Error Handling → `bugs-perf`
   - Stack-Specific → Stack-Specific → `stack-specific`
   - Dep Freedom → Dependency Freedom → `deps`
   - Tests → Test Quality & Coverage → `tests`
   - UX → UX Consistency & Responsive Layout → `ux` _(UI projects only)_
   - Structural → Structural Ambition → `structural` _(strict mode only)_

```
| Category          | CRITICAL | HIGH | MEDIUM | LOW | Total |
|-------------------|----------|------|--------|-----|-------|
| Security          | ...      | ...  | ...    | ... | ...   |
| Code Quality      | ...      | ...  | ...    | ... | ...   |
| DRY & YAGNI       | ...      | ...  | ...    | ... | ...   |
| Architecture      | ...      | ...  | ...    | ... | ...   |
| Bugs & Perf       | ...      | ...  | ...    | ... | ...   |
| Stack-Specific    | ...      | ...  | ...    | ... | ...   |
| Dep Freedom       | ...      | ...  | ...    | ... | ...   |
| Tests             | ...      | ...  | ...    | ... | ...   |
| UX                | ...      | ...  | ...    | ... | ...   |
| Structural        | ...      | ...  | ...    | ... | ...   |
| TOTAL             | ...      | ...  | ...    | ... | ...   |
```

Omit the **UX** row when `HAS_UI=false` and the **Structural** row when `STRICT_MODE=false`.

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

This phase is done by you (the orchestrator) directly — NOT delegated to agents — because all subsequent agents depend on these files existing and compiling.

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

Remediation runs in parallel, one worker per category that has CRITICAL, HIGH, or MEDIUM findings. Possible categories (only act on those with actionable findings):
- Security & Secrets
- Code Quality & Style
- DRY & YAGNI
- Architecture & SOLID
- Bugs, Performance & Error Handling
- Stack-Specific
- Dependency Freedom
- UX Consistency & Responsive Layout _(UI projects only)_ — remediation must be conservative and verifiable: fix layout, markup, and CSS mechanics without redesigning. Above-the-fold fixes come first (reserve dimensions, fix LCP loading, unblock first paint). When consolidating one-off values to design tokens or shared components, change call sites mechanically and preserve rendered output — never change copy or visual design intent. If a finding requires a design decision (e.g., which of two button styles is canonical), pick the variant with the most call sites and note the choice in the commit message
- Structural Ambition _(strict mode only)_ — remediation worker must apply the specific reframing named in each finding (extract module, collapse condition chain, delete wrapper, move logic to canonical layer). Do NOT settle for "cleaner version of the same idea" — if the finding says "delete this branch by reframing X as Y," the fix must actually delete the branch. If a reframing turns out to be infeasible after investigation, leave the finding as-is and document why in the commit message rather than substituting a cosmetic change

<!-- if:teams -->
1. Use `TeamCreate` with name `better-{DATE}`.
2. Use `TaskCreate` for each category above that has actionable findings.
3. Spawn up to 5 general-purpose agents as teammates. **Pass `REMEDIATION_MODEL` as the `model` parameter on each agent.** If `REMEDIATION_MODEL` is `opus`, omit the parameter to inherit from session. Each teammate marks its task complete via `TaskUpdate` when done.
<!-- else -->
1. Spawn up to 5 general-purpose `Agent` sub-agents — one per category above that has actionable findings. **Pass `REMEDIATION_MODEL` as the `model` parameter on each `Agent` call.** If `REMEDIATION_MODEL` is `opus`, omit the parameter to inherit from session.
2. Launch all `Agent` calls **in parallel** (multiple tool calls in a single response) and wait for all to return. Each sub-agent returns its results directly — no task board or shutdown step is needed.
<!-- /if:teams -->

### Agent instructions template:

!`cat ~/.claude/lib/remediation-agent-template.md`

### Dependency Freedom agent — special instructions:
The Dependency Freedom remediation agent has a unique task: for each removable dependency, it must (1) write replacement code (utility function or inline native API call), (2) update ALL import/require statements across the codebase, (3) remove the package from the manifest, and (4) regenerate the lock file (`npm install` / `cargo update` / etc.). After all replacements, verify no source file still references the removed package. See `/do:depfree` Phase 3b for the full agent template.

### Conflict avoidance:
- Review all findings before task assignment. If two categories touch the same file, assign both sets of findings to the same agent.
- Security agent gets priority on validation logic; DRY agent gets priority on import consolidation.
- Dependency Freedom agent gets priority on files that are solely import/usage sites of a removed package.

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
<!-- if:teams -->
4. Shut down all agents via `SendMessage` with `type: "shutdown_request"`
5. Clean up team via `TeamDelete`
<!-- else -->
4. No teardown needed — the parallel sub-agents from Phase 3c have already returned.
<!-- /if:teams -->

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
4. **Default mode**: Print a brief summary of findings and fixes, then proceed to PR creation automatically.
   **Interactive mode (`--interactive`)**: Present a summary to the user via `AskUserQuestion`:
   ```
   AskUserQuestion([{
     question: "Code review complete. {N} issues found and fixed. {list}. Proceed to PR creation?",
     options: [
       { label: "Proceed", description: "Create per-category PRs" },
       { label: "Commit directly", description: "Merge worktree changes into {CURRENT_BRANCH} — no PRs, no review loops" },
       { label: "Show diff", description: "Show the full diff for manual review before proceeding" },
       { label: "Abort", description: "Stop here — I'll review manually" }
     ]
   }])
   ```
5. (Interactive only) If "Show diff" selected, print the diff and re-ask. If "Abort", stop and print the worktree path.
6. If "Commit directly" selected:
   - All remediation and review fixes are already committed incrementally in the worktree branch `better/{DATE}`. If any uncommitted changes remain, stage and commit them now:
     ```bash
     cd {WORKTREE_DIR}
     git diff --quiet && git diff --cached --quiet || {
       git add <list of remaining changed files>
       git commit -m "fix: better audit remediation — remaining changes"
     }
     ```
   - Return to the main repo checkout, merge the worktree branch, and clean up on success:
     ```bash
     cd {REPO_DIR}
     git checkout {CURRENT_BRANCH}
     if git merge better/{DATE}; then
       git worktree remove {WORKTREE_DIR}
       git branch -D better/{DATE}
     else
       echo "Merge conflict — resolve in {REPO_DIR}, then run:"
       echo "  git worktree remove {WORKTREE_DIR}"
       echo "  git branch -D better/{DATE}"
     fi
     ```
   - Restore stash if needed (`git stash pop`), update PLAN.md, print final summary, then **stop** — this completes the workflow (Phases 5, 6, and 7 are skipped entirely since no PRs or category branches were created)

## Phase 4c: Test Enhancement

After internal code review passes, evaluate and enhance the project's test suite. This phase acts on Agent 8's findings AND ensures all remediation work from Phase 3 has proper test coverage.

### 4c.0: Record Start SHA

Before any test enhancement commits, capture the current HEAD so Phase 4c changes can be diffed later:
```bash
cd {WORKTREE_DIR}
PHASE_4C_START_SHA="$(git rev-parse HEAD)"
```

### 4c.1: Test Audit Triage

Review Agent 8 (Test Quality & Coverage) findings from Phase 1 and categorize them:

1. **`[VACUOUS]` findings** — tests that exist but don't test real behavior. These are the highest priority because they create a false sense of safety.
2. **`[WEAK]` findings** — tests that partially cover behavior but miss important cases. Strengthen with additional assertions and edge cases.
3. **`[MISSING]` findings** — no tests exist for critical paths. Write new test files or add test cases to existing files.

Additionally, scan all remediation changes from Phase 3:
- For each file modified by remediation agents, check if corresponding tests exist
- If tests exist, verify they cover the specific behavior that was fixed/changed
- If no tests exist for a remediated module, flag for new test creation

### 4c.2: Test Enhancement Execution

Spawn a general-purpose agent (using `REMEDIATION_MODEL`) in the worktree to fix and write tests. Populate the template placeholders below from Phase 4c.1 triage output: `{VACUOUS_AND_WEAK_FINDINGS}` from `[VACUOUS]`/`[WEAK]` findings, `{MISSING_FINDINGS}` from `[MISSING]` findings, and `{REMEDIATED_FILES_WITHOUT_TESTS}` from the remediation-change scan. The agent instructions:

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

## Phase 5: Per-Category PR Creation

Instead of one mega PR, create **separate branches and PRs for each category**. This enables independent review, targeted CI, and granular merge decisions.

### 5a: Build the Category Branches

Using the `FILE_OWNER_MAP` from Phase 2 (updated in Phase 4c.3), create one branch per category.

Initialize `CREATED_CATEGORY_SLUGS=""` (empty space-delimited string). After each category branch is successfully created and pushed below, append its slug: `CREATED_CATEGORY_SLUGS="$CREATED_CATEGORY_SLUGS {CATEGORY_SLUG}"`. Phase 7 uses this as the set of candidate branches for cleanup; when deleting branches, either run cleanup only after all desired merges are complete or explicitly verify that each branch in `CREATED_CATEGORY_SLUGS` has been merged before deleting it.

For each category that has findings:
1. Switch to `{DEFAULT_BRANCH}`: `git checkout {DEFAULT_BRANCH}`
2. Create a category branch: `git checkout -b better/{CATEGORY_SLUG}`
   - Use slugs: `security`, `code-quality`, `dry`, `architecture`, `bugs-perf`, `stack-specific`, `deps`, `tests`, `ux` (UI projects only), and `structural` (strict mode only)
3. For each file assigned to this category in `FILE_OWNER_MAP`:
   - **Modified files**: `git checkout better/{DATE} -- {file_path}`
   - **New files (Added)**: `git checkout better/{DATE} -- {file_path}`
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
1. Set `FIRST_CATEGORY` to the first category slug that has a branch (e.g., `security` if it exists, otherwise the next in order)
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

**GATE: If `VCS_HOST` is `gitlab`, STOP HERE.** Print all MR URLs and summary. The automated Phase 6 review loop + auto-merge run on GitHub PRs only; GitLab MRs are left open for manual review and merge.

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

## Phase 6: Review Loop (GitHub only)

**GATE — no reviewer requested: If `REVIEW_AGENTS` is empty** (no `--review-with` was passed), **skip this entire phase AND the Phase 6.4 merge.** There is no default reviewer. Leave every PR open for manual review, print the PR URLs and summary (mark the Review column `none — left open`), then proceed to Phase 7 cleanup. PRs are merged only after a clean review loop, which requires an explicit `--review-with`.

Otherwise, run each PR through the **multi-reviewer loop** over `REVIEW_AGENTS`, in order, with the parsed `{REVIEW_STOP_MODE}`, `{REVIEWER_APPLIES}`, and `{REVIEW_ITERATIONS}` (the last caps copilot passes only; local-agent passes use their own fixed 3-iteration cap). A copilot pass with the default `--review-iterations 1` runs a single review-and-fix cycle and returns `capped` (clean-equivalent / ready-to-merge). `0` lets a copilot pass loop until 0 comments, bounded by the copilot loop's 10-iteration guardrail. **Default mode**: auto-stop at the guardrail. **Interactive mode (`--interactive`)**: prompt the parent agent to ask the user whether to continue or stop.

**Sub-agent delegation** (prevents context exhaustion): delegate each PR's review loop to a **separate general-purpose sub-agent** via the Agent tool. Launch sub-agents in parallel (one per PR). Each sub-agent runs the multi-reviewer loop (which dispatches each listed agent to the copilot loop or the local-agent loop) autonomously against its PR's branch and returns only the final aggregate status.

### 6.1: Launch parallel sub-agents (one per PR)

For each PR, spawn a general-purpose sub-agent that runs the **multi-reviewer wrapper** below over `REVIEW_AGENTS` for that PR. The wrapper `!cat`s the inner loop bodies it dispatches to:

!`cat ~/.claude/lib/multi-reviewer-loop.md`

!`cat ~/.claude/lib/copilot-review-loop.md`

!`cat ~/.claude/lib/local-agent-review-loop.md`

!`cat ~/.claude/lib/ollama-review-loop.md`

Pass each sub-agent the PR-specific variables: `{REVIEW_AGENTS}`, `{REVIEW_STOP_MODE}`, `{REVIEWER_APPLIES}`, `{PR_NUMBER}`, `{OWNER}/{REPO}`, `better/{CATEGORY_SLUG}` (the branch the local-agent loop checks out and reviews), `{BUILD_CMD}`, and `{REVIEW_ITERATIONS}` (the copilot iteration cap; default 1).

Launch all PR sub-agents in parallel. Wait for all to complete.

### 6.2: Handle sub-agent results

Each sub-agent returns the multi-reviewer wrapper's `{OVERALL_STATUS}` for its PR:
- **clean**: every executed pass returned clean (copilot `capped`/`too-large` count as clean) — mark PR as ready to merge
- **partial**: a stop-mode flag short-circuited the list and every executed pass was clean — mark PR as ready to merge (the user opted into the short-circuit)
- **inconclusive**: at least one requested pass timed out, errored, hit its guardrail, or was skipped (e.g. a missing CLI binary, or copilot when no PR review could be produced). **Default mode**: leave the PR open for manual review. **Interactive mode**: inform the user and ask whether to merge anyway, re-run, or skip
- **dirty**: a pass left the branch with a broken build / failed tests / explicit reject. **Default mode**: leave the PR open. **Interactive mode**: ask whether to fix-and-retry or skip

### 6.3: Merge Gate (MANDATORY)

**Do NOT merge any PR whose aggregate review status is not `clean` (or `partial` under an explicit stop-mode).** A missing or inconclusive review is NOT a clean review.

### Default Mode (autonomous)

Print the review status summary, then auto-merge all PRs whose reviews completed cleanly. PRs that timed out, hit guardrails, or still have unresolved comments are left open for manual review. Print which PRs were merged and which were left open.

### Interactive Mode (`--interactive`)

Present the review status summary to the user via `AskUserQuestion`:
```
AskUserQuestion([{
  question: "Review status ({REVIEW_AGENTS}):\n{for each PR: #number - aggregate status (clean/partial/inconclusive/dirty)}\n\nHow would you like to proceed?",
  options: [
    { label: "Merge approved PRs", description: "Merge only PRs with passing review" },
    { label: "Merge all", description: "Merge all PRs regardless of review status" },
    { label: "Wait", description: "Wait longer for pending reviews" },
    { label: "Don't merge", description: "Leave PRs open for manual review" }
  ]
}])
```

Only proceed with merging based on the user's selection.

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
2. Delete the local staging branch and per-category branches (local + remote). Use the tracked list of branches from Phase 5 rather than a fixed list:
   ```bash
   git checkout {DEFAULT_BRANCH}
   git branch -D better/{DATE}
   # CREATED_CATEGORY_SLUGS is a space-delimited string, e.g. "security code-quality tests"
   for slug in $CREATED_CATEGORY_SLUGS; do
     git branch -d "better/$slug" || echo "warning: local branch better/$slug not found or not fully merged — skipping (use -D to force)"
     git push origin --delete "better/$slug" || echo "warning: remote branch better/$slug not found or already deleted"
   done
   ```
   `-D` (force delete) is used only for the staging branch `better/{DATE}` because it is intentionally unmerged — its file contents are cherry-picked into category branches. Category branches use `-d` (safe delete) so that unmerged work is not accidentally lost; if a category branch was not merged, the warning will surface it. The guards prevent errors from interrupting cleanup.
3. Restore stashed changes (if stashed in Phase 3a):
   ```bash
   git stash pop
   ```
4. Update PLAN.md:
   - Mark completed findings by flipping `- [ ]` → `- [x]` — **preserve the `[<slug>]` ID** on each line (only the box character changes, the slug stays). See [lib/plan-id-format.md](../../lib/plan-id-format.md).
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
| Dep Freedom        | ...      | ...   | ...     | #number  | pass   | approved |
| Tests              | ...      | ...   | ...     | #number  | pass   | approved |
| UX                 | ...      | ...   | ...     | #number  | pass   | approved |
| Structural         | ...      | ...   | ...     | #number  | pass   | approved |
| TOTAL              | ...      | ...   | ...     | N PRs    |        |          |

Omit the **UX** row when `HAS_UI=false` and the **Structural** row when `STRICT_MODE=false`.

Test Enhancement Stats:
- Vacuous tests fixed: {VACUOUS_TESTS_FIXED}
- Weak tests strengthened: {WEAK_TESTS_STRENGTHENED}
- New test cases added: {NEW_TEST_CASES}
- New test files created: {NEW_TEST_FILES}
```

## Error Recovery

- **Agent failure**: continue with remaining agents, note gaps in the summary
- **Build failure in worktree**: attempt fix in a new commit; if unfixable, revert problematic commits and ask the user
- **Push failure**: `git pull --rebase --autostash` then retry push
- **CI failure on PR**: investigate logs, fix in a new commit, push, re-check (max 3 attempts per PR)
- **Cross-PR dependency breakage**: add backward-compatible re-exports or move shared files to the PR that creates them
- **Reviewer timeout / error / guardrail** (copilot review not received in the timeout window, a local CLI errored, or a copilot pass hit its 10-iteration limit): the per-PR sub-agent surfaces it as an `inconclusive` aggregate. **Default mode**: leave that PR open. **Interactive mode**: ask the user whether to merge without a clean review, re-run, or skip
- **Copilot "too-large"** (PR exceeds Copilot's 20 000-line limit): the copilot pass treats it as clean — do NOT re-request; it counts toward a clean aggregate
- **Missing reviewer CLI** (`--review-with codex`/`agy`/`claude` but the binary isn't installed): the multi-reviewer loop records that pass as `skipped` (→ inconclusive aggregate). It does NOT silently fall back to copilot
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
- Dependency Freedom findings replace unnecessary third-party packages with owned code — see `/do:depfree` for standalone usage
- Test Quality & Coverage findings are remediated in Phase 4c with a dedicated test enhancement agent that verifies tests fail when code is broken
- The UX Consistency & Responsive Layout agent runs only when the project ships a user-facing UI (`HAS_UI=true`). It weights above-the-fold UX highest — findings affecting initial-viewport content are bumped one severity tier — then responsive layout correctness, then design consistency. General accessibility stays with the Stack-Specific agent to avoid duplicate findings
- **No default reviewer**: without `--review-with`, Phase 6 and the auto-merge are skipped and all PRs are left open for manual review. Pass `--review-with <agent[,agent,...]>` to run a review loop and enable auto-merge on a clean result. `copilot` is never added implicitly
- GitLab projects skip the Phase 6 review loop + auto-merge entirely and stop after MR creation (the loop drives GitHub PRs; local-agent reviewers aside, there is no GitLab merge path here)
- CI must pass on each PR before its review loop runs or it is merged
- `--strict` (alias `--nuclear`) adds the Structural Ambition agent and promotes its blocker-tier findings (file >1000 lines, spaghetti additions, thin wrappers, boundary leaks, canonical-helper duplication) to CRITICAL. Use when auditing a branch you want to land cleanly. The Structural Ambition category produces high-judgment findings — expect more remediation churn than the runtime/security agents and budget extra review iterations for its PR. If a finding's reframing turns out to be infeasible after investigation, leave it and document why rather than substituting a cosmetic change
