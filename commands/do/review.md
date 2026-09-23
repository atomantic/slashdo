---
description: Deep code review of changed files against software engineering best practices
argument-hint: "[--strict|--nuclear] [--draft] [--apply|--no-apply] [--merge|--merge=<method>] [--review-with <agent>[,<agent>...]] [--review-iterations <n>] [--review-mode <series|parallel>] [--review-stop-on-findings|--review-stop-on-clean] [--reviewer-applies] [--issues-label <name>] [PR-URL | MR-URL | base-branch]"
---

## Parse Arguments

Parse `$ARGUMENTS` for:
- **`--strict`** (alias: **`--nuclear`**): raise the structural-review bar — permit the Structural Ambition lens when the diff contains structural signals, and promote structural findings to blocker tier. Strict mode does not force a focused agent when the orchestrator finds no structural concern.
- **`--draft`** (PR mode only): write the review payload to `/tmp/do-review-pr-{PR_NUM}-payload.json` and print the command(s) to publish it manually (`gh api` on GitHub, the retargeted `glab` calls on GitLab), instead of posting the review. Ignored when `PR_MODE=false`. Implies `--no-apply` — a draft publishes nothing, so it must not push commits either.
- **`--apply` / `--no-apply`** (mutually exclusive, PR mode only): how verified findings are delivered. Default `PR_APPLY=auto` — **commit the fixes onto the PR's head branch when we can push to it, post inline review comments when we can't** (see "Determine write access"). `--no-apply` forces review-only; `--apply` forces fix-and-push and aborts with `--apply was requested but the PR head branch is not writable ({reason}) — rerun without --apply to post an inline review instead.` when `CAN_PUSH_HEAD=false`. Abort with `--apply and --no-apply cannot be combined` if both appear.
- **`--merge` / `--merge=<method>`** (optional, PR mode only): after the review finishes **clean**, merge the PR. Off by default — without this flag `/do:review` never merges anything. `<method>` ∈ {`squash`, `rebase`, `merge`}; abort on anything else with `--merge=<method> must be one of squash, rebase, merge (got: {value}).` Record `MERGE_ENABLED=true` and, when given, `MERGE_METHOD`. Every gate in "Merge the PR" must pass — the flag requests a merge, it does not authorize one.

!`cat ~/.claude/lib/review-flags.md`

After parsing the flags above, apply any **saved defaults** (set via `/do:config`) to the flags the user did NOT pass (the delegated-review flags **and** `--issues-label`) — an explicit flag, or `--review-with none`, always overrides a saved default:

!`cat ~/.claude/lib/review-config-defaults.md`

!`cat ~/.claude/lib/config-defaults-issues-merge.md`

- **`--issues-label <name>`** (optional): a **deferred** finding (local-branch mode only — see Finding Disposition) is filed as a GitHub/GitLab issue with this label. Set `PLAN_LABEL` from `--issues-label`, else the saved `issues-label` default, else `plan` (a saved `issues` key is ignored). No effect in PR mode. `--issues` is a deprecated no-op: print once `--issues is now the default (PLAN.md mode was removed); the flag can be dropped.` `--no-issues` aborts with `--no-issues is no longer supported: PLAN.md mode was removed. slashdo records work only in the project's issue tracker.`
- **PR reference** — any non-flag token that looks like a pull-request reference. **Match on URL *shape*, never on the hostname** — a self-managed GitHub Enterprise host often carries no `github` substring; the host-independent `/pull/{number}` path segment is what identifies a GitHub-flavored PR. A token matches if **any** of the following holds:
  - Full URL of the shape `{scheme}://{host}/{owner}/{repo}/pull/{number}` — **any** `{host}`, including `github.com`, `github.example.com`, and a GHES host with no `github` substring. Trailing subpaths (`/files`, `/commits`, `/checks`) and a `#discussion_r…` fragment are allowed and ignored.
  - SSH-style URL (`git@{host}:{owner}/{repo}`) carrying the same `/pull/{number}` segment — again on any host.
  - Shorthand: the argument matches `^[^/]+/[^/]+#[0-9]+$` AND `gh repo view {owner}/{repo}` confirms it resolves. Take `{GH_HOST}` from the `origin` remote here — a shorthand carries no host of its own.
  - Extract `OWNER`, `REPO`, and `PR_NUM`. Set `PR_MODE=true`, `CODE_HOST=github`, `CR_NOUN=PR`, and `PR_URL` to the canonical URL. Capture the URL's **host** as `{GH_HOST}` — `gh api` ignores the repo remote and defaults to github.com, so the calls below pass it explicitly (see `~/.claude/lib/gh-host.md`). It comes from the **PR URL**, not `origin` — the PR can live on a different host than the checkout.
- **MR reference** (GitLab), also matched by URL *shape* on any host, whether `gitlab.com` or self-managed. **Check it before the PR shapes**, because a token carrying `/merge_requests/` is never a GitHub PR or a base branch. A token matches if it is:
  - A URL with a `/-/merge_requests/{iid}` segment, or the legacy `/merge_requests/{iid}` one: `{scheme}://{host}/{project path}/-/merge_requests/{iid}`. The project path can carry subgroups (`group/sub/project`). Trailing subpaths (`/diffs`, `/commits`, `/pipelines`), a query, and a `#note_…` fragment are ignored.
  - Record the token as `MR_REF`. Set `PR_MODE=true`, `CODE_HOST=gitlab`, and `CR_NOUN=MR`. "GitLab MR mode" under Determine Scope parses `MR_REF` into `PR_NUM` (the MR **iid**) and the target `GL_HOST` / `GL_PROJECT`. The target comes from the reference, not `origin`, because the MR can live on a different host or project than the checkout.
- Any other non-flag token: treat as the base branch override (only when `PR_MODE=false`).

Set `STRICT_MODE=true` if either strict flag is present.

If both a PR URL and a base-branch token are provided, the PR URL wins — ignore the base-branch token and warn the user.

## Determine Scope

### Local branch mode (`PR_MODE=false`)

1. **Detect the base branch** — the positional argument if provided, otherwise `gh repo view --json defaultBranchRef -q '.defaultBranchRef.name'`. Also **derive `{GH_HOST}` from the `origin` remote** using the shared snippet at the end of this section.
2. **Detect the current branch** — `git branch --show-current`
3. **Get the diff stat** — `git diff {base}...HEAD --stat`
4. **Get the full diff** — `git diff {base}...HEAD`
5. Print: `Reviewing: {current} vs {base} — {N} files changed{strict_suffix}` where `{strict_suffix}` is ` (strict mode)` when `STRICT_MODE=true`, empty otherwise

If there are no changes, inform the user and stop.

**Local branch mode only.** PR mode (below) takes `{GH_HOST}` from the **PR URL**, not from `origin` — do not re-derive it from the remote there.

!`cat ~/.claude/lib/gh-host.md`

### PR / MR mode (`PR_MODE=true`)

Do NOT use the local working tree as the source of truth; review the PR or MR as published on its code host. This entire mode (fetching the change, probing write access, fixing on its branch, pushing, posting the review, and merging) is content a local run never touches. It is loaded in one shot, one partial per code host.

GitHub PR mode, only when `CODE_HOST=github` (a GitHub PR reference):

!read lib/review-pr-mode.md

GitLab MR mode, only when `CODE_HOST=gitlab` (a GitLab MR reference):

!read lib/review-mr-mode.md

Resolve `PR_DISPOSITION` from `PR_APPLY` and `CAN_PUSH_HEAD`. The write-access probe in the loaded partial sets `CAN_PUSH_HEAD`:

| `PR_APPLY` | `CAN_PUSH_HEAD` | `PR_DISPOSITION` |
|---|---|---|
| `auto` (default) | `true` | `apply` — fix, verify, commit, and push onto the PR head branch |
| `auto` (default) | `false` | `inline` — post the findings as a PR review |
| `--no-apply` (or `--draft`) | either | `inline` |
| `--apply` | `true` | `apply` |
| `--apply` | `false` | abort with the `--apply` message from Parse Arguments |

Print the choice with its reason on one line, e.g. `Disposition: apply — pushing fixes to
{HEAD_OWNER}/{HEAD_REPO}:{HEAD_REF}` or `Disposition: inline — fork PR with maintainer edits
off, posting review comments`. A `false` here is an ordinary outcome, not a failure.

## Apply Project Conventions

Use CLAUDE.md's rules (code style, error handling, logging, security model, scope exclusions) as overrides to generic best practices, and pass the relevant overrides to each agent.

In `PR_MODE`, the local CLAUDE.md may not apply to the PR (fork or different repo). Also fetch the target repo's CLAUDE.md and AGENTS.md if they exist. The command below is for GitHub; GitLab MR mode fetches them in `lib/review-mr-mode.md` step 6:
```bash
gh api --hostname {GH_HOST} repos/{OWNER}/{REPO}/contents/CLAUDE.md?ref={HEAD_SHA} --jq '.content' 2>/dev/null | base64 -d > /tmp/do-review-pr-{PR_NUM}-CLAUDE.md || true
gh api --hostname {GH_HOST} repos/{OWNER}/{REPO}/contents/AGENTS.md?ref={HEAD_SHA} --jq '.content' 2>/dev/null | base64 -d > /tmp/do-review-pr-{PR_NUM}-AGENTS.md || true
```
Pass whichever exists to the agents instead of (or in addition to) the local one.

## PR-Level Coherence Check

Before dispatching agents, understand what this change set claims to do:

1. Read commit messages (`git log {base}...HEAD --oneline`)
2. Read the project docs, changelog (if any), and the PR description for capability claims, test counts, and "deep-links to X" / "feature Y now works" assertions
3. Note the claims — verify after agents return whether the code delivers them. Concrete drift to flag:
   - Test counts in docs/changelog vs `find . -name '*.test.*' -exec grep -c '^\(it\|test\)(' {} +` (or project equivalent)
   - "Deep-links to record X" claims vs whether the destination route handler actually consumes the encoded parameter
   - "Auto-prune after N days" / "scans only the page returned" claims vs the listing implementation
   - Comments in code claiming behavior the surrounding code doesn't perform
   - Field names quoted in docs (request body shape, event payload shape) vs what the code actually reads/emits

## Dispatch Review Agents

The host CLI is the review orchestrator. Inspect the scoped diff, run the selection protocol below, then spawn only the focused agents it selects — **in parallel** via the Agent tool at the **`heavy` tier** (this host's strongest model by alias, `model: "opus"` on Claude Code, per [lib/model-tiers.md](../../lib/model-tiers.md); never a version ID, never the session's own tier). If that tier is rejected for lack of entitlement, retry once with `model` omitted, say so, and continue. Each selected agent reviews ALL changed files independently.

The host orchestrator does the full review itself even when no focused agent is selected. Do not dispatch a focused agent merely because it exists below or because strict mode is active; use the selection protocol and record the decision.

### Select the review lenses

!`cat ~/.claude/lib/review-agent-selection.md`

<surface_scan_agent>

### 1. Surface Scan Agent (Runtime)

Catches per-file RUNTIME bugs: crashes, type/coercion errors, async/state, error handling, streaming, plus domain-specific runtime patterns (SQL, shell, wire protocols, accessibility).

Lens body — read only if this lens was selected:

!read lib/review-surface-scan.md

</surface_scan_agent>

<surface_quality_agent>

### 2. Surface Quality Agent

Catches per-file QUALITY issues: intent-vs-implementation drift, AI-generated code patterns, dead config, missing tests, supply chain hygiene, style.

Lens body — read only if this lens was selected:

!read lib/review-surface-quality.md

</surface_quality_agent>

<security_agent>

### 3. Security Audit Agent

Catches trust boundary violations, injection, SSRF, data exposure, and access control gaps.

Lens body — read only if this lens was selected:

!read lib/review-security-audit.md

</security_agent>

<cross_file_tracing_agent>

### 4. Cross-File Tracing Agent (State/Lifecycle)

Catches STATE/LIFECYCLE issues across files: stale state propagation, lifecycle gaps (mount/unmount, init/cleanup, started/completed), resource leaks, lock/flag exit paths, concurrent-mutation races.

Lens body — read only if this lens was selected:

!read lib/review-cross-file-tracing.md

</cross_file_tracing_agent>

<cross_file_contract_agent>

### 5. Cross-File Contract Agent

Catches CONTRACT issues across files: schema/shape agreements, validation parity, error classification, field-set enumerations, intent-vs-implementation claims spanning files, architectural-pattern adherence.

Lens body — read only if this lens was selected:

!read lib/review-cross-file-contract.md

</cross_file_contract_agent>

<structural_ambition_agent>

### 6. Structural Ambition Agent (optional; strict mode required)

Dispatch only when `STRICT_MODE=true` **and** the selection protocol identifies a structural signal. Catches STRUCTURAL issues the other agents miss: missed code-judo simplifications, file-size growth past 1000 lines, ad-hoc conditionals bolted onto unrelated flows, thin wrappers, boundary leaks, bespoke duplicates of canonical helpers, cast-heavy/optional-soup contracts. Push the bar to "this works AND the implementation feels inevitable in hindsight."

Lens body — read only if this lens was selected:

!read lib/review-structural-ambition.md

</structural_ambition_agent>

### How to dispatch

For each selected agent, construct its prompt by combining:
1. The agent's instruction content (from the sections above), plus the orchestrator's recorded reason for selecting that lens
2. Project convention overrides from CLAUDE.md (the PR's CLAUDE.md/AGENTS.md when `PR_MODE=true`)
3. The list of changed files from the diff stat (or the PR/MR changed-files list in PR mode) AND, in PR mode, the path to each file's full content under `/tmp/do-review-pr-{PR_NUM}/`
4. In PR mode only: the path to `/tmp/do-review-pr-{PR_NUM}-lines.json` (the commentable-lines map) and an instruction that **every finding MUST cite a `file:line` where `line` appears in the commentable-lines map** — otherwise the finding cannot be posted inline and is downgraded to a summary-only finding
5. Instruction: "Read each changed file in full (not just diff hunks). Report findings that demonstrate consequence reasoning, not just pattern matches."
6. In PR mode only: "For every CRITICAL or IMPROVEMENT finding where a concrete fix is obvious, include a `suggestion:` block — the exact replacement text for the cited line(s). Use `start_line` and `line` to span multiple lines when the fix needs more than one line. The reviewer will package these as inline review suggestions."

Spawn the selected agents simultaneously in one parallel batch. If the selection is
empty, spawn no focused agents and continue with the host orchestrator's self-review.
Each selected agent returns its findings independently.

### Large PR handling

If the diff touches more than 20 files, tell each selected agent to batch files by directory and process groups sequentially within their parallel run. The orchestrator does not manage batching.

## Collect & Deduplicate

After the host self-review and any selected agents return:

1. **Merge** all findings into a single list, tagged by source agent
2. **Deduplicate**: if two agents flagged the same `file:line` with overlapping descriptions, keep the most detailed version and note all agents that found it (overlap is signal the finding is real); prefer the Structural Ambition phrasing when it names a concrete reframing
3. **PR coherence**: verify commits deliver what they claim — flag discrepancies as IMPROVEMENT findings
4. **CLAUDE.md filter**: remove findings that conflict with explicit project conventions
5. **Strict-mode severity promotion** (only when `STRICT_MODE=true`): promote findings marked `[BLOCKER]` by the Structural Ambition agent to CRITICAL in the fix phase, along with findings from other agents that match a strict-mode blocker pattern (file pushed past 1000 lines, ad-hoc conditional in unrelated flow, thin wrapper/identity abstraction, bespoke duplicate of a canonical helper)

## Verify Findings

For each finding, ground it in evidence before classifying:
1. **Quote the specific code line(s)** that demonstrate the issue
2. **Explain why it's a problem** in one sentence given the surrounding context
3. If the fix involves async/state changes, **trace the execution path** to confirm the issue is real
4. If you cannot quote specific code for a finding, downgrade it to **[UNCERTAIN]**

Verification here is reading code, not running it — a build/test pass over unfixed code cannot show a finding is a false positive. The project's build and test commands run once, after fixes, in "Fix Issues" (local branch mode and `PR_DISPOSITION=apply`); a failure there blocks the commit/push. `PR_DISPOSITION=inline` skips the local build/test step entirely (nothing is checked out; the PR's CI is the source of truth) and verifies by reading code only.

## Fix Issues (local branch mode, and PR mode when `PR_DISPOSITION=apply`)

**Skip this section when `PR_MODE=true` and `PR_DISPOSITION=inline`** — jump to the loaded partial's review-posting section ("Post Review to GitHub PR" in `lib/review-pr-mode.md`, or "Post Review to GitLab MR" in `lib/review-mr-mode.md`).

When `PR_MODE=true` and `PR_DISPOSITION=apply`, first follow the loaded partial's branch-checkout step ("Fix Issues — PR-branch checkout" on GitHub, "Fix Issues — MR-branch checkout" on GitLab). It checks out the change's branch and sets the commit-attribution convention. Then run this section against that branch instead of the local one, then continue to the partial's push step ("Push fixes to the PR branch" / "Push fixes to the MR branch").

!`cat ~/.claude/lib/finding-disposition.md`

Only when a finding is being deferred:

!read lib/vcs-host.md
!read lib/plan-issue-setup.md
!read lib/plan-issue-filing.md

For each verified finding (local branch mode):
1. Classify severity: **CRITICAL** (runtime crash, data leak, security) vs **IMPROVEMENT** (consistency, robustness, conventions)
2. Fix all CRITICAL issues immediately
3. Fix IMPROVEMENT issues too. Per Finding Disposition, defer to a tracker issue only when the fix is genuinely large/architectural or too risky to land in this branch
4. **Identify the root cause** of why the issue existed (missing lint rule, missing comment at the canonical site, misleading name, API that invites the mistake, etc.) and apply the smallest matching action **in the same change**. Defer big refactors and cross-cutting patterns to the end-of-loop Convention Encoding phase.

!read lib/review-fix-conventions.md

5. After fixes, run the project's test suite and build command
6. Verify the test suite covers the changed code paths — passing unrelated tests is not validation
7. Commit fixes: `address review (self): <summary>` — the parenthesized reviewer name matches the convention used by delegated `--review-with` passes.

`PR_MODE=true` and `PR_DISPOSITION=apply` continues from here to "Push fixes to the PR branch", `PR_DISPOSITION=inline` to "Post Review to GitHub PR", and `--merge` to "Merge the PR". All three are in the partial already loaded above, and GitLab MR mode names them with "MR" ("Post Review to GitLab MR", "Merge the MR").

## Report

Print a summary table of what was reviewed and found. The table is dynamic: always include the host orchestrator, include only the focused agents actually selected, and do not print rows for focused agents that were skipped. Before the table, print the selected lenses with their reasons and note when the empty selection was intentional.

```
## Review Summary

| Reviewer | Files Checked | Issues Found | Fixed |
|----------|--------------|-------------|-------|
| Host orchestrator (self-review) | N | N | N |
| {selected focused lens} | N | N | N |
| **Total** | **N** | **N** | **N** |

Omit all focused-lens rows when none were selected.

### Issues Fixed
- file:line — description of fix (agent: Surface-Scan / Surface-Quality / Security / Cross-File-Tracing / Cross-File-Contract / Structural-Ambition)

### Accepted As-Is (with rationale)
- file:line — description and why it's acceptable

### Deferred
- #<issue> — title (or, with no tracker: "Deferred (not filed — no issue tracker available)" with title, rationale, file:line)
```

If no issues were found, confirm the code is clean and ready for PR.

In `PR_MODE`, follow "Report additions" in the PR/MR-mode partial loaded above instead — it replaces the sections above with the PR-disposition variants and the merge outcome.

## Convention Encoding

**Skip when `PR_MODE=true`** — convention encoding mutates the local working tree, the wrong target for someone else's remote PR; put convention recommendations in the posted review's summary body instead, as suggestions to the PR author.

After the report is printed and fixes are committed (local branch mode), for each finding pattern likely to recur (fixed or accepted-as-is), apply the **smallest** code-level action that makes the convention self-evident (in-tree comment at the canonical site, a clarifying rename, or a surgical refactor that removes the footgun). CLAUDE.md / AGENTS.md additions are a **fallback** for conventions that can't be expressed locally. Encoded actions land in the same branch as the review fixes. (Root-cause identification already happened per finding, at Fix Issues step 4 above.)

!read lib/review-fix-conventions.md

## PR Comment Policy

**This section applies only when `PR_MODE=false`.** When `PR_MODE=true`, delivering the findings to the PR IS the deliverable, so the self-vs-other-author check is skipped: `PR_DISPOSITION=apply` pushes the fixes and `PR_DISPOSITION=inline` always posts the review.

For local branch mode, after the review and any fixes:

1. **Check for an open PR** on the current branch: `gh pr view --json number,author --jq '{number, author: .author.login}' 2>/dev/null`. If the command fails (no PR exists), skip posting.
2. **Get the current user**: `gh api --hostname {GH_HOST} user -q '.login'`
3. **Compare**: If the PR author login **matches** the current user, do NOT post comments — the local fixes and summary are sufficient.
4. **If the PR was opened by someone else**, post `gh pr review {number} --comment --body "..."` summarizing issues found, fixes applied, and remaining items for the author.

## Delegated Review Passes (`--review-with`)

**Skip this section when `REVIEW_AGENTS` is empty.**

After the host CLI's self-review has fully completed for the active mode (local: fixes applied and Convention Encoding done; PR: review posted, Convention Encoding deliberately skipped), hand off to the **multi-reviewer loop**. Do NOT block delegation on a phase that is intentionally inert for the current mode.

Inputs to the wrapper:

- `{REVIEW_AGENTS}` — the parsed list (e.g. `[claude, agy, copilot]`)
- `{REVIEW_STOP_MODE}` — `all` (default) | `on-findings` | `on-clean`
- `{REVIEW_MODE}` — `series` (default) | `parallel`
- `{REVIEWER_APPLIES}` — boolean, forwarded to each local-agent pass
- `{REVIEW_ITERATIONS}` — non-negative integer (default `1`); copilot/`@<login>` iteration cap (`0` = loop until clean)
- `{REVIEW_MODELS}` — the saved per-agent default models (`EFFECTIVE_REVIEW_MODELS` from the saved-defaults step); every local reviewer but `cmd` reads it when an entry's own `[<model>]` bracket is absent
- `{GH_HOST}` — the GitHub API host established in "Determine Scope" (the PR URL's host in PR mode, the `origin` remote's host in local mode); forwarded to the GitHub loops so their `gh api` calls target the right host on GitHub Enterprise
- `{CODE_HOST}` / `{CR_NOUN}` — in PR mode, the reference's host from Parse Arguments: `github` / `PR` for a GitHub PR, `gitlab` / `MR` for a GitLab MR. Never re-derive them from `origin` there. In local mode, use the `origin` code host from `lib/vcs-host.md`. When the list has a `copilot` or `@<login>` entry and the deferral path has not already resolved it, read and run that partial now. It selects the verb file the host-side loops run, so `@<login>` works on the branch's GitLab MR too.
- `{WAIT_SCHEDULE}` — the single schedule selected below for the current host-side entry

For each host-side entry, resolve the caller-owned `{WAIT_SCHEDULE}` before dispatch:

- `copilot` — use the previous Copilot review duration on this PR (default 60 seconds if none); max wait 3x that duration, minimum 90 seconds, maximum 5 minutes; poll every 5s, 5s, 10s, 10s, then 15s.
- `@<login>` — expected duration 5 minutes; max wait 3x that duration, minimum 3 minutes, maximum 15 minutes; poll every 10s, 10s, 20s, 20s, then 30s.

Forward only the selected schedule as `{WAIT_SCHEDULE}`; never give one pass both schedules.

Per-agent dispatch inside the wrapper:

- `copilot` and `@<login>` — host-side and PR/MR-bound: only meaningful when a PR/MR exists for the current branch (local mode) or when `PR_MODE=true`. `copilot` (GitHub only) requests a review through the shared host-reviewer template plus the Copilot delta; `@<login>` requests a review from the code-host user `{REVIEWER_LOGIN}` through the shared template. If no PR is associated with the current branch in local mode, print `Skipping copilot pass: no open PR on {branch}.` / `Skipping @{REVIEWER_LOGIN} pass: no open PR on {branch}.` and continue to the next agent. In GitLab MR mode, the GitLab verbs resolve the project from `origin`, so an `@<login>` pass runs only when `MR_IN_CHECKOUT=true` (set in `lib/review-mr-mode.md`). Otherwise print `Skipping @{REVIEWER_LOGIN} pass: this checkout is not {GL_PROJECT}; run /do:review from a clone of it to add host reviewers.` and record the pass `skipped`.
- `codex` | `agy` | `claude` | `grok` | `pi` | `cursor` | `opencode` | `cmd` | `ollama` — invoke the local-agent review loop (ollama: the Ollama review loop). The CLI runs a self-contained single-agent review prompt headless (codex: `codex review --base "$BASE_BRANCH"`; the others: `git diff $BASE_BRANCH...HEAD` inside the prompt) — never the `/do:review` multi-sub-agent skill, which hangs headless. The loop publishes nothing to the PR; in review-only mode it emits findings to stdout and the orchestrator owns any PR comment.
  - In **local branch mode**, set the wrapper's `BASE_BRANCH=$BASE_BRANCH` so the inner loop reviews against the same base this self-review used (with the host's just-committed fixes in HEAD).
  - In **PR mode**, a local `git diff` needs a checked-out branch and a resolvable base ref — a PR URL won't resolve — so **these passes are skipped** unless the PR branch is checked out locally with a resolvable base (`copilot` is the PR-by-URL reviewer), printing `Skipping {agent} pass in PR mode: the local-agent loop reviews a local git diff and cannot resolve a PR URL. Use --review-with {agent} against a local branch instead.` Each skip is recorded in the per-pass table as status `skipped`, treated like a non-fix inconclusive for `{OVERALL_STATUS}` purposes.

### Multi-reviewer wrapper

Read when `REVIEW_AGENTS` is non-empty:

!read lib/multi-reviewer-loop.md

### Inner loop bodies (referenced by the wrapper)

Read only the bodies for reviewer kinds present in the agent list.

For every `copilot` or `@<login>` entry, read the shared host-reviewer template (its sub-agent runs the `{CODE_HOST}` verb file):

!read lib/host-reviewer-loop.md

Only for `copilot` entries on GitHub, also read the Copilot delta:

!read lib/copilot-review-loop.md

Only for an entry that is none of `copilot`, `ollama`, or `@<login>` (every other slug — the fixed CLIs and `cmd[<invocation>]` alike — dispatches through this one loop; a future addition needs no new gate here):

!read lib/local-agent-review-loop.md

Only for `ollama` entries:

!read lib/ollama-review-loop.md

### Final report (when delegated passes ran)

After the wrapper exits, append its aggregate report to the self-review summary (self-review = pass 0, delegated passes 1..N). The final overall status is whichever is worse: the self-review's "issues remaining" count or the wrapper's `{OVERALL_STATUS}`.
