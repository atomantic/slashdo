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

## Read Project Conventions

Read the project's CLAUDE.md (if it exists) to understand:
- Code style rules, error handling patterns, logging conventions
- Custom error classes, validation patterns, framework-specific rules
- Any explicit security model or scope exclusions

These conventions override generic best practices. For example, if CLAUDE.md says "no auth needed — internal tool", do not flag missing authentication.

## Deep File Review

For **each changed file** in the diff, read the **entire file** (not just diff hunks). Reviewing only the diff misses context bugs where new code interacts incorrectly with existing code.

Check every file against this checklist:

!`cat ~/.claude/lib/code-review-checklist.md`

### Additional deep checks (read surrounding code to verify):

**Cross-file consistency**
- If a new function/endpoint follows a pattern from an existing similar one, verify ALL aspects match (validation, error codes, response shape, cleanup). Partial copying is the #1 source of review feedback.
- New API client functions should use the same encoding/escaping as existing ones (e.g., if other endpoints use `encodeURIComponent`, new ones must too)

**Error path completeness**
- Trace each error path end-to-end: does the error reach the user with a helpful message and correct HTTP status? Or does it get swallowed, logged silently, or surface as a generic 500?
- For multi-step operations (sync to N repos, batch updates): are per-item failures tracked separately from overall success? Does the status reflect partial failure accurately?

**Data flow audit**
- For sensitive data (secrets, tokens): trace the value from input → storage → retrieval → response. Verify it is never leaked in ANY response path (GET, PUT, POST, error responses, socket events)
- For user input → URL/command interpolation: verify encoding/escaping at every boundary

## Fix Issues Found

For each issue found:
1. Classify severity: **CRITICAL** (runtime crash, data leak, security) vs **IMPROVEMENT** (consistency, robustness, conventions)
2. Fix all CRITICAL issues immediately
3. For IMPROVEMENT issues, fix them too — the goal is to eliminate Copilot review round-trips
4. After fixes, run the project's test suite and build command (check CLAUDE.md for commands)
5. Commit fixes: `refactor: address code review findings`

## Report

Print a summary table of what was reviewed and found:

```
## Review Summary

| Category | Files Checked | Issues Found | Fixed |
|----------|--------------|-------------|-------|
| Hygiene  | N            | N           | N     |
| ...      | ...          | ...         | ...   |

### Issues Fixed
- file:line — description of fix

### Accepted As-Is (with rationale)
- file:line — description and why it's acceptable
```

If no issues were found, confirm the code is clean and ready for PR.
