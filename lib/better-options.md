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

`--review-with <entry[,entry...]>` sets ordered `REVIEW_AGENTS`. `none` (case-insensitive, alone) sets an empty list and overrides saved defaults. Otherwise split on commas, trim, and parse:

```
entry := (agent[model]? | @login) (~opt | ~max=n | ~effort=level)*
```

Supported agents: `codex`, `agy`, `claude`, `grok`, `cursor`, `ollama`, `copilot`, and `@<login>`. Normalize `gemini`/`antigravity` to `agy`, `cursor-agent` to `cursor`. The first six accept `[<model>]`; `copilot` and `@login` do not (`[bot]` may be part of a GitHub login). Bare Ollama auto-selects an installed coding model; local CLIs use their own model default when no explicit or saved model exists.

Strip suffixes from the right in any order before parsing the slug. Each suffix may occur at most once:

- `~opt`: still run and fix findings; inconclusive/timeout/skipped/no-verdict does not block merge. Hard errors, failing verification, explicit rejection, and unpushed fixes always block.
- `~max=<n>`: non-negative per-reviewer cycle cap; overrides `--review-iterations` for that entry. An explicit positive cap reached after applying/verifying fixes returns clean-equivalent `capped`; zero runs until clean within the inner loop's 10-cycle guardrail. Exhausting an implicit cap remains inconclusive.
- `~effort=<level>`: `low`, `medium`, `high`, `xhigh`, or `max`.

Dedupe normalized slug + model (or case-insensitive login), preserving first order. Suffixes are excluded from identity: optional wins if any duplicate is optional; cap/effort come from the first duplicate carrying each value. Forward model as `REVIEW_MODEL` or `OLLAMA_MODEL`, plus per-entry optional/cap/effort fields. Saved `REVIEW_MODELS` fills only missing model brackets.

| Option | State / validation |
|---|---|
| `--review-mode <series\|parallel>` | `REVIEW_MODE`; default series. Parallel reviews one baseline, then applies a deduped union; it ignores reviewer-applies and stop modes. |
| `--review-stop-on-findings`, `--review-stop-on-clean` | `REVIEW_STOP_MODE=on-findings` / `on-clean`; mutually exclusive; default `all`. |
| `--reviewer-applies` | `REVIEWER_APPLIES=true`; local reviewer applies fixes; cloud reviewers stay read-only. |
| `--review-iterations <n>` | Non-negative `REVIEW_ITERATIONS`, default 1; controls copilot / @login passes only unless an entry has `~max`. Zero uses the inner 10-cycle guardrail. |

Leave omitted configurable values unset until saved defaults have been applied, including reviewer list, mode, stop mode, reviewer-applies, iterations, issues, and label. Explicit flags win, then project-over-global saved values, then built-in defaults. Read the shared defaults contract now:

!read lib/review-config-defaults.md

After defaults, unresolved reviewers become `[]`; unresolved simplify/strict/issues flags become false. No built-in reviewer is selected, including Copilot. Empty reviewers leave PRs open. GitLab skips review/auto-merge. The shared review wrapper owns the final aggregate gate; do not reimplement its optional, cap, or stop-mode semantics.
