### Deriving the GitHub API host (`GH_HOST`) for `gh api`

`gh api` (REST and `graphql`) does **not** take its host from the git remote: without
`--hostname` it hits `github.com`, so on a GitHub Enterprise repo it 404s, returns the
wrong `user`, or polls forever. Derive one trusted host — the checkout's in local mode,
the PR URL's in PR mode; an ambient login never selects it — and keep an already-seeded
`GH_HOST`:

```bash
[ -n "$GH_HOST" ] || GH_HOST=$(git remote get-url origin 2>/dev/null \
  | sed -E 's#^[a-z]+://##; s#^[^@/]+@##; s#[:/].*$##')
[ -n "$GH_HOST" ] || GH_HOST=$(gh repo view --json url --jq '.url' 2>/dev/null | awk -F/ '{print $3}')
[ -n "$GH_HOST" ] || GH_HOST=github.com
gh auth token --hostname "$GH_HOST" >/dev/null 2>&1 \
  || { echo "gh is not authenticated to $GH_HOST. Run: gh auth login --hostname $GH_HOST"; exit 1; }
```

Carry `{GH_HOST}` for the rest of the run and put `--hostname {GH_HOST}` before the
subcommand of **every** `gh api` / `gh api graphql` call (e.g.
`gh api --hostname {GH_HOST} user -q .login`). `gh pr` / `gh repo` / `gh issue` resolve
the host themselves — leave them as-is.
