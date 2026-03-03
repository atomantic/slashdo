#!/usr/bin/env bash
# slashdo — curl-based uninstaller
# Usage: curl -fsSL https://raw.githubusercontent.com/atomantic/slashdo/main/uninstall.sh | bash
# shellcheck disable=SC2059,SC2207
set -euo pipefail

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
  printf "  ${DIM}slashdo — uninstaller${RESET}\n"
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

uninstall_claude() {
  local target_cmd="$HOME/.claude/commands/do"
  local target_lib="$HOME/.claude/lib"
  local target_hooks="$HOME/.claude/hooks"
  local count=0

  printf "  Uninstalling from ${GREEN}Claude Code${RESET}...\n"

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

  # Deregister from settings.json (requires Node.js)
  if command -v node &>/dev/null; then
    if node -e '
      const fs = require("fs");
      const path = require("path");
      const home = require("os").homedir();
      const settingsPath = path.join(home, ".claude", "settings.json");

      if (!fs.existsSync(settingsPath)) process.exit(0);

      let settings;
      try {
        settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
      } catch (e) {
        process.stdout.write("    skipped settings.json deregistration (parse error)\n");
        process.exit(0);
      }
      let modified = false;

      if (settings.hooks && Array.isArray(settings.hooks.SessionStart)) {
        var emptiedByUs = {};
        for (var i = 0; i < settings.hooks.SessionStart.length; i++) {
          var group = settings.hooks.SessionStart[i];
          if (!group || typeof group !== "object") continue;
          if (Array.isArray(group.hooks)) {
            var before = group.hooks.length;
            group.hooks = group.hooks.filter(function(h) {
              if (!h || typeof h !== "object") return true;
              return typeof h.command !== "string" || h.command.indexOf("slashdo-check-update") === -1;
            });
            if (group.hooks.length < before) {
              modified = true;
              if (group.hooks.length === 0) emptiedByUs[i] = true;
            }
          }
        }
        settings.hooks.SessionStart = settings.hooks.SessionStart.filter(function(g, i) {
          return !emptiedByUs[i];
        });
        if (settings.hooks.SessionStart.length === 0) delete settings.hooks.SessionStart;
        if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
      }

      if (settings.statusLine && settings.statusLine.command &&
          settings.statusLine.command.indexOf("slashdo-statusline") !== -1) {
        delete settings.statusLine;
        modified = true;
      }

      if (modified) {
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
        process.stdout.write("    deregistered from settings.json\n");
      }
    '; then
      : # deregistration handled inside node
    else
      printf "    ${YELLOW}settings.json deregistration failed${RESET}\n"
    fi
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

  if [ $count -eq 0 ]; then
    printf "    ${DIM}nothing to remove${RESET}\n"
  else
    printf "    ${GREEN}$count files removed${RESET}\n"
  fi
}

uninstall_gemini() {
  local target_cmd="$HOME/.gemini/commands/do"
  local target_lib="$HOME/.gemini/lib"
  local count=0

  printf "  Uninstalling from ${GREEN}Gemini CLI${RESET}...\n"

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
  [ -d "$HOME/.gemini" ] && envs+=(gemini)
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
    claude)   uninstall_claude ;;
    opencode) uninstall_opencode ;;
    gemini)   uninstall_gemini ;;
  esac
  printf "\n"
done

printf "  ${GREEN}Done!${RESET} All slashdo commands have been removed.\n"
printf "  ${DIM}To reinstall: curl -fsSL https://raw.githubusercontent.com/atomantic/slashdo/main/install.sh | bash${RESET}\n\n"
