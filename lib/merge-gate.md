# Merge gate

This is the merge procedure for `/do:pr --merge`, `/do:next` Phase 6, and `/do:next --swarm` Phase C. The caller has already applied its own review gate and decided the PR/MR should merge. This file does the rest: it resolves the method, waits on required CI, runs the merge, and reads the result back. It never overrides branch protection. The wait-mode command is the executable `ci_wait_merge` host verb; callers use this shared partial rather than copying a forge branch.

## Inputs

The caller sets each value before it reads this file:

- `{PR}`: the PR (GitHub) or MR (GitLab) number.
- `{GIT}`: `git` when the working directory is the PR's checkout, or `git -C "<worktree>"` when the caller runs somewhere else (the swarm orchestrator).
- `{MODE}`: `queue` or `wait`.
  - `queue` hands the merge to the host's auto-merge, so it lands even after this session ends. Only `/do:pr` uses it, because nothing it does afterward depends on the merge having landed.
  - `wait` watches CI in this session and then merges directly, so a single read-back gives the final answer. `/do:next` and the swarm use it because their cleanup and issue closure depend on that read-back. A queued merge reads back as `OPEN`/`opened`, which would leave the worktree, branch, and issue stranded on every run.
- `{LINKED_WORKTREE}`: `1` when `{GIT}` runs in a linked `git worktree`, otherwise `0`. `/do:next` and the swarm always run in one (`1`). `/do:pr` resolves it in step 2.
- `{MERGE_METHOD}`: the method the caller's Parse Arguments recorded, from an explicit flag or the saved `merge-method` default. It may be unset. Step 1 completes it.

Shell variables do not survive from one Bash call to the next. Write every placeholder, including the resolved method, literally into each block.

## 1. Resolve the merge method (GitHub)

Never hardcode `--merge`. A repo that allows only squash or rebase rejects `gh pr merge --merge` every time. Use the first rule that matches:

1. `{MERGE_METHOD}` as the caller recorded it. It must be `squash`, `rebase`, or `merge`.
2. Otherwise, pick from the repo's allowed methods, preferring `squash`, then `merge`, then `rebase`:
   ```bash
   MERGE_METHOD="$(gh repo view --json mergeCommitAllowed,squashMergeAllowed,rebaseMergeAllowed \
     -q '[(select(.squashMergeAllowed) | "squash"), (select(.mergeCommitAllowed) | "merge"), (select(.rebaseMergeAllowed) | "rebase")] | first // empty')"
   [ -n "$MERGE_METHOD" ] || { echo "Could not resolve an allowed merge method — leaving the PR open."; exit 1; }
   echo "MERGE_METHOD=$MERGE_METHOD"
   ```

If the recorded value is invalid or no method resolves, **do not merge**. Leave the PR open, report why, and treat the result as `left open`. Otherwise, state the chosen method. On GitLab, skip this step: `glab mr merge` takes no method flag and uses the project's default.

## 2. Linked worktree: never `--delete-branch` there

`gh pr merge --delete-branch` also deletes the **local** branch. To do that, `gh` first checks out the default branch. Inside a linked worktree the checkout fails (`fatal: '<default>' is already used by worktree at …`), so `gh` **exits non-zero after the merge has already succeeded**. Any `||` fallback around the merge then fires against a PR that is already merged. The rule:

- `{LINKED_WORKTREE}=0`: append ` --delete-branch` to every `gh pr merge` below.
- `{LINKED_WORKTREE}=1`: never pass `--delete-branch`. Step 5 deletes the remote head once the merge is confirmed, unless the caller's own cleanup owns that deletion. The caller's cleanup also removes the local worktree and branch.

If the caller did not supply `{LINKED_WORKTREE}` (this happens only for `/do:pr`, which is often invoked from inside a worktree), resolve it:

```bash
GIT_DIR_ABS="$(cd "$(git rev-parse --git-dir)" && pwd -P)"
GIT_COMMON_ABS="$(cd "$(git rev-parse --git-common-dir)" && pwd -P)"
if [ "$GIT_DIR_ABS" = "$GIT_COMMON_ABS" ]; then
  LINKED_WORKTREE=0
else
  LINKED_WORKTREE=1
fi
echo "LINKED_WORKTREE=$LINKED_WORKTREE"
```

**Read the printed value and carry it forward yourself.** Re-expanding `$LINKED_WORKTREE` in a later Bash call yields an empty string, which silently takes the not-a-worktree path. Normalizing both paths with `cd … && pwd -P` is required:
- Unnormalized, `--git-common-dir` is *relative* when run from a subdirectory of a plain clone, so the plain clone is misreported as a linked worktree.
- `--path-format=absolute` is rejected by git < 2.31. Both outputs are then empty, they compare equal, and the probe fails *open* into `LINKED_WORKTREE=0`.

## 3. Merge (GitHub)

**`{MODE}=queue`:** first try GitHub-native auto-merge: `gh pr merge {PR} --auto --{MERGE_METHOD}`. It lands when the required checks pass, even if this session ends. If it errors because auto-merge is not enabled on the repo, fall through to `wait`.

**`{MODE}=wait`:** push, wait on the **required** checks, then merge. Push to the ref named by the branch's upstream config. Never use a bare `git push`: under `push.default=matching` it pushes every same-named local branch. Never push to `origin/<local name>` either: that is the wrong ref when the upstream is `upstream/feature-x` or `origin/pr-123-head`. Chain the steps with `&&` so that a failed push (which would leave CI watching the stale SHA) or a red check stops before the merge:

```bash
BR="$({GIT} branch --show-current)"
UP_REMOTE="$({GIT} config --get "branch.$BR.remote")"
UP_REF="$({GIT} config --get "branch.$BR.merge")"   # already a full refs/heads/<name>
if [ -z "$UP_REMOTE" ] || [ "$UP_REMOTE" = "." ] || [ -z "$UP_REF" ]; then
  echo "No remote upstream for '$BR' — not merging PR {PR}"; exit 1
fi
{GIT} push "$UP_REMOTE" "HEAD:$UP_REF" && \
  gh pr checks {PR} --required --watch --fail-fast && \
  gh pr merge {PR} --{MERGE_METHOD}
```

The watch covers **required** checks only, so an optional job cannot block a merge that branch protection would allow.

- **`no required checks reported`**: `gh pr checks` exits non-zero even in this case. Checks for a just-pushed SHA can take a few seconds to register, so re-run the watch once. If it still reports none, the gate is vacuously satisfied: run `gh pr merge {PR} --{MERGE_METHOD}` alone.
- **A required check fails**: apply the CI flake handling routine, which re-runs the failed jobs once on the same commit. Read it only in this case:

!read lib/ci-flake-handling.md

  If the same SHA passes on the re-run, it was a flake: run `gh pr merge {PR} --{MERGE_METHOD}` alone and log which check flaked. If it fails again, **do not merge**. Leave the PR open, report the failing check with its run URL, and treat the result as `left open`.

Every path that ran `gh pr merge` continues to step 5.

## 4. Merge (GitLab)

GitLab has no separate list of required checks. The project's pipeline-must-succeed setting applies instead.

**`{MODE}=queue`:** run `glab mr merge {PR} --auto-merge --yes --remove-source-branch`, which merges when the pipeline succeeds. If the installed `glab` does not support `--auto-merge`, fall through to `wait`.

**`{MODE}=wait`:** push, wait on the branch's pipeline, then merge. Use the same upstream-derived push as step 3. Pass `--branch` so the wait watches the PR's branch, not whatever branch is checked out in the caller's working directory:

```bash
BR="$({GIT} branch --show-current)"
UP_REMOTE="$({GIT} config --get "branch.$BR.remote")"
UP_REF="$({GIT} config --get "branch.$BR.merge")"   # already a full refs/heads/<name>
if [ -z "$UP_REMOTE" ] || [ "$UP_REMOTE" = "." ] || [ -z "$UP_REF" ]; then
  echo "No remote upstream for '$BR' — not merging MR {PR}"; exit 1
fi
{GIT} push "$UP_REMOTE" "HEAD:$UP_REF" && glab ci status --wait --branch "${UP_REF#refs/heads/}" && glab mr merge {PR} --yes --remove-source-branch
```

**Why `wait` avoids `--auto-merge`:** `--auto-merge` only sets merge-when-pipeline-succeeds on the server and returns while the MR is still `opened`. A `wait`-mode caller's read-back would then see `opened` on every run and never clean up or close an issue. If a `wait`-mode caller must use `--auto-merge` anyway (for example, a very long pipeline), replace the single read-back in step 5 with a bounded poll of the MR state. Treat "still `opened` at the deadline" as queued, not merged. `--remove-source-branch` deletes the head branch on the server when the MR merges. It never touches a local checkout, so it is safe inside a worktree, and step 5 has nothing to delete on GitLab.

## 5. Read back, then delete the remote head

Never trust the merge command's exit status. `gh pr merge` exits zero on a repo with a **merge queue** while the PR is only queued, and both `--auto` and `--auto-merge` return before anything lands. After every merge path, read the state back:

- GitHub: `gh pr view {PR} --json state -q .state`. Expect `MERGED`.
- GitLab: `glab mr view {PR} --output json --jq .state`. Expect `merged`.

Any other value means the PR is **queued**, if `queue` mode or a merge queue accepted it, or **left open**. Report which one, and **delete nothing**: GitHub auto-closes a PR whose head branch disappears, which destroys both the open PR and a queued merge. Whether the PR is queued or left open, the repo's "automatically delete head branches" setting or the caller owns its branch.

On GitHub, once the PR reads `MERGED` with `{LINKED_WORKTREE}=1`, delete the remote head here, unless the caller says its own cleanup owns that deletion. Use the remote and ref from config, never a hardcoded `origin` plus the local branch name. That combination would delete an unrelated remote branch when the upstream is `upstream/feature-x` or `origin/pr-123-head`:

```bash
if [ "$(gh pr view {PR} --json state -q .state)" = "MERGED" ]; then
  BR="$({GIT} branch --show-current)"
  DEL_REMOTE="$({GIT} config --get "branch.$BR.remote")"
  DEL_REF="$({GIT} config --get "branch.$BR.merge")"   # already a full refs/heads/<name>
  # $DEL_REF must be non-empty too: `git push --delete ""` fails, and
  # `ls-remote --heads <remote> ""` returns 2, so an empty ref would report
  # the benign "already gone" for a delete that never ran.
  if [ -n "$DEL_REMOTE" ] && [ "$DEL_REMOTE" != "." ] && [ -n "$DEL_REF" ]; then
    if ! {GIT} push "$DEL_REMOTE" --delete "$DEL_REF"; then
      # rc 2 means "no such ref": the branch is already gone (the repo auto-deletes
      # merged heads), which counts as success. Any other rc is a transport or auth
      # failure that proves nothing, so do NOT report the branch as deleted.
      {GIT} ls-remote --exit-code --heads "$DEL_REMOTE" "$DEL_REF" >/dev/null 2>&1; RC=$?
      if [ "$RC" -eq 2 ]; then
        echo "note: remote branch $DEL_REF was already gone"
      else
        echo "ERROR: could not confirm $DEL_REF is gone (ls-remote rc=$RC) — delete it manually"
      fi
    fi
  else
    echo "note: no upstream resolved for $BR — not deleting any remote branch"
  fi
else
  echo "PR {PR} is not MERGED — keeping its head branch"
fi
```

Return one outcome to the caller: **merged**, **queued**, or **left open** (with the reason).
