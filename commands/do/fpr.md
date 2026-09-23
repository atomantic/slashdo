---
description: Commit, push to fork, and open a PR against the upstream repo
---

# Fork PR (fpr)

Commit changes, push to your fork, and open a pull request against the upstream (parent) repository.

## Detect Fork Relationship

1. **Resolve the fork from the authoritative `origin`.** The shared preflight selects the forge from the remote, confirms that CLI can read the checkout, rejects unsupported forges, and seeds `{GH_HOST}`. `/do:fpr` supports GitHub only:

   !read lib/vcs-host.md

   If `CLI_TOOL` is not `gh`, stop and report that `/do:fpr` requires a GitHub origin.

   By convention `origin` is the user's push target. A bare `gh repo view` can select the wrong repository when both `origin` and `upstream` exist, so derive its slug and pass the full host-qualified name explicitly:

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

2. **Extract upstream info** from the `parent` field:
   - `UPSTREAM_OWNER` = `parent.owner.login`
   - `UPSTREAM_REPO` = `parent.name`
   - `UPSTREAM_DEFAULT_BRANCH` = `parent.defaultBranchRef.name`

3. **Extract fork info**:
   - `FORK_OWNER` = `owner.login`
   - `FORK_DEFAULT_BRANCH` = `defaultBranchRef.name`
   - `CURRENT_BRANCH` = output of `git branch --show-current`

4. Print: `Fork PR flow: {FORK_OWNER}/{CURRENT_BRANCH} → {UPSTREAM_OWNER}/{UPSTREAM_REPO}:{UPSTREAM_DEFAULT_BRANCH}`

## Sync with Upstream

Before committing, ensure the fork is up to date with upstream:

1. Add upstream remote if missing:
   ```bash
   # Built from the derived {GH_HOST}, so an Enterprise fork gets an Enterprise upstream —
   # a literal github.com here would add a remote that 404s on every Enterprise install.
   git remote get-url upstream 2>/dev/null || git remote add upstream "https://{GH_HOST}/{UPSTREAM_OWNER}/{UPSTREAM_REPO}.git"
   ```
2. Fetch upstream: `git fetch upstream`
3. If on the fork's default branch and there are upstream changes, rebase with autostash to preserve uncommitted edits:
   ```bash
   git rebase --autostash upstream/{UPSTREAM_DEFAULT_BRANCH}
   ```
   If rebase conflicts occur, abort and inform the user — do not auto-resolve.

## Commit and Push

1. **If on the fork's default branch, create a feature branch first:**
   - Check if `{CURRENT_BRANCH}` equals `{FORK_DEFAULT_BRANCH}`
   - If so, create a feature branch named for the change (e.g. `git checkout -b fix/<short-description>`) so the PR doesn't tie up the fork's default branch
   - Update `{CURRENT_BRANCH}` to the new branch name and print the new flow

2. **Identify changes to commit**:
   - Run `git status` and `git diff --stat` to see what changed
   - If there are no changes, inform the user and stop
   - Do NOT use `git add -A` or `git add .` — add specific files by name

3. **Commit** following these conventions (and write no changelog entry — upstream controls that):

!`cat ~/.claude/lib/commit-conventions.md`

4. **Push to fork**:
   ```bash
   git push -u origin {CURRENT_BRANCH}
   ```

## Local Code Review (REQUIRED GATE)

Fork PRs go to upstream maintainers who can't easily ask for changes — getting it right the first time matters more here than on internal PRs.

<review_gate>

1. Fetch upstream default branch for accurate diff:
   ```bash
   git fetch upstream {UPSTREAM_DEFAULT_BRANCH}
   ```
2. Run `git diff upstream/{UPSTREAM_DEFAULT_BRANCH}...{CURRENT_BRANCH}` to get the list of changed files
3. For every changed file:
   a. Read the entire file using the Read tool (not just diff hunks)
   b. Review it under the review preferences below
   c. For each finding, quote the specific code line and explain why it's a problem
4. After reviewing all files, verify: does the code actually deliver what the commits claim?
5. Print a review summary table: | finding | file | line | severity | fixable |
6. **Worthiness check**: Classify all findings before acting on them:
   - **Fix and recommit** any finding that touches correctness, security, logic, data integrity, or API contracts
   - **Note but don't block** on pure style nitpicks, naming preferences, or "consider..." suggestions — if ALL findings are this type, proceed without fixing and mention them briefly in the PR description
7. **Push fix commits** to the remote if any were made:
   ```bash
   git push -u origin {CURRENT_BRANCH}
   ```
8. Only after printing the review summary may you proceed to "Open the PR"

If the diff touches more than 15 files, delegate later batches to a subagent to keep context clean.

</review_gate>

Review preferences to apply to each file:

!`cat ~/.claude/lib/review-preferences.md`

Verification — confirm before proceeding:
- [ ] Read every changed file in full (not just diffs)
- [ ] Every finding names a concrete wrong outcome, not a style preference
- [ ] Quoted specific code for each finding
- [ ] Printed a review summary table with findings

## Check for Upstream Contributing Guidelines

Before opening the PR, check if upstream has contribution guidelines:
- Look for `CONTRIBUTING.md`, `.github/PULL_REQUEST_TEMPLATE.md`, or similar
- If a PR template exists, use it for the PR body structure
- If contribution guidelines mention branch naming, commit format, or other requirements, flag any violations to the user

## Open the PR

Create a cross-fork PR targeting the upstream repo:

```bash
gh pr create \
  --repo {GH_HOST}/{UPSTREAM_OWNER}/{UPSTREAM_REPO} \
  --head {FORK_OWNER}:{CURRENT_BRANCH} \
  --base {UPSTREAM_DEFAULT_BRANCH} \
  --title "PR title here" \
  --body "PR description here"
```

- Write a clear title and rich description
- If a PR template was found, follow its structure
- Print the resulting PR URL so the user can review it

## Important

- Do NOT merge the PR — upstream maintainers handle that
- If the fork is significantly behind upstream, warn the user about potential merge conflicts
