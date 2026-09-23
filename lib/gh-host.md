### Deriving the GitHub API host (`GH_HOST`) for `gh api`

`gh api` (REST and `graphql`) does **not** derive its host from the git remote — unlike
`gh pr` / `gh repo` / `gh issue`, it hard-defaults to `github.com` unless `--hostname` or
`GH_HOST` is set, even when `{owner}`/`{repo}` placeholders are filled from the local
repo. On a GitHub Enterprise repo every unqualified `gh api` call silently hits
github.com: REST calls 404, `gh api user` returns the wrong identity, reviewer polls wait
forever. Carry one trusted host — from the checkout in local mode or the PR URL in PR
mode — on **every** `gh api` call; an ambient GitHub login never selects it.

#### Derive `{GH_HOST}`

If `GH_HOST` is already seeded, keep it. Otherwise parse the `origin` remote host (SSH
`git@host:org/repo.git` / `ssh://git@host/...` or HTTPS `https://host/...`):

```bash
[ -n "$GH_HOST" ] || GH_HOST=$(git remote get-url origin 2>/dev/null \
  | sed -E 's#^[a-z]+://##; s#^[^@/]+@##; s#[:/].*$##')
# Fallbacks if there is no origin or the parse came back empty:
[ -n "$GH_HOST" ] || GH_HOST=$(gh repo view --json url --jq '.url' 2>/dev/null | awk -F/ '{print $3}')
[ -n "$GH_HOST" ] || GH_HOST=github.com
```

Carry `{GH_HOST}` for the rest of the run, like `{OWNER}` / `{REPO}` / `{PR_NUMBER}`.

#### Confirm `gh` is authenticated to that host

```bash
gh auth token --hostname "$GH_HOST" >/dev/null 2>&1 \
  || { echo "gh is not authenticated to $GH_HOST. Run: gh auth login --hostname $GH_HOST"; exit 1; }
```

#### Pass it on every `gh api` call

Insert `--hostname {GH_HOST}` (or `--hostname "$GH_HOST"` for a live shell var) before
the subcommand in each `gh api` / `gh api graphql` invocation:

```bash
gh api --hostname {GH_HOST} repos/{OWNER}/{REPO}/pulls/{PR_NUMBER}/requested_reviewers -f 'reviewers[]={REVIEWER_LOGIN}'
... | gh api --hostname {GH_HOST} graphql --input -
gh api --hostname {GH_HOST} user -q .login
```

`gh pr` / `gh repo` / `gh issue` / `gh pr checks` / `gh pr merge` resolve the host from
the remote themselves — leave them as-is.
