## Phase 6: Review Loop

**GATE — no reviewer requested: If `REVIEW_AGENTS` is empty** (no `--review-with` was passed), **skip this entire phase AND the Phase 6.3 merge.** There is no default reviewer. Leave every PR open, print the PR URLs and summary (Review column `none — left open`), and proceed to Phase 7.

### 6.1: One review sub-agent per PR

First finish deriving `{GH_HOST}` from Phase 0a's seed:

!read lib/gh-host.md

Launch one general-purpose sub-agent per PR, in parallel, and wait for all. Each runs the **multi-reviewer wrapper** over `REVIEW_AGENTS` against its PR's branch and returns only the wrapper's `{OVERALL_STATUS}`. Pass reference paths, not reviewer bodies; each worker reads the wrapper and only the inner loops its entries need. A missing required reference makes that review inconclusive.

Pass each sub-agent: `{REVIEW_AGENTS}`, `{REVIEW_STOP_MODE}`, `{REVIEW_MODE}` (`series` default, or `parallel`), `{REVIEWER_APPLIES}`, `{REVIEW_ITERATIONS}` (the copilot/`@<login>` cap; default 1), `{REVIEW_MODELS}` (the saved per-agent default models — without it a saved default model is silently ignored), `{PR_NUMBER}`, `{OWNER}/{REPO}`, `{GH_HOST}` (so the host-side loops' `gh api` calls hit the right host on GitHub Enterprise), `{BRANCH_PREFIX}/{CATEGORY_SLUG}`, and `{BUILD_CMD}`. When a loop reaches its guardrail, default mode stops; `--interactive` asks the user whether to continue.

For each host-side entry, resolve the caller-owned `{WAIT_SCHEDULE}` before dispatch:

- `copilot` — max wait 3 minutes in iteration 1, 2 minutes in iteration 2, 90 seconds in iteration 3, 60 seconds in iteration 4, then 45 seconds; poll every 15 seconds.
- `@<login>` — expected duration 5 minutes; max wait 3x that duration, minimum 3 minutes, maximum 15 minutes; poll every 10s, 10s, 20s, 20s, then 30s.

Forward only the selected schedule as `{WAIT_SCHEDULE}`; never give one pass both schedules.

{REVIEW_LOOP_EXTRA_INSTRUCTION}

### Required review references (PR worker only)

Always read the wrapper when this phase applies:

!read lib/multi-reviewer-loop.md

For every `copilot` or `@<login>` entry, read the shared host-reviewer template (its sub-agent runs the `{CODE_HOST}` verb file):

!read lib/host-reviewer-loop.md

Only for `copilot` entries on GitHub, also read the Copilot delta:

!read lib/copilot-review-loop.md

Only for an entry that is none of `copilot`, `ollama`, or `@<login>` (every other slug — the fixed CLIs and `cmd[<invocation>]` alike — dispatches through this one loop; a future addition needs no new gate here):

!read lib/local-agent-review-loop.md

Only for `ollama` entries:

!read lib/ollama-review-loop.md

### 6.2: Merge Gate (MANDATORY)

Only `clean`, or `partial` under an explicit stop-mode, permits merge; the wrapper defines which pass results count toward each. A missing or inconclusive review is NOT a clean review. **Default mode**: leave `inconclusive` and `dirty` PRs open and print which PRs will merge and which stay open. **Interactive mode (`--interactive`)**:
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
The selection alone decides which PRs are approved for 6.3; every PR it does not approve stays open.

### 6.3: Merge

Merge each approved PR, in dependency order, only when its current local HEAD is pushed, the Phase 5d CI gate holds on that HEAD, and 6.2 approved it (the review aggregate, or the interactive selection); then confirm it reports merged.

- **GitHub:** **Never hardcode `--merge`** — a repo that allows only squash or rebase rejects `gh pr merge --merge` every time. Resolve the method once per run, preferring `squash`, then `merge`, then `rebase` from the repo's allowed methods:
  ```bash
  MERGE_METHOD="$(gh repo view --json mergeCommitAllowed,squashMergeAllowed,rebaseMergeAllowed \
    -q '[(select(.squashMergeAllowed) | "squash"), (select(.mergeCommitAllowed) | "merge"), (select(.rebaseMergeAllowed) | "rebase")] | first // empty')"
  ```
  If no method resolves, leave that PR open and report why instead of merging. Otherwise `gh pr merge {PR_NUMBER} --{MERGE_METHOD}`.
- **GitLab:** `glab mr merge {PR_NUMBER} --yes`. GitLab has no separate merge-method flag; it uses the project's default merge method. Omit `--remove-source-branch` here — Phase 7 cleanup already owns deleting each category's branch once it confirms the merge, and deleting it twice is redundant, not wrong, but the confirmation in Phase 7 is what the branch-owner bookkeeping (`CREATED_CATEGORY_SLUGS`) relies on.

A merge conflict means rebasing the branch onto `{DEFAULT_BRANCH}` and force-pushing with lease; the new HEAD then needs build/tests, the configured review loop, and CI again before merging. Prior approval of a different HEAD is insufficient. A branch-protection refusal is reported for manual merge.
