---
description: SwiftUI DevSecOps audit, remediation, test enhancement, per-category PRs, CI verification, and an optional multi-reviewer review loop with worktree isolation — optimized for multi-platform Swift/SwiftUI apps (iOS, macOS, watchOS, tvOS, visionOS)
argument-hint: "[--interactive] [--scan-only] [--no-merge] [--review-with <agent>[,<agent>...]] [--review-iterations <n>] [--review-mode <series|parallel>] [--review-stop-on-findings|--review-stop-on-clean] [--reviewer-applies] [--issues|--no-issues] [--issues-label <name>] [path filter or focus areas]"
---

# Better Swift — Unified DevSecOps Pipeline for SwiftUI Apps

Run the full DevSecOps lifecycle optimized for Swift/SwiftUI multi-platform projects: audit the codebase with 8 deduplicated agents (including a UX Consistency & Responsive Layout agent — SwiftUI apps ship a user-facing UI by definition), consolidate findings, remediate in an isolated worktree, create **separate PRs per category** with SemVer bump, verify CI, run the requested review loop(s), and merge.

**Default mode: fully autonomous.** Uses Balanced model profile, proceeds through all phases without prompting. **There is no default reviewer**: if `--review-with` is omitted, no external review runs and PRs are left open for manual review (no auto-merge). Pass `--review-with <agent>` to run a review loop and auto-merge PRs with clean reviews.

**`--interactive` mode:** Pauses for model profile selection, review findings approval, guardrail decisions, and merge confirmation.

Parse `$ARGUMENTS` for:
- **`--interactive`**: pause at each decision point for user approval
- **`--scan-only`**: run Phase 0 + 1 + 2 only (audit and plan), skip remediation
- **`--no-merge`**: run through PR creation (Phase 5), skip the review loop and merge
- **`--review-with <agent[,agent,...]>`**: which reviewer(s) run the Phase 6 review loop on each PR. Accepted slugs: `copilot`, `codex`, `agy` (aliases `gemini` / `antigravity` — all run the Antigravity CLI's `agy` binary), `claude`, `ollama` (bare `ollama` auto-selects the most capable installed coding model; `ollama[<model>]` pins a specific installed model, e.g. `ollama[qwen2.5-coder:32b]` — strip the bracket into a per-entry `OLLAMA_MODEL`) (comma-separated, ordered list; split on `,`, trim whitespace, normalize `gemini`/`antigravity` → `agy`, dedupe preserving first-occurrence order, with the `ollama` bracket suffix part of the dedup identity). Record as `REVIEW_AGENTS`. **There is no built-in default** — if omitted, leave `REVIEW_AGENTS` **unset for now**; the saved-defaults step below fills it from `/do:config` if a default exists, and **only if it is still unset after that** is `REVIEW_AGENTS=[]` (Phase 6 skipped, PRs left open without merging — see Phase 6). `copilot` is never added implicitly. Abort on an unknown slug with `Unknown --review-with value: {value}. Use one of: copilot, codex, agy, claude, ollama.` The reserved token `none` (case-insensitive) is **not** validated as a slug — `--review-with none` means no reviewer (set `REVIEW_AGENTS=[]`) and overrides any saved `review-with` default.
- **`--review-stop-on-findings`** / **`--review-stop-on-clean`** (mutually exclusive): forwarded to the multi-reviewer loop for each PR; control when a per-PR reviewer list stops early. Set `REVIEW_STOP_MODE` (`all` default, `on-findings`, or `on-clean`). If both are present, abort with `--review-stop-on-findings and --review-stop-on-clean cannot be combined`.
- **`--review-mode <series|parallel>`**: forwarded to each PR's multi-reviewer loop. `series` (default) runs the reviewers one-at-a-time so each sees the prior's committed fixes; `parallel` runs their reviews concurrently against one baseline and applies the deduped union once (`--reviewer-applies` and the stop-modes are ignored in parallel). Set `REVIEW_MODE`; if omitted, leave it **unset for now** (saved-defaults fills it from `review-mode`; built-in default `series`). Abort with `--review-mode must be one of series, parallel (got: {value}).` on any other value.
- **`--reviewer-applies`**: forwarded to each PR's review loop — the reviewing CLI applies fixes directly instead of the orchestrator (no effect on copilot passes). Record `REVIEWER_APPLIES=true`/`false`.
- **`--review-iterations <n>`**: cap how many review-and-fix cycles a **copilot** pass runs per PR (Phase 6); no effect on `codex`/`agy`/`claude` passes (fixed 3-iteration cap). Set `REVIEW_ITERATIONS` from this value; default `1` (one review pass per PR, exiting early on 0 comments). `0` = loop until Copilot returns 0 comments (legacy behavior, bounded by the 10-iteration guardrail). Must be a non-negative integer; otherwise abort with `--review-iterations must be a non-negative integer (got: {value}).`

After parsing the review flags above, apply any **saved defaults** (set via `/do:config`) to the flags the user did NOT pass (the review flags **and** `--issues` / `--issues-label`) — an explicit flag, or `--review-with none`, always overrides a saved default:

!`cat ~/.claude/lib/review-config-defaults.md`

- **`--issues`** / **`--no-issues`** / **`--issues-label <name>`**: track deferred findings as GitHub/GitLab issues instead of PLAN.md lines (see Phase 2). `--issues` sets `ISSUE_MODE=true`; `--no-issues` forces `ISSUE_MODE=false`. If the user passes **neither**, take `ISSUE_MODE` from the saved `issues` default resolved above (built-in default `false`). Set `PLAN_LABEL` from `--issues-label`, else the saved `issues-label` default, else `plan`.
- **Path filter**: limit scanning scope to specific directories or files
- **Focus areas**: e.g., "security only", "platform coverage and accessibility"

## Configuration

### Default Mode (autonomous)

Use the **Balanced** model profile automatically (`AUDIT_MODEL=sonnet`, `REMEDIATION_MODEL=sonnet`).

### Interactive Mode (`--interactive`)

Present the user with configuration options using `AskUserQuestion`:

```
AskUserQuestion([
  {
    question: "Which model profile for audit and remediation agents?",
    header: "Model",
    multiSelect: false,
    options: [
      { label: "Quality", description: "Opus for all agents — fewest false positives, best fixes (highest cost, 8+ Opus agents)" },
      { label: "Balanced (Recommended)", description: "Sonnet for audit and remediation — good quality at moderate cost" },
      { label: "Budget", description: "Haiku for audit, Sonnet for remediation — fastest and cheapest" }
    ]
  }
])
```

Record the selection as `MODEL_PROFILE` and derive agent models from this table:

| Agent Role | Quality | Balanced | Budget |
|------------|---------|----------|--------|
| Audit agents (8 Explore agents, Phase 1) | opus | sonnet | haiku |
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
- `BUILD_CMD`, `TEST_CMD`, `PROJECT_TYPE`, `WORKTREE_DIR`, `REPO_DIR` values
- `VCS_HOST`, `CLI_TOOL`, `DEFAULT_BRANCH`, `CURRENT_BRANCH`
- `PLATFORMS` (list of supported platforms: iOS, macOS, etc.)
- `DEPLOYMENT_TARGETS` (minimum OS versions per platform)
- `BUILD_SYSTEM` (xcodebuild / swift build / xcodegen / tuist)
- `SCHEME`, `WORKSPACE_OR_PROJECT` (Xcode build identifiers)
- `PHASE_4C_START_SHA` (needed for FILE_OWNER_MAP update in Phase 4c.3)
- `VACUOUS_TESTS_FIXED`, `WEAK_TESTS_STRENGTHENED`, `NEW_TEST_CASES`, `NEW_TEST_FILES`
- `CREATED_CATEGORY_SLUGS` (list of branch slugs created in Phase 5)
- `GOTCHA_ENTRIES_IN_SCOPE` (list of swift-gotchas catalogue entry numbers relevant to this project, recorded in Phase 0e)


## Phase 0: Discovery & Setup

Detect the project environment before any scanning or remediation.

### 0a: VCS Host Detection
Run `gh auth status --active` to check GitHub CLI (`--active` scopes the check to the active account, so a stale token on another configured account doesn't falsely fail it). If it fails, run `glab auth status` for GitLab.
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
- **CloudKit usage** (`import CloudKit`, `CKContainer`, `cloudKitDatabase:` in `ModelConfiguration`) — flag for Agent 5 lazy-init audit
- **iCloud entitlements** (`com.apple.developer.icloud-container-identifiers` in `.entitlements`) — flag for Agent 6 ubiquity container audit
- **Localization** (`Localizable.xcstrings` file present, `String(localized:)` calls, `LocalizedStringKey` parameters) — flag for Agent 6 localization audit
- **StoreKit / IAPs** (`import StoreKit`, `.storekit` config file, `Product.products(for:)`) — flag for Agent 6 IAP audit
- **CI/CD release path** (`.github/workflows/*.yml` referencing `apple-actions/upload-testflight-build` or `xcrun altool`) — flag for Agent 6 TestFlight upload validation audit
- **Code signing in CI** (CI workflow uses `CODE_SIGNING_ALLOWED=NO` for tests) — Agent 5 must aggressively check CloudKit eager-init crash patterns

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
- Record `REPO_DIR` via `git rev-parse --show-toplevel`
- Record `CURRENT_BRANCH` via `git rev-parse --abbrev-ref HEAD`
- Record `DEFAULT_BRANCH` via `gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name'` (or `glab` equivalent)
- Record `IS_DIRTY` via `git status --porcelain`
- Check for `.changelogs/` or `.changelog/` directory → `HAS_CHANGELOG`
- Check for existing `../better-*` worktrees: `git worktree list`. If found, inform the user and ask whether to resume (use existing worktree) or clean up (remove it and start fresh)

### 0e: Known Gotchas Catalogue

This command ships with a catalogue of real-world Swift / iOS / macOS failure modes at `~/.claude/lib/swift-gotchas.md`. Each entry documents trigger conditions, root cause, the verified fix, and verification steps for a bug that has shipped to production at least once.

Before launching audit agents in Phase 1, scan the project for these signals and record which catalogue entries are in scope. Pass this list to each downstream audit agent so they know which entries to consult.

| Entry | Catalogue # | Triggers when project has | Audit agent that uses it |
|-------|-------------|---------------------------|--------------------------|
| CKContainer eager-init crash | 1 | CloudKit + CI runs `xcodebuild test ... CODE_SIGNING_ALLOWED=NO` | Agent 5 (Bugs) |
| SwiftData missing inverse relationship | 2 | `@Model` with `@Relationship` properties | Agent 5 (Bugs) + Agent 7 (Tests) |
| SwiftData CloudKit cross-Apple-ID sharing gap | 3 | SwiftData + `cloudKitDatabase: .automatic` + household/team/share keywords | Agent 4 (Architecture) + Agent 5 (Bugs) |
| iCloud ubiquity container silent failure | 4 | iCloud entitlement + `url(forUbiquityContainerIdentifier:)` | Agent 5 (Bugs) + Agent 6 (Platform) |
| iCloud symlink content corruption | 5 | Code mirrors content into `~/Library/Mobile Documents/` paths | Agent 5 (Bugs) |
| SwiftUI xcstrings localization | 6 | `Localizable.xcstrings` OR `String(localized:)` calls | Agent 6 (Platform) |
| XcodeGen project generation | 7 | `project.yml` present | Agent 6 (Platform) |
| TestFlight upload validation | 8 | CI workflow uses `apple-actions/upload-testflight-build` or `xcrun altool` | Agent 6 (Platform) |
| App Group provisioning auth failure | 9 | App Groups, Push, or extension targets in `.entitlements` | Agent 6 (Platform) |
| iOS first-IAP submission rejection | 10 | `import StoreKit` AND `Product.products(for:)` calls | Agent 6 (Platform) |
| `.foregroundStyle(.accentColor)` compile failure | 11 | SwiftUI code using `.foregroundStyle(.accentColor)` | Agent 5 (Bugs) |
| Keychain test failures (CryptoKit) | 12 | `SecItemAdd`/`SecItemCopyMatching` + symmetric key generation | Agent 5 (Bugs) |

Record the matching entry numbers as `GOTCHA_ENTRIES_IN_SCOPE` (e.g., `[1, 2, 6, 7, 8, 11]`). Audit agents in Phase 1 will be instructed to `Read ~/.claude/lib/swift-gotchas.md` once and check each in-scope entry's trigger conditions against the codebase.


<audit_instructions>

## Phase 1: Unified Audit

Project conventions are already in your context. Pass relevant conventions to each agent.

Before launching audit agents, load the gotcha catalogue into your context so you can pass relevant entries to each agent:

!`cat ~/.claude/lib/swift-gotchas.md`

Use `GOTCHA_ENTRIES_IN_SCOPE` (recorded in Phase 0e) to filter which entries are relevant for this project. Pass each downstream agent ONLY the entries that match its category (per the table in Phase 0e), not the whole catalogue.

Launch 8 Explore agents in two batches. Each agent must report findings in this format:
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
   - **CloudKit eager-init crash in unsigned test builds — gotcha catalogue #1 (CRITICAL):** `CKContainer(identifier:)` does NOT throw or return nil when the iCloud entitlement is missing — it OS-faults via `EXC_BREAKPOINT`/`SIGTRAP`. `CODE_SIGNING_ALLOWED=NO` strips entitlements from sim builds. Any stored property like `private let container = CKContainer(identifier: "iCloud.foo.bar")` runs at object construction, so the moment any code touches a CloudKit singleton (even just to hold a reference), the host app crashes during XCTest bootstrap with "Early unexpected exit, operation never finished bootstrapping." Feature flags do NOT protect against this — construction happens before the flag check. Fix: convert all `CKContainer`/`CKDatabase`/`CKQuerySubscription` stored properties to `lazy var`. Audit all `@MainActor` singletons and `DataStore`-style references for stored CloudKit properties. Severity: **[CRITICAL]** if CI uses `CODE_SIGNING_ALLOWED=NO`. Full catalogue entry: `~/.claude/lib/swift-gotchas.md` § 1.
   - **SwiftData missing inverse relationship crash — gotcha catalogue #2 (CRITICAL):** every `@Relationship` property must have a matching inverse on the target model. Missing inverse causes `ModelContainer` init to throw `SwiftDataError.loadIssueModelContainer` — and crucially, this fails for BOTH persistent AND in-memory configurations. The error message does NOT identify which relationship is broken. Map every `@Relationship` across all `@Model` classes; if a child model declares `var parent: Parent?` then the parent must declare a matching `var children: [Child]? = nil`. SwiftData CAN auto-infer inverses when both sides declare relationships, but it CANNOT create the inverse when only one side declares it. CloudKit (`cloudKitDatabase: .automatic`) requires inverses to be explicit. Full catalogue entry: `~/.claude/lib/swift-gotchas.md` § 2.
   - **iCloud ubiquity container silent failure — gotcha catalogue #4:** `FileManager.url(forUbiquityContainerIdentifier:)` returning a non-nil URL does NOT mean the container is accessible — it only means the entitlement is configured. Pattern to flag: `if let iCloudURL = fm.url(forUbiquityContainerIdentifier: ...) { ... try? fm.createDirectory(...) ... self.dataDirectory = iCloudURL ... }` — the `try?` swallows permission errors and the app silently operates on an inaccessible directory. Required pattern: after `createDirectory`, verify accessibility via `contentsOfDirectory(at:includingPropertiesForKeys:)` inside `do/catch` (not `try?`), and fall back to local Documents on any failure. Full catalogue entry: `~/.claude/lib/swift-gotchas.md` § 4.
   - **SwiftData CloudKit cross-Apple-ID sharing gap — gotcha catalogue #3:** `ModelConfiguration(cloudKitDatabase:)` only has `.private(...)` and `.automatic` — there is NO `.shared` case. Apps that need cross-user collaboration (family/team apps) will silently sync only across the user's own devices. Flag any app that has `cloudKitDatabase: .automatic` AND mentions "household", "family", "team", "shared", or "invite" in code/comments — they likely need a `CKShare`-on-custom-zone overlay pattern. Common compile errors that indicate this gap: `type 'CKShare.Metadata' has no member 'activityType'`, `(saved, _) = try await db.modifyRecords(...)` (modern async API returns dictionaries, not tuples of arrays). Full catalogue entry: `~/.claude/lib/swift-gotchas.md` § 3.

### Batch 2 (3 agents after Batch 1 completes):

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
   - **macOS window lifecycle (App Store Guideline 4):** Missing `NSApplicationDelegate` with `applicationShouldTerminateAfterLastWindowClosed` returning `false` (app quits on window close instead of staying in Dock). Missing `applicationShouldHandleReopen(_:hasVisibleWindows:)` (Dock click does nothing when window is closed). `WindowGroup` without stable `id:` parameter prevents programmatic reopening via `openWindow(id:)`. Missing "Show Main Window" menu command (Cmd+0) in Window menu. Missing `reopenWindow` closure bridge between AppDelegate and SwiftUI `openWindow`. Menu bar commands that don't ensure main window is visible before acting = **[HIGH]**
   - watchOS complications not updated, widget timelines not refreshed
   - visionOS: missing `.windowStyle(.volumetric)` or `.immersionStyle()` where appropriate

   **Build system & project configuration (when XcodeGen/Tuist detected):**
   - `GENERATE_INFOPLIST_FILE: false` with custom Info.plist missing standard keys (`CFBundleIdentifier`, `CFBundleExecutable`, `CFBundlePackageType`) — causes "Missing bundle ID" on simulator install despite correct `PRODUCT_BUNDLE_IDENTIFIER`. Fix: set `GENERATE_INFOPLIST_FILE: true` to let Xcode merge custom keys with generated ones
   - Preview Content directory with `buildPhase: none` excluding Swift files that are needed at runtime (e.g., `PreviewSampleData.swift` used via launch arguments) — only exclude the `.xcassets`, not the whole directory. In Release builds on CI, `DEVELOPMENT_ASSET_PATHS` files may be stripped — move runtime-needed Swift files OUT of `Preview Content/` into the main source tree
   - `UILaunchScreen` key manually added to Info.plist but lost on `xcodegen generate` — XcodeGen regenerates the plist from `info.properties` only; put `UILaunchScreen: {}` in `project.yml` not the plist file. Missing this causes iOS letterbox/compatibility mode (tiny centered window, large black borders). Also remove `INFOPLIST_KEY_UILaunchScreen_Generation: true` if both are present — they create a nested `UILaunchScreen > UILaunchScreen` structure
   - **Never manually edit the Info.plist file when using XcodeGen's `info.path`** — `xcodegen generate` overwrites the plist from scratch using only `info.properties`. Any custom keys must live in `project.yml` or they're silently deleted
   - Info.plist keys required for TestFlight upload that don't cause build failures (these are rejected SERVER-SIDE by `altool`, not at build time):
     - `UISupportedInterfaceOrientations` must include all 4 orientations for iPad multitasking, OR declare `UIRequiresFullScreen: true` (even iPhone-only apps need this — error code 409). For XcodeGen: set `INFOPLIST_KEY_UISupportedInterfaceOrientations` and `INFOPLIST_KEY_UISupportedInterfaceOrientations_iPad` build settings
     - `CFBundleDocumentTypes` declared without `LSSupportsOpeningDocumentsInPlace` — currently a warning (code 90737), may become a fatal error
   - CI upload actions (`apple-actions/upload-testflight-build@v3`) that report success even when `altool` returns "UPLOAD FAILED" in XML plist output — flag any release workflow that doesn't grep raw upload logs for `UPLOAD FAILED|product-errors|product-warnings`. Always check TestFlight after CI completes to confirm the build actually arrived
   - **Adding new capabilities to an existing app — gotcha catalogue #9:** `xcodebuild archive -allowProvisioningUpdates` may fail with misleading "Authentication failed: Make sure a bearer token was provided" when adding App Groups, Push, etc. — the App Store Connect API key has upload permissions but NOT provisioning profile management permissions. Flag CI workflows that add new entitlements without corresponding documentation that someone has manually fixed provisioning in Xcode GUI first
   - For XcodeGen multi-platform targets with widget extensions, the widget dependency needs `platformFilter: iOS` since widgets are primarily iOS
   - Build system & TestFlight gotchas — full catalogue entries: `~/.claude/lib/swift-gotchas.md` § 7 (XcodeGen), § 8 (TestFlight upload), § 9 (App Group provisioning)

   **iCloud & data persistence (when iCloud entitlements detected):**
   - `url(forUbiquityContainerIdentifier:)` returning non-nil does NOT mean the container is accessible — always verify with `createDirectory` + `contentsOfDirectory` using `do/catch` (not `try?`) and fall back to local Documents directory on failure
   - `try?` on iCloud file operations silently swallowing permission errors — app appears to work but reads/writes to inaccessible path with empty results
   - Sparse/dehydrated iCloud files: any directory that was symlinked or rsynced into iCloud Drive can produce files with `st_size > 0` but `st_blocks = 0` that read as empty. Flag any code that mirrors content into iCloud paths without integrity verification (see catalogue § 5)

   **Localization & String Catalogs (when `Localizable.xcstrings` or `String(localized:)` detected):**
   - **`Text(someStringVariable)` silent failure** — `Text("literal")` accepts `LocalizedStringKey` and auto-localizes from the string catalog, but `Text(someVariable)` where `someVariable: String` does NOT — it renders raw. Any reusable component accepting `title: String` and passing it to `Text(title)` ships untranslated UI unless callers pre-localize via `String(localized:)`. Either change the parameter type to `LocalizedStringKey` (for literal-only callers) or document that callers must pre-localize. This is the #1 silent localization failure
   - **`String(localized:)` ignores SwiftUI environment locale** — it uses `Bundle.main`'s preferred language, which is controlled by `UserDefaults["AppleLanguages"]`, not `.environment(\.locale, ...)`. Apps with in-app language pickers must either (a) restart after writing to `AppleLanguages`, or (b) build an `appLocalized()` helper that passes the user's chosen locale explicitly via `String(localized: key, locale: .app, comment: ...)`
   - **AGA `^[...](inflect: true)` requires `LocalizedStringKey`** — Apple's Automatic Grammar Agreement only fires when rendered as `Text(LocalizedStringKey)`. `String(localized: "^[\(count) horse](inflect: true)")` returns a plain `String`, strips the AGA pipeline, and renders the markup literally. AGA `inflect: true` is also unreliable for non-English locales — use explicit `variations.plural` (`one`/`other` keys) in xcstrings for ALL locales including English
   - **Static cached `DateFormatter` for locale-dependent formats** — `private static let formatter = DateFormatter()` captures the locale at first init and never updates; in-app language switches won't change rendered dates. Use `Date.FormatStyle` (e.g., `date.formatted(.dateTime.month().day())`) which respects current locale, OR construct a fresh formatter per call. Static caching IS safe for locale-independent formats like `yyyyMMdd` (set `locale = Locale(identifier: "en_US_POSIX")` to prevent calendar interference)
   - **`date.formatted(...)` vs `Text(date, format:)` in views** — the former returns a `String` using `Locale.current` (system locale, non-reactive); the latter uses the SwiftUI environment locale and IS reactive to `.environment(\.locale, ...)` changes. Prefer `Text(date, format: ...)` in view bodies
   - **Localized strings stored in SwiftData/CoreData** — flag any `@Model` property that holds a translated display string instead of a raw enum value. Storing `"Lektion"` in German and reading in French gives mixed-language UI. Always store raw values (`categoryRaw: String = "lesson"`) and compute `displayName` at render time
   - **Missing `comment:` parameter on `String(localized:)` calls** — translators have no context, and the xcstrings extraction tool won't auto-populate hints
   - **Missing `en` entry in xcstrings when other languages are present** — causes English strings to display with raw `^[...]` markup or fall back to keys
   - **Tab bar / sidebar / navigation labels not translating** — usually caused by Pattern 1 vs 2 confusion: `Label(category.displayName, ...)` won't translate unless `displayName` returns a pre-localized `String`
   - Full catalogue entry with all 8 sub-gotchas and the `appLocalized()` helper template: `~/.claude/lib/swift-gotchas.md` § 6

   **In-App Purchases & StoreKit (when StoreKit imports detected):**
   - **Missing "Restore Purchases" button (Guideline 3.1.1 — auto-rejection):** apps that offer IAPs MUST include a distinct, user-tappable Restore button on the same screen where IAPs are shown, not buried in deep settings. Implementation: `try await AppStore.sync()` (StoreKit 2), then refresh purchase state. Show loading state during restore, alerts on success/failure
   - **Hardcoded fallback price in PurchaseButton** — `Text(price ?? "$0.99")` shows a tappable button when products haven't loaded, leading to "Unable to make IAP purchases" in App Review. Fix: show `ProgressView()` until `Product.products(for:)` resolves, then enable the button
   - **First-time IAPs in TestFlight cannot be tested** — `product.purchase()` will fail with "Unable to Complete Request" for IAPs that have never been approved by App Review, even though `Product.products(for:)` returns prices correctly. This is a sandbox limitation, not a code bug. Flag any project README or testing doc that says "test IAPs in TestFlight" without mentioning the local `.storekit` configuration file workflow (only works in Xcode debug runs, not archived/TestFlight builds)
   - **`@available` annotations not matching actual StoreKit version** — StoreKit 2 (`Product`, `Transaction`, `AppStore.sync()`) requires iOS 15+/macOS 12+. Mixing StoreKit 1 (`SKProduct`, `SKPaymentQueue`) and StoreKit 2 in the same purchase flow without clear version gating produces surprising bugs
   - Full catalogue entry with submission flow (clear "Rejected" IAP localizations, submit IAPs alongside an app version, local `.storekit` testing): `~/.claude/lib/swift-gotchas.md` § 10

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
   - View preview providers not covering the Dynamic Type test matrix: `.large` (baseline), `.xxxLarge` (largest non-accessibility), `.accessibility5` (AX5). Also Dark Mode, RTL layout, smallest/largest device for each platform

   **Accessibility (ALL projects):**
   - Images without `.accessibilityLabel()` or `.accessibilityHidden(true)` for decorative images
   - Custom interactive views missing `.accessibilityAddTraits(.isButton)`
   - Color-only indicators without shape/text alternatives
   - Tap targets smaller than 44x44pt without `.contentShape()` expansion
   - Missing `.accessibilityElement(children: .combine)` grouping
   - VoiceOver reading order not matching visual order
   - Animations not respecting `@Environment(\.accessibilityReduceMotion)`

   **Dynamic Type responsive-layout audit (iOS, iPadOS, watchOS, visionOS — HIGH priority):**
   Users can set text size from Settings > Display & Brightness > Text Size AND Settings > Accessibility > Display & Text Size > Larger Text, scaling text up through `AX1`–`AX5`. Most layout bugs only surface at the accessibility tiers (AX1–AX5), not at `xxxLarge`. App Store reviewers routinely test at the largest size — clipped or unreachable UI is a rejection vector.

   **Test matrix — verify every user-facing view renders correctly at these three points:**
   - `.large` — baseline (default system size)
   - `.xxxLarge` — largest non-accessibility tier, catches most truncation
   - `.accessibility5` (AX5) — catches clipping, overflow, broken layouts, and unreachable controls

   **Patterns to flag as findings:**
   - Hardcoded font sizes (`.font(.system(size: 14))`, `Font.custom(_, size:)` without `relativeTo:`) that won't scale. Fix: use semantic styles (`.font(.body)`, `.headline`, etc.) or `.font(.custom("Name", size: 14, relativeTo: .body))`, or gate numeric spacing with `@ScaledMetric`
   - Hardcoded spacing / frame sizes (padding, width, height, corner radius on text-bearing containers) that don't grow with text. Fix: `@ScaledMetric(relativeTo: .body) var padding: CGFloat = 16`
   - Multi-line `Text` that truncates or clips in constrained layouts (especially inside `HStack`s or narrow/fixed-width containers) — SwiftUI sometimes prefers horizontal truncation (ellipsis) over wrapping, so long strings can clip instead of expanding vertically. Verify the text actually wraps and expands vertically at AX5. If it truncates instead of wrapping, apply `.fixedSize(horizontal: false, vertical: true)` as a targeted fix — do NOT apply it as a blanket rule to every multi-line `Text`, since it can fight parent layout constraints when wrapping already works correctly.
   - Full-screen content views (screens, sheets, detail views) NOT wrapped in a `ScrollView` — at AX5, almost any content taller than ~4 rows overflows. Flag any top-level view body that uses `VStack` / `Form`-less layouts without a scroll container. If the view needs a `Spacer` to push content, wrap in `ScrollView` + `GeometryReader` with a `.frame(minHeight: geo.size.height)` inner container instead of dropping the scroll
   - Fixed `.frame(height:)` or `.frame(width:height:)` on containers that hold `Text` — flag unless paired with `@ScaledMetric` or `.dynamicTypeSize(...DynamicTypeSize.xxxLarge)` cap
   - `HStack` layouts with multiple text elements and no wrap fallback — at AX sizes these truncate off-screen. Suggest `ViewThatFits { HStack { ... }; VStack { ... } }` or split to `VStack` when `dynamicTypeSize.isAccessibilitySize` is true
   - `Label`, `Button`, list rows, and tab/toolbar items with adjacent icons + text using fixed `HStack` spacing — verify icons also scale (`Image(systemName:).imageScale(.large)` or `@ScaledMetric` for sized assets)
   - Views that call `.lineLimit(1)` or `.truncationMode(.tail)` on content users must read in full (titles, button labels, form values) — at AX5 the ellipsis hides critical UI. Allow only for non-critical captions or metadata
   - Views that use `.minimumScaleFactor(...)` below `0.8` as a "fix" for Dynamic Type — this shrinks text back below the user's chosen size and defeats the accessibility request. Prefer wrapping/scrolling
   - **Hero typography / fixed-size displays that legitimately can't grow (slider numbers, countdown digits, watch face values, tight chrome)**: use `.dynamicTypeSize(...DynamicTypeSize.xxxLarge)` as an upper cap on that subtree — **cap, don't ignore**. Flag any such element that uses `.dynamicTypeSize(.large)` or a narrower cap, or that uses hardcoded fonts without any cap (silent regression when user bumps text size)
   - TabView items, NavigationStack titles, and alert buttons that truncate at AX sizes — test with `.dynamicTypeSize(.accessibility5)` in previews
   - Custom `Text` measurements with `GeometryReader` or `TextRenderer` that assume a fixed size category
   - Forms and list rows where trailing controls (Toggle, disclosure indicator, value text) collide with leading labels at AX sizes — use `LabeledContent` (iOS 16+) or switch to vertical layout via `if dynamicTypeSize.isAccessibilitySize`
   - Missing `@Environment(\.dynamicTypeSize) var dynamicTypeSize` branch in custom layouts that need to reflow (e.g., side-by-side → stacked) at accessibility sizes
   - Launch screens / onboarding / paywall screens specifically — these are the most common rejection points because they're full-bleed and often pixel-designed

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
   - Missing preview coverage: all views should have `#Preview` for each platform × Dark Mode × the Dynamic Type test matrix (`.large`, `.xxxLarge`, `.accessibility5`). Previews with only the default size ship blind to accessibility layout bugs
   - Missing error path tests for network failures, decode failures, and permission denials
   - **Missing `testModelContainerSchemaIsValid()` test** when `@Model` classes are present — every project using SwiftData should construct an in-memory `ModelContainer` with ALL model types in a unit test. This catches missing inverse relationships before they reach production (the actual error message gives no hint which relationship is broken). Required pattern:
     ```swift
     func testModelContainerSchemaIsValid() throws {
         _ = try ModelContainer(
             for: ModelA.self, ModelB.self, /* every @Model type */,
             configurations: ModelConfiguration(isStoredInMemoryOnly: true)
         )
     }
     ```
   - **Missing CloudKit lazy-init verification test** — when the project uses CloudKit, add a smoke test that runs the host app under `CODE_SIGNING_ALLOWED=NO` and verifies tests bootstrap successfully. If `CKContainer(identifier:)` is held in any stored property, the host app traps before any test runs
   - **Missing localization round-trip tests** when `Localizable.xcstrings` is present — for each enum with a `displayName` property, verify it returns a non-empty `String` (not the raw key) for at least one supported locale. This catches `Text(stringVariable)` vs `Text(LocalizedStringKey)` regressions
   - **Missing IAP product loading test** when StoreKit is imported — verify `Product.products(for: identifiers)` returns the expected set against a `.storekit` configuration file. This catches typos in product identifiers before they reach App Review

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

8. **UX Consistency & Responsive Layout**
   Always runs — SwiftUI projects ship a user-facing UI by definition.
   Sources: app entry points (`App` struct, `WindowGroup`/`Scene` declarations, root views), top-level screen views, navigation containers, design tokens/theme files (`Color`/`Font` extensions, asset catalogs), shared component library (custom `ViewModifier`s, `ButtonStyle`s, reusable views)

   **First-launch & first-frame UX (highest priority — bump severity one tier when a finding affects the first screen the user sees):**
   - Blank or spinner-only first frame: root view rendering bare `ProgressView()` or an empty view while initial data loads, with no skeleton placeholder (`.redacted(reason: .placeholder)` over sample-shaped content) reserving layout
   - Synchronous heavy work delaying first frame: `ModelContainer`/Core Data store setup, large JSON decode, migrations, or network calls in `App.init()`, root view init, or eagerly-constructed singletons on the launch path
   - Layout shift after first render: async content (`AsyncImage`, fetched lists, remote config) inserted into the first screen without reserved dimensions or placeholder sizing; banners injected after first paint that push content down
   - Primary content or call-to-action requiring scroll on the smallest supported device (iPhone SE class, 320pt-width windows) because of oversized hero media or stacked banners/notices
   - Permission prompts (notifications, tracking, location) fired at launch before the user sees any content
   - Launch screen → first view discontinuity: mismatched background color or layout causing a visible jump at startup

   **Responsive layout (device sizes & window geometry — Dynamic Type scaling belongs to Agent 6):**
   - Hardcoded `.frame(width:height:)` on containers that break on the smallest supported device or fail to use space on the largest (13" iPad, wide Mac windows)
   - Missing size-class adaptation: iPhone-shaped layouts forced onto iPad — no `@Environment(\.horizontalSizeClass)` branch or `NavigationSplitView` where regular width warrants it
   - iPad multitasking & Stage Manager: layouts broken in Split View / narrow window widths; `UIRequiresFullScreen` blocking multitasking without justification (note: TestFlight orientation requirements are Agent 6's concern — flag here only the layout breakage)
   - macOS window resizing: fixed-size content in resizable windows, missing `.defaultSize`/`.windowResizability`, content that neither expands nor recenters when the window grows
   - `HStack`s holding variable-length text with no wrap fallback (`ViewThatFits` or width-conditional `VStack`) at narrow widths and default text size
   - Truncation of user-generated or localized content at default text size — German/French run ~30% longer than English; `.lineLimit(1)` on variable-length labels users must read in full
   - Landscape orientation visibly degraded when the project supports it
   - Keyboard avoidance: text inputs the keyboard covers; tall forms without a `ScrollView`/`Form` container

   **UX consistency:**
   - One-off color/font/spacing literals in screens where a design system exists (`Color`/`Font` extensions or asset catalog tokens) — count occurrences per pattern (e.g., "hardcoded `Color(red:green:blue:)` in 14 views")
   - Multiple bespoke implementations of the same UI concept: divergent button treatments instead of a shared `ButtonStyle`, duplicate card/row layouts, parallel form-field components
   - Inconsistent loading/empty/error states across screens — some use `ContentUnavailableView`, some custom views, some render nothing; lists with no empty state at all
   - Inconsistent feedback patterns: errors surfaced as alerts in one flow and silently swallowed in another; destructive actions sometimes behind `confirmationDialog`, sometimes immediate; haptics on some primary actions but not others
   - Inconsistent navigation grammar: the same kind of task presented as a sheet in one place and a push in another; dismiss/cancel buttons in different toolbar positions across sheets
   - Missing or inconsistent interactive states: pressed states on custom buttons, `.onHover`/pointer effects on macOS and iPadOS, focus effects on tvOS

   Boundary notes (avoid duplicate findings): Dynamic Type scaling, accessibility, and platform-API coverage belong to Agent 6 — flag text-size or layout issues here only when they reproduce at the DEFAULT text size. Repeated literals and duplicate modifier chains as a deduplication concern belong to Agent 3 — flag them here only when they produce visibly divergent rendering; Phase 2 dedup keeps the most specific description. Tag this agent's category as `ux` for Phase 2 ownership mapping.

Wait for ALL agents to complete before proceeding.

</audit_instructions>

<plan_and_remediate>

## Phase 2: Plan Generation

> **Issue mode (`--issues`):** Keep the consolidated findings (steps 2–4 below) as
> your **in-run working plan in context** — do **not** create or write the
> `## Better Swift Audit` section to `PLAN.md`, and skip step 1's "read/create
> PLAN.md". The tracker, not `PLAN.md`, is the source of truth for already-known
> work, so the disposition partial below has you fetch the open issues into
> `EXISTING_ISSUES` during setup. When consolidating findings (step 2), **dedup
> against `EXISTING_ISSUES`** as well as across agents: a finding that already has
> an open issue is not new — reuse that issue's `#<number>` instead of filing a
> duplicate. Remediation (Phase 3+) proceeds from that in-context plan exactly as
> normal. The only persistent records are issues: for any finding you **defer**
> (don't remediate this run, per the finding-disposition rules), file a labeled
> tracker issue instead of a PLAN.md line — see the disposition partial below.
> Report the created **and** reused issue numbers (`#<n>`) in the Phase 2 summary
> where you'd report slugs. Setup (VCS host + label + `EXISTING_ISSUES` fetch) is
> covered by the partial: reuse `CLI_TOOL` from Phase 0a.

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
- [ ] [sec-keychain-token-leak] **[CRITICAL]** `file:line` - Description — Fix: ... (Complexity: Simple/Medium/Complex)

### Code Quality
- [ ] [swift-mainactor-binding] **[HIGH]** `file:line` - Description — Fix: ...

### DRY & YAGNI
- [ ] [dry-view-modifier-dup] **[MEDIUM]** `file:line` - Description — Fix: ...

### Architecture & SOLID
### Bugs, Performance & Error Handling
### Platform Coverage & SwiftUI Patterns
### Test Quality & Coverage
### UX Consistency & Responsive Layout
```

**Every appended `- [ ]` line MUST include a unique `[<slug>]` ID** so concurrent agents (`feature-ideas`, `plan-task`, manual fix-up sessions) can claim distinct findings via worktree branch names. Slug rules per [lib/plan-id-format.md](../../lib/plan-id-format.md): lowercase kebab-case derived from the title text, ≤50 chars, unique against every `[slug]` already in PLAN.md. Recommended pattern for audit findings: `<category-prefix>-<file-basename>-<short-hint>` (e.g. `[sec-keychain-token-leak]`, `[swift-mainactor-binding]`). _(Issue mode skips slugs entirely — the issue number is the ID.)_

!`cat ~/.claude/lib/plan-issue-mode.md`

6. Print a summary table (short labels → full category → branch slug):
   - Security → Security & Secrets → `security`
   - Code Quality → Code Quality & Style → `code-quality`
   - DRY & YAGNI → DRY & YAGNI → `dry`
   - Architecture → Architecture & SOLID → `architecture`
   - Bugs & Perf → Bugs, Performance & Error Handling → `bugs-perf`
   - Platform & SwiftUI → Platform Coverage & SwiftUI Patterns → `platform-swiftui`
   - Tests → Test Quality & Coverage → `tests`
   - UX → UX Consistency & Responsive Layout → `ux`

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
| UX                    | ...      | ...  | ...    | ... | ...   |
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

Remediation runs in parallel, one worker per category that has CRITICAL, HIGH, or MEDIUM findings. Possible categories (only act on those with actionable findings):
- Security & Secrets
- Code Quality & Style
- DRY & YAGNI
- Architecture & SOLID
- Bugs, Performance & Error Handling
- Platform Coverage & SwiftUI Patterns
- UX Consistency & Responsive Layout — remediation must be conservative and verifiable: fix layout mechanics and consolidate to existing design tokens/components without redesigning. First-frame fixes come first (reserve placeholder dimensions, move heavy work off the launch path, add skeleton states). When consolidating divergent components or one-off values, change call sites mechanically and preserve rendered output on every platform in `PLATFORMS` — never change copy or visual design intent. If a finding requires a design decision (e.g., which of two button styles is canonical), pick the variant with the most call sites and note the choice in the commit message

<!-- if:teams -->
1. Use `TeamCreate` with name `better-swift-{DATE}`.
2. Use `TaskCreate` for each category above that has actionable findings.
3. Spawn up to 5 general-purpose agents as teammates. **Pass `REMEDIATION_MODEL` as the `model` parameter on each agent.** If `REMEDIATION_MODEL` is `opus`, omit the parameter to inherit from session. Each teammate marks its task complete via `TaskUpdate` when done.
<!-- else -->
1. Spawn up to 5 general-purpose `Agent` sub-agents — one per category above that has actionable findings. **Pass `REMEDIATION_MODEL` as the `model` parameter on each `Agent` call.** If `REMEDIATION_MODEL` is `opus`, omit the parameter to inherit from session.
2. Launch all `Agent` calls **in parallel** (multiple tool calls in a single response) and wait for all to return. Each sub-agent returns its results directly — no task board or shutdown step is needed.
<!-- /if:teams -->

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

GOTCHA CATALOGUE — REQUIRED READING:
Before fixing any issue tagged with a gotcha catalogue entry number (#1–#12), READ the corresponding entry in `~/.claude/lib/swift-gotchas.md`. Each entry documents the verified fix from a prior project that actually shipped — apply the fix as written rather than improvising. The relevant entries for this project are: {GOTCHA_ENTRIES_IN_SCOPE}.

The catalogue covers:
  #1  CKContainer eager-init crash in unsigned test builds       (CloudKit + CI)
  #2  SwiftData missing inverse relationship crash                (@Model + @Relationship)
  #3  SwiftData CloudKit cross-Apple-ID sharing gap               (.automatic + sharing)
  #4  iCloud ubiquity container silent failure                    (iCloud entitlement)
  #5  iCloud symlink content corruption                           (iCloud Drive mirroring)
  #6  SwiftUI xcstrings localization silent failures              (Localizable.xcstrings)
  #7  XcodeGen project generation gotchas                         (project.yml)
  #8  TestFlight upload validation gotchas                        (CI release path)
  #9  xcodebuild App Group provisioning auth failure              (new entitlements)
  #10 iOS first-IAP submission rejection                          (StoreKit / IAPs)
  #11 .foregroundStyle(.accentColor) compile failure              (any SwiftUI)
  #12 Keychain test failures in simulator (CryptoKit)             (SecItem* + symmetric keys)

When a finding cites a catalogue entry, READ that entry in `~/.claude/lib/swift-gotchas.md` first, then apply the FIX section as the remediation. Do not paraphrase the fix — these are load-bearing patterns where minor variations regress the bug.
```

### Conflict avoidance:
- Review all findings before task assignment. If two categories touch the same file, assign both sets of findings to the same agent.
- Security agent gets priority on Keychain/data protection; Platform agent gets priority on #if os(...) blocks; UX agent gets priority on design-token/theme files and shared component files.

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
<!-- if:teams -->
4. Shut down all agents via `SendMessage` with `type: "shutdown_request"`
5. Clean up team via `TeamDelete`
<!-- else -->
4. No teardown needed — the parallel sub-agents from Phase 3c have already returned.
<!-- /if:teams -->

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
4. **Default mode**: Print a brief summary of findings and fixes, then proceed to PR creation automatically.
   **Interactive mode (`--interactive`)**: Present a summary to the user via `AskUserQuestion`:
   ```
   AskUserQuestion([{
     question: "Code review complete. {N} issues found and fixed. {list}. All {PLATFORMS} platforms build and test successfully. Proceed to PR creation?",
     options: [
       { label: "Proceed", description: "Create per-category PRs" },
       { label: "Commit directly", description: "Merge worktree changes into {CURRENT_BRANCH} — no PRs, no review loops" },
       { label: "Show diff", description: "Show the full diff for manual review before proceeding" },
       { label: "Abort", description: "Stop here — I'll review manually" }
     ]
   }])
   ```
5. (Interactive only) If "Show diff" selected, print the diff and re-ask. If "Abort", stop and print the worktree path.
6. If "Commit directly" selected:
   - All remediation and review fixes are already committed incrementally in the worktree branch `better-swift/{DATE}`. If any uncommitted changes remain, stage and commit them now:
     ```bash
     cd {WORKTREE_DIR}
     git diff --quiet && git diff --cached --quiet || {
       git add <list of remaining changed files>
       git commit -m "fix: better-swift audit remediation — remaining changes"
     }
     ```
   - Return to the main repo checkout, merge the worktree branch, and clean up on success:
     ```bash
     cd {REPO_DIR}
     git checkout {CURRENT_BRANCH}
     if git merge better-swift/{DATE}; then
       git worktree remove {WORKTREE_DIR}
       git branch -D better-swift/{DATE}
     else
       echo "Merge conflict — resolve in {REPO_DIR}, then run:"
       echo "  git worktree remove {WORKTREE_DIR}"
       echo "  git branch -D better-swift/{DATE}"
     fi
     ```
   - Restore stash if needed (`git stash pop`), update PLAN.md, print final summary, then **stop** — this completes the workflow (Phases 5, 6, and 7 are skipped entirely since no PRs or category branches were created)

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
   - Use slugs: `security`, `code-quality`, `dry`, `architecture`, `bugs-perf`, `platform-swiftui`, `tests`, `ux`
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

**GATE: If `VCS_HOST` is `gitlab`, STOP HERE.** Print all MR URLs and summary. The automated Phase 6 review loop + auto-merge run on GitHub PRs only; GitLab MRs are left open for manual review and merge.

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

## Phase 6: Review Loop (GitHub only)

**GATE — no reviewer requested: If `REVIEW_AGENTS` is empty** (no `--review-with` was passed), **skip this entire phase AND the Phase 6.4 merge.** There is no default reviewer. Leave every PR open for manual review, print the PR URLs and summary (mark the Review column `none — left open`), then proceed to Phase 7 cleanup. PRs are merged only after a clean review loop, which requires an explicit `--review-with`.

Otherwise, run each PR through the **multi-reviewer loop** over `REVIEW_AGENTS`, in order, with the parsed `{REVIEW_STOP_MODE}`, `{REVIEW_MODE}` (series default — reviewers run one-at-a-time within a PR so each sees the prior's fixes; `parallel` collects reviews concurrently then applies the union once), `{REVIEWER_APPLIES}`, and `{REVIEW_ITERATIONS}` (the last caps copilot passes only; local-agent passes use their own fixed 3-iteration cap). A copilot pass with the default `--review-iterations 1` runs a single review-and-fix cycle and returns `capped` (clean-equivalent / ready-to-merge). `0` lets a copilot pass loop until 0 comments, bounded by the copilot loop's 10-iteration guardrail. **Default mode**: auto-stop at the guardrail. **Interactive mode (`--interactive`)**: prompt the parent agent to ask the user whether to continue or stop.

**Sub-agent delegation** (prevents context exhaustion): delegate each PR's review loop to a **separate general-purpose sub-agent** via the Agent tool. Launch sub-agents in parallel (one per PR). Each sub-agent runs the multi-reviewer loop (which dispatches each listed agent to the copilot loop or the local-agent loop) autonomously against its PR's branch and returns only the final aggregate status.

### 6.1: Launch parallel sub-agents (one per PR)

For each PR, spawn a general-purpose sub-agent that runs the **multi-reviewer wrapper** below over `REVIEW_AGENTS` for that PR. The wrapper `!cat`s the inner loop bodies it dispatches to:

!`cat ~/.claude/lib/multi-reviewer-loop.md`

!`cat ~/.claude/lib/copilot-review-loop.md`

!`cat ~/.claude/lib/local-agent-review-loop.md`

!`cat ~/.claude/lib/ollama-review-loop.md`

Pass each sub-agent the PR-specific variables: `{REVIEW_AGENTS}`, `{REVIEW_STOP_MODE}`, `{REVIEW_MODE}`, `{REVIEWER_APPLIES}`, `{PR_NUMBER}`, `{OWNER}/{REPO}`, `better-swift/{CATEGORY_SLUG}` (the branch the local-agent loop checks out and reviews), `{BUILD_CMD}`, and `{REVIEW_ITERATIONS}` (the copilot iteration cap; default 1).

**Additional Swift-specific instruction for review loop agents:** After each fix, verify the code compiles on ALL platforms: `{BUILD_CMD}`. If a reviewer's suggestion would break another platform, add a platform-conditional implementation instead.

Launch all PR sub-agents in parallel. Wait for all to complete.

### 6.2: Handle sub-agent results

Each sub-agent returns the multi-reviewer wrapper's `{OVERALL_STATUS}` for its PR:
- **clean**: every executed pass returned clean (copilot `capped`/`too-large` count as clean) — mark PR as ready to merge
- **partial**: a stop-mode flag short-circuited the list and every executed pass was clean — mark PR as ready to merge (the user opted into the short-circuit)
- **inconclusive**: at least one requested pass timed out, errored, hit its guardrail, or was skipped (e.g. a missing CLI binary, or copilot when no PR review could be produced). **Default mode**: leave the PR open for manual review. **Interactive mode**: inform the user and ask whether to merge anyway, re-run, or skip
- **dirty**: a pass left the branch with a broken build / failed tests / explicit reject. **Default mode**: leave the PR open. **Interactive mode**: ask whether to fix-and-retry or skip

### 6.3: Merge Gate (MANDATORY)

**Do NOT merge any PR whose aggregate review status is not `clean` (or `partial` under an explicit stop-mode).** A missing or inconclusive review is NOT a clean review.

### Default Mode (autonomous)

Print the review status summary, then auto-merge all PRs whose reviews completed cleanly. PRs that timed out, hit guardrails, or still have unresolved comments are left open for manual review. Print which PRs were merged and which were left open.

### Interactive Mode (`--interactive`)

Present the review status summary to the user via `AskUserQuestion`:
```
AskUserQuestion([{
  question: "Review status ({REVIEW_AGENTS}):\n{for each PR: #number - aggregate status (clean/partial/inconclusive/dirty)}\n\nAll PRs verified on: {PLATFORMS}\n\nHow would you like to proceed?",
  options: [
    { label: "Merge approved PRs", description: "Merge only PRs with passing review" },
    { label: "Merge all", description: "Merge all PRs regardless of review status" },
    { label: "Wait", description: "Wait longer for pending reviews" },
    { label: "Don't merge", description: "Leave PRs open for manual review" }
  ]
}])
```

Only proceed with merging based on the user's selection.

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
   - Mark completed findings by flipping `- [ ]` → `- [x]` — **preserve the `[<slug>]` ID** on each line (only the box character changes, the slug stays). See [lib/plan-id-format.md](../../lib/plan-id-format.md).
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
| UX                     | ...      | ...   | ...     | #number  | pass   | approved |
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
- **Reviewer timeout / error / guardrail** (copilot review not received in the timeout window, a local CLI errored, or a copilot pass hit its 10-iteration limit): the per-PR sub-agent surfaces it as an `inconclusive` aggregate. **Default mode**: leave that PR open. **Interactive mode**: ask whether to merge without a clean review, re-run, or skip
- **Missing reviewer CLI** (`--review-with codex`/`agy`/`claude` but the binary isn't installed): the multi-reviewer loop records that pass as `skipped` (→ inconclusive aggregate). It does NOT silently fall back to copilot
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
- Agent 8 (UX Consistency & Responsive Layout) always runs — SwiftUI projects ship a UI by definition (no `HAS_UI` gate, unlike `do:better`). It weights first-launch/first-frame UX highest — findings affecting the first screen the user sees are bumped one severity tier — then device-size/window-geometry responsiveness, then design consistency. Dynamic Type scaling and accessibility stay with Agent 6 to avoid duplicate findings
- **No default reviewer**: without `--review-with`, Phase 6 and the auto-merge are skipped and all PRs are left open for manual review. Pass `--review-with <agent[,agent,...]>` to run a review loop and enable auto-merge on a clean result. `copilot` is never added implicitly
- GitLab projects skip the Phase 6 review loop + auto-merge entirely and stop after MR creation
- CI must pass on each PR before its review loop runs or it is merged
