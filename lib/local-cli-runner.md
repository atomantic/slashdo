## Local CLI runner: timeout, snapshot/restore, background launch

The shared mechanics for driving a headless local CLI against this working tree. The local-agent review loop, the draft-enhancement loop, and the multi-reviewer parallel barrier all use it. The calling loop owns the prompt, the `{INVOCATION}`, and what a failure means for its status. This file owns how the CLI is bounded, launched, and waited on, and how it is kept from changing the caller's tree.

### Shell state between tool calls

Many harnesses start a fresh shell for every command, so a variable set in one call is gone in the next. Three rules make every loop that uses this runner work either way:

1. **One command per launch.** Run the timeout wrapper, the caller's input and flag blocks, any recipe pre-launch block, and the launch block below as a single command. Wherever a loop or recipe says a block runs "in the launch command", it means this one.
2. **Printed values cross calls.** A block that creates something a later call needs prints it as `NAME=value` (the launch block prints `LOG_FILE`; print any recipe temp-file path the same way). Start a later call by assigning the printed values it uses.
3. **The snapshot saves itself.** Snapshot writes its functions and baselines into a private state directory and prints `RUN_STATE_DIR` and `RUN_STATE_SUM`. Verify reloads everything from those two values, so nothing else about the snapshot has to be carried.

### Timeout wrapper

Put this at the top of each launch command:

```bash
# An ARRAY, expanded only as ${TIMEOUT_CMD[@]+"${TIMEOUT_CMD[@]}"} — see ~/.claude/lib/empty-array-expansion.md.
# Empty on stock macOS is a supported configuration (the CLI's own limits bound the run), never a failure.
TIMEOUT_CMD=()
if command -v timeout >/dev/null 2>&1; then TIMEOUT_CMD=(timeout 1800)
elif command -v gtimeout >/dev/null 2>&1; then TIMEOUT_CMD=(gtimeout 1800); fi
```

### Snapshot

Take this before the CLI runs. It captures the caller's whole pre-pass state as five artifacts: HEAD (`HEAD_BASELINE`), the index (`INDEX_TREE`), tracked worktree content (`SNAPSHOT`, with `DIFF_BASELINE` as its fingerprint), untracked content (`UNTRACKED_TAR`), and git metadata (`GIT_META_BAK`, a `.git/config` copy plus hooks). Having all five lets the restore work wholesale instead of enumerating what a misbehaving CLI touched. A `git status --porcelain` comparison would not be enough: editing an already-dirty file leaves its ` M` line unchanged, and editing a pre-existing untracked file leaves its `??` line unchanged.

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)" && RUN_STATE_DIR="$(mktemp -d -t cli-run.XXXXXX)" || {
  echo "cannot create snapshot state" >&2
  exit 1
}
# The functions both phases use, written once. Verify sources this same file.
cat > "$RUN_STATE_DIR/lib.sh" <<'RUNNER_LIB'
# Keys that can execute code or redirect where data goes. $GIT_COMMON is shared by every linked
# worktree, so other agents legitimately write to its config during a pass (a `git push -u` adds a
# [branch "x"] section); fingerprint and restore only these keys, never the whole file.
GIT_SEC_KEYS='^(core\.(hookspath|fsmonitor|pager|editor|sshcommand|askpass|gitproxy)|alias\..+|include\..+|includeif\..+|filter\..+|diff\..+|merge\..+\.driver|(diff|merge)tool\..+\.cmd|pager\..+|credential\..+|remote\..+\.(url|pushurl|uploadpack|receivepack|vcs|proxy)|http\..*proxy|core\.attributesfile|url\..+\.(insteadof|pushinsteadof)|gpg\.(.+\.)?program|sequence\.editor|interactive\.difffilter|trailer\..+\.(cmd|command)|core\.alternaterefscommand|uploadpack\.packobjectshook|submodule\..+\.(update|url)|browser\..+\.(cmd|path)|web\.browser)$'
# `git config --file` reads only the named file, so no repo config (aliases, pager, fsmonitor) is consulted.
git_sec_hash() {   # GIT_SEC_FILE = config file; git exit 1 means "no matching key", which is fine
  # Sorted by key, so a restore that re-creates a section elsewhere still matches; each key's values
  # keep file order (credential.helper order matters).
  (set -o pipefail
   { git config --file "$GIT_SEC_FILE" --null --name-only --get-regexp "$GIT_SEC_KEYS"; [ $? -le 1 ]; } | tr '\0' '\n' | LC_ALL=C sort -u |
     while IFS= read -r k; do printf '%s\0' "$k"; git config --file "$GIT_SEC_FILE" --null --get-all -- "$k" || exit 1; done | shasum -a 256)
}
git_hooks_hash() {
  # Fingerprint what can execute, never archive metadata: a sorted, NUL-delimited listing of every
  # path with its type, executable bit (`-x`, the same access(X_OK) test Git applies), and content
  # hash (symlink target for links). mtimes, owners and tar headers are excluded, so a restore that
  # only changes timestamps verifies clean. POSIX find/sort -z/readlink/shasum only (GNU and BSD).
  if [ -d "$GIT_COMMON/hooks" ]; then
    (set -o pipefail; cd "$GIT_COMMON" || exit 1
     find hooks -print0 | LC_ALL=C sort -z |
       while IFS= read -r -d '' p; do
         if [ -L "$p" ]; then printf 'l\0%s\0%s\0' "$p" "$(readlink "$p")"
         elif [ -d "$p" ]; then printf 'd\0%s\0' "$p"
         elif [ -f "$p" ]; then
           if [ -x "$p" ]; then x=x; else x=n; fi
           h=$(shasum -a 256 < "$p") || exit 1
           printf 'f\0%s\0%s\0%s\0' "$p" "$x" "$h"
         else printf 'o\0%s\0' "$p"; fi
       done | shasum -a 256)
  else
    echo "no-hooks-dir"
  fi
}
# The NUL-delimited file list feeds tar directly; hashing the archive fingerprints every path,
# file type, mode, content, and symlink target without splitting names on newlines.
untracked_manifest_hash() {
  (set -o pipefail; git -C "$REPO_ROOT" ls-files --others --exclude-standard -z | tar -C "$REPO_ROOT" --null -T - -cf - | shasum -a 256)
}
tree_matches() {   # HEAD, index, tracked diff, untracked content — all against the saved baselines
  [ "$(git -C "$REPO_ROOT" rev-parse HEAD)" = "$HEAD_BASELINE" ] &&
  [ "$(git -C "$REPO_ROOT" write-tree)" = "$INDEX_TREE" ] &&
  [ "$(git -C "$REPO_ROOT" diff HEAD | git hash-object --stdin)" = "$DIFF_BASELINE" ] &&
  [ "$(untracked_manifest_hash)" = "$UNTRACKED_BASELINE" ]
}
RUNNER_LIB
. "$RUN_STATE_DIR/lib.sh"
HEAD_BASELINE=$(git -C "$REPO_ROOT" rev-parse HEAD)
INDEX_TREE=$(git -C "$REPO_ROOT" write-tree)                              # caller's staged state
DIFF_BASELINE=$(git -C "$REPO_ROOT" diff HEAD | git hash-object --stdin)  # catches edits to ALREADY-dirty tracked files
SNAPSHOT=$(git -C "$REPO_ROOT" stash create)                              # dirty tracked worktree ('' when clean)
UNTRACKED_TAR="$RUN_STATE_DIR/untracked.tar"
(set -o pipefail; git -C "$REPO_ROOT" ls-files --others --exclude-standard -z | tar -C "$REPO_ROOT" --null -T - -cf "$UNTRACKED_TAR" 2>/dev/null) || {
  echo "cannot snapshot untracked files" >&2
  exit 1
}
UNTRACKED_BASELINE=$(untracked_manifest_hash) || {
  echo "cannot fingerprint untracked files" >&2
  exit 1
}
MTIME_STAMP="$RUN_STATE_DIR/stamp"; : > "$MTIME_STAMP"   # gitignored-file detection window
# A planted hook or core.hooksPath/fsmonitor/pager/alias in .git/config runs on the next git command.
GIT_COMMON="$(cd "$(git rev-parse --git-common-dir)" && pwd -P)"
GIT_META_BAK="$RUN_STATE_DIR/gitmeta"
mkdir "$GIT_META_BAK" && cp -p "$GIT_COMMON/config" "$GIT_META_BAK/config" || exit 1
{ tar -cf "$GIT_META_BAK/hooks.tar" -C "$GIT_COMMON" hooks 2>/dev/null; } || : > "$GIT_META_BAK/hooks.tar"
GIT_CFG_BASELINE=$(GIT_SEC_FILE="$GIT_COMMON/config" git_sec_hash) && GIT_HOOKS_BASELINE=$(git_hooks_hash) || {
  echo "cannot fingerprint git metadata" >&2
  exit 1
}
# Save every baseline so Verify can run in a different shell. The checksum goes to the caller, not
# to disk: Verify refuses a state file the CLI rewrote, instead of sourcing it.
printf '%s=%q\n' REPO_ROOT "$REPO_ROOT" HEAD_BASELINE "$HEAD_BASELINE" INDEX_TREE "$INDEX_TREE" \
  DIFF_BASELINE "$DIFF_BASELINE" SNAPSHOT "$SNAPSHOT" UNTRACKED_TAR "$UNTRACKED_TAR" \
  UNTRACKED_BASELINE "$UNTRACKED_BASELINE" MTIME_STAMP "$MTIME_STAMP" GIT_COMMON "$GIT_COMMON" \
  GIT_META_BAK "$GIT_META_BAK" GIT_CFG_BASELINE "$GIT_CFG_BASELINE" GIT_HOOKS_BASELINE "$GIT_HOOKS_BASELINE" \
  > "$RUN_STATE_DIR/state.sh" || exit 1
RUN_STATE_SUM="$(cat "$RUN_STATE_DIR/lib.sh" "$RUN_STATE_DIR/state.sh" | shasum -a 256 | cut -d' ' -f1)"
echo "RUN_STATE_DIR=$RUN_STATE_DIR RUN_STATE_SUM=$RUN_STATE_SUM"
```

Keep the two printed values; they are all Verify needs.

### Launch and wait

A real review or a heavy-model pass routinely runs past ten minutes, and most harnesses cap a single foreground command at about that long, killing it before the CLI prints its result. So run the launch command in the background when your harness has a background or detached mode for shell commands. Without one, run it in the foreground with the command timeout raised to its maximum; a run cut off at that maximum is a timed-out pass, never a silently empty result.

Before each launch the caller sets `RUN_TAG`, the log-name prefix, and `PROMPT_ON_STDIN`: the prompt text when the invocation reads its prompt on stdin, and empty otherwise. The pipe goes in front of the whole timed line; folded into `{INVOCATION}`, `TIMEOUT_CMD` would bound only the `printf`. The trailing `; echo $? > "$DONE_FILE"` records the real exit code for the wait loop:

```bash
LOG_FILE="$(mktemp -t "${RUN_TAG}.XXXXXX.log")"
ERR_FILE="${LOG_FILE}.err"
DONE_FILE="${LOG_FILE}.exit"
echo "LOG_FILE=$LOG_FILE"
if [ -n "$PROMPT_ON_STDIN" ]; then
  printf '%s' "$PROMPT_ON_STDIN" | ${TIMEOUT_CMD[@]+"${TIMEOUT_CMD[@]}"} {INVOCATION} > "$LOG_FILE" 2> "$ERR_FILE"; echo $? > "$DONE_FILE"
else
  ${TIMEOUT_CMD[@]+"${TIMEOUT_CMD[@]}"} {INVOCATION} > "$LOG_FILE" 2> "$ERR_FILE"; echo $? > "$DONE_FILE"
fi
```

`ERR_FILE` and `DONE_FILE` derive from `LOG_FILE`, so the one printed path is enough for later calls. After a background launch, wait with bounded foreground calls. Repeat this one until it prints an exit code, which is `EXIT_CODE` (each call blocks about 9 minutes; lower the count if your harness caps a foreground command sooner):

```bash
DONE_FILE="${LOG_FILE}.exit"   # in a new shell, assign LOG_FILE from the printed value first
for i in $(seq 1 55); do [ -f "$DONE_FILE" ] && break; sleep 10; done; [ -f "$DONE_FILE" ] && cat "$DONE_FILE" || echo "STILL_RUNNING"
```

On `STILL_RUNNING`, issue the same call again straight away; tail `$LOG_FILE` between calls only if you need a progress signal. Do not end your turn while a CLI is in flight. A notification when a background task exits only reaches a top-level interactive session; inside a sub-agent (a `/do:next --swarm` worker, any background agent), ending the turn terminates the run and loses the result. The polling loop is correct in both contexts, so use it everywhere.

Stderr stays out of `$LOG_FILE` (`2> "$ERR_FILE"`, never `2>&1`). Every CLI writes banners, auth notices, progress and update nags to stderr, and callers parse `$LOG_FILE` strictly. A `124` exit from `timeout`/`gtimeout`, or an empty log after the poll gave up, means the run passed 30 minutes: a failed pass, never a clean one.

### Verify and restore

Run this after the CLI exits, before reading its result. It reloads the snapshot state, restores git metadata with shell tools before any Git command can consult a planted key or hook, then compares the other four artifacts and, on a mismatch, restores the caller's whole pre-pass state from the snapshot. The restore is wholesale because path-by-path cleanup has had destructive edge cases: a mixed reset unstages the caller's work, `git checkout --` does nothing to staged content, and a stash misses untracked files.

```bash
# In a new shell, first assign the two values Snapshot printed: RUN_STATE_DIR=… RUN_STATE_SUM=…
if [ -z "${RUN_STATE_DIR:-}" ] || [ ! -f "$RUN_STATE_DIR/lib.sh" ] || [ ! -f "$RUN_STATE_DIR/state.sh" ] ||
   [ "$(cat "$RUN_STATE_DIR/lib.sh" "$RUN_STATE_DIR/state.sh" | shasum -a 256 | cut -d' ' -f1)" != "${RUN_STATE_SUM:-}" ]; then
  echo "cannot verify: snapshot state is missing or was altered during the pass" >&2
  exit 1   # never continue on a tree you could not verify
fi
. "$RUN_STATE_DIR/state.sh"
. "$RUN_STATE_DIR/lib.sh"
if [ ! -d "$GIT_COMMON" ] || [ ! -d "$GIT_META_BAK" ] || [ ! -f "$GIT_COMMON/config" ] || [ ! -f "$GIT_META_BAK/config" ] || [ ! -f "$GIT_META_BAK/hooks.tar" ]; then
  echo "cannot restore git metadata: snapshot paths unavailable" >&2
  exit 1
fi
case "$GIT_COMMON" in
  /) echo "cannot restore git metadata: invalid saved common-dir path" >&2; exit 1 ;;
  /*) ;;
  *) echo "cannot restore git metadata: saved common-dir path is not absolute" >&2; exit 1 ;;
esac
GIT_CFG_CURRENT=$(GIT_SEC_FILE="$GIT_COMMON/config" git_sec_hash) && GIT_HOOKS_CURRENT=$(git_hooks_hash) || {
  echo "cannot inspect git metadata; stop before running Git" >&2
  exit 1
}
if [ "$GIT_CFG_CURRENT" != "$GIT_CFG_BASELINE" ]; then
  # Restore ONLY the security-relevant keys, before any Git command can consult them: drop every such
  # key now in the live file, then re-add the snapshot's. Everything else (notably other agents'
  # [branch "x"] sections) is concurrent activity and is left exactly as it is.
  while IFS= read -r -d '' key; do
    git config --file "$GIT_COMMON/config" --unset-all -- "$key" || [ $? -eq 5 ] || exit 1
  done < <(git config --file "$GIT_COMMON/config" --null --name-only --get-regexp "$GIT_SEC_KEYS")
  while IFS= read -r -d '' rec; do
    case "$rec" in
      *$'\n'*) git config --file "$GIT_COMMON/config" --add -- "${rec%%$'\n'*}" "${rec#*$'\n'}" || exit 1 ;;
      *) echo "cannot restore valueless config key ${rec}; stop before running Git" >&2; exit 1 ;;
    esac
  done < <(git config --file "$GIT_META_BAK/config" --null --get-regexp "$GIT_SEC_KEYS")
  GIT_CFG_CURRENT=$(GIT_SEC_FILE="$GIT_COMMON/config" git_sec_hash) || exit 1
  if [ "$GIT_CFG_CURRENT" != "$GIT_CFG_BASELINE" ]; then
    echo "git config restore failed; stop before running Git" >&2
    exit 1
  fi
fi
if [ "$GIT_HOOKS_CURRENT" != "$GIT_HOOKS_BASELINE" ]; then
  rm -rf "$GIT_COMMON/hooks" || exit 1
  if [ -s "$GIT_META_BAK/hooks.tar" ]; then
    tar -xpf "$GIT_META_BAK/hooks.tar" -C "$GIT_COMMON" || exit 1
  fi
  GIT_HOOKS_CURRENT=$(git_hooks_hash) || exit 1
  if [ "$GIT_HOOKS_CURRENT" != "$GIT_HOOKS_BASELINE" ]; then
    echo "git hooks restore failed; stop before running Git" >&2
    exit 1
  fi
fi
# Informational only: other worktrees' branch.* (or any non-security) config writes during the pass.
if [ "$(git config --file "$GIT_META_BAK/config" --list | sort)" != "$(git config --file "$GIT_COMMON/config" --list | sort)" ]; then
  echo "note: non-security git config changed during the pass (likely a concurrent worktree); left untouched" >&2
fi
# Metadata is back at baseline, so Git is safe to run. Compare the tree; restore it wholesale if it moved.
TREE_STATE=clean
if ! tree_matches; then
  # HEAD: --soft only. --mixed would wipe the caller's staged state; --hard would destroy
  # uncommitted work swept into the CLI's commit.
  [ "$(git -C "$REPO_ROOT" rev-parse HEAD)" = "$HEAD_BASELINE" ] || git -C "$REPO_ROOT" reset --soft "$HEAD_BASELINE"
  git -C "$REPO_ROOT" read-tree "$INDEX_TREE"
  git -C "$REPO_ROOT" restore --source="${SNAPSHOT:-$HEAD_BASELINE}" --worktree -- .
  # Untracked: remove the whole non-ignored set, then put the snapshot back. No filename parsing.
  git -C "$REPO_ROOT" clean -fdq -- . && tar -xpf "$UNTRACKED_TAR" -C "$REPO_ROOT"
  if tree_matches; then TREE_STATE=restored; else TREE_STATE=restore-failed; fi
fi
# Gitignored files are outside the snapshot (hashing node_modules/ or build output has no size
# bound), so they only get a cheap modified-during-the-pass check.
find "$REPO_ROOT" -path "$REPO_ROOT/.git" -prune -o -type f -newer "$MTIME_STAMP" -print0 2>/dev/null |
  git -C "$REPO_ROOT" check-ignore -z --stdin 2>/dev/null | tr '\0' '\n' |
  sed 's/^/local CLI modified gitignored file (not auto-restorable; inspect before committing or running): /'
echo "TREE_STATE=$TREE_STATE"
[ "$TREE_STATE" != restore-failed ] || exit 1
```

The block prints one of three results:

- `TREE_STATE=clean` — the CLI left the tree alone.
- `TREE_STATE=restored` — the CLI wrote to the tree and the snapshot was put back. The caller decides what that means for its status.
- `TREE_STATE=restore-failed`, or any earlier `cannot …`/`… failed` exit — the tree is not at baseline. The caller stops with a warning naming the log and never continues on top of that tree.

A gitignored-file warning (`.env`, a local generated config) names a file this runner cannot put back; surface it in the caller's report. `RUN_STATE_DIR` can be deleted once the pass's result has been read.
