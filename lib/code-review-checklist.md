<!--
  Code Review Checklist — canonical reference.

  This document is the human-readable catalog of what the /do:review system
  watches for. The per-agent instruction files (review-surface-scan.md,
  review-surface-quality.md, review-security-audit.md, review-cross-file-
  tracing.md, review-cross-file-contract.md) are focused extracts that
  prime opus's attention during the actual review.

  Use this file to learn the system. Update agent files for runtime impact.

  Triage: Tier 1 and Tier 4 apply to every file. Tier 2 and Tier 3 apply
  only when the file's role matches.
-->

# How to review

The most expensive misses are not pattern misses — they are *consequence-reasoning* misses. A test asserts a symptom (HTTP status) instead of the contract (status + code + body shape). A fallback path returns a different shape than the happy path. An encoder corrupts the downstream parser. An auto-assign ignores pre-existing state on re-run. These are findable only by reasoning from principles, not by matching against bullets.

**Reason first, checklist second.** For each change, ask:
- What's the smallest input that breaks this?
- What does the producer believe vs the consumer?
- What does the fallback path actually deliver?
- What does the documentation claim vs what the code does?
- After this completes (success / failure / cancel), is state Y reliably Z?

**Documentation is a contract** — comments, JSDoc, README, PLAN.md, changelog entries, sample configs, AND prompt templates. When the claim doesn't match the code, both are bugs.

**A test pins the contract it names.** Assertions that would still pass when the named behavior regresses are not coverage.

**The LLM prompt is a data path.** User content flowing into a template (fenced blocks, template-engine substitution) is subject to corruption / injection / fence escape exactly like any other untrusted-input → structured-output boundary.

---

## Tier 1 — Always Check (Runtime, Security, Hygiene)

**Hygiene**
- Leftover debug code, hardcoded secrets, uncommittable files (`.env`, build artifacts, runtime-generated reports)
- Overly broad changes mixing refactor + feature + unrelated concerns — flag for split

**Imports & references**
- Every symbol used is imported (missing → crash). References to framework utilities (CSS classes, prop names, directives) that don't exist silently no-op

**Runtime correctness**
- Null/undefined access without guards; spread of null is `{}`, spread of non-object is garbage — `isPlainObject` first
- External/user data used without structural validation
- Type coercion: `Number('')→0`, `"false"` truthy after serialization, lexicographic string compare (`"10"<"2"`), `typeof NaN === 'number'`
- `||` default eats valid `0`/`false`/`""` — use `??` or `=== undefined`
- Merge-fallback (`final = parsed.field || prior.field`) collapses "absent" vs "explicitly cleared" — gate on `'field' in parsed`
- Functions returning different types per branch — callers must branch on shape
- Parallel arrays coupled by index — use maps keyed by stable id
- Shared mutable references mutated across calls (module-level defaults) — `structuredClone()`
- State-invariant check (cap/floor/uniqueness) against render-time value, not in functional updater — rapid events race the check
- Bound-derived value not clamped when the bound shrinks — downstream readers see garbage / past-end
- `useEffect` depending on state it writes — split into two effects or use functional setter
- Optional chaining only on first prop (`obj?.a.b.c`) still throws on `b`
- Optimistic state mutated before async, never reverted on failure
- `if (cache[key])` misses falsy successful values — use `key in cache`
- Temp filename via `Date.now()` collides under concurrency
- `existsSync` for "must be a regular file" accepts directories/symlinks
- Cache-validity via `existsSync` returns zero-byte/partial files as valid
- Browser storage (`setItem`/`getItem`/`JSON.parse`) can throw — wrap and validate
- Auto-assign / "next free" logic looking at incoming batch only, ignoring pre-existing state in the target
- Server returns empty success when an artifact fetch failed — clients see "no work" instead of "internal error"

**API & URL safety**
- User values into URL/shell/path/eval without encoding — use `encodeURIComponent`, regex allowlists, `JSON.stringify` for eval'd code
- Subprocess via shell command string instead of `execFile`/`spawn` with array + `shell: false`
- Variable-length/secret payloads via argv (visible in `ps`) — pipe via stdin
- HTTP header comparisons (`Content-Type`, `Authorization` scheme) must lowercase first — spec is case-insensitive
- Hand-rolled URL parsing — use `new URL`, allowlist protocol, validate path segments
- Identifier fields used as delimiter-separated keys must reject the delimiter at validation
- Multi-input pipelines (ffmpeg concat, audio mixers) need matching parameters across ALL branches (including fallback/generated)
- Persisted JSON loaders called at runtime must normalize the parsed root shape — `Array.isArray ? : []`
- Route param schemas must match body/query schemas on every CRUD verb
- Character-class regex claiming structured format accepts edge cases (`-foo`, `foo-`, `a--b`)
- Per-field size caps on large string/binary payloads — body cap alone doesn't prevent one oversized field
- Server-side fetch to user-configurable URL without protocol allowlist + host restrictions + redirect re-validation — SSRF
- Stored/external URLs rendered as links without protocol validation — reject `javascript:`, `data:`

**Trust boundaries & data exposure**
- API responses returning full objects with sensitive fields — omit across ALL paths (GET/PUT/POST/error/socket)
- Server-internal filesystem paths leaked via list/status/log endpoints or SSE/WebSocket
- Error messages interpolating paths/secrets/internal hosts/stack frames — log in `context`, keep `message` boundary-safe
- Server trusting client-computed values (scores, totals, file MIME, file size) — recompute, validate uploads by magic bytes
- Authorization flags read from persisted state used to gate access — derive from a trusted source (code constants, session)
- Persisted-state filename fields used as FS operands without `safeUnder` validation; consumer-specific escaping (ffmpeg manifest quoting, shell metachars)
- New endpoints under restricted route paths missing the sibling's auth gate
- `Object.assign`/spread on user-controlled objects — `__proto__`/`constructor`/`prototype` pollution
- Push events (WS/SSE/pub-sub) emitted without session/user scoping
- LLM prompt with user content inside fenced code block — content containing the delimiter (```) closes the fence
- LLM prompt with user content via unescaped template substitution (Mustache `{{{...}}}`, raw HTML) — content with engine tokens leaks into the prompt
- Encoder injecting non-empty markers (ZWSP, alternate delimiters) into structured output — corrupts downstream parsers invisibly

---

## Tier 2 — Check When Relevant

**Async & state consistency** _[async/await, Promises, UI state]_
- Optimistic UI state never reverted on failure
- Multiple coupled state variables updated independently; selection sets not pruned on data refresh/filter/sort
- Component state initialized from props via `useState(prop)` doesn't sync on prop change — use effect keyed on all identity discriminators
- Periodic operations with skip conditions not advancing timing state — re-trigger loop
- Cached values keyed without all discriminators (URL, tenant, config version); health endpoints returning cached results
- SPA-lifetime client cache of user-editable settings never invalidates when another surface edits
- Fire-and-forget writes: stale response OR claim of unpersisted state
- Side effects executing in parallel with the primary write they depend on
- `Promise.all` without error handling; `Promise.allSettled` without logging rejection reasons
- Sequential per-item processing where one throw aborts the rest
- Async function from sync event handler without rejection handling
- Single shared error-state variable reused by multiple flows — one flow's success clears another's error
- Auto-save handlers racing explicit action handlers writing to the same record
- Cancellation that aborts only the visible consumer, not upstream pipeline; chained `.then(...)` opens new resources after abort
- Subscriber attaches after the terminal event has already broadcast
- Per-id lock/queue map that never evicts entries
- Streaming UI clears the buffer on `error` event — discards visible deltas
- Reload-on-update fallback replaces richer state with the thin patch input

**Error handling** _[try/catch, .catch, error responses, external calls]_
- Swallowed errors; catch-all that synthesizes success-shape indistinguishable from idle/healthy
- Error discrimination by string matching — wrappers/localization break it; use codes/typed classes
- Pattern-match classifier whose fallthrough returns "no error" instead of "unknown error"
- Route handlers mapping every service exception into one HTTP status — hides real server errors as 404s
- State transitions gated on external call must verify success — swallowed failure followed by `state = 'settled'` loses ledger entries
- Error wrapper drops `code`/`context`/`cause`/`status`
- Errors thrown from middleware (multipart, body parsers) without `err.status` default to 500 instead of 400/413
- Error message templates with empty values produce `"X failed: ."` — trim and default
- Service functions throwing generic Error for client conditions — 500 instead of 400/404
- External service calls without configurable timeouts; missing fallback for unavailable downstream
- Stream lifecycle events (`error`, `done`, `complete`) must be mutually exclusive — emitting both means clients see clean termination on failure

**Resource management** _[listeners, timers, subscriptions, useEffect]_
- Event listeners / sockets / subscriptions / timers / useEffect cleaned up on teardown
- Delete/destroy leaving orphaned secondary resources (data dirs, child records, temp files)
- Cleanup handler gates on a parse-requiring getter — corrupted records become undeletable
- Initialization functions without guard against multiple calls
- Self-rescheduling callbacks where error before re-registration permanently stops schedule — try/finally
- `requestAnimationFrame` handles not cancelled on unmount
- Large payloads (base64, binary buffers) stored in multiple state fields — derive on demand
- Blob/object URLs not revoked on both item removal AND unmount
- ReadableStream/fetch reader consumed without `try/finally` — exception leaves stream open
- Page-level `unsubscribe` from shared event streams drops other consumers' subscriptions

**Validation & consistency** _[user input, schemas, API contracts]_
- Breaking changes (renamed config keys, file formats, event payloads, routes, persisted data) without migration/fallback
- Schema-tightening (new required field, removed nullable) without auditing every existing producer
- Data migrations silently changing runtime behavior — unsupported values flagged, not defaulted
- Update endpoints with field allowlists not covering new model fields
- Client-side input limits inconsistent with server-side enforcement — confusing 400/413 errors
- Sample configs / README examples reference keys the loader doesn't read
- Subprocess invocations not inheriting parent's config source via `env` option
- Config values validated only at first use — misconfiguration surfaces as cryptic runtime error
- Summary/aggregation endpoints using different filters than detail views they link to
- New validation rule introduced for a field — trace ALL write paths (CRUD verbs in same router most often divergent)
- Foreign-key existence-check parity across write paths
- Stored config merged with shallow spread — nested objects lose new default keys on upgrade
- PATCH/update endpoints shallow-merging nested sub-object patches silently drop sibling fields the client omitted
- Boundary validator/sanitizer/clamp must apply the SAME bounds, rounding, coercion as downstream computation/render
- Setup scripts provisioning template/sample files via "copy only if missing" freeze existing installs at the prior content
- Prompt-template contract drift — hardcoded numbers stale against now-dynamic upstream; output structure expected by downstream parsers; internal consistency
- Schema fields accepting values downstream can't handle; validated params never consumed (dead API surface)
- LLM-emitted fields where prompt advertises a controlled vocab but validator falls through to a different default
- New API client functions must use same encoding/escaping as existing ones
- Architectural pattern divergence — every new module addresses a class of concern; new code MUST adopt the established pattern
- Cross-module constants kept "in sync by comment" — extract to a shared module

**Concurrency & data integrity** _[shared state, DB writes, multi-step mutations]_
- Shared mutable state without locking; lock granularity matching resource granularity (per-item lock on shared blob still interleaves)
- Read-only paths triggering lazy init with write side effects — unprotected concurrent writes
- Multi-table writes without transaction — partial state on error
- Writes replacing entire composite attribute populated by multiple sources
- Shared flags/locks with exit paths skipping cleanup — permanent lock
- Non-atomic check-then-create (find-or-create) produces duplicates under concurrency
- Migration / warmup / load fires before `listen()` without `await`

**Input handling** _[user/external input]_
- Trimming values where whitespace is significant (tokens, passwords, base64)
- Unbounded arrays at endpoints; unbounded fan-out parallel I/O (EMFILE risk)
- Allowlists built from a sibling namespace (import names vs pip package names)
- Numeric strings without NaN/type guards
- LLM tool-call parameters arriving as strings even when schema declares number/boolean

---

## Tier 3 — Domain-Specific

**SQL & DB** _[SQL, ORM, migrations]_
- Parameterized query placeholder/parameter alignment
- `CREATE TABLE IF NOT EXISTS` as sole migration — won't add columns
- Migrations locking tables (ADD COLUMN with default, CREATE INDEX without CONCURRENTLY); missing rollback
- Dead queries; N+1; O(n²) on growing data
- Full-text search on user input with strict parsers — use `plainto_tsquery`

**Sync & replication** _[pagination, batch APIs, data sync]_
- Upsert/`ON CONFLICT UPDATE` updating only a subset of exported fields — replicas diverge
- Pagination: `COUNT(*)` (full scan), missing `next` token, hard-capped limits truncating silently
- Pagination cursors from last scanned vs last returned — trimmed results cause skips
- Batch API not handling partial results / continuation tokens / rate limits with backoff

**Lazy init / bootstrap** _[dynamic imports, lazy singletons]_
- Module-level side effects without error handling — aborts server boot
- File writes assuming parent directory exists
- Bootstrap importing the dep it's meant to install
- Re-exporting from heavy modules defeats lazy loading

**Data format portability** _[JSON, DB, IPC]_
- Values changing format across boundaries (arrays in JSON, strings in DB); datetime UTC/local mixing
- Reads immediately after writes to eventually consistent stores
- BIGINT → JS Number precision loss past `MAX_SAFE_INTEGER`
- Key/index design not supporting required query patterns (random UUIDs claiming "recent" ordering)

**Shell & portability** _[subprocesses, shell scripts]_
- `set -e` aborting on non-critical failures; broken pipes on non-critical writes — `|| true`
- Interactive prompts in non-interactive contexts — TTY detection
- Detached processes with piped stdio — SIGPIPE on parent exit; use `'ignore'`
- Subprocess output buffered without size limits
- Platform binaries by name (`pwsh`/`powershell.exe`, `python3`/`python`) — probe + fallback
- Inverse-platform guards (`if (!IS_WIN)`) for macOS-only binaries — use positive predicate
- Case-sensitive path ops break on Windows/case-insensitive macOS
- Naive whitespace split of command strings breaks quoted args
- Subprocess output parsed from one stream only — check stdout AND stderr AND exit code
- Argv length limits on Windows (~32KB) for variable-length payloads — pipe via stdin
- PowerShell `$LASTEXITCODE` leaks from soft steps — explicitly reset

**Streaming & real-time protocols** _[SSE, WebSocket, ReadableStream]_
- Long-lived handler must register `req.on('close')` and check `aborted` before subsequent writes
- After flushing headers, framework error middleware can't send JSON — emit terminal `event: error` frame
- Honor write backpressure; cleanup must remove ALL paired listeners
- Wire-protocol parser must handle all spec separators (`\n\n` AND `\r\n\r\n`), flush buffer on EOF, wrap per-frame parse
- Stateful parsers (multipart) must verify terminal state on EOF — `finish()` while in `STATE_HEADERS` accepts truncated input

**Search & navigation** _[search, deep-linking]_
- Search results linking to list pages instead of deep-linking to specific record
- Deep-link URL with query params is a contract: receiving page MUST consume them
- Search code hardcoding one backend when system supports multiple

**Destructive UI** _[delete, reset, revoke]_
- Destructive actions without confirmation step

**Accessibility** _[interactive UI elements]_
- Interactive elements missing accessible names/roles/ARIA states
- Icon-only buttons relying on `title` for accessible name — add `aria-label`
- Form submission via Enter calls `onSubmit` regardless of button's disabled state
- `<input type="number">` with format-on-render blocks intermediate typing
- Form input mutating source-of-truth prop on keystroke breaks dirty-check
- ARIA roles imply keyboard contracts (menu, listbox, dialog) — implement or drop to simpler pattern
- `<button>` without explicit `type="button"` defaults to submit

---

## Tier 4 — Always Check (Quality, Conventions, AI-Generated Code)

**Intent vs implementation**
- Labels / comments / status messages describing behavior the code doesn't implement
- Factual doc drift: file paths, item counts, default names, route shapes
- PLAN/TODO/changelog entries pointing future work at problems the current code already fixes
- Comment / JSDoc references a function or symbol that doesn't exist
- Sample-config / README examples use keys the loader doesn't read
- Inline code examples or command templates not syntactically valid
- Sequential numbering with gaps after edits
- Template/prompt variables referenced but never assigned
- LLM prompt promises downstream behavior the code doesn't deliver
- JSON example in prompt with inline `/* comments */` or pipe-separated enum strings — LLMs reproduce them literally
- Composed prompts whose mode/role variants contradict always-present clauses

**Automated pipeline discipline**
- Internal review must run before PR; Copilot review must complete before merge
- Automated agent output reviewed against project conventions

**AI-generated code quality**
- New abstraction / wrapper / helper file with one call site
- Feature flag / config option / extension point with one possible value
- Commit message claiming a fix while the bug remains
- Defensive code for scenarios that provably cannot occur
- Placeholder comments / stubs presented as complete
- Cleanup callback containing only comments

**Configuration & hardcoding**
- Hardcoded values when config/env var exists; dead config fields; unused parameters
- Duplicated constants across modules — extract to shared
- CI pipelines without lockfile pinning
- Production code paths with no structured logging at entry/exit
- Error logs missing reproduction context (request ID, input params)

**Supply chain**
- Lockfile committed; CI uses `--frozen-lockfile`
- `npm audit` / `cargo audit` — no unaddressed HIGH/CRITICAL
- No `postinstall` from untrusted packages executing arbitrary code
- Overly permissive version ranges on deps with breaking-change history

**Test coverage**
- New logic/schemas/services without tests when similar existing code has tests
- New error paths untestable because services throw generic errors
- Tests re-implementing logic under test instead of importing real exports
- Tests asserting source-code strings instead of calling functions
- Tests depending on real wall-clock time or external dependencies — mock the subprocess interface
- Tests asserting a symptom (status range, content present) instead of the contract (specific code, specific shape)
- Test mocks hardcoding constants the source-of-truth module exports — import them
- Test names claiming behavior the assertions don't actually verify
- Tests asserting validation rejection without providing all OTHER required fields valid
- Adding a new module export requires updating every test that mocks the module
- Tests gated by `process.platform` silently skip on other CI runners
- Tests allocating temp dirs / spawning processes without `afterEach` cleanup
- Tests mutating global state without `try/finally` restoration
- Path assertions using forward-slash literals fail on Windows
- A refactor consolidating into a single source-of-truth helper deserves field-level tests on its output
- Missing tests for trust-boundary enforcement and rollback paths

**Style & conventions**
- Naming and patterns inconsistent with rest of codebase
- New content not matching existing indentation, bullet style, heading levels
- Duplicate section headers in a single structured file (changelog, README) are merge artifacts — consolidate
- Shell instructions with destructive operations not verifying preconditions first

**Structural ambition** _(apply when reviewing diffs from `--strict` runs, optional otherwise)_
- File pushed from under 1000 lines to over 1000 lines — extract helpers/subcomponents/modules first
- New ad-hoc conditional bolted onto an existing flow the surrounding code wasn't designed for — move into a dedicated abstraction, state machine, or the layer that already owns the concept
- Thin wrappers / identity abstractions / single-call-site helpers that add indirection without buying clarity — delete the wrapper
- Feature-specific logic added to a shared/canonical module, or implementation details leaking through APIs callers must know about — move to the layer that owns the concept
- Bespoke helper duplicating a canonical utility — use the existing one; extend it if missing a capability
- Cast-heavy / `any`-heavy / optional-soup contracts paper over an unclear invariant — make the boundary explicit
- Refactors that move code between files without reducing the number of concepts the reader holds — flag as "movement without simplification"
- Missed code-judo: a small reframing that would delete a whole branch/mode/helper. Don't accept a cleaner version of the same messy idea when a simpler model is plausible
- Tone: direct and demanding about structure, never rude. Phrasings: "this pushes the file past 1k lines — decompose first", "this works, but the surrounding code is more spaghetti", "this abstraction isn't earning its keep", "code-judo move here deletes the whole {branch}". Avoid rename-only suggestions when the real issue is structural
