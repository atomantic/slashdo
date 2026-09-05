#!/usr/bin/env bash
# slashdo — curl-based uninstaller
# Usage: curl -fsSL https://raw.githubusercontent.com/atomantic/slashdo/main/uninstall.sh | bash
# shellcheck disable=SC2059,SC2207
set -euo pipefail

CLAUDE_CONFIG_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"

BASE_URL="https://raw.githubusercontent.com/atomantic/slashdo/main"

# Detect a local repo the same way install.sh does: BASH_SOURCE is unset when
# the script is piped (`curl ... | bash`), so guard it under `set -u` and never
# treat the caller's CWD as a checkout.
SCRIPT_DIR=""
if [ -n "${BASH_SOURCE[0]:-}" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi
LOCAL_MODE=false
if [ -n "$SCRIPT_DIR" ] && [ -d "$SCRIPT_DIR/commands/do" ] && [ -d "$SCRIPT_DIR/lib" ]; then
  LOCAL_MODE=true
fi

# Copy of src/settings-hooks.js that install.sh left beside the hooks, so an
# offline machine can still deregister. Mirrors SETTINGS_HOOKS_CACHE in that module.
SETTINGS_HOOKS_CACHE=".slashdo-settings-hooks.js"

# Scratch copy of the module, removed however we exit.
MOD_DIR=""
cleanup_temp() {
  [ -n "$MOD_DIR" ] && rm -rf "$MOD_DIR"
  return 0
}
trap cleanup_temp EXIT

# Copy a repo file locally, or download it from GitHub, into <destination>.
fetch_file() {
  local src_path="$1"
  local dest="$2"
  if [ "$LOCAL_MODE" = true ] && [ -f "$SCRIPT_DIR/$src_path" ]; then
    cp "$SCRIPT_DIR/$src_path" "$dest" 2>/dev/null && return 0
  fi
  curl -fsSL "$BASE_URL/$src_path" -o "$dest" 2>/dev/null
}

# Set by uninstall_claude when it refuses to remove files it could not deregister.
claude_incomplete=false

CYAN='\033[0;36m'
YELLOW='\033[0;33m'
GREEN='\033[0;32m'
DIM='\033[2m'
RESET='\033[0m'

# Run the deregistration through whichever copy of the module is in MOD_DIR.
run_deregister() {
  node -e '
    const settingsHooks = require(process.argv[1]);
    for (const action of settingsHooks.removeDefaultHooks(false)) {
      process.stdout.write(settingsHooks.formatAction(action) + "\n");
    }
  ' "$MOD_DIR/settings-hooks.js" 2>"$MOD_DIR/node.err"
}

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
  better-audit better-audit-architecture better-audit-bugs-perf
  better-audit-code-quality better-audit-cognitive-load better-audit-deps
  better-audit-dry better-audit-security better-audit-stack-specific
  better-audit-structural better-audit-tests better-audit-ux
  better-discovery better-options better-pipeline-inputs
  better-plan better-remediation better-simplify
  better-state better-test-enhancement
  better-cleanup better-pr-and-ci better-review-loop better-verification
  ci-flake-handling code-review-checklist copilot-review-loop
  empty-array-expansion enhance-loop epic-children
  finding-disposition fix-regression-guard
  gh-host github-reviewer-loop graphql-escaping
  local-agent-review-loop model-tiers multi-reviewer-loop next-swarm ollama-review-loop
  per-finding-root-cause plan-id-format plan-issue-mode pr-write-access
  post-review-doc-recommendations rebase-conflict-resolution remediation-agent-template
  review-agent-selection review-config-defaults review-convergence-gate
  swift-review-checklist swift-gotchas
  review-surface-scan review-surface-quality review-security-audit
  review-cross-file-tracing review-cross-file-contract
  review-structural-ambition
  vcs-host
)

HOOKS=(slashdo-check-update slashdo-statusline)

OLD_HOOKS=(update-check)

uninstall_claude() {
  local target_cmd="$CLAUDE_CONFIG_DIR/commands/do"
  local target_lib="$CLAUDE_CONFIG_DIR/lib"
  local target_hooks="$CLAUDE_CONFIG_DIR/hooks"
  local count=0

  printf "  Uninstalling from ${GREEN}Claude Code${RESET}...\n"

  # Deregister from settings.json FIRST, by calling the canonical
  # src/settings-hooks.js — the same module the npm uninstaller requires (see
  # install.sh). Nothing is deleted until this succeeds: a hook file removed
  # while settings.json still names it makes Claude Code error every session.
  if [ ! -f "$CLAUDE_CONFIG_DIR/settings.json" ]; then
    : # Nothing to deregister — a missing file is not a reason to fail.
  elif ! command -v node &>/dev/null; then
    printf "    ${YELLOW}settings.json: Node.js not found — nothing was removed${RESET}\n"
    printf "    ${DIM}(install Node.js and re-run, or remove slashdo's files and the${RESET}\n"
    printf "    ${DIM} settings.json lines mentioning slashdo- by hand)${RESET}\n"
    claude_incomplete=true
    return 0
  else
    MOD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/slashdo-mod.XXXXXX")" || MOD_DIR=""
    # Prefer the copy install.sh cached, so an offline machine can uninstall;
    # fall back to the network when that copy is missing, corrupt, or predates
    # a rename in this module, so a bad cache cannot block uninstall forever.
    local node_result deregistered=false
    if [ -n "$MOD_DIR" ]; then
      if cp "$target_hooks/$SETTINGS_HOOKS_CACHE" "$MOD_DIR/settings-hooks.js" 2>/dev/null &&
         node_result=$(run_deregister); then
        deregistered=true
      elif fetch_file "src/settings-hooks.js" "$MOD_DIR/settings-hooks.js" &&
           node_result=$(run_deregister); then
        deregistered=true
      fi
    fi

    if [ "$deregistered" = false ]; then
      printf "    ${YELLOW}settings.json: could not deregister — nothing was removed${RESET}\n"
      printf "    ${DIM}(re-run with network access or from a checkout; if it persists, delete${RESET}\n"
      printf "    ${DIM} %s and try again)${RESET}\n" "$target_hooks/$SETTINGS_HOOKS_CACHE"
      if [ -n "$MOD_DIR" ] && [ -s "$MOD_DIR/node.err" ]; then sed -e 's/^/      /' "$MOD_DIR/node.err" >&2; fi
      claude_incomplete=true
      return 0
    fi

    print_settings_actions "$node_result"
    # A warn line means the module declined to touch settings.json — removing
    # the files it still references is exactly what this ordering prevents.
    # Line-anchored so a status that merely contains the word cannot trip it.
    case $'\n'"$node_result" in
      *$'\n'"warn "*)
        printf "    ${YELLOW}settings.json was left as-is — nothing was removed${RESET}\n"
        claude_incomplete=true
        return 0
        ;;
    esac
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

  if [ -f "$target_hooks/$SETTINGS_HOOKS_CACHE" ]; then
    rm -f "$target_hooks/$SETTINGS_HOOKS_CACHE"
    printf "    removed: hook/%-17s${GREEN}ok${RESET}\n" "$SETTINGS_HOOKS_CACHE"
    count=$((count + 1))
  fi

  for old in "${OLD_HOOKS[@]}"; do
    if [ -f "$target_hooks/$old.md" ]; then
      rm -f "$target_hooks/$old.md"
      printf "    removed: hook/%-17s${GREEN}ok${RESET}\n" "$old.md"
      count=$((count + 1))
    fi
  done

  # Remove cache file
  if [ -f "$CLAUDE_CONFIG_DIR/cache/slashdo-update-check.json" ]; then
    rm -f "$CLAUDE_CONFIG_DIR/cache/slashdo-update-check.json"
    printf "    removed: cache/slashdo-update-check.json ${GREEN}ok${RESET}\n"
    count=$((count + 1))
  fi

  if [ -f "$CLAUDE_CONFIG_DIR/.slashdo-version" ]; then
    rm -f "$CLAUDE_CONFIG_DIR/.slashdo-version"
    printf "    removed: .slashdo-version        ${GREEN}ok${RESET}\n"
    count=$((count + 1))
  fi

  if [ -f "$CLAUDE_CONFIG_DIR/.slashdo-config.json" ]; then
    rm -f "$CLAUDE_CONFIG_DIR/.slashdo-config.json"
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
  [ -d "$CLAUDE_CONFIG_DIR" ] && envs+=(claude)
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

for env in "${envs[@]}"; do
  case "$env" in
    claude)        uninstall_claude ;;
    opencode)      uninstall_opencode ;;
    antigravity)   uninstall_antigravity ;;
    codex)         uninstall_agent_skills "Codex" "$HOME/.codex" ;;
    grok)          uninstall_agent_skills "Grok Build" "$HOME/.grok" ;;
    gemini-legacy) uninstall_gemini_legacy ;;
  esac
  printf "\n"
done

if [ "$claude_incomplete" = true ]; then
  printf "  ${YELLOW}Incomplete:${RESET} settings.json could not be updated, so nothing was removed\n"
  printf "  from Claude Code — deleting the files first would strand settings.json entries\n"
  printf "  pointing at them. Re-run once Node.js and the source are reachable.\n\n"
  exit 1
fi

printf "  ${GREEN}Done!${RESET} All slashdo commands have been removed.\n"
printf "  ${DIM}To reinstall: curl -fsSL https://raw.githubusercontent.com/atomantic/slashdo/main/install.sh | bash${RESET}\n\n"
