---
description: Create a release PR using the project's documented release workflow
---

## Detect Release Workflow

Before doing anything, determine the project's source and target branches for releases. Do NOT hardcode branch names. Instead, discover them:

1. **Source branch** — run `gh repo view --json defaultBranchRef -q '.defaultBranchRef.name'` to get the repo's default branch
2. **Target branch** — determine by reading (in priority order):
   - **GitHub Actions workflows** — check `.github/workflows/release.yml` (or similar) for `on: push: branches:` to find the branch that triggers the release pipeline
   - **Project CLAUDE.md** — look for git workflow sections, branch descriptions, or release instructions
   - **Versioning docs** — check `docs/VERSIONING.md`, `CONTRIBUTING.md`, or `RELEASING.md`
   - **Branch convention** — if a `release` branch exists, the target is `release`; otherwise ask the user

Print the detected workflow: `Detected release flow: {source} → {target}`

If ambiguous, ask the user to confirm before proceeding.

## Pre-Release Checks

1. **Ensure you're on the source branch** — checkout if needed
2. **Pull latest** — `git pull --rebase --autostash`
3. **Run tests** — execute the project's test suite (check CLAUDE.md or package.json for the command)
4. **Run build** — execute the project's build command if one exists

## Determine Version and Finalize Changelog

1. **Determine version bump** from commits since the last git tag:
   - Scan commit messages for conventional commit prefixes:
     - `breaking:` → **major** bump
     - `feat:` → **minor** bump
     - `fix:`, `chore:`, `docs:`, `refactor:`, `perf:`, `style:`, `test:`, `ci:` → **patch** bump
   - Use the **highest applicable level** across all commits
   - Present the proposed version to the user for confirmation

2. **Bump version**: Run `npm version <major|minor|patch> --no-git-tag-version` to update `package.json` and `package-lock.json`

3. **Finalize changelog**:
   - Check for a changelog directory: `.changelogs/` or `.changelog/` (use whichever exists)
   - If `{changelog_dir}/NEXT.md` exists:
     - Rename it to `{changelog_dir}/v{new_version}.md`
     - Replace the `# Unreleased Changes` header with `# Release v{new_version}`
     - Add `Released: YYYY-MM-DD` with today's date
     - Add a `## Full Changelog` section with: `**Full Diff**: https://github.com/{owner}/{repo}/compare/v{prev}...v{new}`
   - If `NEXT.md` does not exist:
     - Generate a changelog from commit history since the last tag
     - Write it to `{changelog_dir}/v{new_version}.md`

4. **Commit the release**: Stage `package.json`, `package-lock.json`, and the changelog file. Commit with message `chore: release v{new_version}`

## Local Code Review (before opening PR)

Perform a thorough self-review. Read each changed file — not just the diff — to understand how the changes behave at runtime.

1. Run `git diff {target}...{source}` to see the full diff
2. **For each changed file**, read the full file (not just the diff hunks) and check:

!`cat ~/.claude/lib/code-review-checklist.md`

3. If issues are found, fix them, commit, and push before proceeding
4. Summarize the review findings (even if clean) so the user can see what was checked

## Open the Release PR

- Push the source branch to remote
- Create a PR from `{source}` to `{target}`
- Title: `Release v{version}` (read version from package.json or equivalent)
- Body: include the changelog content for this version if available, otherwise summarize commits since last release
- Keep the description clean — no co-author or "generated with" messages

**Note**: Do NOT bump the version for review fixes — the version was already set during the release preparation.

!`cat ~/.claude/lib/copilot-review-loop.md`

## Merge the PR (only after a CLEAN review with zero comments)

- **CRITICAL**: Do NOT merge until Copilot has submitted a review. A missing review is NOT the same as a clean review.
- Only merge after the latest Copilot review has been submitted AND that review generated **zero comments**. Check this by:
  1. Confirming a new review node exists with `submittedAt` after your last push
  2. Confirming the review body says "generated 0 comments" OR there are no new unresolved threads
- **Never merge if:**
  - No Copilot review was ever posted (review never arrived — ask user first)
  - "Awaiting requested review" is still shown (review in progress)
  - The latest review had comments that you fixed but you didn't get a CLEAN re-review
- Once confirmed clean, merge:
  ```bash
  gh pr merge <number> --merge
  ```
- Verify the merge succeeded: `gh pr view <number> --json state,mergedAt`

## Post-Merge

- Report the final status including version, PR URL, and merge state
- Remind the user to check for the GitHub release once CI completes (if the project uses automated releases)
- Switch back to the source branch locally: `git checkout {source} && git pull --rebase --autostash`
