---
description: Commit, push to fork, and open a PR against the upstream repo
---

# Fork PR (fpr)

Commit changes, push to your fork, and open a pull request against the upstream (parent) repository.

## Detect Fork Relationship

1. **Resolve the fork from the `origin` remote** — by convention `origin` is the user's push target. A bare `gh repo view` can pick the wrong repo when both `origin` and `upstream` remotes exist (or when the user's default login resolves elsewhere), so always pass the origin slug explicitly.

   **Derive the host; never hardcode `github.com`.** A GitHub Enterprise fork lives on the customer's own domain — `github.example.com`, and just as often one with no `github` substring at all (`git.example.com`, `scm.internal`) — so matching the remote against a literal `github.com` rejects every Enterprise fork outright. Split the remote into host and slug instead, and use `gh` itself as the arbiter of whether the host is a GitHub the user is authenticated to:
   ```sh
   # Strip trailing slash first so a `.git/` suffix still gets removed; then strip `.git`.
   ORIGIN_URL=$(git remote get-url origin 2>/dev/null || true)
   ORIGIN_HOST=$(printf '%s\n' "$ORIGIN_URL" | sed -E 's#^[a-z]+://##; s#^[^@/]+@##; s#[:/].*$##')
   # Anchor the strip on the derived host, not on a literal domain. Match `$ORIGIN_HOST`
   # followed by the `:` (SSH) or `/` (HTTPS) separator — anything before it is scheme/userinfo.
   ORIGIN_SLUG=$(printf '%s\n' "$ORIGIN_URL" | sed -E "s|/+$||; s|.*$ORIGIN_HOST[:/]||; s|\.git$||; s|/+$||")
   # Guard (POSIX): slug must be exactly OWNER/REPO (one slash, no whitespace) AND a host must
   # have parsed out — otherwise a remote whose path merely looks like owner/repo (a bare local
   # path, say) would slip through.
   case "$ORIGIN_SLUG" in
     ""|*/*/*|*[[:space:]]*) VALID=no ;;
     */*)                    VALID=yes ;;
     *)                      VALID=no ;;
   esac
   [ -n "$ORIGIN_HOST" ] || VALID=no
   # A GitLab remote reaches here with a well-formed slug, so let `gh` reject it: authenticating
   # to the host is the portable test for "this is a GitHub we can talk to", and it is the same
   # test on github.com and on any Enterprise domain.
   if [ "$VALID" = "yes" ] && gh auth token --hostname "$ORIGIN_HOST" >/dev/null 2>&1; then
     GH_HOST="$ORIGIN_HOST"
     gh repo view "$GH_HOST/$ORIGIN_SLUG" --json isFork,parent,owner,name,defaultBranchRef
   else
     echo "ERROR: origin is missing, is not a repo gh can reach, or gh is not authenticated to its host (origin URL: '$ORIGIN_URL', host: '$ORIGIN_HOST', slug: '$ORIGIN_SLUG'). Add an 'origin' remote pointing at your fork and run: gh auth login --hostname $ORIGIN_HOST" >&2
     # No `exit` — this snippet may be pasted into an interactive shell; the caller should stop here.
   fi
   ```
   - If the guard prints the ERROR above: STOP and relay it — the user needs an `origin` remote pointing at their fork on a GitHub host `gh` is logged in to.
   - Carry `{GH_HOST}` for the rest of the run; every URL this command prints or writes is built from it, never from a literal `github.com`.
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
   # Built from the derived {GH_HOST}, so an Enterprise fork gets an Enterprise upstream —
   # a literal github.com here would add a remote that 404s on every Enterprise install.
   git remote get-url upstream 2>/dev/null || git remote add upstream "https://{GH_HOST}/{UPSTREAM_OWNER}/{UPSTREAM_REPO}.git"
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
- Do NOT run Copilot review loops — you don't control the upstream repo's review settings
- If the fork is significantly behind upstream, warn the user about potential merge conflicts
