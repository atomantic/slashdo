## Better pipeline — Review Loop (Phase 6, GitHub only)

### Inputs

In addition to `{BRANCH_PREFIX}`, which every `better-*` command defines:
`{REVIEW_LOOP_EXTRA_INSTRUCTION}` and `{REVIEW_STATUS_EXTRA}`.

## Phase 6: Review Loop (GitHub only)

**GATE — no reviewer requested: If `REVIEW_AGENTS` is empty** (no `--review-with` was passed), **skip this entire phase AND the Phase 6.3 merge.** There is no default reviewer. Leave every PR open, print the PR URLs and summary (Review column `none — left open`), and proceed to Phase 7.

### 6.1: One review sub-agent per PR

Launch one general-purpose sub-agent per PR, in parallel, and wait for all. Each runs the **multi-reviewer wrapper** over `REVIEW_AGENTS` against its PR's branch and returns only the wrapper's `{OVERALL_STATUS}`. Pass reference paths, not reviewer bodies; each worker reads the wrapper and only the inner loops its entries need. A missing required reference makes that review inconclusive.

Pass each sub-agent: `{REVIEW_AGENTS}`, `{REVIEW_STOP_MODE}`, `{REVIEW_MODE}` (`series` default, or `parallel`), `{REVIEWER_APPLIES}`, `{REVIEW_ITERATIONS}` (the copilot/`@<login>` cap; default 1), `{PR_NUMBER}`, `{OWNER}/{REPO}`, `{GH_HOST}` (so GitHub-side `gh api` calls hit the right host on GitHub Enterprise), `{BRANCH_PREFIX}/{CATEGORY_SLUG}`, and `{BUILD_CMD}`. When a loop reaches its guardrail, default mode stops; `--interactive` asks the user whether to continue.

{REVIEW_LOOP_EXTRA_INSTRUCTION}

### Required review references (PR worker only)

Always read the wrapper when this phase applies:

!read lib/multi-reviewer-loop.md

Only for `copilot` entries:

!read lib/copilot-review-loop.md

Only for `@<login>` entries:

!read lib/github-reviewer-loop.md

Only for an entry that is none of `copilot`, `ollama`, or `@<login>` (every other slug — the fixed CLIs and `cmd[<invocation>]` alike — dispatches through this one loop; a future addition needs no new gate here):

!read lib/local-agent-review-loop.md

Only for `ollama` entries:

!read lib/ollama-review-loop.md

The copilot and `@<login>` loops resolve review threads via raw `gh api graphql`
mutations — read the shell-escaping rules once up front so a worker doesn't
reach for `$variableName` GraphQL syntax the shell will mangle:

!`cat ~/.claude/lib/graphql-escaping.md`

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

Merge each approved PR (`gh pr merge {PR_NUMBER} --merge`, in dependency order) only when its current local HEAD is pushed, the Phase 5d CI gate holds on that HEAD, and 6.2 approved it (the review aggregate, or the interactive selection); then confirm it reports merged. A merge conflict means rebasing the branch onto `{DEFAULT_BRANCH}` and force-pushing with lease; the new HEAD then needs build/tests, the configured review loop, and CI again before merging. Prior approval of a different HEAD is insufficient. A branch-protection refusal is reported for manual merge.
