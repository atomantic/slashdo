### Selecting the VCS host (`VCS_HOST` / `CLI_TOOL`)

**Why this exists.** The repository's `origin` remote is what decides which forge a
repo lives on. `gh auth status` / `glab auth status` only tell you which CLI is
*usable* — on a machine logged in to both, an auth-first probe picks whichever CLI
answers first and ignores the checkout entirely. That is how a GitLab repo ends up
with `VCS_HOST=github`: default-branch lookup, issue filing, and PR/MR operations
are routed to `gh` against a repository it cannot see, and the run may enter a
GitHub-only reviewer path. Equally wrong in the other direction, a `gh` auth failure
is **not** evidence of a GitLab repo — it usually means the user simply needs to log
in to GitHub.

So: **derive the host from the remote first, then check that host's credentials.**
This is the same rule `/do:pr`'s "Detect VCS Host" step and `/do:next`'s Phase 1
pre-flight apply, so no two slashdo commands can disagree about which forge a given
repo is on.

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
```

#### Confirm the selected CLI can reach this repo

`--active` scopes the `gh` check to the active account. A bare `gh auth status`
exits non-zero when *any* configured account holds a stale token — even while the
active one works fine — which would abort every run on a multi-account machine.

```bash
if [ "$CLI_TOOL" = gh ]; then
  gh auth status --active >/dev/null 2>&1 && gh repo view >/dev/null 2>&1 || {
    echo "{COMMAND} resolved origin ($ORIGIN_HOST) to GitHub but gh cannot read this repo."
    echo "If it is a GitHub/GHES repo, run: gh auth login --hostname $ORIGIN_HOST"
    echo "If it is neither GitHub nor GitLab, {COMMAND} does not support this forge."
    exit 1; }
  # Seed the API host for `gh api` calls. `gh api` ignores the repo remote and
  # defaults to github.com, so on a GHES repo it must be passed --hostname "$GH_HOST".
  # `gh issue`/`gh pr`/`gh repo` resolve the host themselves. This is only the seed —
  # finish the derivation with the gh-host.md snippet, which adds the fallbacks.
  GH_HOST="$ORIGIN_HOST"
else
  glab auth status >/dev/null 2>&1 || {
    echo "{COMMAND} resolved origin ($ORIGIN_HOST) to GitLab but glab is not authenticated to it. Run: glab auth login"
    exit 1; }
  # No GH_HOST-style workaround here: unlike `gh api`, `glab api` and `glab issue` /
  # `glab mr` already resolve the host from the repo's origin remote.
fi
```

Print: `VCS host: {VCS_HOST} (via {CLI_TOOL})`, and carry `VCS_HOST` / `CLI_TOOL`
(plus `GH_HOST` on GitHub) through every later phase rather than re-detecting.

#### Rules this encodes

- **Never infer GitLab from a GitHub auth failure**, or the reverse. The remote picks
  the forge; credentials only gate whether the run can proceed on it.
- **Every abort above is non-mutating** — it happens before any branch, worktree,
  issue, or PR/MR is created, so an unsupported or ambiguous remote, or a checkout
  whose only authenticated CLI belongs to the *other* service, stops the run with an
  actionable message instead of writing to the wrong forge.
- **Credentials for the wrong service are not a fallback.** A GitLab checkout on a
  machine authenticated only to GitHub stops here; it does not silently run as
  GitHub.
