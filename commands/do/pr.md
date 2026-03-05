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

## Local Code Review (REQUIRED GATE — do NOT skip)

**STOP. You MUST complete this entire section before proceeding to "Open the PR". Do NOT skip, abbreviate, or summarize this review. Every changed file must be read in full and checked against the checklist. If you find yourself wanting to skip ahead — stop and do the review.**

1. Run `git diff {default_branch}...{current_branch}` to get the list of changed files
2. **For EVERY changed file** (no exceptions):
   a. **Read the ENTIRE file** using the Read tool — not just the diff hunks, not just a summary
   b. Check it against every item in the checklist below
   c. Record what you checked and any findings
3. After reviewing ALL files, print a review summary table (see do:review for format)
4. If issues are found, fix them and amend/recommit before proceeding
5. Only after printing the review summary may you proceed to "Open the PR"

Checklist to apply to each file:

!`cat ~/.claude/lib/code-review-checklist.md`

**Verification**: Before moving on, confirm you have:
- [ ] Read every changed file in full (not just diffs)
- [ ] Checked each file against the checklist above
- [ ] Printed a review summary table with findings

## Open the PR

- Create a PR from `{current_branch}` to `{default_branch}`
- Create a rich PR description

!`cat ~/.claude/lib/copilot-review-loop.md`

**Report the final status** to the user including PR URL and review outcome.
