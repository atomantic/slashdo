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
| Paths / focus areas | Restrict every audit and remediation phase to the requested scope. |

## Review options

The `--review-with`, `--review-mode`, `--review-stop-on-findings`/`--review-stop-on-clean`, and `--review-iterations` grammar — including entry syntax, per-reviewer `~opt`/`~max=`/`~effort=` suffixes, dedupe rules, and model-bracket forwarding — is owned by the shared partial below; do not restate it here:

!read lib/review-flags.md

| Option | State / validation |
|---|---|
| `--reviewer-applies` | `REVIEWER_APPLIES=true`; the `codex` pass lets that CLI apply fixes — it is the only reviewer with a verified write-isolated profile. Every other local reviewer (`claude`/`agy`/`grok`/`pi`/`cursor`/`opencode`/`cmd`) is forced back to review-only by the loop, and cloud reviewers stay read-only. |

Leave omitted configurable values unset until saved defaults have been applied, including reviewer list, mode, stop mode, reviewer-applies, iterations, issues, and label. Explicit flags win, then project-over-global saved values, then built-in defaults. Read the shared defaults contract now:

!read lib/review-config-defaults.md

!read lib/config-defaults-issues-merge.md

After defaults, unresolved reviewers become `[]`; unresolved simplify/strict/issues flags become false. No built-in reviewer is selected, including Copilot. Empty reviewers leave PRs open. GitLab skips review/auto-merge. The shared review wrapper owns the final aggregate gate; do not reimplement its optional, cap, or stop-mode semantics.
