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
STAGE_DIR=""
# Scratch area for Claude files. Keeping downloads out of the final tree means
# a failed transfer never publishes raw or partial content before rewriting.
CLAUDE_STAGE_DIR=""
# Scratch copy of src/settings-hooks.js, the module this script calls instead of
# re-implementing settings.json registration.
MOD_DIR=""
# The temp file atomic_write is currently filling, so an interrupted install
# does not strand a .slashdo-tmp.* file next to the real command files.
ACTIVE_TMP=""
cleanup_temp() {
  [ -n "$ACTIVE_TMP" ] && rm -f "$ACTIVE_TMP"
  [ -n "$STAGE_DIR" ] && rm -rf "$STAGE_DIR"
  [ -n "$CLAUDE_STAGE_DIR" ] && rm -rf "$CLAUDE_STAGE_DIR"
  [ -n "$MOD_DIR" ] && rm -rf "$MOD_DIR"
  return 0
}
trap cleanup_temp EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Run a writer command against a temp file in the destination directory, then
# rename it into place. Writing straight to the final path (curl -o "$dest",
# sed > "$dest") truncates it up front, so a failed or interrupted transfer
# would leave a broken file installed over a previously working one.
# Usage: atomic_write <destination> <writer> [args...]   (the writer receives
# the temp path as its final argument)
atomic_write() {
  local dest="$1"
  shift
  local tmp mode
  tmp="$(mktemp "$(dirname "$dest")/.slashdo-tmp.XXXXXX")" || return 1
  ACTIVE_TMP="$tmp"
  # mktemp creates the file 0600; restore the mode a plain create would have
  # produced under the user's umask, so staging neither loosens nor tightens
  # what curl -o / cp used to write directly.
  mode="$(printf '%04o' "$(( 0666 & ~0$(umask) ))")"
  if "$@" "$tmp" && chmod "$mode" "$tmp" && mv -f "$tmp" "$dest"; then
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
rewrite_for_claude() {
  local quoted_root escaped_root
  if [ "$CLAUDE_CONFIG_CUSTOM" != true ]; then
    cp "$1" "$2"
    return
  fi
  quoted_root=$(printf '%s' "$CLAUDE_CONFIG_DIR" | sed "s/'/'\\\\''/g")
  quoted_root="'$quoted_root'"
  escaped_root=$(printf '%s' "$quoted_root" | sed 's/[&|\\]/\\&/g')
  sed -e "s|~/.claude/|$escaped_root/|g" \
      -e "s|~/.claude\([^A-Za-z0-9_-]\)|$escaped_root\1|g" \
      -e "s|~/.claude$|$escaped_root|g" "$1" > "$2"
}

# Rewrite lib-path cross-references and the config-path token so commands and
# libs resolve under OpenCode at runtime (mirrors npm's transformLib).
# Usage: rewrite_for_opencode <source> <destination>
rewrite_for_opencode() {
  sed -e 's|~/.claude/lib/|~/.config/opencode/lib/|g' \
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

COMMANDS=(
  better better-swift config depfree fpr goals help next omd
  plan-task pr pr-better prd push release replan review rpr scan simplify update
)


OLD_COMMANDS=(cam good makegoals makegood optimize-md)

# NOTE: keep this allowlist in sync with files under lib/ in the repo. Any new
# lib/*.md that a command spec references (e.g. via `!cat ~/.claude/lib/<name>.md`)
# MUST be added here AND to uninstall.sh, or the curl installer will silently skip
# it and the command will fail at runtime. The npm installer (src/installer.js)
# enumerates lib/ dynamically, so it doesn't need updating.
LIBS=(
  better-cleanup better-pr-and-ci better-review-loop better-verification
  ci-flake-handling code-review-checklist copilot-review-loop
  empty-array-expansion enhance-loop epic-children
  finding-disposition fix-regression-guard
  gh-host github-reviewer-loop graphql-escaping
  local-agent-review-loop model-tiers multi-reviewer-loop next-swarm ollama-review-loop
  per-finding-root-cause plan-id-format plan-issue-mode
  post-review-doc-recommendations remediation-agent-template
  review-agent-selection review-config-defaults review-convergence-gate
  swift-review-checklist swift-gotchas
  review-surface-scan review-surface-quality review-security-audit
  review-cross-file-tracing review-cross-file-contract
  review-structural-ambition
)

HOOKS=(slashdo-check-update slashdo-statusline)

# install.sh leaves a copy of the shared module here so uninstall.sh can
# deregister without a network round trip. Mirrors SETTINGS_HOOKS_CACHE in
# src/settings-hooks.js.
SETTINGS_HOOKS_CACHE=".slashdo-settings-hooks.js"

OLD_HOOKS=(update-check)

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
  if ! CLAUDE_STAGE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/slashdo-claude.XXXXXX")"; then
    printf "    ${YELLOW}failed (could not create a temp directory)${RESET}\n"
    return 1
  fi
  mkdir -p "$target_cmd" "$target_lib" "$target_hooks"

  printf "  Installing to ${GREEN}Claude Code${RESET}...\n"

  for cmd in "${COMMANDS[@]}"; do
    printf "    /do:%-20s" "$cmd"
    if fetch_file "commands/do/$cmd.md" "$CLAUDE_STAGE_DIR/command-$cmd.md" &&
        atomic_write "$target_cmd/$cmd.md" rewrite_for_claude "$CLAUDE_STAGE_DIR/command-$cmd.md"; then
      printf "${GREEN}ok${RESET}\n"
    else
      printf "failed\n"
    fi
    rm -f "$CLAUDE_STAGE_DIR/command-$cmd.md"
  done

  for lib in "${LIBS[@]}"; do
    printf "    lib/%-20s" "$lib.md"
    if fetch_file "lib/$lib.md" "$CLAUDE_STAGE_DIR/lib-$lib.md" &&
        atomic_write "$target_lib/$lib.md" rewrite_for_claude "$CLAUDE_STAGE_DIR/lib-$lib.md"; then
      printf "${GREEN}ok${RESET}\n"
    else
      printf "failed\n"
    fi
    rm -f "$CLAUDE_STAGE_DIR/lib-$lib.md"
  done

  for hook in "${HOOKS[@]}"; do
    printf "    hook/%-19s" "$hook.js"
    if fetch_file "hooks/$hook.js" "$CLAUDE_STAGE_DIR/hook-$hook.js" &&
        atomic_write "$target_hooks/$hook.js" cp "$CLAUDE_STAGE_DIR/hook-$hook.js"; then
      printf "${GREEN}ok${RESET}\n"
    else
      printf "failed\n"
      hooks_ready=false
    fi
    rm -f "$CLAUDE_STAGE_DIR/hook-$hook.js"
  done

  for old in "${OLD_COMMANDS[@]}"; do
    if [ -f "$target_cmd/$old.md" ]; then
      rm -f "$target_cmd/$old.md"
      printf "    migrated: /do:%-14s${GREEN}ok${RESET}\n" "$old"
    fi
  done

  for old in "${OLD_HOOKS[@]}"; do
    if [ -f "$target_hooks/$old.md" ]; then
      rm -f "$target_hooks/$old.md"
      printf "    removed:  hook/%-13s${GREEN}ok${RESET}\n" "$old.md"
    fi
  done

  # Register hooks in settings.json by calling the canonical implementation —
  # src/settings-hooks.js, the same module the npm installer requires — instead
  # of hand-translating it into shell-embedded JS that drifts (issue #166).
  # Deriving the paths, hook list, and auto-update default there too is
  # deliberate: doing it here would just move the drift onto the arguments.
  if [ "$hooks_ready" = true ] && command -v node &>/dev/null &&
     [ -f "$target_hooks/slashdo-check-update.js" ] &&
     [ -f "$target_hooks/slashdo-statusline.js" ]; then
    MOD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/slashdo-mod.XXXXXX")" || MOD_DIR=""
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

  if [ "$registration_failed" = true ]; then
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
  if ! STAGE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/slashdo-install.XXXXXX")"; then
    printf "    ${YELLOW}skipped (could not create a temp directory)${RESET}\n"
    return 1
  fi

  for cmd in "${COMMANDS[@]}"; do
    printf "    /do-%-20s" "$cmd"
    if fetch_file "commands/do/$cmd.md" "$STAGE_DIR/$cmd.md"; then
      if ! atomic_write "$target_cmd/do-$cmd.md" rewrite_for_opencode "$STAGE_DIR/$cmd.md"; then
        rm -f "$STAGE_DIR/$cmd.md"
        return 1
      fi
      printf "${GREEN}ok${RESET}\n"
    else
      printf "failed\n"
    fi
    rm -f "$STAGE_DIR/$cmd.md"
  done

  for lib in "${LIBS[@]}"; do
    printf "    lib/%-20s" "$lib.md"
    if fetch_file "lib/$lib.md" "$STAGE_DIR/lib-$lib.md"; then
      if ! atomic_write "$target_lib/$lib.md" rewrite_for_opencode "$STAGE_DIR/lib-$lib.md"; then
        rm -f "$STAGE_DIR/lib-$lib.md"
        return 1
      fi
      printf "${GREEN}ok${RESET}\n"
    else
      printf "failed\n"
    fi
    rm -f "$STAGE_DIR/lib-$lib.md"
  done

  for old in "${OLD_COMMANDS[@]}"; do
    if [ -f "$target_cmd/do-$old.md" ]; then
      rm -f "$target_cmd/do-$old.md"
      printf "    migrated: /do-%-14s${GREEN}ok${RESET}\n" "$old"
    fi
  done
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
