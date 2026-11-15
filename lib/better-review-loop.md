## Phase 6: Review Loop

**Gate:** if `REVIEW_AGENTS` is empty (no `--review-with` and no saved reviewer), skip this phase, including the 6.3 merge. There is no default reviewer. Leave every PR open, print the PR URLs and summary (Review column `none — left open`), and proceed to Phase 7.

### 6.1: One review sub-agent per PR

First finish deriving `{GH_HOST}` from Phase 0a's seed:

!read lib/gh-host.md

Launch one sub-agent per PR, in parallel, and wait for all. Each runs the multi-reviewer wrapper over `REVIEW_AGENTS` against its PR's branch and returns only the wrapper's `{OVERALL_STATUS}`. Pass reference paths, not reviewer bodies; each worker reads the wrapper and only the inner loops its entries need. A missing required reference makes that review inconclusive.

Pass each sub-agent: `{REVIEW_AGENTS}`, `{REVIEW_STOP_MODE}`, `{REVIEW_MODE}` (`series` default, or `parallel`), `{REVIEWER_APPLIES}`, `{REVIEW_ITERATIONS}` (the copilot/`@<login>` cap; default 1), `{REVIEW_MODELS}` (the saved per-agent default models; without it a saved default model is silently ignored), `{PR_NUMBER}`, `{OWNER}/{REPO}`, `{GH_HOST}` (so the host-side loops' `gh api` calls hit the right host on GitHub Enterprise), `{BRANCH_PREFIX}/{CATEGORY_SLUG}`, `{BUILD_CMD}`, and any review instruction the caller's inputs add. When a loop reaches its guardrail, default mode stops; `--interactive` asks the user whether to continue.

Each host-side entry takes `{WAIT_SCHEDULE}` from "Wait schedules" in the host-reviewer file; this caller states no difference.

### Required review references (PR worker only)

Always read the wrapper when this phase applies:

!read lib/multi-reviewer-loop.md

For every `copilot` or `@<login>` entry, read the shared host-reviewer template (its sub-agent runs the `{CODE_HOST}` verb file):

!read lib/host-reviewer-loop.md

Only for `copilot` entries on GitHub, also read the Copilot delta:

!read lib/copilot-review-loop.md

Only for an entry that is none of `copilot`, `ollama`, or `@<login>` (every other slug, the fixed CLIs and `cmd[<invocation>]` alike, dispatches through this one loop):

!read lib/local-agent-review-loop.md

Only for `ollama` entries:

!read lib/ollama-review-loop.md

### 6.2: Merge Gate

Only `clean`, or `partial` under an explicit stop-mode, permits merge; the wrapper defines which pass results count toward each. A missing or inconclusive review is not a clean review.

- **Default mode:** leave `inconclusive` and `dirty` PRs open and print which PRs will merge and which stay open.
- **Interactive mode (`--interactive`):** show each PR's number and aggregate status (clean / partial / inconclusive / dirty) for `{REVIEW_AGENTS}` and ask the user how to proceed: **Merge approved PRs** (only those with a passing review), **Merge all** (regardless of review status), **Wait** (longer, for pending reviews), or **Don't merge** (leave PRs open for manual review). The selection alone decides which PRs are approved for 6.3; every PR it does not approve stays open.

### 6.3: Merge

Merge each approved PR, in dependency order, only when its current local HEAD is pushed, the Phase 5d CI gate holds on that HEAD, and 6.2 approved it (the review aggregate, or the interactive selection); then confirm it reports merged.

- **GitHub:** `gh pr merge` needs an explicit method here, and a repository that disallows the one you pass rejects the merge every time, so resolve it once per run from the methods the repository allows. Use the project's preferred method from `PROJECT_CONVENTIONS` when it is allowed; otherwise the first allowed of `squash`, `merge`, `rebase`, which this prints:
  ```bash
  gh repo view --json mergeCommitAllowed,squashMergeAllowed,rebaseMergeAllowed \
    -q '[(select(.squashMergeAllowed) | "squash"), (select(.mergeCommitAllowed) | "merge"), (select(.rebaseMergeAllowed) | "rebase")] | first // empty'
  ```
  Record the result as `{MERGE_METHOD}`. If no method resolves, leave that PR open and report why. Otherwise `gh pr merge {PR_NUMBER} --{MERGE_METHOD}`.
- **GitLab:** `glab mr merge {PR_NUMBER} --yes`. GitLab has no separate merge-method flag; it uses the project's configured method. Omit `--remove-source-branch`: Phase 7 deletes each category branch after confirming the merge, and its bookkeeping (`CREATED_CATEGORY_SLUGS`) relies on doing that itself.

A merge conflict means rebasing the branch onto `{DEFAULT_BRANCH}` and force-pushing with lease; the new HEAD then needs build/tests, the configured review loop, and CI again before merging, because approval of a different HEAD does not carry over. A branch-protection refusal is reported for manual merge.
