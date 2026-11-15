## Shared Pipeline Inputs

The shared `better-*` partials own every phase procedure. This file supplies the Swift data they read and the places where a Swift run differs; it does not restate their rules. The four caller values:

- `{BRANCH_PREFIX}` = `better-swift` (staging branch `better-swift/{DATE}`, category branches `better-swift/{CATEGORY_SLUG}`)
- `{PIPELINE_TITLE}` = `Better Swift Audit`
- `{REVIEW_CHECKLIST}` = `Swift Code Review Checklist` (the section below)
- `{CATEGORY_SLUGS}` = `security`, `code-quality`, `dry`, `architecture`, `bugs-perf`, `platform-swiftui`, `tests`, `ux`

### Swift deltas

Read the shared phases with these differences:

- **Every platform.** Wherever a shared phase requires the build or tests to pass, that means every platform in `PLATFORMS`; `BUILD_CMD` and `TEST_CMD` already chain them. A fix that works on iOS but breaks macOS is not done. A commit that fixes a build or test failure names the failing platform in its subject.
- **Moved types.** Where a shared phase allows a re-export for public API, the Swift form is a `typealias` at the original location. The rule against shims added only to split PRs applies unchanged.
- **PR body.** Add `Platforms verified: {PLATFORMS}` to the summary, and a `Platform Impact` section saying which platforms the changes affect and any platform-specific notes.
- **CI failures.** Two extra causes to rule out: a change that compiles on one platform but not another (add an `#if os(...)` guard), and code-signing failures where CI has no signing configured (environment-specific; do not fix them in code).
- **Review loop.** Give each Phase 6 review sub-agent this instruction as well: after each fix, verify the build on every platform; if a reviewer's suggestion would break another platform, write a platform-conditional implementation instead. The interactive prompts in Phases 4b and 6.2 also state which platforms were verified.
- **Modes.** Simplify-only and strict modes are rejected before discovery, so every `SIMPLIFY_ONLY` and `STRICT_MODE` branch in the shared partials is false, and all eight slugs are always available.

## Phase 0 Caller Inputs

Apply these after the shared discovery's generic setup.

### Project and platform detection

Record `BUILD_SYSTEM` from the manifests: `Package.swift` (Swift Package Manager), `*.xcodeproj`, `*.xcworkspace` (also check CocoaPods and multi-project setup), `project.yml` (XcodeGen), or `Project.swift` (Tuist).

Determine platforms and deployment targets:

1. SPM: the `.iOS`, `.macOS`, `.watchOS`, `.tvOS`, and `.visionOS` declarations in `Package.swift`.
2. Xcode project: `xcodebuild -list`, then `xcodebuild -showBuildSettings -scheme {SCHEME}` for `SUPPORTED_PLATFORMS` and the `*_DEPLOYMENT_TARGET` settings.
3. XcodeGen or Tuist: the platform declarations in `project.yml` or `Project.swift`.

Record `PLATFORMS`, `DEPLOYMENT_TARGETS`, `SCHEME`, and `WORKSPACE_OR_PROJECT`, and note which of these the project uses, since they decide which gotcha entries and audit checks apply: SwiftUI versus UIKit/AppKit, Core Data or SwiftData, CloudKit, iCloud entitlements, string catalogs, StoreKit, widgets and App Intents, a TestFlight-uploading CI workflow, and whether CI builds unsigned.

Set `PROJECT_TYPE=SwiftUI` and `HAS_UI=true`.

### Build and test commands

Prefer documented `Makefile` or `fastlane/Fastfile` lanes when they already cover the platforms. Otherwise, for an SPM project use `swift build` and `swift test`. For an Xcode project, form one build command per platform in `PLATFORMS` and set `BUILD_CMD` to run them all in sequence with `&&`; do the same for `TEST_CMD`. Keep the per-platform commands in run state for remediation workers.

| Platform | Build destination | Test destination |
|---|---|---|
| iOS | `generic/platform=iOS Simulator` | `platform=iOS Simulator,name={SIM_DEST}` |
| macOS | `platform=macOS` | `platform=macOS` |
| watchOS | `generic/platform=watchOS Simulator` | — |
| tvOS | `generic/platform=tvOS Simulator` | — |
| visionOS | `generic/platform=visionOS Simulator` | — |

Each command has the shape `xcodebuild -scheme {SCHEME} -destination "<destination>" build` (or `test`). When `PLATFORMS` contains iOS, find an installed simulator rather than assuming a device name. This prints a `name,OS=version` value; record it as `SIM_DEST` and write it literally into the commands, because a shell variable does not survive into the next command:

```bash
xcrun simctl list devices available -j | python3 -c "
import json, sys
devices = json.load(sys.stdin)['devices']
for runtime in sorted(devices.keys(), reverse=True):
    for device in devices[runtime]:
        if device['isAvailable'] and 'iPhone' in device['name']:
            version = runtime.rsplit('iOS-', 1)[-1].replace('-', '.')
            print(f\"{device['name']},OS={version}\")
            sys.exit(0)
sys.exit('no available iPhone simulator')
"
```

If it finds none, report that iOS tests cannot run on this machine instead of guessing a device.

### Gotcha catalogue

Only when the project uses CloudKit, SwiftData, iCloud entitlements, `Localizable.xcstrings` or `String(localized:)`, XcodeGen, a TestFlight-uploading CI workflow, StoreKit, or Keychain, read the catalogue once:

!read lib/swift-gotchas.md

Match its Quick index against the project and record `GOTCHA_ENTRIES_IN_SCOPE` (empty when nothing applies). Each audit worker gets only its own entries: `bugs-perf` gets #1, #2, #4, #5, and #11; `architecture` gets #3; `platform-swiftui` gets #4 and #6–#10; `tests` gets #2.

## Phase 1 Caller Inputs

This roster replaces the shared scope table. It has eight scopes and deliberately no dependency or structural scope; a Swift worker never uses the generic `stack-specific` or `deps` slug. Each worker receives project conventions and its routed gotcha entries, and cites the entry number in any finding that matches one.

| Slug | Scope | Swift-specific remit beyond the shared row |
|---|---|---|
| `security` | Security & Secrets | Keychain use and data protection classes, private `Logger` interpolation, pinned SPM resolution |
| `code-quality` | Code Quality & Style | Swift idiom violations, swallowed errors |
| `dry` | DRY & YAGNI | Duplicate view modifiers and views, repeated colour/font/spacing literals, protocols or coordinators with a single conformer or call site |
| `architecture` | Architecture & SOLID | Business logic in `body`, navigation ownership, dependency injection, circular module dependencies |
| `bugs-perf` | Bugs, Performance & Error Handling | Retain cycles, main-actor violations, unstable `List`/`ForEach` identity, `GeometryReader` inside `ScrollView`, heavy work in `body` |
| `platform-swiftui` | Platform Coverage & SwiftUI Patterns | For each platform in `PLATFORMS`: reachable `#if os(...)` branches, UIKit/AppKit types or iOS-only modifiers in shared code, `UIScreen.main.bounds`, macOS commands/`Settings`/resizable windows/hover, watchOS and visionOS presentation. Also deployment-target availability, deprecated SwiftUI APIs, `@State` ownership, `@Observable` consistency, accessibility (labels, traits, 44×44 targets, VoiceOver order, reduced motion), Dynamic Type at `.large`, `.xxxLarge`, and `.accessibility5`, and dark-mode assets |
| `tests` | Test Quality & Coverage | Runs last. Per-platform test destinations, `@Published`/`@Observable` state sequences, an in-memory `ModelContainer` schema test for SwiftData, CloudKit bootstrap under `CODE_SIGNING_ALLOWED=NO`, async tests that rely on timing, UI tests coupled to copy instead of accessibility identifiers |
| `ux` | UX Consistency & Responsive Layout | Always runs. First-frame problems (blank or spinner-only launch, synchronous launch work, layout shift) go up one severity tier. Fixed frames, size classes, iPad multitasking, macOS resizing, localized truncation, landscape, keyboard avoidance, loading/empty/error states. Accessibility and Dynamic Type findings stay with `platform-swiftui` unless they reproduce at the default text size |

These common Swift patterns are not findings: a force unwrap protected by a real invariant, an `@ObservedObject` correctly owned by a parent `@StateObject`, an intentional best-effort `try?`, a platform conditional that correctly omits an inapplicable platform, and a `Task` inside `.task`, which already cancels with the view.

## Phase 2 Caller Inputs

The Swift category map (short label → full category → slug), which replaces the shared one:

- Security → Security & Secrets → `security`
- Code Quality → Code Quality & Style → `code-quality`
- DRY & YAGNI → DRY & YAGNI → `dry`
- Architecture → Architecture & SOLID → `architecture`
- Bugs & Perf → Bugs, Performance & Error Handling → `bugs-perf`
- Platform & SwiftUI → Platform Coverage & SwiftUI Patterns → `platform-swiftui`
- Tests → Test Quality & Coverage → `tests`
- UX → UX Consistency & Responsive Layout → `ux`

The plan summary also prints `Platforms: {PLATFORMS} | Deployment targets: {DEPLOYMENT_TARGETS}`. Typical Swift Foundation work is design tokens, platform typealiases, view modifiers, networking clients, and environment keys.

## Phase 3 Caller Inputs

Foundation utilities must compile on every platform before workers start. Add this block to every remediation worker's template:

```text
SWIFT-SPECIFIC GUARDRAILS:
- After each fix, verify the code compiles on all supported platforms: {PLATFORMS}
- Build commands: {BUILD_CMD}; the per-platform commands recorded in Phase 0 are listed here
- When adding #if os(...) code, handle every platform in PLATFORMS
- Check DEPLOYMENT_TARGETS before using an OS-gated API
- Check light and dark color schemes when changing colors
- For a finding that cites a gotcha entry, read that entry in swift-gotchas.md and start from its fix
```

When categories overlap on a file, Security owns Keychain and data protection, Platform owns conditional compilation, and UX owns design tokens and shared components.

## Phase 4c Caller Inputs

The `tests` worker's findings are the test-audit input. Tell the test enhancement agent the project type is `SwiftUI ({PLATFORMS})`, and add:

- Match the project's existing XCTest or Swift Testing idiom.
- Run tests on every platform in `PLATFORMS`; mark main-actor-isolated tests `@MainActor`.
- Cover platform-specific branches, and assert on accessibility identifiers, not user-facing copy.

## Swift Code Review Checklist

Read at Phase 4b, after the shared build and before PR creation. It is not needed for `--scan-only`.

!read lib/swift-review-checklist.md

## Final Summary Table

Phase 7 prints a table with columns `Category | Findings | Fixed | Skipped | PR | CI | Review`: one row for each of the eight short labels in the Phase 2 map, then a `TOTAL` row (`N PRs` in its PR column). Categories that shipped in one combined PR show the same PR number. Under the table, print:

```
Platforms verified: {PLATFORMS}
Deployment targets: {DEPLOYMENT_TARGETS}
```
