## Review fix tail: apply, verify, push, re-loop

This is the end of every pass in the local-agent and Ollama review loops. The calling loop owns steps 1–3: the baseline, the review, and verdict parsing. It hands this tail its validated findings together with `{FIX_LABEL}`, the reviewer name used in commit subjects. Everything from "the orchestrator applies the findings" onward happens here.

Shell variables may not survive between tool calls. `LOOP_START_SHA` is the SHA the calling loop recorded in its step 1; assign it at the top of any block below that uses it.

**Status override.** When this tail sets `STATUS=clean` or `STATUS=capped`, first apply the calling loop's own override if it has one. Ollama's override yields `incomplete` on a coverage gap.

### Apply (orchestrator applies)

- For each finding, read the cited file at the cited line and apply the fix, taking the `fix` field as a starting point. If the fix is wrong, imprecise, out of scope, or cites a line that does not exist, your judgment overrides it. This is your commit, not the reviewer's.
- After each cohesive set of fixes, run `{BUILD_CMD}` (skip when empty) and `{TEST_CMD}`. If either fails, fix forward. If the failure comes from a bad finding, drop that finding and continue.
- Commit each fix, or each coherent group. Follow the project's commit convention when it states one (CONTRIBUTING, CLAUDE.md/AGENTS.md, a commit-lint config), and name the reviewer in the message. With no stated convention, use `address review ({FIX_LABEL}): <summary>`. No co-author or "Generated with" lines.
- After the apply pass, recompute the change counts. Steps 4 and 5 verify and push the orchestrator's commits since `$LOOP_START_SHA`, and the pre-apply values would falsely report `clean`, leaving those commits unverified and unpushed:
  ```bash
  NEW_COMMITS=$(git rev-list "$LOOP_START_SHA..HEAD" --count)
  UNCOMMITTED=$(git status --porcelain | wc -l)
  ```
- If recomputed `UNCOMMITTED > 0`, print the uncommitted diff, stage the explicitly listed files, and commit them the same way (fallback subject `address review ({FIX_LABEL}): orchestrator-applied — remaining changes`). Then recompute both counts. This must happen before the zero-commit check, or a dirty tree could exit `clean` with no verification and no push.
- If recomputed `NEW_COMMITS == 0` and `UNCOMMITTED == 0`, every finding was rejected and the tree is clean. Set `STATUS=clean` and exit the loop.

### 4. Verify in the main thread

Do this step yourself rather than delegating it to a sub-agent: it is the only check between the reviewer's output and the remote branch.

- Read `git diff "$LOOP_START_SHA..HEAD"` and inspect each new commit's message and changes. Look for changes beyond the stated review scope (out-of-bounds refactors, unrelated files), commits that revert legitimate behavior to make a flaky test pass, disabled tests, skipped assertions, `// TODO` placeholders, and secrets, hardcoded credentials, or other content that must not land.
- Run the fix regression guard (`~/.claude/lib/fix-regression-guard.md`) on that same diff before building. A fix that fails the guard is itself a finding: re-scope it now, not next round.
- Run `{BUILD_CMD}` (skip when empty). On failure in **default mode**, revert with `git reset --hard $LOOP_START_SHA`, set `STATUS=broken-build`, exit the loop, and report. In **interactive mode**, ask whether to retry (re-invoke the reviewer), revert, or accept and fix manually.
- Run `{TEST_CMD}` (skip when empty). Handle a failure the same way, with `STATUS=test-failed`.
- If any inspection red flag triggered, revert with `git reset --hard $LOOP_START_SHA`, set `STATUS=rejected`, and exit the loop.

### 5. Push verified changes

Run this as one command, so the derived target and the push travel together:

```bash
BR="$(git branch --show-current)"
PUSH_REMOTE="$(git config --get "branch.$BR.remote")"
PUSH_BRANCH="$(git config --get "branch.$BR.merge")"   # already a full refs/heads/<name>
# Inherited base tracking (a worktree cut from origin/main auto-tracks it) is not a publication
# target: treat it as unpublished so feature commits never reach the default branch.
BASE_BRANCH="$(git symbolic-ref --quiet --short "refs/remotes/$PUSH_REMOTE/HEAD" 2>/dev/null | sed "s@^$PUSH_REMOTE/@@")"
[ -n "$BASE_BRANCH" ] || BASE_BRANCH="$(git remote show "$PUSH_REMOTE" 2>/dev/null | sed -n '/HEAD branch: (unknown)$/d; s/.*HEAD branch: //p')"
if { [ "$PUSH_BRANCH" = "refs/heads/${BASE_BRANCH:-main}" ] || { [ -z "$BASE_BRANCH" ] && [ "$PUSH_BRANCH" = refs/heads/master ]; }; } && [ "$BR" != "${PUSH_BRANCH#refs/heads/}" ]; then PUSH_REMOTE=""; fi
if [ -z "$PUSH_REMOTE" ] || [ "$PUSH_REMOTE" = "." ] || [ -z "$PUSH_BRANCH" ]; then
  echo "No remote upstream is configured; leaving this review pass local." >&2
else
  git push "$PUSH_REMOTE" "HEAD:$PUSH_BRANCH"
fi
```

If a remote upstream is configured and the push fails (for example, non-fast-forward), run `git pull --rebase --autostash` and rerun the block once. A conflict during the pull is not a reason to abort or report failure. Read and follow [rebase-conflict-resolution.md](./rebase-conflict-resolution.md): resolve and continue the rebase, rerun the builds and tests the resolution affects, then rerun the block. Report failure only if the push still cannot publish the branch after the resolution and the retry. Never guess `origin` or the local branch name when no upstream is configured.

### 6. Re-loop or stop

- `ITERATION=$((ITERATION + 1))`
- Apply the convergence gate (`~/.claude/lib/review-convergence-gate.md`). If the round just completed made zero commits, or landed only marginal findings, converge: set `STATUS=clean` and exit, noting the diminishing-returns convergence in the report. This is the normal exit.
- Otherwise the round was substantive. Let `CEILING` be `MAX_ITERATIONS` when it is 1 or more, or `10` when `MAX_ITERATIONS=0` (unlimited mode's backstop). If `ITERATION < CEILING`, go back to the calling loop's step 1 and re-review the latest commits, which catches findings a fix introduced.
- Otherwise the ceiling stopped a loop that was still productive. Set `STATUS=capped` only when the cap was the user's and positive (`MAX_EXPLICIT=true` and `MAX_ITERATIONS` of 1 or more), which counts as a verdict. Otherwise set `STATUS=guardrail`, which is inconclusive: the cap was built in (`MAX_EXPLICIT=false`: the default `3`), or it was unlimited mode's backstop of 10, even when the user typed `~max=0`.

### After the final report

After the calling loop prints its summary: `clean` and `capped` mean the PR is ready for the merge gate (release flow) or for hand-off back to the user (PR flow). For any other status, the calling command decides whether to proceed, re-run, or stop. Do not auto-merge on any other reviewer status, and do not substitute another reviewer, `copilot` included, for one the user requested.
