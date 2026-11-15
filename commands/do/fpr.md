---
description: Commit, push to fork, and open a PR against the upstream repo
---

# Fork PR (fpr)

Commit changes, push to your fork, and open a pull request (GitHub) or merge
request (GitLab) against the upstream (parent) repository.

## Detect Fork Relationship

1. **Resolve the fork from the authoritative `origin`.** The shared preflight selects the forge from the remote, confirms that CLI can read the checkout, rejects unsupported forges, and seeds `{GH_HOST}`/`{ORIGIN_HOST}` and `{CR_NOUN}`. `/do:fpr` supports GitHub and GitLab; any other forge from the preflight is unsupported here:

   !read lib/vcs-host.md

   On **GitHub** (`CLI_TOOL=gh`): by convention `origin` is the user's push target. A bare `gh repo view` can select the wrong repository when both `origin` and `upstream` exist, so derive its slug and pass the full host-qualified name explicitly:

   ```sh
   ORIGIN_URL=$(git remote get-url origin 2>/dev/null || true)
   ORIGIN_PATH="${ORIGIN_URL#*://}"
   ORIGIN_PATH="${ORIGIN_PATH#*@}"
   ORIGIN_PATH="${ORIGIN_PATH#"$GH_HOST"}"
   ORIGIN_PATH="${ORIGIN_PATH#[/:]}"
   ORIGIN_PATH="${ORIGIN_PATH%/}"
   ORIGIN_SLUG="${ORIGIN_PATH%.git}"
   ORIGIN_SLUG="${ORIGIN_SLUG%/}"
   gh repo view "$GH_HOST/$ORIGIN_SLUG" --json isFork,parent,owner,name,defaultBranchRef || exit 1
   ```

   - If `isFork` is `false` or `parent` is null: STOP and tell the user this repo is not a fork. Suggest using `/do:pr` instead.

   On **GitLab** (`CLI_TOOL=glab`): read the current project once; GitLab's REST
   representation of a fork carries a `forked_from_project` object (absent on a
   non-fork), together with the numeric project id `glab mr create --target-project`
   needs later:

   ```sh
   PROJECT_JSON="$(glab api "projects/:id")" || exit 1
   IS_FORK="$(printf '%s' "$PROJECT_JSON" | jq -r 'has("forked_from_project") and (.forked_from_project != null)')"
   ```

   - If `IS_FORK` is not `true`: STOP and tell the user this repo is not a fork. Suggest using `/do:pr` instead.

2. **Extract upstream info**:
   - GitHub, from the `parent` field: `UPSTREAM_OWNER` = `parent.owner.login`, `UPSTREAM_REPO` = `parent.name`, `UPSTREAM_DEFAULT_BRANCH` = `parent.defaultBranchRef.name`
   - GitLab, from `forked_from_project` on `{PROJECT_JSON}`: `UPSTREAM_PROJECT_ID` = `.forked_from_project.id` (the numeric id `--target-project` requires, not a slug), `UPSTREAM_DEFAULT_BRANCH` = `.forked_from_project.default_branch`, and split `.forked_from_project.path_with_namespace` on the last `/` into `UPSTREAM_OWNER` (namespace) and `UPSTREAM_REPO` (project path)

3. **Extract fork info**:
   - GitHub: `FORK_OWNER` = `owner.login`, `FORK_DEFAULT_BRANCH` = `defaultBranchRef.name`
   - GitLab: split `{PROJECT_JSON}`'s own `.path_with_namespace` the same way into `FORK_OWNER`; `FORK_DEFAULT_BRANCH` = `.default_branch`
   - Both hosts: `CURRENT_BRANCH` = output of `git branch --show-current`

4. Print: `Fork {CR_NOUN} flow: {FORK_OWNER}/{CURRENT_BRANCH} → {UPSTREAM_OWNER}/{UPSTREAM_REPO}:{UPSTREAM_DEFAULT_BRANCH}`

## Sync with Upstream

Before committing, ensure the fork is up to date with upstream:

1. Add upstream remote if missing:
   ```bash
   # Built from the derived {GH_HOST}, so an Enterprise fork gets an Enterprise upstream —
   # a literal github.com here would add a remote that 404s on every Enterprise install.
   git remote get-url upstream 2>/dev/null || git remote add upstream "https://{GH_HOST}/{UPSTREAM_OWNER}/{UPSTREAM_REPO}.git"
   ```
   On GitLab, build the same remote from `{ORIGIN_HOST}` — already resolved by
   `lib/vcs-host.md` above, never re-derived here; GitLab has no separate
   API-host indirection the way `gh api` needs `{GH_HOST}`:
   ```bash
   git remote get-url upstream 2>/dev/null || git remote add upstream "https://{ORIGIN_HOST}/{UPSTREAM_OWNER}/{UPSTREAM_REPO}.git"
   ```
2. Fetch upstream: `git fetch upstream`
3. If on the fork's default branch and there are upstream changes, rebase with autostash to preserve uncommitted edits:
   ```bash
   git rebase --autostash upstream/{UPSTREAM_DEFAULT_BRANCH}
   ```
   If the rebase conflicts, resolve it and continue per [lib/rebase-conflict-resolution.md](../../lib/rebase-conflict-resolution.md); abort only under that playbook's last-resort rule, and then tell the user what was ambiguous.

## Read Upstream's Contribution Rules

Upstream's rules shape the branch, the commits and the PR, so read them before committing:

- `CONTRIBUTING.md` (repo root, `.github/` or `docs/`) and any agent or developer guide it points to: branch naming, commit format, sign-off (DCO) or CLA requirements, required tests, changelog expectations.
- The PR/MR template: `.github/PULL_REQUEST_TEMPLATE.md` or a file under `.github/PULL_REQUEST_TEMPLATE/` (also at the repo root or under `docs/`), or `.gitlab/merge_request_templates/` on GitLab.

Follow what they say in the steps below; they take precedence over this command's defaults. If existing commits on the branch already break a rule you cannot fix without rewriting the user's history, tell the user rather than rewriting it.

## Commit and Push

1. **If on the fork's default branch, create a feature branch first** (`{CURRENT_BRANCH}` equals `{FORK_DEFAULT_BRANCH}`), named per upstream's branch convention, else for the change (e.g. `git checkout -b fix/<short-description>`), so the PR doesn't tie up the fork's default branch. Update `{CURRENT_BRANCH}` and print the new flow.

2. **Identify changes to commit**: run `git status` and `git diff --stat`. If there are no changes and no unpushed commits, tell the user and stop. Add files by name rather than `git add -A` / `git add .`, which sweep in unrelated files.

3. **Commit** following upstream's commit rules. Where upstream states none, these are the fallback (and write no changelog entry unless upstream asks contributors for one):

!`cat ~/.claude/lib/commit-conventions.md 2>/dev/null || cat "$(dirname "$(readlink -f .claude/commands/do/fpr.md)")/../../lib/commit-conventions.md"`

4. **Push to fork**:
   ```bash
   git push -u origin {CURRENT_BRANCH}
   ```

## Local Code Review (REQUIRED GATE)

Upstream maintainers cannot easily ask a fork contributor for changes, so getting it right the first time matters more here than on an internal PR.

<review_gate>

1. Fetch the upstream default branch for an accurate diff: `git fetch upstream {UPSTREAM_DEFAULT_BRANCH}`
2. List the changed files with `git diff --name-only upstream/{UPSTREAM_DEFAULT_BRANCH}...{CURRENT_BRANCH}`
3. For every changed file, read the whole file, not only the diff hunks, and review it under the review preferences below. Each finding quotes the specific line and names the concrete wrong outcome.
4. Check that the code delivers what the commits claim.
5. Print a review summary table: | finding | file | line | severity | fixable |
6. Fix and recommit any finding that touches correctness, security, logic, data integrity or API contracts. Pure style or naming suggestions do not block: mention them briefly in the PR description instead.
7. Push any fix commits: `git push -u origin {CURRENT_BRANCH}`
8. Continue to "Open the {CR_NOUN}" only after printing the summary table.

If the diff touches more than 15 files, delegate later batches to a sub-agent to keep context clean.

</review_gate>

Review preferences to apply to each file:

!`cat ~/.claude/lib/review-preferences.md 2>/dev/null || cat "$(dirname "$(readlink -f .claude/commands/do/fpr.md)")/../../lib/review-preferences.md"`

## Open the {CR_NOUN}

Create a cross-fork PR (GitHub) or MR (GitLab) targeting the upstream repo.

On **GitHub**:

```bash
gh pr create \
  --repo {GH_HOST}/{UPSTREAM_OWNER}/{UPSTREAM_REPO} \
  --head {FORK_OWNER}:{CURRENT_BRANCH} \
  --base {UPSTREAM_DEFAULT_BRANCH} \
  --title "PR title here" \
  --body "PR description here"
```

On **GitLab** — run from inside the fork's own checkout (`origin` = the fork),
so `glab` infers the source project from `origin` and only the target needs
naming. `--target-project` takes the numeric `{UPSTREAM_PROJECT_ID}` from
"Detect Fork Relationship", not a path — GitLab's fork-MR endpoint resolves
the target by id, and a `namespace/project` string there is silently rejected:

```bash
glab mr create \
  --source-branch {CURRENT_BRANCH} \
  --target-branch {UPSTREAM_DEFAULT_BRANCH} \
  --target-project {UPSTREAM_PROJECT_ID} \
  --title "MR title here" \
  --description "MR description here" \
  --yes
```

- Fill in upstream's PR/MR template when it has one (passing `--body`/`--description` bypasses it, so the CLI will not apply it for you) and follow its title rules; otherwise write a clear title and a description of what changed, why, and how it was verified.
- Print the resulting {CR_NOUN} URL so the user can review it.

## Important

- Do not merge the {CR_NOUN}; upstream maintainers handle that.
- If the fork is significantly behind upstream, warn the user about potential merge conflicts.
