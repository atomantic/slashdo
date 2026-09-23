## Phase 1: Unified Audit

Project conventions are already in your context. Pass relevant conventions to each agent.

Choose audit scopes from the user's path/focus filter and the detected project, not a fixed worker quota. Cover every applicable requested scope; do not infer an arbitrary subset to save tokens. Record why a scope is inapplicable. Combine small/overlapping scopes in one worker and cap concurrent workers at the host's available slots. A combined worker preserves each finding's category and writes each assigned category to its own spool file; each category belongs to only one worker. Without delegation, run the same scopes serially.

For a normal audit, cover security, code quality, DRY, architecture, bugs/performance, stack-specific behavior, dependencies when third-party packages exist, and tests. Add UX only with `HAS_UI=true` and structural ambition only with `STRICT_MODE=true`. Run the test audit after the other selected scopes so it receives their compact finding index, not their full reports. Other scopes are independent.

When `SIMPLIFY_ONLY=true`, select only code-quality, dry, architecture, structural, and cognitive-load in one batch, subject to the path/focus filter. Pass simplify gates 1, 2, and 4 plus `PRIOR_REJECTIONS` and the distilled `DOMAIN_DOCS` glossary. Only cognitive-load gets `HOT_FILES` as a search priority; agents never apply churn severity adjustment.

**Worker context:** give each worker its assigned paths, scope/lens below, relevant repository conventions, project/build/test facts, evidence format, and applicable mode/spool contract. Do not pass the complete command, other lenses, whole ADRs, future phases, or reviewer libraries. Resolve `AUDIT_MODEL_TIER` against the host per the model-tier guidance. Ask for confirmed findings and explicit coverage gaps, not a target finding count.

A capable model already looks for the usual bug/style catalogs without being told; what it needs from you is scope and ownership, not a checklist. Give each worker only its row below — never another scope's row, and never the whole table:

| Scope | Remit | Ownership boundary |
|-------|-------|---------------------|
| `security` | Auth, secrets, injection, unsafe input handling, supply-chain risk | Known CVEs in a dependency are reported here; whether to remove that dependency is `deps`' call |
| `code-quality` | Brittleness, dead/unreachable code, unused imports, logging & observability | Language/framework-idiom violations belong to `stack-specific`, not here |
| `dry` | Duplication, speculative abstraction, YAGNI | — |
| `architecture` | Coupling, modularity, dependency inversion, API contract consistency (skip API contract findings when `SIMPLIFY_ONLY=true` — that's behavior, not structure) | Reader-cost of an individual function belongs to `cognitive-load` (simplify-only mode), not here |
| `bugs-perf` | Runtime correctness, resource/perf, resilience, and observability of failure paths | — |
| `stack-specific` | Detected-language/framework idioms and gotchas; general accessibility (alt text, ARIA, contrast) | Accessibility that is also a layout failure (touch target size, content clipped) belongs to `ux` instead |
| `deps` | Third-party dependency necessity and removability | — |
| `tests` | Coverage gaps and vacuous/weak test quality | Runs last among selected scopes and receives their compact finding index, not their full reports |
| `ux` (UI projects only) | Layout, responsive behavior, visual consistency | Accessibility only when it is also a layout failure; otherwise `stack-specific` owns it |
| `structural` (strict mode only) | Code-judo reframings, boundary leaks, canonical-helper duplication, growth past the size a single file should carry | Give this worker the structural lens below; no other scope needs it |
| `cognitive-load` (simplify-only mode) | How much a reader must hold in their head to change one line safely | Size/shape thresholds (god files, over-long functions, nesting, parameter count) belong to `architecture`, not here |

Repository conventions (already in each worker's context) supersede this table — do not pass one author's local style preferences as if they were universal.

Only the `structural` worker reads the structural lens, and only when `STRICT_MODE=true`:
!read lib/review-structural-ambition.md

The preferences that change a worker's output, beyond the table above:
- **`deps` severity:** unmaintained with CVEs → CRITICAL, unmaintained without CVEs → HIGH, replaceable single-function usage → MEDIUM, suspect but complex replacement → LOW. Report format: `**[SEVERITY]** {package} — {tier}. Uses: {functions}. Call sites: {N} in {M} files. Replacement: {complexity}. Reason: {why removable}`.
- **`tests` tags:** prefix each finding's severity with a quality tag — `[VACUOUS]` (asserts nothing that could fail), `[WEAK]` (verifies implementation details or passes on a no-op result), or `[MISSING]` (no coverage) — e.g. `**[HIGH][VACUOUS]**`.
- **`ux` above-the-fold bump:** bump severity one tier when a finding affects initial-viewport content at common viewports.
- **`structural` blockers are `[CRITICAL]`:** file pushed past 1000 lines, spaghetti growth in existing code, thin wrappers, boundary leaks, and canonical-helper duplication are always `[CRITICAL]`, so Phase 2 picks them up for remediation. Drop findings that only say "could be cleaner" without a concrete reframing.
- **`cognitive-load` defers size/shape:** never re-flag god files, over-long functions, nesting depth, or parameter counts — those are `architecture`'s findings.
- **Every finding names a concrete transformation** (extract, invert, rename, table-ize, early-return, a specific replacement) — never a bare "could be cleaner."

Each agent must report findings in this format:
```
- **[CRITICAL/HIGH/MEDIUM/LOW]** `file:line` - Description. Suggested fix: ... Complexity: Simple/Medium/Complex
```

**Issue mode (`--issues`) changes where this format goes, not what it contains.**
Only when `ISSUE_MODE=true` (the shared contract was already loaded once at
pipeline start, see [lib/better-issue-mode.md](./better-issue-mode.md)), create the
spool directory before dispatching any agent:

```bash
SPOOL_DIR="$(mktemp -d "${TMPDIR:-/tmp}/slashdo-issues-XXXXXX")"; echo "$SPOOL_DIR"
```

Record the printed path as `SPOOL_DIR` in run state and pass **that literal path**
to every agent — a shell variable does not survive between tool calls, so
re-deriving it later would hand the filer agents an empty directory. Each agent
writes one ready-to-file issue body per finding to `$SPOOL_DIR/<category-slug>.md` —
using its own category slug from Phase 2's summary table (`security`, `code-quality`,
`dry`, `architecture`, `bugs-perf`, `stack-specific`, `deps`, `tests`, `ux`,
`structural`, `cognitive-load`), so no two agents write the same file — per
[lib/better-issue-mode.md](./better-issue-mode.md)'s spooling rules, and **returns
only the compact index**:

```
<id> | <SEVERITY-or-UNCERTAIN> | <category> | <file:line> | <one-line title>
```

Preserve `[UNCERTAIN]` as `UNCERTAIN` in the index and in the spooled body; do not assign a confirmed severity just to fit the index.

**Evidence bar:** inspect the relevant caller and at least 30 surrounding lines before flagging. Quote the failing code, explain its actual effect under the project's documented contracts, and name a concrete fix. Check downstream awaits/guards and framework idioms before calling a pattern a bug. Local security/trust conventions override generic checklists. Mark unresolved hypotheses `[UNCERTAIN]`; consolidation must validate or defer them, never silently promote them. Wait for all selected workers before Phase 2 and report failed/uncovered scopes.
