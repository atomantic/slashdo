#!/usr/bin/env bash
# slashdo — curl-based installer (no npm required)
# Usage: curl -fsSL https://raw.githubusercontent.com/atomantic/slashdo/main/install.sh | bash
# shellcheck disable=SC2059,SC2207
set -euo pipefail

REPO="atomantic/slashdo"
BRANCH="main"
BASE_URL="https://raw.githubusercontent.com/$REPO/$BRANCH"

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
  better fpr goals help omd
  pr push release replan review rpr update
)

OLD_COMMANDS=(cam good makegoals makegood optimize-md)

LIBS=(
  code-review-checklist copilot-review-loop graphql-escaping
)

HOOKS=(slashdo-check-update slashdo-statusline)

OLD_HOOKS=(update-check)

detect_envs() {
  local envs=()
  [ -d "$HOME/.claude" ] && envs+=(claude)
  [ -d "$HOME/.config/opencode" ] && envs+=(opencode)
  [ -d "$HOME/.gemini" ] && envs+=(gemini)
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
    if curl -fsSL "$BASE_URL/commands/do/$cmd.md" -o "$target_cmd/$cmd.md" 2>/dev/null; then
      printf "${GREEN}ok${RESET}\n"
    else
      printf "failed\n"
    fi
  done

  for lib in "${LIBS[@]}"; do
    printf "    lib/%-20s" "$lib.md"
    if curl -fsSL "$BASE_URL/lib/$lib.md" -o "$target_lib/$lib.md" 2>/dev/null; then
      printf "${GREEN}ok${RESET}\n"
    else
      printf "failed\n"
    fi
  done

  for hook in "${HOOKS[@]}"; do
    printf "    hook/%-19s" "$hook.js"
    if curl -fsSL "$BASE_URL/hooks/$hook.js" -o "$target_hooks/$hook.js" 2>/dev/null; then
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
    if curl -fsSL "$BASE_URL/commands/do/$cmd.md" -o "/tmp/slashdo-$cmd.md" 2>/dev/null; then
      # Rewrite lib paths for OpenCode
      sed 's|~/.claude/lib/|~/.config/opencode/lib/|g' "/tmp/slashdo-$cmd.md" > "$target_cmd/do-$cmd.md"
      rm -f "/tmp/slashdo-$cmd.md"
      printf "${GREEN}ok${RESET}\n"
    else
      printf "failed\n"
    fi
  done

  for lib in "${LIBS[@]}"; do
    printf "    lib/%-20s" "$lib.md"
    if curl -fsSL "$BASE_URL/lib/$lib.md" -o "$target_lib/$lib.md" 2>/dev/null; then
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

install_gemini() {
  local target_cmd="$HOME/.gemini/commands/do"
  local target_lib="$HOME/.gemini/lib"
  mkdir -p "$target_cmd" "$target_lib"

  printf "  Installing to ${GREEN}Gemini CLI${RESET}...\n"

  for cmd in "${COMMANDS[@]}"; do
    printf "    /do:%-20s" "$cmd"
    if curl -fsSL "$BASE_URL/commands/do/$cmd.md" -o "/tmp/slashdo-$cmd.md" 2>/dev/null; then
      # Convert YAML frontmatter to TOML and rewrite lib paths
      awk '
        BEGIN { in_fm=0 }
        NR==1 && /^---$/ { in_fm=1; print "+++"; next }
        in_fm && /^---$/ { in_fm=0; print "+++"; next }
        in_fm && /^description:/ { sub(/^description: */, ""); gsub(/"/, ""); printf "description = \"%s\"\n", $0; next }
        in_fm && /^allowed-tools:/ { next }
        in_fm { print; next }
        { gsub(/~\/.claude\/lib\//, "~/.gemini/lib/"); print }
      ' "/tmp/slashdo-$cmd.md" > "$target_cmd/$cmd.md"
      rm -f "/tmp/slashdo-$cmd.md"
      printf "${GREEN}ok${RESET}\n"
    else
      printf "failed\n"
    fi
  done

  for lib in "${LIBS[@]}"; do
    printf "    lib/%-20s" "$lib.md"
    if curl -fsSL "$BASE_URL/lib/$lib.md" -o "$target_lib/$lib.md" 2>/dev/null; then
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
}

banner

envs=($(detect_envs)) || true

if [ ${#envs[@]} -eq 0 ]; then
  printf "  No supported AI coding environments detected.\n"
  printf "  Supported: Claude Code, OpenCode, Gemini CLI, Codex\n\n"
  printf "  Create ~/.claude/ to enable Claude Code support, then re-run.\n"
  exit 1
fi

printf "  Detected: ${GREEN}%s${RESET}\n\n" "${envs[*]}"

for env in "${envs[@]}"; do
  case "$env" in
    claude)   install_claude ;;
    opencode) install_opencode ;;
    gemini)   install_gemini ;;
    codex)    printf "  ${DIM}Codex: use 'npx slash-do@latest --env codex' (requires Node.js for content inlining)${RESET}\n" ;;
  esac
  printf "\n"
done

printf "  ${GREEN}Done!${RESET} Commands are available as /do:<name> in your AI coding assistant.\n\n"
