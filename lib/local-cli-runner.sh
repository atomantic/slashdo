#!/usr/bin/env bash
# slashdo local CLI runner: bounds, launches and waits on a headless reviewer or
# enhancer CLI, and keeps it from changing the caller's working tree. The
# contract (when to call each subcommand, what each printed value means) is
# lib/local-cli-runner.md. Invoke it as `bash <path> <subcommand>`, never
# through the executable bit.
#
#   snapshot                               print RUN_STATE_DIR=… RUN_STATE_SUM=…
#   verify --state-dir DIR --sum SUM       print TREE_STATE=clean|restored|restore-failed
#   launch --tag TAG -- COMMAND [ARG…]     print LOG_FILE=…, run COMMAND bounded at 30 min
#   wait --log LOG_FILE [--seconds N]      print the exit code, or STILL_RUNNING
#
# verify also reads RUN_STATE_DIR and RUN_STATE_SUM from the environment when the
# options are absent. Every "cannot …" or "… failed" message exits non-zero.
#
# The CLI being supervised is untrusted and runs inside the repository. Nothing
# this script relies on between snapshot and verify may live there: snapshot
# refuses to run when this file or its state directory is inside the working
# tree, and verify refuses state whose checksum does not match the value
# snapshot printed (the checksum covers every backup verify restores from).
#
# Portable to macOS bash 3.2 with BSD userland and to GNU userland.

set -u

die() {
  printf '%s\n' "$1" >&2
  exit 1
}

sha256() { shasum -a 256 | cut -d' ' -f1; }
file_sha256() { shasum -a 256 < "$1" | cut -d' ' -f1; }

# Keys that can execute code or redirect where data goes. GIT_COMMON is shared by
# every linked worktree, so other agents legitimately write to its config during a
# pass (a `git push -u` adds a [branch "x"] section); fingerprint and restore only
# these keys, never the whole file.
GIT_SEC_KEYS='^(core\.(hookspath|fsmonitor|pager|editor|sshcommand|askpass|gitproxy)|alias\..+|include\..+|includeif\..+|filter\..+|diff\..+|merge\..+\.driver|(diff|merge)tool\..+\.cmd|pager\..+|credential\..+|remote\..+\.(url|pushurl|uploadpack|receivepack|vcs|proxy)|http\..*proxy|core\.attributesfile|url\..+\.(insteadof|pushinsteadof)|gpg\.(.+\.)?program|sequence\.editor|interactive\.difffilter|trailer\..+\.(cmd|command)|core\.alternaterefscommand|uploadpack\.packobjectshook|submodule\..+\.(update|url)|browser\..+\.(cmd|path)|web\.browser)$'

# `git config --file` reads only the named file, so no repo config (aliases,
# pager, fsmonitor) is consulted. Sorted by key, so a restore that re-creates a
# section elsewhere still matches; each key's values keep file order
# (credential.helper order matters). git exit 1 means "no matching key".
git_sec_hash() {   # $1 = config file
  (set -o pipefail
   { git config --file "$1" --null --name-only --get-regexp "$GIT_SEC_KEYS"; [ $? -le 1 ]; } | tr '\0' '\n' | LC_ALL=C sort -u |
     while IFS= read -r k; do printf '%s\0' "$k"; git config --file "$1" --null --get-all -- "$k" || exit 1; done | sha256)
}

# Fingerprint what can execute, never archive metadata: a sorted, NUL-delimited
# listing of every path with its type, executable bit (`-x`, the same
# access(X_OK) test Git applies), and content hash (symlink target for links).
# mtimes, owners and tar headers are excluded, so a restore that only changes
# timestamps verifies clean.
git_hooks_hash() {
  if [ -d "$GIT_COMMON/hooks" ]; then
    (set -o pipefail; cd "$GIT_COMMON" || exit 1
     find hooks -print0 | LC_ALL=C sort -z |
       while IFS= read -r -d '' p; do
         if [ -L "$p" ]; then printf 'l\0%s\0%s\0' "$p" "$(readlink "$p")"
         elif [ -d "$p" ]; then printf 'd\0%s\0' "$p"
         elif [ -f "$p" ]; then
           if [ -x "$p" ]; then x=x; else x=n; fi
           h=$(file_sha256 "$p") || exit 1
           printf 'f\0%s\0%s\0%s\0' "$p" "$x" "$h"
         else printf 'o\0%s\0' "$p"; fi
       done | sha256)
  else
    echo "no-hooks-dir"
  fi
}

# The NUL-delimited file list feeds tar directly; hashing the archive
# fingerprints every path, file type, mode, content, and symlink target without
# splitting names on newlines.
untracked_manifest_hash() {
  (set -o pipefail; git -C "$REPO_ROOT" ls-files --others --exclude-standard -z | tar -C "$REPO_ROOT" --null -T - -cf - | sha256)
}

tree_matches() {   # HEAD, index, tracked diff, untracked content, against the saved baselines
  [ "$(git -C "$REPO_ROOT" rev-parse HEAD)" = "$HEAD_BASELINE" ] &&
  [ "$(git -C "$REPO_ROOT" write-tree)" = "$INDEX_TREE" ] &&
  [ "$(git -C "$REPO_ROOT" diff HEAD | git hash-object --stdin)" = "$DIFF_BASELINE" ] &&
  [ "$(untracked_manifest_hash)" = "$UNTRACKED_BASELINE" ]
}

physical_dir() { (cd "$1" 2>/dev/null && pwd -P); }

# True when directory $1 is $REPO_ROOT or inside it.
inside_repo() {
  case "$1/" in "$REPO_ROOT"/*) return 0 ;; esac
  return 1
}

SELF_DIR="$(physical_dir "$(dirname "${BASH_SOURCE[0]}")")" || SELF_DIR=""

cmd_snapshot() {
  local top
  top="$(git rev-parse --show-toplevel 2>/dev/null)" && REPO_ROOT="$(physical_dir "$top")" && [ -n "$REPO_ROOT" ] ||
    die "cannot snapshot: not inside a git working tree"
  [ -n "$SELF_DIR" ] || die "cannot snapshot: cannot locate the runner script"
  ! inside_repo "$SELF_DIR" || die "cannot snapshot: the runner is installed inside the working tree it protects ($SELF_DIR)"
  # An explicit template, not -t: BSD mktemp -t can ignore TMPDIR, GNU treats its argument differently.
  RUN_STATE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/cli-run.XXXXXX")" && RUN_STATE_DIR="$(physical_dir "$RUN_STATE_DIR")" && [ -n "$RUN_STATE_DIR" ] ||
    die "cannot create snapshot state"
  ! inside_repo "$RUN_STATE_DIR" || die "cannot snapshot: the temp directory is inside the working tree ($RUN_STATE_DIR); set TMPDIR elsewhere"

  HEAD_BASELINE=$(git -C "$REPO_ROOT" rev-parse HEAD) || die "cannot snapshot HEAD"
  INDEX_TREE=$(git -C "$REPO_ROOT" write-tree) || die "cannot snapshot the index"   # caller's staged state
  # Catches edits to ALREADY-dirty tracked files, which `git status` would not.
  DIFF_BASELINE=$(set -o pipefail; git -C "$REPO_ROOT" diff HEAD | git hash-object --stdin) || die "cannot fingerprint tracked changes"
  SNAPSHOT=$(git -C "$REPO_ROOT" stash create) || die "cannot snapshot the worktree"   # '' when clean
  UNTRACKED_TAR="$RUN_STATE_DIR/untracked.tar"
  (set -o pipefail; git -C "$REPO_ROOT" ls-files --others --exclude-standard -z | tar -C "$REPO_ROOT" --null -T - -cf "$UNTRACKED_TAR" 2>/dev/null) ||
    die "cannot snapshot untracked files"
  UNTRACKED_BASELINE=$(untracked_manifest_hash) || die "cannot fingerprint untracked files"
  MTIME_STAMP="$RUN_STATE_DIR/stamp"
  : > "$MTIME_STAMP" || die "cannot create snapshot state"   # gitignored-file detection window

  # A planted hook or core.hooksPath/fsmonitor/pager/alias in the config runs on the next git command.
  # --git-common-dir may print a path relative to the repository root, so resolve it from there.
  GIT_COMMON="$(cd "$REPO_ROOT" && physical_dir "$(git rev-parse --git-common-dir)")" && [ -n "$GIT_COMMON" ] ||
    die "cannot locate git metadata"
  GIT_META_BAK="$RUN_STATE_DIR/gitmeta"
  mkdir "$GIT_META_BAK" || die "cannot snapshot git metadata"
  cp -p "$GIT_COMMON/config" "$GIT_META_BAK/config" || die "cannot snapshot git metadata"
  { tar -cf "$GIT_META_BAK/hooks.tar" -C "$GIT_COMMON" hooks 2>/dev/null; } || : > "$GIT_META_BAK/hooks.tar"
  GIT_CFG_BASELINE=$(git_sec_hash "$GIT_COMMON/config") || die "cannot fingerprint git metadata"
  GIT_HOOKS_BASELINE=$(git_hooks_hash) || die "cannot fingerprint git metadata"

  # Verify restores from these three backups, so their hashes go into the
  # checksummed state: a backup rewritten during the pass is refused, not used.
  UNTRACKED_TAR_SUM=$(file_sha256 "$UNTRACKED_TAR") || die "cannot fingerprint snapshot state"
  META_CONFIG_SUM=$(file_sha256 "$GIT_META_BAK/config") || die "cannot fingerprint snapshot state"
  HOOKS_TAR_SUM=$(file_sha256 "$GIT_META_BAK/hooks.tar") || die "cannot fingerprint snapshot state"

  # The checksum goes to the caller, not to disk: verify refuses a state file
  # the CLI rewrote instead of sourcing it.
  printf '%s=%q\n' REPO_ROOT "$REPO_ROOT" HEAD_BASELINE "$HEAD_BASELINE" INDEX_TREE "$INDEX_TREE" \
    DIFF_BASELINE "$DIFF_BASELINE" SNAPSHOT "$SNAPSHOT" UNTRACKED_TAR "$UNTRACKED_TAR" \
    UNTRACKED_BASELINE "$UNTRACKED_BASELINE" MTIME_STAMP "$MTIME_STAMP" GIT_COMMON "$GIT_COMMON" \
    GIT_META_BAK "$GIT_META_BAK" GIT_CFG_BASELINE "$GIT_CFG_BASELINE" GIT_HOOKS_BASELINE "$GIT_HOOKS_BASELINE" \
    UNTRACKED_TAR_SUM "$UNTRACKED_TAR_SUM" META_CONFIG_SUM "$META_CONFIG_SUM" HOOKS_TAR_SUM "$HOOKS_TAR_SUM" \
    > "$RUN_STATE_DIR/state.sh" || die "cannot write snapshot state"
  RUN_STATE_SUM="$(file_sha256 "$RUN_STATE_DIR/state.sh")" || die "cannot write snapshot state"
  echo "RUN_STATE_DIR=$RUN_STATE_DIR RUN_STATE_SUM=$RUN_STATE_SUM"
}

# Restore ONLY the security-relevant keys, before any Git command can consult
# them: drop every such key now in the live file, then re-add the snapshot's.
# Everything else (notably other agents' [branch "x"] sections) is concurrent
# activity and is left exactly as it is.
restore_git_config() {
  local key rec
  while IFS= read -r -d '' key; do
    git config --file "$GIT_COMMON/config" --unset-all -- "$key" || [ $? -eq 5 ] ||
      die "git config restore failed; stop before running Git"
  done < <(git config --file "$GIT_COMMON/config" --null --name-only --get-regexp "$GIT_SEC_KEYS")
  while IFS= read -r -d '' rec; do
    case "$rec" in
      *$'\n'*) git config --file "$GIT_COMMON/config" --add -- "${rec%%$'\n'*}" "${rec#*$'\n'}" ||
                 die "git config restore failed; stop before running Git" ;;
      *) die "cannot restore valueless config key ${rec}; stop before running Git" ;;
    esac
  done < <(git config --file "$GIT_META_BAK/config" --null --get-regexp "$GIT_SEC_KEYS")
  [ "$(git_sec_hash "$GIT_COMMON/config")" = "$GIT_CFG_BASELINE" ] ||
    die "git config restore failed; stop before running Git"
  echo "note: restored security-relevant git config changed during the pass" >&2
}

restore_git_hooks() {
  rm -rf "$GIT_COMMON/hooks" || die "git hooks restore failed; stop before running Git"
  if [ -s "$GIT_META_BAK/hooks.tar" ]; then
    tar -xpf "$GIT_META_BAK/hooks.tar" -C "$GIT_COMMON" || die "git hooks restore failed; stop before running Git"
  fi
  [ "$(git_hooks_hash)" = "$GIT_HOOKS_BASELINE" ] || die "git hooks restore failed; stop before running Git"
  echo "note: restored git hooks changed during the pass" >&2
}

cmd_verify() {
  local state_dir="${RUN_STATE_DIR:-}" sum="${RUN_STATE_SUM:-}" cfg_now hooks_now
  while [ $# -gt 0 ]; do
    case "$1" in
      --state-dir) [ $# -ge 2 ] || die "cannot verify: --state-dir needs a value"; state_dir="$2"; shift 2 ;;
      --sum) [ $# -ge 2 ] || die "cannot verify: --sum needs a value"; sum="$2"; shift 2 ;;
      *) die "cannot verify: unknown option $1" ;;
    esac
  done
  if [ -z "$state_dir" ] || [ -z "$sum" ] || [ ! -f "$state_dir/state.sh" ] ||
     [ "$(file_sha256 "$state_dir/state.sh")" != "$sum" ]; then
    die "cannot verify: snapshot state is missing or was altered during the pass"   # never continue on an unverified tree
  fi
  # shellcheck source=/dev/null
  . "$state_dir/state.sh"
  if [ ! -f "$UNTRACKED_TAR" ] || [ ! -f "$GIT_META_BAK/config" ] || [ ! -f "$GIT_META_BAK/hooks.tar" ] ||
     [ "$(file_sha256 "$UNTRACKED_TAR")" != "$UNTRACKED_TAR_SUM" ] ||
     [ "$(file_sha256 "$GIT_META_BAK/config")" != "$META_CONFIG_SUM" ] ||
     [ "$(file_sha256 "$GIT_META_BAK/hooks.tar")" != "$HOOKS_TAR_SUM" ]; then
    die "cannot verify: snapshot state is missing or was altered during the pass"
  fi
  case "$GIT_COMMON" in
    /) die "cannot restore git metadata: invalid saved common-dir path" ;;
    /*) ;;
    *) die "cannot restore git metadata: saved common-dir path is not absolute" ;;
  esac
  if [ ! -d "$GIT_COMMON" ] || [ ! -f "$GIT_COMMON/config" ]; then
    die "cannot restore git metadata: snapshot paths unavailable"
  fi

  # Metadata first, with shell tools and `git config --file` only.
  cfg_now=$(git_sec_hash "$GIT_COMMON/config") || die "cannot inspect git metadata; stop before running Git"
  hooks_now=$(git_hooks_hash) || die "cannot inspect git metadata; stop before running Git"
  [ "$cfg_now" = "$GIT_CFG_BASELINE" ] || restore_git_config
  [ "$hooks_now" = "$GIT_HOOKS_BASELINE" ] || restore_git_hooks
  # Informational only: other worktrees' branch.* (or any non-security) config writes during the pass.
  if [ "$(git config --file "$GIT_META_BAK/config" --list | sort)" != "$(git config --file "$GIT_COMMON/config" --list | sort)" ]; then
    echo "note: non-security git config changed during the pass (likely a concurrent worktree); left untouched" >&2
  fi

  # Metadata is back at baseline, so Git is safe to run. Compare the tree; restore it wholesale if it moved.
  TREE_STATE=clean
  if ! tree_matches; then
    # HEAD: --soft only. --mixed would wipe the caller's staged state; --hard
    # would destroy uncommitted work swept into the CLI's commit.
    [ "$(git -C "$REPO_ROOT" rev-parse HEAD)" = "$HEAD_BASELINE" ] || git -C "$REPO_ROOT" reset -q --soft "$HEAD_BASELINE"
    git -C "$REPO_ROOT" read-tree "$INDEX_TREE"
    git -C "$REPO_ROOT" restore --source="${SNAPSHOT:-$HEAD_BASELINE}" --worktree -- .
    # Untracked: remove the whole non-ignored set, then put the snapshot back. No filename parsing.
    git -C "$REPO_ROOT" clean -fdq -- . && tar -xpf "$UNTRACKED_TAR" -C "$REPO_ROOT"
    if tree_matches; then TREE_STATE=restored; else TREE_STATE=restore-failed; fi
  fi
  # Gitignored files are outside the snapshot (hashing node_modules/ or build
  # output has no size bound), so they only get a cheap modified-during-the-pass check.
  find "$REPO_ROOT" -path "$REPO_ROOT/.git" -prune -o -type f -newer "$MTIME_STAMP" -print0 2>/dev/null |
    git -C "$REPO_ROOT" check-ignore -z --stdin 2>/dev/null | tr '\0' '\n' |
    sed 's/^/local CLI modified gitignored file (not auto-restorable; inspect before committing or running): /'
  echo "TREE_STATE=$TREE_STATE"
  [ "$TREE_STATE" != restore-failed ] || exit 1
}

cmd_launch() {
  local tag="" log err done_file rc
  local timeout_cmd=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --tag) [ $# -ge 2 ] || die "cannot launch: --tag needs a value"; tag="$2"; shift 2 ;;
      --) shift; break ;;
      *) die "cannot launch: unknown option $1 (put the command after --)" ;;
    esac
  done
  case "$tag" in
    ''|*[!A-Za-z0-9._-]*) die "cannot launch: --tag must be a non-empty [A-Za-z0-9._-] name" ;;
  esac
  [ $# -gt 0 ] || die "cannot launch: no command after --"
  # Stock macOS has neither; running unbounded is supported there (the CLI's own limits apply).
  if command -v timeout >/dev/null 2>&1; then timeout_cmd=(timeout 1800)
  elif command -v gtimeout >/dev/null 2>&1; then timeout_cmd=(gtimeout 1800); fi
  log="$(mktemp "${TMPDIR:-/tmp}/$tag.XXXXXX")" || die "cannot launch: cannot create the log file"
  err="$log.err"
  done_file="$log.exit"
  echo "LOG_FILE=$log"
  # Stdin is inherited, so a prompt piped into this script reaches the CLI.
  # Stderr stays out of the log: callers parse it strictly.
  ${timeout_cmd[@]+"${timeout_cmd[@]}"} "$@" > "$log" 2> "$err"
  rc=$?
  echo "$rc" > "$done_file"
  exit "$rc"
}

cmd_wait() {
  local log="" seconds=540 waited=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --log) [ $# -ge 2 ] || die "cannot wait: --log needs a value"; log="$2"; shift 2 ;;
      --seconds) [ $# -ge 2 ] || die "cannot wait: --seconds needs a value"; seconds="$2"; shift 2 ;;
      *) die "cannot wait: unknown option $1" ;;
    esac
  done
  [ -n "$log" ] || die "cannot wait: --log is required"
  case "$seconds" in ''|*[!0-9]*) die "cannot wait: --seconds must be a whole number" ;; esac
  while [ ! -f "$log.exit" ] && [ "$waited" -lt "$seconds" ]; do
    sleep 10
    waited=$((waited + 10))
  done
  if [ -f "$log.exit" ]; then cat "$log.exit"; else echo "STILL_RUNNING"; fi
}

case "${1:-}" in
  snapshot) shift; cmd_snapshot "$@" ;;
  verify)   shift; cmd_verify "$@" ;;
  launch)   shift; cmd_launch "$@" ;;
  wait)     shift; cmd_wait "$@" ;;
  *) die "usage: bash local-cli-runner.sh snapshot | verify --state-dir DIR --sum SUM | launch --tag TAG -- COMMAND… | wait --log LOG_FILE [--seconds N]" ;;
esac
