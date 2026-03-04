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
   - `JSON.parse` on user-editable or external files (config, settings, cache, package metadata) without error handling — corrupted files will crash the process. When the parsed data is optional enrichment (e.g., version info, display metadata), isolate the failure so it doesn't abort the main operation
   - Accessing properties/methods on parsed JSON objects without verifying expected structure (e.g., `obj.arr.push()` when `arr` might not be an array)
   - Iterating arrays from external/user-editable sources without guarding each element — a `null` or wrong-type entry throws `TypeError` when treated as an object
   - Version/string comparisons using `!==` when semantic ordering matters — use proper semver comparison for version checks
   - `Number('')` produces `0`, not empty — cleared numeric inputs must map to `undefined`/`null`, not `0`, which silently fails validation or sets wrong values
   - Truthy checks on numeric values where `0` is valid (e.g., `days || 365` treats `0` as falsy) — use `!= null` or explicit undefined checks instead
   - Functions that index into arrays (`arr[Math.floor(Math.random() * arr.length)]`) without guarding empty arrays — produces `undefined`/`NaN` when `arr.length === 0`
   - Module-level default/config objects passed by reference to consumers — shared mutation across calls. Use `structuredClone()` or spread when handing out defaults
   - `useCallback`/`useMemo` referencing a `const` declared later in the same function body — triggers temporal dead zone `ReferenceError`. Ensure dependency declarations appear before their dependents

   **Async & UI state consistency**
   - Optimistic UI state changes (view switches, navigation, success callbacks) before an async operation completes — if the operation fails, the UI is stuck in the wrong state with no rollback. Await the result and only transition on success
   - `Promise.all` without try/catch — if any request rejects, the UI ends up partially loaded with an unhandled rejection. Wrap in try/catch with fallback/error state so the view remains usable
   - Success callbacks (`onSaved()`, `onComplete()`) called unconditionally after an async call — check the return value or catch errors before calling the callback
   - Debounced/cancelable async operations that don't reset loading state on all code paths (input cleared, stale response arrives, request fails) — loading spinners get stuck and stale results display. Use AbortController or request IDs to discard outdated responses and clear loading in every exit path (including early returns)
   - Multiple UI state variables representing coupled data (coordinates + display name, selected item + dependent list) updated independently — actions that change one must update all related fields to prevent display/data mismatch

   **Resource management**
   - Event listeners, socket handlers, subscriptions, and timers are cleaned up on unmount/teardown
   - useEffect cleanup functions remove everything the effect sets up

   **HTTP status codes & error classification**
   - Service functions that throw generic `Error` for client-caused conditions (not found, invalid input) — these bubble as 500 when they should be 400/404. Use typed error classes with explicit status codes
   - Consistent error responses across similar endpoints — if one validates, all should

   **API & URL safety**
   - User-supplied values interpolated into URL paths must use `encodeURIComponent()` — even if the UI restricts input, the API should be safe independently
   - Route params (`:name`, `:id`) passed to services without validation — add format checks (regex, length limits) at the route level
   - Data from external APIs or upstream services interpolated into shell commands, file paths, or subprocess arguments without validation — enforce expected format (e.g., regex allowlist) before passing to execution boundaries

   **Data exposure**
   - API responses returning full objects that contain sensitive fields (secrets, tokens, passwords) — destructure and omit before sending. Check ALL response paths (GET, PUT, POST) not just one
   - Comments/docs claiming data is never exposed while the code path does expose it

   **Client/server trust boundary**
   - Server trusting client-provided computed/derived values (scores, totals, correctness flags) when the server has the data to recompute them — strip client-provided scoring/summary fields and recompute server-side
   - Validation schemas requiring clients to submit fields the server should own (e.g., `expected` answers, `correct` flags) — make these optional/omitted in submissions and derive them server-side
   - API responses leaking answer keys or expected values that the client will later submit back — either strip before responding or use server-side nonce/seed verification

   **Input handling**
   - Trimming values where whitespace is significant (API keys, tokens, passwords, base64) — only trim identifiers/names, not secret values
   - Swallowed errors (empty `.catch(() => {})`) that hide failures from users — at minimum surface a notification on failure

   **Validation & consistency**
   - New endpoints/schemas match validation standards of similar existing endpoints (check for field limits, required fields, types)
   - New API routes have the same error handling patterns as existing routes
   - If validation exists on one endpoint for a param, the same param on other endpoints needs the same validation
   - Schema fields that accept values the rest of the system can't handle (e.g., a field accepts any string but downstream code requires a specific format)
   - Zod/schema stripping fields the service actually reads — when Zod uses `.strict()` or strips unknown keys, any field the service reads from the validated object must be declared in the schema, otherwise it's silently `undefined`
   - Config values accepted by the API and persisted but silently ignored by the implementation — trace each config field through schema → service → generator/consumer to verify it's actually used (e.g., a `startRange` saved to config but the generator hardcodes a range)
   - Handlers/functions that read properties from framework-provided objects (request, event, context) using a field name the framework doesn't populate — results in silent `undefined`. Verify the property name matches the caller's contract, not just the handler's assumption
   - Numeric query params (`limit`, `offset`, `page`) parsed from strings without lower-bound clamping — `parseInt` can produce 0, negative, or `NaN` values that cause SQL errors or unexpected behavior. Always clamp to safe bounds (e.g., `Math.max(1, ...)`)
   - Summary counters/accumulators that miss edge cases — if an item is removed, is the count updated? Are all branches counted?
   - Silent operations in verbose sequences — when a series of operations each prints a status line, ensure all branches print consistent output
   - UI elements hidden from navigation (filtered tabs, conditional menu items) but still accessible via direct URL — enforce access restrictions at the route/handler level, not just visibility
   - Labels, comments, or status messages that describe behavior the code doesn't implement — e.g., a map named "renamed" that only deletes, or an action labeled "migrated" that never creates the target
   - Registering references (config entries, settings pointers) to files or resources without verifying the resource actually exists — a failed download or missing file leaves dangling references that break later operations
   - Error/catch handlers that exit cleanly (`exit 0`, `return`) without any user-visible output — makes failures look like successes; always print a skip/warning message explaining why the operation was skipped

   **Concurrency & data integrity**
   - Shared mutable state (files, in-memory caches) accessed by concurrent requests without locking or atomic writes
   - Multi-step read-modify-write cycles on files or databases that can interleave with other requests
   - Multi-table writes (e.g., parent row + relationship/link rows) without a transaction — FK violations or errors after the first insert leave partial state. Wrap all related writes in a single transaction
   - Functions with early returns for "no primary fields to update" that silently skip secondary operations (relationship updates, link table writes) — ensure early-return guards don't bypass logic that should run independently of primary field changes

   **Search & navigation**
   - Search results that link to generic list pages instead of deep-linking to the specific record — include the record type and ID in the URL
   - Search or query code that hardcodes one backend's implementation when the system supports multiple backends — use the active backend's capabilities so results aren't stale after a backend switch

   **Sync & replication**
   - Upsert/`ON CONFLICT UPDATE` clauses that only update a subset of the fields exported by the corresponding "get changes" query — omitted fields cause replicas to diverge. Deliberately omit only fields that should stay local (e.g., access stats), and document the decision
   - Pagination using `COUNT(*)` to compute `hasMore` — this forces a full table scan on large tables. Use the `limit + 1` pattern: fetch one extra row to detect more pages, return only `limit` rows

   **SQL & database**
   - Parameterized query placeholder indices (`$1`, `$2`, ...) must match the actual parameter array positions — especially when multiple queries share a param builder or when the index is computed dynamically
   - Database triggers (e.g., `BEFORE UPDATE` setting `updated_at = NOW()`) that clobber explicitly-provided values — verify triggers don't interfere with replication/sync that sets fields to remote timestamps
   - Auto-incrementing columns (`BIGSERIAL`, `SERIAL`) only auto-increment on INSERT, not UPDATE — if change-tracking relies on a sequence column, the UPDATE path must explicitly call `nextval()` to bump it
   - Database functions that require specific extensions or minimum versions — verify the deployment target supports them and the init script enables the extension
   - Full-text search with strict query parsers (`to_tsquery`) directly on user input — punctuation, quotes, and operators cause SQL errors. Use `websearch_to_tsquery` or `plainto_tsquery` for user-facing search
   - Query results assigned to variables but never read — remove dead queries to avoid unnecessary database load
   - N+1 query patterns inside transactions (SELECT + INSERT/UPDATE per row) — use batched upserts (`INSERT ... ON CONFLICT ... DO UPDATE`) to reduce round-trips and lock time

   **Lazy initialization & module loading**
   - Cached state getters that return `null`/`undefined` before the module is initialized — code that checks the cached value before triggering initialization will get incorrect results. Provide an async initializer or ensure-style function
   - Re-exporting constants from heavy modules defeats lazy loading — define shared constants in a lightweight module or inline them

   **Data format portability**
   - Values that cross serialization boundaries (JSON API → database, peer sync) may change format — e.g., arrays in JSON vs specialized string literals in the database. Convert consistently before writing to the target

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

   **Accessibility**
   - Interactive elements (buttons, toggles, custom controls) missing accessible names, roles, or ARIA states
   - Custom toggle/switch UI built from `<button>` or `<div>` instead of native inputs with appropriate labeling

   **Configuration & hardcoding**
   - Hardcoded values (usernames, org names, limits) when a config field or env var already exists for that purpose
   - Dead config fields that nothing reads — either wire them up or remove them
   - Function parameters that are accepted but never used — creates a false API contract; remove unused params or implement the intended behavior
   - Duplicated config/constants/utility helpers across modules — extract to a single shared module to prevent drift (watch for circular imports when choosing the shared location)

   **Style & conventions**
   - Naming and patterns consistent with the rest of the codebase
   - Missing error handling at system boundaries (user input, external APIs)
