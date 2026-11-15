---
description: Resolve PR/MR review feedback with parallel agents
argument-hint: "[--interactive] [--review-with <agent>[,<agent>...]] [--reviewer-applies] [--issues-label <name>]"
---

By default rpr runs autonomously: it fetches review feedback, fixes it, pushes, resolves threads and runs the requested reviewers without prompting, skipping a reviewer that times out or keeps erroring. With `--interactive` it asks how to proceed in those two cases instead.

# Resolve PR Review Feedback

Address the unresolved review feedback on the current branch's PR (GitHub) or merge request (GitLab). On GitLab a "thread" is a resolvable MR discussion. Thread resolution is reviewer-agnostic: rpr resolves every unresolved thread it has addressed, whoever wrote it (a human, Copilot, another bot). `--review-with` only names the reviewers rpr then runs on the result.

## Parse Arguments

!`cat ~/.claude/lib/review-flags.md 2>/dev/null || cat "$(dirname "$(readlink -f .claude/commands/do/rpr.md)")/../../lib/review-flags.md"`

What that grammar means in rpr:
- rpr dispatches each listed reviewer directly, in list order, so `--review-iterations`, `--review-mode` and the `--review-stop-on-*` flags (and their saved defaults) have no effect here. The per-entry suffixes do: `~max=<n>` is that reviewer's cycle cap (`{MAX_ITERATIONS}`, with `{MAX_EXPLICIT}=true`) and `~effort=<level>` its `{REVIEW_EFFORT}` / `{OLLAMA_EFFORT}`.
- With no `--review-with` and no saved default, or with `--review-with none`, `REVIEW_AGENTS=[]`: rpr requests no review and only resolves the threads the {CR_NOUN} already carries.

Then apply any saved defaults (set via `/do:config`) to `review-with` / `reviewer-applies` / `issues-label` the user did not pass; an explicit flag, including `--review-with none`, wins:

!`cat ~/.claude/lib/review-config-defaults.md 2>/dev/null || cat "$(dirname "$(readlink -f .claude/commands/do/rpr.md)")/../../lib/review-config-defaults.md"`

Parse `$ARGUMENTS` for `--issues-label <name>`: a deferred finding (see Finding Disposition) is filed as a tracker issue on GitHub, GitLab or Jira (`/do:config --tracker`). Set `PLAN_LABEL` from `--issues-label`, else the saved `issues-label` default, else `plan` (a saved `issues` key is ignored). `--issues` is a deprecated no-op (filing issues is the only mode now; say so once), and `--no-issues` aborts with `--no-issues is no longer supported: PLAN.md mode was removed.`

## Detect Code Host

Select the forge from the `origin` remote with the shared preflight (`{COMMAND}` = `/do:rpr`). Every host step below either runs a verb from the selected host's verb file (`cr-state`, `reply-thread`, `resolve-thread`, `request-review`) or is an inline form labeled with its host:

!read lib/vcs-host.md

Only when `CODE_HOST=github`, derive `GH_HOST` and read the GitHub verbs:

!read lib/gh-host.md
!read lib/host-github.md

Only when `CODE_HOST=gitlab`, read the GitLab verbs:

!read lib/host-gitlab.md

## Steps

Shell variables do not survive from one tool call to the next, so carry values such as the {CR_NOUN} number, owner/repo and `GH_HOST` forward as literals.

1. **Find the {CR_NOUN}**:
   - **GitHub**: `gh pr view --json number,url,reviewDecision,headRefName,baseRefName` finds the PR for this branch; take owner/name from `gh repo view --json owner,name`. `gh api` ignores the repo remote and defaults to github.com, so every `gh api` call carries `--hostname GH_HOST` (`gh pr`/`gh repo` resolve the host themselves). If the PR's owner differs from `gh api --hostname GH_HOST user --jq .login` (a fork-to-upstream PR), note `is_fork_pr=true`.
   - **GitLab**: capture `glab mr view --output json` (the MR for the current branch) to a file and check its exit status, then parse the file with `jq`. `.iid` is the `PR_NUMBER` every verb takes. Also read `.web_url`, `.state`, `.source_branch` (head branch), `.target_branch` (base branch), and `.source_project_id` / `.target_project_id`. If there is no MR for this branch, or its `.state` is not `opened`, stop with `No open MR for branch <branch>.` A fork MR (`.source_project_id` ≠ `.target_project_id`) sets `is_fork_pr=true`. The GitLab verbs address this checkout's project (`projects/:id`), so compare `glab api "projects/:id"`'s `.id` with `.target_project_id`. If they differ, stop with `/do:rpr: GitLab MR !<iid> belongs to project <target_project_id>, but the GitLab verbs address this checkout's project <id> (projects/:id) — run /do:rpr from a clone of the target project.`

2. **Fetch review comments**: run the `cr-state` verb and keep the unresolved threads, whoever wrote them:
   - **GitHub**: fill in `{OWNER}`/`{REPO}`/`{PR_NUMBER}`/`{GH_HOST}`, then keep `.threads[]` with `isResolved == false`. Each thread's conversation is `comments.nodes`.
   - **GitLab**: `{PR_NUMBER}` is the MR iid, and `{REVIEWER_LOGIN}` is empty because rpr reads only threads. Keep `.threads[]` with `resolved == false`: the unresolved resolvable MR discussions. Each discussion's conversation is `.comments`, and its anchor is `.path`/`.line` (`null` for a discussion on the MR as a whole).

   Save them (ID, path, line, author, conversation) to a file created with `mktemp`, so two sessions never share a path; print the path and reuse it literally. Report the count up front ("Found 7 unresolved review threads") so a partial session is visible after a context reset. With no unresolved threads, go straight to "Run the requested reviewers".

3. **Address the feedback without file-write collisions**:
   - With 1-3 unresolved threads, fix them inline. Otherwise group the threads by file and give each file to one sub-agent, launched in parallel; two parallel agents never edit the same file.
   - Each thread fixer reads its file(s) and every thread on them, makes the requested change when it is accurate and warranted (Finding Disposition below decides fix / reply / defer), applies the smallest root-cause action in the same change per `~/.claude/lib/review-fix-conventions.md`, and returns what changed, the thread IDs addressed and the root-cause action taken (or "none — one-off").
   - After the thread fixes return, run one independent code-quality pass (a sub-agent, or inline for a small {CR_NOUN}) over every file the {CR_NOUN} changes (GitHub: `gh pr diff --name-only`; GitLab: `git fetch origin <target_branch>` then `git diff --name-only FETCH_HEAD...HEAD`). Running it afterwards means it sees the fixed state and never races a thread fixer. It looks for logic defects the threads missed — a real bug, a missing error path, a broken contract, a security issue, not style — and fixes them under the same disposition and root-cause rules.
   - Run sub-agents at the `medium` tier, and escalate a thread to `heavy` only for hard architectural reasoning; resolve tiers per [lib/model-tiers.md](../../lib/model-tiers.md).

4. **Convention encoding**: run the end-of-cycle phase from `~/.claude/lib/review-fix-conventions.md` against the issues addressed this round, on the checked-out branch, so the encoded actions ship with the fixes.

5. **Validate**: run the repository's declared local gate (lint/format, fast structural checks) and the focused tests for the behavior you changed, and fix what fails before going on. Leave broad suites (full server, browser, database, smoke) to hosted CI unless the repository requires them locally, and report exactly what ran.

6. **Commit and push**:
   - Stage the changed files by name and commit following the project's commit convention (its CLAUDE.md / AGENTS.md / CONTRIBUTING, or the style of recent `git log`). When the project states none, use `address review (<reviewer>): <summary>`, where `<reviewer>` is the thread author's login, or `self` for a fix from the quality pass. No co-author or generated-by trailers.
   - Push to the {CR_NOUN}'s head branch, naming the remote and branch (a bare `git push` can fan out to other branches under `push.default=matching`).
   - Check CI for the pushed head per "CI after a push".

7. **Resolve conversations**: for each addressed thread, run the `resolve-thread` verb with its thread ID (GitHub: the review-thread node `id`; GitLab: the discussion `id`). A thread you leave open gets a reply through the `reply-thread` verb instead: the concrete reason it is not a real issue, the question when the feedback is unclear, or — for a deferred finding — the filed issue (by key, `PROJ-123`, on a Jira tracker). Replies go in the thread itself, never in a new top-level comment. A failed verb is a failure: report it and do not count that thread as resolved.

8. **Run the requested reviewers** (skip when `REVIEW_AGENTS` is empty, and for a fork-to-upstream {CR_NOUN}: you cannot request reviewers on a repo you do not own). Run each entry in list order against the pushed head; each loop fixes what its reviewer finds, verifies and pushes before the next starts:
   - **A local CLI** (any entry that is none of `ollama`, `copilot`, `@<login>` — the fixed CLIs and `cmd[<invocation>]` alike): the local-agent review loop below.
   - **`ollama`**: the Ollama review loop below.
   - **`copilot` or `@<login>`**: the host-reviewer loop below, which requests the review, waits for it, fixes its findings and resolves its threads.

   Afterwards run `cr-state` once more. If it shows unresolved threads that nobody has answered yet (a human commented during the run), address them once through "Address the feedback" to "Resolve conversations" without starting another reviewer round; threads you already replied to and left open stay as they are.

9. **Report summary**: print a table of the threads addressed (file, line, brief description of the fix) and a count line, "Resolved X/Y threads." List any thread left unresolved with its reason (unclear feedback, disagreement, needs user input), each deferred finding with its issue number (key on Jira) or as unfiled per `plan-issue-setup.md`'s no-tracker rule, and each reviewer's final status. Append the `## Conventions Encoded` section from "Convention encoding".

!`cat ~/.claude/lib/finding-disposition.md 2>/dev/null || cat "$(dirname "$(readlink -f .claude/commands/do/rpr.md)")/../../lib/finding-disposition.md"`

Only when a finding is being deferred:

!read lib/plan-issue-setup.md
!read lib/plan-issue-filing.md

!`cat ~/.claude/lib/review-fix-conventions.md 2>/dev/null || cat "$(dirname "$(readlink -f .claude/commands/do/rpr.md)")/../../lib/review-fix-conventions.md"`

## Local-Agent Review Loop (for `--review-with codex|agy|claude|grok|pi|cursor|opencode|cmd[<invocation>]`)

Pass `{REVIEW_AGENT}`, `{REVIEWER_APPLIES}` (forced `false` for `cmd`), the entry's resolved `{REVIEW_MODEL}` (its `<agent>[<model>]` bracket, else the saved `review-models[slug]` default resolved above, else empty — without it `--review-with codex[o3]` would silently run the CLI's default model), its `{REVIEW_EFFORT}`, `{REVIEWER_CMD}` in place of both for `cmd`, `{MAX_ITERATIONS}` / `{MAX_EXPLICIT}` (from `~max=<n>`; the built-in `3` / `false` otherwise), the head branch, the base branch and the project `{BUILD_CMD}`. The loop verifies build and tests before it pushes.

Read only when `REVIEW_AGENTS` contains one of those slugs (`cmd` included):

!read lib/local-agent-review-loop.md

## Ollama Review Loop (for `--review-with ollama[<model>]`)

Pass `{OLLAMA_MODEL}` (empty = auto-select), `{OLLAMA_EFFORT}`, `{MAX_ITERATIONS}` / `{MAX_EXPLICIT}` as above, the head branch, the base branch and the project `{BUILD_CMD}`. The loop reviews the local `git diff` and is always review-only: it emits findings, the orchestrator applies them and verifies build and tests before pushing.

Read only when `REVIEW_AGENTS` contains `ollama`:

!read lib/ollama-review-loop.md

## Host-Reviewer Loop (for `--review-with copilot|@<login>`)

rpr requests and waits for host-side reviews through the same shared loop `/do:pr` uses; it has no request or polling code of its own. For each `copilot` or `@<login>` entry, pass `{CODE_HOST}`, `{CR_NOUN}`, `{PR_NUMBER}`, `{OWNER}`/`{REPO}`, `{GH_HOST}`, the head branch as `{BRANCH_NAME}`, the project `{BUILD_CMD}`, `{REVIEWER_LOGIN}`, and:

- `{REVIEW_ITERATIONS}` — the entry's `~max=<n>`; without one, `0` (keep re-requesting until the reviewer is clean, bounded by the loop's convergence gate and 10-iteration guardrail).
- `{WAIT_SCHEDULE}` — the default for the entry's reviewer kind ("Wait schedules" in the host-reviewer file read below); rpr does not override it.

Three rpr-specific rules sit on top of the shared loop:

- **Copilot is GitHub's reviewer.** On GitLab, print `copilot is GitHub's reviewer and is unavailable on this gitlab MR — skipped.` and do not dispatch it.
- **rpr brings Copilot in only when it is already in play or the PR has had no review at all.** In the `cr-state` output on GitHub, if the PR carries a completed review from someone else and none from `copilot-pull-request-reviewer`, skip the `copilot` entry and say so, so that resolving a human's review does not summon a bot review as a side effect. An `@<login>` entry names its reviewer outright and is always requested.
- **Threads you answered and left open are settled.** The shared loop treats every unresolved thread by its reviewer as open work, so tell its sub-agent which threads rpr already replied to (as non-issues or deferred), and treat a review whose only unresolved threads are those as clean.

The shared loop already covers a review that is pending or in progress at entry (requesting again is harmless on both hosts, and it waits for a review of the current head), a review that already exists for the current head (it is reused, not re-requested), and Copilot's error and too-large replies. It does not watch CI while it waits; rpr checks CI after each push instead ("CI after a push"). Never request Copilot with an `@copilot review` comment: that starts the Copilot coding agent, which opens a new PR.

Read only when `REVIEW_AGENTS` contains `copilot` or an `@<login>`:

!read lib/host-reviewer-loop.md

Only for a `copilot` entry on GitHub, also read the Copilot delta:

!read lib/copilot-review-loop.md

## CI after a push

After each push rpr makes, and after a reviewer loop that pushed, wait for CI on the new head and fix what it breaks:

- **GitHub**: `gh pr checks PR_NUM --watch --fail-fast` (it also exits non-zero with "no checks reported" when the repo runs no CI on this PR, which is nothing to fix). On a failure, fetch the failed run's log:
  ```bash
  RUN_ID="$(gh pr checks PR_NUM --json name,bucket,link \
    --jq '.[] | select(.bucket=="fail") | .link | capture("/runs/(?<id>[0-9]+)") | .id' \
    | head -n1)"
  gh run view "$RUN_ID" --log-failed
  ```
- **GitLab**: block on `glab ci status --wait --branch <source_branch>`, then read `cr-state`'s `.pipeline` and trust its `status` only when `.pipeline.sha` is the head you pushed. A `null` pipeline means the project runs no CI for this MR. On `failed`, fetch the failed jobs' logs for `.pipeline.id`; capture the `glab api` call and check its exit status before parsing (piping `glab api` into `jq` hides a failed call):
  ```bash
  JOBS_FILE="$(mktemp)" && trap 'rm -f "$JOBS_FILE"' EXIT
  glab api "projects/:id/pipelines/PIPELINE_ID/jobs?scope[]=failed" > "$JOBS_FILE" \
    || { echo "could not list the failed jobs of pipeline PIPELINE_ID"; exit 1; }
  for JOB_ID in $(jq -r '.[].id' "$JOBS_FILE"); do glab ci trace "$JOB_ID"; done
  ```

Fix the failure, confirm with the focused local check, commit, push, and check the new run the same way. After 3 red runs in a row, stop fixing CI and list the failing checks in the report summary.
