# Unreleased Changes

## Added

- `do:depfree`: persist audit decisions to `./docs/DEPS.md` so repeat runs skip re-evaluation of unchanged dependencies. Phase 0e loads prior decisions, Phase 1b/1c carry forward `KEPT_TIER1` / `KEPT_AUDITED` / `SKIPPED_INFEASIBLE` entries when package + major version + mode match, and Phase 4c rewrites the file with the merged decision set inside the worktree so it ships with the PR. Cache invalidates on major version bumps, heavy-mode runs after default-mode decisions, or manual deletion of an entry

## Changed

- Review system: added 14+ new checklist items and broadened 4 existing ones based on patterns the previous review missed in production PR feedback. Biggest gaps filled: child-process `spawn()` lifecycle (`error` handler + `proc.exitCode == null` for liveness vs `proc.killed` flag, BUSY-guard release timing); sync-shaped route handlers wrapping async-by-design services; cross-module feature-flag detection drift (HTTPS enabled, OAuth scopes); cross-module error classification when wrappers rethrow with different `name`/`code`; compatibility-shim end-to-end response field plumbing (A1111 `seed`, OpenAI `usage.tokens`); stateful parser correctness (terminal-state validation, per-part state reset, streaming→buffered regression, errors-without-`err.status` becoming 500); allowlist namespace mismatches (pip names vs import names); persisted-state path traversal extending into exec arg strings (ffmpeg manifest single-quote / Windows backslash escaping); empty 200 responses masking server failure; late-connect SSE replay-on-connect; cache-of-negative-results without TTL; `spawn` env `undefined → "undefined"` coercion; HTML `<button>` default `type="submit"`; PowerShell `$LASTEXITCODE` propagation in fail-soft steps; outbound HTTP without per-request AbortController in setup/install/update scripts. Updates applied to `lib/code-review-checklist.md` (master), `lib/review-surface-scan.md`, `lib/review-cross-file-tracing.md`, `lib/review-security-audit.md`. Architecture remains balanced — no new agents needed

## Fixed

## Removed
