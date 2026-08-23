#!/usr/bin/env bash
# slashdo — curl-based uninstaller
# Usage: curl -fsSL https://raw.githubusercontent.com/atomantic/slashdo/main/uninstall.sh | bash
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
  printf "  ${DIM}slashdo — uninstaller${RESET}\n"
  printf "\n"
}

COMMANDS=(
  better better-swift config depfree fpr goals help next omd
  plan-task pr pr-better prd push release replan review rpr scan simplify update
)


OLD_COMMANDS=(cam good makegoals makegood optimize-md)

# NOTE: keep in sync with install.sh LIBS — see comment there.
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

uninstall_claude() {
  local target_cmd="$HOME/.claude/commands/do"
  local target_lib="$HOME/.claude/lib"
  local target_hooks="$HOME/.claude/hooks"
  local count=0

  printf "  Uninstalling from ${GREEN}Claude Code${RESET}...\n"

  # Deregister from settings.json FIRST, using the canonical src/settings-hooks.js
  # — the same module the npm uninstaller requires (see install.sh). This runs
  # before any file is removed: if the fetch or node call fails, settings.json
  # must not be left referencing hooks that are already gone.
  if command -v node &>/dev/null; then
    if fetch_file "src/settings-hooks.js" "$MOD_DIR/settings-hooks.js"; then
      local node_result
      if node_result=$(node -e '
        const settingsHooks = require(process.argv[1]);
        for (const action of settingsHooks.removeDefaultHooks(false)) {
          process.stdout.write(settingsHooks.formatAction(action) + "\n");
        }
      ' "$MOD_DIR/settings-hooks.js" 2>"$MOD_DIR/node.err"); then
        print_settings_actions "$node_result"
      else
        printf "    ${YELLOW}settings.json deregistration failed — leaving hook files in place${RESET}\n"
        sed -e 's/^/      /' "$MOD_DIR/node.err" >&2
        return 1
      fi
    else
      printf "    ${YELLOW}settings.json: could not fetch src/settings-hooks.js — leaving hook files in place${RESET}\n"
      printf "    ${DIM}(settings.json still references them; re-run with network access or from a checkout)${RESET}\n"
      return 1
    fi
  fi

  for cmd in "${COMMANDS[@]}" "${OLD_COMMANDS[@]}"; do
    if [ -f "$target_cmd/$cmd.md" ]; then
      rm -f "$target_cmd/$cmd.md"
      printf "    removed: /do:%-18s${GREEN}ok${RESET}\n" "$cmd"
      count=$((count + 1))
    fi
  done

  for lib in "${LIBS[@]}"; do
    if [ -f "$target_lib/$lib.md" ]; then
      rm -f "$target_lib/$lib.md"
      printf "    removed: lib/%-18s${GREEN}ok${RESET}\n" "$lib.md"
      count=$((count + 1))
    fi
  done

  for hook in "${HOOKS[@]}"; do
    if [ -f "$target_hooks/$hook.js" ]; then
      rm -f "$target_hooks/$hook.js"
      printf "    removed: hook/%-17s${GREEN}ok${RESET}\n" "$hook.js"
      count=$((count + 1))
    fi
  done

  for old in "${OLD_HOOKS[@]}"; do
    if [ -f "$target_hooks/$old.md" ]; then
      rm -f "$target_hooks/$old.md"
      printf "    removed: hook/%-17s${GREEN}ok${RESET}\n" "$old.md"
      count=$((count + 1))
    fi
  done

  # Remove cache file
  if [ -f "$HOME/.claude/cache/slashdo-update-check.json" ]; then
    rm -f "$HOME/.claude/cache/slashdo-update-check.json"
    printf "    removed: cache/slashdo-update-check.json ${GREEN}ok${RESET}\n"
    count=$((count + 1))
  fi

  if [ -f "$HOME/.claude/.slashdo-version" ]; then
    rm -f "$HOME/.claude/.slashdo-version"
    printf "    removed: .slashdo-version        ${GREEN}ok${RESET}\n"
    count=$((count + 1))
  fi

  if [ -f "$HOME/.claude/.slashdo-config.json" ]; then
    rm -f "$HOME/.claude/.slashdo-config.json"
    printf "    removed: .slashdo-config.json    ${GREEN}ok${RESET}\n"
    count=$((count + 1))
  fi

  if [ $count -eq 0 ]; then
    printf "    ${DIM}nothing to remove${RESET}\n"
  else
    printf "    ${GREEN}$count files removed${RESET}\n"
  fi
}

uninstall_opencode() {
  local target_cmd="$HOME/.config/opencode/commands"
  local target_lib="$HOME/.config/opencode/lib"
  local count=0

  printf "  Uninstalling from ${GREEN}OpenCode${RESET}...\n"

  for cmd in "${COMMANDS[@]}" "${OLD_COMMANDS[@]}"; do
    if [ -f "$target_cmd/do-$cmd.md" ]; then
      rm -f "$target_cmd/do-$cmd.md"
      printf "    removed: /do-%-18s${GREEN}ok${RESET}\n" "$cmd"
      count=$((count + 1))
    fi
  done

  for lib in "${LIBS[@]}"; do
    if [ -f "$target_lib/$lib.md" ]; then
      rm -f "$target_lib/$lib.md"
      printf "    removed: lib/%-18s${GREEN}ok${RESET}\n" "$lib.md"
      count=$((count + 1))
    fi
  done

  if [ -f "$HOME/.config/opencode/.slashdo-config.json" ]; then
    rm -f "$HOME/.config/opencode/.slashdo-config.json"
    printf "    removed: .slashdo-config.json    ${GREEN}ok${RESET}\n"
    count=$((count + 1))
  fi

  if [ $count -eq 0 ]; then
    printf "    ${DIM}nothing to remove${RESET}\n"
  else
    printf "    ${GREEN}$count files removed${RESET}\n"
  fi
}

uninstall_antigravity() {
  # Antigravity installs each command as an Agent Skill directory
  # (~/.gemini/antigravity-cli/skills/do-<cmd>/SKILL.md), so removal is a
  # directory delete — no content inlining needed, unlike install.
  local target_skills="$HOME/.gemini/antigravity-cli/skills"
  local count=0

  printf "  Uninstalling from ${GREEN}Antigravity CLI${RESET}...\n"

  for cmd in "${COMMANDS[@]}" "${OLD_COMMANDS[@]}"; do
    if [ -d "$target_skills/do-$cmd" ]; then
      rm -rf "$target_skills/do-$cmd"
      printf "    removed: /do-%-18s${GREEN}ok${RESET}\n" "$cmd"
      count=$((count + 1))
    fi
  done

  if [ -f "$HOME/.gemini/antigravity-cli/.slashdo-version" ]; then
    rm -f "$HOME/.gemini/antigravity-cli/.slashdo-version"
    printf "    removed: .slashdo-version        ${GREEN}ok${RESET}\n"
    count=$((count + 1))
  fi

  if [ -f "$HOME/.gemini/antigravity-cli/.slashdo-config.json" ]; then
    rm -f "$HOME/.gemini/antigravity-cli/.slashdo-config.json"
    printf "    removed: .slashdo-config.json    ${GREEN}ok${RESET}\n"
    count=$((count + 1))
  fi

  if [ $count -eq 0 ]; then
    printf "    ${DIM}nothing to remove${RESET}\n"
  else
    printf "    ${GREEN}$count items removed${RESET}\n"
  fi
}

# Shared cleanup for directory-namespaced Agent Skills environments (Codex, Grok
# Build): each command is installed as ~/.<env>/skills/do-<cmd>/SKILL.md, so
# removal is a directory delete — the same shape as Antigravity, just a different
# parent tree. Args: <display name> <env parent dir> (skills live under it).
uninstall_agent_skills() {
  local label="$1"
  local parent="$2"
  local target_skills="$parent/skills"
  local count=0

  printf "  Uninstalling from ${GREEN}%s${RESET}...\n" "$label"

  for cmd in "${COMMANDS[@]}" "${OLD_COMMANDS[@]}"; do
    if [ -d "$target_skills/do-$cmd" ]; then
      rm -rf "$target_skills/do-$cmd"
      printf "    removed: /do-%-18s${GREEN}ok${RESET}\n" "$cmd"
      count=$((count + 1))
    fi
  done

  if [ -f "$parent/.slashdo-version" ]; then
    rm -f "$parent/.slashdo-version"
    printf "    removed: .slashdo-version        ${GREEN}ok${RESET}\n"
    count=$((count + 1))
  fi

  if [ -f "$parent/.slashdo-config.json" ]; then
    rm -f "$parent/.slashdo-config.json"
    printf "    removed: .slashdo-config.json    ${GREEN}ok${RESET}\n"
    count=$((count + 1))
  fi

  if [ $count -eq 0 ]; then
    printf "    ${DIM}nothing to remove${RESET}\n"
  else
    printf "    ${GREEN}$count items removed${RESET}\n"
  fi
}

uninstall_gemini_legacy() {
  # Cleans up files installed by slashdo < 3.3 under the legacy Gemini CLI path.
  local target_cmd="$HOME/.gemini/commands/do"
  local target_lib="$HOME/.gemini/lib"
  local count=0

  printf "  Uninstalling legacy ${GREEN}Gemini CLI${RESET} files...\n"

  for cmd in "${COMMANDS[@]}" "${OLD_COMMANDS[@]}"; do
    if [ -f "$target_cmd/$cmd.md" ]; then
      rm -f "$target_cmd/$cmd.md"
      printf "    removed: /do:%-18s${GREEN}ok${RESET}\n" "$cmd"
      count=$((count + 1))
    fi
  done

  for lib in "${LIBS[@]}"; do
    if [ -f "$target_lib/$lib.md" ]; then
      rm -f "$target_lib/$lib.md"
      printf "    removed: lib/%-18s${GREEN}ok${RESET}\n" "$lib.md"
      count=$((count + 1))
    fi
  done

  if [ -f "$HOME/.gemini/.slashdo-version" ]; then
    rm -f "$HOME/.gemini/.slashdo-version"
    printf "    removed: .slashdo-version        ${GREEN}ok${RESET}\n"
    count=$((count + 1))
  fi

  if [ $count -eq 0 ]; then
    printf "    ${DIM}nothing to remove${RESET}\n"
  else
    printf "    ${GREEN}$count files removed${RESET}\n"
  fi
}

detect_envs() {
  local envs=()
  [ -d "$HOME/.claude" ] && envs+=(claude)
  [ -d "$HOME/.config/opencode" ] && envs+=(opencode)
  [ -d "$HOME/.gemini/antigravity-cli" ] && envs+=(antigravity)
  [ -d "$HOME/.codex" ] && envs+=(codex)
  [ -d "$HOME/.grok" ] && envs+=(grok)
  # Detect legacy Gemini CLI install (slashdo < 3.3) for migration cleanup.
  [ -d "$HOME/.gemini/commands/do" ] && envs+=(gemini-legacy)
  [ ${#envs[@]} -gt 0 ] && printf '%s\n' "${envs[@]}"
}

banner

envs=($(detect_envs)) || true

if [ ${#envs[@]} -eq 0 ]; then
  printf "  No AI coding environments found. Nothing to uninstall.\n\n"
  exit 0
fi

printf "  Detected: ${GREEN}%s${RESET}\n\n" "${envs[*]}"

claude_incomplete=false

for env in "${envs[@]}"; do
  case "$env" in
    claude)        uninstall_claude || claude_incomplete=true ;;
    opencode)      uninstall_opencode ;;
    antigravity)   uninstall_antigravity ;;
    codex)         uninstall_agent_skills "Codex" "$HOME/.codex" ;;
    grok)          uninstall_agent_skills "Grok Build" "$HOME/.grok" ;;
    gemini-legacy) uninstall_gemini_legacy ;;
  esac
  printf "\n"
done

if [ "$claude_incomplete" = true ]; then
  printf "  ${YELLOW}Incomplete:${RESET} settings.json could not be updated, so slashdo's hook files\n"
  printf "  were left in place rather than stranding settings.json entries that point at\n"
  printf "  deleted files. Re-run this script once Node.js and the source are reachable.\n\n"
  exit 1
fi

printf "  ${GREEN}Done!${RESET} All slashdo commands have been removed.\n"
printf "  ${DIM}To reinstall: curl -fsSL https://raw.githubusercontent.com/atomantic/slashdo/main/install.sh | bash${RESET}\n\n"
