---
description: Commit, push to fork, and open a PR against the upstream repo
---

# Fork PR (fpr)

Commit changes, push to your fork, and open a pull request against the upstream (parent) repository.

## Detect Fork Relationship

1. **Verify this is a fork** — run:
   ```bash
   gh repo view --json isFork,parent,owner,name,defaultBranchRef
   ```
   - If `isFork` is `false` or `parent` is null: STOP and tell the user this repo is not a fork. Suggest using `/pr` instead.

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
   git remote get-url upstream 2>/dev/null || git remote add upstream "https://github.com/{UPSTREAM_OWNER}/{UPSTREAM_REPO}.git"
   ```
2. Fetch upstream: `git fetch upstream`
3. If on the fork's default branch and there are upstream changes, rebase:
   ```bash
   git rebase upstream/{UPSTREAM_DEFAULT_BRANCH}
   ```
   If rebase conflicts occur, abort and inform the user — do not auto-resolve.

## Commit and Push

1. **Identify changes to commit**:
   - Run `git status` and `git diff --stat` to see what changed
   - If there are no changes, inform the user and stop
   - Do NOT use `git add -A` or `git add .` — add specific files by name

2. **Commit**:
   - Write a clear, concise commit message describing the changes
   - Use conventional commit prefixes: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`
   - Do NOT include Co-Authored-By or generated-by annotations
   - Do NOT bump version or update changelog — upstream controls those

3. **Push to fork**:
   ```bash
   git push -u origin {CURRENT_BRANCH}
   ```

## Local Code Review (before opening PR)

1. Fetch upstream default branch for accurate diff:
   ```bash
   git fetch upstream {UPSTREAM_DEFAULT_BRANCH}
   ```
2. Run `git diff upstream/{UPSTREAM_DEFAULT_BRANCH}...{CURRENT_BRANCH}` to see the full diff against upstream
3. **For each changed file**, read the full file (not just the diff hunks) and check:

!`cat ~/.claude/lib/code-review-checklist.md`
4. If issues are found, fix them, recommit, and push before proceeding
5. Summarize the review findings so the user can see what was checked

## Check for Upstream Contributing Guidelines

Before opening the PR, check if upstream has contribution guidelines:
- Look for `CONTRIBUTING.md`, `.github/PULL_REQUEST_TEMPLATE.md`, or similar
- If a PR template exists, use it for the PR body structure
- If contribution guidelines mention branch naming, commit format, or other requirements, flag any violations to the user

## Open the PR

Create a cross-fork PR targeting the upstream repo:

```bash
gh pr create \
  --repo {UPSTREAM_OWNER}/{UPSTREAM_REPO} \
  --head {FORK_OWNER}:{CURRENT_BRANCH} \
  --base {UPSTREAM_DEFAULT_BRANCH} \
  --title "PR title here" \
  --body "PR description here"
```

- Write a clear title and rich description
- If a PR template was found, follow its structure
- Do NOT include co-author or "generated with" messages
- Print the resulting PR URL so the user can review it

## Important

- Never stage files you didn't edit
- Never use `git add -A` or `git add .`
- Do NOT bump versions or update changelogs — upstream maintainers control those
- Do NOT merge the PR — upstream maintainers handle that
- Do NOT run Copilot review loops — you don't control the upstream repo's review settings
- If the fork is significantly behind upstream, warn the user about potential merge conflicts
