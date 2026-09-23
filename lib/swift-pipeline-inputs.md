## Shared Pipeline Inputs

Phases 3–7 use the shared `better-*` pipeline partials. Resolve these values before Phase 3; the Swift-specific phase inputs below are the caller's data for the canonical procedures. Substitution rules are documented in `lib/better-verification.md`: an empty value on its own line drops that line, an empty inline value vanishes, and an indented value keeps its indentation.

- `{BRANCH_PREFIX}` = `better-swift` (staging branch `better-swift/{DATE}`, category branches `better-swift/{CATEGORY_SLUG}`)
- `{PIPELINE_LABEL}` = `better-swift audit`
- `{PIPELINE_TITLE}` = `Better Swift Audit`
- `{VERIFY_SCOPE_SUFFIX}` = ` on ALL supported platforms`
- `{VERIFY_SCOPE_NOTE}` = This must succeed for every platform in `PLATFORMS`. A fix that works on iOS but breaks macOS is not acceptable.
- `{VERIFY_FAILURE_SCOPE}` = ` on any platform`
- `{VERIFY_FAILURE_COMMIT_SLOT}` = `{platform} ` — the failing platform is required in the commit subject
- `{VERIFY_STATUS_CLAUSE}` = `All {PLATFORMS} platforms build and test successfully. `
- `{REVIEW_CHECKLIST}` = `Swift Code Review Checklist` (the section below)
- `{VERSION_BUMP_SECTION}` = `Version Bump Procedure` (the section below)
- `{SIMPLIFY_ONLY}` = `false` — this caller rejects simplify-only and strict modes before discovery
- `{COMPAT_SHIM}` = `typealias`, `{COMPAT_HOST}` = `file`
- `{MULTI_CATEGORY_FILE_EXAMPLE}` = ``ContentView.swift`` with both platform and architecture changes
- `{CATEGORY_SLUGS}` = `security`, `code-quality`, `dry`, `architecture`, `bugs-perf`, `platform-swiftui`, `tests`, `ux`
- `{CATEGORY_SLUG_RULE}` = *(empty — every slug above is always available)*
- `{COMMIT_PREFIX_RULE}` = *(empty — this caller has no mode that changes the prefix)*
- `{PR_BODY_SUMMARY_EXTRA}` = `Platforms verified: {PLATFORMS}`
- `{PR_BODY_EXTRA_SECTIONS}` = one extra section, at column 0 and ending with a blank line:

      ### Platform Impact
      {which platforms are affected by these changes, any platform-specific notes}

- `{CI_FAILURE_CAUSES_EXTRA}` = two bullets, indented to match the list where they land:

      - **Platform build failure**: a change compiles on iOS but not macOS (or vice versa). Add a `#if os(...)` guard.
      - **Code signing**: ignore code-signing failures in CI if signing is not configured; they are environment-specific.

- `{REVIEW_LOOP_EXTRA_INSTRUCTION}` = **Swift-specific review instruction:** after each fix, verify `{BUILD_CMD}` on every platform. If a reviewer's suggestion would break another platform, add a platform-conditional implementation instead.
- `{REVIEW_STATUS_EXTRA}` = `\n\nAll PRs verified on: {PLATFORMS}`
- `{SUMMARY_TABLE_ROWS}` / `{SUMMARY_TABLE_ROW_RULES}` / `{SUMMARY_TABLE_FOOTER}` = the rows, omission rules, and footer in the **Final Summary Table** section below

## Phase 0 Caller Inputs

The shared `lib/better-discovery.md` owns VCS selection, the default-branch lookup, state capture, changelog discovery, and safe worktree selection. Apply these Swift-specific hooks after its generic setup.

### Project and platform detection

Check the project manifests and record `BUILD_SYSTEM`:

- `Package.swift` → Swift Package Manager
- `*.xcodeproj` → Xcode project; inspect SwiftUI, UIKit, and AppKit usage
- `*.xcworkspace` → Xcode workspace; inspect CocoaPods and multi-project setup
- `project.yml` → XcodeGen
- `Project.swift` → Tuist

Determine platforms and deployment targets from the detected system:

1. For SPM, read `.iOS`, `.macOS`, `.watchOS`, `.tvOS`, and `.visionOS` declarations in `Package.swift`.
2. For an Xcode project, run `xcodebuild -list`, then `xcodebuild -showBuildSettings -scheme {SCHEME}` and read `SUPPORTED_PLATFORMS` plus the applicable `IPHONEOS_DEPLOYMENT_TARGET`, `MACOSX_DEPLOYMENT_TARGET`, and related settings.
3. For XcodeGen or Tuist, read `project.yml` or `Project.swift` for platform declarations.

Record `PLATFORMS`, `DEPLOYMENT_TARGETS`, `SCHEME`, and `WORKSPACE_OR_PROJECT`. Detect and carry forward SwiftUI versus UIKit/AppKit, Core Data or SwiftData, Combine, Swift concurrency, widgets, App Intents, CloudKit, iCloud entitlements, localization, StoreKit, TestFlight CI, and code-signing characteristics. Route CloudKit to the bugs/performance worker, iCloud and localization and StoreKit and TestFlight to the platform worker, and code-signing to the CloudKit eager-initialization check.

Set `PROJECT_TYPE=SwiftUI`, `HAS_UI=true`, and `HAS_VERSION_BUMP=true`. Preserve these values across compaction together with `BUILD_SYSTEM`, `SCHEME`, `WORKSPACE_OR_PROJECT`, `PLATFORMS`, and `DEPLOYMENT_TARGETS`.

### Build and test commands

For an SPM project:

```bash
BUILD_CMD="swift build"
TEST_CMD="swift test"
```

For a single-platform Xcode project, derive an available simulator before forming the commands:

```bash
SIM_DEST=$(xcrun simctl list devices available -j | python3 -c "
import json, sys
devices = json.load(sys.stdin)['devices']
for runtime in sorted(devices.keys(), reverse=True):
    for device in devices[runtime]:
        if device['isAvailable'] and 'iPhone' in device['name']:
            version = runtime.split('.')[-3].replace('SimRuntime-iOS-', '').replace('-', '.')
            print(f\"{device['name']},OS={version}\")
            sys.exit(0)
print('iPhone 16')
")
```

Execute the build and test commands directly rather than expanding a shell variable:

```bash
xcodebuild -scheme {SCHEME} -destination "generic/platform=iOS Simulator" build
xcodebuild -scheme {SCHEME} -destination "platform=iOS Simulator,name=$SIM_DEST" test
```

For each platform in `PLATFORMS`, set the corresponding command variable:

- iOS: `BUILD_CMD_IOS` uses `generic/platform=iOS Simulator`; `TEST_CMD_IOS` uses `platform=iOS Simulator,name=$SIM_DEST`.
- macOS: `BUILD_CMD_MACOS` and `TEST_CMD_MACOS` use `platform=macOS`.
- watchOS: `BUILD_CMD_WATCHOS` uses `generic/platform=watchOS Simulator`.
- tvOS: `BUILD_CMD_TVOS` uses `generic/platform=tvOS Simulator`.
- visionOS: `BUILD_CMD_VISIONOS` uses `generic/platform=visionOS Simulator`.

Set `BUILD_CMD` to run every declared platform build sequentially with `&&`, and set `TEST_CMD` to run every declared platform test. Prefer documented `Makefile` or `fastlane/Fastfile` lanes when they already handle the platforms. Preserve per-platform command variables for remediation workers.

### Gotcha catalogue

Read `lib/swift-gotchas.md` once only when the project uses CloudKit, SwiftData, iCloud entitlements, `Localizable.xcstrings` or `String(localized:)`, XcodeGen, a TestFlight-uploading CI workflow, StoreKit, or Keychain. Match the catalogue's Quick index and record `GOTCHA_ENTRIES_IN_SCOPE`; do not duplicate its trigger table. Route entries #1, #2, #4, #5, and #12 to Agent 5, #2 also to Agent 7, #3 to Agents 4 and 5, #4 also to Agent 6, and #6–#10 to Agent 6. Leave the list empty when no trigger applies.

When a trigger applies, read the catalogue now:

!read lib/swift-gotchas.md

## Phase 1 Caller Inputs

Use the shared audit procedure in `lib/better-audit.md` for evidence, deduplication, scope selection mechanics, and issue-mode handling. This caller supplies the Swift roster and keeps the eight workers below distinct; it intentionally does not add the generic dependency-freedom or structural scopes.

Set `PROJECT_TYPE=SwiftUI` and `HAS_UI=true`. Pass project conventions and the in-scope gotcha entries to each worker, but pass only the entries routed to that worker rather than the whole catalogue. Resolve `AUDIT_MODEL_TIER` through `lib/model-tiers.md`; use the host's strongest alias for `heavy` and the configured host alias for other tiers.

When `ISSUE_MODE=true`, follow `lib/better-issue-mode.md`: create `SPOOL_DIR` with `mktemp -d`, preserve its printed literal path, have each worker write its category file, use `>` only for the first write and `>>` thereafter, and return only an index line of `<id> | <SEVERITY> | <category> | <file:line> | <one-line title>`. The body remains on disk for consolidation, filing, remediation, and test triage. A Swift worker's category slug is one of `security`, `code-quality`, `dry`, `architecture`, `bugs-perf`, `platform-swiftui`, `tests`, or `ux`; never substitute the generic `stack-specific` or `deps` slug. In a normal run, use the shared evidence bar and require 30 surrounding lines, quoted evidence, an actual effect, and a concrete fix; these common Swift false positives are not findings: a force unwrap protected by a real invariant, an `@ObservedObject` correctly owned by a parent `@StateObject`, an intentional best-effort `try?`, a platform conditional that correctly omits an inapplicable platform, or a `Task` inside `.task` that already has cancellation semantics. Keep unresolved hypotheses marked `[UNCERTAIN]`.

Launch five workers in the first parallel batch:

1. **Security & Secrets** — authentication, credential exposure, data protection, input validation, dependency health, hardcoded secrets, API keys, PII, insecure networking, and Swift-specific Keychain, private `Logger` interpolation, and pinned SPM resolution preferences.
2. **Code Quality & Style** — brittleness, convention violations, Swift idiom violations, magic numbers, dead code, unused imports, logging, value types and `final` by default, `let` over `var`, and surfaced errors instead of swallowed failures.
3. **DRY & YAGNI** — duplicate view modifiers, copy-paste views and models, repeated color/font/spacing literals, duplicated networking, and speculative protocols or coordinators without multiple conformers or call sites.
4. **Architecture & SOLID** — god files, business logic in `body`, mixed concerns, view models and services, dependency injection, navigation ownership, and circular module dependencies.
5. **Bugs, Performance & Error Handling** — runtime safety, retain cycles, main-actor violations, SwiftUI rendering performance, unstable `List`/`ForEach` IDs, `GeometryReader` in `ScrollView`, and heavy work in `body`; check in-scope gotchas #1–#5 and #12 and cite the catalogue number.

After batch one completes, launch three workers:

6. **Platform Coverage & SwiftUI Patterns** — dynamically use `PLATFORMS` to check reachable `#if os(...)` branches, UIKit/AppKit types in shared code, iOS-only modifiers, `UIApplication.shared`, `UIScreen.main.bounds`, macOS shortcuts and commands, hover and pointer alternatives, resizable layouts, `Settings`, Dock reopen behavior, watchOS timelines, and visionOS presentation. Check in-scope gotchas #7–#9 for XcodeGen, TestFlight, and App Groups; #4–#5 for iCloud; #6 for string catalogs; and #10 for StoreKit. Also check deprecated SwiftUI APIs, deployment-target availability, `@State` ownership, item-based presentation, `AnyView`, animation, `@Observable` consistency, Transferable, namespaced `@AppStorage`, accessibility labels and traits, color alternatives, 44×44 targets, grouping, VoiceOver order, reduced motion, Dynamic Type at `.large`, `.xxxLarge`, and `.accessibility5`, launch/onboarding/paywall layout, and dark-mode assets and previews.
7. **Test Quality & Coverage** — identify the existing XCTest or Swift Testing idiom, then report missing critical and error-path coverage, multi-platform destinations, state transitions, `@Published`/`@Observable` sequences, `XCUITest` flows, `ModelContainer` schema validity for SwiftData, CloudKit bootstrap under `CODE_SIGNING_ALLOWED=NO`, localization round trips, StoreKit product loading, vacuous assertions, weak tests, async timing, shared mutable state, and UI tests coupled to copy instead of accessibility identifiers. Prefix findings with the quality tag `[VACUOUS]`, `[WEAK]`, or `[MISSING]`.
8. **UX Consistency & Responsive Layout** — always run for SwiftUI. Bump severity one tier for first-screen first-frame issues. Check blank or spinner-only first frames, synchronous launch work, layout shift after first render, small-device scrolling, launch permission prompts, launch-screen continuity, fixed frames, size classes, iPad multitasking, macOS resizing, wrapping HStacks, localized truncation, landscape layout, keyboard avoidance, one-off design literals, duplicate UI implementations, loading/empty/error states, interaction feedback, and missing hover/focus behavior. Keep Dynamic Type, accessibility, and platform API findings with Agent 6 unless they reproduce at default text size.

Wait for every selected worker before Phase 2. The Swift category slug for Agent 6 is `platform-swiftui`; Agent 7 is `tests`; Agent 8 is `ux`.

## Phase 2 Caller Inputs

Use `lib/better-plan.md` and `lib/better-issue-mode.md` for the shared planning and issue-filing mechanics. The Swift plan uses these category mappings:

- Security → Security & Secrets → `security`
- Code Quality → Code Quality & Style → `code-quality`
- DRY & YAGNI → DRY & YAGNI → `dry`
- Architecture → Architecture & SOLID → `architecture`
- Bugs & Perf → Bugs, Performance & Error Handling → `bugs-perf`
- Platform & SwiftUI → Platform Coverage & SwiftUI Patterns → `platform-swiftui`
- Tests → Test Quality & Coverage → `tests`
- UX → UX Consistency & Responsive Layout → `ux`

The PLAN.md section is `## Better Swift Audit - {YYYY-MM-DD}` and includes `Platforms: {PLATFORMS} | Deployment targets: {DEPLOYMENT_TARGETS}`. Use the eight mappings above instead of the generic `Stack-Specific` or `Dependency Freedom` rows. Group repeated patterns duplicated at least three times as Foundation work, including design tokens, platform typealiases, view modifiers, networking clients, and environment keys. Build the complete `FILE_OWNER_MAP` before remediation; assign each file to one category by highest severity, and when extraction moves a Swift type add a backward-compatible `typealias` or import forwarding at its original path. In issue mode, keep the in-run plan in context, dedup against `EXISTING_ISSUES`, file every surviving scan-only finding, and use the shared spool/filer rules. Never open a worktree or write code for `--scan-only`.

## Phase 3 Caller Inputs

Use the shared remediation procedure and its `{BRANCH_PREFIX}` worktree setup: `WORKTREE_DIR=../better-swift-{DATE}` on `better-swift/{DATE}`. The shared rules must select a unique path, never delete or overwrite a pre-existing worktree, preserve unrelated changes, and operate without a prompt in default mode.

Foundation workers create only the shared utilities identified by Phase 2, compile them on every platform, and stage specific files. For Swift compatibility, prefer a `typealias` in the original file when a type moves, and commit with `refactor: add shared utilities for {purpose}`.

Use the shared Phase 3c worker fan-out and ownership map. Instantiate `lib/remediation-agent-template.md` with the following caller-specific guardrail input for every remediation worker:

```text
SWIFT-SPECIFIC GUARDRAILS:
- After each fix, verify the code compiles on all supported platforms: {PLATFORMS}
- Build commands: {BUILD_CMD}; per-platform commands are {BUILD_CMD_IOS}, {BUILD_CMD_MACOS}, and the other variables recorded in Phase 0
- Handle every platform in PLATFORMS when adding #if os(...) code
- Check DEPLOYMENT_TARGETS before using an OS-gated API
- Prefer SwiftUI-native solutions over UIKit/AppKit wrappers
- Prefer value types unless reference semantics are required
- Prefer Swift concurrency for new code
- Never introduce AnyView; use @ViewBuilder or Group
- Test light and dark color schemes when changing colors
- For a cited gotcha entry, read its FIX section in swift-gotchas.md and apply it as written
```

When categories overlap, keep one owner per file. Security takes priority on Keychain and data protection, Platform on conditional compilation, and UX on design tokens and shared components. A worker must read every spool file named by its finding ids before fixing, never remediate from index titles, and report skipped files rather than crossing ownership boundaries.

## Phase 4c Caller Inputs

Use the shared test-enhancement procedure in `lib/better-test-enhancement.md` for start-SHA capture, issue-mode test triage, the broken-test check, test counts, and `FILE_OWNER_MAP` updates. Agent 7's Swift findings are the test-audit input. The test enhancement agent receives `Project type: SwiftUI ({PLATFORMS})` and `{TEST_CMD}` and must:

- Match the project's existing XCTest or Swift Testing framework.
- Assert observable behavior, concrete values, state transitions, and Codable round trips rather than private implementation details or mere non-nil checks.
- Cover happy paths, empty and invalid input, boundaries, network and permission failures, and platform-specific branches.
- Run tests on every platform in `PLATFORMS`; use `@MainActor` for main-actor-isolated tests.
- Avoid `sleep`, order-dependent shared state, and tests coupled to user-facing copy instead of accessibility identifiers.
- Stage each test change, prove every new test fails against a temporary uncommitted break, restore the implementation immediately, verify the staged diff contains only intended tests, and commit as `test: {description of what's tested}`.

The shared phase must run `{TEST_CMD}` in `{WORKTREE_DIR}` after the agent, record `VACUOUS_TESTS_FIXED`, `WEAK_TESTS_STRENGTHENED`, `NEW_TEST_CASES`, and `NEW_TEST_FILES`, and assign new standalone test files to `tests` while leaving co-located tests with their owning category.

## Swift Code Review Checklist

Read `lib/swift-review-checklist.md` at Phase 4b, after the shared build and before PR creation. It is not needed for `--scan-only`.

!read lib/swift-review-checklist.md

## Version Bump Procedure

On `better-swift/{FIRST_CATEGORY}`, bump the aggregate `{LEVEL}` only after every category branch builds. For an SPM package, update a documented `VERSION` file or README version. For an Xcode project:

```bash
agvtool new-marketing-version {NEW_VERSION}
agvtool next-version -all
git diff --name-only -z -- '*.plist' '*.pbxproj' | xargs -0 git add
git commit -m "chore: bump version to {NEW_VERSION}"
```

## Final Summary Table

The rows Phase 7 prints, with every Swift category present:

| Category               | Findings | Fixed | Skipped | PR       | CI     | Review   |
|------------------------|----------|-------|---------|----------|--------|----------|
| Security & Secrets     | ...      | ...   | ...     | #number  | pass   | approved |
| Code Quality           | ...      | ...   | ...     | #number  | pass   | approved |
| DRY & YAGNI            | ...      | ...   | ...     | #number  | pass   | approved |
| Architecture           | ...      | ...   | ...     | #number  | pass   | approved |
| Bugs & Perf            | ...      | ...   | ...     | #number  | pass   | approved |
| Platform & SwiftUI     | ...      | ...   | ...     | #number  | pass   | approved |
| Tests                  | ...      | ...   | ...     | #number  | pass   | approved |
| UX                     | ...      | ...   | ...     | #number  | pass   | approved |
| TOTAL                  | ...      | ...   | ...     | N PRs    |        |          |

`{SUMMARY_TABLE_ROW_RULES}` is empty because every row always applies. The footer is:

Platforms verified: {PLATFORMS}
Deployment targets: {DEPLOYMENT_TARGETS}
