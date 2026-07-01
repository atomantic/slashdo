## Deriving the GitHub API host (`GH_HOST`) for `gh api`

**Why this exists.** `gh api` — both `gh api <REST path>` and `gh api graphql` — does
**not** derive its target host from the repository's git remote. It hard-defaults to
`github.com` unless you pass `--hostname` or set the `GH_HOST` environment variable.
This is unlike `gh pr` / `gh repo` / `gh issue`, which *do* infer the host from the
remote. So on a GitHub Enterprise repo (e.g. `github.example.com`) every unqualified
`gh api` call silently talks to github.com instead: REST calls 404, `gh api user`
returns the wrong identity, and reviewer-poll loops wait forever for a review that
will never appear on github.com. Even the `{owner}`/`{repo}` placeholders don't help —
`gh` fills them from the local repo but still sends the request to github.com.

The fix is to derive the host once from the `origin` remote and pass it explicitly on
**every** `gh api` call. This is correct for everyone at zero configuration cost:
github.com repos derive `github.com` (identical to today), Enterprise repos derive
their own host, and a developer working across several hosts gets the right one
per repo without any global env var (a global `GH_HOST` would break their other hosts).

### Derive `{GH_HOST}`

Parse the `origin` remote host (handles both SSH — `git@host:org/repo.git`,
`ssh://git@host/...` — and HTTPS — `https://host/...` — remotes):

```bash
GH_HOST=$(git remote get-url origin 2>/dev/null \
  | sed -E 's#^(https?://|ssh://git@|git@)([^/:]+).*#\2#')
# Fallbacks if there is no origin or the parse came back empty:
[ -n "$GH_HOST" ] || GH_HOST=$(gh repo view --json url --jq '.url' 2>/dev/null | awk -F/ '{print $3}')
[ -n "$GH_HOST" ] || GH_HOST=github.com
```

Record the result as `{GH_HOST}` — a value you carry for the rest of the run and
substitute into every `gh api` call, the same way you already carry `{OWNER}` /
`{REPO}` / `{PR_NUMBER}` and substitute them into request paths.

### Confirm `gh` is authenticated to that host

Turns a silent, mysterious github.com timeout into an actionable message:

```bash
gh auth token --hostname "$GH_HOST" >/dev/null 2>&1 \
  || { echo "gh is not authenticated to $GH_HOST. Run: gh auth login --hostname $GH_HOST"; exit 1; }
```

### Pass it on every `gh api` call

Insert `--hostname {GH_HOST}` (or `--hostname "$GH_HOST"` when it's a live shell var)
into each `gh api` / `gh api graphql` invocation — it goes before the subcommand:

```bash
gh api --hostname {GH_HOST} repos/{OWNER}/{REPO}/pulls/{PR_NUMBER}/requested_reviewers -f 'reviewers[]={REVIEWER_LOGIN}'
... | gh api --hostname {GH_HOST} graphql --input -
gh api --hostname {GH_HOST} user -q .login
```

`gh pr` / `gh repo` / `gh issue` / `gh pr checks` / `gh pr merge` calls do **not** need
`--hostname` — they already resolve the host from the remote — so leave them as-is.
