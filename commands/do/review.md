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

<review_instructions>

## PR-Level Coherence Check

Before reviewing individual files, understand what this change set claims to do:

1. Read commit messages (`git log {base}...HEAD --oneline`)
2. After reviewing all files, verify: does the changed code actually deliver what the commits claim? Flag any claims not backed by code (e.g., "adds rate limiting" but only adds a comment).

## Large PR Strategy

If the diff touches more than 15 files, split the review into batches:
1. Group files by module/directory
2. Review each batch, printing findings as you go
3. Delegate files beyond the first 15 to a subagent if context is getting full

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

</review_instructions>

<checklist>

### Per-File Checklist

Check every file against this checklist. The checklist is organized into tiers — always check Tiers 1 and 4, and check Tiers 2-3 only when the relevance filter matches the file:

!`cat ~/.claude/lib/code-review-checklist.md`

</checklist>

<deep_checks>

### Additional deep checks (read surrounding code to verify):

**Cross-file consistency**
- If a new function/endpoint follows a pattern from an existing similar one, verify ALL aspects match (validation, error codes, response shape, cleanup). Partial copying is the #1 source of review feedback.
- New API client functions should use the same encoding/escaping as existing ones (e.g., if other endpoints use `encodeURIComponent`, new ones must too)
- If the PR adds a new endpoint, trace where existing endpoints are registered and verify the new one is wired in all runtime adapters (serverless handler map, framework route file, API gateway config, local dev server) — a route registered in one adapter but missing from another will silently 404 in the missing runtime
- If the PR adds a new call to an external service that has established mock/test infrastructure (mock mode flags, test helpers, dev stubs), verify the new call uses the same patterns — bypassing them makes the new code path untestable in offline/dev environments and inconsistent with existing integrations
- If the PR adds a new UI component or client-side consumer against an existing API endpoint, read the actual endpoint handler or response shape — verify every field name, nesting level, identifier property, and response envelope path used in the consumer matches what the producer returns. This is the #1 source of "renders empty" bugs in new views built against existing APIs

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

**Access scope changes**
- If the PR widens access to an endpoint or resource (admin→public, internal→external), trace all shared dependencies the endpoint uses (rate limiters, queues, connection pools, external service quotas) and assess whether they were sized for the previous access level — in-memory/process-local limiters don't enforce limits across horizontally scaled instances
- If the PR adds endpoints under a restricted route group (admin, internal, scoped), read sibling endpoints in the same route group and verify the new endpoint applies the same authorization gate — missing gates on admin-mounted endpoints are consistently the most dangerous review finding

**Guard-before-cache ordering**
- If a handler performs a pre-flight guard check (rate limit, quota, feature flag) before a cache lookup or short-circuit path, verify the guard doesn't block operations that would be served from cache without touching the guarded resource — restructure so cache hits bypass the guard

**Sanitization/validation coverage**
- If the PR introduces a new validation or sanitization function for a data field, trace every code path that writes to that field (create, update, import, sync, rename) — verify they all use the same sanitization. Partial application is the #1 way invalid data re-enters through an unguarded path

**Bootstrap/initialization ordering**
- If the PR adds resilience or self-healing code (dependency installers, auto-repair, migration runners), trace the execution order: does the main code path resolve or import the dependencies BEFORE the resilience code runs? If so, the bootstrapper never executes when it's needed most — restructure so verification/installation precedes resolution

**Lock/flag exit-path completeness**
- If a function sets a shared flag or lock (in-progress, mutex, status marker), trace every exit path — early returns, error catches, platform-specific guards, and normal completion — to verify the flag is cleared. A missed path leaves the system permanently locked

**Operation-marker ordering**
- If the PR writes completion markers, success flags, or status files, verify they are written AFTER the operation they attest to, not before. If the operation can fail after the marker write, consumers see false success. Also check that marker-dependent startup logic validates the marker's contents rather than treating presence as unconditional success

**Real-time event vs response timing**
- If a handler emits push notifications (WebSocket, SSE, pub/sub) AND returns an HTTP response, verify clients won't receive push events before the response that gives them context to interpret those events — especially when the response contains IDs or version numbers the event consumer needs

**Intent vs implementation (meta-cognitive pass)**
- For each label, comment, docstring, status message, or inline instruction that describes behavior, verify the code actually implements that behavior. A detection mechanism must query the data it claims to detect; a migration must create the target, not just delete the source
- If the PR contains inline code examples, command templates, or query snippets, verify they are syntactically valid for their language — run a mental parse of each example. Watch for template placeholder format inconsistencies within and across files
- If the PR modifies a value (identifier, parameter name, format convention, threshold, timeout) that is referenced in other files, trace all cross-references and verify they agree. This includes: reviewer usernames, API names, placeholder formats, GraphQL field names, operational constants
- If the PR adds or reorders sequential steps/instructions, verify the ordering matches execution dependencies — readers following steps in order must not perform an action before its prerequisite

**Transactional write integrity**
- If the PR performs multi-item writes (database transactions, batch operations), verify each write includes condition expressions that prevent stale-read races (TOCTOU) — an unconditioned write after a read can upsert deleted records, double-count aggregates, or drive counters negative. Trace the gap between read and write for each operation
- If the PR catches transaction/conditional failures, verify the error is translated to a client-appropriate status (409, 404) rather than bubbling as 500 — expected concurrency failures are not server errors

**Batch/paginated API consumption**
- If the PR calls batch or paginated external APIs (database batch gets, paginated queries, bulk service calls), verify the caller handles partial results — unprocessed items, continuation tokens, and rate-limited responses must be retried or surfaced, not silently dropped. Check that retry loops include backoff and attempt limits
- If the PR references resource names from API responses (table names, queue names), verify lookups account for environment-prefixed names rather than hardcoding bare names

**Data model vs access pattern alignment**
- If the PR adds queries that claim ordering (e.g., "recent", "top"), verify the underlying key/index design actually supports that ordering natively — random UUIDs and non-time-sortable keys require full scans and in-memory sorting, which degrades at scale

**Deletion/lifecycle cleanup and aggregate reset completeness**
- If the PR adds a delete or destroy function, trace all resources created during the entity's lifecycle (data directories, git branches, child records, temporary files, worktrees) and verify each is cleaned up on deletion. Compare with existing delete functions in the codebase for completeness patterns
- If the PR adds a state transition that resets an aggregate value (counter, score, flag count), trace all individual records that contribute to that aggregate and verify they are also cleared, archived, or versioned — a reset counter with stale contributing records causes inconsistency and blocks duplicate-prevention checks on re-entry

**Update schema depth**
- If the PR derives an update/patch schema from a create schema (e.g., `.partial()`, `Partial<T>`), verify that nested objects also become partial — shallow partial on deeply-required schemas rejects valid partial updates where the caller only wants to change one nested field

**Mutation return value freshness**
- If a function mutates an entity and returns it, verify the returned object reflects the post-mutation state, not a pre-read snapshot. Also check whether dependent scheduling/evaluation state (backoff, timers, status flags) is reset when a "force" or "trigger" operation is invoked

**Responsibility relocation audit**
- If the PR moves a responsibility from one module to another (e.g., a database write from a handler to middleware, a computation from client to server), trace all code at the old location that depended on the timing, return value, or side effects of the moved operation — guards, response fields, in-memory state updates, and downstream scheduling that assumed co-located execution. Verify the new execution point preserves these contracts or that dependents are updated. Check for dead code left behind at the old location

**Read-after-write consistency**
- If the PR writes to a data store and then immediately queries that store (especially scans, aggregations, or replica reads), check whether the store's consistency model guarantees visibility of the write. If not, flag the read as potentially stale and suggest computing from in-memory state, using consistent-read options, or adding a delay/caveat

**Security-sensitive configuration parsing**
- If the PR reads environment variables or config values that affect security behavior (proxy trust depth, rate limit thresholds, CORS origins, token expiry), verify the parsing enforces the expected type and range — e.g., integer-only via `parseInt` with `Number.isInteger` check, non-negative bounds, and a logged fallback to a safe default on invalid input. `Number()` on arbitrary strings accepts floats, negatives, and empty-string-as-zero, all of which can silently weaken security controls

**Multi-source data aggregation**
- If the PR aggregates items from multiple sources into a single collection (merging accounts, combining API results, flattening caches), verify each item retains its source identifier through the aggregation — downstream operations that need to route back to the correct source (updates, deletes, detail views) will silently break or operate on the wrong source if the origin is lost

**Field-set enumeration consistency**
- If the PR adds an operation that targets a set of entity fields (enrichment, validation, migration, sync), trace every other location that independently enumerates those fields — UI predicates, scan/query filters, API documentation, response shapes, and test assertions. Each must cover the same field set; a missed field causes silent skips or false UI state. Prefer deriving enumerations from a single source of truth (constant array, schema keys) over maintaining independent lists

**Abstraction layer fidelity**
- If the PR calls a third-party API through an internal wrapper/abstraction layer, trace whether the wrapper requests and forwards all fields the handler depends on — third-party APIs often have optional response attributes that require explicit opt-in (e.g., cancellation reasons, extended metadata). Code branching on fields the wrapper doesn't forward will silently receive `undefined` and take the wrong path. Also verify that test mocks match what the real wrapper returns, not what the underlying API could theoretically return

**Data model / status lifecycle changes**
- If the PR changes the set of valid statuses, enum values, or entity lifecycle states, sweep all dependent artifacts: API doc summaries and enum declarations, UI filter/tab options, conditional rendering branches (which actions to show per state), integration guide examples, route names derived from old status names, and test assertions. Each artifact that references the old value set must be updated — partial updates leave stale filters, invalid actions, and misleading documentation
- If the PR renames a concept (e.g., "flagged" → "rejected"), trace all manifestations beyond user-facing labels: route paths, component/file names, variable names, CSS classes, and test descriptions. Internal identifiers using the old name create confusion even when the UI is correct

**Formatting & structural consistency**
- If the PR adds content to an existing file (list items, sections, config entries), verify the new content matches the file's existing indentation, bullet style, heading levels, and structure — rendering inconsistencies are the most common Copilot review finding

**Query key / stored key precision alignment**
- If the PR adds queries that construct lookup keys with a different precision, encoding, or format than what the write path persists, the query will silently return zero matches. Trace the key construction in both write and read paths and verify they produce compatible values

</deep_checks>

<verify_findings>

## Verify Findings

For each issue found, ground it in evidence before classifying:
1. **Quote the specific code line(s)** that demonstrate the issue
2. **Explain why it's a problem** in one sentence given the surrounding context
3. If the fix involves async/state changes, **trace the execution path** to confirm the issue is real
4. If you cannot quote specific code for a finding, downgrade it to **[UNCERTAIN]**

After verifying all findings, run the project's build and test commands to confirm no false positives.

</verify_findings>

<fix_and_report>

## Fix Issues Found

For each verified issue:
1. Classify severity: **CRITICAL** (runtime crash, data leak, security) vs **IMPROVEMENT** (consistency, robustness, conventions)
2. Fix all CRITICAL issues immediately
3. For IMPROVEMENT issues, fix them too — the goal is to eliminate Copilot review round-trips
4. After fixes, run the project's test suite and build command (per project conventions already in context)
5. Verify the test suite covers the changed code paths — passing unrelated tests is not validation
6. Commit fixes: `refactor: address code review findings`

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

</fix_and_report>

<pr_comment_policy>

## PR Comment Policy

After the review and any fixes, determine whether to post review comments on the PR/MR:

1. **Check for an open PR** on the current branch: `gh pr view --json number,author,url 2>/dev/null`
2. **Get the current user**: `gh api user -q '.login'`
3. **Compare**: If the PR author login **matches** the current user, do NOT post comments to the PR — the local fixes and summary are sufficient.
4. **If the PR was opened by someone else**, post a review comment on the PR summarizing the findings using `gh pr review {number} --comment --body "..."`. Include the issues found, fixes applied, and any remaining items that need the author's attention.

This avoids noisy self-comments on your own PRs while still providing feedback to other contributors.

</pr_comment_policy>
