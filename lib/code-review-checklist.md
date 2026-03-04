   **Hygiene**
   - Leftover debug code (`console.log`, `debugger`, TODO/FIXME/HACK comments)
   - Hardcoded secrets, API keys, or credentials
   - Files that shouldn't be committed (.env, node_modules, build artifacts)
   - Overly broad changes that should be split into separate PRs

   **Imports & references**
   - Every symbol used in the file is imported (missing imports → runtime crash)
   - No unused imports introduced by the changes

   **Runtime correctness**
   - State/variables that are declared but never updated or only partially wired up (e.g. a state setter that's never called)
   - Side effects during React render (setState, navigation, mutations outside useEffect)
   - Off-by-one errors, null/undefined access without guards
   - Object spread merging into a previous state value (`{ ...prev, ...update }`) without guarding `prev` against null — spread of null is `{}`, silently discarding all previous state instead of crashing visibly
   - `JSON.parse` on user-editable or external files (config, settings, cache, package metadata) without error handling — corrupted files will crash the process. When the parsed data is optional enrichment (e.g., version info, display metadata), isolate the failure so it doesn't abort the main operation
   - Accessing properties/methods on parsed JSON objects without verifying expected structure (e.g., `obj.arr.push()` when `arr` might not be an array)
   - Iterating arrays from external/user-editable sources without guarding each element — a `null` or wrong-type entry throws `TypeError` when treated as an object
   - Version/string comparisons using `!==` when semantic ordering matters — use proper semver comparison for version checks
   - `Number('')` produces `0`, not empty — cleared numeric inputs must map to `undefined`/`null`, not `0`, which silently fails validation or sets wrong values
   - Truthy checks on numeric values where `0` is valid (e.g., `days || 365` treats `0` as falsy) — use `!= null` or explicit undefined checks instead
   - Functions that index into arrays (`arr[Math.floor(Math.random() * arr.length)]`) without guarding empty arrays — produces `undefined`/`NaN` when `arr.length === 0`
   - Module-level default/config objects passed by reference to consumers — shared mutation across calls. Use `structuredClone()` or spread when handing out defaults
   - `useCallback`/`useMemo` referencing a `const` declared later in the same function body — triggers temporal dead zone `ReferenceError`. Ensure dependency declarations appear before their dependents
   - Object spread/merge followed by unconditional field assignment that clobbers spread values — e.g., `{...input.details, notes: notes || null}` silently overwrites `input.details.notes` even when `notes` is undefined. Only set fields when the overriding value is explicitly provided

   **Async & UI state consistency**
   - Optimistic UI state changes (view switches, navigation, success callbacks) before an async operation completes — if the operation fails or is cancelled (drag cancel, upload abort, form dismiss), the UI is stuck in the wrong state with no rollback. Handle both failure and cancellation paths to reset intermediate state
   - `Promise.all` without try/catch — if any request rejects, the UI ends up partially loaded with an unhandled rejection. Wrap in try/catch with fallback/error state so the view remains usable
   - Success callbacks (`onSaved()`, `onComplete()`) called unconditionally after an async call — check the return value or catch errors before calling the callback
   - Debounced/cancelable async operations that don't reset loading state on all code paths (input cleared, stale response arrives, request fails) — loading spinners get stuck and stale results display. Use AbortController or request IDs to discard outdated responses and clear loading in every exit path (including early returns)
   - Multiple UI state variables representing coupled data (coordinates + display name, selected item + dependent list) updated independently — actions that change one must update all related fields to prevent display/data mismatch
   - Error notification at multiple layers (shared API client that auto-displays errors + component-level error handling) — verify exactly one layer is responsible for user-facing error messages to avoid duplicate toasts/alerts. Suppress lower-layer notifications when the caller handles its own error display
   - Optimistic state updates using full-collection snapshots for rollback — if a second user action starts while the first is in-flight, rollback restores the snapshot and clobbers the second action's changes. Use per-item rollback and functional state updaters (`setState(prev => ...)`) after async gaps to avoid stale closures
   - Child components maintaining local copies of parent-provided data for optimistic updates without propagating changes back — on unmount/remount the parent's stale cache is re-rendered. Sync optimistic changes to the parent via callback alongside local state, or trigger a data refetch on remount
   - State or field updates guarded by truthiness of the new value (`if (arr?.length)`, `if (data)`, `if (remoteVersion)`) — prevents clearing state when the source legitimately returns an empty set or null. Distinguish "no response" from "empty response"; on both client (UI state) and server (sync/replication fields), conditionally skipping a field update leaves stale values that misrepresent current state

   **Resource management**
   - Event listeners, socket handlers, subscriptions, and timers are cleaned up on unmount/teardown
   - useEffect cleanup functions remove everything the effect sets up
   - Initialization functions (schedulers, timers, pollers, listeners) that don't guard against being called multiple times — creates duplicate instances running in parallel. Check for existing instances and either no-op or teardown before reinitializing

   **HTTP status codes & error classification**
   - Service functions that throw generic `Error` for client-caused conditions (not found, invalid input) — these bubble as 500 when they should be 400/404. Use typed error classes with explicit status codes
   - Consistent error responses across similar endpoints — if one validates, all should

   **API & URL safety**
   - User-supplied values interpolated into URL paths must use `encodeURIComponent()` — even if the UI restricts input, the API should be safe independently
   - Route params (`:name`, `:id`) passed to services without validation — add format checks (regex, length limits) at the route level
   - Data from external APIs or upstream services interpolated into shell commands, file paths, or subprocess arguments without validation — enforce expected format (e.g., regex allowlist) before passing to execution boundaries
   - Path containment checks using string prefix comparison (`resolvedPath.startsWith(baseDir)`) without a path separator boundary — `baseDir + "evil/..."` passes the check. Use `path.relative()` (reject if starts with `..`) or append `path.sep` to the base
   - Error/fallback responses that hardcode security headers (CORS, CSP) instead of using the centralized policy — error paths bypass security tightening applied to happy paths. Always reuse shared header middleware/constants

   **Data exposure**
   - API responses returning full objects that contain sensitive fields (secrets, tokens, passwords) — destructure and omit before sending. Check ALL response paths (GET, PUT, POST) not just one
   - Comments/docs claiming data is never exposed while the code path does expose it

   **Client/server trust boundary**
   - Server trusting client-provided computed/derived values (scores, totals, correctness flags) when the server has the data to recompute them — strip client-provided scoring/summary fields and recompute server-side
   - Validation schemas requiring clients to submit fields the server should own (e.g., `expected` answers, `correct` flags) — make these optional/omitted in submissions and derive them server-side
   - API responses leaking answer keys or expected values that the client will later submit back — either strip before responding or use server-side nonce/seed verification

   **Input handling**
   - Trimming values where whitespace is significant (API keys, tokens, passwords, base64) — only trim identifiers/names, not secret values
   - Swallowed errors (empty `.catch(() => {})`) or error handlers that replace detailed failure info with generic messages — at minimum surface a notification, and propagate original context (step name, exit code, original message) rather than discarding it
  - Destructive operations in retry/cleanup paths (`rmSync`, `dropTable`, `deleteFile`) assumed to succeed without their own error handling — if cleanup fails (file locks, permissions, concurrent access), the retry logic crashes with an unhandled error instead of reporting the intended failure message
   - Endpoints that accept unbounded arrays/collections without an upper limit — large payloads can exceed request timeouts, exhaust memory, or create DoS vectors. Enforce a max size and return 400 when exceeded, or move large operations to background jobs

   **Validation & consistency**
   - New endpoints/schemas match validation standards of similar existing endpoints (check for field limits, required fields, types)
   - New API routes have the same error handling patterns as existing routes
   - If validation exists on one endpoint for a param, the same param on other endpoints needs the same validation
  - When a sanitization or validation function is introduced for a field, trace ALL write paths for that field (create, update, sync, import) — partial application means the invalid values re-enter through the unguarded path
   - Schema fields that accept values the rest of the system can't handle (e.g., a field accepts any string but downstream code requires a specific format)
   - Zod/schema stripping fields the service actually reads — when Zod uses `.strict()` or strips unknown keys, any field the service reads from the validated object must be declared in the schema, otherwise it's silently `undefined`
   - Config values accepted by the API and persisted but silently ignored by the implementation — trace each config field through schema → service → generator/consumer to verify it's actually used (e.g., a `startRange` saved to config but the generator hardcodes a range)
   - Handlers/functions that read properties from framework-provided objects (request, event, context) using a field name the framework doesn't populate — results in silent `undefined`. Verify the property name matches the caller's contract, not just the handler's assumption
   - Numeric values parsed from strings (`parseInt`, `Number()`, `parseFloat`) used in comparisons or array indexing without `NaN`/type guards — `NaN` comparisons are always `false`, so bounds checks like `i < 0 || i >= len` silently pass. Use `Number.isFinite()` or `Number.isInteger()` before arithmetic. For query params (`limit`, `offset`, `page`), also clamp to safe lower bounds
   - Summary counters/accumulators that miss edge cases — if an item is removed, is the count updated? Are all branches counted?
   - Silent operations in verbose sequences — when a series of operations each prints a status line, ensure all branches print consistent output
   - UI elements hidden from navigation (filtered tabs, conditional menu items) but still accessible via direct URL — enforce access restrictions at the route/handler level, not just visibility
   - Labels, comments, or status messages that describe behavior the code doesn't implement — e.g., a map named "renamed" that only deletes, or an action labeled "migrated" that never creates the target
   - Success markers, completion flags, or status files written before the operation they attest to finishes — if the operation fails after the marker is written, consumers see false success. Write markers only after confirming the operation completed
   - Tracking/checkpoint files (applied migrations, processed IDs, sync cursors) that default to empty on parse failure — causes full re-execution of all operations. Fail loudly or require manual recovery instead of silently re-processing
   - Registering references (config entries, settings pointers) to files or resources without verifying the resource actually exists — a failed download or missing file leaves dangling references that break later operations
  - Existence checks (directory exists, file exists, module resolves) used as proof of correct or complete installation — a directory can exist but be empty/corrupt, a file can exist with invalid contents. Verify the specific resource the consumer needs (e.g., a critical binary or package manifest), not just the container
   - Error/catch handlers that exit cleanly (`exit 0`, `return`) without any user-visible output — makes failures look like successes; always print a skip/warning message explaining why the operation was skipped

   **Concurrency & data integrity**
   - Shared mutable state (files, in-memory caches) accessed by concurrent requests without locking or atomic writes
   - Multi-step read-modify-write cycles on files or databases that can interleave with other requests
   - Multi-table writes (e.g., parent row + relationship/link rows) without a transaction — FK violations or errors after the first insert leave partial state. Wrap all related writes in a single transaction
   - Functions with early returns for "no primary fields to update" that silently skip secondary operations (relationship updates, link table writes) — ensure early-return guards don't bypass logic that should run independently of primary field changes
   - Functions that acquire shared state (in-progress flags, locks, status markers) with early-return or error paths that skip cleanup — leaves the system permanently locked. Trace all exit paths (including platform-specific guards and error branches) to verify cleanup runs

   **Search & navigation**
   - Search results that link to generic list pages instead of deep-linking to the specific record — include the record type and ID in the URL
   - Search or query code that hardcodes one backend's implementation when the system supports multiple backends — use the active backend's capabilities so results aren't stale after a backend switch. Also check that option/parameter names are mapped between backends (e.g., `ftsWeight` vs `bm25Weight`) so configuration isn't silently ignored

   **Sync & replication**
   - Upsert/`ON CONFLICT UPDATE` clauses that only update a subset of the fields exported by the corresponding "get changes" query — omitted fields cause replicas to diverge. Deliberately omit only fields that should stay local (e.g., access stats), and document the decision
   - Pagination using `COUNT(*)` to compute `hasMore` — this forces a full table scan on large tables. Use the `limit + 1` pattern: fetch one extra row to detect more pages, return only `limit` rows
   - Pagination endpoints that return a `next` token but don't accept one as input (or vice versa) — clients can't retrieve pages beyond the first. Also check that hard-capped query limits (e.g., `Limit: 100`) don't silently truncate results when offset exceeds the cap

   **SQL & database**
   - Parameterized query placeholder indices (`$1`, `$2`, ...) must match the actual parameter array positions — especially when multiple queries share a param builder or when the index is computed dynamically
   - Database triggers (e.g., `BEFORE UPDATE` setting `updated_at = NOW()`) that clobber explicitly-provided values — verify triggers don't interfere with replication/sync that sets fields to remote timestamps
   - Auto-incrementing columns (`BIGSERIAL`, `SERIAL`) only auto-increment on INSERT, not UPDATE — if change-tracking relies on a sequence column, the UPDATE path must explicitly call `nextval()` to bump it
   - Database functions that require specific extensions or minimum versions — verify the deployment target supports them and the init script enables the extension
   - Full-text search with strict query parsers (`to_tsquery`) directly on user input — punctuation, quotes, and operators cause SQL errors. Use `websearch_to_tsquery` or `plainto_tsquery` for user-facing search
   - Query results assigned to variables but never read — remove dead queries to avoid unnecessary database load
   - N+1 query patterns inside transactions (SELECT + INSERT/UPDATE per row) — use batched upserts (`INSERT ... ON CONFLICT ... DO UPDATE`) to reduce round-trips and lock time
   - `CREATE TABLE IF NOT EXISTS` used as the sole schema migration strategy — it won't add new columns, indexes, or triggers to existing tables on upgrade. Use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` or a migration framework for schema evolution
   - O(n²) algorithms (self-joins, all-pairs comparisons, nested loops over full tables) triggered per-request on data that grows over time — these become prohibitive at scale. Add caps, use indexed lookups, or move to background jobs

   **Lazy initialization & module loading**
   - Cached state getters that return `null`/`undefined` before the module is initialized — code that checks the cached value before triggering initialization will get incorrect results. Provide an async initializer or ensure-style function
   - Re-exporting constants from heavy modules defeats lazy loading — define shared constants in a lightweight module or inline them
   - Module-level side effects (file reads, JSON.parse, SDK client init) that run on import without error handling — a corrupted file or missing credential crashes the entire process before any request is served. Wrap module-level init in try/catch and degrade gracefully
  - Bootstrap/resilience code that resolves or imports the dependencies it's meant to install — if the dependency is missing, the bootstrapper crashes before it can act. Structure so prerequisite resolution happens after the installation/verification step, not before

   **Data format portability**
   - Values that cross serialization boundaries (JSON API → database, peer sync) may change format — e.g., arrays in JSON vs specialized string literals in the database. Convert consistently before writing to the target
   - Database BIGINT/BIGSERIAL values parsed into JavaScript `Number` via `parseInt` or `Number()` — precision is lost past `Number.MAX_SAFE_INTEGER`, silently corrupting IDs, sequence cursors, or pagination tokens. Use string representation or `BigInt` for large integer columns

   **Shell script safety**
   - Subprocess calls in shell scripts under `set -e` — if the subprocess fails, the script aborts. Also check non-critical writes (e.g., `echo` to stdout) which fail on broken pipes and trigger exit — use `|| true` for non-critical output
   - Detached/background child processes spawned with piped stdio — if the parent exits (restart, crash), pipes close and writes cause SIGPIPE. Redirect stdio to log files or use `'ignore'` for children that must outlive the parent
   - When the same data structure is manipulated in both application code and shell-inline scripts, apply identical guards in both places

   **Cross-platform compatibility**
   - Platform-specific execution assumptions — hardcoded shell interpreters (`bash`, `sh`), `path.join()` producing backslashes that break ESM `import()` or URL-based APIs on Windows, platform-gated scripts without fallback or clear error. Use `pathToFileURL()` for dynamic imports, check `process.platform` for shell dispatch

   **Test coverage**
   - New validation schemas, service functions, or business logic added without corresponding tests — especially when the project already has a test suite covering similar existing code
   - New error paths (404, 400) that are untestable because the service throws generic errors instead of typed/status-coded ones
   - Tests that re-implement the logic under test instead of importing real exports — these pass even when the real code regresses. Import and call the actual functions
   - Missing tests for trust-boundary enforcement — if the server strips/recomputes client-provided fields, add a test that submits tampered values and verifies the server ignores them
   - Tests that depend on real wall-clock time (`setTimeout`, `Date.now`, network delays) for rate limiters, debounce, or scheduling — slow under normal conditions and flaky under CI load. Use fake timers or time mocking
  - Tests that hit real external dependencies (databases, process managers, network services) when testing response shape or business logic — mock the dependency and assert the contract, keeping unit tests fast and deterministic

   **Accessibility**
   - Interactive elements (buttons, toggles, custom controls) missing accessible names, roles, or ARIA states — including programmatically disabled interactions that don't reflect the disabled state visually or via `aria-disabled` (e.g., drag handles that appear interactive but are inert during async operations)
   - Custom toggle/switch UI built from `<button>` or `<div>` instead of native inputs with appropriate labeling

   **Configuration & hardcoding**
   - Hardcoded values (usernames, org names, limits) when a config field or env var already exists for that purpose
   - Dead config fields, event subscriptions, or wire-up code that nothing consumes — either connect consumers or remove to avoid maintenance burden and false expectations
   - Function parameters that are accepted but never used — creates a false API contract; remove unused params or implement the intended behavior
   - Duplicated config/constants/utility helpers across modules — extract to a single shared module to prevent drift (watch for circular imports when choosing the shared location)
   - CI pipelines that install dependencies without lockfile pinning (`npm install` instead of `npm ci`) or that ad-hoc install packages without version constraints — creates non-deterministic builds that can break unpredictably

   **Style & conventions**
   - Naming and patterns consistent with the rest of the codebase
   - Missing error handling at system boundaries (user input, external APIs)
