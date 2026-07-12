---
description: Deep code review of changed files against software engineering best practices
argument-hint: "[--strict|--nuclear] [--draft] [--review-with <agent>[,<agent>...]] [--review-iterations <n>] [--review-mode <series|parallel>] [--review-stop-on-findings|--review-stop-on-clean] [--reviewer-applies] [--issues|--no-issues] [--issues-label <name>] [PR-URL | base-branch]"
---

## Parse Arguments

Parse `$ARGUMENTS` for:
- **`--strict`** (alias: **`--nuclear`**): enable the Structural Ambition agent (6th agent) and promote structural findings to blocker tier. Use for branches you want to land cleanly — flags file-size growth past 1000 lines, ad-hoc conditionals bolted onto unrelated flows, thin wrappers, boundary leaks, and missed code-judo simplifications.
- **`--draft`** (PR mode only): write the review payload to `/tmp/do-review-pr-{PR_NUM}-payload.json` and print the `gh api` command to publish it manually, instead of posting the review immediately. Ignored when `PR_MODE=false`.
- **`--review-with <agent[,agent,...]>`** (optional): after the host CLI's self-review completes (the multi-agent flow defined below), delegate **additional** review passes to the named external CLIs in order. Accepted slugs per slot: `copilot`, `codex`, `agy` (aliases `gemini` / `antigravity` — all run the Antigravity CLI's `agy` binary), `claude`, `grok`, `ollama` (bare `ollama` auto-selects the most capable installed coding model; `ollama[<model>]` pins a specific installed model, e.g. `ollama[qwen2.5-coder:32b]` — strip the bracket into a per-entry `OLLAMA_MODEL`; `codex`/`claude`/`agy`/`grok` likewise accept a `<agent>[<model>]` bracket — e.g. `codex[o3]`, `claude[claude-opus-4-8]`, `grok[grok-code-fast-1]` — stripped into a per-entry `REVIEW_MODEL`, empty → the reviewer's built-in default; `copilot` and `@<login>` take no model bracket), or an arbitrary GitHub login `@<login>` — any GitHub user or App/bot (e.g. `@octocat`, `@org-review-bot`, `@some-app[bot]`); slashdo requests its review on the PR and waits for it (GitHub only, never posts an approval itself). Split on `,`, trim whitespace, normalize `gemini`/`antigravity` → `agy`, dedupe preserving first-occurrence order (for a model-taking agent — `codex`/`claude`/`agy`/`grok`/`ollama` — the `[<model>]` bracket suffix is part of the dedup identity). Any slot may end in `~opt` (e.g. `ollama~opt`) to mark that reviewer **optional/non-blocking** — still requested and its findings still fixed, but an inconclusive result from it never contributes a merge-blocking `inconclusive` aggregate (a hard-error from it still does); strip `~opt` into a per-entry `{OPTIONAL}` flag before slug parsing, not part of the dedup identity (`ollama~opt` == `ollama`, optional-wins on collapse). See `lib/multi-reviewer-loop.md`. Abort with `Unknown --review-with value: {value}. Use one of: copilot, codex, agy, claude, grok, ollama, @<login> (each optionally suffixed ~opt).` on any unknown slug. The reserved token `none` (case-insensitive) is **not** validated as a slug — `--review-with none` means no delegated reviewers (set `REVIEW_AGENTS=[]`) and overrides any saved `review-with` default. If omitted, leave `REVIEW_AGENTS` **unset for now** — the saved-defaults step below fills it from `/do:config` if a default exists, and **only if it is still unset after that** is `REVIEW_AGENTS=[]` (no delegated passes — behavior matches the historical `/do:review` self-review only). **The host CLI is not implied in this list** — whichever CLI is hosting the review command (claude, codex, or agy) runs the self-review first regardless. The list names *additional* reviewers; an explicit `claude` entry while running under claude means "start a fresh claude headless session for a second-pass perspective," which is allowed.
- **`--review-stop-on-findings` / `--review-stop-on-clean`** (mutually exclusive, optional): stop-mode for the delegated passes. Default `REVIEW_STOP_MODE=all` (run every listed agent). `on-findings` stops after the first delegated reviewer that surfaces a non-empty change set; `on-clean` stops after the first delegated reviewer that reports zero findings. Abort with `--review-stop-on-findings and --review-stop-on-clean cannot be combined` if both appear.
- **`--review-mode <series|parallel>`** (optional): how the delegated passes are dispatched. `series` (default) runs the listed reviewers one-at-a-time so each sees the prior reviewer's committed fixes; `parallel` runs their reviews concurrently against one frozen baseline and then applies the deduped union of findings once (faster, but no reviewer sees another's fixes — `--reviewer-applies` and the stop-modes are ignored in this mode). Record as `REVIEW_MODE`; if omitted, leave it **unset for now** (the saved-defaults step fills it from the `review-mode` default; built-in default `series`). Abort with `--review-mode must be one of series, parallel (got: {value}).` on any other value.
- **`--reviewer-applies`** (optional, boolean): forwarded to each delegated local-agent pass to route fixes through the reviewing CLI instead of the orchestrator. See `lib/local-agent-review-loop.md` "Editing mode" for the trade-offs. No effect on the copilot path, the `@<login>` path, the ollama path (Ollama is non-agentic — always review-only), or the host's self-review.
- **`--review-iterations <n>`** (optional): caps how many review-and-fix cycles a delegated **copilot** or **`@<login>`** pass runs. Record as `REVIEW_ITERATIONS`; default `1` (one review-and-fix pass, exiting early on 0 comments). Must be a non-negative integer — abort with `--review-iterations must be a non-negative integer (got: {value}).` otherwise. `0` means "loop until that reviewer returns 0 comments" (legacy behavior, bounded by each loop's own 10-iteration safety guardrail). No effect on local-agent passes or ollama (their own fixed iteration caps) or on the host's self-review.

After parsing the flags above, apply any **saved defaults** (set via `/do:config`) to the flags the user did NOT pass (the delegated-review flags **and** `--issues` / `--issues-label`) — an explicit flag, or `--review-with none`, always overrides a saved default:

!`cat ~/.claude/lib/review-config-defaults.md`

- **`--issues`** / **`--no-issues`** / **`--issues-label <name>`** (optional): when a finding is **deferred** (local-branch mode only — see Finding Disposition), file it as a GitHub/GitLab issue instead of a PLAN.md line. `--issues` sets `ISSUE_MODE=true`; `--no-issues` forces `ISSUE_MODE=false`. If the user passes **neither**, take `ISSUE_MODE` from the saved `issues` default resolved above (built-in default `false`). Set `PLAN_LABEL` from `--issues-label`, else the saved `issues-label` default, else `plan`. No effect in PR mode (PR mode posts comments, it doesn't defer to a plan).
- **GitHub PR reference** — any non-flag token that looks like a PR reference. A token matches if **any** of the following holds (the rules are OR-ed; the `github` substring is sufficient but not required):
  - Full URL: `https://github.com/{owner}/{repo}/pull/{number}` (and any subpath like `/files`, `/commits`)
  - SSH-style URL with `github.com` host
  - Any URL containing the substring `github` AND a `/pull/{number}` segment — covers GHES hosts like `github.example.com`
  - Shorthand: the argument matches `^[^/]+/[^/]+#[0-9]+$` AND `gh repo view {owner}/{repo}` confirms it resolves (the shorthand form does NOT require the `github` substring — `gh` is the source of truth for whether it's a real repo)
  - Extract `OWNER`, `REPO`, and `PR_NUM`. Set `PR_MODE=true` and `PR_URL` to the canonical URL. Also capture the URL's **host** as `{GH_HOST}` (e.g. `github.com`, or a GHES host like `github.example.com`) — the `gh api` calls below need it explicitly, because `gh api` ignores the repo remote and defaults to github.com (see `~/.claude/lib/gh-host.md`). Note the host comes from the **PR URL** here, not the local `origin` remote — a PR being reviewed by URL can live on a different host than the current checkout.
- Any other non-flag token: treat as the base branch override (only when `PR_MODE=false`).

Set `STRICT_MODE=true` if either strict flag is present.

If both a PR URL and a base-branch token are provided, the PR URL wins — ignore the base-branch token and warn the user.

## Determine Scope

### Local branch mode (`PR_MODE=false`)

1. **Detect the base branch** — use the positional argument if provided, otherwise run `gh repo view --json defaultBranchRef -q '.defaultBranchRef.name'`. Also **derive `{GH_HOST}` from the `origin` remote** (local mode reviews the current checkout, so its host is the remote's): `GH_HOST="$(git remote get-url origin 2>/dev/null | sed -E 's#^[a-z]+://##; s#^[^@/]+@##; s#[:/].*$##')"; [ -n "$GH_HOST" ] || GH_HOST=github.com` — the `gh api` calls below need it explicitly (see `~/.claude/lib/gh-host.md`).
2. **Detect the current branch** — `git branch --show-current`
3. **Get the diff stat** — `git diff {base}...HEAD --stat` to see all changed files and line counts
4. **Get the full diff** — `git diff {base}...HEAD` to see actual changes
5. Print: `Reviewing: {current} vs {base} — {N} files changed{strict_suffix}` where `{strict_suffix}` is ` (strict mode)` when `STRICT_MODE=true`, empty otherwise

If there are no changes, inform the user and stop.

### GitHub PR mode (`PR_MODE=true`)

When a PR URL was parsed, do NOT use the local working tree as the source of truth. Review the PR as published on GitHub instead.

1. **Fetch PR metadata**:
   ```bash
   gh pr view {PR_NUM} --repo {GH_HOST}/{OWNER}/{REPO} --json number,title,author,baseRefName,headRefName,headRefOid,baseRefOid,url,isCrossRepository,headRepositoryOwner,headRepository
   ```
   Capture `HEAD_SHA` (`headRefOid`), `BASE_SHA` (`baseRefOid`), `HEAD_REF`, `BASE_REF`, `AUTHOR_LOGIN`, and `IS_FORK` (`isCrossRepository`).
2. **Fetch the changed-files list**:
   ```bash
   gh pr diff {PR_NUM} --repo {GH_HOST}/{OWNER}/{REPO} --name-only
   ```
3. **Fetch the full unified diff** (used by agents to scope to changed hunks AND used later to filter inline comments to lines that exist in the diff):
   ```bash
   gh pr diff {PR_NUM} --repo {GH_HOST}/{OWNER}/{REPO} > /tmp/do-review-pr-{PR_NUM}.diff
   ```
4. **Parse the diff to build a "commentable lines" map** — `{file_path: set of line numbers on the RIGHT (new) side of the diff}`. GitHub's review API only accepts inline comments on lines that appear in the patch; comments on lines outside the diff will be rejected. Walk the unified diff line by line:
   - Track the current file from `diff --git a/<path> b/<path>` headers (authoritative for both adds and renames). Prefer this over `+++ b/<path>` because deletions emit `+++ /dev/null` and renames may not round-trip the new path through `+++` alone.
   - If the file is deleted (the `+++` header is `/dev/null`), skip it entirely — there are no right-side lines to comment on.
   - Parse each `@@ -a,b +c,d @@` hunk header to seed the right-side line counter at `c`, then iterate hunk body lines: increment the counter on `+` (added) and ` ` (context) lines and include both in the map; skip `-` (removed) lines without incrementing.
   - **Ignore the `\ No newline at end of file` marker line** — it's metadata, not a content line, and must NOT advance the right-side counter.
   - (Do NOT use `git apply --numstat` — it reports per-file add/delete totals, not hunk line ranges.) Save to `/tmp/do-review-pr-{PR_NUM}-lines.json`.
5. **Fetch each changed file at HEAD_SHA** so agents can read full file content (not just the hunk). Skip deleted files — `repos/{OWNER}/{REPO}/contents/{path}?ref={HEAD_SHA}` returns 404 for any path removed in the PR, and a strict failure would derail PR-mode for delete-only or mixed-deletion PRs:
   ```bash
   gh api --hostname {GH_HOST} repos/{OWNER}/{REPO}/contents/{path}?ref={HEAD_SHA} --jq '.content' 2>/dev/null | base64 -d > /tmp/do-review-pr-{PR_NUM}/{path} || echo "skipped (deleted or unreadable): {path}"
   ```
   (Create parent dirs as needed; URL-encode the path. Use the `diff --git` header from step 4 to identify deletions up front and skip the fetch entirely for those.)
6. Print: `Reviewing PR #{PR_NUM}: {title} — {N} files changed{strict_suffix}` plus a one-line note: `Author: {AUTHOR_LOGIN}{fork_suffix}` where `{fork_suffix}` is ` (cross-repo fork)` when `IS_FORK=true`.

If the PR has no changed files, inform the user and stop.

## Apply Project Conventions

CLAUDE.md is already loaded into your context. Use its rules (code style, error handling, logging, security model, scope exclusions) as overrides to generic best practices throughout this review. Pass relevant convention overrides to each agent so they don't flag things the project intentionally allows (e.g., "no auth needed — internal tool").

In `PR_MODE`, the local CLAUDE.md may not apply to the PR being reviewed (it could be from a fork or a different repo). Also attempt to fetch the target repo's CLAUDE.md and AGENTS.md if they exist:
```bash
gh api --hostname {GH_HOST} repos/{OWNER}/{REPO}/contents/CLAUDE.md?ref={HEAD_SHA} --jq '.content' 2>/dev/null | base64 -d > /tmp/do-review-pr-{PR_NUM}-CLAUDE.md || true
gh api --hostname {GH_HOST} repos/{OWNER}/{REPO}/contents/AGENTS.md?ref={HEAD_SHA} --jq '.content' 2>/dev/null | base64 -d > /tmp/do-review-pr-{PR_NUM}-AGENTS.md || true
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

!`cat ~/.claude/lib/finding-disposition.md`

!`cat ~/.claude/lib/plan-issue-mode.md`

For each verified finding (local branch mode):
1. Classify severity: **CRITICAL** (runtime crash, data leak, security) vs **IMPROVEMENT** (consistency, robustness, conventions)
2. Fix all CRITICAL issues immediately
3. For IMPROVEMENT issues, fix them too — the goal is to eliminate review round-trips. Per the Finding Disposition guidance above, defer a finding to PLAN.md only when the fix is genuinely large/architectural or too risky to land in this branch — never as a way to avoid a contained fix you could make now
4. **Identify the root cause** of why the issue existed (missing lint rule, missing comment at the canonical site, misleading name, API that invites the mistake, etc.) per `~/.claude/lib/per-finding-root-cause.md` and apply the smallest matching action **in the same change**. Defer big refactors and cross-cutting patterns to the end-of-loop Convention Encoding phase.
5. After fixes, run the project's test suite and build command (per project conventions already in context)
6. Verify the test suite covers the changed code paths — passing unrelated tests is not validation
7. Commit fixes: `address review (self): <summary>` — the parenthesized agent name (here `self` for the host CLI's own self-review) records which reviewer surfaced the finding, matching the convention used by delegated `--review-with` passes.

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

- **`REQUEST_CHANGES`** if any finding is CRITICAL **and** the current user is not the PR author. If the current user IS the PR author (check via `gh api --hostname {GH_HOST} user -q '.login'` vs `AUTHOR_LOGIN`), downgrade to `COMMENT` — GitHub forbids requesting changes on your own PR.
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
gh api --hostname {GH_HOST} repos/{OWNER}/{REPO}/pulls/{PR_NUM}/reviews \
  --method POST \
  --input /tmp/do-review-pr-{PR_NUM}-payload.json
```

On `422 Unprocessable Entity`, the most common causes are:
1. A comment's `line` is not in the diff — re-validate against the lines map and drop offending comments.
2. `commit_id` is stale (the PR head moved while you were reviewing) — re-fetch `headRefOid` and retry.
3. `start_line >= line` for a multi-line comment — fix the ordering.

Print the review URL returned by the API (`html_url`) so the user can open it.

### Drafts mode (optional)

If the user wants to inspect comments before publishing, support a `--draft` flag: instead of `POST .../reviews`, write the payload to `/tmp/do-review-pr-{PR_NUM}-payload.json` and print the path plus the `gh api` command needed to publish it manually — include the `--hostname {GH_HOST}` flag in that printed command so it targets the right host on GitHub Enterprise. (Default behavior remains: publish immediately.)

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
2. **Get the current user**: `gh api --hostname {GH_HOST} user -q '.login'`
3. **Compare**: If the PR author login **matches** the current user, do NOT post comments to the PR — the local fixes and summary are sufficient.
4. **If the PR was opened by someone else**, post a review comment on the PR summarizing the findings using `gh pr review {number} --comment --body "..."`. Include the issues found, fixes applied, and any remaining items that need the author's attention.

This avoids noisy self-comments on your own PRs while still providing feedback to other contributors.

## Delegated Review Passes (`--review-with`)

**Skip this section when `REVIEW_AGENTS` is empty.**

After the host CLI's self-review has fully completed for the active mode — in **local mode**, that means fixes applied and Convention Encoding done; in **PR mode** (`PR_MODE=true`), that means the review comment was posted via PR Comment Policy and Convention Encoding was deliberately skipped per the earlier section — hand off to the **multi-reviewer loop** to run additional perspective passes through the listed external CLIs. The handoff preconditions branch on PR vs local mode to match the earlier "Convention Encoding skipped in PR mode" and "PR Comment Policy only runs when `PR_MODE=true`" rules; do NOT block delegation on a phase that's intentionally inert for the current mode.

Inputs to the wrapper:

- `{REVIEW_AGENTS}` — the parsed list (e.g. `[claude, agy, copilot]`)
- `{REVIEW_STOP_MODE}` — `all` (default) | `on-findings` | `on-clean`
- `{REVIEW_MODE}` — `series` (default) | `parallel`
- `{REVIEWER_APPLIES}` — boolean, forwarded to each local-agent pass
- `{REVIEW_ITERATIONS}` — non-negative integer (default `1`); copilot/`@<login>` iteration cap (`0` = loop until clean)
- `{GH_HOST}` — the GitHub API host established in "Determine Scope" (the PR URL's host in PR mode, the `origin` remote's host in local mode); forwarded to the GitHub-side loops so their `gh api` calls target the right host on GitHub Enterprise

Per-agent dispatch inside the wrapper:

- `copilot` — only meaningful when a PR exists for the current branch (local mode) or when `PR_MODE=true`. Requests a Copilot review on the PR via the Copilot review loop. If no PR is associated with the current branch in local mode, print `Skipping copilot pass: no open PR on {branch}.` and continue to the next agent.
- `@<login>` — like `copilot`, GitHub-side and PR-bound: requests a review from the arbitrary login `{REVIEWER_LOGIN}` via the GitHub-reviewer loop (`lib/github-reviewer-loop.md`). Only meaningful when a PR exists for the current branch (local mode) or `PR_MODE=true`; if no PR is associated with the current branch in local mode, print `Skipping @{REVIEWER_LOGIN} pass: no open PR on {branch}.` and continue to the next agent.
- `codex` | `agy` | `claude` — invoke the local-agent review loop. The CLI runs a self-contained single-agent review prompt headless (codex uses its built-in `codex review`) — not the `/do:review` multi-sub-agent skill, which hangs under a print-mode/headless invocation — against the same scope this invocation reviewed:
  - In **local branch mode**, the headless CLI reviews `{base}...HEAD` on the current working tree (it will see the host's just-committed fixes as part of HEAD). Set the wrapper's `BASE_BRANCH=$BASE_BRANCH` so the inner loop's `git diff $BASE_BRANCH...HEAD` reviews against the same base this self-review used.
  - In **PR mode**, the local-agent loop reviews a local `git diff $BASE_BRANCH...HEAD`, so it needs the PR branch checked out locally with `$BASE_BRANCH` set to a resolvable ref — a PR URL won't work as the diff target. Either check out the PR branch first and dispatch with a local base ref, or skip the delegated local-agent passes in PR mode (the `copilot` path is the host-agnostic PR-by-URL reviewer). The delegated local-agent loop publishes nothing to the PR itself; in review-only mode it emits findings to stdout and the orchestrator owns posting any PR comment.
  - Note on `codex`/`agy`/`claude`/`grok`/`ollama` in PR mode: all review a local `git diff` (codex via `codex review --base "$BASE_BRANCH"`, the others via `git diff $BASE_BRANCH...HEAD` inside the self-contained prompt), which needs a local git ref and a checked-out branch — a PR URL won't resolve. **In PR mode these passes are therefore skipped** unless the PR branch is checked out locally with a resolvable base, with a printed message like `Skipping {agent} pass in PR mode: the local-agent loop reviews a local git diff and cannot resolve a PR URL. Use --review-with {agent} against a local branch instead.` Each skip is recorded in the per-pass table as status `skipped`, treated like a non-fix inconclusive for `{OVERALL_STATUS}` purposes.

### Multi-reviewer wrapper

!`cat ~/.claude/lib/multi-reviewer-loop.md`

### Inner loop bodies (referenced by the wrapper)

!`cat ~/.claude/lib/copilot-review-loop.md`

!`cat ~/.claude/lib/github-reviewer-loop.md`

!`cat ~/.claude/lib/local-agent-review-loop.md`

!`cat ~/.claude/lib/ollama-review-loop.md`

### Final report (when delegated passes ran)

After the wrapper exits, append the wrapper's aggregate report to the self-review summary. Make clear in the heading that the self-review was pass 0 (host CLI) and the wrapper's table covers the delegated passes 1..N. The final overall status the user cares about is whichever is worse between (a) the self-review's "issues remaining" count and (b) the wrapper's `{OVERALL_STATUS}`.
