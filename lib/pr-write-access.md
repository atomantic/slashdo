### Can we push to the PR's head branch? (`{CAN_PUSH_HEAD}`)

**Why this exists.** A review that can *land* its own fixes is worth far more than one
that files them as comments the author has to re-apply by hand — but only when the PR's
head branch actually accepts our push. That is not the same question as "do we own this
repo": a fork-to-upstream PR lives on someone else's fork, and an upstream maintainer can
push to it **only** when the author left *Allow edits by maintainers* on. So probe the
capability first, then pick the disposition — push fixes when we can, post inline review
comments when we can't. Never assume one or the other from the repo slug.

Requires `{GH_HOST}` (derive it first — see `~/.claude/lib/gh-host.md`), the **base** repo
`{OWNER}/{REPO}`, and `{PR_NUM}`.

#### Probe

```bash
gh pr view {PR_NUM} --repo "$GH_HOST/{OWNER}/{REPO}" \
  --json state,isDraft,isCrossRepository,maintainerCanModify,headRefName,headRepositoryOwner,headRepository
```

Record `HEAD_OWNER` (`.headRepositoryOwner.login`), `HEAD_REPO` (`.headRepository.name`),
and `HEAD_REF` (`.headRefName`). If `state` is not `OPEN`, or `headRepository` is `null`
(the fork was deleted after the PR was opened), set `CAN_PUSH_HEAD=false` and stop here —
there is no live branch to push to.

Then ask the API for the actual permission bits rather than inferring them from a login
comparison (a login match misses org-owned forks and collaborator grants in both
directions):

```bash
HEAD_PUSH=$(gh api --hostname "$GH_HOST" "repos/$HEAD_OWNER/$HEAD_REPO" --jq '.permissions.push // false' 2>/dev/null || echo false)
BASE_PUSH=$(gh api --hostname "$GH_HOST" "repos/{OWNER}/{REPO}" --jq '.permissions.push // false' 2>/dev/null || echo false)
```

#### Decide

Set `CAN_PUSH_HEAD=true` when **either** holds:

1. `HEAD_PUSH=true` — we have push on the repository that owns the head branch. Covers the
   ordinary same-repo PR and the case where we're a collaborator on the fork.
2. `isCrossRepository=true` **and** `maintainerCanModify=true` **and** `BASE_PUSH=true` —
   the fork-PR case: the author allowed maintainer edits and we maintain the base repo.

Otherwise `CAN_PUSH_HEAD=false`.

#### A `false` is a routing signal, never an error

`maintainerCanModify` reads `false` in several ordinary situations that are not
misconfiguration and must not abort the run: a fork owned by an **organization** (GitHub
offers the *Allow edits by maintainers* checkbox only on user-owned forks), a PR whose
author deliberately turned it off, and any query made by an account that isn't a
maintainer of the base repo. All of them mean the same thing — **review inline** — and the
command continues normally. Say which disposition was chosen and why in one line
(`Fork PR and maintainer edits are off — posting inline review comments instead of fixes`)
so the outcome is never mistaken for a failure.

#### Pushing

Check the branch out with `gh pr checkout`, never a hand-built `git fetch` + `git checkout`:
it configures the head repo's remote and the upstream tracking ref for you — including for
cross-repo PRs — so the later push targets the author's branch instead of creating a stray
branch on the base repo.

```bash
gh pr checkout {PR_NUM} --repo "$GH_HOST/{OWNER}/{REPO}"
```

Push with `git push` alone (no remote/refspec arguments) so it follows that tracking ref.

**A push can still be refused at the wire even when the probe said yes** — a token without
the scope for the head repo's owner, a branch protection rule on the fork, a repository
that went archived/read-only, or the author flipping the setting off mid-review. Treat a
failed push as a **downgrade, not an abort**: keep the commits locally, fall back to
posting the very same findings as inline review comments, and state in the review body
that the fixes were prepared but could not be pushed, so the author knows to apply them.
