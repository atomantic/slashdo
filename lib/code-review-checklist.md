<!--
  Triage: Check Tiers 1 and 4 for every file. Check Tier 2/3 only when
  the relevance filter matches the changed code. This prevents important
  checks from being lost in a long list.
-->

## Tier 1 — Always Check (Runtime Crashes, Security, Hygiene)

   **Hygiene**
   - Leftover debug code (`console.log`, `debugger`, TODO/FIXME/HACK), hardcoded secrets/credentials, and uncommittable files (.env, node_modules, build artifacts)
   - Overly broad changes that should be split into separate PRs

   **Imports & references**
   - Every symbol used is imported (missing → runtime crash); no unused imports introduced

   **Runtime correctness**
   - Null/undefined access without guards, off-by-one errors, object spread of potentially-null values (spread of null is `{}`, silently discarding state)
   - Data from external/user sources (parsed JSON, API responses, file reads) used without structural validation — guard against parse failures, missing properties, wrong types, and null elements before accessing nested values. When parsed data is optional enrichment, isolate failures so they don't abort the main operation
   - Type coercion edge cases — `Number('')` is `0` not empty, `0` is falsy in truthy checks, `NaN` comparisons are always false; string comparison operators (`<`, `>`, `localeCompare`) do lexicographic, not semantic, ordering (e.g., `"10" < "2"`). Use explicit type checks (`Number.isFinite()`, `!= null`) and dedicated libraries (e.g., semver for versions) instead of truthy guards or lexicographic ordering when zero/empty are valid values or semantic ordering matters
   - Functions that index into arrays without guarding empty arrays; aggregate operations (`every`, `some`, `reduce`) on potentially-empty collections returning vacuously true/default values that mask misconfiguration or missing data; state/variables declared but never updated or only partially wired up
   - Shared mutable references — module-level defaults passed by reference mutate across calls (use `structuredClone()`/spread); `useCallback`/`useMemo` referencing a later `const` (temporal dead zone); object spread followed by unconditional assignment that clobbers spread values
   - Functions with >10 branches or >15 cyclomatic complexity — refactor into smaller units

   **API & URL safety**
   - User-supplied or system-generated values interpolated into URL paths, shell commands, file paths, or subprocess arguments without encoding/validation — use `encodeURIComponent()` for URLs, regex allowlists for execution boundaries. Generated identifiers used as URL path segments must be safe for your router/storage (no `/`, `?`, `#`; consider allowlisting characters and/or applying `encodeURIComponent()`). Identifiers derived from human-readable names (slugs) used for namespaced resources (git branches, directories) need a unique suffix (ID, hash) to prevent collisions between entities with the same or similar names
   - Route params passed to services without format validation; path containment checks using string prefix without path separator boundary (use `path.relative()`)
   - Parameterized/wildcard routes registered before specific named routes — the generic route captures requests meant for the specific endpoint (e.g., `/:id` registered before `/drafts` matches `/drafts` as `id="drafts"`). Verify route registration order or use path prefixes to disambiguate
   - Stored or external URLs rendered as clickable links (`href`, `src`, `window.open`) without protocol validation — `javascript:`, `data:`, and `vbscript:` URLs execute in the user's browser. Allowlist `http:`/`https:` (and `mailto:` if needed) before rendering; for all other schemes, render as plain text or strip the value
   - Error/fallback responses that hardcode security headers instead of using centralized policy — error paths bypass security tightening

   **Trust boundaries & data exposure**
   - API responses returning full objects with sensitive fields — destructure and omit across ALL response paths (GET, PUT, POST, error, socket); comments/docs claiming data isn't exposed while the code path does expose it
   - Server trusting client-provided computed/derived values (scores, totals, correctness flags) when the server can recompute them — strip and recompute server-side; don't require clients to submit fields the server should own
   - New endpoints mounted under restricted paths (admin, internal) missing authorization verification — compare with sibling endpoints in the same route group to ensure the same access gate (role check, scope validation) is applied consistently

## Tier 2 — Check When Relevant (Data Integrity, Async, Error Handling)

   **Async & state consistency** _[applies when: code uses async/await, Promises, or UI state]_
   - Optimistic state changes (view switches, navigation, success callbacks) before async completion — if the operation fails or is cancelled, the UI is stuck with no rollback. Check return values/errors before calling success callbacks. Handle both failure and cancellation paths. Watch for `.catch(() => null)` followed by unconditional success code (toast, state update) — the catch silences the error but the success path still runs. Either let errors propagate naturally or check the return value before proceeding
   - Multiple coupled state variables updated independently — actions that change one must update all related fields; debounced/cancelable operations must reset loading state on every exit path (cleared, stale, failed, aborted)
   - Error notification at multiple layers (shared API client + component-level) — verify exactly one layer owns user-facing error messages
   - Optimistic updates using full-collection snapshots for rollback — a second in-flight action gets clobbered. Use per-item rollback and functional state updaters after async gaps; sync optimistic changes to parent via callback or trigger refetch on remount
   - State updates guarded by truthiness of the new value (`if (arr?.length)`) — prevents clearing state when the source legitimately returns empty. Distinguish "no response" from "empty response"
   - Mutation/trigger functions that return or propagate stale pre-mutation state — if a function activates, updates, or resets an entity, the returned value and any dependent scheduling/evaluation state (backoff timers, "last run" timestamps, status flags) must reflect the post-mutation state, not a snapshot read before the mutation
   - Fire-and-forget or async writes where the in-memory object is not updated (response returns stale data) or is updated unconditionally regardless of write success (response claims state that was never persisted) — update in-memory state conditionally on write outcome, or document the tradeoff explicitly. Also applies to responses and business-logic decisions (threshold triggers, status transitions) derived from pre-transaction reads — concurrent writers all read the same stale value, so thresholds may be crossed without triggering the transition. Compute from post-write state or use conditional expressions that evaluate the stored value
   - Error/early-exit paths that return status metadata (pagination flags, truncation indicators, hasMore, completion markers) or emit events (WebSocket, SSE, pub/sub) with default/initial values instead of reflecting actual accumulated state — downstream consumers make incorrect decisions (e.g., treating a failed sync as successful because the completion event was emitted unconditionally). Set metadata flags and event payloads based on actual outcome, not just the final request's exit path
   - Missing `await` on async operations in error/cleanup paths — fire-and-forget cleanup (e.g., aborting a failed operation, rolling back partial state) that must complete before the function returns or the caller proceeds
   - `Promise.all` without error handling — partial load with unhandled rejection. Wrap with fallback/error state
   - Sequential processing of items (loops over external operations, batch mutations) where one item throwing aborts all remaining items — wrap per-item operations in try/catch with logging so partial progress is preserved and failures are isolated
   - Side effects during React render (setState, navigation, mutations outside useEffect)

   **Error handling** _[applies when: code has try/catch, .catch, error responses, or external calls]_
   - Service functions throwing generic `Error` for client-caused conditions — bubbles as 500 instead of 400/404. Use typed error classes with explicit status codes; ensure consistent error responses across similar endpoints. Include expected concurrency/conditional failures (transaction cancellations, optimistic lock conflicts) — catch and translate to 409/retry rather than letting them surface as 500
   - Swallowed errors (empty `.catch(() => {})`), handlers that replace detailed failure info with generic messages, and error/catch handlers that exit cleanly (`exit 0`, `return`) without any user-visible output — surface a notification, propagate original context, and make failures look like failures. Includes external service wrappers that return `null`/empty for all non-success responses — collapsing configuration errors (missing API key), auth failures (403), rate limits (429), and server errors (5xx) into a single "not found" return masks outages and misconfiguration as normal "no match" results. Distinguish retriable from non-retriable failures and surface infrastructure errors loudly
   - Destructive operations in retry/cleanup paths assumed to succeed without their own error handling — if cleanup fails, retry logic crashes instead of reporting the intended failure
   - External service calls without configurable timeouts — a hung downstream service blocks the caller indefinitely
   - Missing fallback behavior when downstream services are unavailable (see also: retry without backoff in "Sync & replication")

   **Resource management** _[applies when: code uses event listeners, timers, subscriptions, or useEffect]_
   - Event listeners, socket handlers, subscriptions, timers, and useEffect side effects are cleaned up on unmount/teardown
   - Deletion/destroy and state-reset functions that clean up or reset the primary resource but leave orphaned or inconsistent secondary resources (data directories, git branches, child records, temporary files, per-user flag/vote items) — trace all resources created during the entity's lifecycle and verify each is removed on delete. For state transitions that reset aggregate values (counters, scores, flags), also clear or version the individual records that contributed to those aggregates — otherwise the aggregate and its sources disagree, and duplicate-prevention checks block legitimate re-entry
   - Initialization functions (schedulers, pollers, listeners) that don't guard against multiple calls — creates duplicate instances. Check for existing instances before reinitializing

   **Validation & consistency** _[applies when: code handles user input, schemas, or API contracts]_
   - API versioning: breaking changes to public endpoints without version bump or deprecation path
   - Backward-incompatible response shape changes without client migration plan
   - Backward compatibility breaking changes — renamed/removed config keys, changed file formats, altered DB schemas, modified event payloads, or restructured persisted data (localStorage, files, database rows) without a migration path or fallback that reads the old format. Trace all consumers of the changed contract (other services, CLI versions, stored data) and verify they still work or have an upgrade path. For schema changes, require a migration script; for config/format changes, support both old and new formats during a transition period or provide a one-time converter
   - New endpoints/schemas should match validation patterns of existing similar endpoints — field limits, required fields, types, error handling. If validation exists on one endpoint for a param, the same param on other endpoints needs the same validation
   - When a validation/sanitization function is introduced for a field, trace ALL write paths (create, update, sync, import) — partial application means invalid values re-enter through the unguarded path
   - Schema fields accepting values downstream code can't handle; Zod/schema stripping fields the service reads (silent `undefined`); config values persisted but silently ignored by the implementation — trace each field through schema → service → consumer. Update schemas derived from create schemas (e.g., `.partial()`) must also make nested object fields optional — shallow partial on a deeply-required schema rejects valid partial updates. Additionally, `.deepPartial()` or `.partial()` on schemas with `.default()` values will apply those defaults on update, silently overwriting existing persisted values with defaults — create explicit update schemas without defaults instead
   - Entity creation without case-insensitive uniqueness checks — names differing only in case (e.g., "MyAgent" vs "myagent") cause collisions in case-insensitive contexts (file paths, git branches, URLs). Normalize to lowercase before comparing
   - Handlers reading properties from framework-provided objects or internal abstraction layers using field names the source doesn't populate or forward — silent `undefined`. Verify property names match the caller's contract. When branching on fields from a wrapped third-party API, confirm the wrapper actually requests and forwards those fields (e.g., optional response attributes that require explicit opt-in)
   - Data model fields that have different names depending on the creation/write path (e.g., `createdAt` vs `created`) — code referencing only one naming convention silently misses records created through other paths. Trace all write paths to discover the actual field names in use
   - Inconsistent "missing value" semantics across layers — one layer treats `null`/`undefined` as missing while another also treats empty strings or whitespace-only strings as missing. Query filters, update expressions, and UI predicates that disagree on what constitutes "missing" cause records to be skipped by one path but processed by another. Define a single `isMissing` predicate and use it consistently, or normalize empty/whitespace values to `null` at write time
   - Numeric values from strings used without `NaN`/type guards — `NaN` comparisons silently pass bounds checks. Clamp query params to safe lower bounds
   - UI elements hidden from navigation but still accessible via direct URL — enforce restrictions at the route level
   - Summary counters/accumulators that miss edge cases (removals, branch coverage, underflow on decrements — guard against going negative with lower-bound conditions); silent operations in verbose sequences where all branches should print status

   **Concurrency & data integrity** _[applies when: code has shared state, database writes, or multi-step mutations]_
   - Shared mutable state accessed by concurrent requests without locking or atomic writes; multi-step read-modify-write cycles that can interleave — use conditional writes/optimistic concurrency (e.g., condition expressions, version checks) to close the gap between read and write; if the conditional write fails, surface a retryable error instead of letting it bubble as a 500
   - Multi-table writes without a transaction — FK violations or errors leave partial state
   - Writes that replace an entire composite attribute (array, map, JSON blob) when the field is populated by multiple sources — the write discards data from other sources. Use a separate attribute, merge with the existing value, or use list/set append operations
   - Functions with early returns for "no primary fields to update" that silently skip secondary operations (relationship updates, link writes)
   - Functions that acquire shared state (locks, flags, markers) with exit paths that skip cleanup — leaves the system permanently locked. Trace all exit paths including error branches

   **Input handling** _[applies when: code accepts user/external input]_
   - Trimming values where whitespace is significant (API keys, tokens, passwords, base64) — only trim identifiers/names
   - Endpoints accepting unbounded arrays/collections without upper limits — enforce max size or move to background jobs

## Tier 3 — Domain-Specific (Check Only When File Type Matches)

   **SQL & database** _[applies when: code contains SQL, ORM queries, or migration files]_
   - Parameterized query placeholder indices must match parameter array positions — especially with shared param builders or computed indices
   - Database triggers clobbering explicitly-provided values; auto-incrementing columns that only increment on INSERT, not UPDATE
   - Full-text search with strict parsers (`to_tsquery`) on user input — use `websearch_to_tsquery` or `plainto_tsquery`
   - Dead queries (results never read), N+1 patterns inside transactions, O(n²) algorithms on growing data
   - `CREATE TABLE IF NOT EXISTS` as sole migration strategy — won't add columns/indexes on upgrade. Use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` or a migration framework
   - Functions/extensions requiring specific database versions without verification
   - Migrations that lock tables for extended periods (ADD COLUMN with default on large tables, CREATE INDEX without CONCURRENTLY) — use concurrent operations or batched backfills
   - Missing rollback/down migration or untested rollback path

   **Sync & replication** _[applies when: code uses pagination, batch APIs, or data sync]_
   - Upsert/`ON CONFLICT UPDATE` updating only a subset of exported fields — replicas diverge. Document deliberately omitted fields
   - Pagination using `COUNT(*)` (full table scan) instead of `limit + 1`; endpoints missing `next` token input/output; hard-capped limits silently truncating results
   - Batch/paginated API calls (database batch gets, external service calls) that don't handle partial results — unprocessed items, continuation tokens, or rate-limited responses silently dropped. Add retry loops with backoff for unprocessed items
   - Retry loops without backoff or max-attempt limits — tight loops under throttling extend latency indefinitely. Use bounded retries with exponential backoff/jitter

   **Lazy initialization & module loading** _[applies when: code uses dynamic imports, lazy singletons, or bootstrap sequences]_
   - Cached state getters returning null before initialization — provide async initializer or ensure-style function
   - Module-level side effects (file reads, SDK init) without error handling — corrupted files crash the process on import
   - Bootstrap/resilience code that imports the dependencies it's meant to install — restructure so installation precedes resolution
   - Re-exporting from heavy modules defeats lazy loading — use lightweight shared modules

   **Data format portability** _[applies when: code crosses serialization boundaries — JSON, DB, IPC]_
   - Values crossing serialization boundaries may change format (arrays in JSON vs string literals in DB) — convert consistently
   - Reads issued immediately after writes to an eventually consistent store (database scans, replica reads, cache refreshes) may return stale data — use consistent-read options, compute from in-memory state after confirmed writes, or document the eventual-consistency window
   - BIGINT values parsed into JavaScript `Number` — precision lost past `MAX_SAFE_INTEGER`. Use strings or `BigInt`
   - Data model key/index design that doesn't support required query access patterns — e.g., claiming "recent" ordering but using non-time-sortable keys (random UUIDs, user IDs). Verify sort keys and indexes can serve the queries the code performs without full-partition scans and in-memory sorting

   **Shell & portability** _[applies when: code spawns subprocesses, uses shell scripts, or builds CLI tools]_
   - Subprocess calls under `set -e` abort on failure; non-critical writes fail on broken pipes — use `|| true` for non-critical output
   - Detached child processes with piped stdio — parent exit causes SIGPIPE. Redirect to log files or use `'ignore'`
   - Platform-specific assumptions — hardcoded shell interpreters, `path.join()` backslashes breaking ESM imports. Use `pathToFileURL()` for dynamic imports

   **Search & navigation** _[applies when: code implements search results or deep-linking]_
   - Search results linking to generic list pages instead of deep-linking to the specific record
   - Search/query code hardcoding one backend's implementation when the system supports multiple — verify option/parameter names are mapped between backends

   **Destructive UI operations** _[applies when: code adds delete, reset, revoke, or other destructive actions]_
   - Destructive actions (delete, reset, revoke) in the UI without a confirmation step — compare with how similar destructive operations elsewhere in the codebase handle confirmation

   **Accessibility** _[applies when: code modifies UI components or interactive elements]_
   - Interactive elements missing accessible names, roles, or ARIA states — including disabled interactions without `aria-disabled`
   - Custom toggle/switch UI built from non-semantic elements instead of native inputs

## Tier 4 — Always Check (Quality, Conventions, AI-Generated Code)

   **Intent vs implementation**
   - Labels, comments, status messages, or documentation that describe behavior the code doesn't implement — e.g., a map named "renamed" that only deletes, or an action labeled "migrated" that never creates the target
   - Inline code examples, command templates, and query snippets that aren't syntactically valid as written — template placeholders must use a consistent format, queries must use correct syntax for their language (e.g., single `{}` in GraphQL, not `{{}}`)
   - Cross-references between files (identifiers, parameter names, format conventions, version numbers, operational thresholds) that disagree — when one reference changes, trace all other files that reference the same entity and update them. For releases, verify version consistency across all versioned artifacts (package manifests, lockfiles, API specs, changelogs, PR metadata). Also applies to field-set enumerations: when an operation targets a set of entity fields, every predicate, filter expression, scan criteria, API doc, and UI conditional that enumerates those fields must stay in sync — an independently maintained list that omits a field causes silent skips or false positives
   - Template/workflow variables referenced (`{VAR_NAME}`) but never assigned — trace each placeholder to a definition step; undefined variables cause silent failures or confusing instructions. Also check for colliding identifiers (two distinct concepts mapped to the same slug, key, or name)
   - Responsibility relocated from one module to another (e.g., writes moved from handler to middleware) without updating all consumers that depended on the old location's timing, return value, or side effects — trace callers that relied on the synchronous or co-located behavior and verify they still work with the new execution point. Remove dead code left behind at the old location
   - Sequential instructions or steps whose ordering doesn't match the required execution order — readers following in order will perform actions at the wrong time (e.g., "record X" in step 2 when X must be captured before step 1's action)
   - Sequential numbering (section numbers, step numbers) with gaps or jumps after edits — verify continuity
   - Completion markers, success flags, or status files written before the operation they attest to finishes — consumers see false success if the operation fails after the write
   - Existence checks (directory exists, file exists, module resolves) used as proof of correct/complete installation — a directory can exist but be empty, a file can exist with invalid contents. Verify the specific resource the consumer needs
   - Lookups that check only one scope when multiple exist — e.g., checking local git branches but not remote, checking in-memory cache but not persistent store. Trace all locations where the resource could exist and check each
   - Tracking/checkpoint files that default to empty on parse failure — causes full re-execution. Fail loudly instead
   - Registering references to resources without verifying the resource exists — dangling references after failed operations

   **Automated pipeline discipline**
   - Internal code review must run on all automated remediation changes BEFORE creating PRs — never go straight from "tests pass" to PR creation
   - Copilot review must complete (approved or commented) on all PRs before merging — never merge while reviews are still pending unless the user explicitly approves
   - Automated agents may introduce subtle issues that pass tests but violate project conventions — review agent output against CLAUDE.md conventions

   **AI-generated code quality** _(Claude 4.6 specific failure modes)_
   - Over-engineering: new abstractions, wrapper functions, helper files, or utility modules that serve only one call site — inline the logic instead
   - Feature flags, configuration options, or extension points with only one possible value or consumer
   - Commit messages or comments claiming a fix while the underlying bug remains — verify each claimed fix actually addresses the root cause, not just the symptom
   - Functions containing placeholder comments (`// TODO`, `// FIXME`, `// implement later`) or stub implementations presented as complete
   - Unnecessary defensive code: error handling for scenarios that provably cannot occur given the call site, fallbacks for internal functions that always return valid data

   **Configuration & hardcoding**
   - Hardcoded values when a config field or env var already exists; dead config fields nothing consumes; unused function parameters creating false API contracts; resource names (table names, queue names, bucket names) hardcoded without accounting for environment prefixes — lookups on response objects using the wrong key silently return undefined
   - Duplicated config/constants/utilities/helper functions across modules — extract to shared module to prevent drift. Watch for behavioral inconsistencies between copies (e.g., one returns `'unknown'` for null while another returns `'never'`)
   - CI pipelines installing without lockfile pinning or version constraints — non-deterministic builds
   - Production code paths with no structured logging at entry/exit points
   - Error logs missing reproduction context (request ID, input parameters)
   - Async flows without correlation ID propagation

   **Supply chain & dependency health**
   - Lockfile committed and CI uses `--frozen-lockfile`; no lockfile drift from manifest
   - `npm audit` / `cargo audit` / `pip-audit` has no unaddressed HIGH/CRITICAL vulnerabilities
   - No `postinstall` scripts from untrusted packages executing arbitrary code without review
   - Overly permissive version ranges (`*`, `>=`) on deps with known breaking-change history

   **Test coverage**
   - New logic/schemas/services without corresponding tests when similar existing code has tests
   - New error paths untestable because services throw generic errors instead of typed ones
   - Tests re-implementing logic under test instead of importing real exports — pass even when real code regresses
   - Tests depending on real wall-clock time or external dependencies when testing logic — use fake timers and mocks
   - Missing tests for trust-boundary enforcement — submit tampered values, verify server ignores them
   - Tests that exercise code paths depending on features the integration layer doesn't expose — they pass against mocks but the behavior can't trigger in production. Verify mocked responses match what the real dependency actually returns
   - Tests that pass but don't cover the changed code paths — passing unrelated tests is not validation

   **Style & conventions**
   - Naming and patterns consistent with the rest of the codebase
   - Formatting consistency within each file — new content must match existing indentation, bullet style, heading levels, and structure
