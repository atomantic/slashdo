## Phase 2: Plan Generation

Steps 2–4 are an in-run plan kept in context, never written to a file; only tracker issues persist.

1. Fetch `EXISTING_ISSUES` per the setup and filing partials (skip when `TRACKER_AVAILABLE=false`).
2. Validate `UNCERTAIN` findings, then deduplicate across agents and against `EXISTING_ISSUES`, per the spool contract.
3. Group **Foundation** work: patterns duplicated 3+ times that should become one shared utility, built in Phase 3b.
4. Build `FILE_OWNER_MAP`: every touched file belongs to exactly one category, the one with its highest-severity finding. Remediation uses it to give each file a single worker, and Phase 5 uses it to cut the category PRs. Where one category's fix cannot build without another's (a moved symbol whose importers another category owns), note the pair now; Phase 5 ships such categories in one PR instead of adding a compatibility shim to make them separable.
5. **Disposition.** CRITICAL/HIGH/MEDIUM code findings go to Phase 3 (tests to Phase 4c). LOW findings, unconfirmed follow-ups, and anything else not remediated this run are **deferred** and filed as labeled issues (under `--scan-only`, the gate below files everything instead).
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

**Gate:** if `--scan-only` was passed, stop here. First file every surviving finding as an issue, not only the deferred ones, because the issues are the run's output (with no tracker, list them per [lib/better-issue-mode.md](./better-issue-mode.md)); then print the summary and exit without opening a worktree or writing code. Filing is the last read of the spool in a scan-only run, so remove `SPOOL_DIR` afterwards (`rm -rf` on its literal recorded path), unless a filer returned `ERROR`.
