   **Hygiene**
   - Leftover debug code (console.log without emoji prefix, debugger, TODO/FIXME/HACK)
   - Hardcoded secrets, API keys, or credentials
   - Files that shouldn't be committed (.env, node_modules, build artifacts)
   - Overly broad changes that should be split into separate PRs

   **Imports & references**
   - Every symbol used in the file is imported (missing imports → runtime crash)
   - No unused imports introduced by the changes

   **Runtime correctness**
   - State/variables that are declared but never updated or only partially wired up (e.g. a state setter that's never called with `true`)
   - Side effects during React render (setState, navigation, mutations outside useEffect)
   - Off-by-one errors, null/undefined access without guards
   - `JSON.parse` on user-editable files (config, settings, cache) without try/catch — corrupted files will crash the process
   - Accessing properties/methods on objects from parsed JSON without verifying the expected structure (e.g., `obj.arr.push()` when `arr` might not be an array)
   - Version/string comparisons using `!==` when semantic ordering matters — use proper semver comparison for version checks

   **Resource management**
   - Event listeners, socket handlers, subscriptions, and timers are cleaned up on unmount/teardown
   - useEffect cleanup functions remove everything the effect sets up

   **HTTP status codes & error classification**
   - Service functions that throw generic `Error` for client-caused conditions (not found, invalid input) — these bubble as 500 when they should be 400/404. Use the project's error class (e.g., `ServerError`, `HttpError`, `createError`) with explicit status codes
   - Consistent error responses across similar endpoints — if one validates, all should

   **API & URL safety**
   - User-supplied values interpolated into URL paths must use `encodeURIComponent()` — even if the UI restricts input, the API should be safe independently
   - Route params (`:name`, `:id`) passed to services without validation — add format checks (regex, length limits) at the route level

   **Data exposure**
   - API responses returning full objects that contain sensitive fields (secrets, tokens, passwords) — destructure and omit before sending. Check ALL response paths (GET, PUT, POST) not just one
   - Comments/docs claiming data is never exposed while the code path does expose it

   **Input handling**
   - Trimming values where whitespace is significant (API keys, tokens, passwords, base64) — only trim identifiers/names, not secret values
   - Swallowed errors (empty `.catch(() => {})`) that hide failures from users — at minimum show a toast/notification on failure

   **Validation & consistency**
   - New endpoints/schemas match validation standards of similar existing endpoints (check for field limits, required fields, types)
   - New API routes have the same error handling patterns as existing routes
   - If validation exists on one endpoint for a param, the same param on other endpoints needs the same validation
   - Schema fields that accept values the rest of the system can't handle (e.g., managedSecrets accepting any string when the sync endpoint requires `[A-Z0-9_]`)
   - Summary counters/accumulators that miss edge cases — if a file is removed, is the count incremented? Are all branches counted?

   **Concurrency & data integrity**
   - Shared mutable state (files, in-memory caches) accessed by concurrent requests without locking or atomic writes — if two requests can hit the same resource, consider a mutex or write-to-tmp-then-rename pattern
   - Multi-step read-modify-write cycles on JSON files or databases that can interleave with other requests

   **SQL & database**
   - Parameterized query placeholder indices (`$1`, `$2`, ...) must match the actual parameter array positions — especially when multiple queries share a param builder or when `paramIdx` is computed from prior queries that aren't in the same `query()` call
   - Database triggers (e.g., `BEFORE UPDATE` setting `updated_at = NOW()`) that clobber explicitly-provided values — verify triggers don't interfere with replication/sync that sets fields to remote timestamps
   - `BIGSERIAL` columns only auto-increment on INSERT, not UPDATE — if sync/federation relies on a sequence column to detect changes, the UPDATE trigger must explicitly call `nextval()` to bump it
   - PostgreSQL built-in functions (e.g., `gen_random_uuid()`) may require specific extensions or minimum PG versions — verify the Docker image/deployment target supports them

   **Lazy initialization & module loading**
   - Cached state getters (e.g., `getBackendName()`) that return `null` before the module is initialized — route handlers that check the cached value before any backend call will get incorrect results. Provide an async `ensure*()` function that triggers initialization
   - Re-exporting constants from heavy modules (e.g., `export { CONFIG } from './heavyModule.js'`) defeats lazy loading — define shared constants in a lightweight module or inline them

   **Data format portability**
   - Values that cross serialization boundaries (JSON API → database, peer sync) may change format — e.g., pgvector embeddings are strings in SQL but arrays in JSON. Convert consistently before writing to the target format

   **Cross-platform compatibility**
   - Shell commands like `sleep 1` don't exist on Windows — use Node-native delays (`Atomics.wait`, `setTimeout`) in setup/build scripts

   **Test coverage**
   - New validation schemas, service functions, or business logic added without corresponding tests — especially when the project already has a test suite covering similar existing code
   - New error paths (404, 400) that are untestable because the service throws generic errors instead of typed/status-coded ones

   **Accessibility**
   - Interactive elements (buttons, toggles, custom controls) missing accessible names, roles, or ARIA states — screen readers can't interpret unnamed buttons or div-based toggles
   - Custom toggle/switch UI built from `<button>` or `<div>` instead of native `<input type="checkbox">` with appropriate labeling

   **Configuration & hardcoding**
   - Hardcoded values (usernames, org names, limits) when a config field or env var already exists for that purpose — use the existing config
   - Dead config fields that nothing reads — either wire them up or remove them

   **Style & conventions**
   - Naming and patterns consistent with the rest of the codebase
   - Missing error handling at system boundaries (user input, external APIs)
