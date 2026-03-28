<!--
  Triage: Check Tiers 1 and 4 for every file. Check Tier 2/3 only when
  the relevance filter matches the changed code. This prevents important
  checks from being lost in a long list.
-->

## Tier 1 — Always Check (Runtime Crashes, Security, Hygiene)

   **Hygiene**
   - Leftover debug code (`print()`, `debugPrint()`, `dump()`, `#if DEBUG` blocks with side effects), hardcoded secrets/credentials, and uncommittable files (`.xcuserdata`, `Pods/`, `.build/`, `DerivedData/`)
   - Overly broad changes that should be split into separate PRs

   **Imports & references**
   - Every symbol used is imported; no unused imports introduced. Check framework availability — `import SwiftUI` vs `import UIKit` vs `import AppKit` — ensure the correct framework is imported per target platform
   - References to system symbols that require minimum deployment target verification (e.g., `NavigationStack` requires iOS 16+, `@Observable` requires iOS 17+, `onChange(of:initial:)` two-parameter form requires iOS 17+)

   **Runtime correctness**
   - Force unwraps (`!`) outside of `fatalError`-guarded paths and test code — use `guard let`, `if let`, or nil coalescing (`??`) instead
   - Force casts (`as!`) — use `as?` with guard/if-let
   - Implicitly unwrapped optionals (`var x: Type!`) outside of `@IBOutlet` (legacy UIKit) — use proper optionals
   - Array index access without bounds checking — use `indices.contains()`, `.first`, `.last`, or safe subscript extensions
   - Unowned references in closures where the captured object may be deallocated — prefer `[weak self]` with guard
   - `@State` initialized from external values in `init()` — SwiftUI only reads the initial `@State` value once; subsequent parent re-renders won't update it. Use `@Binding` or pass through `.onAppear`/`.onChange`
   - `@StateObject` vs `@ObservedObject` confusion — `@StateObject` owns the lifecycle (create once), `@ObservedObject` does not (parent owns it). Using `@ObservedObject` for locally-created objects causes re-creation on every view update
   - Accessing `@Environment` values in `init()` — environment values are not available until the view is in the hierarchy. Move to `onAppear` or use them in `body`
   - `@Published` properties on `@MainActor`-isolated classes mutated from background threads — use `MainActor.run {}` or ensure mutations happen on main actor
   - View `body` accessing optionals without nil checks that cause preview/runtime crashes

   **API & URL safety**
   - User-supplied strings interpolated into URL paths without `addingPercentEncoding(withAllowedCharacters:)` — use `URLComponents` for safe URL construction
   - `URL(string:)` force-unwrapped — returns nil for malformed strings; always guard
   - `UserDefaults` keys as string literals scattered across files — centralize in an enum or extension to prevent typo-based silent failures
   - Keychain access without proper error handling — `SecItemCopyMatching` returns `OSStatus`, not throwing errors
   - File paths constructed with string concatenation instead of `URL.appendingPathComponent()` — breaks on spaces and special characters

   **Trust boundaries & data exposure**
   - Sensitive data (tokens, PII) stored in `UserDefaults` (unencrypted plist) instead of Keychain
   - `NSLog` or `os_log` with interpolated sensitive data — use `Logger` with appropriate privacy levels: `\(sensitiveValue, privacy: .private)`
   - App Transport Security exceptions in Info.plist without justification — `NSAllowsArbitraryLoads` disables TLS verification
   - Clipboard (`UIPasteboard`) reading/writing PII without user intent
   - Exported URL schemes or universal links without input validation — deep links can be triggered by malicious apps

## Tier 2 — Check When Relevant (Data Integrity, Async, Error Handling)

   **Async & state consistency** _[applies when: code uses async/await, Combine, or Task]_
   - `Task {}` in view body or `onAppear` without cancellation handling — store in `@State` and cancel in `onDisappear` or use `.task` modifier (auto-cancels)
   - `Task { @MainActor in }` when `@MainActor` is already inherited — redundant isolation
   - `.task` modifier without checking `Task.isCancelled` in long-running operations — view disappearance won't stop the work
   - Combine publishers not stored in `cancellables` — subscriptions immediately deallocate
   - `async let` bindings not awaited on all code paths — compiler warns but concurrent work continues silently
   - `@MainActor` annotation missing on `ObservableObject` subclasses that publish UI state — race conditions on property updates
   - Calling `objectWillChange.send()` from background threads on `ObservableObject` — must be on main thread
   - `withAnimation` wrapping async work — only the synchronous state change animates, not the async completion
   - Detached tasks (`Task.detached`) that capture `self` strongly — use `[weak self]` or ensure the task is bounded

   **Error handling** _[applies when: code has do/catch, Result, or throws]_
   - `try?` silently discarding errors on operations that should surface failures to the user — use `do/catch` with user-facing alert/toast
   - Generic `catch` blocks without logging or user notification — at minimum log with `Logger`
   - `fatalError()` or `preconditionFailure()` in production code paths (acceptable only in `default` cases of exhaustive switches that should never be reached)
   - Throwing functions called from `Task {}` without `do/catch` — unhandled errors crash silently in structured concurrency
   - Network errors not distinguished from parsing errors — user sees "something went wrong" for both offline and malformed response

   **Resource management** _[applies when: code uses observers, NotificationCenter, timers, or Core Data]_
   - `NotificationCenter.addObserver` without corresponding removal — use `Task` with `AsyncSequence` or store the `AnyCancellable`
   - `Timer.scheduledTimer` without invalidation on view disappearance
   - Core Data `NSManagedObjectContext` operations on wrong thread — use `perform {}` or `performAndWait {}`
   - `FileManager` operations without error handling — `removeItem`, `moveItem` throw on failure
   - `AVAudioSession` / `CLLocationManager` / `UNUserNotificationCenter` not deactivated when no longer needed

   **Validation & consistency** _[applies when: code handles user input, Codable, or API contracts]_
   - `Codable` structs with non-optional properties for fields the API may omit — use optionals or provide `init(from:)` with default values
   - `CodingKeys` enum missing entries for newly added properties — causes silent encoding/decoding omission
   - `JSONDecoder.dateDecodingStrategy` mismatch between encode and decode
   - `@AppStorage` property wrappers with keys that collide across different features — namespace with feature prefix
   - Enum cases used in `Codable` without `String` raw values — auto-synthesized raw values break when cases are reordered
   - `Identifiable` conformance using unstable IDs (array index, computed property) — causes SwiftUI diff thrashing

   **Concurrency & data integrity** _[applies when: code uses actors, shared state, or concurrent access]_
   - `nonisolated` methods on actors accessing actor-isolated state without `await` — compiler catches most, but `nonisolated(unsafe)` bypasses checks
   - Global mutable state (`static var` on classes/structs) without actor isolation or locks — use `@MainActor` or an actor
   - `Sendable` conformance on classes with mutable stored properties — use `@unchecked Sendable` only with internal synchronization
   - Core Data or Realm objects passed across actor boundaries — managed objects are not thread-safe; pass object IDs and re-fetch

## Tier 3 — Domain-Specific (Check Only When File Type Matches)

   **SwiftUI views** _[applies when: code modifies SwiftUI View structs]_
   - View `body` exceeding ~30 lines without extraction into subviews or computed properties — hurts readability and compile times
   - Heavy computation in `body` — extract to `onAppear`, `.task`, or computed properties
   - `NavigationView` usage (deprecated iOS 16+) — migrate to `NavigationStack` / `NavigationSplitView`
   - `.sheet` / `.alert` / `.confirmationDialog` with boolean binding when item binding is more appropriate — boolean requires manual state management
   - `List` with `ForEach` using index-based `id` instead of stable `Identifiable` conformance — causes incorrect cell reuse
   - Missing `.listStyle()`, `.buttonStyle()`, or `.pickerStyle()` modifiers that default differently across platforms
   - `GeometryReader` used where `frame()` or layout modifiers suffice — GeometryReader has greedy sizing behavior
   - Modifier ordering that changes behavior: `.padding()` before `.background()` vs after — padding is inside vs outside the background
   - Hard-coded `.frame(width:height:)` values that break on different screen sizes — prefer relative sizing, `fixedSize()`, or `frame(minWidth:idealWidth:maxWidth:)`
   - Custom `PreferenceKey` without `reduce` implementation that preserves all values — default `reduce` keeps only the last value

   **Multi-platform** _[applies when: project targets multiple Apple platforms]_
   - `#if os(iOS)` / `#if os(macOS)` blocks missing coverage for a declared target platform — if the project supports both iOS and macOS, every platform-conditional block must handle both (or have a sensible `#else`)
   - `UIKit` types (`UIImage`, `UIColor`, `UIFont`) used unconditionally — use SwiftUI-native types (`Image`, `Color`, `Font`) or typealias wrappers with `#if canImport(UIKit)` / `#if canImport(AppKit)`
   - `.navigationBarTitleDisplayMode()` (iOS-only) applied unconditionally in shared views — wrap in `#if os(iOS)`
   - Hardcoded `UIScreen.main.bounds` — not available on macOS; use `GeometryReader` or `@Environment(\.horizontalSizeClass)`
   - Missing keyboard shortcuts (`.keyboardShortcut()`) on macOS menu items and primary actions
   - Missing `focusable()` / `onMoveCommand` / `onExitCommand` for tvOS if supported
   - Scene types (`WindowGroup`, `Settings`, `MenuBarExtra`, `DocumentGroup`) not appropriate for the target platform
   - `UserInterfaceIdiom` checks without handling `.mac` / `.pad` / `.vision` appropriately
   - Touch-specific gestures (drag, long press) without pointer/hover alternatives for macOS
   - Missing `#if targetEnvironment(macCatalyst)` handling when running iPad apps on Mac
   - **macOS window lifecycle (App Store Guideline 4):**
     - Missing `NSApplicationDelegate` with `applicationShouldTerminateAfterLastWindowClosed` returning `false` — app quits when the user closes the window instead of staying in the Dock
     - Missing `applicationShouldHandleReopen(_:hasVisibleWindows:)` — clicking the Dock icon or Finder menu does nothing when the main window is closed
     - `WindowGroup` without a stable `id:` parameter (e.g., `WindowGroup(id: "main")`) — prevents programmatic window reopening via `openWindow(id:)`
     - Missing "Show Main Window" menu command (typically Cmd+0) in the Window menu — users have no way to recover the main window from the menu bar
     - Missing `reopenWindow` closure bridge between `NSApplicationDelegate` and SwiftUI's `@Environment(\.openWindow)` — AppKit delegate can't create new SwiftUI windows
     - Menu bar commands (File > New, Edit actions) that don't ensure the main window is visible before acting — commands fire but the user sees nothing

   **Data persistence** _[applies when: code uses Core Data, SwiftData, or file storage]_
   - `@FetchRequest` or `@Query` without sort descriptors — undefined ordering across launches
   - Core Data model versioning — schema changes without migration mapping model corrupt existing user data
   - SwiftData `@Model` classes with stored properties that aren't supported types — causes silent failures
   - `FileManager.default.urls(for:in:)` using wrong search path domain (`.userDomainMask` vs `.documentDirectory`) for the content type
   - iCloud container access via `url(forUbiquityContainerIdentifier:)` returning non-nil but inaccessible path — always verify write access, don't trust the URL alone
   - Documents directory assumptions that differ between iOS (sandboxed) and macOS (user-selected)

   **Accessibility** _[applies when: code modifies UI components or interactive elements]_
   - Images without `.accessibilityLabel()` (or marked as `.accessibilityHidden(true)` if decorative)
   - Custom interactive views missing `.accessibilityAddTraits(.isButton)` or equivalent
   - Dynamic Type not tested — `@ScaledMetric` or relative font sizes instead of fixed point sizes
   - Color-only information indicators without shape/text alternatives
   - Missing `.accessibilityElement(children:)` grouping for related controls
   - VoiceOver reading order not matching visual layout — use `.accessibilitySortPriority()`
   - Insufficient color contrast (< 4.5:1 for text, < 3:1 for large text) — test with Accessibility Inspector
   - Tap targets smaller than 44x44 points without `.contentShape()` expansion
   - `.disabled()` modifier without `accessibilityHint` explaining why

   **Networking** _[applies when: code makes URL requests or uses URLSession]_
   - `URLSession.shared` for requests that need different configurations (timeout, caching, auth)
   - Missing `HTTPURLResponse` status code validation — `URLSession` doesn't throw for 4xx/5xx
   - Request body encoding without `Content-Type` header
   - Background `URLSession` tasks without handling `application(_:handleEventsForBackgroundURLSession:)`
   - Large file downloads without progress reporting or resume capability

## Tier 4 — Always Check (Quality, Conventions, AI-Generated Code)

   **Intent vs implementation**
   - Labels, comments, or documentation describing behavior the code doesn't implement
   - `@available(iOS X, *)` annotations that don't match the deployment target in the project settings — either the annotation is unnecessary (deployment target already covers it) or the fallback `#else` path is missing
   - Protocol conformances declared but not fully satisfied — Swift compiler catches most, but default implementations may silently provide wrong behavior
   - Enum switches using `default:` that should be exhaustive — adding a new case won't trigger a compiler warning
   - `@MainActor` annotation on a type but non-isolated methods that access state — the annotation doesn't automatically apply to all methods in all contexts

   **Automated pipeline discipline**
   - Internal code review must run on all automated remediation changes BEFORE creating PRs — never go straight from "tests pass" to PR creation
   - Copilot review must complete (approved or commented) on all PRs before merging — never merge while reviews are still pending unless the user explicitly approves
   - Automated agents may introduce subtle issues that pass tests but violate project conventions — review agent output against CLAUDE.md conventions

   **AI-generated code quality** _(Claude-specific failure modes)_
   - Over-engineering: new protocols, wrapper types, or coordinator patterns for single-use cases — inline the logic instead
   - Feature flags, configuration options, or extension points with only one possible value or consumer
   - Unnecessary `AnyView` type erasure — use `@ViewBuilder`, `some View`, or `Group` instead
   - Generic `ViewModifier` wrappers around a single modifier call — just apply the modifier directly
   - Commit messages or comments claiming a fix while the underlying bug remains

   **Configuration & build settings**
   - Hardcoded values when a build setting, `xcconfig`, or `Info.plist` field already exists
   - Deployment target mismatches between project/target/package settings
   - Missing entitlements for used capabilities (push notifications, iCloud, HealthKit, etc.)
   - `Info.plist` usage description strings missing for privacy-sensitive APIs (camera, location, photos, etc.) — app will crash on first access
   - Build settings that differ between Debug and Release without justification (e.g., `SWIFT_OPTIMIZATION_LEVEL` should differ, but `PRODUCT_BUNDLE_IDENTIFIER` should not)
   - `OTHER_LDFLAGS` or `OTHER_SWIFT_FLAGS` with hardcoded paths that break on other machines

   **Supply chain & dependency health**
   - `Package.resolved` committed and CI uses `--disable-automatic-resolution` for reproducible builds
   - SPM dependencies with `.branch("main")` instead of `.upToNextMajor(from:)` — non-deterministic builds
   - CocoaPods `Podfile.lock` committed if using CocoaPods
   - Dependencies pulling in entire frameworks for one utility function — check if the needed functionality exists in Foundation/SwiftUI

   **Test coverage**
   - New logic/view models without corresponding `XCTest` cases when similar existing code has tests
   - View model tests that only test property initialization, not state transitions and side effects
   - Missing tests for `Codable` round-trip (encode → decode → equality)
   - Missing tests for `@Published` property change sequences
   - Missing UI tests (`XCUITest`) for critical user flows — at minimum test navigation, data entry, and error states
   - Snapshot/preview tests not covering Dark Mode, Dynamic Type sizes, and all target platforms
   - Tests depending on `DispatchQueue.main.async` timing instead of using `XCTestExpectation` or async test methods

   **Style & conventions**
   - Naming and patterns consistent with the rest of the codebase
   - Swift naming conventions: types `UpperCamelCase`, properties/methods `lowerCamelCase`, acronyms lowercased except at start (`urlString` not `URLString`)
   - View files named after their primary view type: `ProfileView.swift` contains `struct ProfileView: View`
   - View model files colocated with their views or in a clear `ViewModels/` directory
   - SwiftUI modifiers applied in consistent order across similar views
   - Formatting consistency within each file — new content must match existing indentation, brace style, and structure
