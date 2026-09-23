## Phase 2: Plan Generation

Per [lib/better-issue-mode.md](./better-issue-mode.md) (read once at pipeline start), steps 2–4 below are the in-run working plan kept in context — nothing is written to a plan file — and the only persistent records are tracker issues.

1. Fetch `EXISTING_ISSUES` per the setup and filing partials (skip when `TRACKER_AVAILABLE=false`).
2. Validate `UNCERTAIN` evidence against the cited source before assigning severity; drop disproven findings and keep unresolved ones only as unconfirmed investigation follow-ups. Deduplicate across agents (same `file:line` → keep the most specific description) and against `EXISTING_ISSUES` (a finding with an open issue reuses its `#<number>`).
3. Group **Foundation** work: patterns duplicated 3+ times that should become one shared utility, built in Phase 3b.
4. Build `FILE_OWNER_MAP`, which Phase 5 needs for conflict-free PRs: every touched file belongs to exactly ONE category — the one with its highest-severity finding. A module extraction that creates a new file keeps a backward-compatible re-export in the original file.
5. **Disposition.** CRITICAL/HIGH/MEDIUM code findings go to Phase 3 (tests to Phase 4c). LOW findings, unconfirmed follow-ups, and anything else not remediated this run are **deferred** (under `--scan-only`, the gate below files everything instead): file each as a labeled issue, deduped against `EXISTING_ISSUES`, per [lib/better-issue-mode.md](./better-issue-mode.md) — or, when `TRACKER_AVAILABLE=false`, hold them for the Phase 7 "Deferred (not filed — no issue tracker available)" list.
6. Print the summary table: one row per category (short label) with `CRITICAL | HIGH | MEDIUM | LOW | Total` columns, then a `TOTAL` row.

| Short label | Full category | Slug |
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

Omit a conditional category when its condition is false. When `SIMPLIFY_ONLY=true`, keep only the [`SIMPLIFY_CATEGORIES`](./better-simplify.md) and apply the simplify contract's Phase 2 rules. A caller-specific Phase 2 category map, when supplied, is authoritative for category names and slugs.

**GATE: If `--scan-only` was passed, STOP HERE** — but not before you **file every surviving finding as an issue first** (all of them, not just the deferred ones: the filed issues are the run's output), then print the summary and exit; when `TRACKER_AVAILABLE=false`, list them under "Deferred (not filed — no issue tracker available)" instead. Filing follows [lib/better-issue-mode.md](./better-issue-mode.md)'s labels, `EXISTING_ISSUES` dedup, and filer-fan-out rules; report created and reused `#<number>`s. Open no worktree and write no code. **Then remove `SPOOL_DIR`** (`rm -rf "$SPOOL_DIR"`, same errored-filer exception) — a scan-only run has no Phase 3c or 4c to read the bodies, so filing is the last read.
