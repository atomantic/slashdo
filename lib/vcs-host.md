### Selecting the VCS host (`VCS_HOST` / `CLI_TOOL`)

The `origin` remote selects the forge; credentials never select or switch the forge,
they only gate access. Run both blocks, substituting `{COMMAND}` with the invoking
command's name. Any `gitlab` substring in the host means GitLab, so self-managed and
Enterprise instances need no configuration. Every abort is non-mutating and happens
before any branch, worktree, issue, or PR/MR exists.

```bash
ORIGIN_HOST="$(git remote get-url origin 2>/dev/null | sed -E 's#^[a-z]+://##; s#^[^@/]+@##; s#[:/].*$##')"
if printf '%s' "$ORIGIN_HOST" | grep -qi gitlab; then
  VCS_HOST=gitlab; CLI_TOOL=glab
elif [ -n "$ORIGIN_HOST" ]; then
  VCS_HOST=github; CLI_TOOL=gh
else
  # No origin remote: the ONLY case in which the authenticated CLI picks the host.
  if gh auth status --active >/dev/null 2>&1; then VCS_HOST=github; CLI_TOOL=gh
  elif glab auth status >/dev/null 2>&1; then VCS_HOST=gitlab; CLI_TOOL=glab
  else
    echo "{COMMAND} needs an authenticated gh (GitHub) or glab (GitLab). Run 'gh auth login' or 'glab auth login'."; exit 1
  fi
fi
[ "$CLI_TOOL" = glab ] && LABEL_SEP="::" || LABEL_SEP=":"
```

Then confirm the selected CLI can actually read this repo — on Enterprise or
self-managed hosts an ambient login passes `auth status` while the checkout's host
stays unreadable:

```bash
if [ "$CLI_TOOL" = gh ]; then
  if ! gh auth status --active >/dev/null 2>&1 \
     || { [ -n "$ORIGIN_HOST" ] && ! gh repo view >/dev/null 2>&1; }; then
    echo "{COMMAND} selected GitHub for origin (${ORIGIN_HOST:-none}) but gh cannot read this repo."
    echo "If it is a GitHub/GHES repo, run: gh auth login${ORIGIN_HOST:+ --hostname $ORIGIN_HOST}"
    echo "If it is neither GitHub nor GitLab, {COMMAND} does not support this forge."
    exit 1
  fi
  GH_HOST="$ORIGIN_HOST"  # seed only; gh-host.md adds the fallbacks for `gh api`
else
  if ! glab auth status >/dev/null 2>&1 \
     || { [ -n "$ORIGIN_HOST" ] && ! glab repo view >/dev/null 2>&1; }; then
    echo "{COMMAND} selected GitLab for origin (${ORIGIN_HOST:-none}) but glab cannot read this repo."
    echo "Run: glab auth login${ORIGIN_HOST:+ --hostname $ORIGIN_HOST}"
    exit 1
  fi
fi
```

Print `VCS host: {VCS_HOST} (via {CLI_TOOL})` and carry `VCS_HOST` / `CLI_TOOL` /
`LABEL_SEP` (plus `GH_HOST` on GitHub) through every later phase rather than
re-detecting. Build and match every prefixed label as `<key>${LABEL_SEP}<value>`; a
hardcoded `:` silently misses GitLab's `::` scoped labels.
