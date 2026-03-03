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

   **Configuration & hardcoding**
   - Hardcoded values (usernames, org names, limits) when a config field or env var already exists for that purpose — use the existing config
   - Dead config fields that nothing reads — either wire them up or remove them

   **Style & conventions**
   - Naming and patterns consistent with the rest of the codebase
   - Missing error handling at system boundaries (user input, external APIs)
