#!/usr/bin/env bash
# slashdo — curl-based installer (no npm required)
# Usage: curl -fsSL https://raw.githubusercontent.com/atomantic/slashdo/main/install.sh | bash
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
  cam fpr help makegoals makegood optimize-md
  pr release replan review rpr update
)

LIBS=(
  code-review-checklist copilot-review-loop graphql-escaping
)

detect_envs() {
  local envs=()
  [ -d "$HOME/.claude" ] && envs+=(claude)
  [ -d "$HOME/.config/opencode" ] && envs+=(opencode)
  [ -d "$HOME/.gemini" ] && envs+=(gemini)
  [ -d "$HOME/.codex" ] && envs+=(codex)
  printf '%s\n' "${envs[@]}"
}

install_claude() {
  local target_cmd="$HOME/.claude/commands/do"
  local target_lib="$HOME/.claude/lib"
  mkdir -p "$target_cmd" "$target_lib"

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
        BEGIN { in_fm=0; started=0 }
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
}

banner

envs=($(detect_envs))

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
    codex)    printf "  ${DIM}Codex: use 'npx slashdo@latest --env codex' (requires Node.js for content inlining)${RESET}\n" ;;
  esac
  printf "\n"
done

printf "  ${GREEN}Done!${RESET} Commands are available as /do:<name> in your AI coding assistant.\n\n"
