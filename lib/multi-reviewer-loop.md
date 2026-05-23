## Multi-Reviewer Loop

Orchestrate one or more reviewers (`copilot`, `codex`, `gemini`, `claude`) sequentially against the same branch / PR. Each individual reviewer runs its own single-reviewer loop (the Copilot loop or the local-agent loop). This wrapper iterates over the ordered list and decides when to stop.

### Inputs

The calling command must populate these before reaching this loop:

- `{REVIEW_AGENTS}` — ordered list of reviewer slugs, e.g. `[codex, gemini, copilot]`. May contain a single entry. Deduped left-to-right by the parser; the first occurrence wins.
- `{REVIEW_STOP_MODE}` — one of:
  - `all` (default) — run every listed reviewer in order, regardless of what each reports
  - `on-findings` — stop after the first reviewer that fixed at least one finding (i.e. reported a non-empty change set / non-zero comments); the assumption is that subsequent reviewers would mostly duplicate the same surface and the user wants speed
  - `on-clean` — stop after the first reviewer that reports zero findings (clean); the user is treating "any reviewer says clean" as sufficient signal
- `{REVIEWER_APPLIES}` — boolean, forwarded to each reviewer's loop. No effect on the copilot path (already a no-op there).

### Pre-flight

1. **Validate the list is non-empty.** If empty, abort with `--review-with requires at least one agent`.
2. **Validate each slug** is one of `copilot`, `codex`, `gemini`, `claude`. Abort on the first unknown value with `Unknown --review-with value: {value}. Use one of: copilot, codex, gemini, claude.`
3. **Dedupe** preserving first-occurrence order. Print a warning if duplicates were dropped: `Note: deduped --review-with list to {final list}.`
4. **Validate stop-mode flags are not combined.** `--review-stop-on-findings` and `--review-stop-on-clean` are mutually exclusive; if both are present, abort with `--review-stop-on-findings and --review-stop-on-clean cannot be combined`.
5. **Probe binary availability** for each non-copilot agent: `command -v {agent}`. For any agent whose binary is missing:
   - **Default mode**: print a warning (`{agent} CLI not installed — dropping from reviewer list`) and remove it from `REVIEW_AGENTS`. If the resulting list is empty, fall back to `[copilot]` so the PR still gets a review pass.
   - **Interactive mode (`--interactive`)**: ask the user whether to install, skip, or abort. If skip, remove that agent and continue with the remainder.

Print the resolved plan before starting: `Review plan: {REVIEW_AGENTS} (stop-mode: {REVIEW_STOP_MODE})`.

### Per-reviewer dispatch

Iterate `REVIEW_AGENTS` in order. For each `{REVIEW_AGENT}`:

1. **Print a banner**: `--- Review pass {n}/{N}: {REVIEW_AGENT} ---`
2. **Capture baseline**: `PASS_START_SHA=$(git rev-parse HEAD)` so the wrapper can tell whether this reviewer changed anything (independent of the inner loop's own tracking).
3. **Dispatch** to the matching single-reviewer loop:
   - `copilot` → `~/.claude/lib/copilot-review-loop.md`
   - `codex` | `gemini` | `claude` → `~/.claude/lib/local-agent-review-loop.md`

   The inner loop already handles its own iterations, fix-and-push cycles, and verification. It returns a `{STATUS}` value:
   - Copilot loop: `clean | timeout | error | guardrail | too-large`
   - Local-agent loop: `clean | guardrail | cli-error | broken-build | test-failed | rejected`
4. **Record the pass result** (status + number of new commits since `PASS_START_SHA`). Keep a per-pass row for the aggregate report.

### Stop-mode decision

After each pass completes (before moving to the next reviewer), evaluate `{REVIEW_STOP_MODE}`:

| Mode | Continue to next reviewer when... | Stop when... |
|------|------------------------------------|---------------|
| `all` | always (until list exhausted) | list exhausted |
| `on-findings` | this pass made zero changes (`PASS_START_SHA == HEAD`), regardless of status | this pass made any change (commits added since `PASS_START_SHA`) |
| `on-clean` | this pass returned a non-clean status OR made changes | this pass returned `clean` AND made zero changes |

**Hard-error short-circuit (applies in all modes)**: if the inner loop returns `cli-error`, `broken-build`, `test-failed`, or `rejected`, stop the multi-reviewer loop immediately. These statuses mean the branch is in a state subsequent reviewers shouldn't run against (broken build / reverted state / explicit reject). Surface the failing reviewer's status as the wrapper's overall status — do not silently continue.

Inconclusive non-fix statuses (`copilot` `timeout`/`error`/`guardrail` and local-agent `guardrail`) do NOT count as findings — they mean the reviewer couldn't produce a verdict, not that it found something to fix. In `all` and `on-clean` modes, continue to the next reviewer (the next one may still produce a clean pass). In `on-findings` mode, also continue — no findings were surfaced, so the stop condition isn't met. Record the inconclusive status in the per-pass table for reporting.

### Aggregate report

After the wrapper exits, print a summary block per pass:

```
## Multi-Reviewer Summary

Stop mode: {REVIEW_STOP_MODE}
Reviewers planned: {original REVIEW_AGENTS list}
Reviewers run:     {actually executed subset}

| Pass | Agent  | Status        | Commits added | Notes                     |
|------|--------|---------------|---------------|---------------------------|
| 1    | codex  | clean         | 2             | log: /tmp/local-review-…  |
| 2    | gemini | clean         | 0             | log: /tmp/local-review-…  |
| 3    | copilot| too-large     | 0             | PR exceeded 20k-line cap  |

Overall status: {OVERALL_STATUS}
```

`{OVERALL_STATUS}` is computed by evaluating each rule top-down; the first matching rule wins:
- `dirty` — the wrapper stopped due to a hard-error short-circuit (`cli-error`, `broken-build`, `test-failed`, `rejected`); the failing pass's status is the proximate cause
- `inconclusive` — the executed list contains at least one pass whose status is inconclusive (`timeout`, `error`, `guardrail`, `skipped`), regardless of whether other passes returned `clean`. `skipped` covers preconditions-not-met cases — e.g., `codex` in `/do:review` PR mode (codex review --base only accepts a git ref) or `copilot` when no PR exists for the branch. Reached when, e.g., `--review-with copilot,codex` runs copilot which times out and codex which returns clean — the user asked for both perspectives and only got one, so the aggregate is not unconditionally `clean`. Also covers the all-inconclusive case (e.g., `--review-with copilot` that times out and the list exhausts). Distinct from `dirty` (build is fine) but still **not eligible to merge** — the user must re-run or intervene
- `partial` — some passes were skipped due to a stop-mode decision (`on-findings` or `on-clean` short-circuit) AND every executed pass returned `clean` (no inconclusive remaining)
- `clean` — every executed pass returned `clean` (or copilot `too-large`, which is treated as clean for merge purposes per the copilot loop's own rule) AND no hard-error short-circuit fired AND no inconclusive statuses remain AND no stop-mode short-circuit fired

The calling command (do:pr / do:release / do:review) uses `{OVERALL_STATUS}` to decide its own next action. For do:release in particular, the merge gate must require `{OVERALL_STATUS}=clean` — never merge on `dirty` or `inconclusive`, and on `partial` only when the stop-mode was explicitly set (i.e. the user opted into the short-circuit).
