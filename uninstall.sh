#!/usr/bin/env bash
# slashdo — curl-based uninstaller
# Usage: curl -fsSL https://raw.githubusercontent.com/atomantic/slashdo/main/uninstall.sh | bash
set -euo pipefail

CYAN='\033[0;36m'
YELLOW='\033[0;33m'
GREEN='\033[0;32m'
RED='\033[0;31m'
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

remove_files() {
  local dir="$1"
  shift
  local count=0
  for f in "$@"; do
    if [ -f "$dir/$f" ]; then
      rm -f "$dir/$f"
      printf "    removed: %-24s${GREEN}ok${RESET}\n" "$f"
      count=$((count + 1))
    fi
  done
  echo $count
}

uninstall_claude() {
  local target_cmd="$HOME/.claude/commands/do"
  local target_lib="$HOME/.claude/lib"
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

  if [ -f "$HOME/.claude/.slashdo-version" ]; then
    rm -f "$HOME/.claude/.slashdo-version"
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

banner

detect_envs() {
  local envs=()
  [ -d "$HOME/.claude" ] && envs+=(claude)
  [ -d "$HOME/.config/opencode" ] && envs+=(opencode)
  [ -d "$HOME/.gemini" ] && envs+=(gemini)
  printf '%s\n' "${envs[@]}"
}

envs=($(detect_envs))

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
