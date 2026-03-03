---
description: Commit, push, and open a PR against the repo's default branch
---

## Detect Branches

1. **Detect the default branch** — run `gh repo view --json defaultBranchRef -q '.defaultBranchRef.name'` to get the repo's default branch (e.g., `main`, `master`, `develop`)
2. **Determine the current branch** — use `git branch --show-current`
3. If you're already on the default branch, commit to a new feature branch named after the work being done
4. The PR will target the **default branch** as base

Print: `PR flow: {current_branch} → {default_branch}`

## Commit and Push

- Commit all changes to the current branch
- Keep commit message concise and do not use co-author information
- Push the branch to remote: `git pull --rebase --autostash && git push -u origin {current_branch}`

## Local Code Review (before opening PR)

Before creating the PR, perform a thorough self-review. Read each changed file — not just the diff — to understand how the changes behave at runtime.

1. Run `git diff {default_branch}...{current_branch}` to see the full diff
2. **For each changed file**, read the full file (not just the diff hunks) and check:

!`cat ~/.claude/lib/code-review-checklist.md`

3. If issues are found, fix them and amend/recommit before proceeding
4. Summarize the review findings (even if clean) so the user can see what was checked

## Open the PR

- Create a PR from `{current_branch}` to `{default_branch}`
- Create a rich PR description — no co-author or "generated with" messages

**IMPORTANT**: During each fix cycle in the Copilot review loop below, after fixing all review comments and before pushing, also bump the patch version (`npm version patch --no-git-tag-version` or equivalent) and commit the version bump.

!`cat ~/.claude/lib/copilot-review-loop.md`

**Report the final status** to the user including PR URL and review outcome.
