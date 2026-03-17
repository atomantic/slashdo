---
description: SwiftUI DevSecOps audit, remediation, test enhancement, per-category PRs, CI verification, and Copilot review loop with worktree isolation — optimized for multi-platform Swift/SwiftUI apps (iOS, macOS, watchOS, tvOS, visionOS)
argument-hint: "[--scan-only] [--no-merge] [path filter or focus areas]"
---

# Better Swift — Unified DevSecOps Pipeline for SwiftUI Apps

Run the full DevSecOps lifecycle optimized for Swift/SwiftUI multi-platform projects: audit the codebase with 7 deduplicated agents, consolidate findings, remediate in an isolated worktree, create **separate PRs per category** with SemVer bump, verify CI, run Copilot review loops, and merge.

Parse `$ARGUMENTS` for:
- **`--scan-only`**: run Phase 0 + 1 + 2 only (audit and plan), skip remediation
- **`--no-merge`**: run through PR creation (Phase 5), skip Copilot review and merge
- **Path filter**: limit scanning scope to specific directories or files
- **Focus areas**: e.g., "security only", "platform coverage and accessibility"

## Configuration

Before starting the pipeline, present the user with configuration options using `AskUserQuestion`:

```
AskUserQuestion([
  {
    question: "Which model profile for audit and remediation agents?",
    header: "Model",
    multiSelect: false,
    options: [
      { label: "Quality", description: "Opus for all agents — fewest false positives, best fixes (highest cost, 7+ Opus agents)" },
      { label: "Balanced (Recommended)", description: "Sonnet for audit and remediation — good quality at moderate cost" },
      { label: "Budget", description: "Haiku for audit, Sonnet for remediation — fastest and cheapest" }
    ]
  }
])
```

Record the selection as `MODEL_PROFILE` and derive agent models from this table:

| Agent Role | Quality | Balanced | Budget |
|------------|---------|----------|--------|
| Audit agents (7 Explore agents, Phase 1) | opus | sonnet | haiku |
| Remediation agents (general-purpose, Phase 3) | opus | sonnet | sonnet |

Derive two variables:
- `AUDIT_MODEL`: `opus` / `sonnet` / `haiku` based on profile
- `REMEDIATION_MODEL`: `opus` / `sonnet` / `sonnet` based on profile

When the resolved model is `opus`, **omit** the `model` parameter on the Agent/Task call so the agent inherits the session's Opus version. This avoids version conflicts when organizations pin specific Opus versions.

### Model Profile Rationale

Opus reduces false positives in audit (judgment-heavy). Sonnet is the floor for code-writing agents (remediation). Haiku works for fast first-pass pattern scanning but may produce more false positives — remediation agents (Sonnet+) validate before fixing.

## Compaction Guidance

When compacting during this workflow, always preserve:
- The `FILE_OWNER_MAP` (complete, not summarized)
- All CRITICAL/HIGH findings with file:line references
- The current phase number and what phases remain
- All PR numbers and URLs created so far
- `BUILD_CMD`, `TEST_CMD`, `PROJECT_TYPE`, `WORKTREE_DIR` values
- `VCS_HOST`, `CLI_TOOL`, `DEFAULT_BRANCH`, `CURRENT_BRANCH`
- `PLATFORMS` (list of supported platforms: iOS, macOS, etc.)
- `DEPLOYMENT_TARGETS` (minimum OS versions per platform)
- `BUILD_SYSTEM` (xcodebuild / swift build / xcodegen / tuist)
- `SCHEME`, `WORKSPACE_OR_PROJECT` (Xcode build identifiers)
- `PHASE_4C_START_SHA` (needed for FILE_OWNER_MAP update in Phase 4c.3)
- `VACUOUS_TESTS_FIXED`, `WEAK_TESTS_STRENGTHENED`, `NEW_TEST_CASES`, `NEW_TEST_FILES`
- `CREATED_CATEGORY_SLUGS` (list of branch slugs created in Phase 5)


## Phase 0: Discovery & Setup

Detect the project environment before any scanning or remediation.

### 0a: VCS Host Detection
Run `gh auth status` to check GitHub CLI. If it fails, run `glab auth status` for GitLab.
- Set `VCS_HOST` to `github` or `gitlab`
- Set `CLI_TOOL` to `gh` or `glab`
- If neither is authenticated, warn the user and halt

### 0b: Swift Project Type Detection
Check for Swift project manifests and determine the build system:
- `Package.swift` → Swift Package Manager (SPM)
- `*.xcodeproj` → Xcode project (check for SwiftUI, UIKit, AppKit usage)
- `*.xcworkspace` → Xcode workspace (check for CocoaPods or multi-project)
- `project.yml` → XcodeGen
- `Project.swift` → Tuist

Record the detected system as `BUILD_SYSTEM`.

Determine supported platforms by scanning:
1. **SPM**: Read `Package.swift` for `.iOS`, `.macOS`, `.watchOS`, `.tvOS`, `.visionOS` platform declarations
2. **Xcode project**: Run `xcodebuild -list` to get schemes and targets; then `xcodebuild -showBuildSettings -scheme {SCHEME}` to read `SUPPORTED_PLATFORMS` and `IPHONEOS_DEPLOYMENT_TARGET` / `MACOSX_DEPLOYMENT_TARGET` / etc.
3. **XcodeGen/Tuist**: Read `project.yml` / `Project.swift` for platform declarations

Record:
- `PLATFORMS`: list of supported platforms (e.g., `["iOS", "macOS"]`)
- `DEPLOYMENT_TARGETS`: map of platform → minimum version (e.g., `{"iOS": "16.0", "macOS": "13.0"}`)
- `SCHEME`: primary scheme name
- `WORKSPACE_OR_PROJECT`: path to `.xcworkspace` or `.xcodeproj`

Detect additional Swift project characteristics:
- SwiftUI vs UIKit/AppKit (check imports in source files)
- Core Data / SwiftData usage (`.xcdatamodeld` files or `@Model` declarations)
- Combine usage (`import Combine`, `@Published`, `AnyPublisher`)
- Swift concurrency adoption (`async`, `await`, `actor`, `@MainActor`)
- Widget extensions, App Intents, or other extension targets

Record as `PROJECT_TYPE` = "SwiftUI" with characteristics map.

### 0c: Build & Test Command Detection
Derive build and test commands from the build system:

**SPM project:**
```bash
BUILD_CMD="swift build"
TEST_CMD="swift test"
```

**Xcode project (single platform):**

First, derive an available simulator dynamically:
```bash
SIM_DEST=$(xcrun simctl list devices available -j | python3 -c "
import json, sys
devices = json.load(sys.stdin)['devices']
# Pick the first available iPhone from the latest runtime to avoid ambiguity
for rt in sorted(devices.keys(), reverse=True):
    for d in devices[rt]:
        if d['isAvailable'] and 'iPhone' in d['name']:
            print(f\"{d['name']},OS={rt.split('.')[-3].replace('SimRuntime-iOS-','').replace('-','.')}\")
            sys.exit(0)
print('iPhone 16')
")
```

Then construct the build and test commands. Execute these directly (not via shell variable expansion) to avoid quoting issues:
```bash
xcodebuild -scheme {SCHEME} -destination "generic/platform=iOS Simulator" build
xcodebuild -scheme {SCHEME} -destination "platform=iOS Simulator,name=$SIM_DEST" test
```

**Xcode project (multi-platform) — build and test for each platform in `PLATFORMS`:**
For each platform in `PLATFORMS`, derive the build and test commands:
- **iOS**: `BUILD_CMD_IOS="xcodebuild -scheme {SCHEME} -destination 'generic/platform=iOS Simulator' build"` / `TEST_CMD_IOS="xcodebuild -scheme {SCHEME} -destination 'platform=iOS Simulator,name=$SIM_DEST' test"`
- **macOS**: `BUILD_CMD_MACOS="xcodebuild -scheme {SCHEME} -destination 'platform=macOS' build"` / `TEST_CMD_MACOS="xcodebuild ... test"`
- **watchOS**: `BUILD_CMD_WATCHOS="xcodebuild -scheme {SCHEME} -destination 'generic/platform=watchOS Simulator' build"`
- **tvOS**: `BUILD_CMD_TVOS="xcodebuild -scheme {SCHEME} -destination 'generic/platform=tvOS Simulator' build"`
- **visionOS**: `BUILD_CMD_VISIONOS="xcodebuild -scheme {SCHEME} -destination 'generic/platform=visionOS Simulator' build"`

Only generate commands for platforms declared in `PLATFORMS`. Set `BUILD_CMD` to run all platform builds sequentially (joined with `&&`). Set `TEST_CMD` to run all platform tests. This ensures changes don't break any supported platform.

If the project has a `Makefile` or `fastlane/Fastfile`, check for custom build/test lanes and prefer those if they already handle multi-platform builds.

Record as `BUILD_CMD` and `TEST_CMD`.

### 0d: State Snapshot
- Record `CURRENT_BRANCH` via `git rev-parse --abbrev-ref HEAD`
- Record `DEFAULT_BRANCH` via `gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name'` (or `glab` equivalent)
- Record `IS_DIRTY` via `git status --porcelain`
- Check for `.changelogs/` or `.changelog/` directory → `HAS_CHANGELOG`
- Check for existing `../better-*` worktrees: `git worktree list`. If found, inform the user and ask whether to resume (use existing worktree) or clean up (remove it and start fresh)


<audit_instructions>

## Phase 1: Unified Audit

Project conventions are already in your context. Pass relevant conventions to each agent.

Launch 7 Explore agents in two batches. Each agent must report findings in this format:
```
- **[CRITICAL/HIGH/MEDIUM/LOW]** `file:line` - Description. Suggested fix: ... Complexity: Simple/Medium/Complex
```

**Context requirement.** Before flagging, read at least 30 lines of surrounding context to confirm the issue is real. Common false positives to watch for:
- A force unwrap that IS inside a `guard`/`precondition`-protected path where nil is truly impossible
- An `@ObservedObject` that IS correctly passed from a parent that owns the `@StateObject`
- A `try?` that IS intentionally ignoring the error because the operation is optional/best-effort
- A `#if os(iOS)` block that IS correctly omitting macOS because the feature genuinely doesn't apply to macOS
- A `Task {}` without explicit cancellation that IS inside a `.task` modifier (which auto-cancels)

If the surrounding context shows the code is correct, do NOT flag it.

If uncertain whether something is a genuine issue, report it as **[UNCERTAIN]** with your reasoning. The consolidation phase will evaluate these separately. Fewer confident findings is better than padding with questionable ones.

<approach>
For each potential finding:
1. Read the file and 30+ lines of surrounding context
2. Quote the specific code that demonstrates the issue
3. Explain why it's a problem given the context
4. Only then classify severity and suggest a fix
Skip step 4 if steps 1-3 reveal the code is correct.
</approach>

### Batch 1 (5 parallel Explore agents via Task tool):

**Model**: Pass `AUDIT_MODEL` as the `model` parameter on each agent. If `AUDIT_MODEL` is `opus`, omit the parameter to inherit from session.

1. **Security & Secrets**
   Sources: authentication checks, credential exposure, data protection, input validation, dependency health
   Focus: hardcoded credentials, API keys, exposed secrets in source or Info.plist, authentication bypasses, disabled security checks, PII exposure, insecure network configurations
   Swift-specific:
   - `NSAllowsArbitraryLoads` or domain-specific ATS exceptions in Info.plist without justification
   - Sensitive data in `UserDefaults` instead of Keychain (`SecItemAdd`/`SecItemCopyMatching`)
   - `os_log` / `Logger` with sensitive data not marked `privacy: .private`
   - Missing SSL pinning for high-security API endpoints
   - Exported URL schemes / universal links without input validation in `onOpenURL` or `application(_:open:)`
   - Unprotected Core Data / SwiftData stores (missing `NSPersistentStoreFileProtectionKey`)
   - Clipboard (`UIPasteboard`) operations exposing sensitive data
   - Missing data protection entitlement (`NSFileProtectionComplete`)
   - Biometric authentication (`LAContext`) without fallback and proper error handling
   Supply chain: `Package.resolved` committed and CI builds with `--disable-automatic-resolution`, SPM dependencies use `.upToNextMajor(from:)` not `.branch("main")`

2. **Code Quality & Style**
   Sources: code brittleness, convention violations, Swift idiom violations, logging & observability
   Focus: magic numbers, brittle conditionals, stringly-typed patterns, dead/unreachable code, unused imports/variables
   Swift-specific:
   - Classes where structs suffice (value semantics preferred in Swift)
   - Missing `final` on classes that shouldn't be subclassed
   - Overuse of `Any` / `AnyObject` instead of protocols or generics
   - Force unwraps (`!`) and force casts (`as!`) in production code
   - Implicit returns hiding complex logic — make multi-statement bodies explicit
   - `enum` raw values that don't add semantic meaning
   - Mutable `var` where `let` suffices
   - Closures capturing `self` strongly in long-lived contexts (subscriptions, NotificationCenter, async tasks)
   - Empty `catch` blocks or `try?` on operations where errors should surface
   - Missing structured logging — raw `print()` in production paths instead of `Logger`/`os_log`
   - Inconsistent error messages (different phrasing for similar failures)

3. **DRY & YAGNI**
   Sources: duplication patterns, speculative abstractions
   Focus: duplicate view modifiers, copy-paste view structs, redundant model definitions, repeated inline color/font definitions instead of design system constants
   Swift-specific:
   - Duplicate view modifier chains that should be custom `ViewModifier`s
   - Repeated color/font/spacing literals instead of design tokens (extension on `Color`, `Font`, or custom design system)
   - Copy-pasted networking code instead of a shared API client
   - Duplicate model types for the same API entity (one per screen/feature)
   - Speculative protocols with single conformers
   - Unused protocol requirements (conformers implement but nobody calls)
   - Premature abstraction: generic coordinator/router patterns for apps with 3 screens

4. **Architecture & SOLID**
   Sources: structural violations, coupling analysis, modularity, SwiftUI patterns
   Focus: god files >500 lines, views with business logic in `body`, mixed concerns
   Swift-specific:
   - Views containing network calls, data transformation, or business logic directly in `body` or `onAppear` — extract to view model or service
   - View models (ObservableObject / @Observable) with >20 published properties — split by feature
   - Tight coupling between views and specific data sources (Core Data fetch requests in views instead of repository pattern)
   - Missing dependency injection — views creating their own services instead of receiving them via `@Environment` or init parameters
   - Navigation logic spread across views instead of centralized (NavigationStack path management)
   - Circular dependencies between Swift packages/modules
   - Feature modules importing App-level dependencies instead of working through protocol abstractions
   - Preview-hostile architecture — views that can't be previewed without real network/database

5. **Bugs, Performance & Error Handling**
   Sources: runtime safety, memory management, async correctness, SwiftUI performance
   Focus: retain cycles, main thread violations, SwiftUI rendering performance
   Swift-specific:
   - Retain cycles: closures capturing `self` strongly in stored properties, Combine sinks, or long-lived `Task`s
   - Main thread violations: UI updates from background threads, `@Published` mutations off main actor
   - `@State` initialized from props (only reads initial value once)
   - `@StateObject` vs `@ObservedObject` misuse (ownership confusion)
   - `List` / `ForEach` with unstable `id` causing excessive view recreation
   - Missing `@ViewBuilder` on functions returning conditional views (type erasure with `AnyView` instead)
   - `GeometryReader` in `ScrollView` causing layout thrashing
   - Heavy computation in `body` (filtering, sorting, mapping large collections on every render)
   - Images loaded synchronously — use `AsyncImage` or pre-cached loading
   - Missing `.equatable()` or custom `Equatable` on views with expensive `body` computations
   - N+1 fetch patterns: `@FetchRequest` / `@Query` without relationship prefetching
   - Unbounded in-memory caches (`NSCache` without `countLimit`/`totalCostLimit`)
   - `Timer.publish()` or `DispatchSource` without invalidation — leaks and battery drain
   - `withAnimation` wrapping async operations — only synchronous state changes animate
   - Race conditions: concurrent `Task`s modifying shared `@State` without actor isolation
   - `Task.detached` with `[self]` (strong capture) — use `[weak self]` for cancelable work
   - Keychain operations (`SecItemAdd`/`SecItemCopyMatching`) that silently fail in Simulator test environments — add in-memory key cache as fallback so encrypt-then-decrypt roundtrips don't break in tests
   - `.foregroundStyle(.accentColor)` doesn't compile — `ShapeStyle` has no `.accentColor`; use `Color.accentColor` explicitly

### Batch 2 (2 agents after Batch 1 completes):

**Model**: Same `AUDIT_MODEL` as Batch 1.

6. **Platform Coverage & SwiftUI Patterns**
   This is the critical Swift-specific agent. Dynamically focus based on `PLATFORMS` detected in Phase 0.

   **Multi-platform coverage (ALL projects):**
   - For every `#if os(iOS)` or `#if os(macOS)` block: verify all declared platforms in `PLATFORMS` are handled. Missing `#else` for a supported platform = **[HIGH]** finding
   - UIKit types used unconditionally (`UIImage`, `UIColor`, `UIFont`, `UIScreen`) — use SwiftUI-native types or platform-conditional typealiases
   - `.navigationBarTitleDisplayMode()`, `.toolbar(.visible, for: .navigationBar)` — iOS-only modifiers applied in shared views without `#if os(iOS)`
   - `UIApplication.shared` references — unavailable on macOS; use `@Environment(\.openURL)` or `NSApplication` with platform check
   - Hardcoded `UIScreen.main.bounds` — use `GeometryReader` or environment values
   - Missing macOS keyboard shortcuts (`.keyboardShortcut()`) on primary actions
   - Missing macOS menu bar commands (`.commands {}` modifier on `WindowGroup`)
   - Missing hover states for macOS (`.onHover`)
   - Touch-specific interactions without pointer alternatives
   - Fixed sizes that don't adapt to Mac window resizing
   - Missing `Settings` scene for macOS apps
   - watchOS complications not updated, widget timelines not refreshed
   - visionOS: missing `.windowStyle(.volumetric)` or `.immersionStyle()` where appropriate

   **Build system & project configuration (when XcodeGen/Tuist detected):**
   - `GENERATE_INFOPLIST_FILE: false` with custom Info.plist missing standard keys (`CFBundleIdentifier`, `CFBundleExecutable`, `CFBundlePackageType`) — causes "Missing bundle ID" on simulator install despite correct `PRODUCT_BUNDLE_IDENTIFIER`. Fix: set `GENERATE_INFOPLIST_FILE: true` to let Xcode merge custom keys with generated ones
   - Preview Content directory with `buildPhase: none` excluding Swift files that are needed at runtime (e.g., `PreviewSampleData.swift` used via launch arguments) — only exclude the `.xcassets`, not the whole directory
   - `UILaunchScreen` key manually added to Info.plist but lost on `xcodegen generate` — XcodeGen regenerates the plist from `info.properties` only; put `UILaunchScreen: {}` in `project.yml` not the plist file. Missing this causes iOS letterbox/compatibility mode
   - Info.plist keys required for TestFlight upload that don't cause build failures: `UISupportedInterfaceOrientations` must include all 4 orientations for iPad multitasking (or declare `UIRequiresFullScreen`), and `CFBundleDocumentTypes` requires `LSSupportsOpeningDocumentsInPlace` — these are rejected server-side by `altool`, not at build time
   - CI upload actions (`apple-actions/upload-testflight-build`) that report success even when `altool` returns "UPLOAD FAILED" in XML plist output — always check raw upload logs, not just job status

   **iCloud & data persistence (when iCloud entitlements detected):**
   - `url(forUbiquityContainerIdentifier:)` returning non-nil does NOT mean the container is accessible — always verify with `createDirectory` + `contentsOfDirectory` using `do/catch` (not `try?`) and fall back to local Documents directory on failure
   - `try?` on iCloud file operations silently swallowing permission errors — app appears to work but reads/writes to inaccessible path with empty results

   **SwiftUI best practices (ALL projects):**
   - Deprecated APIs: `NavigationView` (use `NavigationStack`/`NavigationSplitView`), `onChange(of:perform:)` one-parameter form (use two-parameter), `.onAppear` for async work (use `.task`)
   - `@Environment` values accessed in `init()` — not available until view is in hierarchy
   - `@Binding` used where `let` suffices (read-only props don't need binding)
   - Sheet/alert presented via boolean when item-based presentation is cleaner
   - `AnyView` type erasure instead of `@ViewBuilder`, `Group`, or conditional modifiers
   - Missing `.animation()` or `.withAnimation()` for state transitions that should animate
   - Inconsistent use of `@Observable` (iOS 17+) vs `ObservableObject` — pick one per minimum deployment target
   - Missing Transferable conformance for drag & drop on shareable data types
   - `@AppStorage` with string keys that risk collision — use namespaced enum
   - View preview providers not covering: Dark Mode, largest Dynamic Type, RTL layout, smallest/largest device for each platform

   **Accessibility (ALL projects):**
   - Images without `.accessibilityLabel()` or `.accessibilityHidden(true)` for decorative images
   - Custom interactive views missing `.accessibilityAddTraits(.isButton)`
   - Dynamic Type not supported — hardcoded font sizes instead of `.font(.body)` or `@ScaledMetric`
   - Color-only indicators without shape/text alternatives
   - Tap targets smaller than 44x44pt without `.contentShape()` expansion
   - Missing `.accessibilityElement(children: .combine)` grouping
   - VoiceOver reading order not matching visual order
   - Animations not respecting `@Environment(\.accessibilityReduceMotion)`

   **Dark Mode & theming:**
   - Hardcoded colors (`.white`, `.black`, `Color(red:green:blue:)`) instead of semantic colors (`.primary`, `.secondary`, asset catalog colors with dark variant)
   - Assets without dark mode variants in asset catalog
   - `colorScheme` environment not tested in previews

7. **Test Quality & Coverage**
   Uses Batch 1 findings as context to prioritize.
   Focus areas:

   **Coverage gaps:**
   - Missing test files for critical modules, untested edge cases, tests that only cover happy paths
   - Areas with high complexity (identified by agents 1-5) but no tests
   - Remediation changes from agents 1-6 that lack corresponding test coverage
   - **Platform coverage in tests**: tests only run on one platform when the app supports multiple — verify `XCTest` targets include all supported platforms in their `destinations`

   **Swift-specific test gaps:**
   - Missing `Codable` round-trip tests (encode → decode → equality) for all model types
   - Missing view model state transition tests (initial → action → expected state)
   - Missing `@Published` / `@Observable` property change sequence tests
   - Missing `XCUITest` for critical navigation flows and platform-specific interactions
   - Missing preview coverage: all views should have `#Preview` for each platform × Dark Mode × Dynamic Type extremes
   - Missing error path tests for network failures, decode failures, and permission denials

   **Vacuous tests (tests that don't actually test anything):**
   - Tests that assert on mocked return values instead of real behavior (testing the mock, not the code)
   - Tests that only check truthiness (`XCTAssertNotNil(result)`) when they should verify specific values or shapes
   - Tests with assertions that can never fail (e.g., asserting a hardcoded value equals itself)
   - `XCTAssertTrue(true)` or `XCTAssert(result != nil)` when the function always returns non-nil
   - Tests that re-implement the logic under test instead of importing the real function

   **Weak test patterns:**
   - Tests that verify internal state instead of observable behavior
   - Tests where all assertions pass even if the function under test returns nil — verify by mentally substituting a no-op
   - Async tests using `sleep()` instead of `XCTestExpectation` or `async` test methods
   - Tests with shared mutable state between cases (`setUp` that doesn't reset, class-level properties)
   - Missing negative cases (invalid input, error paths, boundary conditions)
   - UI tests that depend on text content instead of accessibility identifiers

   Report each finding with a severity prefix `**[CRITICAL]**`, `**[HIGH]**`, `**[MEDIUM]**`, or `**[LOW]**` followed immediately by a quality prefix `[VACUOUS]`, `[WEAK]`, or `[MISSING]` (for example, `**[HIGH][VACUOUS]**`) to distinguish quality issues from coverage gaps while keeping the format consistent with other agents. Include the specific test name and file:line for existing test issues.

Wait for ALL agents to complete before proceeding.

</audit_instructions>

<plan_and_remediate>

## Phase 2: Plan Generation

1. Read the existing `PLAN.md` (create if it doesn't exist)
2. Consolidate all findings from Phase 1, deduplicating across agents (same file:line flagged by multiple agents → keep the most specific description)
3. Identify **shared utility extractions** — patterns duplicated 3+ times that should become reusable extensions, view modifiers, or utility types. Group these as "Foundation" work for Phase 3b.
4. **Build the file ownership map** (required by Phase 5 for conflict-free PRs):
   - For each finding, record which file(s) it touches
   - Assign each file to exactly ONE category (its primary category)
   - If a file is touched by multiple categories, assign it to the category with the highest-severity finding for that file
   - Record the mapping as `FILE_OWNER_MAP` — this ensures no two PRs modify the same file
   - If a module extraction creates a new file (e.g., extracting `NetworkClient.swift` from a view model), add a backward-compatible re-export (typealias or import forwarding) in the original file so other PRs don't break
5. Add a new section to PLAN.md: `## Better Swift Audit - {YYYY-MM-DD}`

```markdown
## Better Swift Audit - {date}

Summary: {N} findings across {M} files. {X} shared utilities to extract.
Platforms: {PLATFORMS} | Deployment targets: {DEPLOYMENT_TARGETS}

### Foundation — Shared Utilities
For each utility: name, purpose, files it replaces, signature sketch.

### File Ownership Map
| File | Primary Category | Reason |
For each file touched by multiple categories, document why it was assigned to one.

### Security & Secrets
- [ ] **[CRITICAL]** `file:line` - Description — Fix: ... (Complexity: Simple/Medium/Complex)

### Code Quality
- [ ] **[HIGH]** `file:line` - Description — Fix: ...

### DRY & YAGNI
- [ ] **[MEDIUM]** `file:line` - Description — Fix: ...

### Architecture & SOLID
### Bugs, Performance & Error Handling
### Platform Coverage & SwiftUI Patterns
### Test Quality & Coverage
```

6. Print a summary table (short labels → full category → branch slug):
   - Security → Security & Secrets → `security`
   - Code Quality → Code Quality & Style → `code-quality`
   - DRY & YAGNI → DRY & YAGNI → `dry`
   - Architecture → Architecture & SOLID → `architecture`
   - Bugs & Perf → Bugs, Performance & Error Handling → `bugs-perf`
   - Platform & SwiftUI → Platform Coverage & SwiftUI Patterns → `platform-swiftui`
   - Tests → Test Quality & Coverage → `tests`

```
| Category              | CRITICAL | HIGH | MEDIUM | LOW | Total |
|-----------------------|----------|------|--------|-----|-------|
| Security              | ...      | ...  | ...    | ... | ...   |
| Code Quality          | ...      | ...  | ...    | ... | ...   |
| DRY & YAGNI           | ...      | ...  | ...    | ... | ...   |
| Architecture          | ...      | ...  | ...    | ... | ...   |
| Bugs & Perf           | ...      | ...  | ...    | ... | ...   |
| Platform & SwiftUI    | ...      | ...  | ...    | ... | ...   |
| Tests                 | ...      | ...  | ...    | ... | ...   |
| TOTAL                 | ...      | ...  | ...    | ... | ...   |
```

**GATE: If `--scan-only` was passed, STOP HERE.** Print the summary and exit.

## Phase 3: Worktree Remediation

Only proceed with CRITICAL, HIGH, and MEDIUM findings for code remediation. LOW findings remain tracked in PLAN.md but are not auto-remediated. Test Quality & Coverage findings are handled separately in Phase 4c.

### 3a: Setup

1. If `IS_DIRTY` is true: `git stash --include-untracked -m "better-swift: pre-scan stash"`
2. Set `DATE` to today's date in YYYY-MM-DD format
3. Create the worktree:
   ```bash
   git worktree add ../better-swift-{DATE} -b better-swift/{DATE}
   ```
4. Set `WORKTREE_DIR` to `../better-swift-{DATE}`

### 3b: Foundation Utilities

This phase is done by the team lead (you) directly — NOT delegated to agents — because all subsequent agents depend on these files existing and compiling.

1. Create each shared utility file identified in Phase 2's "Foundation" section. Common Swift foundations:
   - Design system tokens: `Color` extension, `Font` extension, spacing constants
   - Platform-conditional typealiases: `PlatformImage`, `PlatformColor` for cross-platform code
   - Custom `ViewModifier`s for repeated modifier chains
   - Shared networking client or API endpoint definitions
   - Common `@Environment` keys

2. When extracting types from an existing file, **add a backward-compatible typealias** in the original file:
   ```swift
   // Re-export for backward compatibility (extracted to DesignTokens.swift)
   typealias AppColors = DesignSystem.Colors
   ```

3. Run `{BUILD_CMD}` in the worktree to verify compilation on ALL platforms:
   ```bash
   cd {WORKTREE_DIR} && {BUILD_CMD}
   ```
4. If build fails on any platform, fix issues before proceeding
5. Commit in the worktree:
   ```bash
   git -C {WORKTREE_DIR} add <specific files>
   git -C {WORKTREE_DIR} commit -m "refactor: add shared utilities for {purpose}"
   ```

If no shared utilities were identified, skip this step.

### 3c: Parallel Remediation

1. Use `TeamCreate` with name `better-swift-{DATE}`
2. Use `TaskCreate` for each category that has CRITICAL, HIGH, or MEDIUM findings. Possible categories:
   - Security & Secrets
   - Code Quality & Style
   - DRY & YAGNI
   - Architecture & SOLID
   - Bugs, Performance & Error Handling
   - Platform Coverage & SwiftUI Patterns
3. Only create tasks for categories that have actionable findings
4. Spawn up to 5 general-purpose agents as teammates. **Pass `REMEDIATION_MODEL` as the `model` parameter on each agent.** If `REMEDIATION_MODEL` is `opus`, omit the parameter to inherit from session.

### Agent instructions template:

!`cat ~/.claude/lib/remediation-agent-template.md`

**Additional Swift-specific instructions for ALL remediation agents:**

```
SWIFT-SPECIFIC GUARDRAILS:
- After each fix, verify the code compiles on ALL supported platforms: {PLATFORMS}
- Build commands: {BUILD_CMD} (runs all platforms; per-platform: {BUILD_CMD_IOS}, {BUILD_CMD_MACOS} as set in Phase 0c)
- When adding platform-conditional code (#if os(...)), always handle all platforms in PLATFORMS
- When using APIs gated by OS version, verify the deployment target supports it: {DEPLOYMENT_TARGETS}
- Prefer SwiftUI-native solutions over UIKit/AppKit wrappers
- Prefer value types (struct/enum) over reference types (class) unless reference semantics are needed
- Use Swift concurrency (async/await, actors) over GCD/Combine for new code
- Never introduce AnyView — use @ViewBuilder or Group instead
- Test both light and dark color schemes when modifying colors
```

### Conflict avoidance:
- Review all findings before task assignment. If two categories touch the same file, assign both sets of findings to the same agent.
- Security agent gets priority on Keychain/data protection; Platform agent gets priority on #if os(...) blocks.

</plan_and_remediate>

<verification_and_pr>

## Phase 4: Verification

After all agents complete:

1. Run the full build on ALL supported platforms:
   ```bash
   cd {WORKTREE_DIR} && {BUILD_CMD}
   ```
   This must succeed for every platform in `PLATFORMS`. A fix that works on iOS but breaks macOS is not acceptable.

2. Run tests on ALL supported platforms:
   ```bash
   cd {WORKTREE_DIR} && {TEST_CMD}
   ```
3. If build or tests fail on any platform:
   - Identify which commits caused the failure via `git bisect` or manual review
   - Attempt to fix in a new commit: `fix: resolve {platform} build/test failure from {category} changes`
   - If unfixable, revert the problematic commit(s): `git -C {WORKTREE_DIR} revert <sha>` and note which findings were skipped
4. Shut down all agents via `SendMessage` with `type: "shutdown_request"`
5. Clean up team via `TeamDelete`

## Phase 4b: Internal Code Review

Before creating PRs, run a deep code review on all remediation changes to catch issues that automated agents may have introduced.

1. Generate the diff of all changes in the worktree:
   ```bash
   cd {WORKTREE_DIR} && git diff {DEFAULT_BRANCH}...HEAD
   ```
2. Review the diff against the Swift-specific code review checklist:
   ```
   !`cat ~/.claude/lib/swift-review-checklist.md`
   ```
3. For each issue found:
   - Fix in a new commit: `fix: {description of review finding}`
   - Re-run `{BUILD_CMD}` and `{TEST_CMD}` on ALL platforms to verify
4. Present a summary of review findings and fixes to the user via `AskUserQuestion`:
   ```
   AskUserQuestion([{
     question: "Code review complete. {N} issues found and fixed. {list}. All {PLATFORMS} platforms build and test successfully. Proceed to PR creation?",
     options: [
       { label: "Proceed", description: "Create per-category PRs" },
       { label: "Commit directly", description: "Commit all changes to this branch — no PRs, no review loops" },
       { label: "Show diff", description: "Show the full diff for manual review before proceeding" },
       { label: "Abort", description: "Stop here — I'll review manually" }
     ]
   }])
   ```
5. If "Show diff" selected, print the diff and re-ask. If "Abort", stop and print the worktree path.
6. If "Commit directly" selected:
   - Stay in the worktree branch `better/{DATE}`
   - Stage all changes: `git add -A` in `{WORKTREE_DIR}`
   - Commit with a summary message: `fix: better audit remediation — {N} findings across {M} categories`
   - Switch back to `{CURRENT_BRANCH}` and merge the worktree branch:
     ```bash
     git checkout {CURRENT_BRANCH}
     git merge better/{DATE}
     ```
   - Clean up the worktree and branch, restore stash if needed, update PLAN.md, then **skip to Phase 7 cleanup** (no PRs, no Copilot review, no CI polling)

## Phase 4c: Test Enhancement

After internal code review passes, evaluate and enhance the project's test suite. This phase acts on Agent 7's findings AND ensures all remediation work from Phase 3 has proper test coverage.

### 4c.0: Record Start SHA

Before any test enhancement commits, capture the current HEAD so Phase 4c changes can be diffed later:
```bash
cd {WORKTREE_DIR}
PHASE_4C_START_SHA="$(git rev-parse HEAD)"
```

### 4c.1: Test Audit Triage

Review Agent 7 findings from Phase 1 and categorize them:

1. **`[VACUOUS]` findings** — tests that exist but don't test real behavior. These are the highest priority because they create a false sense of safety.
2. **`[WEAK]` findings** — tests that partially cover behavior but miss important cases. Strengthen with additional assertions and edge cases.
3. **`[MISSING]` findings** — no tests exist for critical paths. Write new test files or add test cases to existing files.

Additionally, scan all remediation changes from Phase 3:
- For each file modified by remediation agents, check if corresponding tests exist
- If tests exist, verify they cover the specific behavior that was fixed/changed
- If no tests exist for a remediated module, flag for new test creation

### 4c.2: Test Enhancement Execution

Spawn a general-purpose agent (using `REMEDIATION_MODEL`) in the worktree to fix and write tests. Populate the template placeholders below from Phase 4c.1 triage output: `{VACUOUS_AND_WEAK_FINDINGS}` from `[VACUOUS]`/`[WEAK]` findings, `{MISSING_FINDINGS}` from `[MISSING]` findings, and `{REMEDIATED_FILES_WITHOUT_TESTS}` from the remediation-change scan. The agent instructions:

```
You are a test enhancement agent working in {WORKTREE_DIR}.
Project type: SwiftUI ({PLATFORMS}). Test commands: {TEST_CMD}.

Your job is to fix weak/vacuous tests and write missing tests that verify REAL BEHAVIOR.

## Rules for writing good Swift tests

1. **Test observable behavior, not implementation.** Assert on return values, published property changes, and view model state transitions — never on internal variable names or private method invocations.

2. **Every assertion must be falsifiable.** For each assertion you write, mentally substitute a broken implementation (returns nil, returns wrong value, throws instead of succeeding). If your assertion would still pass, it's vacuous — rewrite it.

3. **Prefer real modules over mocks.** Only mock at system boundaries (network, file system, Keychain). If you must mock, use protocols and assert on the arguments passed TO the mock.

4. **Test the edges.** Each test function needs at minimum:
   - Happy path with specific expected output
   - nil/empty input handling
   - Invalid input that should error
   - Boundary values (0, -1, empty string vs nil, empty array vs nil)

5. **Use concrete expected values.** `XCTAssertEqual(result, "expected string")` not `XCTAssertNotNil(result)`. `XCTAssertEqual(viewModel.items.count, 3)` not `XCTAssertTrue(viewModel.items.count > 0)`.

6. **One behavior per test.** Each test method tests exactly one scenario. The test name describes the scenario: `test_fetchUsers_whenNetworkFails_setsErrorState()`.

7. **No shared mutable state.** Each test must be independently runnable. Use `setUp()` to create fresh fixtures. Never rely on test execution order.

8. **Multi-platform test coverage.** Ensure test targets include destinations for ALL platforms in {PLATFORMS}. If a feature is platform-specific (#if os(iOS)), the test should also be platform-specific.

9. **Async testing.** Use Swift's async test support (`func testX() async throws {}`) instead of `XCTestExpectation` + `waitForExpectations` for new tests. Use `@MainActor` on tests that verify main-actor-isolated state.

10. **Codable round-trip tests.** For every Codable model, test encode → decode → equality. Test with missing optional fields and extra unknown fields.

## Task list

Fix these vacuous/weak tests:
{VACUOUS_AND_WEAK_FINDINGS}

Write tests for these gaps:
{MISSING_FINDINGS}

Write tests for these remediated files:
{REMEDIATED_FILES_WITHOUT_TESTS}

## Verification

After writing/fixing each test file:
1. Run `{TEST_CMD}` (ALL platforms) to verify all tests pass
2. For each NEW test, verify that it fails when the behavior under test is wrong:
   - Stage your test changes so they are protected: `git add path/to/TestFile.swift`
   - Confirm your staged diff only includes the intended test changes: `git diff --cached`
   - Confirm there are no other unstaged changes in the worktree: `git diff` is clean
   - Apply a small, obvious, and **uncommitted** change to the code under test (e.g., return a constant, flip a conditional)
   - Run `{TEST_CMD}` and confirm the new test FAILS
   - Immediately restore only the temporary code change:
     - `git restore path/to/CodeUnderTest.swift` **or**
     - `git checkout HEAD -- path/to/CodeUnderTest.swift`
   - Confirm the worktree has no remaining unstaged changes and staged test changes are still present
   This is the key quality gate — a test that does not fail when the code is broken is worthless.
3. After confirming the temporary code change is reverted and only test changes are staged, commit: `test: {description of what's tested}`
```

### 4c.3: Verification

After the test agent completes:

1. Run the full test suite on ALL platforms:
   ```bash
   cd {WORKTREE_DIR} && {TEST_CMD}
   ```
2. If tests fail, fix in a new commit
3. Count new/fixed tests and record four variables:
   - `VACUOUS_TESTS_FIXED` — number of vacuous tests fixed
   - `WEAK_TESTS_STRENGTHENED` — number of weak tests strengthened
   - `NEW_TEST_CASES` — number of new test cases added
   - `NEW_TEST_FILES` — number of new test files created
4. **Update `FILE_OWNER_MAP`** — Phase 4c may have created or modified test files that were not in the Phase 2 map. Before Phase 5 assembles branches:
   - List all files changed by Phase 4c commits: `git diff --name-only "$PHASE_4C_START_SHA"..HEAD`
   - For each file not already in `FILE_OWNER_MAP`, assign it to the `tests` category
   - For each file already owned by another category, leave it in that category (co-located test changes ship with the code they test — the `tests` branch only contains standalone test files not owned by other categories)

## Phase 5: Per-Category PR Creation

Instead of one mega PR, create **separate branches and PRs for each category**. This enables independent review, targeted CI, and granular merge decisions.

### 5a: Build the Category Branches

Using the `FILE_OWNER_MAP` from Phase 2 (updated in Phase 4c.3), create one branch per category.

Initialize `CREATED_CATEGORY_SLUGS=""` (empty space-delimited string). After each category branch is successfully created and pushed below, append its slug: `CREATED_CATEGORY_SLUGS="$CREATED_CATEGORY_SLUGS {CATEGORY_SLUG}"`. Phase 7 uses this as the set of candidate branches for cleanup; when deleting branches, either run cleanup only after all desired merges are complete or explicitly verify that each branch in `CREATED_CATEGORY_SLUGS` has been merged before deleting it.

For each category that has findings:
1. Switch to `{DEFAULT_BRANCH}`: `git checkout {DEFAULT_BRANCH}`
2. Create a category branch: `git checkout -b better-swift/{CATEGORY_SLUG}`
   - Use slugs: `security`, `code-quality`, `dry`, `architecture`, `bugs-perf`, `platform-swiftui`, `tests`
3. For each file assigned to this category in `FILE_OWNER_MAP`:
   - **Modified files**: `git checkout better-swift/{DATE} -- {file_path}`
   - **New files (Added)**: `git checkout better-swift/{DATE} -- {file_path}`
   - **Deleted files**: `git rm {file_path}`
4. Commit all staged changes with a descriptive message:
   ```bash
   git commit -m "{prefix}: {category summary}"
   ```
5. Push the branch: `git push -u origin better-swift/{CATEGORY_SLUG}`

**File isolation rule** (one file per branch) — each file must appear in exactly ONE branch. If a file has changes from multiple categories (e.g., `ContentView.swift` with both platform and architecture changes), assign the whole file to one category based on the file ownership map. Do not split file-level changes across PRs.

**Cross-PR dependency check** — verify each branch builds independently on ALL platforms:
```bash
git checkout better-swift/{CATEGORY_SLUG} && {BUILD_CMD}
```
If a branch fails because it imports from a new type created in another branch:
- Add a backward-compatible typealias in the original file (in the branch that has the original file)
- Or move the new file to the branch that needs it
- Or revert the import change to use the original type path

### 5b: Version Bump

Only if ALL category branches pass build on ALL platforms:
1. Set `FIRST_CATEGORY` to the first category slug that has a branch (e.g., `security` if it exists, otherwise the next in order)
2. Analyze all commits across ALL category branches to determine the aggregate SemVer bump:
   - Any `breaking:` or `BREAKING CHANGE` → **major**
   - Any `feat:` → **minor**
   - Otherwise (fix:, refactor:, security:, chore:) → **patch**
3. Bump the version on that branch. For Swift projects:

   **SPM package (no Xcode project):**
   If the project uses a `VERSION` file or documents version in README, update it.

   **Xcode project:**
   ```bash
   git checkout better-swift/{FIRST_CATEGORY}
   # Bump CFBundleShortVersionString (marketing version)
   agvtool new-marketing-version {NEW_VERSION}
   # Bump CFBundleVersion (build number)
   agvtool next-version -all
   git diff --name-only -z -- '*.plist' '*.pbxproj' | xargs -0 git add  # stage only files agvtool modified
   git commit -m "chore: bump version to {NEW_VERSION}"
   git push
   ```

4. If `HAS_CHANGELOG`, update changelog and include in the commit.

### 5c: Create PRs

For each category branch, create a PR:

**GitHub:**
```bash
gh pr create --head better-swift/{CATEGORY_SLUG} --base {DEFAULT_BRANCH} \
  --title "{prefix}: {short description}" \
  --body "$(cat <<'EOF'
## Better Swift Audit — {Category Name}

### Summary
{count} findings addressed across {files} files.
Platforms verified: {PLATFORMS}

### Changes
{bulleted list of changes with severity levels}

### Files Modified
{list of files}

### Platform Impact
{which platforms are affected by these changes, any platform-specific notes}

### Merge Order
{dependency info if applicable, e.g., "Depends on Security PR for shared helper exports" or "Independent — can be merged in any order"}
EOF
)"
```

**GitLab:**
```bash
glab mr create --source-branch better-swift/{CATEGORY_SLUG} --target-branch {DEFAULT_BRANCH} \
  --title "{prefix}: {short description}" --description "..."
```

Record all `PR_NUMBERS` and `PR_URLS` in a map: `{category: {number, url}}`.

**GATE: If `--no-merge` was passed, STOP HERE.** Print all PR URLs and summary.

**GATE: If `VCS_HOST` is `gitlab`, STOP HERE.** Print all MR URLs and summary. GitLab does not support the Copilot review loop.

## Phase 5d: CI Verification

After creating all PRs, verify CI passes on each one:

1. Wait 30 seconds for CI to start
2. For each PR, poll CI status:
   ```bash
   gh pr checks {PR_NUMBER}
   ```
   Poll every 30 seconds, max 10 minutes per PR.

3. If CI **passes** on all PRs → proceed to Phase 6

4. If CI **fails** on any PR:
   a. Fetch the failure logs:
      ```bash
      gh run view {RUN_ID} --job {JOB_ID} --log-failed
      ```
   b. Analyze the failure — common Swift CI causes:
      - **Missing imports**: a file imports a type from another PR's branch. Fix by adding a typealias or reverting the import.
      - **Platform build failure**: a change compiles on iOS but not macOS (or vice versa). Add `#if os(...)` guard.
      - **Test failures**: a test depends on code changed in the PR. Fix the test or the code.
      - **Code signing**: ignore code signing failures in CI if not configured — these are environment-specific.
   c. Switch to the failing branch:
      ```bash
      git checkout better-swift/{CATEGORY_SLUG}
      ```
   d. Make the fix, commit, and push:
      ```bash
      git add <specific files>
      git commit -m "fix: resolve CI failure - {description}"
      git push
      ```
   e. Re-poll CI until it passes or max retries (3) are exhausted
   f. If CI still fails after 3 fix attempts, inform the user and continue with other PRs

## Phase 6: Copilot Review Loop (GitHub only)

Loop until Copilot returns zero new comments (no fixed iteration limit). Sub-agents enforce a 10-iteration guardrail: at iteration 10 the sub-agent stops and returns a "guardrail" status, prompting the parent agent to ask the user whether to continue or stop.

**Sub-agent delegation** (prevents context exhaustion): delegate each PR's review loop to a **separate general-purpose sub-agent** via the Agent tool. Launch sub-agents in parallel (one per PR). Each sub-agent runs the full loop (request → wait → check → fix → re-request) autonomously and returns only the final status.

### 6.1: Launch parallel sub-agents (one per PR)

For each PR, spawn a general-purpose sub-agent using the shared review loop template:

!`cat ~/.claude/lib/copilot-review-loop.md`

Pass each sub-agent the PR-specific variables: `{PR_NUMBER}`, `{OWNER}/{REPO}`, `better-swift/{CATEGORY_SLUG}`, and `{BUILD_CMD}`.

**Additional Swift-specific instruction for review loop agents:** After each fix, verify the code compiles on ALL platforms: `{BUILD_CMD}`. If a Copilot suggestion would break another platform, add a platform-conditional implementation instead.

Launch all PR sub-agents in parallel. Wait for all to complete.

### 6.2: Handle sub-agent results

For each sub-agent result:
- **clean**: mark PR as ready to merge
- **timeout**: inform the user "Copilot review timed out on PR #{number}." and ask whether to continue waiting, re-request, or skip
- **error**: inform the user and ask whether to retry or skip
- **guardrail**: the sub-agent hit the 10-iteration limit; ask the user whether to continue with more iterations or stop

### 6.3: Merge Gate (MANDATORY)

**Do NOT merge any PR until Copilot review has completed (approved or commented) on ALL PRs, or the user explicitly approves skipping.**

Present the review status summary to the user via `AskUserQuestion`:
```
AskUserQuestion([{
  question: "Copilot review status:\n{for each PR: #number - status (approved/comments/pending/timeout)}\n\nAll PRs verified on: {PLATFORMS}\n\nHow would you like to proceed?",
  options: [
    { label: "Merge approved PRs", description: "Merge only PRs with passing review" },
    { label: "Merge all", description: "Merge all PRs regardless of review status" },
    { label: "Wait", description: "Wait longer for pending reviews" },
    { label: "Don't merge", description: "Leave PRs open for manual review" }
  ]
}])
```

Only proceed with merging based on the user's selection. Never auto-merge without user confirmation.

### 6.4: Merge

For each PR approved for merge (in dependency order if applicable):
```bash
gh pr merge {PR_NUMBER} --merge
```

Verify each merge:
```bash
gh pr view {PR_NUMBER} --json state,mergedAt
```

If merge fails (e.g., branch protection, merge conflicts from a prior PR):
- If merge conflict: rebase the branch and retry
  ```bash
  git checkout better-swift/{CATEGORY_SLUG}
  git pull --rebase origin {DEFAULT_BRANCH}
  git push --force-with-lease
  ```
  Then re-run CI check before merging.
- If branch protection: inform the user and suggest manual merge

</verification_and_pr>

## Phase 7: Cleanup

1. Remove the worktree:
   ```bash
   git worktree remove {WORKTREE_DIR}
   ```
2. Delete the local staging branch and per-category branches (local + remote). Use the tracked list of branches from Phase 5 rather than a fixed list:
   ```bash
   git checkout {DEFAULT_BRANCH}
   git branch -D better-swift/{DATE}
   # CREATED_CATEGORY_SLUGS is a space-delimited string, e.g. "security code-quality tests"
   for slug in $CREATED_CATEGORY_SLUGS; do
     git branch -d "better-swift/$slug" || echo "warning: local branch better-swift/$slug not found or not fully merged — skipping (use -D to force)"
     git push origin --delete "better-swift/$slug" || echo "warning: remote branch better-swift/$slug not found or already deleted"
   done
   ```
   `-D` (force delete) is used only for the staging branch `better-swift/{DATE}` because it is intentionally unmerged — its file contents are cherry-picked into category branches. Category branches use `-d` (safe delete) so that unmerged work is not accidentally lost; if a category branch was not merged, the warning will surface it. The guards prevent errors from interrupting cleanup.
3. Restore stashed changes (if stashed in Phase 3a):
   ```bash
   git stash pop
   ```
4. Update PLAN.md:
   - Mark completed findings with `[x]`
   - Add PR links to each category section header
   - Note any skipped findings with reasons
5. Print the final summary table:

```
| Category               | Findings | Fixed | Skipped | PR       | CI     | Review   |
|------------------------|----------|-------|---------|----------|--------|----------|
| Security & Secrets     | ...      | ...   | ...     | #number  | pass   | approved |
| Code Quality           | ...      | ...   | ...     | #number  | pass   | approved |
| DRY & YAGNI            | ...      | ...   | ...     | #number  | pass   | approved |
| Architecture           | ...      | ...   | ...     | #number  | pass   | approved |
| Bugs & Perf            | ...      | ...   | ...     | #number  | pass   | approved |
| Platform & SwiftUI     | ...      | ...   | ...     | #number  | pass   | approved |
| Tests                  | ...      | ...   | ...     | #number  | pass   | approved |
| TOTAL                  | ...      | ...   | ...     | N PRs    |        |          |

Platforms verified: {PLATFORMS}
Deployment targets: {DEPLOYMENT_TARGETS}

Test Enhancement Stats:
- Vacuous tests fixed: {VACUOUS_TESTS_FIXED}
- Weak tests strengthened: {WEAK_TESTS_STRENGTHENED}
- New test cases added: {NEW_TEST_CASES}
- New test files created: {NEW_TEST_FILES}
```

## Error Recovery

- **Agent failure**: continue with remaining agents, note gaps in the summary
- **Build failure in worktree**: attempt fix in a new commit; if unfixable, revert problematic commits and ask the user
- **Platform-specific build failure**: add `#if os(...)` guards; if the fix only works on one platform, wrap in availability check
- **Push failure**: `git pull --rebase --autostash` then retry push
- **CI failure on PR**: investigate logs, fix in a new commit, push, re-check (max 3 attempts per PR)
- **Cross-PR dependency breakage**: add backward-compatible typealiases or move shared files to the PR that creates them
- **Copilot timeout** (review not received within decreasing timeout window): inform user, offer to merge without review approval or wait longer
- **Copilot review loop exceeds 10 iterations per PR**: sub-agent hits guardrail and reports back; ask user whether to continue or stop
- **Existing worktree found at startup**: ask user — resume (reuse worktree) or cleanup (remove and start fresh)
- **No findings above LOW**: skip Phases 3-7, print "No actionable findings" with the LOW summary
- **Merge conflict after prior PR merged**: rebase the branch onto the updated default branch, push with `--force-with-lease`, re-run CI
- **Code signing errors in CI**: ignore unless the project has CI code signing configured — flag to user as informational

!`cat ~/.claude/lib/graphql-escaping.md`

## Notes

- This command is optimized for Swift/SwiftUI multi-platform projects but adapts to the specific platforms declared in the project
- All remediation happens in an isolated worktree — the user's working directory is never modified
- **One PR per category** — each category gets its own branch and PR for independent review and merge
- Each file appears in exactly ONE PR (file ownership map) to prevent merge conflicts between PRs
- When extracting types, always add backward-compatible typealiases in the original file to prevent cross-PR breakage
- Version bump uses `agvtool` for Xcode projects or manual file updates for SPM-only packages
- Only CRITICAL, HIGH, and MEDIUM findings are auto-remediated for code categories; LOW findings remain tracked in PLAN.md
- Test Quality & Coverage findings are remediated in Phase 4c with a dedicated test enhancement agent that verifies tests fail when code is broken
- **Every build and test verification runs on ALL supported platforms** — a fix that works on iOS but breaks macOS is not acceptable
- Agent 6 (Platform Coverage & SwiftUI Patterns) is the differentiator from the generic `do:better` — it ensures multi-platform parity, catches deprecated SwiftUI APIs, and verifies accessibility compliance
- GitLab projects skip the Copilot review loop entirely (Phase 6) and stop after MR creation
- CI must pass on each PR before requesting Copilot review or merging
