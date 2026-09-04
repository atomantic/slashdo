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
> Phase 1 spooled the finding **bodies** to `SPOOL_DIR` and returned only the
> **index**, so consolidate and dedup against those index lines — steps 2–4 need
> nothing else, so do not open a spool file **for them**. **Step 3 is the exception**:
> grouping the Foundation extractions needs the duplication counts and call-site lists that
> live only in the bodies, so read `$SPOOL_DIR/dry.md` for the ids step 2 kept in the `dry`
> category before writing the Foundation list Phase 3b builds from. Beyond that, the only
> reasons to open a spool file are targeted validation of `UNCERTAIN` findings
> against their cited source, and lifting a block verbatim into a `--body-file` on
> the inline path below. A validated finding receives its assessed severity;
> a disproven one is dropped. Keep unresolved findings explicitly unconfirmed,
> track them as investigation follow-ups without a confirmed severity label, and
> never auto-remediate them. When validation changes a status, have the owning
> audit worker update that finding's block and index before filing; the
> orchestrator still does not retype spooled evidence. When the surviving set is
> larger than ~20 findings, hand the ids off to per-category **filer agents** per
> the partial's "Bulk filing — spool the bodies, dedup on an index" section rather
> than running `gh issue create` yourself; at or below that, file them inline —
> still lifting each id's block verbatim out of its spool file into a `--body-file`,
> never retyping it from the index line.

1. Read the existing `PLAN.md` (create if it doesn't exist)
2. Validate `UNCERTAIN` evidence against the cited source before assigning severity; drop disproven findings and retain unresolved ones only as unconfirmed investigation follow-ups. Consolidate all findings from Phase 1, deduplicating across agents (same file:line flagged by multiple agents → keep the most specific description)
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
### Cognitive Load & Readability  _(only when SIMPLIFY_ONLY=true)_
```

When `SIMPLIFY_ONLY=true`, emit only the [`SIMPLIFY_CATEGORIES`](./better-simplify.md) sections and drop the rest. Apply [gate 3](./better-simplify.md) here — this is the one place churn adjusts severity — and record any rejection per [gate 4](./better-simplify.md), which in PLAN.md mode means opening a `### Rejected reframings` subsection for Phases 3c and 4b to append to.

**Every appended `- [ ]` line MUST include a unique `[<slug>]` ID** so concurrent agents (`feature-ideas`, `plan-task`, manual fix-up sessions) can claim distinct findings via worktree branch names. Slug rules per [lib/plan-id-format.md](./plan-id-format.md): lowercase kebab-case derived from the title text, ≤50 chars, unique against every `[slug]` already in PLAN.md. Recommended pattern for audit findings: `<category-prefix>-<file-basename>-<short-hint>` (e.g. `[sec-routes-pr-validation]`, `[dry-cli-output-dedup]`). _(Issue mode skips slugs entirely — the issue number is the ID.)_

!read lib/plan-issue-mode.md

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
   - Cognitive Load → Cognitive Load & Readability → `cognitive-load` _(simplify-only mode)_

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
| Cognitive Load    | ...      | ...  | ...    | ... | ...   |
| TOTAL             | ...      | ...  | ...    | ... | ...   |
```

Omit the **UX** row when `HAS_UI=false`, the **Structural** row when `STRICT_MODE=false`, and the **Cognitive Load** row when `SIMPLIFY_ONLY=false`. When `SIMPLIFY_ONLY=true`, keep only the [`SIMPLIFY_CATEGORIES`](./better-simplify.md) rows.

**GATE: If `--scan-only` was passed, STOP HERE** — but not before doing the one thing a scan-only run in issue mode exists to do: **when `ISSUE_MODE` is also true, file every surviving finding as an issue first**, then print the summary and exit. (When `ISSUE_MODE` is false, just print the summary and exit.)

**Filing every surviving finding** means all of them — not just the ones the disposition rules would defer. A scan-only run remediates nothing, so "deferred" covers the whole set; the filed issues ARE the run's output. Apply the same labels, dedup-against-`EXISTING_ISSUES`, and title/body rules the disposition partial specifies, and report the created and reused `#<number>`s in the summary. Do not open a worktree or write any code. **Then remove `SPOOL_DIR`** (`rm -rf "$SPOOL_DIR"`, same errored-filer exception) — a scan-only run has no Phase 3c or 4c to read the bodies, so filing is the last read.

**Hand the filing to per-category filer agents when the surviving set exceeds ~20.**
A `--scan-only --issues` run on a real codebase is exactly the case the partial's
"Bulk filing" section exists for: every surviving finding gets filed, so the volume
is the whole audit. Dispatch one filer agent per category **in parallel**, giving
each the surviving ids for its category, the `$SPOOL_DIR/<category-slug>.md` file
those bodies live in, `CLI_TOOL`, `PLAN_LABEL`, the label rules, the `${URL##*/}`
number-capture form, and the secondary-rate-limit retry rule. Each returns only its
`<id> -> #<number>` map. One agent per category is the correct fan-out — your dedup
already gave each finding exactly one category, so no two filers can collide, and
sharding a category further only makes rate limiting more likely.

Merge the returned maps for the summary. **An id a filer returned as `ERROR` was not
filed** — report those separately with their spool path so they can be filed by hand,
and keep `SPOOL_DIR` on disk when any error occurred. At or below ~20 surviving
findings, skip the fan-out and file them inline — still `--body-file`ing each block
verbatim out of the spool, never retyped from the index line; only the fan-out overhead
isn't worth it at that size.
