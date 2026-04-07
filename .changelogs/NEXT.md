# Unreleased Changes

## Added

- **`lib/swift-gotchas.md`** — new Swift / iOS / macOS gotcha catalogue shipped with slashdo. 12 numbered entries documenting real-world failure modes (CKContainer eager-init crash, SwiftData missing inverse relationship, SwiftData CloudKit cross-Apple-ID sharing gap, iCloud ubiquity container silent failure, iCloud symlink content corruption, SwiftUI xcstrings localization, XcodeGen project generation, TestFlight upload validation, App Group provisioning auth failure, iOS first-IAP submission rejection, `.foregroundStyle(.accentColor)` compile failure, Keychain test failures). Each entry has TRIGGER / ROOT CAUSE / FIX / VERIFY sections so audit and remediation agents can apply verified fixes rather than improvise.

## Changed

- **`commands/do/better-swift.md`** — wired the new gotcha catalogue into the audit and remediation pipeline:
  - Phase 0d now detects CloudKit, iCloud entitlements, Localization, StoreKit, CI release path, and `CODE_SIGNING_ALLOWED=NO` test config
  - Phase 0e records `GOTCHA_ENTRIES_IN_SCOPE` mapping detected characteristics to catalogue entry numbers
  - Phase 1 audit instructions now `cat ~/.claude/lib/swift-gotchas.md` to load the catalogue inline before launching agents
  - Agent 5 (Bugs) gained findings for catalogue entries #1-#4 with specific trigger patterns
  - Agent 6 (Platform) gained new "Localization & String Catalogs" subsection (#6), new "In-App Purchases & StoreKit" subsection (#10), expanded XcodeGen build-system gotchas (#7), TestFlight upload validation (#8), App Group provisioning (#9), iCloud symlink corruption (#5)
  - Agent 7 (Test Quality) now requires `testModelContainerSchemaIsValid()`, CloudKit lazy-init smoke tests, localization round-trip tests, and IAP product-loading tests when relevant project characteristics are present
  - Phase 3c remediation guardrails replaced with a "GOTCHA CATALOGUE — REQUIRED READING" block that lists all 12 entries and instructs remediation agents to apply fixes as written
  - Compaction guidance preserves `GOTCHA_ENTRIES_IN_SCOPE` across context resets
- **`install.sh`** and **`uninstall.sh`** — added `swift-gotchas` to the `LIBS` array so the new reference file is deployed to all four supported environments (Claude Code, OpenCode, Gemini CLI, Codex). Existing path-rewrite logic handles `~/.claude/lib/` → `~/.config/opencode/lib/` / `~/.gemini/lib/` translation automatically.

## Fixed

## Removed
