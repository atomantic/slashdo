## Local CLI runner: timeout, snapshot/restore, background launch

The shared mechanics for driving a headless local CLI against this working tree. The local-agent review loop, the draft-enhancement loop, and the multi-reviewer parallel barrier all use it. The calling loop owns the prompt, the `{INVOCATION}`, and what a failure means for its status. This file owns how the CLI is bounded, launched, and waited on, and how it is kept from changing the caller's tree.

### Timeout wrapper

Run once, verbatim:

```bash
# An ARRAY, expanded only as ${TIMEOUT_CMD[@]+"${TIMEOUT_CMD[@]}"} — see ~/.claude/lib/empty-array-expansion.md.
# Empty on stock macOS is a supported configuration (the CLI's own limits bound the run), never a failure.
TIMEOUT_CMD=()
if command -v timeout >/dev/null 2>&1; then TIMEOUT_CMD=(timeout 1800)
elif command -v gtimeout >/dev/null 2>&1; then TIMEOUT_CMD=(gtimeout 1800); fi
```

### Snapshot

Take this before the CLI runs. It captures the caller's entire pre-pass state as five artifacts, including staged, unstaged and untracked content, pre-existing dirty files, and git metadata. The artifacts are HEAD (`HEAD_BASELINE`), the index (`INDEX_TREE`), tracked worktree content (`SNAPSHOT`), untracked content (`UNTRACKED_TAR`), and git metadata (`GIT_META_BAK`, which holds `.git/config` plus hooks). Having all five is what lets the restore work wholesale instead of enumerating what a misbehaving CLI touched:

```bash
HEAD_BASELINE=$(git rev-parse HEAD)
INDEX_TREE=$(git write-tree)                              # caller's staged state
DIFF_BASELINE=$(git diff HEAD | git hash-object --stdin)  # catches edits to ALREADY-dirty tracked files
SNAPSHOT=$(git stash create)                              # dirty tracked worktree ('' when clean)
UNTRACKED_TAR="$(mktemp -t cli-untracked.XXXXXX.tar)"
(set -o pipefail; git ls-files --others --exclude-standard -z | tar --null -T - -cf "$UNTRACKED_TAR" 2>/dev/null) || {
  echo "cannot snapshot untracked files" >&2
  exit 1
}
# The NUL-delimited file list feeds tar directly; hashing the archive fingerprints
# every path, file type, mode, content, and symlink target without splitting names.
untracked_manifest_hash() {
  (set -o pipefail; git ls-files --others --exclude-standard -z | tar --null -T - -cf - | shasum -a 256)
}
UNTRACKED_BASELINE=$(untracked_manifest_hash) || {
  echo "cannot fingerprint untracked files" >&2
  exit 1
}
MTIME_STAMP="$(mktemp -t cli-stamp.XXXXXX)"              # gitignored-file detection window
# A planted hook or core.hooksPath/fsmonitor/pager/alias in .git/config runs on the next git command.
GIT_COMMON="$(cd "$(git rev-parse --git-common-dir)" && pwd -P)"
GIT_META_BAK="$(mktemp -d -t cli-gitmeta.XXXXXX)"
cp -p "$GIT_COMMON/config" "$GIT_META_BAK/config"
{ tar -cf "$GIT_META_BAK/hooks.tar" -C "$GIT_COMMON" hooks 2>/dev/null; } || : > "$GIT_META_BAK/hooks.tar"
git_meta_hash() {
  if [ -d "$GIT_COMMON/hooks" ]; then
    (set -o pipefail; tar -cf - -C "$GIT_COMMON" config hooks | shasum -a 256)
  else
    (set -o pipefail; tar -cf - -C "$GIT_COMMON" config | shasum -a 256)
  fi
}
GIT_META_BASELINE=$(git_meta_hash) || {
  echo "cannot fingerprint git metadata" >&2
  exit 1
}
```

A bare `git status --porcelain` comparison is **not** sufficient. Editing an already-dirty file leaves its ` M` line unchanged, and editing or deleting a pre-existing untracked file leaves its `??` line unchanged. The diff hash and the untracked hash catch those cases.

### Launch and wait

**Run the invocation in the BACKGROUND, not as a blocking foreground Bash call.** A real review or a heavy-model pass routinely runs past ten minutes, and the host CLI's Bash tool caps a single foreground command at about 10 minutes (Claude Code's Bash `timeout` maxes out at 600000 ms). A foreground call is killed at that mark by the host, before the CLI prints its result.

Before each launch the caller sets `RUN_TAG`, the log-name prefix. It also sets `PROMPT_ON_STDIN`: the prompt text when the invocation reads its prompt on stdin, and empty otherwise. The pipe then goes in front of the whole timed line; if it were folded into `{INVOCATION}`, `TIMEOUT_CMD` would bound only the `printf`.

- **Claude Code and other hosts with a backgroundable Bash tool**: run this in the host's background mode (Claude Code: `run_in_background: true` on the Bash tool call). Capture it exactly as shown; the trailing `; echo $? > "$DONE_FILE"` records the real exit code for the wait loop:

  ```bash
  LOG_FILE="$(mktemp -t "${RUN_TAG}.XXXXXX.log")"
  ERR_FILE="${LOG_FILE}.err"
  DONE_FILE="${LOG_FILE}.exit"
  if [ -n "$PROMPT_ON_STDIN" ]; then
    printf '%s' "$PROMPT_ON_STDIN" | ${TIMEOUT_CMD[@]+"${TIMEOUT_CMD[@]}"} {INVOCATION} > "$LOG_FILE" 2> "$ERR_FILE"; echo $? > "$DONE_FILE"
  else
    ${TIMEOUT_CMD[@]+"${TIMEOUT_CMD[@]}"} {INVOCATION} > "$LOG_FILE" 2> "$ERR_FILE"; echo $? > "$DONE_FILE"
  fi
  ```

  Then wait with **bounded blocking-chunk foreground calls**. Do NOT end your turn and wait to be notified. Repeat this call (each one blocks about 9 minutes, under the host cap) until `$DONE_FILE` exists, then read `EXIT_CODE=$(cat "$DONE_FILE")`:

  ```bash
  for i in $(seq 1 55); do [ -f "$DONE_FILE" ] && break; sleep 10; done; [ -f "$DONE_FILE" ] && cat "$DONE_FILE" || echo "STILL_RUNNING"
  ```

  On `STILL_RUNNING`, issue the same call again straight away. Tail `$LOG_FILE` between chunks only if you need a progress signal. The run is bounded by `TIMEOUT_CMD` or the CLI's own timeout.

  **NEVER end your turn while a CLI is in flight.** A re-notification when the background task exits only happens in a top-level interactive session. Inside a **subagent** (a `/do:next --swarm` worker, a CoS/background agent, anything spawned through an Agent/Task tool), ending the turn *terminates the run* and the result is lost. The blocking-chunk loop is correct in both contexts, so use it unconditionally.

- **Hosts with no background Bash mechanism**: run the identical launch block in the foreground, then read `EXIT_CODE=$(cat "$DONE_FILE")`. Raise the host tool's timeout to its maximum. A run cut off at that maximum is a timed-out pass, never a silently empty result.

**Keep stderr OUT of `$LOG_FILE` (`2> "$ERR_FILE"`, never `2>&1`).** Every CLI writes chatter to stderr: banners, auth notices, progress, update nags, a `timeout` kill message. Callers parse `$LOG_FILE` strictly, so a merged stream would corrupt the result. A `124` exit from `timeout`/`gtimeout`, or an empty log after the poll loop gave up, means the run passed 30 minutes. Treat it as a failed pass, never as a clean one.

### Verify and restore

Run this after the CLI exits, before reading its result. First validate, compare, and if needed restore git metadata using only shell tools. Then recompute the other four artifacts with Git and compare them against the snapshot. If this runs in a different shell, set `GIT_COMMON` and `GIT_META_BAK` to the exact saved paths from Snapshot; never rediscover either with Git before metadata is restored.

```bash
if [ -z "${GIT_COMMON:-}" ] || [ -z "${GIT_META_BAK:-}" ] || [ ! -d "$GIT_COMMON" ] || [ ! -d "$GIT_META_BAK" ] || [ ! -f "$GIT_COMMON/config" ] || [ ! -f "$GIT_META_BAK/config" ] || [ ! -f "$GIT_META_BAK/hooks.tar" ]; then
  echo "cannot restore git metadata: snapshot paths unavailable" >&2
  exit 1   # a failed restore — never continue on a tree you could not restore
fi
case "$GIT_COMMON" in
  /*) ;;
  *) echo "cannot restore git metadata: saved common-dir path is not absolute" >&2; exit 1 ;;
esac
if [ "$GIT_COMMON" = "/" ]; then
  echo "cannot restore git metadata: invalid saved common-dir path" >&2
  exit 1
fi
git_meta_hash() {
  if [ -d "$GIT_COMMON/hooks" ]; then
    (set -o pipefail; tar -cf - -C "$GIT_COMMON" config hooks | shasum -a 256)
  else
    (set -o pipefail; tar -cf - -C "$GIT_COMMON" config | shasum -a 256)
  fi
}
GIT_META_CURRENT=$(git_meta_hash) || {
  echo "cannot inspect git metadata; stop before running Git" >&2
  exit 1
}
if [ "$GIT_META_CURRENT" != "$GIT_META_BASELINE" ]; then
  # Restore config and hooks before any Git command can consult attacker-edited settings.
  cp -p "$GIT_META_BAK/config" "$GIT_COMMON/config" || exit 1
  rm -rf "$GIT_COMMON/hooks" || exit 1
  if [ -s "$GIT_META_BAK/hooks.tar" ]; then
    tar -xpf "$GIT_META_BAK/hooks.tar" -C "$GIT_COMMON" || exit 1
  fi
  GIT_META_CURRENT=$(git_meta_hash) || exit 1
  if [ "$GIT_META_CURRENT" != "$GIT_META_BASELINE" ]; then
    echo "git metadata restore failed; stop before running Git" >&2
    exit 1
  fi
fi
```

**Only after the metadata check/restore above succeeds**, compare the remaining artifacts. The untracked fingerprint reuses the NUL-delimited tar manifest, so filenames containing newlines remain one path and content, type, mode, and symlink-target changes are detected:

```bash
untracked_manifest_hash() {
  (set -o pipefail; git ls-files --others --exclude-standard -z | tar --null -T - -cf - | shasum -a 256)
}
git rev-parse HEAD                              # vs $HEAD_BASELINE
git write-tree                                  # vs $INDEX_TREE
git diff HEAD | git hash-object --stdin         # vs $DIFF_BASELINE
untracked_manifest_hash                         # vs $UNTRACKED_BASELINE
```

**If any artifact differs**, the CLI wrote to the tree. Restore the caller's entire pre-pass state wholesale from the snapshot, running from the repo root after the git-metadata restore above. Do NOT enumerate what it touched path by path. That approach has repeatedly had destructive edge cases: a mixed reset unstages the caller's work, `git checkout --` does nothing to staged-but-uncommitted content, and stash misses untracked files. The wholesale sequence:

1. **HEAD**: if it moved, run `git reset --soft "$HEAD_BASELINE"`. Never use `--mixed`, which wipes the caller's staged state, and never `--hard`, which destroys uncommitted work swept into the CLI's commit.
2. **Index**: `git read-tree "$INDEX_TREE"`.
3. **Tracked worktree**: `git restore --source="${SNAPSHOT:-$HEAD_BASELINE}" --worktree -- .`.
4. **Untracked**: run `git clean -fd -- .` to remove all non-ignored untracked content, then `tar -xpf "$UNTRACKED_TAR"` to restore the snapshot. This deletes and restores the entire untracked set without parsing filenames as newline-delimited text.
5. Recompute all five comparisons, including `untracked_manifest_hash` and `git_meta_hash`. If the tree is not back at baseline, the restore **failed**. The caller must stop with a loud warning naming the log, and must never continue on top of that tree.

**Gitignored files are outside the snapshot/restore guarantee**, because hashing or tarring them has no size bound (`node_modules/`, build output). They still get a cheap check: `find . -path ./.git -prune -o -type f -newer "$MTIME_STAMP" -print` lists files modified during the pass. For any hit that git ignores (`git check-ignore`), such as `.env` or a local generated config, print a loud warning naming the file: `local CLI modified gitignored file {path} — not auto-restorable; inspect before committing/running`.

The caller decides what a mismatch means for its status. This file only guarantees that the tree is back at baseline, or that you know it is not.
