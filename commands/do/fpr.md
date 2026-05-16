---
description: Commit, push to fork, and open a PR against the upstream repo
---

# Fork PR (fpr)

Commit changes, push to your fork, and open a pull request against the upstream (parent) repository.

## Detect Fork Relationship

1. **Resolve the fork from the `origin` remote** — by convention `origin` is the user's push target. A bare `gh repo view` can pick the wrong repo when both `origin` and `upstream` remotes exist (or when the user's default login resolves elsewhere), so always pass the origin slug explicitly:
   ```bash
   # Strip trailing slash first so a `.git/` suffix still gets removed; then strip `.git`.
   ORIGIN_SLUG=$(git remote get-url origin 2>/dev/null | sed -E 's|/+$||; s|.*github\.com[:/]||; s|\.git$||; s|/+$||')
   # Guard: must be a non-empty OWNER/REPO slug (no scheme, exactly one slash, no spaces).
   if [[ -z "$ORIGIN_SLUG" || ! "$ORIGIN_SLUG" =~ ^[^/[:space:]]+/[^/[:space:]]+$ ]]; then
     echo "ERROR: origin remote is missing or not a GitHub URL (got: '$ORIGIN_SLUG'). Add a GitHub 'origin' remote pointing at your fork." >&2
     exit 1
   fi
   gh repo view "$ORIGIN_SLUG" --json isFork,parent,owner,name,defaultBranchRef
   ```
   - If `origin` is not set or the URL is not a GitHub URL: the guard above stops execution — tell the user to add a GitHub `origin` remote pointing at their fork.
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
   b. Check it against the tiered checklist below (always check Tiers 1+4; check Tiers 2-3 when relevance filters match)
   c. For each finding, quote the specific code line and explain why it's a problem
4. After reviewing all files, verify: does the code actually deliver what the commits claim?
5. Print a review summary table (see do:review for format)
6. **Worthiness check**: Classify all findings before acting on them:
   - **Fix and recommit** any finding that touches correctness, security, logic, data integrity, or API contracts
   - **Note but don't block** on pure style nitpicks, naming preferences, or "consider..." suggestions — if ALL findings are this type, proceed without fixing and mention them briefly in the PR description
7. Only after printing the review summary may you proceed to "Open the PR"

If the diff touches more than 15 files, delegate later batches to a subagent to keep context clean.

</review_gate>

Checklist to apply to each file:

!`cat ~/.claude/lib/code-review-checklist.md`

Verification — confirm before proceeding:
- [ ] Read every changed file in full (not just diffs)
- [ ] Checked each file against the relevant checklist tiers
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
  --repo {UPSTREAM_OWNER}/{UPSTREAM_REPO} \
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
- Do NOT run Copilot review loops — you don't control the upstream repo's review settings
- If the fork is significantly behind upstream, warn the user about potential merge conflicts
