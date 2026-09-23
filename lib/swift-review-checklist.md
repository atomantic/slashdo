<!--
  This is Swift-specific diff review, not general code-review judgment or a
  restatement of the audit-agent prompts in better-swift.md — a frontier model
  already has both. It's scoped to the handful of Swift/SwiftUI footguns that
  are easy to miss because the code type-checks and looks correct at a glance.
-->

## Swift-Only Diff Checks

- **Deployment-target gating**: every `@available(...)` / `#available(...)` check (and every API call it gates) actually matches the project's declared minimum deployment target. A redundant check wastes a branch; a missing one — or a missing `#else` fallback below the real minimum — ships a crash on older OS versions.
- **`@State` init-once**: `@State` seeded from a value passed into `init()`. SwiftUI only reads that initial value once, so later updates from the parent are silently dropped. It should come from `@Binding`, or be re-synced explicitly in `.onChange`/`.task`.
- **`PreferenceKey.reduce`**: a custom `PreferenceKey` whose `reduce(value:nextValue:)` overwrites instead of merging (the default `value = nextValue()` pattern) silently drops every value but the last when multiple subviews report the same key.
- **Info.plist usage strings**: a newly introduced privacy-sensitive API (camera, location, photos, microphone, contacts, etc.) has a matching `NS*UsageDescription` string in Info.plist — without it, the first access crashes instead of prompting.
- **`Package.resolved` / reproducible builds**: `Package.resolved` is committed, and CI resolves dependencies with `--disable-automatic-resolution` (or the project's equivalent pinned-resolution flag) instead of silently re-resolving on every run.
- **SPM `.branch("main")`**: no SPM dependency is pinned to `.branch(...)` — use `.upToNextMajor(from:)` / `.exact(...)` so builds stay deterministic.
