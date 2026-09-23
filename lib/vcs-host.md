### Code host and tracker selection

`origin` picks the forge (`gitlab` substring = GitLab) unless saved `/do:config`
`code-host` overrides; `tracker` defaults to it.
Credentials never select or switch the forge, only gate access. Run both blocks
(`{COMMAND}` = invoking command); every abort is non-mutating.

```bash
ORIGIN_HOST="$(git remote get-url origin 2>/dev/null | sed -E 's#^[a-z]+://##; s#^[^@/]+@##; s#[:/].*$##')"
saved() { for _f in ~/.claude/.slashdo-config.json "$(git rev-parse --show-toplevel 2>/dev/null)/.slashdo.json"; do [ -f "$_f" ] && { tr -d '\n' < "$_f"; echo; } | sed -n 's/.*"'"$1"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p'; done | tail -1 | tr A-Z a-z; }
CODE_HOST="$(saved code-host)"
[ -n "$CODE_HOST" ] || case "$(printf '%s' "$ORIGIN_HOST" | tr A-Z a-z)" in
  *gitlab*) CODE_HOST=gitlab ;;
  *bitbucket*|*codeberg*|*gitea*|*forgejo*|*gogs*|*sr.ht|*dev.azure.com|*visualstudio.com) CODE_HOST="$ORIGIN_HOST" ;;
  '') # no origin: only here may auth pick the host
    if gh auth status --active >/dev/null 2>&1; then CODE_HOST=github
    elif glab auth status >/dev/null 2>&1; then CODE_HOST=gitlab
    else echo "{COMMAND} needs an authenticated gh (GitHub) or glab (GitLab)."; exit 1; fi ;;
  *) CODE_HOST=github ;;
esac
case "$CODE_HOST" in
  github) CLI_TOOL=gh; CR_NOUN=PR; LABEL_SEP=":" ;;
  gitlab) CLI_TOOL=glab; CR_NOUN=MR; LABEL_SEP="::" ;;
  *) echo "{COMMAND}: unsupported code host '$CODE_HOST' (supported: github, gitlab; see /do:config --code-host)"; exit 1 ;;
esac
VCS_HOST="$CODE_HOST"
TRACKER="$(saved tracker)"; TRACKER="${TRACKER:-$CODE_HOST}"
[ "$TRACKER" = "$CODE_HOST" ] && TRACKER_CLI="$CLI_TOOL" || TRACKER_CLI=""
```

Then confirm the CLI can read this repo (ambient logins pass `auth status`):

```bash
if [ "$CLI_TOOL" = gh ]; then
  if ! gh auth status --active >/dev/null 2>&1 \
     || { [ -n "$ORIGIN_HOST" ] && ! gh repo view >/dev/null 2>&1; }; then
    echo "{COMMAND}: gh cannot read this repo (origin ${ORIGIN_HOST:-none}). GHES: gh auth login${ORIGIN_HOST:+ --hostname $ORIGIN_HOST}; self-managed GitLab: /do:config --code-host gitlab; else unsupported code host."
    exit 1
  fi
  GH_HOST="$ORIGIN_HOST"  # seed; gh-host.md adds `gh api` fallbacks
elif ! glab auth status >/dev/null 2>&1 \
     || { [ -n "$ORIGIN_HOST" ] && ! glab repo view >/dev/null 2>&1; }; then
  echo "{COMMAND}: glab cannot read this repo. Run: glab auth login${ORIGIN_HOST:+ --hostname $ORIGIN_HOST}"
  exit 1
fi
```

Print `Code host: {CODE_HOST} (via {CLI_TOOL}), tracker: {TRACKER}`; carry these and
`GH_HOST` through later phases. Say `{CR_NOUN}` in messages; build prefixed labels as
`<key>${LABEL_SEP}<value>`. **Tracker gate:** issue calls use `TRACKER_CLI`; empty =
no backend for `{TRACKER}` here = no tracker (`jira`: set only by
`lib/tracker-jira.md`'s pre-flight).
