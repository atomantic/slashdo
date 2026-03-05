   **Hygiene**
   - Leftover debug code (`console.log`, `debugger`, TODO/FIXME/HACK), hardcoded secrets/credentials, and uncommittable files (.env, node_modules, build artifacts)
   - Overly broad changes that should be split into separate PRs

   **Imports & references**
   - Every symbol used is imported (missing → runtime crash); no unused imports introduced

   **Runtime correctness**
   - Null/undefined access without guards, off-by-one errors, object spread of potentially-null values (spread of null is `{}`, silently discarding state)
   - Data from external/user sources (parsed JSON, API responses, file reads) used without structural validation — guard against parse failures, missing properties, wrong types, and null elements before accessing nested values. When parsed data is optional enrichment, isolate failures so they don't abort the main operation
   - Type coercion edge cases — `Number('')` is `0` not empty, `0` is falsy in truthy checks, `NaN` comparisons are always false; string comparison operators (`<`, `>`, `localeCompare`) do lexicographic, not semantic, ordering (e.g., `"10" < "2"`). Use explicit type checks (`Number.isFinite()`, `!= null`) and dedicated libraries (e.g., semver for versions) instead of truthy guards or lexicographic ordering when zero/empty are valid values or semantic ordering matters
   - Functions that index into arrays without guarding empty arrays; state/variables declared but never updated or only partially wired up
   - Shared mutable references — module-level defaults passed by reference mutate across calls (use `structuredClone()`/spread); `useCallback`/`useMemo` referencing a later `const` (temporal dead zone); object spread followed by unconditional assignment that clobbers spread values
   - Side effects during React render (setState, navigation, mutations outside useEffect)

   **Async & state consistency**
   - Optimistic state changes (view switches, navigation, success callbacks) before async completion — if the operation fails or is cancelled, the UI is stuck with no rollback. Check return values/errors before calling success callbacks. Handle both failure and cancellation paths. Watch for `.catch(() => null)` followed by unconditional success code (toast, state update) — the catch silences the error but the success path still runs. Either let errors propagate naturally or check the return value before proceeding
   - Multiple coupled state variables updated independently — actions that change one must update all related fields; debounced/cancelable operations must reset loading state on every exit path (cleared, stale, failed, aborted)
   - Error notification at multiple layers (shared API client + component-level) — verify exactly one layer owns user-facing error messages
   - Optimistic updates using full-collection snapshots for rollback — a second in-flight action gets clobbered. Use per-item rollback and functional state updaters after async gaps; sync optimistic changes to parent via callback or trigger refetch on remount
   - State updates guarded by truthiness of the new value (`if (arr?.length)`) — prevents clearing state when the source legitimately returns empty. Distinguish "no response" from "empty response"
   - Mutation/trigger functions that return or propagate stale pre-mutation state — if a function activates, updates, or resets an entity, the returned value and any dependent scheduling/evaluation state (backoff timers, "last run" timestamps, status flags) must reflect the post-mutation state, not a snapshot read before the mutation
   - Fire-and-forget or async writes where the in-memory object is not updated (response returns stale data) or is updated unconditionally regardless of write success (response claims state that was never persisted) — update in-memory state conditionally on write outcome, or document the tradeoff explicitly
   - Missing `await` on async operations in error/cleanup paths — fire-and-forget cleanup (e.g., aborting a failed operation, rolling back partial state) that must complete before the function returns or the caller proceeds
   - `Promise.all` without error handling — partial load with unhandled rejection. Wrap with fallback/error state

   **Resource management**
   - Event listeners, socket handlers, subscriptions, timers, and useEffect side effects are cleaned up on unmount/teardown
   - Deletion/destroy functions that clean up the primary resource but leave orphaned secondary resources (data directories, git branches, child records, temporary files) — trace all resources created during the entity's lifecycle and verify each is removed on delete
   - Initialization functions (schedulers, pollers, listeners) that don't guard against multiple calls — creates duplicate instances. Check for existing instances before reinitializing

   **Error handling**
   - Service functions throwing generic `Error` for client-caused conditions — bubbles as 500 instead of 400/404. Use typed error classes with explicit status codes; ensure consistent error responses across similar endpoints. Include expected concurrency/conditional failures (transaction cancellations, optimistic lock conflicts) — catch and translate to 409/retry rather than letting them surface as 500
   - Swallowed errors (empty `.catch(() => {})`), handlers that replace detailed failure info with generic messages, and error/catch handlers that exit cleanly (`exit 0`, `return`) without any user-visible output — surface a notification, propagate original context, and make failures look like failures
   - Destructive operations in retry/cleanup paths assumed to succeed without their own error handling — if cleanup fails, retry logic crashes instead of reporting the intended failure

   **API & URL safety**
   - User-supplied or system-generated values interpolated into URL paths, shell commands, file paths, or subprocess arguments without encoding/validation — use `encodeURIComponent()` for URLs, regex allowlists for execution boundaries. Generated identifiers used as URL path segments must be safe for your router/storage (no `/`, `?`, `#`; consider allowlisting characters and/or applying `encodeURIComponent()`). Identifiers derived from human-readable names (slugs) used for namespaced resources (git branches, directories) need a unique suffix (ID, hash) to prevent collisions between entities with the same or similar names
   - Route params passed to services without format validation; path containment checks using string prefix without path separator boundary (use `path.relative()`)
   - Error/fallback responses that hardcode security headers instead of using centralized policy — error paths bypass security tightening

   **Trust boundaries & data exposure**
   - API responses returning full objects with sensitive fields — destructure and omit across ALL response paths (GET, PUT, POST, error, socket); comments/docs claiming data isn't exposed while the code path does expose it
   - Server trusting client-provided computed/derived values (scores, totals, correctness flags) when the server can recompute them — strip and recompute server-side; don't require clients to submit fields the server should own
   - New endpoints mounted under restricted paths (admin, internal) missing authorization verification — compare with sibling endpoints in the same route group to ensure the same access gate (role check, scope validation) is applied consistently

   **Input handling**
   - Trimming values where whitespace is significant (API keys, tokens, passwords, base64) — only trim identifiers/names
   - Endpoints accepting unbounded arrays/collections without upper limits — enforce max size or move to background jobs

   **Validation & consistency**
   - New endpoints/schemas should match validation patterns of existing similar endpoints — field limits, required fields, types, error handling. If validation exists on one endpoint for a param, the same param on other endpoints needs the same validation
   - When a validation/sanitization function is introduced for a field, trace ALL write paths (create, update, sync, import) — partial application means invalid values re-enter through the unguarded path
   - Schema fields accepting values downstream code can't handle; Zod/schema stripping fields the service reads (silent `undefined`); config values persisted but silently ignored by the implementation — trace each field through schema → service → consumer. Update schemas derived from create schemas (e.g., `.partial()`) must also make nested object fields optional — shallow partial on a deeply-required schema rejects valid partial updates. Additionally, `.deepPartial()` or `.partial()` on schemas with `.default()` values will apply those defaults on update, silently overwriting existing persisted values with defaults — create explicit update schemas without defaults instead
   - Entity creation without case-insensitive uniqueness checks — names differing only in case (e.g., "MyAgent" vs "myagent") cause collisions in case-insensitive contexts (file paths, git branches, URLs). Normalize to lowercase before comparing
   - Handlers reading properties from framework-provided objects using field names the framework doesn't populate — silent `undefined`. Verify property names match the caller's contract
   - Data model fields that have different names depending on the creation/write path (e.g., `createdAt` vs `created`) — code referencing only one naming convention silently misses records created through other paths. Trace all write paths to discover the actual field names in use
   - Numeric values from strings used without `NaN`/type guards — `NaN` comparisons silently pass bounds checks. Clamp query params to safe lower bounds
   - UI elements hidden from navigation but still accessible via direct URL — enforce restrictions at the route level
   - Summary counters/accumulators that miss edge cases (removals, branch coverage, underflow on decrements — guard against going negative with lower-bound conditions); silent operations in verbose sequences where all branches should print status

   **Intent vs implementation**
   - Labels, comments, status messages, or documentation that describe behavior the code doesn't implement — e.g., a map named "renamed" that only deletes, or an action labeled "migrated" that never creates the target
   - Inline code examples, command templates, and query snippets that aren't syntactically valid as written — template placeholders must use a consistent format, queries must use correct syntax for their language (e.g., single `{}` in GraphQL, not `{{}}`)
   - Cross-references between files (identifiers, parameter names, format conventions, operational thresholds) that disagree — when one reference changes, trace all other files that reference the same entity and update them
   - Responsibility relocated from one module to another (e.g., writes moved from handler to middleware) without updating all consumers that depended on the old location's timing, return value, or side effects — trace callers that relied on the synchronous or co-located behavior and verify they still work with the new execution point. Remove dead code left behind at the old location
   - Sequential instructions or steps whose ordering doesn't match the required execution order — readers following in order will perform actions at the wrong time (e.g., "record X" in step 2 when X must be captured before step 1's action)
   - Sequential numbering (section numbers, step numbers) with gaps or jumps after edits — verify continuity
   - Completion markers, success flags, or status files written before the operation they attest to finishes — consumers see false success if the operation fails after the write
   - Existence checks (directory exists, file exists, module resolves) used as proof of correct/complete installation — a directory can exist but be empty, a file can exist with invalid contents. Verify the specific resource the consumer needs
   - Lookups that check only one scope when multiple exist — e.g., checking local git branches but not remote, checking in-memory cache but not persistent store. Trace all locations where the resource could exist and check each
   - Tracking/checkpoint files that default to empty on parse failure — causes full re-execution. Fail loudly instead
   - Registering references to resources without verifying the resource exists — dangling references after failed operations

   **Concurrency & data integrity**
   - Shared mutable state accessed by concurrent requests without locking or atomic writes; multi-step read-modify-write cycles that can interleave — use conditional writes/optimistic concurrency (e.g., condition expressions, version checks) to close the gap between read and write; if the conditional write fails, surface a retryable error instead of letting it bubble as a 500
   - Multi-table writes without a transaction — FK violations or errors leave partial state
   - Writes that replace an entire composite attribute (array, map, JSON blob) when the field is populated by multiple sources — the write discards data from other sources. Use a separate attribute, merge with the existing value, or use list/set append operations
   - Functions with early returns for "no primary fields to update" that silently skip secondary operations (relationship updates, link writes)
   - Functions that acquire shared state (locks, flags, markers) with exit paths that skip cleanup — leaves the system permanently locked. Trace all exit paths including error branches

   **Search & navigation**
   - Search results linking to generic list pages instead of deep-linking to the specific record
   - Search/query code hardcoding one backend's implementation when the system supports multiple — verify option/parameter names are mapped between backends

   **Sync & replication**
   - Upsert/`ON CONFLICT UPDATE` updating only a subset of exported fields — replicas diverge. Document deliberately omitted fields
   - Pagination using `COUNT(*)` (full table scan) instead of `limit + 1`; endpoints missing `next` token input/output; hard-capped limits silently truncating results
   - Batch/paginated API calls (database batch gets, external service calls) that don't handle partial results — unprocessed items, continuation tokens, or rate-limited responses silently dropped. Add retry loops with backoff for unprocessed items
   - Retry loops without backoff or max-attempt limits — tight loops under throttling extend latency indefinitely. Use bounded retries with exponential backoff/jitter

   **SQL & database**
   - Parameterized query placeholder indices must match parameter array positions — especially with shared param builders or computed indices
   - Database triggers clobbering explicitly-provided values; auto-incrementing columns that only increment on INSERT, not UPDATE
   - Full-text search with strict parsers (`to_tsquery`) on user input — use `websearch_to_tsquery` or `plainto_tsquery`
   - Dead queries (results never read), N+1 patterns inside transactions, O(n²) algorithms on growing data
   - `CREATE TABLE IF NOT EXISTS` as sole migration strategy — won't add columns/indexes on upgrade. Use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` or a migration framework
   - Functions/extensions requiring specific database versions without verification

   **Lazy initialization & module loading**
   - Cached state getters returning null before initialization — provide async initializer or ensure-style function
   - Module-level side effects (file reads, SDK init) without error handling — corrupted files crash the process on import
   - Bootstrap/resilience code that imports the dependencies it's meant to install — restructure so installation precedes resolution
   - Re-exporting from heavy modules defeats lazy loading — use lightweight shared modules

   **Data format portability**
   - Values crossing serialization boundaries may change format (arrays in JSON vs string literals in DB) — convert consistently
   - Reads issued immediately after writes to an eventually consistent store (database scans, replica reads, cache refreshes) may return stale data — use consistent-read options, compute from in-memory state after confirmed writes, or document the eventual-consistency window
   - BIGINT values parsed into JavaScript `Number` — precision lost past `MAX_SAFE_INTEGER`. Use strings or `BigInt`
   - Data model key/index design that doesn't support required query access patterns — e.g., claiming "recent" ordering but using non-time-sortable keys (random UUIDs, user IDs). Verify sort keys and indexes can serve the queries the code performs without full-partition scans and in-memory sorting

   **Shell & portability**
   - Subprocess calls under `set -e` abort on failure; non-critical writes fail on broken pipes — use `|| true` for non-critical output
   - Detached child processes with piped stdio — parent exit causes SIGPIPE. Redirect to log files or use `'ignore'`
   - Platform-specific assumptions — hardcoded shell interpreters, `path.join()` backslashes breaking ESM imports. Use `pathToFileURL()` for dynamic imports

   **Test coverage**
   - New logic/schemas/services without corresponding tests when similar existing code has tests
   - New error paths untestable because services throw generic errors instead of typed ones
   - Tests re-implementing logic under test instead of importing real exports — pass even when real code regresses
   - Tests depending on real wall-clock time or external dependencies when testing logic — use fake timers and mocks
   - Missing tests for trust-boundary enforcement — submit tampered values, verify server ignores them

   **Destructive UI operations**
   - Destructive actions (delete, reset, revoke) in the UI without a confirmation step — compare with how similar destructive operations elsewhere in the codebase handle confirmation

   **Accessibility**
   - Interactive elements missing accessible names, roles, or ARIA states — including disabled interactions without `aria-disabled`
   - Custom toggle/switch UI built from non-semantic elements instead of native inputs

   **Configuration & hardcoding**
   - Hardcoded values when a config field or env var already exists; dead config fields nothing consumes; unused function parameters creating false API contracts; resource names (table names, queue names, bucket names) hardcoded without accounting for environment prefixes — lookups on response objects using the wrong key silently return undefined
   - Duplicated config/constants/utilities/helper functions across modules — extract to shared module to prevent drift. Watch for behavioral inconsistencies between copies (e.g., one returns `'unknown'` for null while another returns `'never'`)
   - CI pipelines installing without lockfile pinning or version constraints — non-deterministic builds

   **Style & conventions**
   - Naming and patterns consistent with the rest of the codebase
   - Formatting consistency within each file — new content must match existing indentation, bullet style, heading levels, and structure
