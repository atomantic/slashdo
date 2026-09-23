## Phase 2: Plan Generation

Issue mode replaces the `PLAN.md` steps below per [lib/better-issue-mode.md](./better-issue-mode.md) (already loaded); steps 2–4 still run as the in-context working plan.

1. Read the existing `PLAN.md` (create it if missing).
2. Validate `UNCERTAIN` evidence against the cited source before assigning severity; drop disproven findings and keep unresolved ones only as unconfirmed investigation follow-ups. Deduplicate across agents (same `file:line` → keep the most specific description).
3. Group **Foundation** work: patterns duplicated 3+ times that should become one shared utility, built in Phase 3b.
4. Build `FILE_OWNER_MAP`, which Phase 5 needs for conflict-free PRs: every touched file belongs to exactly ONE category — the one with its highest-severity finding. A module extraction that creates a new file keeps a backward-compatible re-export in the original file.
5. Append `## Better Audit - {YYYY-MM-DD}` to PLAN.md: a one-line summary (`{N} findings across {M} files. {X} shared utilities to extract.`), a `### Foundation — Shared Utilities` list (name, purpose, files replaced, signature sketch), a `### File Ownership Map` table (`| File | Primary Category | Reason |`, reasons for multi-category files), then one `###` section per category below, in order, each finding as:
   ```
   - [ ] [<slug>] **[SEVERITY]** `file:line` - Description — Fix: ... (Complexity: Simple/Medium/Complex)
   ```

   **Every appended `- [ ]` line MUST include a unique `[<slug>]` ID**. Slug rules per [lib/plan-id-format.md](./plan-id-format.md): lowercase kebab-case from the title, ≤50 chars, unique against every `[slug]` already in PLAN.md; prefer `<category-prefix>-<file-basename>-<short-hint>`. _(Issue mode skips slugs — the issue number is the ID.)_
6. Print the summary table: one row per category (short label) with `CRITICAL | HIGH | MEDIUM | LOW | Total` columns, then a `TOTAL` row.

| Short label | PLAN.md section | Slug |
|---|---|---|
| Security | Security & Secrets | `security` |
| Code Quality | Code Quality & Style | `code-quality` |
| DRY & YAGNI | DRY & YAGNI | `dry` |
| Architecture | Architecture & SOLID | `architecture` |
| Bugs & Perf | Bugs, Performance & Error Handling | `bugs-perf` |
| Stack-Specific | Stack-Specific | `stack-specific` |
| Dep Freedom | Dependency Freedom | `deps` |
| Tests | Test Quality & Coverage | `tests` |
| UX | UX Consistency & Responsive Layout | `ux` (only when `HAS_UI=true`) |
| Structural | Structural Ambition | `structural` (only when `STRICT_MODE=true`) |
| Cognitive Load | Cognitive Load & Readability | `cognitive-load` (only when `SIMPLIFY_ONLY=true`) |

Omit a conditional category's section and row when its condition is false. When `SIMPLIFY_ONLY=true`, keep only the [`SIMPLIFY_CATEGORIES`](./better-simplify.md). A caller-specific Phase 2 category map, when supplied, is authoritative for category names and slugs.

**GATE: If `--scan-only` was passed, STOP HERE** — but first, **when `ISSUE_MODE` is also true, file every surviving finding as an issue first** (all of them, not just the deferred ones: the filed issues are the run's output), then print the summary and exit. Filing follows [lib/better-issue-mode.md](./better-issue-mode.md)'s labels, `EXISTING_ISSUES` dedup, and filer-fan-out rules; report created and reused `#<number>`s. Open no worktree and write no code. **Then remove `SPOOL_DIR`** (`rm -rf "$SPOOL_DIR"`, same errored-filer exception) — a scan-only run has no Phase 3c or 4c to read the bodies, so filing is the last read.
