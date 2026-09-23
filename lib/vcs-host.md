### Selecting the VCS host (`VCS_HOST` / `CLI_TOOL`)

The `origin` remote selects the forge; credentials only gate access. Derive the host
before probing either CLI so an ambient GitHub login cannot route a GitLab checkout to
GitHub, then confirm the selected CLI can read this repository.

`{COMMAND}` in the messages below is the invoking command's own name (`/do:better`,
`/do:depfree`, …) — substitute it so the abort tells the user what stopped.

#### Select the host

```bash
# The origin remote is authoritative. A GitLab remote may be gitlab.com,
# gitlab.<company>.com, or any self-managed hostname that happens to contain
# "gitlab" — matching on that substring (rather than an exact-domain list) is what
# makes this work on a custom/Enterprise instance with zero configuration.
ORIGIN_HOST="$(git remote get-url origin 2>/dev/null | sed -E 's#^[a-z]+://##; s#^[^@/]+@##; s#[:/].*$##')"
if printf '%s' "$ORIGIN_HOST" | grep -qi gitlab; then
  VCS_HOST=gitlab; CLI_TOOL=glab
elif [ -n "$ORIGIN_HOST" ]; then
  VCS_HOST=github; CLI_TOOL=gh
else
  # No origin remote at all — nothing to derive from. This is the ONLY case in which
  # the authenticated CLI gets to pick the host.
  if gh auth status --active >/dev/null 2>&1; then VCS_HOST=github; CLI_TOOL=gh
  elif glab auth status >/dev/null 2>&1; then VCS_HOST=gitlab; CLI_TOOL=glab
  else
    echo "{COMMAND} needs an authenticated gh (GitHub) or glab (GitLab). Run 'gh auth login' or 'glab auth login'."; exit 1
  fi
fi
[ "$CLI_TOOL" = glab ] && LABEL_SEP="::" || LABEL_SEP=":"
```

#### Confirm the selected CLI can reach this repo

Check both authentication and repository reachability. The second check matters on
Enterprise or self-managed hosts, where an ambient login can pass `auth status` while
the checkout's actual host remains unreadable; every failure stops before mutation.

```bash
if [ "$CLI_TOOL" = gh ]; then
  if ! gh auth status --active >/dev/null 2>&1 \
     || { [ -n "$ORIGIN_HOST" ] && ! gh repo view >/dev/null 2>&1; }; then
    echo "{COMMAND} selected GitHub for origin (${ORIGIN_HOST:-none}) but gh cannot read this repo."
    echo "If it is a GitHub/GHES repo, run: gh auth login${ORIGIN_HOST:+ --hostname $ORIGIN_HOST}"
    echo "If it is neither GitHub nor GitLab, {COMMAND} does not support this forge."
    exit 1
  fi
  # Seed the API host for `gh api` calls. `gh api` ignores the repo remote and
  # defaults to github.com, so on a GHES repo it must be passed --hostname "$GH_HOST".
  # `gh issue`/`gh pr`/`gh repo` resolve the host themselves. This is only the seed —
  # finish the derivation with the gh-host.md snippet, which adds the fallbacks.
  GH_HOST="$ORIGIN_HOST"
else
  if ! glab auth status >/dev/null 2>&1 \
     || { [ -n "$ORIGIN_HOST" ] && ! glab repo view >/dev/null 2>&1; }; then
    echo "{COMMAND} selected GitLab for origin (${ORIGIN_HOST:-none}) but glab cannot read this repo."
    echo "Run: glab auth login${ORIGIN_HOST:+ --hostname $ORIGIN_HOST}"
    exit 1
  fi
  # No GH_HOST-style workaround here: unlike `gh api`, `glab api` and `glab issue` /
  # `glab mr` already resolve the host from the repo's origin remote. A bare
  # `glab auth login` would default to gitlab.com, so the hint names the host.
fi
```

Print: `VCS host: {VCS_HOST} (via {CLI_TOOL})`, and carry `VCS_HOST` / `CLI_TOOL`
(plus `GH_HOST` on GitHub) through every later phase rather than re-detecting.

#### The label separator (`LABEL_SEP`)

`LABEL_SEP` is `::` for GitLab scoped labels and `:` for GitHub. Build and match every
prefixed label as `<key>${LABEL_SEP}<value>`; a hardcoded `:` silently misses GitLab
labels.

#### Rules this encodes

The remote is authoritative; credentials never select or switch the forge. Every abort
is non-mutating and names the selected host, so unsupported remotes and wrong-service
credentials stop before any branch, worktree, issue, or PR/MR is created.
