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

# Scratch copies of the module and of the downloaded manifest, removed however
# we exit.
MOD_DIR=""
MANIFEST_TMP=""
cleanup_temp() {
  [ -n "$MOD_DIR" ] && rm -rf "$MOD_DIR"
  [ -n "$MANIFEST_TMP" ] && rm -f "$MANIFEST_TMP"
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

# ── install manifest ── (this block is identical in install.sh and uninstall.sh)
#
# Which commands, libs and hooks ship, and which files earlier releases shipped
# that must be cleaned up, come from install-manifest.txt, generated from the
# tree by `node scripts/build-install-manifest.js`. Entries are bare filenames
# with their extension, grouped under [commands], [libs], [hooks] and their
# [retired-*] counterparts.
MANIFEST_FILE="install-manifest.txt"
MANIFEST_FORMAT="# slashdo install manifest v1"
# Copy left in each installed environment's root, so uninstall.sh can find
# everything a past install put there without a network round trip.
MANIFEST_CACHE=".slashdo-install-manifest.txt"
COMMANDS=()
LIBS=()
HOOKS=()
OLD_COMMANDS=()
OLD_LIBS=()
OLD_HOOKS=()

# Append one manifest's entries to the arrays above. The scripts build cp, mv
# and rm paths from these names, so anything but a bare filename under a known
# section rejects the whole manifest instead of being skipped, and nothing from
# a rejected manifest is kept.
# Usage: read_manifest <file> <label for messages>
read_manifest() {
  local file="$1" label="$2" line section="" entry
  local entries=()
  if ! IFS= read -r line < "$file" || [ "${line%$'\r'}" != "$MANIFEST_FORMAT" ]; then
    printf "    ${YELLOW}%s: not a v1 slashdo install manifest${RESET}\n" "$label"
    return 1
  fi
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    case "$line" in
      ''|'#'*) continue ;;
      '['*']')
        section="${line#[}"
        section="${section%]}"
        case "$section" in
          commands|libs|hooks|retired-commands|retired-libs|retired-hooks) continue ;;
        esac
        printf "    ${YELLOW}%s: unknown section %s${RESET}\n" "$label" "$line"
        return 1
        ;;
      .*|*[!A-Za-z0-9._-]*)
        printf "    ${YELLOW}%s: invalid entry %s${RESET}\n" "$label" "$line"
        return 1
        ;;
    esac
    case "$section" in
      '')
        printf "    ${YELLOW}%s: entry %s precedes any section${RESET}\n" "$label" "$line"
        return 1
        ;;
      commands|retired-commands)
        case "$line" in
          *.md) ;;
          *) printf "    ${YELLOW}%s: command %s is not a .md file${RESET}\n" "$label" "$line"; return 1 ;;
        esac
        ;;
    esac
    entries+=("$section/$line")
  done < "$file"
  for entry in ${entries[@]+"${entries[@]}"}; do
    case "${entry%%/*}" in
      commands)         COMMANDS+=("${entry#*/}") ;;
      libs)             LIBS+=("${entry#*/}") ;;
      hooks)            HOOKS+=("${entry#*/}") ;;
      retired-commands) OLD_COMMANDS+=("${entry#*/}") ;;
      retired-libs)     OLD_LIBS+=("${entry#*/}") ;;
      retired-hooks)    OLD_HOOKS+=("${entry#*/}") ;;
    esac
  done
}
# ── end install manifest ──

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

  local file
  for file in "${REMOVE_COMMANDS[@]}"; do
    if [ -f "$target_cmd/$file" ]; then
      rm -f "$target_cmd/$file"
      printf "    removed: /do:%-18s${GREEN}ok${RESET}\n" "${file%.md}"
      count=$((count + 1))
    fi
  done

  for file in "${REMOVE_LIBS[@]}"; do
    if [ -f "$target_lib/$file" ]; then
      rm -f "$target_lib/$file"
      printf "    removed: lib/%-18s${GREEN}ok${RESET}\n" "$file"
      count=$((count + 1))
    fi
  done

  for file in "${REMOVE_HOOKS[@]}"; do
    if [ -f "$target_hooks/$file" ]; then
      rm -f "$target_hooks/$file"
      printf "    removed: hook/%-17s${GREEN}ok${RESET}\n" "$file"
      count=$((count + 1))
    fi
  done

  if [ -f "$target_hooks/$SETTINGS_HOOKS_CACHE" ]; then
    rm -f "$target_hooks/$SETTINGS_HOOKS_CACHE"
    printf "    removed: hook/%-17s${GREEN}ok${RESET}\n" "$SETTINGS_HOOKS_CACHE"
    count=$((count + 1))
  fi

  remove_manifest_cache "$CLAUDE_CONFIG_DIR" && count=$((count + 1))

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

  local file
  for file in "${REMOVE_COMMANDS[@]}"; do
    if [ -f "$target_cmd/do-$file" ]; then
      rm -f "$target_cmd/do-$file"
      printf "    removed: /do-%-18s${GREEN}ok${RESET}\n" "${file%.md}"
      count=$((count + 1))
    fi
  done

  for file in "${REMOVE_LIBS[@]}"; do
    if [ -f "$target_lib/$file" ]; then
      rm -f "$target_lib/$file"
      printf "    removed: lib/%-18s${GREEN}ok${RESET}\n" "$file"
      count=$((count + 1))
    fi
  done

  remove_manifest_cache "$HOME/.config/opencode" && count=$((count + 1))

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

  local file cmd
  for file in "${REMOVE_COMMANDS[@]}"; do
    cmd="${file%.md}"
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

  local file cmd
  for file in "${REMOVE_COMMANDS[@]}"; do
    cmd="${file%.md}"
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

  local file
  for file in "${REMOVE_COMMANDS[@]}"; do
    if [ -f "$target_cmd/$file" ]; then
      rm -f "$target_cmd/$file"
      printf "    removed: /do:%-18s${GREEN}ok${RESET}\n" "${file%.md}"
      count=$((count + 1))
    fi
  done

  for file in "${REMOVE_LIBS[@]}"; do
    if [ -f "$target_lib/$file" ]; then
      rm -f "$target_lib/$file"
      printf "    removed: lib/%-18s${GREEN}ok${RESET}\n" "$file"
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

# Build the removal lists from every manifest that can be read: the checkout's
# own copy in local mode, otherwise the current one from $BASE_URL, plus the
# copy each install left in its environment root. Taking the union means a
# file is removed if either the installed release or the current one names it,
# and an offline uninstall still works from an installed copy. Returns 1, with
# nothing removed yet, only when no manifest at all could be read.
REMOVE_COMMANDS=()
REMOVE_LIBS=()
REMOVE_HOOKS=()
load_manifests() {
  local cache loaded=false
  if [ "$LOCAL_MODE" = true ]; then
    if [ -f "$SCRIPT_DIR/$MANIFEST_FILE" ] && read_manifest "$SCRIPT_DIR/$MANIFEST_FILE" "$SCRIPT_DIR/$MANIFEST_FILE"; then
      loaded=true
    fi
  else
    MANIFEST_TMP="$(mktemp "${TMPDIR:-/tmp}/slashdo-manifest.XXXXXX")" || MANIFEST_TMP=""
    if [ -n "$MANIFEST_TMP" ] && fetch_file "$MANIFEST_FILE" "$MANIFEST_TMP" &&
       read_manifest "$MANIFEST_TMP" "$BASE_URL/$MANIFEST_FILE"; then
      loaded=true
    else
      printf "  ${DIM}could not download %s — using the installed copy${RESET}\n" "$BASE_URL/$MANIFEST_FILE"
    fi
  fi
  for cache in "$CLAUDE_CONFIG_DIR/$MANIFEST_CACHE" "$HOME/.config/opencode/$MANIFEST_CACHE"; do
    if [ -f "$cache" ] && read_manifest "$cache" "$cache"; then
      loaded=true
    fi
  done
  if [ "$loaded" = false ] || [ ${#COMMANDS[@]} -eq 0 ] || [ ${#LIBS[@]} -eq 0 ] || [ ${#HOOKS[@]} -eq 0 ]; then
    return 1
  fi
  REMOVE_COMMANDS=("${COMMANDS[@]}" ${OLD_COMMANDS[@]+"${OLD_COMMANDS[@]}"})
  REMOVE_LIBS=("${LIBS[@]}" ${OLD_LIBS[@]+"${OLD_LIBS[@]}"})
  REMOVE_HOOKS=("${HOOKS[@]}" ${OLD_HOOKS[@]+"${OLD_HOOKS[@]}"})
}

# Remove the manifest copy install.sh left in <environment root>; succeeds only
# if there was one, so the caller can count it.
remove_manifest_cache() {
  [ -f "$1/$MANIFEST_CACHE" ] || return 1
  rm -f "$1/$MANIFEST_CACHE"
  printf "    removed: %s ${GREEN}ok${RESET}\n" "$MANIFEST_CACHE"
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

if ! load_manifests; then
  printf "  ${YELLOW}Uninstall aborted:${RESET} could not read the file list (%s) from %s\n" "$MANIFEST_FILE" "$BASE_URL"
  printf "  or from an installed copy, so nothing was removed. Re-run with network access,\n"
  printf "  or from a slashdo checkout.\n\n"
  exit 1
fi

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
