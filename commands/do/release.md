---
description: Create a release PR using the project's documented release workflow
argument-hint: "[--interactive]"
---

**Default mode: fully autonomous.** Auto-detects branches, determines version bump from commits, runs review, creates and merges the release PR without prompting.

**`--interactive` mode:** Pauses for branch confirmation, version approval, and merge confirmation.

## Detect Release Workflow

Before doing anything, determine the project's source and target branches for releases. Do NOT hardcode branch names. Instead, discover them:

1. **Source branch** — run `gh repo view --json defaultBranchRef -q '.defaultBranchRef.name'` to get the repo's default branch (typically `main`)
2. **Target branch** — determine by reading (in priority order):
   - **GitHub Actions workflows** — check `.github/workflows/release.yml` (or similar) for `on: push: branches:` to find the branch that triggers the release pipeline
   - **Project conventions** (already in context) — look for git workflow sections, branch descriptions, or release instructions
   - **Versioning docs** — check `docs/VERSIONING.md`, `CONTRIBUTING.md`, or `RELEASING.md`
   - **Branch convention** — if a `release` branch exists, the target is `release`; otherwise create it from the last release tag (see step 3 below). In `--interactive` mode, ask the user to confirm
3. **Ensure the target branch exists** — if not, create it from the last release tag:
   ```bash
   git branch release $(git describe --tags --abbrev=0)
   git push -u origin release
   ```
   This ensures the PR diff shows ALL changes since the last release, not just the version bump.

Print the detected workflow: `Detected release flow: {source} → {target}`

**Default mode**: If ambiguous, use the most likely branch (prefer `release` if it exists). If the target branch does not exist, create it from the last release tag (see step 3 above). If detection still yields `target == source`, abort with an error — a release PR cannot merge a branch into itself. **Interactive mode (`--interactive`)**: Ask the user to confirm before proceeding.

**Important**: The PR direction is `{source}` → `{target}` (e.g., `main` → `release`). This gives Copilot the full diff of all changes since the last release for review. Do NOT create a branch from source and PR back into it — that only shows the version bump commit.

## Pre-Release Checks

1. **Ensure you're on the source branch** — checkout if needed
2. **Pull latest source** — `git pull --rebase --autostash`
3. **Pull latest target** — `git fetch origin {target} && (git show-ref --verify --quiet refs/heads/{target} && git checkout {target} || git checkout -b {target} --track origin/{target}) && git pull --rebase --autostash origin {target} && git checkout {source}` — this ensures the local target branch matches `origin/{target}` before any diff or PR creation, even on a fresh clone where the target branch may only exist on the remote. Without this, the diff may be stale or include already-released changes.
4. **Run tests** — execute the project's test suite (per project conventions already in context, or check package.json)
5. **Run build** — execute the project's build command if one exists

## Determine Version and Finalize Changelog

1. **Determine version bump** from commits since the last git tag:
   - Scan commit messages for conventional commit prefixes:
     - `breaking:` → **major** bump
     - `feat:` → **minor** bump
     - `fix:`, `chore:`, `docs:`, `refactor:`, `perf:`, `style:`, `test:`, `ci:` → **patch** bump
   - Use the **highest applicable level** across all commits
   - **Default mode**: Use the determined version automatically. **Interactive mode (`--interactive`)**: Present the proposed version to the user for confirmation

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

## Local Code Review (REQUIRED GATE)

A release without a deep code review ships bugs to users. This review is the last line of defense — the full diff since the last release often contains interactions that individual PR reviews missed.

<review_gate>

1. Read all commit messages since last release to understand the scope
2. Run `git diff {target}...{source}` to get the list of changed files
3. For every changed file:
   a. Read the entire file using the Read tool (not just diff hunks)
   b. Check it against the tiered checklist below (always check Tiers 1+4; check Tiers 2-3 when relevance filters match)
   c. For each finding, quote the specific code line and explain why it's a problem
4. After reviewing all files, verify: does the aggregate change set deliver what the release claims?
5. Print a review summary table (see do:review for format)
6. Fix any issues, run tests, verify tests cover the changed code paths, commit and push
7. Only after printing the review summary may you proceed to "Open the Release PR"

If the diff touches more than 15 files, delegate later batches to a subagent to keep context clean.

</review_gate>

Checklist to apply to each file:

!`cat ~/.claude/lib/code-review-checklist.md`

Verification — self-check before proceeding (no user prompt needed):
- [ ] Read every changed file in full (not just diffs)
- [ ] Checked each file against the relevant checklist tiers
- [ ] Quoted specific code for each finding
- [ ] Printed a review summary table with findings

## Open the Release PR

- Push the source branch to remote (it should already be up to date with the release commit)
- Create a PR from `{source}` → `{target}` (e.g., `main` → `release`)
  ```bash
  gh pr create --title "Release v{version}" --base {target} --head {source} --body "..."
  ```
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
- **Exception — too-large**: if the Copilot review body says the PR exceeds the maximum number of lines (20 000), treat it as a clean review and proceed to merge immediately. Do NOT re-request.
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

1. **Tag the release** on the target branch to trigger the publish workflow:
   ```bash
   git fetch origin {target}
   git tag v{version} origin/{target}
   git push origin v{version}
   ```
2. **Switch back to the source branch** locally: `git checkout {source} && git pull --rebase --autostash`
3. **Report the final status** including version, PR URL, tag, and merge state
4. Remind the user to check for the GitHub release once CI completes (if the project uses automated releases)
