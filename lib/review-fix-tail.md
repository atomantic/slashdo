## Review fix tail: apply, verify, push, re-loop

This is the end of every pass in the local-agent and Ollama review loops. The calling loop owns steps 1–3: the baseline, the review, and verdict parsing. It hands this tail its validated findings together with `{FIX_LABEL}`, the reviewer name used in commit subjects. Everything from "the orchestrator applies the findings" onward happens here.

**Status override.** When this tail sets `STATUS=clean` or `STATUS=capped`, first apply the calling loop's own override if it has one. Ollama's override yields `incomplete` on a coverage gap.

### Apply (orchestrator applies)

- For each finding, read the cited file at the cited line and apply the fix, taking the `fix` field as a starting point. If the fix is wrong, imprecise, out of scope, or cites a line that does not exist, your judgment overrides it. This is *your* commit, not the reviewer's.
- After each cohesive set of fixes, run `{BUILD_CMD}` (skip when empty) and `{TEST_CMD}`. If either fails, fix forward. If the failure comes from a bad finding, drop that finding and continue.
- Commit each fix, or each coherent group, as `address review ({FIX_LABEL}): <summary>`. No co-author or "Generated with" lines.
- After the apply pass, **recompute** the change counts. Steps 4 and 5 verify and push the orchestrator's commits since `$LOOP_START_SHA`, and the pre-apply values would falsely report `clean`, leaving those commits unverified and unpushed:
  ```bash
  NEW_COMMITS=$(git rev-list "$LOOP_START_SHA..HEAD" --count)
  UNCOMMITTED=$(git status --porcelain | wc -l)
  ```
- If recomputed `UNCOMMITTED > 0`, print the uncommitted diff, stage the explicitly listed files, and commit them as `address review ({FIX_LABEL}): orchestrator-applied — remaining changes`. Then recompute both `NEW_COMMITS` and `UNCOMMITTED`. This must happen before the zero-commit check, or a dirty tree could exit `clean` with no verification and no push.
- If recomputed `NEW_COMMITS == 0` **and** `UNCOMMITTED == 0`, every finding was rejected and the tree is clean. Set `STATUS=clean` and exit the loop.

### 4. Verify in the main thread

Never delegate this step to a sub-agent. It is the only line of defense between the reviewer's output and the remote branch.

- Read `git diff "$LOOP_START_SHA..HEAD"` and inspect each new commit's message and changes. Look for changes beyond the stated review scope (out-of-bounds refactors, unrelated files), commits that revert legitimate behavior to make a flaky test pass, disabled tests, skipped assertions, `// TODO` placeholders, and secrets, hardcoded credentials, or other content that must not land.
- **Run the fix regression guard** on the same `$LOOP_START_SHA..HEAD` diff before building. Scan for unscoped state-clearing or restoring writes: a "restore" or "reset" keyed to a whole collection instead of the one record the finding named. Scan for side effects folded onto a hot path, such as an `updatedAt`, event, or cache write on every tick. Add a focused regression test when the fix touches scoping or timestamp/side-effect logic. See `~/.claude/lib/fix-regression-guard.md`. A fix that fails the guard is itself a finding: re-scope it now, not next round.
- Run `{BUILD_CMD}` (skip when empty). On failure in **default mode**, revert with `git reset --hard $LOOP_START_SHA`, set `STATUS=broken-build`, exit the loop, and report. In **interactive mode**, ask whether to retry (re-invoke the reviewer), revert, or accept and fix manually.
- Run `{TEST_CMD}` (skip when empty). Handle a failure the same way, with `STATUS=test-failed`.
- If any inspection red flag triggered, revert with `git reset --hard $LOOP_START_SHA`, set `STATUS=rejected`, and exit the loop.

### 5. Push verified changes

```bash
BR="$(git branch --show-current)"
PUSH_REMOTE="$(git config --get "branch.$BR.remote")"
PUSH_BRANCH="$(git config --get "branch.$BR.merge")"
if [ -z "$PUSH_REMOTE" ] || [ "$PUSH_REMOTE" = "." ] || [ -z "$PUSH_BRANCH" ]; then
  echo "No remote upstream is configured; leaving this review pass local." >&2
else
  git push "$PUSH_REMOTE" "HEAD:$PUSH_BRANCH"
fi
```

If a remote upstream is configured and the push fails (for example, non-fast-forward), run `git pull --rebase --autostash` and retry the same `git push "$PUSH_REMOTE" "HEAD:$PUSH_BRANCH"` once, in the same shell. A conflict during the pull is not a reason to abort or report failure. Read and follow [rebase-conflict-resolution.md](./rebase-conflict-resolution.md): resolve and continue the rebase, rerun the builds and tests the resolution affects, then retry the same upstream-derived push. Report failure only if the push still cannot publish the branch after the resolution and the retry. Never guess `origin` or the local branch name when no upstream is configured.

### 6. Re-loop or stop

- `ITERATION=$((ITERATION + 1))`
- **Apply the convergence gate** (`~/.claude/lib/review-convergence-gate.md`). If the round just completed made zero commits, or landed only *marginal* findings, **converge: set `STATUS=clean` and exit**, noting the diminishing-returns convergence in the report. Marginal means edge-case guards, refinements of already-correct behavior, or hypotheticals with no concrete wrong outcome. Only a round with at least one *substantive* finding earns another pass.
- Let `CEILING` be `MAX_ITERATIONS` when it is 1 or more, or `10` when `MAX_ITERATIONS=0` (the safety guardrail for unlimited mode).
- If the gate says continue AND `ITERATION < CEILING`, go back to the calling loop's step 1 and re-review the latest commits, which catches new findings introduced by a fix.
- Otherwise exit the loop. The status depends on *what stopped it*:
  - **The gate converged**: `STATUS=clean`. This is the normal exit.
  - **The ceiling stopped a still-productive loop, and the cap was user-configured** (`MAX_EXPLICIT=true`, a `~max=<n>` with n of 1 or more): `STATUS=capped`. The caller's merge gate treats this as clean-equivalent, not as a failure.
  - **The ceiling stopped a still-productive loop, and the cap was built in** (`MAX_EXPLICIT=false`: the default `3`, or the 10-iteration guardrail in unlimited mode): `STATUS=guardrail`, which is inconclusive.

### After the final report

After the calling loop prints its summary: a `clean` status means the PR is ready for the merge gate (release flow) or for hand-off back to the user (PR flow). `capped` is merge-eligible too, because the reviewer spent the iteration budget the user set. For any other status, including `guardrail` and `skipped`, the calling command decides whether to proceed, re-run, or stop. Never auto-merge on a non-clean reviewer status. Never silently substitute another reviewer, `copilot` included, for one the user requested.
