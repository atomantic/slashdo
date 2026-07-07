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
  pr pr-better push release replan review rpr scan update
)


OLD_COMMANDS=(cam good makegoals makegood optimize-md)

# NOTE: keep this allowlist in sync with files under lib/ in the repo. Any new
# lib/*.md that a command spec references (e.g. via `!cat ~/.claude/lib/<name>.md`)
# MUST be added here AND to uninstall.sh, or the curl installer will silently skip
# it and the command will fail at runtime. The npm installer (src/installer.js)
# enumerates lib/ dynamically, so it doesn't need updating.
LIBS=(
  ci-flake-handling code-review-checklist copilot-review-loop epic-children
  finding-disposition fix-regression-guard
  gh-host github-reviewer-loop graphql-escaping
  local-agent-review-loop multi-reviewer-loop ollama-review-loop
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

  # Register hooks in settings.json (requires Node.js and successful hook downloads)
  if command -v node &>/dev/null && [ -f "$target_hooks/slashdo-check-update.js" ]; then
    printf "    settings.json:          "
    local node_result
    if ! node_result=$(node -e '
      const fs = require("fs");
      const path = require("path");
      const home = require("os").homedir();
      const settingsPath = path.join(home, ".claude", "settings.json");
      const hooksDir = path.join(home, ".claude", "hooks");

      // Default auto-update to enabled on first install. The curl installer
      // is piped (no TTY to prompt), so we pick the same default the npx
      // installer offers; re-run "npx slash-do@latest" interactively to change.
      const configPath = path.join(home, ".claude", ".slashdo-config.json");
      if (!fs.existsSync(configPath)) {
        try { fs.writeFileSync(configPath, JSON.stringify({ autoUpdate: true }, null, 2) + "\n"); } catch (e) {}
      }

      let settings = {};
      if (fs.existsSync(settingsPath)) {
        try { settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")); } catch (e) {
          process.stdout.write("skipped (settings.json parse error)");
          process.exit(0);
        }
      }

      let modified = false;

      // SessionStart hook (only if hook file exists)
      const updateHookPath = path.join(hooksDir, "slashdo-check-update.js");
      if (!settings.hooks || typeof settings.hooks !== "object" || Array.isArray(settings.hooks)) settings.hooks = {};
      if (typeof settings.hooks.SessionStart === "undefined") {
        settings.hooks.SessionStart = [];
      } else if (!Array.isArray(settings.hooks.SessionStart)) {
        process.stdout.write("skipped (settings.hooks.SessionStart has unexpected shape)");
        process.exit(0);
      }

      const hookCmd = "node \"" + updateHookPath + "\"";
      const alreadyRegistered = settings.hooks.SessionStart.some(function(g) {
        return g && typeof g === "object" && Array.isArray(g.hooks) && g.hooks.some(function(h) {
          return h && typeof h === "object" && typeof h.command === "string" && h.command.indexOf("slashdo-check-update") !== -1;
        });
      });

      if (!alreadyRegistered) {
        if (settings.hooks.SessionStart.length > 0) {
          var firstGroup = settings.hooks.SessionStart[0];
          if (!firstGroup || typeof firstGroup !== "object") {
            firstGroup = {};
            settings.hooks.SessionStart[0] = firstGroup;
          }
          if (!Array.isArray(firstGroup.hooks)) firstGroup.hooks = [];
          firstGroup.hooks.push({ type: "command", command: hookCmd });
        } else {
          settings.hooks.SessionStart.push({ hooks: [{ type: "command", command: hookCmd }] });
        }
        modified = true;
      }

      // Statusline: upgrade gsd-statusline → slashdo-statusline (superset)
      const statuslineHookPath = path.join(hooksDir, "slashdo-statusline.js");
      if (fs.existsSync(statuslineHookPath)) {
        const slCmd = "node \"" + statuslineHookPath + "\"";
        const currentCmd = (settings.statusLine && typeof settings.statusLine.command === "string") ? settings.statusLine.command : "";
        if (!settings.statusLine) {
          settings.statusLine = { type: "command", command: slCmd };
          modified = true;
        } else if (currentCmd.indexOf("gsd-statusline") !== -1) {
          settings.statusLine = { type: "command", command: slCmd };
          modified = true;
        }
        // slashdo-statusline already active or custom statusline → no change
      }

      if (modified) {
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
      }

      process.stdout.write(modified ? "updated" : "already configured");
    ' 2>/dev/null); then
      printf " %sfailed%s\n" "$YELLOW" "$RESET"
    elif echo "$node_result" | grep -q "^skipped"; then
      printf "%s%s%s\n" "$YELLOW" "$node_result" "$RESET"
    else
      printf "%s %sok%s\n" "$node_result" "$GREEN" "$RESET"
    fi
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
  printf "  Supported: Claude Code, OpenCode, Antigravity CLI, Codex\n\n"
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
  esac
  printf "\n"
done

if [ "$curl_installed" = true ]; then
  printf "  ${GREEN}Done!${RESET} Commands are available as /do:<name> in your AI coding assistant.\n"
fi
if [ "$npx_needed" = true ]; then
  printf "  ${DIM}(Antigravity / Codex users: run the npx command above to complete installation.)${RESET}\n"
fi
printf "\n"
