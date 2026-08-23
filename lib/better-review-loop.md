## Better pipeline — Review Loop (Phase 6, GitHub only)

The shared per-PR review-and-merge loop for every `better-*` audit pipeline.
`/do:better` and `/do:better-swift` include this file verbatim.

### Inputs

In addition to `{BRANCH_PREFIX}`, which every `better-*` command defines and
`~/.claude/lib/better-verification.md` documents:

- `{REVIEW_LOOP_EXTRA_INSTRUCTION}` — an extra paragraph handed to every review
  sub-agent, or empty. A multi-platform pipeline uses it to require that each
  fix still compiles everywhere.
- `{REVIEW_STATUS_EXTRA}` — extra line(s) for the interactive review-status
  prompt, or empty (e.g. "\n\nAll PRs verified on: {PLATFORMS}").
- The calling command must `!cat` the five reviewer-loop libraries the wrapper
  dispatches to (`multi-reviewer-loop.md`, `copilot-review-loop.md`,
  `github-reviewer-loop.md`, `local-agent-review-loop.md`,
  `ollama-review-loop.md`) at its own top level — a `!cat` nested inside an
  included file is not expanded again — and point 6.1 at them.

## Phase 6: Review Loop (GitHub only)

**GATE — no reviewer requested: If `REVIEW_AGENTS` is empty** (no `--review-with` was passed), **skip this entire phase AND the Phase 6.4 merge.** There is no default reviewer. Leave every PR open for manual review, print the PR URLs and summary (mark the Review column `none — left open`), then proceed to Phase 7 cleanup. PRs are merged only after a clean review loop, which requires an explicit `--review-with`.

Otherwise, run each PR through the **multi-reviewer loop** over `REVIEW_AGENTS`, in order, with the parsed `{REVIEW_STOP_MODE}`, `{REVIEW_MODE}` (series default — reviewers run one-at-a-time within a PR so each sees the prior's fixes; `parallel` collects reviews concurrently then applies the union once), `{REVIEWER_APPLIES}`, and `{REVIEW_ITERATIONS}` (the last caps copilot and `@<login>` passes only; local-agent and ollama passes use their own fixed iteration caps). A copilot or `@<login>` pass with the default `--review-iterations 1` runs a single review-and-fix cycle and returns `capped` (clean-equivalent / ready-to-merge). `0` lets that pass loop until 0 comments, bounded by its own loop's 10-iteration guardrail. **Default mode**: auto-stop at the guardrail. **Interactive mode (`--interactive`)**: prompt the parent agent to ask the user whether to continue or stop.

**Sub-agent delegation** (prevents context exhaustion): delegate each PR's review loop to a **separate general-purpose sub-agent** via the Agent tool. Launch sub-agents in parallel (one per PR). Each sub-agent runs the multi-reviewer loop (which dispatches each listed agent to the copilot loop or the local-agent loop) autonomously against its PR's branch and returns only the final aggregate status.

### 6.1: Launch parallel sub-agents (one per PR)

For each PR, spawn a general-purpose sub-agent that runs the **multi-reviewer wrapper** over `REVIEW_AGENTS` for that PR. The wrapper and the inner loop bodies it dispatches to are included by this command under **Review loop libraries** below.

Pass each sub-agent the PR-specific variables: `{REVIEW_AGENTS}`, `{REVIEW_STOP_MODE}`, `{REVIEW_MODE}`, `{REVIEWER_APPLIES}`, `{PR_NUMBER}`, `{OWNER}/{REPO}`, `{GH_HOST}` (so the GitHub-side loops' `gh api` calls hit the right host on GitHub Enterprise), `{BRANCH_PREFIX}/{CATEGORY_SLUG}` (the branch the local-agent loop checks out and reviews), `{BUILD_CMD}`, and `{REVIEW_ITERATIONS}` (the copilot/`@<login>` iteration cap; default 1).

{REVIEW_LOOP_EXTRA_INSTRUCTION}

Launch all PR sub-agents in parallel. Wait for all to complete.

### 6.2: Handle sub-agent results

Each sub-agent returns the multi-reviewer wrapper's `{OVERALL_STATUS}` for its PR:
- **clean**: every executed pass returned clean (copilot `too-large`, plus `capped` from any of the four loops — an explicitly configured cap, `~max=<n>` or `--review-iterations`, reached after applying every fix — count as clean; a *built-in* cap is `guardrail`, which is inconclusive) — mark PR as ready to merge
- **partial**: a stop-mode flag short-circuited the list and every executed pass was clean-equivalent (`clean`, copilot `too-large`, or `capped`) — mark PR as ready to merge (the user opted into the short-circuit)
- **inconclusive**: at least one requested pass timed out, errored, hit its guardrail, or was skipped (e.g. a missing CLI binary, or copilot when no PR review could be produced). **Default mode**: leave the PR open for manual review. **Interactive mode**: inform the user and ask whether to merge anyway, re-run, or skip
- **dirty**: a pass left the branch with a broken build / failed tests / explicit reject. **Default mode**: leave the PR open. **Interactive mode**: ask whether to fix-and-retry or skip

### 6.3: Merge Gate (MANDATORY)

**Do NOT merge any PR whose aggregate review status is not `clean` (or `partial` under an explicit stop-mode).** A missing or inconclusive review is NOT a clean review.

#### Default Mode (autonomous)

Print the review status summary, then auto-merge all PRs whose reviews completed cleanly. PRs that timed out, hit guardrails, or still have unresolved comments are left open for manual review. Print which PRs were merged and which were left open.

#### Interactive Mode (`--interactive`)

Present the review status summary to the user via `AskUserQuestion`:
```
AskUserQuestion([{
  question: "Review status ({REVIEW_AGENTS}):\n{for each PR: #number - aggregate status (clean/partial/inconclusive/dirty)}{REVIEW_STATUS_EXTRA}\n\nHow would you like to proceed?",
  options: [
    { label: "Merge approved PRs", description: "Merge only PRs with passing review" },
    { label: "Merge all", description: "Merge all PRs regardless of review status" },
    { label: "Wait", description: "Wait longer for pending reviews" },
    { label: "Don't merge", description: "Leave PRs open for manual review" }
  ]
}])
```

Only proceed with merging based on the user's selection.

### 6.4: Merge

For each PR approved for merge (in dependency order if applicable):
```bash
gh pr merge {PR_NUMBER} --merge
```

Verify each merge:
```bash
gh pr view {PR_NUMBER} --json state,mergedAt
```

If merge fails (e.g., branch protection, merge conflicts from a prior PR):
- If merge conflict: rebase the branch and retry
  ```bash
  git checkout {BRANCH_PREFIX}/{CATEGORY_SLUG}
  git pull --rebase origin {DEFAULT_BRANCH}
  git push --force-with-lease
  ```
  Then re-run CI check before merging.
- If branch protection: inform the user and suggest manual merge
