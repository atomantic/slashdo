# Better options

Parse `$ARGUMENTS` before discovery. Record explicit flags separately so saved defaults cannot override them. Reject missing values, unknown reviewer slugs, malformed suffixes, and invalid numeric/mode values before starting work.

| Option | Effect |
|---|---|
| `--interactive` | Enable decision prompts only with a human available; default autonomous. |
| `--scan-only` | Stop after planning; no worktree, code changes, or PRs. With issues enabled, file every surviving finding before exit. |
| `--simplify-only`, `--refactor-only` | Set `SIMPLIFY_ONLY=true` and `STRICT_MODE=true`; use the simplify contract. |
| `--strict`, `--nuclear` | Set `STRICT_MODE=true`; structural blocker findings become CRITICAL. |
| `--no-merge` | Stop publication after PR creation; skip CI/review/merge, then safely finalize and restore the stash. |
| `--issues`, `--no-issues` | Explicitly set `ISSUE_MODE=true` / `false`; choose tracker vs PLAN.md, not whether to remediate. |
| `--issues-label <name>` | Set `PLAN_LABEL`; otherwise saved `issues-label`, then `plan`. |
| `--reviewer-applies` | `REVIEWER_APPLIES=true`; the `codex` pass lets that CLI apply fixes (the only verified write-isolated profile); the loop keeps every other reviewer review-only. |
| Paths / focus areas | Restrict every audit and remediation phase to the requested scope. |

## Saved defaults

Leave omitted configurable values unset until saved defaults have been applied. Explicit flags win, then project-over-global saved values, then built-in defaults:

!read lib/review-config-defaults.md

Under that same precedence this command also reads two non-review keys: `issues` (boolean → `ISSUE_MODE`; a typed `--issues`/`--no-issues` wins in either direction, and a saved `true` routes findings to the tracker without implying `--scan-only`) and `issues-label` (→ `PLAN_LABEL`). It does not consult `merge`/`merge-method`.

## Review options

Only when `$ARGUMENTS` carries a review flag (`--review-with`, `--review-mode`, `--review-stop-on-findings`/`--review-stop-on-clean`, `--review-iterations`) or the saved defaults carry a `review-*` key, read the shared grammar — entry syntax, `~opt`/`~max=`/`~effort=` suffixes, dedupe, and model-bracket forwarding — before validating those values; do not restate it here:

!read lib/review-flags.md

After defaults, unresolved reviewers become `[]`; unresolved simplify/strict/issues flags become false. No built-in reviewer is selected, including Copilot. Empty reviewers leave PRs open. GitLab skips review/auto-merge. The shared review wrapper owns the final aggregate gate; do not reimplement its optional, cap, or stop-mode semantics.
