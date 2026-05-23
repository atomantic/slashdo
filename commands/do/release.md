---
description: Create a release PR using the project's documented release workflow
argument-hint: "[--interactive] [--review-with <agent>[,<agent>...]] [--review-stop-on-findings|--review-stop-on-clean] [--reviewer-applies]"
---

**Default mode: fully autonomous.** Auto-detects branches, determines version bump from commits, runs review, creates and merges the release PR without prompting.

**`--interactive` mode:** Pauses for branch confirmation, version approval, and merge confirmation.

## Parse Arguments

Parse `$ARGUMENTS` for `--review-with <agent[,agent,...]>`:
- Accepted values per slot: `copilot` (default), `codex`, `gemini`, `claude`
- The value may be a single agent or a **comma-separated, ordered list** (e.g. `--review-with codex,gemini,copilot`). Split on `,`, trim whitespace around each slug.
- Record the resulting list as `REVIEW_AGENTS`. If `--review-with` is omitted, set `REVIEW_AGENTS=[copilot]`.
- Dedupe preserving first-occurrence order; if duplicates were dropped, print: `Note: deduped --review-with list to {final list}.`
- If any value is not in the accepted set, abort with a usage error: `Unknown --review-with value: {value}. Use one of: copilot, codex, gemini, claude.`

Parse `$ARGUMENTS` for the stop-mode flags (mutually exclusive):
- `--review-stop-on-findings` — stop the multi-reviewer loop after the first reviewer that fixed at least one finding.
- `--review-stop-on-clean` — stop after the first reviewer that reports a clean pass with zero findings.
- If neither is present, set `REVIEW_STOP_MODE=all` (default — always run every listed reviewer in order). For release PRs the default is appropriate: each reviewer's perspective adds to the merge-gate confidence.
- If both are present, abort with: `--review-stop-on-findings and --review-stop-on-clean cannot be combined`.

Parse `$ARGUMENTS` for `--reviewer-applies` (boolean, no value):
- Record as `REVIEWER_APPLIES=true` if present, otherwise `REVIEWER_APPLIES=false` (default).
- This flag picks who applies fixes the reviewer surfaces: by default the orchestrating thread (this session) reads the reviewer's findings and applies fixes itself; with `--reviewer-applies` the reviewing CLI applies fixes in the working tree directly. See `lib/local-agent-review-loop.md` "Editing mode" for the rationale and trade-offs.
- The flag is **not supported on the copilot path** because Copilot reviews are read-only by design (cloud-side comments, no working-tree access). If `REVIEW_AGENTS` contains `copilot` and `REVIEWER_APPLIES=true`, print a warning (`--reviewer-applies has no effect on the copilot pass; fixes there are always applied by the orchestrator's sub-agent`) and continue — the flag still takes effect on the non-copilot passes in the list.

## Detect Release Workflow

Before doing anything, determine the project's source and target branches for releases. Do NOT hardcode branch names. Instead, discover them:

1. **Source branch** — run `gh repo view --json defaultBranchRef -q '.defaultBranchRef.name'` to get the repo's default branch (typically `main`)
2. **Target branch** — determine by reading (in priority order):
   - **GitHub Actions workflows** — check `.github/workflows/release.yml` (or similar) for `on: push: branches:` to find the branch that triggers the release pipeline
   - **Project conventions** (already in context) — look for git workflow sections, branch descriptions, or release instructions
   - **Versioning docs** — check `docs/VERSIONING.md`, `CONTRIBUTING.md`, or `RELEASING.md`
   - **Branch convention** — if a `release` branch exists, the target is `release`; otherwise create it from the last release tag (see step 3 below). In `--interactive` mode, ask the user to confirm
3. **Ensure the target branch exists** — if not, create it from the last release tag (or root commit if no tags exist yet — net-new project). The snippet must consult the remote (not just local refs) before deciding to create, because on a fresh clone the remote-tracking ref for `{target}` may not have been fetched yet — creating a new `{target}` branch from the last tag in that case would lose history and the subsequent `git push` would either fail (non-fast-forward) or, worse, succeed and clobber the real release branch. Fetch the target ref first, then probe both the local heads and the freshly-updated remote-tracking refs via `git ls-remote --heads origin {target}`:
   ```bash
   git fetch origin "{target}:refs/remotes/origin/{target}" 2>/dev/null || true
   if ! git show-ref --verify --quiet refs/heads/{target} \
       && ! git show-ref --verify --quiet refs/remotes/origin/{target} \
       && [ -z "$(git ls-remote --heads origin {target})" ]; then
     git branch {target} $(git describe --tags --abbrev=0 2>/dev/null || git rev-list --max-parents=0 HEAD)
     git push -u origin {target}
   fi
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
   - Scan commit messages for conventional commit prefixes (also check each commit's body/footer for `BREAKING CHANGE:` — a recognized way to signal a breaking change without the prefix):
     - `breaking:`, any prefix with a `!` (e.g. `feat!:`, `fix!:`, `refactor!:`), or a `BREAKING CHANGE:` footer → **major** bump
     - `feat:` → **minor** bump
     - `fix:`, `build:`, `chore:`, `docs:`, `refactor:`, `perf:`, `style:`, `test:`, `ci:` → **patch** bump
   - Use the **highest applicable level** across all commits
   - **Default mode**: Use the determined version automatically. **Interactive mode (`--interactive`)**: Present the proposed version to the user for confirmation

2. **Bump version**: Use the project's native version-bump command. For Node projects: `npm version <major|minor|patch> --no-git-tag-version` (updates `package.json` and `package-lock.json`). For other ecosystems, detect from the project files in the working directory and use the equivalent (`cargo set-version` for Rust, `poetry version` for Python, `mix.exs` edit for Elixir, manual `VERSION` file edit for Go). The commit step below stages whichever files the bump command modified — not a hardcoded list.

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

4. **Commit the release**: Stage whatever files step 2's version-bump command modified (Node: `package.json` and possibly `package-lock.json`; Rust: `Cargo.toml` and `Cargo.lock`; Python: `pyproject.toml`; etc.) plus the changelog file. Commit with message `chore: release v{new_version}`. Listing files explicitly (not `git add -A`) keeps unrelated dirty state out of the release commit.

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

## Run the Review Loop

Hand off to the **multi-reviewer loop** with the parsed inputs:

- `{REVIEW_AGENTS}` — ordered list (default `[copilot]`)
- `{REVIEW_STOP_MODE}` — `all` (default) | `on-findings` | `on-clean`
- `{REVIEWER_APPLIES}` — boolean

Each pass uses the matching single-reviewer loop:

- `copilot` → Copilot cloud review loop (`lib/copilot-review-loop.md`)
- `codex` | `gemini` | `claude` → local-agent headless review loop (`lib/local-agent-review-loop.md`)

### Multi-reviewer wrapper

!`cat ~/.claude/lib/multi-reviewer-loop.md`

### Inner loop bodies (referenced by the wrapper)

!`cat ~/.claude/lib/copilot-review-loop.md`

!`cat ~/.claude/lib/local-agent-review-loop.md`

## Merge the PR (only after a CLEAN multi-reviewer result)

The merge gate consumes the **wrapper's `{OVERALL_STATUS}`** plus, for any copilot pass that ran, the standard copilot post-pass checks.

### Wrapper status

- `clean` — every executed pass returned `clean` (copilot `too-large` counts as clean here, per the copilot loop's own rule). **Eligible to merge.**
- `partial` — the wrapper stopped early because of an explicit stop-mode flag (`--review-stop-on-findings` or `--review-stop-on-clean`) and the executed passes all completed normally. **Eligible to merge** — the user opted into the short-circuit.
- `inconclusive` — the executed list contained **at least one** pass whose status was inconclusive (`timeout`, `error`, `guardrail`, `skipped`), regardless of whether other passes returned `clean`. **Do NOT merge** — the user asked for multiple perspectives and at least one never produced a verdict.
- `dirty` — a pass returned a hard-error status (`cli-error`, `broken-build`, `test-failed`, `rejected`) and the wrapper short-circuited. **Do NOT merge.**

For `dirty` or `inconclusive`:
- **Default mode**: leave the PR open and report the proximate status so the user can review manually.
- **Interactive mode (`--interactive`)**: ask the user whether to merge anyway, re-run a specific reviewer, or leave open.

### Copilot-specific checks (when copilot was in the executed list)

- **CRITICAL**: Do NOT merge until Copilot has submitted a review. A missing review is NOT the same as a clean review.
- Only merge after the latest Copilot review has been submitted AND that review generated **zero comments**. Check this by:
  1. Confirming a new review node exists with `submittedAt` after your last push
  2. Confirming the review body says "generated 0 comments" OR there are no new unresolved threads
- **Exception — too-large**: if the Copilot review body says the PR exceeds the maximum number of lines (20 000), treat it as a clean review and proceed to merge immediately. Do NOT re-request.
- **Never merge if:**
  - No Copilot review was ever posted (review never arrived — ask user first)
  - "Awaiting requested review" is still shown (review in progress)
  - The latest review had comments that you fixed but you didn't get a CLEAN re-review

### Local-agent-specific checks (when codex/gemini/claude was in the executed list)

- The local-agent loop already verified build and tests locally before pushing, so no separate review-comment count is required — its `clean` status in the wrapper table means all iterations of that pass passed verification.

### Merging (after all checks above pass)

- Once confirmed clean, merge:
  ```bash
  gh pr merge <number> --merge
  ```
- Verify the merge succeeded: `gh pr view <number> --json state,mergedAt`

## Post-Merge

1. **Tag the release** on the target branch to trigger the publish workflow. Refuse to overwrite an existing tag — a colliding `v{version}` usually means the version bump heuristic picked an already-released value or a prior partial release left state behind, both of which need human attention before force-tagging would be safe:
   ```bash
   git fetch origin {target} 'refs/tags/*:refs/tags/*'
   if git rev-parse -q --verify "refs/tags/v{version}" >/dev/null; then
     echo "Tag v{version} already exists. Aborting tag step. Investigate (rerun version bump? force-tag manually?) before retrying."
     exit 1
   fi
   git tag v{version} origin/{target}
   git push origin v{version}
   ```
2. **Switch back to the source branch** locally: `git checkout {source} && git pull --rebase --autostash`
3. **Report the final status** including version, PR URL, tag, and merge state
4. Remind the user to check for the GitHub release once CI completes (if the project uses automated releases)
