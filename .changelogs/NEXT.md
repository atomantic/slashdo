# Unreleased Changes

## Added

## Changed

- **Review checklist coverage broadened from external PR feedback.** Master checklist and four of five agent files (Surface Scan, Surface Quality, Cross-File Tracing, Cross-File Contract) gained new and broadened items for: shallow-merge `PATCH` endpoints silently dropping sibling fields when clients send partial sub-object patches; validator/sanitizer clamp/round/coerce drift from downstream computation; auto-save (blur) handlers racing with explicit-action button clicks and overwriting freshly-persisted derived state; SPA-lifetime client caches of user-editable settings going stale when another surface mutates them; predictive UI labels (`Auto → Codex`, "will fall back to local") that must mirror server resolution exactly; controls editable mid-batch in long-running multi-iteration operations; stale derived-artifact pointers (`imageJobId`, generated hash, rendered output) surviving source-field edits; cross-surface modal-open flags not resetting on context change; prompt-template family contract drift (hardcoded numbers stale against now-dynamic upstream values, output structure missing blocks a downstream parser expects, internal preamble-vs-final-instruction contradictions); setup scripts that only copy missing template files leaving existing installs frozen at the previous version; header-detection regexes failing to anchor to standalone-line and matching mid-body content; async-derived state initialized to empty-but-valid defaults (`providers: []`) rendering "nothing here" while still loading; disabled controls keyed on a non-terminal `unknown` status that becomes permanent after the upstream data source expires; lock granularity narrower than the shared resource it protects; cross-platform file hashing without line-ending normalization (CRLF Windows checkouts hash differently from LF references); and test mocks going stale when new exports are added to mocked modules.

## Fixed

- **CLI no longer hangs when run non-interactively with multiple AI
  environments detected.** When `bin/cli.js` found more than one supported
  environment (any combination of `~/.claude`, `~/.config/opencode`,
  `~/.gemini`, `~/.codex`) it called `readline.createInterface` to ask the
  user which to install for. Under a non-TTY stdin (CI, install scripts
  like PortOS's `update.sh`/`setup.sh`, anything piping into `npx
  slash-do@latest`), readline waited forever and the caller stalled. The
  CLI now detects `!process.stdin.isTTY`, skips the prompt, and defaults to
  "install for all detected environments" — matching the intuitive
  behavior callers want from automation and unblocking pipelines that
  invoke `npx slash-do@latest` directly. Interactive TTY sessions are
  unaffected; the prompt still fires when stdin is a terminal. Callers can
  still pass `--env <envs>` explicitly to override the auto-all default.

## Removed

## Full Changelog
