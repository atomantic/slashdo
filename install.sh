#!/usr/bin/env bash
# slashdo — curl-based installer (no npm required)
# Usage: curl -fsSL https://raw.githubusercontent.com/atomantic/slashdo/main/install.sh | bash
# shellcheck disable=SC2059,SC2207
set -euo pipefail

REPO="atomantic/slashdo"
BRANCH="main"
BASE_URL="https://raw.githubusercontent.com/$REPO/$BRANCH"

# Claude Code supports relocating its entire config tree. Keep every installer
# path on the same root the hooks and statusline resolve at runtime.
CLAUDE_CONFIG_CUSTOM=false
if [ -n "${CLAUDE_CONFIG_DIR:-}" ]; then
  CLAUDE_CONFIG_CUSTOM=true
else
  CLAUDE_CONFIG_DIR="$HOME/.claude"
fi

# Detect local repo: if this script lives alongside commands/ and lib/, use local
# files. BASH_SOURCE is unset when the script is piped (`curl ... | bash`, the
# documented install path): under `set -u` that kills the command substitution
# and leaves SCRIPT_DIR pointing at the caller's CWD, so a piped install run
# from any directory that happens to hold commands/do/ and lib/ would install
# those files instead of fetching from GitHub.
SCRIPT_DIR=""
if [ -n "${BASH_SOURCE[0]:-}" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi
LOCAL_MODE=false
if [ -n "$SCRIPT_DIR" ] && [ -d "$SCRIPT_DIR/commands/do" ] && [ -d "$SCRIPT_DIR/lib" ]; then
  LOCAL_MODE=true
fi

# Private staging area for the OpenCode rewrite step. Fixed /tmp names race
# under concurrent installs and are pre-creatable by any other local user, so
# every temp path this script touches is randomized and cleaned up on exit.
# Staged files are left for that one exit-time `rm -rf` instead of being
# removed one `rm` process per file.
STAGE_DIR=""
# Scratch area for Claude files. Keeping downloads out of the final tree means
# a failed transfer never publishes raw or partial content before rewriting.
CLAUDE_STAGE_DIR=""
# Scratch copy of src/settings-hooks.js, the module this script calls instead of
# re-implementing settings.json registration.
MOD_DIR=""
# Downloaded copy of install-manifest.txt (remote mode only).
MANIFEST_TMP=""
# The temp file atomic_write is currently filling, so an interrupted install
# does not strand a .slashdo-tmp.* file next to the real command files.
ACTIVE_TMP=""
cleanup_temp() {
  [ -n "$ACTIVE_TMP" ] && rm -f "$ACTIVE_TMP"
  [ -n "$MANIFEST_TMP" ] && rm -f "$MANIFEST_TMP"
  [ -n "$STAGE_DIR" ] && rm -rf "$STAGE_DIR"
  [ -n "$CLAUDE_STAGE_DIR" ] && rm -rf "$CLAUDE_STAGE_DIR"
  [ -n "$MOD_DIR" ] && rm -rf "$MOD_DIR"
  return 0
}
trap cleanup_temp EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Defer cancellation until mktemp's pathname is registered with cleanup_temp.
# The allocator inherits ignored signals so a process-group signal cannot kill
# it after creation but before stdout returns. The parent still records that
# signal and exits immediately after reaping the allocator and owning its path.
# Usage: allocate_temp <cleanup-variable> [mktemp arguments...]
allocate_temp() {
  local variable="$1" allocated="" status=0 pending_signal=0
  shift
  trap 'pending_signal=130' INT
  trap 'pending_signal=143' TERM
  allocated="$(trap '' INT TERM; mktemp "$@")" || status=$?
  printf -v "$variable" '%s' "$allocated"
  trap 'exit 130' INT
  trap 'exit 143' TERM
  if [ "$pending_signal" -ne 0 ]; then exit "$pending_signal"; fi
  return "$status"
}

# mktemp creates files 0600; atomic_write restores the mode a plain create would
# have produced under the user's umask, so staging neither loosens nor tightens
# what curl -o / cp used to write directly. The umask never changes while this
# script runs, so the mode is derived once here rather than in two subshells
# per installed file.
FILE_MODE="$(printf '%04o' "$(( 0666 & ~0$(umask) ))")"

# Run a writer command against a temp file in the destination directory, then
# rename it into place. Writing straight to the final path (curl -o "$dest",
# sed > "$dest") truncates it up front, so a failed or interrupted transfer
# would leave a broken file installed over a previously working one.
# Usage: atomic_write <destination> <writer> [args...]   (the writer receives
# the temp path as its final argument)
atomic_write() {
  local dest="$1"
  shift
  local tmp dir=.
  # Parameter expansion, not $(dirname): one fork fewer per installed file.
  case "$dest" in */*) dir="${dest%/*}"; dir="${dir:-/}" ;; esac
  allocate_temp ACTIVE_TMP "$dir/.slashdo-tmp.XXXXXX" || return 1
  tmp="$ACTIVE_TMP"
  if "$@" "$tmp" && chmod "$FILE_MODE" "$tmp" && mv -f "$tmp" "$dest"; then
    ACTIVE_TMP=""
    return 0
  fi
  rm -f "$tmp"
  ACTIVE_TMP=""
  return 1
}

# Copy a repo file locally, or download it from GitHub, into <destination>.
# Usage: fetch_into <repo_relative_path> <destination>
fetch_into() {
  local src_path="$1"
  local dest="$2"
  if [ "$LOCAL_MODE" = true ] && [ -f "$SCRIPT_DIR/$src_path" ]; then
    cp "$SCRIPT_DIR/$src_path" "$dest" 2>/dev/null && return 0
  fi
  # Fallback to curl (remote mode, or local cp failed)
  curl -fsSL "$BASE_URL/$src_path" -o "$dest" 2>/dev/null
}

# Fetch a file: local cp if available, otherwise curl from GitHub
# Usage: fetch_file <repo_relative_path> <destination>
fetch_file() {
  atomic_write "$2" fetch_into "$1"
}

# Source command/lib docs use Claude's default root as a portable token. For a
# custom root, rewrite every runtime reference and shell-quote the root so the
# generated snippets handle whitespace and metacharacters.
# Usage: rewrite_for_claude <source> <destination>
# Preserve literal regex anchors and Markdown backticks.
# shellcheck disable=SC2016
REQUIRED_READ_REWRITE='s|^!read lib/\([A-Za-z0-9._-]*\.md\)$|Read `~/.claude/lib/\1` before performing this step; required when this step applies.|'
rewrite_for_claude() {
  local quoted_root escaped_root
  if [ "$CLAUDE_CONFIG_CUSTOM" != true ]; then
    sed -e "$REQUIRED_READ_REWRITE" "$1" > "$2"
    return
  fi
  quoted_root=$(printf '%s' "$CLAUDE_CONFIG_DIR" | sed "s/'/'\\\\''/g")
  quoted_root="'$quoted_root'"
  escaped_root=$(printf '%s' "$quoted_root" | sed 's/[&|\\]/\\&/g')
  sed -e "$REQUIRED_READ_REWRITE" \
      -e "s|~/.claude/|$escaped_root/|g" \
      -e "s|~/.claude\([^A-Za-z0-9_-]\)|$escaped_root\1|g" \
      -e "s|~/.claude$|$escaped_root|g" "$1" > "$2"
}

# Rewrite lib-path cross-references and the config-path token so commands and
# libs resolve under OpenCode at runtime (mirrors npm's transformLib).
# Usage: rewrite_for_opencode <source> <destination>
rewrite_for_opencode() {
  sed -e "$REQUIRED_READ_REWRITE" \
      -e 's|~/.claude/lib/|~/.config/opencode/lib/|g' \
      -e 's|~/.claude/commands/do/\([A-Za-z0-9._-][A-Za-z0-9._-]*\)\.md|~/.config/opencode/commands/do-\1.md|g' \
      -e 's|~/.claude/.slashdo-config.json|~/.config/opencode/.slashdo-config.json|g' \
      "$1" > "$2"
}

CYAN='\033[0;36m'
YELLOW='\033[0;33m'
GREEN='\033[0;32m'
DIM='\033[2m'
RESET='\033[0m'

# Print one line per action src/settings-hooks.js reported. The severity is a
# token the module emits, so this never re-infers it from the message text.
print_settings_actions() {
  local line
  while IFS= read -r line; do
    case "$line" in
      "warn "*) printf "    ${YELLOW}%s${RESET}\n" "${line#warn }" ;;
      "ok "*)   printf "    ${GREEN}%s${RESET}\n" "${line#ok }" ;;
      *)        if [ -n "$line" ]; then printf "    %s\n" "$line"; fi ;;
    esac
  done <<< "$1"
}

banner() {
  printf "\n"
  printf "  ${CYAN}    ██╗${YELLOW}██████╗  ██████╗ ${RESET}\n"
  printf "  ${CYAN}   ██╔╝${YELLOW}██╔══██╗██╔═══██╗${RESET}\n"
  printf "  ${CYAN}  ██╔╝ ${YELLOW}██║  ██║██║   ██║${RESET}\n"
  printf "  ${CYAN} ██╔╝  ${YELLOW}██║  ██║██║   ██║${RESET}\n"
  printf "  ${CYAN}██╔╝   ${YELLOW}██████╔╝╚██████╔╝${RESET}\n"
  printf "  ${CYAN}╚═╝    ${YELLOW}╚═════╝  ╚═════╝ ${RESET}\n"
  printf "  ${DIM}slashdo — curated slash commands for AI coding assistants${RESET}\n"
  printf "\n"
}

# ── install manifest ── (this block is identical in install.sh and uninstall.sh)
#
# Which commands, libs and hooks ship, and which files earlier releases shipped
# that must be cleaned up, come from install-manifest.txt, generated from the
# tree by `node scripts/build-install-manifest.js`. Entries are bare filenames
# with their extension, grouped under [commands], [libs], [hooks] and their
# [retired-*] counterparts.
MANIFEST_FILE="install-manifest.txt"
MANIFEST_FORMAT="# slashdo install manifest v1"
# Copy left in each installed environment's root, so uninstall.sh can find
# everything a past install put there without a network round trip.
MANIFEST_CACHE=".slashdo-install-manifest.txt"
COMMANDS=()
LIBS=()
HOOKS=()
OLD_COMMANDS=()
OLD_LIBS=()
OLD_HOOKS=()

# Append one manifest's entries to the arrays above. The scripts build cp, mv
# and rm paths from these names, so anything but a bare filename under a known
# section rejects the whole manifest instead of being skipped, and nothing from
# a rejected manifest is kept.
# Usage: read_manifest <file> <label for messages>
read_manifest() {
  local file="$1" label="$2" line section="" entry
  local entries=()
  if ! IFS= read -r line < "$file" || [ "${line%$'\r'}" != "$MANIFEST_FORMAT" ]; then
    printf "    ${YELLOW}%s: not a v1 slashdo install manifest${RESET}\n" "$label"
    return 1
  fi
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    case "$line" in
      ''|'#'*) continue ;;
      '['*']')
        section="${line#[}"
        section="${section%]}"
        case "$section" in
          commands|libs|hooks|retired-commands|retired-libs|retired-hooks) continue ;;
        esac
        printf "    ${YELLOW}%s: unknown section %s${RESET}\n" "$label" "$line"
        return 1
        ;;
      .*|*[!A-Za-z0-9._-]*)
        printf "    ${YELLOW}%s: invalid entry %s${RESET}\n" "$label" "$line"
        return 1
        ;;
    esac
    case "$section" in
      '')
        printf "    ${YELLOW}%s: entry %s precedes any section${RESET}\n" "$label" "$line"
        return 1
        ;;
      commands|retired-commands)
        case "$line" in
          *.md) ;;
          *) printf "    ${YELLOW}%s: command %s is not a .md file${RESET}\n" "$label" "$line"; return 1 ;;
        esac
        ;;
    esac
    entries+=("$section/$line")
  done < "$file"
  for entry in ${entries[@]+"${entries[@]}"}; do
    case "${entry%%/*}" in
      commands)         COMMANDS+=("${entry#*/}") ;;
      libs)             LIBS+=("${entry#*/}") ;;
      hooks)            HOOKS+=("${entry#*/}") ;;
      retired-commands) OLD_COMMANDS+=("${entry#*/}") ;;
      retired-libs)     OLD_LIBS+=("${entry#*/}") ;;
      retired-hooks)    OLD_HOOKS+=("${entry#*/}") ;;
    esac
  done
}
# ── end install manifest ──

# install.sh leaves a copy of the shared module here so uninstall.sh can
# deregister without a network round trip. Mirrors SETTINGS_HOOKS_CACHE in
# src/settings-hooks.js.
SETTINGS_HOOKS_CACHE=".slashdo-settings-hooks.js"

detect_envs() {
  local envs=()
  { [ "$CLAUDE_CONFIG_CUSTOM" = true ] || [ -d "$CLAUDE_CONFIG_DIR" ]; } && envs+=(claude)
  [ -d "$HOME/.config/opencode" ] && envs+=(opencode)
  [ -d "$HOME/.gemini/antigravity-cli" ] && envs+=(antigravity)
  [ -d "$HOME/.codex" ] && envs+=(codex)
  [ -d "$HOME/.grok" ] && envs+=(grok)
  [ ${#envs[@]} -gt 0 ] && printf '%s\n' "${envs[@]}"
}

install_claude() {
  local target_cmd="$CLAUDE_CONFIG_DIR/commands/do"
  local target_lib="$CLAUDE_CONFIG_DIR/lib"
  local target_hooks="$CLAUDE_CONFIG_DIR/hooks"
  local registration_failed=false
  local hooks_ready=true
  local files_failed=false
  if ! allocate_temp CLAUDE_STAGE_DIR -d "${TMPDIR:-/tmp}/slashdo-claude.XXXXXX"; then
    printf "    ${YELLOW}failed (could not create a temp directory)${RESET}\n"
    return 1
  fi
  mkdir -p "$target_cmd" "$target_lib" "$target_hooks"

  printf "  Installing to ${GREEN}Claude Code${RESET}...\n"

  local file
  for file in "${COMMANDS[@]}"; do
    printf "    /do:%-20s" "${file%.md}"
    if fetch_file "commands/do/$file" "$CLAUDE_STAGE_DIR/command-$file" &&
        atomic_write "$target_cmd/$file" rewrite_for_claude "$CLAUDE_STAGE_DIR/command-$file"; then
      printf "${GREEN}ok${RESET}\n"
    else
      printf "failed\n"
      files_failed=true
    fi
  done

  for file in "${LIBS[@]}"; do
    printf "    lib/%-20s" "$file"
    if fetch_file "lib/$file" "$CLAUDE_STAGE_DIR/lib-$file" &&
        atomic_write "$target_lib/$file" rewrite_for_claude "$CLAUDE_STAGE_DIR/lib-$file"; then
      printf "${GREEN}ok${RESET}\n"
    else
      printf "failed\n"
      files_failed=true
    fi
  done

  for file in "${HOOKS[@]}"; do
    printf "    hook/%-19s" "$file"
    if fetch_file "hooks/$file" "$CLAUDE_STAGE_DIR/hook-$file" &&
        atomic_write "$target_hooks/$file" cp "$CLAUDE_STAGE_DIR/hook-$file"; then
      printf "${GREEN}ok${RESET}\n"
    else
      printf "failed\n"
      hooks_ready=false
    fi
  done

  for file in ${OLD_COMMANDS[@]+"${OLD_COMMANDS[@]}"}; do
    if [ -f "$target_cmd/$file" ]; then
      rm -f "$target_cmd/$file"
      printf "    migrated: /do:%-14s${GREEN}ok${RESET}\n" "${file%.md}"
    fi
  done

  for file in ${OLD_LIBS[@]+"${OLD_LIBS[@]}"}; do
    if [ -f "$target_lib/$file" ]; then
      rm -f "$target_lib/$file"
      printf "    removed:  lib/%-14s${GREEN}ok${RESET}\n" "$file"
    fi
  done

  for file in ${OLD_HOOKS[@]+"${OLD_HOOKS[@]}"}; do
    if [ -f "$target_hooks/$file" ]; then
      rm -f "$target_hooks/$file"
      printf "    removed:  hook/%-13s${GREEN}ok${RESET}\n" "$file"
    fi
  done

  cache_manifest "$CLAUDE_CONFIG_DIR"

  # Register hooks in settings.json by calling the canonical implementation —
  # src/settings-hooks.js, the same module the npm installer requires — instead
  # of hand-translating it into shell-embedded JS that drifts (issue #166).
  # Deriving the paths, hook list, and auto-update default there too is
  # deliberate: doing it here would just move the drift onto the arguments.
  if [ "$hooks_ready" = true ] && command -v node &>/dev/null &&
     [ -f "$target_hooks/slashdo-check-update.js" ] &&
     [ -f "$target_hooks/slashdo-statusline.js" ]; then
    allocate_temp MOD_DIR -d "${TMPDIR:-/tmp}/slashdo-mod.XXXXXX" || MOD_DIR=""
    if [ -n "$MOD_DIR" ] && fetch_file "src/settings-hooks.js" "$MOD_DIR/settings-hooks.js"; then
      # Keep a copy beside the hooks so uninstall.sh can deregister offline.
      if ! cp "$MOD_DIR/settings-hooks.js" "$target_hooks/$SETTINGS_HOOKS_CACHE" 2>/dev/null; then
        printf "    ${YELLOW}note: could not cache settings-hooks.js — uninstall will need network access${RESET}\n"
      fi

      local node_result
      if node_result=$(node -e '
        const settingsHooks = require(process.argv[1]);
        for (const action of settingsHooks.applyDefaultHooks(false)) {
          process.stdout.write(settingsHooks.formatAction(action) + "\n");
        }
      ' "$MOD_DIR/settings-hooks.js" 2>"$MOD_DIR/node.err"); then
        print_settings_actions "$node_result"
      else
        printf "    ${YELLOW}settings.json: failed — hooks installed but not registered${RESET}\n"
        # Surface why: an opaque "failed" on a permission or syntax error is
        # what makes a broken curl install impossible to diagnose.
        if [ -s "$MOD_DIR/node.err" ]; then sed -e 's/^/      /' "$MOD_DIR/node.err" >&2; fi
        registration_failed=true
      fi
    else
      printf "    ${YELLOW}settings.json: could not fetch src/settings-hooks.js — hooks installed but not registered${RESET}\n"
      registration_failed=true
    fi
  elif command -v node &>/dev/null; then
    printf "    ${DIM}settings.json: skipped (hook files not found)${RESET}\n"
    registration_failed=true
  else
    printf "    ${DIM}settings.json: skipped (node not found — hooks installed but not registered)${RESET}\n"
    registration_failed=true
  fi

  if [ "$registration_failed" = true ] || [ "$files_failed" = true ]; then
    return 1
  fi
}

install_opencode() {
  local target_cmd="$HOME/.config/opencode/commands"
  local target_lib="$HOME/.config/opencode/lib"
  mkdir -p "$target_cmd" "$target_lib"

  printf "  Installing to ${GREEN}OpenCode${RESET}...\n"

  # Stage downloads in a private, randomized directory (removed by the EXIT
  # trap) rather than fixed /tmp/slashdo-* names another local user could
  # pre-create or a concurrent install could clobber.
  if ! allocate_temp STAGE_DIR -d "${TMPDIR:-/tmp}/slashdo-install.XXXXXX"; then
    printf "    ${YELLOW}skipped (could not create a temp directory)${RESET}\n"
    return 1
  fi

  local file failed=false
  for file in "${COMMANDS[@]}"; do
    printf "    /do-%-20s" "${file%.md}"
    if fetch_file "commands/do/$file" "$STAGE_DIR/command-$file"; then
      if ! atomic_write "$target_cmd/do-$file" rewrite_for_opencode "$STAGE_DIR/command-$file"; then
        return 1
      fi
      printf "${GREEN}ok${RESET}\n"
    else
      printf "failed\n"
      failed=true
    fi
  done

  for file in "${LIBS[@]}"; do
    printf "    lib/%-20s" "$file"
    if fetch_file "lib/$file" "$STAGE_DIR/lib-$file"; then
      if ! atomic_write "$target_lib/$file" rewrite_for_opencode "$STAGE_DIR/lib-$file"; then
        return 1
      fi
      printf "${GREEN}ok${RESET}\n"
    else
      printf "failed\n"
      failed=true
    fi
  done

  for file in ${OLD_COMMANDS[@]+"${OLD_COMMANDS[@]}"}; do
    if [ -f "$target_cmd/do-$file" ]; then
      rm -f "$target_cmd/do-$file"
      printf "    migrated: /do-%-14s${GREEN}ok${RESET}\n" "${file%.md}"
    fi
  done

  for file in ${OLD_LIBS[@]+"${OLD_LIBS[@]}"}; do
    if [ -f "$target_lib/$file" ]; then
      rm -f "$target_lib/$file"
      printf "    removed:  lib/%-14s${GREEN}ok${RESET}\n" "$file"
    fi
  done

  cache_manifest "$HOME/.config/opencode"
  [ "$failed" = false ]
}

# Read the manifest before touching any environment, so a failed fetch aborts
# with nothing changed. In local mode it is the checkout's own copy. Otherwise
# it comes from the same $BASE_URL ref as this script and every file it names.
# They are still separate requests, so a push landing in between can pair this
# script with a newer manifest: the format line catches an incompatible one,
# and a listed file that will not download is reported and fails the install
# instead of being skipped.
MANIFEST_SRC=""
load_manifest() {
  if [ "$LOCAL_MODE" = true ]; then
    MANIFEST_SRC="$SCRIPT_DIR/$MANIFEST_FILE"
    if [ ! -f "$MANIFEST_SRC" ]; then
      printf "  ${YELLOW}%s is missing from %s${RESET}\n" "$MANIFEST_FILE" "$SCRIPT_DIR"
      return 1
    fi
  else
    if ! allocate_temp MANIFEST_TMP "${TMPDIR:-/tmp}/slashdo-manifest.XXXXXX"; then
      printf "  ${YELLOW}could not create a temp file for %s${RESET}\n" "$MANIFEST_FILE"
      return 1
    fi
    if ! fetch_into "$MANIFEST_FILE" "$MANIFEST_TMP"; then
      printf "  ${YELLOW}failed to download %s${RESET}\n" "$BASE_URL/$MANIFEST_FILE"
      return 1
    fi
    MANIFEST_SRC="$MANIFEST_TMP"
  fi
  read_manifest "$MANIFEST_SRC" "$MANIFEST_FILE" || return 1
  if [ ${#COMMANDS[@]} -eq 0 ] || [ ${#LIBS[@]} -eq 0 ] || [ ${#HOOKS[@]} -eq 0 ]; then
    printf "  ${YELLOW}%s lists no commands, libs or hooks${RESET}\n" "$MANIFEST_FILE"
    return 1
  fi
}

# Leave a copy of the manifest in an environment's root for uninstall.sh. A
# failure only costs offline uninstall, so it is a note, not an install failure.
# Usage: cache_manifest <environment root>
cache_manifest() {
  if ! atomic_write "$1/$MANIFEST_CACHE" cp "$MANIFEST_SRC"; then
    printf "    ${YELLOW}note: could not cache %s — uninstall will need network access${RESET}\n" "$MANIFEST_FILE"
  fi
}

banner

envs=($(detect_envs)) || true

if [ ${#envs[@]} -eq 0 ]; then
  printf "  No supported AI coding environments detected.\n"
  printf "  Supported: Claude Code, OpenCode, Antigravity CLI, Codex, Grok Build\n\n"
  printf "  Create %s to enable Claude Code support, then re-run.\n" "$CLAUDE_CONFIG_DIR"
  exit 1
fi

if [ "$LOCAL_MODE" = true ]; then
  printf "  Source: ${GREEN}local${RESET} (${DIM}$SCRIPT_DIR${RESET})\n"
else
  printf "  Source: ${GREEN}github${RESET} (${DIM}$BASE_URL${RESET})\n"
fi
printf "  Detected: ${GREEN}%s${RESET}\n\n" "${envs[*]}"

case " ${envs[*]} " in
  *" claude "*|*" opencode "*)
    if ! load_manifest; then
      printf "  ${YELLOW}Install aborted:${RESET} could not read the file list (%s); nothing was changed.\n\n" "$MANIFEST_FILE"
      exit 1
    fi
    ;;
esac

npx_needed=false
curl_installed=false
install_failed=false
for env in "${envs[@]}"; do
  case "$env" in
    claude)      if install_claude; then curl_installed=true; else install_failed=true; fi ;;
    opencode)    if install_opencode; then curl_installed=true; else install_failed=true; fi ;;
    antigravity) printf "  ${DIM}Antigravity CLI: use 'npx slash-do@latest --env antigravity' (Agent Skills require Node.js for content inlining)${RESET}\n"; npx_needed=true ;;
    codex)       printf "  ${DIM}Codex: use 'npx slash-do@latest --env codex' (requires Node.js for content inlining)${RESET}\n"; npx_needed=true ;;
    grok)        printf "  ${DIM}Grok Build: use 'npx slash-do@latest --env grok' (requires Node.js for content inlining)${RESET}\n"; npx_needed=true ;;
  esac
  printf "\n"
done

if [ "$install_failed" = true ]; then
  printf "  ${YELLOW}Install incomplete:${RESET} one or more environments could not be installed.\n"
  exit 1
fi

if [ "$curl_installed" = true ]; then
  printf "  ${GREEN}Done!${RESET} Commands are available as /do:<name> in your AI coding assistant.\n"
fi
if [ "$npx_needed" = true ]; then
  printf "  ${DIM}(Antigravity / Codex / Grok Build users: run the npx command above to complete installation.)${RESET}\n"
fi
printf "\n"
