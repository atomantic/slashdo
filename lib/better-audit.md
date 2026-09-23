## Phase 1: Unified Audit

Choose scopes from the path/focus filter and the detected project, not a worker quota. Cover every applicable requested scope; do not infer an arbitrary subset to save tokens, and record why a scope is inapplicable. Combine small/overlapping scopes per worker (findings keep their category; each category has one worker), cap concurrency at the host's slots, and run serially without delegation.

A normal audit covers every scope in the table below except the three mode-gated rows (`deps` only when third-party packages exist). A caller-specific scope roster, when supplied, is authoritative; do not add generic scopes it intentionally omits. Run `tests` after the other selected scopes so it receives their compact finding index, not their full reports. Under `SIMPLIFY_ONLY=true` the roster and gates come from the simplify contract instead.

**Worker context:** its assigned paths, its row below (scope and ownership, not a bug checklist), relevant repository conventions (which supersede the table), project/build/test facts, the evidence format, and the spool contract, at `AUDIT_MODEL_TIER`. Do not pass the complete command, other rows, whole ADRs, future phases, or reviewer libraries. Ask for confirmed findings and explicit coverage gaps, not a target finding count.

| Scope | Remit | Ownership boundary |
|-------|-------|---------------------|
| `security` | Auth, secrets, injection, unsafe input handling, supply-chain risk | Known CVEs in a dependency are reported here; whether to remove that dependency is `deps`' call |
| `code-quality` | Brittleness, dead/unreachable code, unused imports, logging & observability | Language/framework-idiom violations belong to `stack-specific` |
| `dry` | Duplication, speculative abstraction, YAGNI | — |
| `architecture` | Coupling, modularity, dependency inversion, API contract consistency (not when `SIMPLIFY_ONLY=true` — that's behavior, not structure) | Reader-cost of an individual function belongs to `cognitive-load` |
| `bugs-perf` | Runtime correctness, resource/perf, resilience, and observability of failure paths | — |
| `stack-specific` | Detected-language/framework idioms and gotchas; general accessibility (alt text, ARIA, contrast) | Accessibility that is also a layout failure belongs to `ux` |
| `deps` | Third-party dependency necessity and removability | — |
| `tests` | Coverage gaps and vacuous/weak test quality | Runs last; receives the compact finding index only |
| `ux` (`HAS_UI=true` only) | Layout, responsive behavior, visual consistency | Accessibility only when it is also a layout failure |
| `structural` (`STRICT_MODE=true` only) | Code-judo reframings, boundary leaks, canonical-helper duplication, growth past the size a single file should carry | Only this worker gets the structural lens |
| `cognitive-load` (`SIMPLIFY_ONLY=true` only) | How much a reader must hold in their head to change one line safely | Size/shape thresholds (god files, long functions, nesting, parameter count) belong to `architecture` |

Only when `STRICT_MODE=true`, the `structural` worker (and no other) reads the structural lens:
!read lib/review-structural-ambition.md

Per-scope output rules:
- **`deps` severity:** unmaintained with CVEs → CRITICAL, unmaintained without CVEs → HIGH, replaceable single-function usage → MEDIUM, suspect but complex replacement → LOW. Format: `**[SEVERITY]** {package} — {tier}. Uses: {functions}. Call sites: {N} in {M} files. Replacement: {complexity}. Reason: {why removable}`.
- **`tests` tags:** prefix the severity with `[VACUOUS]` (asserts nothing that could fail), `[WEAK]` (verifies implementation details or passes on a no-op result), or `[MISSING]` (no coverage) — e.g. `**[HIGH][VACUOUS]**`.
- **`ux`:** bump severity one tier when a finding affects initial-viewport content at common viewports.
- **`structural`:** file pushed past 1000 lines, spaghetti growth, thin wrappers, boundary leaks, and canonical-helper duplication are always `[CRITICAL]`.

Finding format — each worker spools it per [lib/better-issue-mode.md](./better-issue-mode.md) and returns only the index:
```
- **[CRITICAL/HIGH/MEDIUM/LOW]** `file:line` - Description. Suggested fix: ... Complexity: Simple/Medium/Complex
```

**Evidence bar:** inspect the relevant caller and at least 30 surrounding lines before flagging. Quote the failing code, explain its actual effect under the project's documented contracts, and name a concrete transformation or fix — never a bare "could be cleaner." Local security/trust conventions override generic checklists. Mark unresolved hypotheses `[UNCERTAIN]`; consolidation must validate or defer them, never silently promote them. Wait for all selected workers before Phase 2 and report failed/uncovered scopes.
