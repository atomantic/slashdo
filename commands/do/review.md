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

CLAUDE.md is already loaded into your context. Use its rules (code style, error handling, logging, security model, scope exclusions) as overrides to generic best practices throughout this review. For example, if CLAUDE.md says "no auth needed — internal tool", do not flag missing authentication.

## Deep File Review

For **each changed file** in the diff, read the **entire file** (not just diff hunks). Reviewing only the diff misses context bugs where new code interacts incorrectly with existing code.

### Understand the Code Flow

Before checking individual files against the checklist, **map the flow of changed code across all files**. This means:

1. **Trace call chains** — for each new or modified function/method, identify every caller and callee across the changed files. Read those files too if needed. You cannot evaluate whether code is duplicated or well-structured without knowing how it connects.
2. **Identify shared data paths** — trace data from entry point (route handler, event listener, CLI arg) through transforms, storage, and output. Understand what each layer is responsible for.
3. **Map responsibilities** — for each changed module/file, state its single responsibility in one sentence. If you can't, it may be doing too much.

### Evaluate Software Engineering Principles

With the flow understood, evaluate the changed code against these principles:

**DRY (Don't Repeat Yourself)**
- Look for logic duplicated across changed files or between changed and existing code. Grep for similar function signatures, repeated conditional blocks, or copy-pasted patterns with minor variations.
- If two functions do nearly the same thing with small differences, they should likely share a common implementation with the differences parameterized.
- Duplicated validation, error formatting, or data transformation are common violations.

**YAGNI (You Ain't Gonna Need It)**
- Flag abstractions, config options, parameters, or extension points that serve no current use case. Code should solve the problem at hand, not hypothetical future problems.
- Unnecessary wrapper functions, premature generalization (e.g., a factory that produces one type), and unused feature flags are common violations.

**SOLID Principles**
- **Single Responsibility** — each module/function should have one reason to change. If a function handles both business logic and I/O formatting, flag it.
- **Open/Closed** — new behavior should be addable without modifying existing working code where practical (e.g., strategy patterns, plugin hooks).
- **Liskov Substitution** — if subclasses or interface implementations exist, verify they are fully substitutable without breaking callers.
- **Interface Segregation** — callers should not depend on methods they don't use. Large config objects or option bags passed through many layers are a smell.
- **Dependency Inversion** — high-level modules should not import low-level implementation details directly when an abstraction boundary would be cleaner.

**Separation of Concerns**
- Business logic should not be tangled with transport (HTTP, WebSocket), storage (SQL, file I/O), or presentation (HTML, JSON formatting).
- If a route handler contains business rules beyond simple delegation, flag it.

**Naming & Readability**
- Function and variable names should communicate intent. If you need to read the implementation to understand what a name means, it's poorly named.
- Boolean variables/params should read as predicates (`isReady`, `hasAccess`), not ambiguous nouns.

Only flag principle violations that are **concrete and actionable** in the changed code. Do not flag pre-existing design issues in untouched code unless the changes make them worse.

### Per-File Checklist

Check every file against this checklist:

!`cat ~/.claude/lib/code-review-checklist.md`

### Additional deep checks (read surrounding code to verify):

**Cross-file consistency**
- If a new function/endpoint follows a pattern from an existing similar one, verify ALL aspects match (validation, error codes, response shape, cleanup). Partial copying is the #1 source of review feedback.
- New API client functions should use the same encoding/escaping as existing ones (e.g., if other endpoints use `encodeURIComponent`, new ones must too)

**Error path completeness**
- Trace each error path end-to-end: does the error reach the user with a helpful message and correct HTTP status? Or does it get swallowed, logged silently, or surface as a generic 500?
- For multi-step operations (sync to N repos, batch updates): are per-item failures tracked separately from overall success? Does the status reflect partial failure accurately?

**Concurrency under user interaction**
- If a component performs optimistic updates with async operations, simulate what happens when the user triggers a second action while the first is in-flight — trace whether rollback/success handlers can clobber concurrent state changes or close over stale snapshots

**State ownership across component boundaries**
- If a child component maintains local state derived from a parent's data (e.g., optimistic UI copies), trace the ownership boundary: does the child propagate changes back to the parent? What happens on unmount/remount — does the parent's stale cache resurface?

**Data flow audit**
- For sensitive data (secrets, tokens): trace the value from input → storage → retrieval → response. Verify it is never leaked in ANY response path (GET, PUT, POST, error responses, socket events)
- For user input → URL/command interpolation: verify encoding/escaping at every boundary

## Fix Issues Found

For each issue found:
1. Classify severity: **CRITICAL** (runtime crash, data leak, security) vs **IMPROVEMENT** (consistency, robustness, conventions)
2. Fix all CRITICAL issues immediately
3. For IMPROVEMENT issues, fix them too — the goal is to eliminate Copilot review round-trips
4. After fixes, run the project's test suite and build command (per project conventions already in context)
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
