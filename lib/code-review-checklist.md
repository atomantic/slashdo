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
   - `JSON.parse` on user-editable files (config, settings, cache) without error handling — corrupted files will crash the process
   - Accessing properties/methods on parsed JSON objects without verifying expected structure (e.g., `obj.arr.push()` when `arr` might not be an array)
   - Iterating arrays from external/user-editable sources without guarding each element — a `null` or wrong-type entry throws `TypeError` when treated as an object
   - Version/string comparisons using `!==` when semantic ordering matters — use proper semver comparison for version checks

   **Resource management**
   - Event listeners, socket handlers, subscriptions, and timers are cleaned up on unmount/teardown
   - useEffect cleanup functions remove everything the effect sets up

   **HTTP status codes & error classification**
   - Service functions that throw generic `Error` for client-caused conditions (not found, invalid input) — these bubble as 500 when they should be 400/404. Use typed error classes with explicit status codes
   - Consistent error responses across similar endpoints — if one validates, all should

   **API & URL safety**
   - User-supplied values interpolated into URL paths must use `encodeURIComponent()` — even if the UI restricts input, the API should be safe independently
   - Route params (`:name`, `:id`) passed to services without validation — add format checks (regex, length limits) at the route level

   **Data exposure**
   - API responses returning full objects that contain sensitive fields (secrets, tokens, passwords) — destructure and omit before sending. Check ALL response paths (GET, PUT, POST) not just one
   - Comments/docs claiming data is never exposed while the code path does expose it

   **Input handling**
   - Trimming values where whitespace is significant (API keys, tokens, passwords, base64) — only trim identifiers/names, not secret values
   - Swallowed errors (empty `.catch(() => {})`) that hide failures from users — at minimum surface a notification on failure

   **Validation & consistency**
   - New endpoints/schemas match validation standards of similar existing endpoints (check for field limits, required fields, types)
   - New API routes have the same error handling patterns as existing routes
   - If validation exists on one endpoint for a param, the same param on other endpoints needs the same validation
   - Schema fields that accept values the rest of the system can't handle (e.g., a field accepts any string but downstream code requires a specific format)
   - Summary counters/accumulators that miss edge cases — if an item is removed, is the count updated? Are all branches counted?
   - Silent operations in verbose sequences — when a series of operations each prints a status line, ensure all branches print consistent output

   **Concurrency & data integrity**
   - Shared mutable state (files, in-memory caches) accessed by concurrent requests without locking or atomic writes
   - Multi-step read-modify-write cycles on files or databases that can interleave with other requests

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

   **Lazy initialization & module loading**
   - Cached state getters that return `null`/`undefined` before the module is initialized — code that checks the cached value before triggering initialization will get incorrect results. Provide an async initializer or ensure-style function
   - Re-exporting constants from heavy modules defeats lazy loading — define shared constants in a lightweight module or inline them

   **Data format portability**
   - Values that cross serialization boundaries (JSON API → database, peer sync) may change format — e.g., arrays in JSON vs specialized string literals in the database. Convert consistently before writing to the target

   **Shell script safety**
   - Subprocess calls in shell scripts under `set -e` — if the subprocess fails, the script aborts. Check exit status and handle gracefully
   - When the same data structure is manipulated in both application code and shell-inline scripts, apply identical guards in both places

   **Cross-platform compatibility**
   - Shell-specific commands (e.g., `sleep`) in Node.js setup/build scripts — use language-native alternatives for portability

   **Test coverage**
   - New validation schemas, service functions, or business logic added without corresponding tests — especially when the project already has a test suite covering similar existing code
   - New error paths (404, 400) that are untestable because the service throws generic errors instead of typed/status-coded ones

   **Accessibility**
   - Interactive elements (buttons, toggles, custom controls) missing accessible names, roles, or ARIA states
   - Custom toggle/switch UI built from `<button>` or `<div>` instead of native inputs with appropriate labeling

   **Configuration & hardcoding**
   - Hardcoded values (usernames, org names, limits) when a config field or env var already exists for that purpose
   - Dead config fields that nothing reads — either wire them up or remove them
   - Duplicated config/constants across modules — extract to a single shared module to prevent drift (watch for circular imports when choosing the shared location)

   **Style & conventions**
   - Naming and patterns consistent with the rest of the codebase
   - Missing error handling at system boundaries (user input, external APIs)
