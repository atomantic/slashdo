## Phase 1: Unified Audit

Project conventions are already in your context. Pass relevant conventions to each agent.

Choose audit scopes from the user's path/focus filter and the detected project, not a fixed worker quota. Cover every applicable requested scope; do not infer an arbitrary subset to save tokens. Record why a scope is inapplicable. Combine small/overlapping scopes in one worker and cap concurrent workers at the host's available slots. A combined worker preserves each finding's category and writes each assigned category to its own spool file; each category belongs to only one worker. Without delegation, run the same scopes serially.

For a normal audit, cover security, code quality, DRY, architecture, bugs/performance, stack-specific behavior, dependencies when third-party packages exist, and tests. Add UX only with `HAS_UI=true` and structural ambition only with `STRICT_MODE=true`. Run the test audit after the other selected scopes so it receives their compact finding index, not their full reports. Other scopes are independent.

When `SIMPLIFY_ONLY=true`, select only code-quality, dry, architecture, structural, and cognitive-load in one batch, subject to the path/focus filter. Pass simplify gates 1, 2, and 4 plus `PRIOR_REJECTIONS` and the distilled `DOMAIN_DOCS` glossary. Only cognitive-load gets `HOT_FILES` as a search priority; agents never apply churn severity adjustment.

**Worker context:** give each worker its assigned paths, scope/lens below, relevant repository conventions, project/build/test facts, evidence format, and applicable mode/spool contract. Do not pass the complete command, other lenses, whole ADRs, future phases, or reviewer libraries. Resolve `AUDIT_MODEL_TIER` against the host per the model-tier guidance. Ask for confirmed findings and explicit coverage gaps, not a target finding count.

Only the worker assigned a scope reads its corresponding lens below. These are conditional requirements, not instructions to read the whole list:

For `security`:
!read lib/better-audit-security.md

For `code-quality`:
!read lib/better-audit-code-quality.md

For `dry`:
!read lib/better-audit-dry.md

For `architecture`:
!read lib/better-audit-architecture.md

For `bugs-perf`:
!read lib/better-audit-bugs-perf.md

For `stack-specific`:
!read lib/better-audit-stack-specific.md

For `deps`:
!read lib/better-audit-deps.md

For `tests`:
!read lib/better-audit-tests.md

For `ux`:
!read lib/better-audit-ux.md

For `structural`:
!read lib/better-audit-structural.md

For `cognitive-load`:
!read lib/better-audit-cognitive-load.md

Each agent must report findings in this format:
```
- **[CRITICAL/HIGH/MEDIUM/LOW]** `file:line` - Description. Suggested fix: ... Complexity: Simple/Medium/Complex
```

**Issue mode (`--issues`) changes where this format goes, not what it contains.**
Only when `ISSUE_MODE=true`, read the issue/spool contract before dispatching any agent:

!read lib/plan-issue-mode.md

Then create the spool directory:

```bash
SPOOL_DIR="$(mktemp -d "${TMPDIR:-/tmp}/slashdo-issues-XXXXXX")"; echo "$SPOOL_DIR"
```

Record the printed path as `SPOOL_DIR` in run state and pass **that literal path**
to every agent — a shell variable does not survive between tool calls, so
re-deriving it later would hand the filer agents an empty directory.

Pass `SPOOL_DIR` to every audit agent along with the **"Bulk filing — spool the
bodies, dedup on an index"** contract from
[lib/plan-issue-mode.md](./plan-issue-mode.md) (the partial Phase 2 reads
in). Under that contract each agent writes one ready-to-file issue body per finding
to `$SPOOL_DIR/<category-slug>.md` — using its own category slug from Phase 2's
summary table (`security`, `code-quality`, `dry`, `architecture`, `bugs-perf`,
`stack-specific`, `deps`, `tests`, `ux`, `structural`, `cognitive-load`), so no two
agents write the same file — and **returns only the compact index**:

```
<id> | <SEVERITY-or-UNCERTAIN> | <category> | <file:line> | <one-line title>
```

Preserve `[UNCERTAIN]` as `UNCERTAIN` in the index and in the spooled body; do not assign a confirmed severity just to fit the index. Phase 2 reads only those bodies and their cited source for targeted validation.

Audit agents are `Explore` agents, which have no `Write` tool — they write their
spool file with a quoted-heredoc `cat > "$SPOOL_DIR/<slug>.md" <<'EOF'` via Bash,
so backticks and `$` in quoted evidence survive verbatim. **Only the first write
uses `>`; every later one must use `>>`** — an agent that spools findings across more
than one Bash call and reaches for `cat >` a second time truncates everything it has
already written, which is the tail-dropping this whole path exists to prevent.

A large audit surfaces hundreds of findings, and the alternative pulls every body
through this orchestrator's context twice — once reading the agent's report, once
re-emitting it into a `gh issue create` body. That second pass is where bodies get
truncated and tail findings get dropped. Everything Phase 2 actually decides —
cross-agent dedup, dedup against `EXISTING_ISSUES`, [gate 3](./better-simplify.md)'s churn
adjustment, and the `FILE_OWNER_MAP` — keys off the index fields alone, so the
bodies stay on disk until the filer agents move them to the tracker.

**Evidence bar:** inspect the relevant caller and at least 30 surrounding lines before flagging. Quote the failing code, explain its actual effect under the project's documented contracts, and name a concrete fix. Check downstream awaits/guards and framework idioms before calling a pattern a bug. Local security/trust conventions override generic checklists. Mark unresolved hypotheses `[UNCERTAIN]`; consolidation must validate or defer them, never silently promote them. Wait for all selected workers before Phase 2 and report failed/uncovered scopes.
