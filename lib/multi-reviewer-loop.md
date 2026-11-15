## Multi-Reviewer Loop

Orchestrate one or more reviewers against the same branch / PR: a local agent CLI (`codex`, `agy`, `claude`, `grok`, `pi`, `cursor`, `opencode`, `cmd[<invocation>]`), a local `ollama` model, or a host-side reviewer (`copilot`, or a handle `@<login>` on the project's code host). Each reviewer runs its own single-reviewer loop. This wrapper iterates the ordered list, decides when to stop, and computes the overall status.

**Series (default) vs parallel — `{REVIEW_MODE}`.** In series each reviewer completes (review → fix → verify → push) before the next starts, so later reviewers see earlier reviewers' committed fixes and can catch a regression a fix introduced. That is why the list is ordered: put the cheapest, highest-signal reviewer first. The opt-in `parallel` mode runs every reviewer's review concurrently against one frozen baseline, then applies the deduped union of findings once: faster, but no reviewer sees another's fixes. Run reviewers concurrently only when `{REVIEW_MODE}=parallel` was explicitly resolved.

### Inputs

The calling command populates these before reaching this loop:

- `{REVIEW_AGENTS}` — the ordered, deduped entry list, parsed and validated by `lib/review-flags.md` (the one definition of the `--review-with` grammar, aliases, suffixes, dedup identity, and abort messages). Each entry arrives with its base slug and, where they apply, `{REVIEW_MODEL}` / `{OLLAMA_MODEL}` (from a `[<model>]` bracket), `{REVIEWER_CMD}` (a `cmd` entry's verbatim invocation), `{REVIEWER_LOGIN}` (an `@<login>` entry), `{OPTIONAL}` (`~opt`), `{ENTRY_MAX}` (`~max=<n>`), and `{ENTRY_EFFORT}` (`~effort=<level>`). A caller that reaches this loop with a raw `--review-with` value reads `lib/review-flags.md` and parses it first. A `cmd` entry is always review-only and is rendered everywhere by its `cmd:<first token>` label, never the raw invocation; [local-agent-cmd.md](./local-agent-cmd.md) owns that label and the trust boundary.
- `{REVIEW_MODELS}` — optional per-agent default-model map from saved config (the `review-models` key, see `~/.claude/lib/review-config-defaults.md`). Keys are agent slugs; values are model strings. It supplies a model only for an entry whose token carried no bracket.
- `{REVIEW_STOP_MODE}` — `all` (default), `on-findings`, or `on-clean`; see Stop-mode decision.
- `{REVIEWER_APPLIES}` — boolean, forwarded to each reviewer's loop. It only reaches `codex`.
- `{REVIEW_ITERATIONS}` — non-negative integer (default 1): the review-and-fix cycle cap for the host-side `copilot` and `@<login>` loops. It never reaches a local-agent or Ollama entry.
- `{CODE_HOST}` — `github` or `gitlab`, resolved by `~/.claude/lib/vcs-host.md`; `github` when the caller has not resolved it. It selects the verb file the host-side loops run. `{CR_NOUN}` is `PR` on GitHub and `MR` on GitLab (`PR` when unset).
- `{GH_HOST}` — the GitHub API host derived from the repo's `origin` remote (see `~/.claude/lib/gh-host.md`), forwarded to the host-side loops so their `gh api` calls reach the right host on GitHub Enterprise. Empty on GitLab, or when unset, means `gh`'s github.com default.
- `{WAIT_SCHEDULE}` — the wait schedule for the current host-side entry. A caller may state its own; otherwise use Wait schedules below. Resolve it per entry before dispatch and pass only that one schedule to the host-reviewer template.
- `{REVIEW_MODE}` — `series` (default) or `parallel`. Only when `parallel` was explicitly resolved (flag or saved default), read the parallel-mode file now; it replaces Pre-flight step 6, Series dispatch, and the aggregate rule below for this run. Series callers never need it.

  !read lib/multi-reviewer-parallel.md

### Statuses

Every inner loop returns one status per pass, and this table is the single definition of what each means for the stop-mode and the merge gate. Other files name a status and its class; they do not redefine them.

| Class | Statuses | Effect |
|-------|----------|--------|
| **Verdict** (clean-equivalent) | `clean`; `capped`; copilot `too-large` | The reviewer finished. Eligible to merge. |
| **Inconclusive** | `guardrail`, `timeout`, `error`, `not-requestable`, `no-verdict`, `incomplete`, `skipped`, `push-failed` | No verdict on the pushed tree. Not eligible to merge, but the branch is intact, so later reviewers still run. `~opt` excuses every one of these except `push-failed`. |
| **Hard error** | `cli-error`, `broken-build`, `test-failed`, `rejected` | The branch is in a state later reviewers should not run against. Stops the loop; the aggregate is `dirty`. `~opt` never excuses it. |

What the less obvious ones mean:

- `capped` and `guardrail` are the two ways an iteration ceiling ends a loop that was still landing substantive findings. `capped` is a ceiling the user set (`{MAX_EXPLICIT}` true: a `~max=<n>` with n ≥ 1, or `--review-iterations` on a host-side pass): they asked for `n` rounds and got them, with every surfaced fix applied. `guardrail` is a built-in ceiling: the local-agent / Ollama default of 3, or the 10-round backstop that bounds unlimited mode (`0`).
- `too-large` — the PR exceeded Copilot's line limit; there is nothing more that reviewer can do.
- `timeout` — a host review was requested and none arrived within the wait. `not-requestable` — an `@<login>` request failed and no review appeared. `error` — a host API failure, or Copilot's own error review after its retries.
- `no-verdict` — a local agent ran but its output was not a parseable verdict, or its input could not be delivered, or OpenCode was denied provider admission. It is deliberately not a hard error: one chatty CLI should not skip every remaining reviewer.
- `incomplete` — Ollama reviewed only part of the diff (failed or truncated files).
- `skipped` — the reviewer never launched: a missing binary, an unmet precondition (no PR for a host-side reviewer, `copilot` on GitLab), or a `cmd` command-not-found.
- `push-failed` — assigned by this wrapper (Series dispatch step 5) when a pass's fix commits could not reach the remote. The reviewed tree is then not the tree a merge would land, which is why `~opt` does not excuse it.

Inner loops return: Copilot `clean | capped | timeout | error | guardrail | too-large`; `@<login>` `clean | capped | timeout | not-requestable | error | guardrail`; local-agent `clean | capped | no-verdict | guardrail | cli-error | broken-build | test-failed | rejected | skipped`; Ollama `clean | capped | incomplete | guardrail | cli-error | broken-build | test-failed | rejected | skipped`.

### Pre-flight

1. **Take the parsed list.** If it is empty, abort with `--review-with requires at least one agent`.
2. **Re-check each `@<login>` against the resolved host.** `lib/review-flags.md` accepted a login valid on either host because the host may not have been known then. Now validate `{REVIEWER_LOGIN}` against `{CODE_HOST}`'s grammar: on `github`, `^[A-Za-z0-9][A-Za-z0-9-]*(\[bot\])?$`; on `gitlab`, `^[A-Za-z0-9_]([A-Za-z0-9_.-]*[A-Za-z0-9_-])?$` (no `[bot]` suffix). The verb files `host-github.md` and `host-gitlab.md` carry the full rules. Reject a mismatch with the unknown-value abort from `lib/review-flags.md`.
3. **Resolve each entry's effective model**, for every model-taking entry: its `[<model>]` bracket wins; else `{REVIEW_MODELS}[slug]` if present; else empty. Empty means the reviewer's own default — the CLI's default model for `codex`/`claude`/`grok`/`pi`/`cursor`, `agy`'s roster default (resolved in its recipe, overridable via `AGY_REVIEW_MODEL`), auto-selection for `ollama`, and no slashdo override for `opencode`, which then needs an explicitly selected or configured provider/model. Store it as the entry's `{REVIEW_MODEL}` (`{OLLAMA_MODEL}` for `ollama`); no inner loop re-implements this precedence. `cmd` has no model to resolve.
4. **Resolve each entry's effective iteration cap.** Precedence, top wins:
   1. the entry's `{ENTRY_MAX}`, when it carried a `~max=<n>`;
   2. `{REVIEW_ITERATIONS}`, only for `copilot` and `@<login>` (so `--review-iterations 5 --review-with ollama` leaves ollama on its built-in cap);
   3. the inner loop's built-in default: `1` for `copilot`/`@<login>`, `3` for the local-agent and Ollama loops.

   Store the result as the entry's `{MAX_ITERATIONS}`, plus `{MAX_EXPLICIT}`, true only when the value came from source 1 or 2. `{MAX_EXPLICIT}` is what lets an inner loop return `capped` rather than `guardrail`.
5. **Probe binary availability** for each local agent with `command -v {binary}`, where `{binary}` is the base agent's executable (`claude`, `codex`, `agy`, `grok`, `pi`, `opencode`, or `ollama`; a `[<model>]` bracket never changes it). `cursor` uses the Cursor binary probe from the cursor recipe that `lib/local-agent-review-loop.md` loads (prefer `cursor-agent`; fall back to `agent` only when that binary identifies as Cursor, since Grok Build also ships an `agent` on `$PATH`). Skip the probe for `copilot` and every `@<login>`: they review cloud-side through the code host's authenticated CLI, whose auth the calling command already confirmed. `cmd[<invocation>]` has no fixed binary; its loop records a command-not-found exit as `skipped` at dispatch time. For a local agent whose binary is missing:
   - **Default mode**: print `{agent} CLI not installed — recording as skipped` and keep the agent in the list. When dispatch reaches it, record the pass `skipped` without running the inner loop. Do not drop it silently (that could report `clean` for a reviewer that never ran), and do not add `copilot` or any other reviewer as a fallback: the executed list never contains a reviewer the user did not ask for.
   - **Interactive mode (`--interactive`)**: ask the user whether to install, skip (recorded `skipped` as above), or abort.

   Swarm callers (`/do:next --swarm`): [next-swarm.md](./next-swarm.md#swarm-phase-b--fan-out-one-subagent-per-issue)'s Phase B defines how a worker consumes an orchestrator-supplied `REVIEWER_PREFLIGHT` block. Its zero-token checks cover every entry; an `unavailable` optional row is skipped without launching, and every other entry takes this step as written. Single-issue callers never supply it.

Only when `{REVIEW_MODE}=parallel` was explicitly resolved, apply [multi-reviewer-parallel.md](./multi-reviewer-parallel.md)'s Pre-flight step 6 here.

Print the resolved plan before starting: `Review plan: {REVIEW_AGENTS} (mode: {REVIEW_MODE}, stop-mode: {REVIEW_STOP_MODE})`. When any entry resolved a non-default cap, append the per-reviewer caps: `Iteration caps: claude=2, ollama=1, codex=3`.

### Wait schedules

The default `{WAIT_SCHEDULE}` for a host-side entry, by reviewer kind:

- `copilot` — expected duration is the previous Copilot review's duration on this PR (60 seconds if there is none). Wait at most 3× that, no less than 90 seconds and no more than 5 minutes. Poll every 5s, 5s, 10s, 10s, then 15s.
- `@<login>` ending in `[bot]` (an automated reviewer) — expected duration 5 minutes. Wait at most 3× that, no less than 3 minutes and no more than 15 minutes. Poll every 10s, 10s, 20s, 20s, then 30s.
- Any other `@<login>` (presumed human) — wait at most 4 hours. Poll every 30s for the first 5 minutes, then every 60s.

### Series dispatch (default — `{REVIEW_MODE}=series`)

Iterate `REVIEW_AGENTS` in order, running each reviewer's full single-reviewer loop to completion before starting the next. For each `{REVIEW_AGENT}`:

1. **Print a banner**: `--- Review pass {n}/{N}: {REVIEW_AGENT} ---`
2. **Record the baseline**: `git rev-parse HEAD`, kept as `PASS_START_SHA`, so the wrapper can tell whether this reviewer changed anything independently of the inner loop's own tracking.
3. **Dispatch** to the matching single-reviewer loop under `{LIB_DIR}`, running its steps as written. Forward this entry's `{MAX_ITERATIONS}` and `{MAX_EXPLICIT}` to every target, and `{ENTRY_EFFORT}` as `{REVIEW_EFFORT}` / `{OLLAMA_EFFORT}` (empty if unset):
   - `copilot` → only when `{CODE_HOST}=github`: `{LIB_DIR}/host-reviewer-loop.md` plus `{LIB_DIR}/copilot-review-loop.md`, forwarding `{CODE_HOST}`, `{GH_HOST}`, the entry's `{WAIT_SCHEDULE}`, and its `{MAX_ITERATIONS}` as the template's `{REVIEW_ITERATIONS}`. On any other host, print `copilot is GitHub's reviewer and is unavailable on this {CODE_HOST} {CR_NOUN} — recording as skipped` and record the pass `skipped` without dispatching.
   - `@<login>` → `{LIB_DIR}/host-reviewer-loop.md` on every supported host, forwarding `{CODE_HOST}`, `{CR_NOUN}`, `{GH_HOST}`, the entry's `{WAIT_SCHEDULE}`, its `{REVIEWER_LOGIN}`, and its `{MAX_ITERATIONS}` as the template's `{REVIEW_ITERATIONS}`.
   - `codex` | `agy` | `claude` | `grok` | `pi` | `cursor` | `opencode` → `{LIB_DIR}/local-agent-review-loop.md`, forwarding the entry's resolved `{REVIEW_MODEL}` and `{REVIEW_EFFORT}`.
   - `cmd` → `{LIB_DIR}/local-agent-review-loop.md`, forwarding `{REVIEWER_CMD}` in place of `{REVIEW_MODEL}`/`{REVIEW_EFFORT}`; `{REVIEWER_APPLIES}` is ignored for this entry.
   - `ollama` → `{LIB_DIR}/ollama-review-loop.md`, forwarding the entry's `{OLLAMA_MODEL}` and `{OLLAMA_EFFORT}`; `{REVIEWER_APPLIES}` does not apply.

   The inner loop handles its own iterations, fix-and-push cycles and verification, and returns one status from the Statuses table.
4. **Record the pass result** (status, number of new commits since `PASS_START_SHA`, and the entry's `{OPTIONAL}` flag) as a row for the aggregate report.
5. **Assert the pass's fixes reached the remote.** Every inner loop pushes its own fix commits as its final step, but nothing downstream re-checks it. An orchestrator that improvises a loop body leaves the fixes committed locally, where the PR and the merge gate never see them, while every reviewer still reports a verdict and CI passes on the stale pushed tree. Check it here, once, for every reviewer type. Run the block as one command, with `PASS_START_SHA` assigned from step 2:

   ```bash
   # Nothing to assert without an upstream: /do:review and /do:better can run on a branch that was
   # never pushed, and a detached HEAD or missing origin lands here too.
   if git rev-parse --abbrev-ref --symbolic-full-name @{u} >/dev/null 2>&1; then
     UNPUSHED="$(git log --oneline @{u}..HEAD)"
   else
     UNPUSHED=""
   fi
   # Derive the push target from config, not by splitting the abbrev-ref: a remote name may contain
   # a slash, and a local upstream (branch.<n>.remote=.) abbreviates to a bare `main`.
   BR="$(git branch --show-current)"
   PUSH_REMOTE="$(git config --get "branch.$BR.remote")"
   PUSH_BRANCH="$(git config --get "branch.$BR.merge")"   # already a full refs/heads/<name>
   # Inherited base tracking (a worktree cut from origin/main auto-tracks it) is not a publication
   # target: treat it as unpublished so feature commits never reach the default branch.
   BASE_BRANCH="$(git symbolic-ref --quiet --short "refs/remotes/$PUSH_REMOTE/HEAD" 2>/dev/null | sed "s@^$PUSH_REMOTE/@@")"
   [ -n "$BASE_BRANCH" ] || BASE_BRANCH="$(git remote show "$PUSH_REMOTE" 2>/dev/null | sed -n '/HEAD branch: (unknown)$/d; s/.*HEAD branch: //p')"
   if { [ "$PUSH_BRANCH" = "refs/heads/${BASE_BRANCH:-main}" ] || { [ -z "$BASE_BRANCH" ] && [ "$PUSH_BRANCH" = refs/heads/master ]; }; } && [ "$BR" != "${PUSH_BRANCH#refs/heads/}" ]; then PUSH_REMOTE=""; fi
   if [ -z "$PUSH_REMOTE" ] || [ "$PUSH_REMOTE" = "." ]; then
     UNPUSHED=""   # upstream is a local branch, or none: no remote to assert against
   fi
   # Scope it to this pass: a pass that committed nothing has nothing of its own stranded, and
   # anything else ahead of the upstream is local work the caller never asked this loop to publish.
   if [ "$PASS_START_SHA" = "$(git rev-parse HEAD)" ]; then
     UNPUSHED=""
   fi
   if [ -n "$UNPUSHED" ]; then
     if ! git push "$PUSH_REMOTE" "HEAD:$PUSH_BRANCH"; then
       if git pull --rebase --autostash; then
         git push "$PUSH_REMOTE" "HEAD:$PUSH_BRANCH"
       else
         echo "REBASE_CONFLICT_NEEDS_RESOLUTION"
         false
       fi
     fi
   fi
   ```

   `REBASE_CONFLICT_NEEDS_RESOLUTION` is a handoff, not the block's final result: while Git reports an active rebase or unmerged paths, do not record `push-failed` and do not dispatch another reviewer. Read and follow [rebase-conflict-resolution.md](./rebase-conflict-resolution.md), complete the rebase and its focused validation, then rerun this whole block so the destination is derived afresh. Only a non-conflict pull error, the playbook's last-resort abort after a genuine ambiguity, or a push that still fails after the completed resolution becomes `push-failed`.

   **Push to the ref the upstream names — not a bare `git push`, and not `git push origin HEAD`.** A bare push fans out under `push.default=matching` to every same-named local branch (including a `release` branch that may auto-tag and publish) and errors under `push.default=nothing`. `git push origin HEAD` resolves `HEAD` to the **local** branch name and pushes to `refs/heads/<local-name>`, ignoring the upstream — on a branch whose upstream has a different name (or lives on another remote) it creates a spurious remote branch, leaves the real PR head stale, and `@{u}..HEAD` is *still* non-empty afterward. `branch.<name>.merge` is already fully qualified, so the destination is `HEAD:$PUSH_BRANCH`, never `HEAD:refs/heads/$PUSH_BRANCH`.

   If the push still fails, record the pass as `push-failed` and print the unpushed SHAs. This overrides the inner loop's status, except a hard error, which keeps its own status so the aggregate stays `dirty`; note the stranded SHAs in that pass's Notes instead. Downgrading a hard error to `push-failed` would make the aggregate `inconclusive` and let a caller that aborts only on `dirty` open a PR against a branch it was supposed to refuse.

   `git status` is not a substitute: a clean working tree says nothing about committed-but-unpushed commits. The check only ever pushes forward, and only this pass's own work — never a force-push. It is a no-op after a hard-error pass that reverted to its start commit, but still run it, since an improvised loop body may have skipped the revert.

### Stop-mode decision

After each pass, before moving to the next reviewer:

- **A hard error stops the loop in every mode.** Surface the failing reviewer's status.
- Otherwise evaluate `{REVIEW_STOP_MODE}`. "Changed" means commits were added since `PASS_START_SHA`: the signal is the commit-graph delta, not the count of suggestions.

| Mode | Stop after this pass when... | Otherwise |
|------|------------------------------|-----------|
| `all` | never | continue until the list is exhausted |
| `on-findings` | it returned a verdict status and changed something | continue |
| `on-clean` | it returned `clean` (or copilot `too-large`) and changed nothing | continue — including after `capped`, which means the budget ran out with fixes applied, not a confirming clean re-review |

An inconclusive pass never triggers a stop: a reviewer that crashed mid-fix, or a pass downgraded to `push-failed`, cannot claim the "found something" signal or be the reason the remaining reviewers are skipped.

The stop-mode governs which reviewers run, the user's explicit choice. How long one reviewer keeps re-reviewing its own fixes is owned by that loop's convergence gate (`~/.claude/lib/review-convergence-gate.md`), which usually stops it well before its iteration ceiling. A `clean` reached by convergence is still a verdict here, and the gate never causes the wrapper to skip a listed reviewer.

Only when `{REVIEW_MODE}=parallel` was explicitly resolved, run [multi-reviewer-parallel.md](./multi-reviewer-parallel.md)'s Parallel dispatch section instead of the Series dispatch above.

### Aggregate report

After the wrapper exits, print one row per pass:

```
## Multi-Reviewer Summary

Review mode: {REVIEW_MODE}
Stop mode: {REVIEW_STOP_MODE}
Reviewers planned: {original REVIEW_AGENTS list}
Reviewers run:     {actually executed subset}

| Pass | Agent  | Optional | Iterations | Status        | Commits added | Notes                     |
|------|--------|----------|------------|---------------|---------------|---------------------------|
| 1    | codex  | no       | 2/3        | clean         | 2             | log: {path}               |
| 2    | ollama | yes      | 1/1        | capped        | 1             | non-blocking (~opt), ~max=1 |
| 3    | copilot| no       | 0/1        | too-large     | 0             | PR exceeded 20k-line cap  |

Overall status: {OVERALL_STATUS}
```

**Iterations** is `{rounds run}/{MAX_ITERATIONS}` (`∞` when the cap is `0`); name the source in Notes when a `~max=<n>` set the cap. An inconclusive status on an **Optional** row did not block, so the table shows why a merge proceeded without that reviewer's verdict. A `push-failed` row names the inner loop's original status and lists the stranded SHAs in Notes (e.g. `clean, but 2 commits unpushed: a1b2c3d, e4f5a6b`).

`{OVERALL_STATUS}` is the first row that matches, top-down, using the classes from Statuses:

| `{OVERALL_STATUS}` | When |
|--------------------|------|
| `dirty` | A hard error stopped the loop, whether or not that pass was optional. |
| `inconclusive` | Any non-optional pass is inconclusive, or any pass at all is `push-failed`. The build is fine but the user asked for a perspective and did not get it (`--review-with copilot,codex` where copilot times out and codex is clean lands here). Not eligible to merge; re-run or intervene. |
| `partial` | A stop-mode short-circuit skipped at least one listed reviewer. Every executed pass was a verdict or an excused optional one. |
| `clean` | Everything else: every listed reviewer ran, and each returned a verdict or was an excused optional pass. |

In parallel mode, use [multi-reviewer-parallel.md](./multi-reviewer-parallel.md)'s aggregate rule instead: the same statuses, evaluated over each reviewer's review-phase result plus the single apply step.

The calling command (do:pr / do:release / do:review) uses `{OVERALL_STATUS}` to decide its next action. For do:release the merge gate requires `clean`: never merge on `dirty` or `inconclusive`, and on `partial` only when the stop-mode was explicitly set (the user opted into the short-circuit).
