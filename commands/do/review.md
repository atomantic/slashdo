---
description: Deep code review of changed files against software engineering best practices
argument-hint: "[--strict|--nuclear] [base-branch]"
---

## Parse Arguments

Parse `$ARGUMENTS` for:
- **`--strict`** (alias: **`--nuclear`**): enable the Structural Ambition agent (6th agent) and promote structural findings to blocker tier. Use for branches you want to land cleanly — flags file-size growth past 1000 lines, ad-hoc conditionals bolted onto unrelated flows, thin wrappers, boundary leaks, and missed code-judo simplifications.
- Any non-flag token: treat as the base branch override.

Set `STRICT_MODE=true` if either flag is present.

## Determine Scope

1. **Detect the base branch** — use the positional argument if provided, otherwise run `gh repo view --json defaultBranchRef -q '.defaultBranchRef.name'`
2. **Detect the current branch** — `git branch --show-current`
3. **Get the diff stat** — `git diff {base}...HEAD --stat` to see all changed files and line counts
4. **Get the full diff** — `git diff {base}...HEAD` to see actual changes
5. Print: `Reviewing: {current} vs {base} — {N} files changed{strict_suffix}` where `{strict_suffix}` is ` (strict mode)` when `STRICT_MODE=true`, empty otherwise

If there are no changes, inform the user and stop.

## Apply Project Conventions

CLAUDE.md is already loaded into your context. Use its rules (code style, error handling, logging, security model, scope exclusions) as overrides to generic best practices throughout this review. Pass relevant convention overrides to each agent so they don't flag things the project intentionally allows (e.g., "no auth needed — internal tool").

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
2. Project convention overrides from CLAUDE.md that affect the review
3. The list of changed files from the diff stat
4. Instruction: "Read each changed file in full (not just diff hunks). Apply your reading lens — the checklist seeds attention but is NOT a script. Reason from principles about each new shape, flow, or contract: what's the smallest input that breaks this? What does the producer believe vs the consumer? What does the fallback path actually deliver? What does the documentation claim vs what the code does? Report findings that demonstrate consequence reasoning, not just pattern matches."

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

## Fix Issues

For each verified finding:
1. Classify severity: **CRITICAL** (runtime crash, data leak, security) vs **IMPROVEMENT** (consistency, robustness, conventions)
2. Fix all CRITICAL issues immediately
3. For IMPROVEMENT issues, fix them too — the goal is to eliminate review round-trips
4. **Identify the root cause** of why the issue existed (missing lint rule, missing comment at the canonical site, misleading name, API that invites the mistake, etc.) per `~/.claude/lib/per-finding-root-cause.md` and apply the smallest matching action **in the same change**. Defer big refactors and cross-cutting patterns to the end-of-loop Convention Encoding phase.
5. After fixes, run the project's test suite and build command (per project conventions already in context)
6. Verify the test suite covers the changed code paths — passing unrelated tests is not validation
7. Commit fixes: `refactor: address code review findings`

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

## Convention Encoding

After the report is printed and fixes are committed, run the Convention Encoding phase. Examine the findings (both fixed and accepted-as-is) and, for each pattern likely to recur, apply the **smallest** code-level action that makes the convention self-evident (in-tree comment at the canonical site, a clarifying rename, or a surgical refactor that removes the footgun). CLAUDE.md / AGENTS.md additions are a **fallback**, used only when the convention truly can't be expressed locally. Any encoded actions land in the same branch as the review fixes.

!`cat ~/.claude/lib/per-finding-root-cause.md`

!`cat ~/.claude/lib/post-review-doc-recommendations.md`

## PR Comment Policy

After the review and any fixes, determine whether to post review comments on the PR/MR:

1. **Check for an open PR** on the current branch: `gh pr view --json number,author --jq '{number, author: .author.login}' 2>/dev/null`. If the command fails (no PR exists), skip posting.
2. **Get the current user**: `gh api user -q '.login'`
3. **Compare**: If the PR author login **matches** the current user, do NOT post comments to the PR — the local fixes and summary are sufficient.
4. **If the PR was opened by someone else**, post a review comment on the PR summarizing the findings using `gh pr review {number} --comment --body "..."`. Include the issues found, fixes applied, and any remaining items that need the author's attention.

This avoids noisy self-comments on your own PRs while still providing feedback to other contributors.
