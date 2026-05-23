---
description: Commit, push, and open a PR against the repo's default branch
argument-hint: "[--review-with copilot|codex|gemini|claude] [--reviewer-applies]"
---

## Parse Arguments

Parse `$ARGUMENTS` for `--review-with <agent>`:
- Accepted values: `copilot` (default), `codex`, `gemini`, `claude`
- Record as `REVIEW_AGENT`. If omitted, set `REVIEW_AGENT=copilot`
- If the value is not in the accepted set, abort with a usage error: `Unknown --review-with value: {value}. Use one of: copilot, codex, gemini, claude.`

Parse `$ARGUMENTS` for `--reviewer-applies` (boolean, no value):
- Record as `REVIEWER_APPLIES=true` if present, otherwise `REVIEWER_APPLIES=false` (default).
- This flag picks who applies fixes the reviewer surfaces: by default the orchestrating thread (this session) reads the reviewer's findings and applies fixes itself; with `--reviewer-applies` the reviewing CLI applies fixes in the working tree directly. See `lib/local-agent-review-loop.md` "Editing mode" for the rationale and trade-offs.
- The flag is **not supported on the copilot path** because Copilot reviews are read-only by design (cloud-side comments, no working-tree access). If `REVIEW_AGENT=copilot` and `REVIEWER_APPLIES=true`, print a warning (`--reviewer-applies has no effect with --review-with copilot; fixes are always applied by the orchestrator's sub-agent`) and continue with the standard Copilot loop.

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

## Local Code Review (REQUIRED GATE)

This review catches bugs that Copilot misses — incomplete pattern copying is the #1 source of post-merge review feedback. Skipping costs more time in review cycles than it saves.

<review_gate>

1. Read commit messages to understand what this change claims to do
2. Run `git diff {default_branch}...{current_branch}` to get the list of changed files
3. For every changed file:
   a. Read the entire file using the Read tool (not just diff hunks)
   b. Check it against the tiered checklist below (always check Tiers 1+4; check Tiers 2-3 when relevance filters match)
   c. For each finding, quote the specific code line and explain why it's a problem
4. After reviewing all files, verify: does the code actually deliver what the commits claim?
5. Print a review summary table (see do:review for format)
6. Fix any issues, run tests, and verify tests cover the changed code paths
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

## Open the PR

- Create a PR from `{current_branch}` to `{default_branch}`
- Create a rich PR description

## Run the Review Loop

Dispatch on `REVIEW_AGENT`:

- **`copilot`** (default): run the Copilot cloud review loop below.
- **`codex` | `gemini` | `claude`**: run the local-agent review loop instead. The local CLI runs `/do:review` (or an equivalent self-contained review prompt) in headless mode against the branch; this main thread then verifies its output, runs build + tests, and pushes the verified fixes. Do not run the Copilot loop in this mode.

### Copilot path (`REVIEW_AGENT=copilot`)

!`cat ~/.claude/lib/copilot-review-loop.md`

### Local-agent path (`REVIEW_AGENT` ∈ {codex, gemini, claude})

!`cat ~/.claude/lib/local-agent-review-loop.md`

**Report the final status** to the user including PR URL and review outcome (status from whichever loop ran).
