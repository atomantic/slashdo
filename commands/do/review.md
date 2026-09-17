---
description: Deep code review of changed files against software engineering best practices
argument-hint: "[--strict|--nuclear] [--draft] [--apply|--no-apply] [--merge|--merge=<method>] [--review-with <agent>[,<agent>...]] [--review-iterations <n>] [--review-mode <series|parallel>] [--review-stop-on-findings|--review-stop-on-clean] [--reviewer-applies] [--issues|--no-issues] [--issues-label <name>] [PR-URL | base-branch]"
---

## Parse Arguments

Parse `$ARGUMENTS` for:
- **`--strict`** (alias: **`--nuclear`**): raise the structural-review bar — permit the Structural Ambition lens when the diff contains structural signals, and promote structural findings to blocker tier. Strict mode does not force a focused agent when the orchestrator finds no structural concern.
- **`--draft`** (PR mode only): write the review payload to `/tmp/do-review-pr-{PR_NUM}-payload.json` and print the `gh api` command to publish it manually, instead of posting the review. Ignored when `PR_MODE=false`. Implies `--no-apply` — a draft publishes nothing, so it must not push commits either.
- **`--apply` / `--no-apply`** (mutually exclusive, PR mode only): how verified findings are delivered. Default `PR_APPLY=auto` — **commit the fixes onto the PR's head branch when we can push to it, post inline review comments when we can't** (see "Determine write access"). `--no-apply` forces review-only; `--apply` forces fix-and-push and aborts with `--apply was requested but the PR head branch is not writable ({reason}) — rerun without --apply to post an inline review instead.` when `CAN_PUSH_HEAD=false`. Abort with `--apply and --no-apply cannot be combined` if both appear.
- **`--merge` / `--merge=<method>`** (optional, PR mode only): after the review finishes **clean**, merge the PR. Off by default — without this flag `/do:review` never merges anything. `<method>` ∈ {`squash`, `rebase`, `merge`}; abort on anything else with `--merge=<method> must be one of squash, rebase, merge (got: {value}).` Record `MERGE_ENABLED=true` and, when given, `MERGE_METHOD`. Every gate in "Merge the PR" must pass — the flag requests a merge, it does not authorize one.
- **`--review-with <agent[,agent,...]>`** (optional): after the host CLI's self-review, run **additional** review passes through the named external CLIs in order. Slugs: `codex`, `agy` (aliases `gemini` / `antigravity` — the Antigravity CLI's `agy` binary), `claude`, `grok`, `pi`, `cursor` (alias `cursor-agent` — the Cursor Agent CLI), `opencode` (aliases `zen` / `opencode-zen` — the OpenCode CLI), `ollama` (bare `ollama` auto-selects the most capable installed coding model; `ollama[<model>]` pins one, e.g. `ollama[qwen2.5-coder:32b]` — strip the bracket into a per-entry `OLLAMA_MODEL`), `copilot` (**legacy** — GitHub's cloud Copilot review; supported when named, never selected implicitly), `cmd[<invocation>]` — an escape hatch for any harness not in this list (operator-authored shell command, read prompt on stdin, print the same verdict contract; always review-only; see `lib/local-agent-review-loop.md` "The `cmd` reviewer"), or a GitHub login `@<login>` — any user or App/bot (e.g. `@octocat`, `@some-app[bot]`); slashdo requests its review on the PR and waits for it (GitHub only, never posts an approval itself). `codex`/`claude`/`agy`/`grok`/`pi`/`cursor`/`opencode` also accept `<agent>[<model>]` (e.g. `codex[o3]`, `opencode[muse-1.3]`), stripped into a per-entry `REVIEW_MODEL` (empty → the reviewer's built-in default); `copilot` and `@<login>` take no model bracket. Split on `,`, trim whitespace, normalize `gemini`/`antigravity` → `agy`, `cursor-agent` → `cursor`, `zen`/`opencode-zen` → `opencode`, dedupe preserving first-occurrence order (for a model-taking agent — `codex`/`claude`/`agy`/`grok`/`pi`/`cursor`/`opencode`/`ollama` — the `[<model>]` bracket is part of the dedup identity; for `cmd`, the verbatim `[<invocation>]` is). Suffixes — stripped off the right of each token in any order before slug parsing, and excluded from the dedup identity: `~opt` (e.g. `ollama~opt`) marks that reviewer **optional/non-blocking** — still requested and its findings still fixed, but an inconclusive result from it never contributes a merge-blocking `inconclusive` aggregate (a hard-error still does); record as a per-entry `{OPTIONAL}` flag (`ollama~opt` == `ollama`, optional-wins on collapse). `~max=<n>` (e.g. `claude~max=2`) caps how many review → fix → re-review cycles **that one reviewer** runs. `~effort=<level>` (e.g. `codex[gpt-5.6-luna]~effort=max~opt`) sets its reasoning effort level (`low`, `medium`, `high`, `xhigh`, `max`). On a dedup collapse the survivor takes `~opt` if any had it, and cap/effort from the first that carried them. Reject a malformed suffix with `Invalid --review-with suffix on {entry}: ~max must be a non-negative integer and ~effort must be one of low, medium, high, xhigh, max, each appearing at most once; the only suffixes are ~opt, ~max=<n>, and ~effort=<level>.` Abort with `Unknown --review-with value: {value}. Use one of: codex, agy, claude, grok, pi, cursor, opencode, ollama, copilot, cmd[<invocation>], @<login> (each optionally suffixed ~opt, ~max=<n>, and/or ~effort=<level>).` on any unknown slug. The reserved token `none` (case-insensitive) is **not** validated as a slug — `--review-with none` means no delegated reviewers (`REVIEW_AGENTS=[]`) and overrides any saved `review-with` default. If omitted, leave `REVIEW_AGENTS` **unset for now** — the saved-defaults step below fills it from `/do:config`; only if still unset after that is `REVIEW_AGENTS=[]` (self-review only). The host CLI is not implied in this list — it runs the self-review first regardless; an explicit `claude` entry under claude starts a fresh headless claude session for a second-pass perspective.
- **`--review-stop-on-findings` / `--review-stop-on-clean`** (mutually exclusive, optional): stop-mode for the delegated passes. Default `REVIEW_STOP_MODE=all` (run every listed agent). `on-findings` stops after the first delegated reviewer that surfaces a non-empty change set; `on-clean` after the first that reports zero findings. Abort with `--review-stop-on-findings and --review-stop-on-clean cannot be combined` if both appear.
- **`--review-mode <series|parallel>`** (optional): `series` (default) runs the listed reviewers one-at-a-time so each sees the prior's committed fixes; `parallel` runs them concurrently against one frozen baseline and applies the deduped union of findings once (`--reviewer-applies` and the stop-modes are ignored). Record as `REVIEW_MODE`; if omitted, leave it **unset for now** (the saved-defaults step fills it from the `review-mode` default; built-in default `series`). Abort with `--review-mode must be one of series, parallel (got: {value}).` on any other value.
- **`--reviewer-applies`** (optional, boolean): forwarded to each delegated local-agent pass to route fixes through the reviewing CLI instead of the orchestrator (see `lib/local-agent-review-loop.md` "Editing mode"). No effect on the copilot path, the `@<login>` path, the ollama path (Ollama is non-agentic — always review-only), or the host's self-review.
- **`--review-iterations <n>`** (optional): caps how many review-and-fix cycles a delegated **copilot** or **`@<login>`** pass runs. Record as `REVIEW_ITERATIONS`; default `1` (one pass, exiting early on 0 comments). Must be a non-negative integer — abort with `--review-iterations must be a non-negative integer (got: {value}).` otherwise. `0` means "loop until that reviewer returns 0 comments" (bounded by each loop's own 10-iteration safety guardrail). No effect on local-agent/ollama passes or the host's self-review; a per-entry `--review-with <agent>~max=<n>` suffix overrides this flag for the entry that carries it.

After parsing the flags above, apply any **saved defaults** (set via `/do:config`) to the flags the user did NOT pass (the delegated-review flags **and** `--issues` / `--issues-label`) — an explicit flag, or `--review-with none`, always overrides a saved default:

!`cat ~/.claude/lib/review-config-defaults.md`

- **`--issues`** / **`--no-issues`** / **`--issues-label <name>`** (optional): when a finding is **deferred** (local-branch mode only — see Finding Disposition), file it as a GitHub/GitLab issue instead of a PLAN.md line. `--issues` sets `ISSUE_MODE=true`; `--no-issues` forces `ISSUE_MODE=false`. If the user passes **neither**, take `ISSUE_MODE` from the saved `issues` default resolved above (built-in default `false`). Set `PLAN_LABEL` from `--issues-label`, else the saved `issues-label` default, else `plan`. No effect in PR mode.
- **PR reference** — any non-flag token that looks like a pull-request reference. **Match on URL *shape*, never on the hostname** — a self-managed GitHub Enterprise host often carries no `github` substring; the host-independent `/pull/{number}` path segment is what identifies a GitHub-flavored PR. A token matches if **any** of the following holds:
  - Full URL of the shape `{scheme}://{host}/{owner}/{repo}/pull/{number}` — **any** `{host}`, including `github.com`, `github.example.com`, and a GHES host with no `github` substring. Trailing subpaths (`/files`, `/commits`, `/checks`) and a `#discussion_r…` fragment are allowed and ignored.
  - SSH-style URL (`git@{host}:{owner}/{repo}`) carrying the same `/pull/{number}` segment — again on any host.
  - Shorthand: the argument matches `^[^/]+/[^/]+#[0-9]+$` AND `gh repo view {owner}/{repo}` confirms it resolves. Take `{GH_HOST}` from the `origin` remote here — a shorthand carries no host of its own.
  - Extract `OWNER`, `REPO`, and `PR_NUM`. Set `PR_MODE=true` and `PR_URL` to the canonical URL. Capture the URL's **host** as `{GH_HOST}` — `gh api` ignores the repo remote and defaults to github.com, so the calls below pass it explicitly (see `~/.claude/lib/gh-host.md`). It comes from the **PR URL**, not `origin` — the PR can live on a different host than the checkout.
  - **GitLab-shaped URL** (a `/-/merge_requests/{number}` or `/merge_requests/{number}` segment, on `gitlab.com` or any self-managed GitLab host): PR mode is GitHub-only today, so do **not** fall through to base-branch mode. Abort with `/do:review cannot review a GitLab merge request yet (got: {token}). Check the branch out locally and run /do:review with no argument to review it as a local diff.`
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

### GitHub PR mode (`PR_MODE=true`)

Do NOT use the local working tree as the source of truth; review the PR as published on GitHub.

1. **Fetch PR metadata**:
   ```bash
   gh pr view {PR_NUM} --repo {GH_HOST}/{OWNER}/{REPO} --json number,title,author,baseRefName,headRefName,headRefOid,baseRefOid,url,isCrossRepository,headRepositoryOwner,headRepository
   ```
   Capture `HEAD_SHA` (`headRefOid`), `BASE_SHA` (`baseRefOid`), `HEAD_REF`, `BASE_REF`, `AUTHOR_LOGIN`, and `IS_FORK` (`isCrossRepository`).
2. **Fetch the changed-files list**:
   ```bash
   gh pr diff {PR_NUM} --repo {GH_HOST}/{OWNER}/{REPO} --name-only
   ```
3. **Fetch the full unified diff**:
   ```bash
   gh pr diff {PR_NUM} --repo {GH_HOST}/{OWNER}/{REPO} > /tmp/do-review-pr-{PR_NUM}.diff
   ```
4. **Parse the diff to build a "commentable lines" map** — `{file_path: set of line numbers on the RIGHT (new) side of the diff}`; GitHub's review API rejects inline comments on lines outside the patch. Walk the unified diff line by line:
   - Track the current file from `diff --git a/<path> b/<path>` headers, not `+++ b/<path>` (deletions emit `+++ /dev/null`; renames may not round-trip through `+++`). Skip deleted files entirely.
   - Parse each `@@ -a,b +c,d @@` hunk header to seed the right-side line counter at `c`, then iterate hunk body lines: increment the counter on `+` (added) and ` ` (context) lines and include both in the map; skip `-` (removed) lines without incrementing.
   - **Ignore the `\ No newline at end of file` marker line** — it must NOT advance the right-side counter.
   - (Do NOT use `git apply --numstat` — it reports per-file totals, not hunk line ranges.) Save to `/tmp/do-review-pr-{PR_NUM}-lines.json`.
5. **Fetch each changed file at HEAD_SHA** so agents can read full file content. Skip deleted files — `repos/{OWNER}/{REPO}/contents/{path}?ref={HEAD_SHA}` returns 404 for any path removed in the PR:
   ```bash
   gh api --hostname {GH_HOST} repos/{OWNER}/{REPO}/contents/{path}?ref={HEAD_SHA} --jq '.content' 2>/dev/null | base64 -d > /tmp/do-review-pr-{PR_NUM}/{path} || echo "skipped (deleted or unreadable): {path}"
   ```
   (Create parent dirs as needed; URL-encode the path; use step 4's `diff --git` headers to skip deletions up front.)
6. Print: `Reviewing PR #{PR_NUM}: {title} — {N} files changed{strict_suffix}` plus a one-line note: `Author: {AUTHOR_LOGIN}{fork_suffix}` where `{fork_suffix}` is ` (cross-repo fork)` when `IS_FORK=true`.

If the PR has no changed files, inform the user and stop.

#### Determine write access (`{CAN_PUSH_HEAD}`)

Probe whether the PR's head branch accepts our push:

!`cat ~/.claude/lib/pr-write-access.md`

Resolve `PR_DISPOSITION` from `PR_APPLY` and `CAN_PUSH_HEAD`:

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

In `PR_MODE`, the local CLAUDE.md may not apply to the PR (fork or different repo). Also fetch the target repo's CLAUDE.md and AGENTS.md if they exist:
```bash
gh api --hostname {GH_HOST} repos/{OWNER}/{REPO}/contents/CLAUDE.md?ref={HEAD_SHA} --jq '.content' 2>/dev/null | base64 -d > /tmp/do-review-pr-{PR_NUM}-CLAUDE.md || true
gh api --hostname {GH_HOST} repos/{OWNER}/{REPO}/contents/AGENTS.md?ref={HEAD_SHA} --jq '.content' 2>/dev/null | base64 -d > /tmp/do-review-pr-{PR_NUM}-AGENTS.md || true
```
Pass whichever exists to the agents instead of (or in addition to) the local one.

## PR-Level Coherence Check

Before dispatching agents, understand what this change set claims to do:

1. Read commit messages (`git log {base}...HEAD --oneline`)
2. Read PLAN.md, the project's changelog (if any), and the PR description for capability claims, test counts, and "deep-links to X" / "feature Y now works" assertions
3. Note the claims — verify after agents return whether the code delivers them. Concrete drift to flag:
   - Test counts in PLAN/changelog vs `find . -name '*.test.*' -exec grep -c '^\(it\|test\)(' {} +` (or project equivalent)
   - "Deep-links to record X" claims vs whether the destination route handler actually consumes the encoded parameter
   - "Auto-prune after N days" / "scans only the page returned" claims vs the listing implementation
   - Comments in code claiming behavior the surrounding code doesn't perform
   - Field names quoted in docs (request body shape, event payload shape) vs what the code actually reads/emits

## Dispatch Review Agents

The host CLI is the review orchestrator. Inspect the scoped diff, run the selection protocol below, then spawn only the focused agents it selects — **in parallel** via the Agent tool at the **`heavy` tier** (this host's strongest model by alias, `model: "opus"` on Claude Code, per [lib/model-tiers.md](../../lib/model-tiers.md); never a version ID, never the session's own tier). If that tier is rejected for lack of entitlement, retry once with `model` omitted, say so, and continue. Each selected agent reviews ALL changed files independently; its checklist seeds the lens, not the conclusions.

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
3. The list of changed files from the diff stat (or `gh pr diff --name-only` in PR mode) AND, in PR mode, the path to each file's full content under `/tmp/do-review-pr-{PR_NUM}/`
4. In PR mode only: the path to `/tmp/do-review-pr-{PR_NUM}-lines.json` (the commentable-lines map) and an instruction that **every finding MUST cite a `file:line` where `line` appears in the commentable-lines map** — otherwise the finding cannot be posted inline and is downgraded to a summary-only finding
5. Instruction: "Read each changed file in full (not just diff hunks). Apply your reading lens — the checklist seeds attention but is NOT a script. Reason from principles about each new shape, flow, or contract: what's the smallest input that breaks this? What does the producer believe vs the consumer? What does the fallback path actually deliver? What does the documentation claim vs what the code does? Report findings that demonstrate consequence reasoning, not just pattern matches."
6. In PR mode only: "For every CRITICAL or IMPROVEMENT finding where a concrete fix is obvious, include a `suggestion:` block — the exact replacement text for the cited line(s). Use `start_line` and `line` to span multiple lines when the fix needs more than one line. The reviewer will package these as GitHub inline review suggestions."

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

After verifying all findings, run the project's build and test commands to confirm no false positives.

In `PR_MODE` with `PR_DISPOSITION=inline`, skip the local build/test step (nothing is checked out; the PR's CI is the source of truth) and verify by reading code only. With `PR_DISPOSITION=apply` the build/test step is mandatory: it runs after the fixes in "Fix Issues", and a failure blocks the push.

## Fix Issues (local branch mode, and PR mode when `PR_DISPOSITION=apply`)

**Skip this section when `PR_MODE=true` and `PR_DISPOSITION=inline`** — jump to "Post Review to GitHub PR".

When `PR_MODE=true` and `PR_DISPOSITION=apply`, run this section against the PR's branch instead of the local one, then continue to "Push fixes to the PR branch":

1. **Refuse to start on a dirty tree.** Before checking anything out, if `git status --porcelain` is non-empty, do not check out over the user's uncommitted work — fall back to `PR_DISPOSITION=inline`, say why, and continue.
2. `gh pr checkout {PR_NUM} --repo "{GH_HOST}/{OWNER}/{REPO}"` (per `~/.claude/lib/pr-write-access.md`) so the tracking ref points at the PR head, not the base repo.
3. Fix only what this review found. Do not rebase the PR, reformat untouched files, or fold in unrelated cleanups — the author owns this branch.
4. Attribute the commits to the review, exactly as local mode does below (`address review (self): …`).

!`cat ~/.claude/lib/finding-disposition.md`

Only when `ISSUE_MODE=true` and a finding is being deferred:

!read lib/plan-issue-mode.md

For each verified finding (local branch mode):
1. Classify severity: **CRITICAL** (runtime crash, data leak, security) vs **IMPROVEMENT** (consistency, robustness, conventions)
2. Fix all CRITICAL issues immediately
3. Fix IMPROVEMENT issues too. Per Finding Disposition, defer to PLAN.md only when the fix is genuinely large/architectural or too risky to land in this branch
4. **Identify the root cause** of why the issue existed (missing lint rule, missing comment at the canonical site, misleading name, API that invites the mistake, etc.) per `~/.claude/lib/per-finding-root-cause.md` and apply the smallest matching action **in the same change**. Defer big refactors and cross-cutting patterns to the end-of-loop Convention Encoding phase.
5. After fixes, run the project's test suite and build command
6. Verify the test suite covers the changed code paths — passing unrelated tests is not validation
7. Commit fixes: `address review (self): <summary>` — the parenthesized reviewer name matches the convention used by delegated `--review-with` passes.

## Push fixes to the PR branch (`PR_MODE=true` and `PR_DISPOSITION=apply`)

Skip this section in every other mode. This is the **primary output** when the head branch is writable.

1. **Gate on the tests.** The build/test run from "Fix Issues" must have passed. If it failed and you cannot fix it inside the scope of this review, push nothing: fall back to `PR_DISPOSITION=inline` and post the findings as comments, saying the fixes were prepared but did not pass the project's checks.
2. **Push with a bare `git push`** — no remote, no refspec — so it follows the tracking ref `gh pr checkout` set up. `git push origin {branch}` is wrong here: on a cross-repo PR it invents a branch on the wrong repository while the real PR head stays stale.
3. **A rejected push is a downgrade, not an abort** (see `~/.claude/lib/pr-write-access.md`). On a non-fast-forward, run `git pull --rebase` once and retry; if it still fails, or fails with a permission error, keep the commits locally and switch to `PR_DISPOSITION=inline`.
4. **Post a short PR comment describing what was pushed** (`gh pr comment`), not a `REQUEST_CHANGES` review. List the commits and the findings they address, plus any finding you did **not** fix (out-of-scope, architectural, `UNCERTAIN`).
5. Print the pushed SHAs and the PR URL.

## Post Review to GitHub PR (`PR_MODE=true` and `PR_DISPOSITION=inline`)

Skip this section when `PR_MODE=false`, and when `PR_DISPOSITION=apply` succeeded in pushing. Package the verified findings as a single GitHub PR review with inline comments and code suggestions.

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
- The `suggestion` block is literal replacement text for the cited lines, not diff format (no `-`/`+` prefixes).
- Severity tag: prefix the body with `**[CRITICAL]**`, `**[IMPROVEMENT]**`, or `**[NIT]**`.
- Findings without a concrete suggestion still get inline comments, without the ```` ```suggestion ```` block.
- Skip `UNCERTAIN` findings — don't post speculation.

### Build the review summary body

Assemble a top-level review body (markdown) with:
- One-line verdict (e.g., `Reviewed by /do:review — N critical, M improvements, K nits.`)
- A short "Highlights" section listing the most important 1-3 CRITICAL findings by `file:line`
- An "Out-of-diff observations" section for findings on lines that aren't part of the patch
- A "Coherence check" section if the PR description/commits claim something the code doesn't deliver
- A footer: `_Generated by /do:review_`

### Pick the review event

- **`REQUEST_CHANGES`** if any finding is CRITICAL **and** the current user is not the PR author. If the current user IS the PR author (`gh api --hostname {GH_HOST} user -q '.login'` vs `AUTHOR_LOGIN`), downgrade to `COMMENT` — GitHub forbids requesting changes on your own PR.
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

With `--draft`: instead of `POST .../reviews`, write the payload to `/tmp/do-review-pr-{PR_NUM}-payload.json` and print the path plus the `gh api` command needed to publish it manually — include the `--hostname {GH_HOST}` flag in that printed command so it targets the right host on GitHub Enterprise. (Default behavior remains: publish immediately.)

## Merge the PR (`--merge`, `PR_MODE=true` only)

Only when `MERGE_ENABLED=true`. **Merge only when the PR is actually good** — the flag asks for a merge, every gate below has to agree to one. Skip the merge and print the failing gate by name whenever any of these does not hold:

1. **No unresolved blocker from this run.** Zero CRITICAL findings remain (none found, or every one fixed and pushed in `PR_DISPOSITION=apply`). A commented-only CRITICAL is unresolved, so `PR_DISPOSITION=inline` can never merge; `--strict`-promoted structural findings count here too. `UNCERTAIN` findings do not block, but name them in the merge report.
2. **We can merge it.** `BASE_PUSH=true` (from `~/.claude/lib/pr-write-access.md`) and the PR is not a draft.
3. **GitHub says it is mergeable.** `gh pr view {PR_NUM} --repo "{GH_HOST}/{OWNER}/{REPO}" --json mergeable,mergeStateStatus,reviewDecision,isDraft` reports `mergeable=MERGEABLE` and `reviewDecision` is not `CHANGES_REQUESTED`. A `mergeStateStatus` of `BLOCKED` or `DIRTY` stops the merge — report it and leave the PR open.
4. **Required CI is green.** `gh pr checks {PR_NUM} --repo "{GH_HOST}/{OWNER}/{REPO}" --required --watch --fail-fast`. On a failure, apply the one-conservative-re-run routine in `~/.claude/lib/ci-flake-handling.md`; if it fails again, do not merge — report which check failed.
5. **The head is what we reviewed.** Re-read `headRefOid` and compare it to the `HEAD_SHA` this review ran against (plus any commits we pushed ourselves). If the author pushed something else meanwhile, do not merge; say the head moved and stop.

When every gate passes:

```bash
gh pr merge {PR_NUM} --repo "{GH_HOST}/{OWNER}/{REPO}" --{MERGE_METHOD}
```

`{MERGE_METHOD}` defaults to `squash` when `--merge` carried no method. **Never pass `--delete-branch` here** — on a cross-repo PR the head branch belongs to the contributor's fork, and in a linked worktree `gh`'s implicit default-branch checkout fails and reports a successful merge as an error. Read the PR's state back and confirm it is `MERGED` before saying so: `gh pr merge` exits zero on a repo with a merge queue while the PR is only *queued*.

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
```

If no issues were found, confirm the code is clean and ready for PR.

In `PR_MODE`, open the report with the disposition line (`apply` or `inline`, and the reason), then:

- **`PR_DISPOSITION=inline`** — replace "Issues Fixed" with **Inline Suggestions Posted** (count and list with `file:line` + one-line gist) and **Out-of-diff Findings** (list — these went into the summary body), and add a final line with the posted review URL.
- **`PR_DISPOSITION=apply`** — keep "Issues Fixed", list the pushed commit SHAs, and add **Left for the author** for anything not fixed. If the push was refused and the run fell back to comments, say so explicitly and report as `inline`.

When `MERGE_ENABLED=true`, close with the merge outcome: `Merged #{PR_NUM} ({MERGE_METHOD})`, or the name of the gate that stopped it.

## Convention Encoding

**Skip when `PR_MODE=true`** — convention encoding mutates the local working tree, the wrong target for someone else's remote PR; put convention recommendations in the posted review's summary body instead, as suggestions to the PR author.

After the report is printed and fixes are committed (local branch mode), for each finding pattern likely to recur (fixed or accepted-as-is), apply the **smallest** code-level action that makes the convention self-evident (in-tree comment at the canonical site, a clarifying rename, or a surgical refactor that removes the footgun). CLAUDE.md / AGENTS.md additions are a **fallback** for conventions that can't be expressed locally. Encoded actions land in the same branch as the review fixes.

!`cat ~/.claude/lib/per-finding-root-cause.md`

!`cat ~/.claude/lib/post-review-doc-recommendations.md`

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
- `{GH_HOST}` — the GitHub API host established in "Determine Scope" (the PR URL's host in PR mode, the `origin` remote's host in local mode); forwarded to the GitHub-side loops so their `gh api` calls target the right host on GitHub Enterprise

Per-agent dispatch inside the wrapper:

- `copilot` and `@<login>` — GitHub-side and PR-bound: only meaningful when a PR exists for the current branch (local mode) or when `PR_MODE=true`. `copilot` requests a Copilot review via the Copilot review loop; `@<login>` requests a review from the arbitrary login `{REVIEWER_LOGIN}` via the GitHub-reviewer loop (`lib/github-reviewer-loop.md`). If no PR is associated with the current branch in local mode, print `Skipping copilot pass: no open PR on {branch}.` / `Skipping @{REVIEWER_LOGIN} pass: no open PR on {branch}.` and continue to the next agent.
- `codex` | `agy` | `claude` | `grok` | `pi` | `cursor` | `opencode` | `ollama` — invoke the local-agent review loop (ollama: the Ollama review loop). The CLI runs a self-contained single-agent review prompt headless (codex: `codex review --base "$BASE_BRANCH"`; the others: `git diff $BASE_BRANCH...HEAD` inside the prompt) — never the `/do:review` multi-sub-agent skill, which hangs headless. The loop publishes nothing to the PR; in review-only mode it emits findings to stdout and the orchestrator owns any PR comment.
  - In **local branch mode**, set the wrapper's `BASE_BRANCH=$BASE_BRANCH` so the inner loop reviews against the same base this self-review used (with the host's just-committed fixes in HEAD).
  - In **PR mode**, a local `git diff` needs a checked-out branch and a resolvable base ref — a PR URL won't resolve — so **these passes are skipped** unless the PR branch is checked out locally with a resolvable base (`copilot` is the PR-by-URL reviewer), printing `Skipping {agent} pass in PR mode: the local-agent loop reviews a local git diff and cannot resolve a PR URL. Use --review-with {agent} against a local branch instead.` Each skip is recorded in the per-pass table as status `skipped`, treated like a non-fix inconclusive for `{OVERALL_STATUS}` purposes.

### Multi-reviewer wrapper

Read when `REVIEW_AGENTS` is non-empty:

!read lib/multi-reviewer-loop.md

### Inner loop bodies (referenced by the wrapper)

Read only the bodies for reviewer kinds present in the agent list.

Only for `copilot` entries:

!read lib/copilot-review-loop.md

Only for `@<login>` entries:

!read lib/github-reviewer-loop.md

Only for an entry that is none of `copilot`, `ollama`, or `@<login>` (every other slug — the fixed CLIs and `cmd[<invocation>]` alike — dispatches through this one loop; a future addition needs no new gate here):

!read lib/local-agent-review-loop.md

Only for `ollama` entries:

!read lib/ollama-review-loop.md

### Final report (when delegated passes ran)

After the wrapper exits, append its aggregate report to the self-review summary (self-review = pass 0, delegated passes 1..N). The final overall status is whichever is worse: the self-review's "issues remaining" count or the wrapper's `{OVERALL_STATUS}`.
