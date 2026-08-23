#!/usr/bin/env bash
# slashdo — curl-based installer (no npm required)
# Usage: curl -fsSL https://raw.githubusercontent.com/atomantic/slashdo/main/install.sh | bash
# shellcheck disable=SC2059,SC2207
set -euo pipefail

REPO="atomantic/slashdo"
BRANCH="main"
BASE_URL="https://raw.githubusercontent.com/$REPO/$BRANCH"

# Detect a local repo: only when this script is a real file on disk that sits
# alongside commands/ and lib/. Piped into bash (the documented curl usage)
# BASH_SOURCE[0] is unset, so ${BASH_SOURCE[0]:-} must be guarded — an
# unguarded expansion both trips `set -u` and resolves SCRIPT_DIR to the
# caller's cwd, which would let a stray ./src or ./commands tree next to the
# user's shell supply the files this script installs and executes.
SCRIPT_PATH="${BASH_SOURCE[0]:-}"
SCRIPT_DIR=""
if [ -n "$SCRIPT_PATH" ] && [ -f "$SCRIPT_PATH" ]; then
  SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
fi
LOCAL_MODE=false
if [ -n "$SCRIPT_DIR" ] && [ -d "$SCRIPT_DIR/commands/do" ] && [ -d "$SCRIPT_DIR/lib" ]; then
  LOCAL_MODE=true
fi

# Fetch a file: local cp if available, otherwise curl from GitHub
# Usage: fetch_file <repo_relative_path> <destination>
fetch_file() {
  local src_path="$1"
  local dest="$2"
  if [ "$LOCAL_MODE" = true ] && [ -f "$SCRIPT_DIR/$src_path" ]; then
    cp "$SCRIPT_DIR/$src_path" "$dest" 2>/dev/null && return 0
  fi
  # Fallback to curl (remote mode, or local cp failed)
  curl -fsSL "$BASE_URL/$src_path" -o "$dest" 2>/dev/null
}

# The copy of src/settings-hooks.js left in the hooks dir for uninstall.sh.
SETTINGS_HOOKS_CACHE=".slashdo-settings-hooks.js"

# Set when the commands installed but settings.json could not be updated.
install_incomplete=false

# Scratch space for src/settings-hooks.js, cleaned up however we exit.
MOD_DIR="$(mktemp -d)"
trap 'rm -rf "$MOD_DIR"' EXIT

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
  ci-flake-handling code-review-checklist copilot-review-loop
  empty-array-expansion enhance-loop epic-children
  finding-disposition fix-regression-guard
  gh-host github-reviewer-loop graphql-escaping
  local-agent-review-loop model-tiers multi-reviewer-loop ollama-review-loop
  per-finding-root-cause plan-id-format plan-issue-mode
  post-review-doc-recommendations remediation-agent-template
  review-config-defaults review-convergence-gate
  swift-review-checklist swift-gotchas
  review-surface-scan review-surface-quality review-security-audit
  review-cross-file-tracing review-cross-file-contract
  review-structural-ambition
)

HOOKS=(slashdo-check-update slashdo-statusline)

OLD_HOOKS=(update-check)

detect_envs() {
  local envs=()
  [ -d "$HOME/.claude" ] && envs+=(claude)
  [ -d "$HOME/.config/opencode" ] && envs+=(opencode)
  [ -d "$HOME/.gemini/antigravity-cli" ] && envs+=(antigravity)
  [ -d "$HOME/.codex" ] && envs+=(codex)
  [ -d "$HOME/.grok" ] && envs+=(grok)
  [ ${#envs[@]} -gt 0 ] && printf '%s\n' "${envs[@]}"
}

install_claude() {
  local target_cmd="$HOME/.claude/commands/do"
  local target_lib="$HOME/.claude/lib"
  local target_hooks="$HOME/.claude/hooks"
  mkdir -p "$target_cmd" "$target_lib" "$target_hooks"

  printf "  Installing to ${GREEN}Claude Code${RESET}...\n"

  for cmd in "${COMMANDS[@]}"; do
    printf "    /do:%-20s" "$cmd"
    if fetch_file "commands/do/$cmd.md" "$target_cmd/$cmd.md"; then
      printf "${GREEN}ok${RESET}\n"
    else
      printf "failed\n"
      install_incomplete=true
    fi
  done

  for lib in "${LIBS[@]}"; do
    printf "    lib/%-20s" "$lib.md"
    if fetch_file "lib/$lib.md" "$target_lib/$lib.md"; then
      printf "${GREEN}ok${RESET}\n"
    else
      printf "failed\n"
      install_incomplete=true
    fi
  done

  for hook in "${HOOKS[@]}"; do
    printf "    hook/%-19s" "$hook.js"
    if fetch_file "hooks/$hook.js" "$target_hooks/$hook.js"; then
      printf "${GREEN}ok${RESET}\n"
    else
      printf "failed\n"
      install_incomplete=true
    fi
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

  # Register hooks in settings.json using the canonical src/settings-hooks.js —
  # the same module the npm installer requires. Fetching it (like every other
  # file this script installs) keeps the curl path from maintaining a second,
  # hand-translated copy of the algorithm that silently drifts. Deriving the
  # paths and hook list there too is deliberate: doing it here would just move
  # the drift onto the arguments.
  if command -v node &>/dev/null &&
     { [ -f "$target_hooks/slashdo-check-update.js" ] || [ -f "$target_hooks/slashdo-statusline.js" ]; }; then
    if fetch_file "src/settings-hooks.js" "$MOD_DIR/settings-hooks.js"; then
      # Keep a copy next to the hooks: uninstall.sh needs this module to
      # deregister, and a machine that is offline (or behind a proxy that has
      # since started blocking raw.githubusercontent.com) must still be able to
      # uninstall cleanly. uninstall.sh removes it along with the hooks.
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
        # "settings.json: skipped (...)" means nothing was written at all —
        # that is not a completed install, so do not sign off on it. A
        # narrower skip (a malformed hooks key, say) still configures the
        # statusline, so those stay a successful install.
        case "$node_result" in
          *"warn settings.json: skipped"*) install_incomplete=true ;;
        esac
      else
        printf "    ${YELLOW}settings.json: failed — hooks installed but not registered${RESET}\n"
        # Surface why — an opaque "failed" on a permission or syntax error is
        # what makes a broken curl install impossible to diagnose.
        sed -e 's/^/      /' "$MOD_DIR/node.err" >&2
        install_incomplete=true
      fi
    else
      printf "    ${YELLOW}settings.json: could not fetch src/settings-hooks.js — hooks installed but not registered${RESET}\n"
      install_incomplete=true
    fi
  elif command -v node &>/dev/null; then
    printf "    ${YELLOW}settings.json: skipped (hook files not found)${RESET}\n"
    install_incomplete=true
  else
    printf "    ${YELLOW}settings.json: skipped (node not found — hooks installed but not registered)${RESET}\n"
    install_incomplete=true
  fi
}

install_opencode() {
  local target_cmd="$HOME/.config/opencode/commands"
  local target_lib="$HOME/.config/opencode/lib"
  mkdir -p "$target_cmd" "$target_lib"

  printf "  Installing to ${GREEN}OpenCode${RESET}...\n"

  for cmd in "${COMMANDS[@]}"; do
    printf "    /do-%-20s" "$cmd"
    if fetch_file "commands/do/$cmd.md" "/tmp/slashdo-$cmd.md"; then
      # Rewrite lib paths and the config-path token for OpenCode
      sed -e 's|~/.claude/lib/|~/.config/opencode/lib/|g' \
          -e 's|~/.claude/.slashdo-config.json|~/.config/opencode/.slashdo-config.json|g' \
          "/tmp/slashdo-$cmd.md" > "$target_cmd/do-$cmd.md"
      rm -f "/tmp/slashdo-$cmd.md"
      printf "${GREEN}ok${RESET}\n"
    else
      printf "failed\n"
      install_incomplete=true
    fi
  done

  for lib in "${LIBS[@]}"; do
    printf "    lib/%-20s" "$lib.md"
    if fetch_file "lib/$lib.md" "/tmp/slashdo-lib-$lib.md"; then
      # Rewrite lib-path cross-references and the config-path token so libs
      # resolve under OpenCode at runtime (mirrors the command loop and npm's
      # transformLib).
      sed -e 's|~/.claude/lib/|~/.config/opencode/lib/|g' \
          -e 's|~/.claude/.slashdo-config.json|~/.config/opencode/.slashdo-config.json|g' \
          "/tmp/slashdo-lib-$lib.md" > "$target_lib/$lib.md"
      rm -f "/tmp/slashdo-lib-$lib.md"
      printf "${GREEN}ok${RESET}\n"
    else
      printf "failed\n"
      install_incomplete=true
    fi
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
  printf "  Create ~/.claude/ to enable Claude Code support, then re-run.\n"
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
for env in "${envs[@]}"; do
  case "$env" in
    claude)      install_claude; curl_installed=true ;;
    opencode)    install_opencode; curl_installed=true ;;
    antigravity) printf "  ${DIM}Antigravity CLI: use 'npx slash-do@latest --env antigravity' (Agent Skills require Node.js for content inlining)${RESET}\n"; npx_needed=true ;;
    codex)       printf "  ${DIM}Codex: use 'npx slash-do@latest --env codex' (requires Node.js for content inlining)${RESET}\n"; npx_needed=true ;;
    grok)        printf "  ${DIM}Grok Build: use 'npx slash-do@latest --env grok' (requires Node.js for content inlining)${RESET}\n"; npx_needed=true ;;
  esac
  printf "\n"
done

if [ "$curl_installed" = true ] && [ "$install_incomplete" = false ]; then
  printf "  ${GREEN}Done!${RESET} Commands are available as /do:<name> in your AI coding assistant.\n"
elif [ "$curl_installed" = true ]; then
  printf "  ${YELLOW}Partly done.${RESET} Some files did not download, or settings.json was not\n"
  printf "  updated — see the warnings above. Re-run this script once Node.js and the\n"
  printf "  source are reachable to finish.\n"
fi
if [ "$npx_needed" = true ]; then
  printf "  ${DIM}(Antigravity / Codex / Grok Build users: run the npx command above to complete installation.)${RESET}\n"
fi
printf "\n"

[ "$install_incomplete" = false ]
