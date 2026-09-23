<!--
  multi-reviewer-parallel.md — the `{REVIEW_MODE}=parallel` branch of
  multi-reviewer-loop.md. Read only when that mode was explicitly resolved
  (flag or saved default); series is the default and never reads this file.
-->

## Multi-Reviewer Loop — parallel mode

This file replaces multi-reviewer-loop.md's Pre-flight step 6, Series dispatch,
and the parallel clause of its Aggregate report for this run. Everything else
in that file (Inputs, the rest of Pre-flight, Stop-mode decision, the
non-parallel aggregate rules) still applies as written.

**What parallel mode is.** Every reviewer's *review-only* finding-collection
runs concurrently against one frozen baseline commit, then the orchestrator
applies the deduped union in a single verified pass. Concurrent reviewers
cannot share one working tree, so parallel **forces review-only posture** —
`{REVIEWER_APPLIES}` is ignored — and, with no first-finisher ordering, the
stop-modes are ignored. Both are warned (not aborted) below.

### Pre-flight: resolve incompatibilities

6. **Resolve incompatibilities when `{REVIEW_MODE}=parallel`** (warn, don't abort — the run proceeds in the safe posture):
   - If `{REVIEWER_APPLIES}=true`: print `--reviewer-applies is ignored in parallel review mode (concurrent reviewers can't share one working tree); reviewers run review-only and the orchestrator applies the deduped findings.` and force `{REVIEWER_APPLIES}=false`.
   - If `{REVIEW_STOP_MODE}` is not `all`: print `--review-stop-on-* is ignored in parallel review mode (all reviewers run at once, so there is no first-finisher to stop on); use series mode to short-circuit.` and treat `{REVIEW_STOP_MODE}` as `all`.
   - If any entry carried a `~max=<n>` suffix: print `~max=<n> is ignored in parallel review mode (each reviewer runs exactly one review-only pass and the orchestrator applies the union once, so there are no per-reviewer review-and-fix cycles to cap); use series mode for per-reviewer iteration budgets.` and ignore every entry's `{MAX_ITERATIONS}`.

### Parallel dispatch (`{REVIEW_MODE}=parallel`)

Run only when `{REVIEW_MODE}=parallel` was explicitly resolved (flag or saved default). Reviews run concurrently against one frozen baseline; the orchestrator then applies the union of findings once.

1. **Freeze the baseline**: `PARALLEL_START_SHA=$(git rev-parse HEAD)`. Every reviewer reviews this exact commit. **Also take the shared runner's Snapshot once, here** ([local-cli-runner.md](./local-cli-runner.md): all five artifacts, which are HEAD, index, tracked diff, untracked files, and git metadata), because the per-reviewer invocation below is Step 2 alone: without this, the tool-free reviewers (`agy`/`grok`/`cursor`/`cmd`) would run in parallel mode with no working-tree enforcement at all, which is the only thing that lets them run review-only.
2. **Launch each reviewer's review concurrently, in review-only posture** (no reviewer applies, commits, or pushes — that would race the shared working tree):
   - `codex` | `agy` | `claude` | `grok` | `pi` | `cursor` | `opencode` | `cmd` → run the local-agent loop's **single review-only invocation** (its `REVIEWER_APPLIES=false` review step that emits `FINDING <N>:` blocks / `NO FINDINGS` to a per-reviewer log), forwarding this entry's resolved `{REVIEW_MODEL}` (or `{REVIEWER_CMD}` for `cmd`) — NOT its full apply loop. Run them as concurrent background jobs.
   - `ollama` → run the Ollama loop's per-file chunked review (already review-only) concurrently, to its own findings log.
   - `copilot` → run the shared GitHub-reviewer template's steps 1–3 plus the Copilot delta in review-only mode, using the caller-selected `{WAIT_SCHEDULE}`; accept only a current-head review and collect its body and threads.
   - `@<login>` → run the shared GitHub-reviewer template's steps 1–3 in review-only mode, using the caller-selected `{WAIT_SCHEDULE}` and `{REVIEWER_LOGIN}`; accept only a current-head review and collect its body and threads.
   Each review writes to its own log. For local-agent entries, retain `EXIT_CODE`, `LOG_FILE`, `ERR_FILE`, and `OPENCODE_ADMISSION_DENIED` **per reviewer**, never in shared mutable state. Reuse [local-agent-review-loop.md](./local-agent-review-loop.md)'s Step-2 OpenCode admission classifier **before generic non-zero classification**: a marked `HTTP 403 / FreeTierError` result is pending `no-verdict`, never `cli-error`. Suppress its raw stdout/stderr and log paths in progress output. Defer final review-phase statuses and verdict parsing until the barrier's restoration check succeeds.
3. **Barrier**: wait for every launched review to finish (each bounded by its own loop's timeout). Wait ACTIVELY, using the runner's bounded blocking-chunk poll on each reviewer's `$DONE_FILE`, and **never end your turn while a review is in flight.** Once all are done, run the runner's Verify and restore (five-artifact comparison and wholesale restore) **once** for the whole fan-out, git metadata first. A mismatch cannot be attributed to one reviewer, so restore the baseline, print `one or more parallel reviewers modified the working tree during a review-only pass — reverted; findings kept`, and continue. If the tree cannot be restored, stop with `{OVERALL_STATUS}=dirty`.
   After successful restoration, consume each reviewer's `OPENCODE_ADMISSION_DENIED=true` result using the local-agent loop's Step-3 sanitized diagnostic, remedy, and suppressed log field; record `no-verdict` for that reviewer without parsing its provider output as findings. **Do not exit the wrapper** when one reviewer is denied admission; continue collecting every other reviewer's result. A required denial remains inconclusive and merge-blocking; an optional denial stays visible and non-blocking. This exception does not excuse another reviewer's `cli-error` or a failed shared restoration. Record each remaining reviewer's review-phase status using its own loop's verdict rules: `clean` (no findings), `findings` (≥1 finding), or an inconclusive status (`timeout`/`error`/`cli-error`/`skipped`/`no-verdict`/`not-requestable`/ollama `incomplete`).
4. **Dedupe the union** of findings across all reviewers — collapse findings that name the same file + line + substantively the same issue into one (keep the clearest description/fix, and note which reviewers raised it).
5. **Apply once, sequentially, in the orchestrator** (the only writer): for each deduped finding, apply the fix, run `{BUILD_CMD}` (skip when empty) + `{TEST_CMD}`, dropping any finding whose fix breaks the build/tests or is wrong on inspection. Before committing, **run the fix regression guard** on the applied diff (`git diff "$PARALLEL_START_SHA..HEAD"`) — scan for unscoped state-clearing/restoring writes and side effects added to hot paths, re-scope any that fail, and add a focused regression test where the fix touches scoping or timestamp/side-effect logic (see `~/.claude/lib/fix-regression-guard.md`); step 7 does no automatic re-review, so a fix's own regression has no second reviewer to catch it. Commit the applied fixes (group sensibly) as `address review (parallel: <agents>): <summary>`, then **push once**. There is no per-reviewer commit attribution — the aggregate report notes the parallel commit instead.
6. **Assert the applied fixes reached the remote** — run **the same block** the series dispatch's step 5 defines (in [multi-reviewer-loop.md](./multi-reviewer-loop.md)), verbatim, with `PARALLEL_START_SHA` substituted for `PASS_START_SHA`, so the config-based target derivation and the push travel together in one shell. Record `push-failed` if the push and its one retry both fail. The union apply is the only writer in the run, so an unpushed union strands **every** reviewer's fixes at once.
7. **Re-review is NOT automatic in parallel mode.** The series loop's per-reviewer re-review recursion does not run here, because no single reviewer owns the apply. If the applied fixes warrant another look, that is a follow-up series run — and apply the convergence gate (`~/.claude/lib/review-convergence-gate.md`) to that decision too: only re-run when the applied fixes were *substantive*. Say so in the report rather than silently re-fanning out.

A hard-error during apply (build/tests cannot be made green, or a finding forces a revert) sets `{OVERALL_STATUS}=dirty` exactly as the series hard-error short-circuit does — and so does a `cli-error` review-phase result from **any** reviewer, optional included, for the same reason series never lets `~opt` excuse a hard error (see the Hard-error short-circuit in [multi-reviewer-loop.md](./multi-reviewer-loop.md)'s Stop-mode decision): a launch failure means the reviewer never actually looked at the diff, which is a build/environment problem the caller must fix, not a missing verdict to shrug off.

### Aggregate report — parallel mode

In **parallel mode** the same rules apply to each reviewer's *review-phase* status (`clean` / `findings` / inconclusive) plus the single apply step, with the same optional exclusion: `dirty` if the apply step couldn't reach a green build/tests (or a finding forced a revert), **or if any reviewer's review-phase status is `cli-error`** — regardless of optionality, matching series; `inconclusive` if any **non-optional** reviewer's review was inconclusive (`timeout`/`error`/`skipped`/`no-verdict`/`not-requestable`/ollama `incomplete`), or when the apply step's push assertion (step 6) recorded `push-failed`, a property of the single union apply that optionality never excuses; otherwise `clean` once every non-optional reviewer was clean or its findings were applied and verified (optional reviewers' other inconclusive reviews are ignored). `partial` never occurs in parallel mode (no stop-mode short-circuit).
