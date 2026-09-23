## Phase 2: Plan Generation

Per [lib/better-issue-mode.md](./better-issue-mode.md) (read once at pipeline start), steps 2–4 below are the in-run working plan kept in context — nothing is written to a plan file — and the only persistent records are tracker issues.

1. Fetch `EXISTING_ISSUES` per the setup and filing partials (skip when `TRACKER_AVAILABLE=false`).
2. Validate `UNCERTAIN` evidence against the cited source before assigning severity; drop disproven findings and retain unresolved ones only as unconfirmed investigation follow-ups. Consolidate all findings from Phase 1, deduplicating across agents (same file:line flagged by multiple agents → keep the most specific description) and against `EXISTING_ISSUES` (a finding with an open issue reuses its `#<number>`)
3. Identify **shared utility extractions** — patterns duplicated 3+ times that should become reusable functions. Group these as "Foundation" work for Phase 3b.
4. **Build the file ownership map** (required by Phase 5 for conflict-free PRs):
   - For each finding, record which file(s) it touches
   - Assign each file to exactly ONE category (its primary category)
   - If a file is touched by multiple categories, assign it to the category with the highest-severity finding for that file
   - Record the mapping as `FILE_OWNER_MAP` — this ensures no two PRs modify the same file
   - If a module extraction creates a new file (e.g., extracting `mediaConvert.js` from `dbCrud.js`), add a backward-compatible re-export in the original file so other PRs don't break

When `SIMPLIFY_ONLY=true`, keep only the [`SIMPLIFY_CATEGORIES`](./better-simplify.md) categories and drop the rest. Apply [gate 3](./better-simplify.md) here — this is the one place churn adjusts severity — and record any rejection per [gate 4](./better-simplify.md).

5. **Disposition.** CRITICAL/HIGH/MEDIUM code findings go to Phase 3 (tests to Phase 4c). LOW findings, unconfirmed follow-ups, and anything else not remediated this run are **deferred** (under `--scan-only`, the gate below files everything instead): file each as a labeled issue, deduped against `EXISTING_ISSUES`, per [lib/better-issue-mode.md](./better-issue-mode.md) — or, when `TRACKER_AVAILABLE=false`, hold them for the Phase 7 "Deferred (not filed — no issue tracker available)" list.

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

Omit the **UX** row when `HAS_UI=false`, the **Structural** row when `STRICT_MODE=false`, and the **Cognitive Load** row when `SIMPLIFY_ONLY=false`. When `SIMPLIFY_ONLY=true`, keep only the [`SIMPLIFY_CATEGORIES`](./better-simplify.md) rows. A caller-specific Phase 2 category map, when supplied, is authoritative for category names and slugs.

**GATE: If `--scan-only` was passed, STOP HERE** — but not before doing the one thing a scan-only run exists to do: **file every surviving finding as an issue first**, then print the summary and exit. (When `TRACKER_AVAILABLE=false`, list them under "Deferred (not filed — no issue tracker available)" instead.)

**Filing every surviving finding** means all of them — not just the ones the disposition rules would defer. A scan-only run remediates nothing, so "deferred" covers the whole set; the filed issues ARE the run's output. Apply the same labels, dedup-against-`EXISTING_ISSUES`, and title/body rules the disposition partial specifies, and report the created and reused `#<number>`s in the summary. Do not open a worktree or write any code. **Then remove `SPOOL_DIR`** (`rm -rf "$SPOOL_DIR"`, same errored-filer exception) — a scan-only run has no Phase 3c or 4c to read the bodies, so filing is the last read.

File through [lib/better-issue-mode.md](./better-issue-mode.md)'s filer-fan-out rules.
