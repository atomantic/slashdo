#!/usr/bin/env bash
# slashdo — curl-based installer (no npm required)
# Usage: curl -fsSL https://raw.githubusercontent.com/atomantic/slashdo/main/install.sh | bash
# shellcheck disable=SC2059,SC2207
set -euo pipefail

REPO="atomantic/slashdo"
BRANCH="main"
BASE_URL="https://raw.githubusercontent.com/$REPO/$BRANCH"

# Detect local repo: if this script lives alongside commands/ and lib/, use local files
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_MODE=false
if [ -d "$SCRIPT_DIR/commands/do" ] && [ -d "$SCRIPT_DIR/lib" ]; then
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

CYAN='\033[0;36m'
YELLOW='\033[0;33m'
GREEN='\033[0;32m'
DIM='\033[2m'
RESET='\033[0m'

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
    fi
  done

  for lib in "${LIBS[@]}"; do
    printf "    lib/%-20s" "$lib.md"
    if fetch_file "lib/$lib.md" "$target_lib/$lib.md"; then
      printf "${GREEN}ok${RESET}\n"
    else
      printf "failed\n"
    fi
  done

  for hook in "${HOOKS[@]}"; do
    printf "    hook/%-19s" "$hook.js"
    if fetch_file "hooks/$hook.js" "$target_hooks/$hook.js"; then
      printf "${GREEN}ok${RESET}\n"
    else
      printf "failed\n"
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
  # hand-translated copy of the algorithm that silently drifts.
  if command -v node &>/dev/null && [ -f "$target_hooks/slashdo-check-update.js" ]; then
    local mod_dir
    mod_dir="$(mktemp -d)"
    if fetch_file "src/settings-hooks.js" "$mod_dir/settings-hooks.js"; then
      local node_result
      if node_result=$(node -e '
        const fs = require("fs");
        const path = require("path");
        const { registerHooksInSettings } = require(process.argv[1]);
        const home = require("os").homedir();
        const hooksDir = path.join(home, ".claude", "hooks");

        // Default auto-update to enabled on first install. The curl installer
        // is piped (no TTY to prompt), so we pick the same default the npx
        // installer offers; re-run "npx slash-do@latest" interactively to change.
        const configPath = path.join(home, ".claude", ".slashdo-config.json");
        if (!fs.existsSync(configPath)) {
          try { fs.writeFileSync(configPath, JSON.stringify({ autoUpdate: true }, null, 2) + "\n"); } catch (e) {}
        }

        const hookFiles = ["slashdo-check-update.js", "slashdo-statusline.js"]
          .filter((name) => fs.existsSync(path.join(hooksDir, name)))
          .map((name) => ({ name }));
        const env = { settingsFile: path.join(home, ".claude", "settings.json"), hooksDir };
        const actions = registerHooksInSettings(env, hookFiles, false);
        if (actions.length === 0) actions.push({ name: "settings.json", status: "nothing to register" });
        for (const action of actions) process.stdout.write(action.name + ": " + action.status + "\n");
      ' "$mod_dir/settings-hooks.js" 2>/dev/null); then
        while IFS= read -r line; do
          [ -n "$line" ] || continue
          case "$line" in
            *": skipped"*) printf "    ${YELLOW}%s${RESET}\n" "$line" ;;
            *) printf "    %s ${GREEN}ok${RESET}\n" "$line" ;;
          esac
        done <<< "$node_result"
      else
        printf "    ${YELLOW}settings.json: failed${RESET}\n"
      fi
    else
      printf "    ${DIM}settings.json: skipped (could not fetch src/settings-hooks.js)${RESET}\n"
    fi
    rm -rf "$mod_dir"
  elif command -v node &>/dev/null; then
    printf "    ${DIM}settings.json: skipped (hook files not found)${RESET}\n"
  else
    printf "    ${DIM}settings.json: skipped (node not found — hooks installed but not registered)${RESET}\n"
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

if [ "$curl_installed" = true ]; then
  printf "  ${GREEN}Done!${RESET} Commands are available as /do:<name> in your AI coding assistant.\n"
fi
if [ "$npx_needed" = true ]; then
  printf "  ${DIM}(Antigravity / Codex / Grok Build users: run the npx command above to complete installation.)${RESET}\n"
fi
printf "\n"
