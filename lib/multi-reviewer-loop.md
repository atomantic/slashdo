## Multi-Reviewer Loop

Orchestrate one or more reviewers (`copilot`, `codex`, `agy`, `claude`, `ollama`, or an arbitrary GitHub login `@<login>`) against the same branch / PR. Each individual reviewer runs its own single-reviewer loop (the Copilot loop, the local-agent loop, the Ollama loop, or the GitHub-reviewer loop). This wrapper iterates over the ordered list and decides when to stop.

**Series (default) vs parallel — `{REVIEW_MODE}`.** By default reviewers run **in series**: one fully completes (review → fix → verify → push) before the next starts, so each later reviewer sees the *committed fixes* from the earlier ones and can catch problems an earlier fix introduced. This is the recommended mode and the reason the reviewer list is **ordered** — put the cheapest/highest-signal reviewer first. The opt-in `parallel` mode runs every reviewer's **review** concurrently against one frozen baseline and then applies the deduped union of findings in a single pass; it is faster in wall-clock but **no reviewer sees another's fixes**, so a regression introduced by one fix won't be caught by a peer in the same run. Do NOT run reviewers concurrently unless `{REVIEW_MODE}=parallel` was explicitly resolved — defaulting to series is a hard requirement, not a performance hint.

### Inputs

The calling command must populate these before reaching this loop:

- `{REVIEW_AGENTS}` — ordered list of reviewer slugs, e.g. `[codex, agy, copilot]`. May contain a single entry. The `gemini` and `antigravity` slugs normalize to `agy`. Deduped left-to-right by the parser (after normalization); the first occurrence wins. An `ollama` entry may carry a bracketed model selector — `ollama[<model>]` (e.g. `ollama[qwen2.5-coder:32b]`) — which the parser strips off into a per-entry `{OLLAMA_MODEL}` and forwards to the Ollama loop; bare `ollama` leaves it empty (auto-select). An `@<login>` entry targets an arbitrary GitHub reviewer (user or App/bot) — the parser strips the leading `@` into a per-entry `{REVIEWER_LOGIN}` (e.g. `@octocat` → `octocat`) and forwards it to the GitHub-reviewer loop. The model selector (for `ollama`) and the login (for `@<login>`) are part of the dedup identity, so `ollama[a]` and `ollama[b]` — and `@octocat` and `@org-review-bot` — are distinct entries, while two bare `ollama`s (or two `@octocat`s, compared lowercased) collapse to one.
- `{REVIEW_STOP_MODE}` — one of:
  - `all` (default) — run every listed reviewer in order, regardless of what each reports
  - `on-findings` — stop after the first reviewer that produced a verdict status (`clean`, or copilot `too-large`) AND added at least one commit since `PASS_START_SHA` (i.e. the orchestrator actually landed a fix). Reviewer-reported "comments" without resulting commits do NOT trigger the stop — the signal is the commit-graph delta, not the count of suggestions. The assumption is that once a verdict pass has landed fixes, subsequent reviewers would mostly duplicate the same surface and the user wants speed
  - `on-clean` — stop after the first reviewer that reports zero findings (clean); the user is treating "any reviewer says clean" as sufficient signal
- `{REVIEWER_APPLIES}` — boolean, forwarded to each reviewer's loop. No effect on the copilot path (already a no-op there).
- `{REVIEW_ITERATIONS}` — non-negative integer (default 1), forwarded to the **copilot** and **`@<login>`** loops. Caps how many review-and-fix cycles each of those loops runs; each loop still exits early when a review returns 0 comments. `0` means "loop until 0 comments" (legacy behavior, bounded by each loop's own 10-iteration safety guardrail). No effect on the local-agent loop (`codex`/`agy`/`claude`) or the Ollama loop, which keep their own fixed iteration caps.
- `{GH_HOST}` — the GitHub API host derived from the repo's `origin` remote (see `~/.claude/lib/gh-host.md`). Forwarded to the GitHub-side inner loops (`copilot`, `@<login>`) so their `gh api` calls target the right host on GitHub Enterprise instead of defaulting to github.com. Empty/absent on GitLab or when unset means "let `gh` use its github.com default."
- `{REVIEW_MODE}` — `series` (default) | `parallel`. Selects the dispatch strategy:
  - `series` (default) — run each reviewer's full single-reviewer loop one at a time, in list order; the next reviewer starts only after the previous one's fixes are committed and pushed, so it reviews against those fixes. Stop-modes and `--reviewer-applies` work as documented. **This is the default; use it unless the caller explicitly resolved `parallel`.**
  - `parallel` — run every reviewer's *review-only* finding-collection concurrently against one frozen baseline commit, then have the orchestrator apply the deduped union of findings in a single verified pass. Faster wall-clock at the cost of cross-reviewer fix visibility (see the opening note). Because concurrent reviewers cannot share one working tree, `parallel` **forces review-only posture** — `{REVIEWER_APPLIES}` is ignored — and there is no first-finisher ordering, so the stop-modes are ignored. Both incompatibilities are warned (not aborted) in pre-flight.

### Pre-flight

1. **Validate the list is non-empty.** If empty, abort with `--review-with requires at least one agent`.
2. **Validate each slug** is one of `copilot`, `codex`, `agy` (aliases `gemini` / `antigravity`), `claude`, `ollama` (optionally `ollama[<model>]`), or an arbitrary GitHub login `@<login>`. Abort on the first unknown value with `Unknown --review-with value: {value}. Use one of: copilot, codex, agy, claude, ollama, @<login>.` Normalize `gemini`/`antigravity` → `agy` before proceeding. For an `ollama[<model>]` entry, record `{OLLAMA_MODEL}` for that entry from the bracket (empty for a bare `ollama` → auto-select) but **keep the bracket suffix attached to the entry as its identity** — do not collapse `ollama[a]` and `ollama[b]` to a bare `ollama` here, or the dedupe in step 3 would drop one of the requested model passes. For an `@<login>` entry, strip the leading `@` into `{REVIEWER_LOGIN}` and validate it against `^[A-Za-z0-9][A-Za-z0-9-]*(\[bot\])?$` (GitHub user charset plus the optional `[bot]` App suffix); reject a malformed login with the same unknown-value abort. Keep the full login as the entry's identity.
3. **Dedupe** preserving first-occurrence order. Compare on the normalized identity: the slug, plus the `[<model>]` selector for `ollama` entries and the `{REVIEWER_LOGIN}` (lowercased — GitHub logins are case-insensitive) for `@<login>` entries (so `gemini` and `agy` are duplicates, two bare `ollama`s are duplicates and `@Octocat`/`@octocat` are duplicates, but `ollama[a]`/`ollama[b]` and `@octocat`/`@org-review-bot` are distinct). Print a warning if duplicates were dropped: `Note: deduped --review-with list to {final list}.`
4. **Validate stop-mode flags are not combined.** `--review-stop-on-findings` and `--review-stop-on-clean` are mutually exclusive; if both are present, abort with `--review-stop-on-findings and --review-stop-on-clean cannot be combined`.
5. **Probe binary availability** for each **local** agent: `command -v {binary}`, where `{binary}` is the agent's executable name (`claude`, `codex`, `agy`, or `ollama` — note the `agy`/`gemini`/`antigravity` slugs all probe the `agy` binary, and every `ollama[...]` entry probes the `ollama` binary). **Skip the probe for the GitHub-side reviewers `copilot` and every `@<login>` entry** — they review cloud-side via authenticated `gh`, not a local binary (the calling command already confirmed `gh` auth). For any local agent whose binary is missing:
   - **Default mode**: print a warning (`{agent} CLI not installed — recording as skipped`) and **keep the agent in `REVIEW_AGENTS`** so it appears in the per-pass table. When the dispatch loop reaches it, the inner loop is short-circuited and the pass is recorded with status `skipped` (preconditions not met — binary missing). This propagates into `{OVERALL_STATUS}=inconclusive` per the aggregate rule, which is the correct merge-gate outcome — the user explicitly asked for that reviewer's perspective and didn't get it. **Do not silently drop**: dropping would let `{OVERALL_STATUS}=clean` even when a requested reviewer never ran, undermining the merge gate. **Do not append `copilot` (or any other reviewer) as a fallback** — the executed list must never contain a reviewer the user didn't ask for. If `--review-with codex` is passed and codex is missing, the pass is recorded `skipped` and the aggregate is `inconclusive`; copilot does not silently run in its place.
   - **Interactive mode (`--interactive`)**: ask the user whether to install, skip (record as `skipped` per the default-mode rule above), or abort. If install succeeds, keep the agent and proceed normally; if skip, leave it in the list to be recorded as `skipped`; if abort, exit the wrapper.
6. **Resolve incompatibilities when `{REVIEW_MODE}=parallel`** (warn, don't abort — the run still proceeds, just in the safe posture):
   - If `{REVIEWER_APPLIES}=true`: print `--reviewer-applies is ignored in parallel review mode (concurrent reviewers can't share one working tree); reviewers run review-only and the orchestrator applies the deduped findings.` and force `{REVIEWER_APPLIES}=false`.
   - If `{REVIEW_STOP_MODE}` is not `all`: print `--review-stop-on-* is ignored in parallel review mode (all reviewers run at once, so there is no first-finisher to stop on); use series mode to short-circuit.` and treat `{REVIEW_STOP_MODE}` as `all`.

Print the resolved plan before starting: `Review plan: {REVIEW_AGENTS} (mode: {REVIEW_MODE}, stop-mode: {REVIEW_STOP_MODE})`.

### Series dispatch (default — `{REVIEW_MODE}=series`)

This is the default path. Iterate `REVIEW_AGENTS` in order, running each reviewer's full single-reviewer loop to completion (review → fix → verify → push) before starting the next, so a later reviewer reviews against the prior reviewers' committed fixes. For each `{REVIEW_AGENT}`:

1. **Print a banner**: `--- Review pass {n}/{N}: {REVIEW_AGENT} ---`
2. **Capture baseline**: `PASS_START_SHA=$(git rev-parse HEAD)` so the wrapper can tell whether this reviewer changed anything (independent of the inner loop's own tracking).
3. **Dispatch** to the matching single-reviewer loop. The loop file lives under the host CLI's lib directory (`~/.claude/lib/` for Claude, `~/.config/opencode/lib/` for OpenCode — slashdo's installer rewrites command-spec `!cat` references for each env, so use the same lib basename in whichever env this wrapper executes. For Antigravity and Codex there is no separate lib path: slashdo inlines the loop bodies directly into the installed skill, so the dispatch targets below are already present in-context rather than at a file path):
   - `copilot` → `{LIB_DIR}/copilot-review-loop.md` (forward `{GH_HOST}` and `{REVIEW_ITERATIONS}` as its iteration cap)
   - `@<login>` → `{LIB_DIR}/github-reviewer-loop.md` (forward `{GH_HOST}`, this entry's `{REVIEWER_LOGIN}`, and `{REVIEW_ITERATIONS}` as its iteration cap)
   - `codex` | `agy` | `claude` → `{LIB_DIR}/local-agent-review-loop.md` (`{REVIEW_ITERATIONS}` does not apply — the local-agent loop uses its own fixed cap)
   - `ollama` → `{LIB_DIR}/ollama-review-loop.md` (forward this entry's `{OLLAMA_MODEL}` — empty means auto-select; `{REVIEW_ITERATIONS}` and `{REVIEWER_APPLIES}` do not apply — the Ollama loop uses its own fixed cap and is always review-only)

   The inner loop already handles its own iterations, fix-and-push cycles, and verification. It returns a `{STATUS}` value:
   - Copilot loop: `clean | capped | timeout | error | guardrail | too-large`
   - GitHub-reviewer loop (`@<login>`): `clean | capped | timeout | not-requestable | error | guardrail` (`timeout` = requested but no review submitted within the wait; `not-requestable` = the request failed and no review appeared — both inconclusive, not eligible to merge)
   - Local-agent loop: `clean | guardrail | cli-error | broken-build | test-failed | rejected`
   - Ollama loop: `clean | incomplete | guardrail | cli-error | broken-build | test-failed | rejected | skipped` (`incomplete` = the diff was only partially reviewed — some files' review invocations failed, or their diff exceeded the per-file budget and was truncated — treated as inconclusive, not eligible to merge)
4. **Record the pass result** (status + number of new commits since `PASS_START_SHA`). Keep a per-pass row for the aggregate report.

### Stop-mode decision

After each pass completes (before moving to the next reviewer), evaluate `{REVIEW_STOP_MODE}`:

| Mode | Continue to next reviewer when... | Stop when... |
|------|------------------------------------|---------------|
| `all` | always (until list exhausted) | list exhausted |
| `on-findings` | this pass is inconclusive (status ∈ `timeout`/`error`/`guardrail`/`skipped`/`not-requestable`), regardless of whether commits were added; OR this pass returned a verdict status (`clean` for any loop, `capped` for copilot/`@<login>`, or `too-large` for copilot) AND made zero changes (`PASS_START_SHA == HEAD`) | this pass returned a verdict status AND made any change (commits added since `PASS_START_SHA`) |
| `on-clean` | this pass returned a non-clean status (including inconclusive, and including copilot/`@<login>` `capped` — which means fixes were applied without a confirming zero-comment review) OR made changes | this pass returned `clean` (or copilot `too-large`) AND made zero changes |

**Hard-error short-circuit (applies in all modes)**: if the inner loop returns `cli-error`, `broken-build`, `test-failed`, or `rejected`, stop the multi-reviewer loop immediately. These statuses mean the branch is in a state subsequent reviewers shouldn't run against (broken build / reverted state / explicit reject). Surface the failing reviewer's status as the wrapper's overall status — do not silently continue.

Inconclusive non-fix statuses (`copilot` `timeout`/`error`/`guardrail`, the GitHub-reviewer (`@<login>`) `timeout`/`not-requestable`/`error`/`guardrail`, local-agent `guardrail`, ollama `incomplete`, plus the `skipped` precondition statuses) do NOT count as findings — they mean the reviewer couldn't produce a verdict, not that it found something to fix. Treat them as continue-signals in every stop mode, even if the inner loop somehow added commits before bailing out: a stop-mode short-circuit must require a *verdict* status (`clean`, `too-large`, `capped`) before honoring the commits-added / no-commits-added condition. This matches the table above and prevents a flaky reviewer that crashed mid-fix from claiming the stop-mode's "found something" signal.

### Parallel dispatch (`{REVIEW_MODE}=parallel`)

Run only when `{REVIEW_MODE}=parallel` was explicitly resolved (flag or saved default). Reviewers' **reviews** run concurrently against one frozen baseline; the orchestrator then applies the union of their findings once. This trades cross-reviewer fix visibility for wall-clock — see the opening note.

1. **Freeze the baseline**: `PARALLEL_START_SHA=$(git rev-parse HEAD)`. Every reviewer reviews this exact commit.
2. **Launch each reviewer's review concurrently, in review-only posture** (no reviewer applies, commits, or pushes — that would race the shared working tree):
   - `codex` | `agy` | `claude` → run the local-agent loop's **single review-only invocation** (its `REVIEWER_APPLIES=false` review step that emits `FINDING <N>:` blocks / `NO FINDINGS` to a per-reviewer log) — NOT its full apply loop. Run them as concurrent background jobs.
   - `ollama` → run the Ollama loop's per-file chunked review (already review-only) concurrently, to its own findings log.
   - `copilot` → request the cloud review (read-only by nature) and collect its comments; it never touches the working tree, so it parallelizes for free.
   - `@<login>` → request the review from `{REVIEWER_LOGIN}` and collect its comments; like copilot it is read-only cloud-side and parallelizes for free. A `timeout`/`not-requestable` here is an inconclusive review-phase status.
   Each reviewer's review is independent and writes to its own log. Record each reviewer's review-phase status: `clean` (no findings), `findings` (produced ≥1 finding), or an inconclusive status (`timeout`/`error`/`cli-error`/`skipped`/`not-requestable`/ollama `incomplete`).
3. **Barrier**: wait for every launched review to finish (each is bounded by its own loop's timeout). Wait ACTIVELY, with the local-agent loop's bounded blocking-chunk idiom (repeated ~9-minute foreground `for … sleep 10` calls checking each reviewer's `$DONE_FILE`) — **never end your turn expecting the host to notify you when a background review exits.** That notification only exists for top-level sessions; when this loop runs inside a subagent (a `/do:next --swarm` worker, a CoS/background agent), ending the turn terminates the run and the reviews' findings are lost.
4. **Dedupe the union** of findings across all reviewers — collapse findings that name the same file + line + substantively the same issue into one (keep the clearest description/fix, and note which reviewers raised it).
5. **Apply once, sequentially, in the orchestrator** (the only writer): for each deduped finding, apply the fix, run `{BUILD_CMD}` (skip when empty) + `{TEST_CMD}`, dropping any finding whose fix breaks the build/tests or that is wrong on inspection. Before committing, **run the fix regression guard** on the applied diff (`git diff "$PARALLEL_START_SHA..HEAD"`) — scan for unscoped state-clearing/restoring writes and side effects added to hot paths, re-scope any that fail, and add a focused regression test where the fix touches scoping or timestamp/side-effect logic (see `~/.claude/lib/fix-regression-guard.md`). The guard matters **most** here: step 6 below does no automatic re-review, so a fix's own regression has no second reviewer to catch it. Commit the applied fixes (group sensibly) as `address review (parallel: <agents>): <summary>`, then **push once**. Because fixes are applied after collection, there is no per-reviewer commit attribution as in series — the aggregate report notes the parallel commit instead.
6. **Re-review is NOT automatic in parallel mode.** The series loop's per-reviewer 3-iteration recursion (re-review the new commits) does not run here, because no single reviewer owns the apply. If the applied fixes warrant another look, that is a follow-up series run — say so in the report rather than silently re-fanning out.

A hard-error during apply (build/tests cannot be made green, or a finding forces a revert) sets `{OVERALL_STATUS}=dirty` exactly as the series hard-error short-circuit does.

### Aggregate report

After the wrapper exits, print a summary block per pass:

```
## Multi-Reviewer Summary

Review mode: {REVIEW_MODE}
Stop mode: {REVIEW_STOP_MODE}
Reviewers planned: {original REVIEW_AGENTS list}
Reviewers run:     {actually executed subset}

| Pass | Agent  | Status        | Commits added | Notes                     |
|------|--------|---------------|---------------|---------------------------|
| 1    | codex  | clean         | 2             | log: /tmp/local-review-…  |
| 2    | agy    | clean         | 0             | log: /tmp/local-review-…  |
| 3    | copilot| too-large     | 0             | PR exceeded 20k-line cap  |

Overall status: {OVERALL_STATUS}
```

`{OVERALL_STATUS}` is computed by evaluating each rule top-down; the first matching rule wins:
- `dirty` — the wrapper stopped due to a hard-error short-circuit (`cli-error`, `broken-build`, `test-failed`, `rejected`); the failing pass's status is the proximate cause
- `inconclusive` — the executed list contains at least one pass whose status is inconclusive (`timeout`, `error`, `guardrail`, `skipped`, `not-requestable` — an `@<login>` whose request failed and never reviewed — or ollama `incomplete` — a partially-reviewed diff), regardless of whether other passes returned `clean`. `skipped` covers preconditions-not-met cases — e.g., `codex` in `/do:review` PR mode (codex review --base only accepts a git ref) or `copilot` when no PR exists for the branch. Reached when, e.g., `--review-with copilot,codex` runs copilot which times out and codex which returns clean — the user asked for both perspectives and only got one, so the aggregate is not unconditionally `clean`. Also covers the all-inconclusive case (e.g., `--review-with copilot` that times out and the list exhausts). Distinct from `dirty` (build is fine) but still **not eligible to merge** — the user must re-run or intervene
- `partial` — some passes were skipped due to a stop-mode decision (`on-findings` or `on-clean` short-circuit) AND every executed pass returned `clean` (no inconclusive remaining)
- `clean` — every executed pass returned `clean` (or copilot `too-large`/`capped`, or `@<login>` `capped` — all treated as clean for merge purposes per each loop's own rule — `capped` means the configured `{REVIEW_ITERATIONS}` cap, default 1, was reached after applying every fix the review surfaced) AND no hard-error short-circuit fired AND no inconclusive statuses remain AND no stop-mode short-circuit fired

In **parallel mode** the same rules apply to each reviewer's *review-phase* status (`clean` / `findings` / inconclusive) plus the single apply step: `dirty` if the apply step couldn't reach a green build/tests (or a finding forced a revert); `inconclusive` if any reviewer's review was inconclusive (`timeout`/`error`/`skipped`/`not-requestable`/ollama `incomplete`); otherwise `clean` once every reviewer was clean or its findings were applied and verified. `partial` never occurs in parallel mode (there is no stop-mode short-circuit).

The calling command (do:pr / do:release / do:review) uses `{OVERALL_STATUS}` to decide its own next action. For do:release in particular, the merge gate must require `{OVERALL_STATUS}=clean` — never merge on `dirty` or `inconclusive`, and on `partial` only when the stop-mode was explicitly set (i.e. the user opted into the short-circuit).
