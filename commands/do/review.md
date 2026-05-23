---
description: Deep code review of changed files against software engineering best practices
argument-hint: "[--strict|--nuclear] [--draft] [--review-with <agent>[,<agent>...]] [--review-stop-on-findings|--review-stop-on-clean] [--reviewer-applies] [PR-URL | base-branch]"
---

## Parse Arguments

Parse `$ARGUMENTS` for:
- **`--strict`** (alias: **`--nuclear`**): enable the Structural Ambition agent (6th agent) and promote structural findings to blocker tier. Use for branches you want to land cleanly — flags file-size growth past 1000 lines, ad-hoc conditionals bolted onto unrelated flows, thin wrappers, boundary leaks, and missed code-judo simplifications.
- **`--draft`** (PR mode only): write the review payload to `/tmp/do-review-pr-{PR_NUM}-payload.json` and print the `gh api` command to publish it manually, instead of posting the review immediately. Ignored when `PR_MODE=false`.
- **`--review-with <agent[,agent,...]>`** (optional): after the host CLI's self-review completes (the multi-agent flow defined below), delegate **additional** review passes to the named external CLIs in order. Accepted slugs per slot: `copilot`, `codex`, `gemini`, `claude`. Split on `,`, trim whitespace, dedupe preserving first-occurrence order. Abort with `Unknown --review-with value: {value}. Use one of: copilot, codex, gemini, claude.` on any unknown slug. If omitted, `REVIEW_AGENTS=[]` and no delegated passes run — behavior matches the historical `/do:review` (self-review only). **The host CLI is not implied in this list** — whichever CLI is hosting `/do:review` (claude, codex, or gemini) runs the self-review first regardless. The list names *additional* reviewers; an explicit `claude` entry while running under claude means "start a fresh claude headless session for a second-pass perspective," which is allowed.
- **`--review-stop-on-findings` / `--review-stop-on-clean`** (mutually exclusive, optional): stop-mode for the delegated passes. Default `REVIEW_STOP_MODE=all` (run every listed agent). `on-findings` stops after the first delegated reviewer that surfaces a non-empty change set; `on-clean` stops after the first delegated reviewer that reports zero findings. Abort with `--review-stop-on-findings and --review-stop-on-clean cannot be combined` if both appear.
- **`--reviewer-applies`** (optional, boolean): forwarded to each delegated local-agent pass to route fixes through the reviewing CLI instead of the orchestrator. See `lib/local-agent-review-loop.md` "Editing mode" for the trade-offs. No effect on the copilot path or on the host's self-review.
- **GitHub PR reference** — any non-flag token that looks like a PR reference. A token matches if **any** of the following holds (the rules are OR-ed; the `github` substring is sufficient but not required):
  - Full URL: `https://github.com/{owner}/{repo}/pull/{number}` (and any subpath like `/files`, `/commits`)
  - SSH-style URL with `github.com` host
  - Any URL containing the substring `github` AND a `/pull/{number}` segment — covers GHES hosts like `github.example.com`
  - Shorthand: the argument matches `^[^/]+/[^/]+#[0-9]+$` AND `gh repo view {owner}/{repo}` confirms it resolves (the shorthand form does NOT require the `github` substring — `gh` is the source of truth for whether it's a real repo)
  - Extract `OWNER`, `REPO`, and `PR_NUM`. Set `PR_MODE=true` and `PR_URL` to the canonical URL.
- Any other non-flag token: treat as the base branch override (only when `PR_MODE=false`).

Set `STRICT_MODE=true` if either strict flag is present.

If both a PR URL and a base-branch token are provided, the PR URL wins — ignore the base-branch token and warn the user.

## Determine Scope

### Local branch mode (`PR_MODE=false`)

1. **Detect the base branch** — use the positional argument if provided, otherwise run `gh repo view --json defaultBranchRef -q '.defaultBranchRef.name'`
2. **Detect the current branch** — `git branch --show-current`
3. **Get the diff stat** — `git diff {base}...HEAD --stat` to see all changed files and line counts
4. **Get the full diff** — `git diff {base}...HEAD` to see actual changes
5. Print: `Reviewing: {current} vs {base} — {N} files changed{strict_suffix}` where `{strict_suffix}` is ` (strict mode)` when `STRICT_MODE=true`, empty otherwise

If there are no changes, inform the user and stop.

### GitHub PR mode (`PR_MODE=true`)

When a PR URL was parsed, do NOT use the local working tree as the source of truth. Review the PR as published on GitHub instead.

1. **Fetch PR metadata**:
   ```bash
   gh pr view {PR_NUM} --repo {OWNER}/{REPO} --json number,title,author,baseRefName,headRefName,headRefOid,baseRefOid,url,isCrossRepository,headRepositoryOwner,headRepository
   ```
   Capture `HEAD_SHA` (`headRefOid`), `BASE_SHA` (`baseRefOid`), `HEAD_REF`, `BASE_REF`, `AUTHOR_LOGIN`, and `IS_FORK` (`isCrossRepository`).
2. **Fetch the changed-files list**:
   ```bash
   gh pr diff {PR_NUM} --repo {OWNER}/{REPO} --name-only
   ```
3. **Fetch the full unified diff** (used by agents to scope to changed hunks AND used later to filter inline comments to lines that exist in the diff):
   ```bash
   gh pr diff {PR_NUM} --repo {OWNER}/{REPO} > /tmp/do-review-pr-{PR_NUM}.diff
   ```
4. **Parse the diff to build a "commentable lines" map** — `{file_path: set of line numbers on the RIGHT (new) side of the diff}`. GitHub's review API only accepts inline comments on lines that appear in the patch; comments on lines outside the diff will be rejected. Walk the unified diff line by line:
   - Track the current file from `diff --git a/<path> b/<path>` headers (authoritative for both adds and renames). Prefer this over `+++ b/<path>` because deletions emit `+++ /dev/null` and renames may not round-trip the new path through `+++` alone.
   - If the file is deleted (the `+++` header is `/dev/null`), skip it entirely — there are no right-side lines to comment on.
   - Parse each `@@ -a,b +c,d @@` hunk header to seed the right-side line counter at `c`, then iterate hunk body lines: increment the counter on `+` (added) and ` ` (context) lines and include both in the map; skip `-` (removed) lines without incrementing.
   - **Ignore the `\ No newline at end of file` marker line** — it's metadata, not a content line, and must NOT advance the right-side counter.
   - (Do NOT use `git apply --numstat` — it reports per-file add/delete totals, not hunk line ranges.) Save to `/tmp/do-review-pr-{PR_NUM}-lines.json`.
5. **Fetch each changed file at HEAD_SHA** so agents can read full file content (not just the hunk). Skip deleted files — `repos/{OWNER}/{REPO}/contents/{path}?ref={HEAD_SHA}` returns 404 for any path removed in the PR, and a strict failure would derail PR-mode for delete-only or mixed-deletion PRs:
   ```bash
   gh api repos/{OWNER}/{REPO}/contents/{path}?ref={HEAD_SHA} --jq '.content' 2>/dev/null | base64 -d > /tmp/do-review-pr-{PR_NUM}/{path} || echo "skipped (deleted or unreadable): {path}"
   ```
   (Create parent dirs as needed; URL-encode the path. Use the `diff --git` header from step 4 to identify deletions up front and skip the fetch entirely for those.)
6. Print: `Reviewing PR #{PR_NUM}: {title} — {N} files changed{strict_suffix}` plus a one-line note: `Author: {AUTHOR_LOGIN}{fork_suffix}` where `{fork_suffix}` is ` (cross-repo fork)` when `IS_FORK=true`.

If the PR has no changed files, inform the user and stop.

## Apply Project Conventions

CLAUDE.md is already loaded into your context. Use its rules (code style, error handling, logging, security model, scope exclusions) as overrides to generic best practices throughout this review. Pass relevant convention overrides to each agent so they don't flag things the project intentionally allows (e.g., "no auth needed — internal tool").

In `PR_MODE`, the local CLAUDE.md may not apply to the PR being reviewed (it could be from a fork or a different repo). Also attempt to fetch the target repo's CLAUDE.md and AGENTS.md if they exist:
```bash
gh api repos/{OWNER}/{REPO}/contents/CLAUDE.md?ref={HEAD_SHA} --jq '.content' 2>/dev/null | base64 -d > /tmp/do-review-pr-{PR_NUM}-CLAUDE.md || true
gh api repos/{OWNER}/{REPO}/contents/AGENTS.md?ref={HEAD_SHA} --jq '.content' 2>/dev/null | base64 -d > /tmp/do-review-pr-{PR_NUM}-AGENTS.md || true
```
Pass whichever exists to the agents instead of (or in addition to) the local one.

## PR-Level Coherence Check

Before dispatching agents, understand what this change set claims to do:

1. Read commit messages (`git log {base}...HEAD --oneline`)
2. Read PLAN.md, .changelog/NEXT.md (or equivalent), and the PR description for capability claims, test counts, and "deep-links to X" / "feature Y now works" assertions
3. Note the claims — verify after agents return whether the code actually delivers them. Concrete drift to flag:
   - Test counts in PLAN/changelog vs `find . -name '*.test.*' -exec grep -c '^\(it\|test\)(' {} +` (or project equivalent)
   - "Deep-links to record X" claims vs whether the destination route handler actually consumes the encoded parameter
   - "Auto-prune after N days" / "scans only the page returned" claims vs the listing implementation
   - Comments in code claiming behavior the surrounding code doesn't perform
   - Field names quoted in docs (request body shape, event payload shape) vs what the code actually reads/emits

## Dispatch Review Agents

Read the agent instruction files, then spawn agents **in parallel** using the Agent tool with `model: "opus"`. Each agent reviews ALL changed files independently.

**The agents are deliberately short and principle-led.** Each agent's checklist is a prompt for attention — opus's job is to think about the problem space, not pattern-match against bullets. The most expensive misses in past reviews were *consequence-reasoning* bugs (a fallback path producing a different shape than the happy path; an encoder corrupting a downstream parser; a test asserting a symptom instead of the contract) — none findable by adding more bullets. Trust the agent to reason; the checklist seeds the lens, not the conclusions.

Always dispatch agents 1–5. Dispatch agent 6 only when `STRICT_MODE=true`.

<surface_scan_agent>

### 1. Surface Scan Agent (Runtime)

Catches per-file RUNTIME bugs: crashes, type/coercion errors, async/state, error handling, streaming, plus domain-specific runtime patterns (SQL, shell, wire protocols, accessibility).

!`cat ~/.claude/lib/review-surface-scan.md`

</surface_scan_agent>

<surface_quality_agent>

### 2. Surface Quality Agent

Catches per-file QUALITY issues: intent-vs-implementation drift, AI-generated code patterns, dead config, missing tests, supply chain hygiene, style.

!`cat ~/.claude/lib/review-surface-quality.md`

</surface_quality_agent>

<security_agent>

### 3. Security Audit Agent

Catches trust boundary violations, injection, SSRF, data exposure, and access control gaps.

!`cat ~/.claude/lib/review-security-audit.md`

</security_agent>

<cross_file_tracing_agent>

### 4. Cross-File Tracing Agent (State/Lifecycle)

Catches STATE/LIFECYCLE issues across files: stale state propagation, lifecycle gaps (mount/unmount, init/cleanup, started/completed), resource leaks, lock/flag exit paths, concurrent-mutation races.

!`cat ~/.claude/lib/review-cross-file-tracing.md`

</cross_file_tracing_agent>

<cross_file_contract_agent>

### 5. Cross-File Contract Agent

Catches CONTRACT issues across files: schema/shape agreements, validation parity, error classification, field-set enumerations, intent-vs-implementation claims spanning files, architectural-pattern adherence.

!`cat ~/.claude/lib/review-cross-file-contract.md`

</cross_file_contract_agent>

<structural_ambition_agent>

### 6. Structural Ambition Agent (strict mode only)

Dispatch only when `STRICT_MODE=true`. Catches STRUCTURAL issues the other agents miss: missed code-judo simplifications, file-size growth past 1000 lines, ad-hoc conditionals bolted onto unrelated flows, thin wrappers, boundary leaks, bespoke duplicates of canonical helpers, cast-heavy/optional-soup contracts. Push the bar to "this works AND the implementation feels inevitable in hindsight."

!`cat ~/.claude/lib/review-structural-ambition.md`

</structural_ambition_agent>

### How to dispatch

For each agent, construct its prompt by combining:
1. The agent's instruction content (from the sections above)
2. Project convention overrides from CLAUDE.md that affect the review (use the PR's CLAUDE.md/AGENTS.md when `PR_MODE=true`)
3. The list of changed files from the diff stat (or `gh pr diff --name-only` in PR mode) AND, in PR mode, the path to each file's full content under `/tmp/do-review-pr-{PR_NUM}/`
4. In PR mode only: the path to `/tmp/do-review-pr-{PR_NUM}-lines.json` (the commentable-lines map) and an instruction that **every finding MUST cite a `file:line` where `line` appears in the commentable-lines map** — otherwise the finding cannot be posted as an inline comment and should be downgraded to a summary-only finding
5. Instruction: "Read each changed file in full (not just diff hunks). Apply your reading lens — the checklist seeds attention but is NOT a script. Reason from principles about each new shape, flow, or contract: what's the smallest input that breaks this? What does the producer believe vs the consumer? What does the fallback path actually deliver? What does the documentation claim vs what the code does? Report findings that demonstrate consequence reasoning, not just pattern matches."
6. In PR mode only: "For every CRITICAL or IMPROVEMENT finding where a concrete fix is obvious, include a `suggestion:` block — the exact replacement text for the cited line(s). Use `start_line` and `line` to span multiple lines when the fix needs more than one line. The reviewer will package these as GitHub inline review suggestions."

Spawn agents 1–5 simultaneously. If `STRICT_MODE=true`, also spawn agent 6 in the same parallel batch. Each returns its findings independently.

### Large PR handling

If the diff touches more than 20 files, tell each agent to batch files by directory and process groups sequentially within their parallel run. The orchestrator does not manage batching.

## Collect & Deduplicate

After all dispatched agents return:

1. **Merge** all findings into a single list, tagged by source agent
2. **Deduplicate**: if two agents flagged the same `file:line` with overlapping descriptions, keep the most detailed version and note all agents that found it (overlap between Surface Scan and Surface Quality, or between Cross-File Tracing and Cross-File Contract, is expected for borderline issues — that's signal a finding is real, not noise). The Structural Ambition agent (strict mode) frequently overlaps with Surface Quality on wrapper/duplication findings — keep the Structural Ambition phrasing when it names a concrete reframing
3. **PR coherence**: verify commits deliver what they claim — flag discrepancies as IMPROVEMENT findings
4. **CLAUDE.md filter**: remove findings that conflict with explicit project conventions
5. **Strict-mode severity promotion** (only when `STRICT_MODE=true`): promote findings marked `[BLOCKER]` by the Structural Ambition agent to CRITICAL severity in the fix phase. Promote findings from other agents that match a strict-mode blocker pattern (file pushed past 1000 lines, ad-hoc conditional in unrelated flow, thin wrapper/identity abstraction, bespoke duplicate of a canonical helper) to CRITICAL as well

## Verify Findings

For each finding, ground it in evidence before classifying:
1. **Quote the specific code line(s)** that demonstrate the issue
2. **Explain why it's a problem** in one sentence given the surrounding context
3. If the fix involves async/state changes, **trace the execution path** to confirm the issue is real
4. If you cannot quote specific code for a finding, downgrade it to **[UNCERTAIN]**

After verifying all findings, run the project's build and test commands to confirm no false positives.

In `PR_MODE`, skip the local build/test step — the PR's CI is the source of truth for that repo. Verify by reading code only.

## Fix Issues (local branch mode only)

**Skip this section entirely when `PR_MODE=true`** — in PR mode, jump to "Post Review to GitHub PR" below. The whole point of PR mode is to publish review comments on the remote PR, not to mutate the local working tree (the PR may be on a fork or a branch we can't push to).

For each verified finding (local branch mode):
1. Classify severity: **CRITICAL** (runtime crash, data leak, security) vs **IMPROVEMENT** (consistency, robustness, conventions)
2. Fix all CRITICAL issues immediately
3. For IMPROVEMENT issues, fix them too — the goal is to eliminate review round-trips
4. **Identify the root cause** of why the issue existed (missing lint rule, missing comment at the canonical site, misleading name, API that invites the mistake, etc.) per `~/.claude/lib/per-finding-root-cause.md` and apply the smallest matching action **in the same change**. Defer big refactors and cross-cutting patterns to the end-of-loop Convention Encoding phase.
5. After fixes, run the project's test suite and build command (per project conventions already in context)
6. Verify the test suite covers the changed code paths — passing unrelated tests is not validation
7. Commit fixes: `refactor: address code review findings`

## Post Review to GitHub PR (`PR_MODE=true` only)

Skip this section when `PR_MODE=false`. When `PR_MODE=true`, this is the **primary output** of the command — package the verified findings as a single GitHub PR review with inline comments containing code suggestions, just like Copilot.

### Classify findings for posting

For each verified finding:
1. **Severity**: CRITICAL (runtime crash, data leak, security, contract break) vs IMPROVEMENT (consistency, robustness, conventions).
2. **Postability**: Check the cited `file:line` against the commentable-lines map (`/tmp/do-review-pr-{PR_NUM}-lines.json`):
   - **In-diff** → eligible for an inline comment
   - **Out-of-diff** → cannot be inline; include in the review summary body instead
3. **Has suggestion**: True if the finding contains a concrete replacement for the cited line(s).

### Build the inline comments array

For each in-diff finding, build a comment object:

```json
{
  "path": "<repo-relative path>",
  "line": <end line on the RIGHT side of the diff>,
  "side": "RIGHT",
  "body": "<severity tag> <one-line gist>\n\n<2-4 sentence explanation tied to specific code>\n\n```suggestion\n<exact replacement text for the line range>\n```"
}
```

Rules:
- For multi-line suggestions, add `"start_line": <first line>` and `"start_side": "RIGHT"`. `line` is the LAST line of the range, `start_line` is the FIRST. Both must be in the commentable-lines map.
- The `suggestion` block's content replaces the cited lines verbatim. **Do not** include the original code prefixed with `-` or new code prefixed with `+` — `suggestion` blocks are not diff format; they're literal replacement text.
- Severity tag: prefix the body with `**[CRITICAL]**`, `**[IMPROVEMENT]**`, or `**[NIT]**` so the PR author can triage at a glance.
- Findings without a concrete suggestion still get inline comments — just omit the ```` ```suggestion ```` block and describe the problem.
- Skip `UNCERTAIN` findings — don't post speculation.

### Build the review summary body

Assemble a top-level review body (markdown) with:
- One-line verdict (e.g., `Reviewed by /do:review — N critical, M improvements, K nits.`)
- A short "Highlights" section listing the most important 1-3 CRITICAL findings by `file:line`
- An "Out-of-diff observations" section for findings on lines that aren't part of the patch (so the author still sees them)
- A "Coherence check" section if the PR description/commits claim something the code doesn't deliver (from the "PR-Level Coherence Check" step)
- A footer: `_Generated by /do:review_`

### Pick the review event

- **`REQUEST_CHANGES`** if any finding is CRITICAL **and** the current user is not the PR author. If the current user IS the PR author (check via `gh api user -q '.login'` vs `AUTHOR_LOGIN`), downgrade to `COMMENT` — GitHub forbids requesting changes on your own PR.
- **`COMMENT`** otherwise (improvements/nits only, or self-PR).
- **Never `APPROVE` automatically** — approval is a human judgment call.

### Submit the review

Write the payload to `/tmp/do-review-pr-{PR_NUM}-payload.json`:

```json
{
  "commit_id": "<HEAD_SHA>",
  "event": "COMMENT | REQUEST_CHANGES",
  "body": "<review summary markdown>",
  "comments": [ ...inline comment objects... ]
}
```

Post it:
```bash
gh api repos/{OWNER}/{REPO}/pulls/{PR_NUM}/reviews \
  --method POST \
  --input /tmp/do-review-pr-{PR_NUM}-payload.json
```

On `422 Unprocessable Entity`, the most common causes are:
1. A comment's `line` is not in the diff — re-validate against the lines map and drop offending comments.
2. `commit_id` is stale (the PR head moved while you were reviewing) — re-fetch `headRefOid` and retry.
3. `start_line >= line` for a multi-line comment — fix the ordering.

Print the review URL returned by the API (`html_url`) so the user can open it.

### Drafts mode (optional)

If the user wants to inspect comments before publishing, support a `--draft` flag: instead of `POST .../reviews`, write the payload to `/tmp/do-review-pr-{PR_NUM}-payload.json` and print the path plus the `gh api` command needed to publish it manually. (Default behavior remains: publish immediately.)

## Report

Print a summary table of what was reviewed and found:

```
## Review Summary

| Agent | Files Checked | Issues Found | Fixed |
|-------|--------------|-------------|-------|
| Surface Scan (Runtime) | N | N | N |
| Surface Quality | N | N | N |
| Security Audit | N | N | N |
| Cross-File Tracing (State) | N | N | N |
| Cross-File Contract | N | N | N |
| Structural Ambition (strict) | N | N | N |
| **Total** | **N** | **N** | **N** |

Omit the Structural Ambition row when `STRICT_MODE=false`.

### Issues Fixed
- file:line — description of fix (agent: Surface-Scan / Surface-Quality / Security / Cross-File-Tracing / Cross-File-Contract / Structural-Ambition)

### Accepted As-Is (with rationale)
- file:line — description and why it's acceptable
```

If no issues were found, confirm the code is clean and ready for PR.

In `PR_MODE`, replace "Issues Fixed" with **Inline Suggestions Posted** (count and list with `file:line` + one-line gist) and **Out-of-diff Findings** (list — these went into the summary body), and add a final line with the posted review URL.

## Convention Encoding

**Skip when `PR_MODE=true`** — convention encoding mutates the local working tree, which is the wrong target when we're reviewing someone else's remote PR. Any convention recommendations belong in the summary body of the posted review instead, phrased as suggestions to the PR author.

After the report is printed and fixes are committed (local branch mode), run the Convention Encoding phase. Examine the findings (both fixed and accepted-as-is) and, for each pattern likely to recur, apply the **smallest** code-level action that makes the convention self-evident (in-tree comment at the canonical site, a clarifying rename, or a surgical refactor that removes the footgun). CLAUDE.md / AGENTS.md additions are a **fallback**, used only when the convention truly can't be expressed locally. Any encoded actions land in the same branch as the review fixes.

!`cat ~/.claude/lib/per-finding-root-cause.md`

!`cat ~/.claude/lib/post-review-doc-recommendations.md`

## PR Comment Policy

**This section applies only when `PR_MODE=false`.** When `PR_MODE=true`, posting the review IS the deliverable — the user invoked the command with a PR URL specifically to publish review feedback, so the self-vs-other-author check is skipped and the review is always posted (per "Post Review to GitHub PR" above).

For local branch mode, after the review and any fixes, determine whether to post review comments on the PR/MR:

1. **Check for an open PR** on the current branch: `gh pr view --json number,author --jq '{number, author: .author.login}' 2>/dev/null`. If the command fails (no PR exists), skip posting.
2. **Get the current user**: `gh api user -q '.login'`
3. **Compare**: If the PR author login **matches** the current user, do NOT post comments to the PR — the local fixes and summary are sufficient.
4. **If the PR was opened by someone else**, post a review comment on the PR summarizing the findings using `gh pr review {number} --comment --body "..."`. Include the issues found, fixes applied, and any remaining items that need the author's attention.

This avoids noisy self-comments on your own PRs while still providing feedback to other contributors.

## Delegated Review Passes (`--review-with`)

**Skip this section when `REVIEW_AGENTS` is empty.**

After the host CLI's self-review has fully completed — fixes applied (local mode) or review posted (PR mode), Convention Encoding done, PR Comment Policy executed — hand off to the **multi-reviewer loop** to run additional perspective passes through the listed external CLIs.

Inputs to the wrapper:

- `{REVIEW_AGENTS}` — the parsed list (e.g. `[claude, gemini, copilot]`)
- `{REVIEW_STOP_MODE}` — `all` (default) | `on-findings` | `on-clean`
- `{REVIEWER_APPLIES}` — boolean, forwarded to each local-agent pass

Per-agent dispatch inside the wrapper:

- `copilot` — only meaningful when a PR exists for the current branch (local mode) or when `PR_MODE=true`. Requests a Copilot review on the PR via the Copilot review loop. If no PR is associated with the current branch in local mode, print `Skipping copilot pass: no open PR on {branch}.` and continue to the next agent.
- `codex` | `gemini` | `claude` — invoke the local-agent review loop. The CLI runs `/do:review` headless against the same scope this invocation reviewed:
  - In **local branch mode**, the headless CLI reviews `{base}...HEAD` on the current working tree (it will see the host's just-committed fixes as part of HEAD). Set the wrapper's `BASE_BRANCH=$BASE_BRANCH` so the inner loop's `/do:review $BASE_BRANCH` invocation diffs against the same base this self-review used.
  - In **PR mode**, the inner loop's slash-command argument needs to be the PR URL, not a base-branch ref. Since `do:review` accepts either form as its first non-flag argument, set the wrapper's `BASE_BRANCH=$PR_URL` before dispatching (a deliberate override of the variable's name — it holds the slash-command argument, whatever its semantic). **In PR mode also override the inner loop's `REVIEWER_APPLIES_SUFFIX` block** so the delegated CLI does NOT suppress its PR Comment Policy phase: in review-only mode the local-agent loop's default suffix tells the inner CLI to skip the PR-comment phase and emit findings to stdout for the orchestrator to parse — but in PR mode the orchestrator has no working tree to apply against (the PR may not even be checked out locally), so the delegated CLI must publish its own review comment instead. Pass a PR-mode-specific suffix that keeps `/do:review`'s PR Comment Policy phase enabled (publish a PR review via `gh pr review` from the inner session). If `--draft` was passed to the outer invocation, also forward it into the inner `/do:review` invocation so each delegated CLI drafts rather than publishes; otherwise multiple reviews will be posted in succession, which is usually the intent.
  - Note on `codex` in PR mode: the local-agent loop's review-only path uses `codex review --base "$BASE_BRANCH"`, which expects a git ref and does not accept a PR URL. **In PR mode the codex pass is skipped** with the printed message `Skipping codex pass in PR mode: codex review --base only accepts a git ref. Use --review-with codex against a local branch instead, or use --reviewer-applies codex,... if the codex CLI's apply-mode (which uses codex exec and can accept a free-form PR-URL prompt) is acceptable.` The skip is recorded in the per-pass table as status `skipped`, treated like a non-fix inconclusive for `{OVERALL_STATUS}` purposes. The `gemini` and `claude` paths invoke slashdo's `/do:review` slash command and accept either form.

### Multi-reviewer wrapper

!`cat ~/.claude/lib/multi-reviewer-loop.md`

### Inner loop bodies (referenced by the wrapper)

!`cat ~/.claude/lib/copilot-review-loop.md`

!`cat ~/.claude/lib/local-agent-review-loop.md`

### Final report (when delegated passes ran)

After the wrapper exits, append the wrapper's aggregate report to the self-review summary. Make clear in the heading that the self-review was pass 0 (host CLI) and the wrapper's table covers the delegated passes 1..N. The final overall status the user cares about is whichever is worse between (a) the self-review's "issues remaining" count and (b) the wrapper's `{OVERALL_STATUS}`.
