## Push to the configured upstream

**Which form depends on whether the branch's upstream names a remote** — `-u` *rewrites* `branch.<name>.remote`/`.merge`, so using it unconditionally would re-point an existing upstream at `origin/{current_branch}`. Discriminate on `branch.<name>.remote`, **not** on whether `@{u}` resolves: a branch tracking a *local* ref (`branch.<name>.remote=.`, what `git branch --set-upstream-to=main` produces) resolves `@{u}` fine, and would be pushed into the local repository:

```bash
BR="$(git branch --show-current)"
PUSH_REMOTE="$(git config --get "branch.$BR.remote")"
PUSH_BRANCH="$(git config --get "branch.$BR.merge")"   # already a full refs/heads/<name>
```

- **Not yet published to a remote** — `PUSH_REMOTE` is empty (no upstream at all) **or** `.` (upstream is a local branch): `git push -u origin {current_branch}`, which publishes the branch and re-points a local upstream at the remote.
- **A genuine remote upstream** (`PUSH_REMOTE` is a real remote name): push to the ref that upstream names — `git push "$PUSH_REMOTE" "HEAD:$PUSH_BRANCH"`. `branch.<name>.merge` is already fully qualified, so the destination is `HEAD:$PUSH_BRANCH`, never `HEAD:refs/heads/$PUSH_BRANCH` — never `-u`, and never a destination built from the local branch name — an upstream of `upstream/feature-x` or `origin/pr-123-head` must keep pointing there.
- Never a bare `git push` (under `push.default=matching` it fans out to every same-named local branch, including a `release` branch that may auto-tag and publish), and never `git push origin {current_branch}` (it hardcodes the *local* branch name as the destination: on a differently-named or non-origin upstream it pushes a spurious branch, leaves the real PR head stale, and `@{u}..HEAD` stays non-empty while the push "succeeded"). Never a bare `--force` either.
- **One retry on a non-fast-forward**: `git pull --rebase --autostash`, then repeat the same config-derived push. If that rebase conflicts, resolve it through [rebase-conflict-resolution.md](./rebase-conflict-resolution.md), continue until it completes, rerun the focused checks the resolution touched, then retry the push. Do not classify an active rebase conflict as a push failure and do not stop merely to ask the user to resolve it. If the push still fails after that one retry, the caller stops (print the unpushed SHAs and the push error) rather than proceeding.
- Use `--force-with-lease` (never a bare `--force`) instead of the plain push above only when the caller itself just rewrote already-pushed history (e.g. its own rebase) — still against the same config-derived destination.
