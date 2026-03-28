---
description: Deep code review of changed files against software engineering best practices
argument-hint: "[base-branch]"
---

## Determine Scope

1. **Detect the base branch** — use the argument if provided, otherwise run `gh repo view --json defaultBranchRef -q '.defaultBranchRef.name'`
2. **Detect the current branch** — `git branch --show-current`
3. **Get the diff stat** — `git diff {base}...HEAD --stat` to see all changed files and line counts
4. **Get the full diff** — `git diff {base}...HEAD` to see actual changes
5. Print: `Reviewing: {current} vs {base} — {N} files changed`

If there are no changes, inform the user and stop.

## Apply Project Conventions

CLAUDE.md is already loaded into your context. Use its rules (code style, error handling, logging, security model, scope exclusions) as overrides to generic best practices throughout this review. Pass relevant convention overrides to each agent so they don't flag things the project intentionally allows (e.g., "no auth needed — internal tool").

## PR-Level Coherence Check

Before dispatching agents, understand what this change set claims to do:

1. Read commit messages (`git log {base}...HEAD --oneline`)
2. Note the claims — verify after agents return whether the code actually delivers them.

## Dispatch Review Agents

Read the three agent instruction files, then spawn **all three in parallel** using the Agent tool. Each agent reviews ALL changed files independently.

<surface_scan_agent>

### 1. Surface Scan Agent

Catches per-file bugs: runtime crashes, hygiene, domain-specific issues, quality, and convention violations.

!`cat ~/.claude/lib/review-surface-scan.md`

</surface_scan_agent>

<security_agent>

### 2. Security Audit Agent

Catches trust boundary violations, injection, SSRF, data exposure, and access control gaps.

!`cat ~/.claude/lib/review-security-audit.md`

</security_agent>

<cross_file_agent>

### 3. Cross-File Tracing Agent

Catches contract mismatches, broken call chains, stale state propagation, lifecycle gaps, and architectural violations.

!`cat ~/.claude/lib/review-cross-file-tracing.md`

</cross_file_agent>

### How to dispatch

For each agent, construct its prompt by combining:
1. The agent's instruction content (from the sections above)
2. Project convention overrides from CLAUDE.md that affect the review
3. The list of changed files from the diff stat
4. Instruction: "Read each changed file in full (not just diff hunks). Apply your checklist. Return structured findings."

Spawn all three agents simultaneously. Each returns its findings independently.

### Large PR handling

If the diff touches more than 20 files, tell each agent to batch files by directory and process groups sequentially within their parallel run. The orchestrator does not manage batching.

## Collect & Deduplicate

After all three agents return:

1. **Merge** all findings into a single list, tagged by source agent
2. **Deduplicate**: if two agents flagged the same `file:line` with overlapping descriptions, keep the most detailed version and note both agents found it
3. **PR coherence**: verify commits deliver what they claim — flag discrepancies as IMPROVEMENT findings
4. **CLAUDE.md filter**: remove findings that conflict with explicit project conventions

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
4. After fixes, run the project's test suite and build command (per project conventions already in context)
5. Verify the test suite covers the changed code paths — passing unrelated tests is not validation
6. Commit fixes: `refactor: address code review findings`

## Report

Print a summary table of what was reviewed and found:

```
## Review Summary

| Agent | Files Checked | Issues Found | Fixed |
|-------|--------------|-------------|-------|
| Surface Scan | N | N | N |
| Security Audit | N | N | N |
| Cross-File Tracing | N | N | N |
| **Total** | **N** | **N** | **N** |

### Issues Fixed
- file:line — description of fix (agent: Surface/Security/Cross-File)

### Accepted As-Is (with rationale)
- file:line — description and why it's acceptable
```

If no issues were found, confirm the code is clean and ready for PR.

## PR Comment Policy

After the review and any fixes, determine whether to post review comments on the PR/MR:

1. **Check for an open PR** on the current branch: `gh pr view --json number,author --jq '{number, author: .author.login}' 2>/dev/null`. If the command fails (no PR exists), skip posting.
2. **Get the current user**: `gh api user -q '.login'`
3. **Compare**: If the PR author login **matches** the current user, do NOT post comments to the PR — the local fixes and summary are sufficient.
4. **If the PR was opened by someone else**, post a review comment on the PR summarizing the findings using `gh pr review {number} --comment --body "..."`. Include the issues found, fixes applied, and any remaining items that need the author's attention.

This avoids noisy self-comments on your own PRs while still providing feedback to other contributors.
