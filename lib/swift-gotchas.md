<!--
  swift-gotchas.md — Reference catalogue of real-world Swift / iOS / macOS failure modes
  consumed by /do:better-swift audit and remediation agents.

  Each entry is self-contained: TRIGGER (how to detect it in code/CI),
  ROOT CAUSE (why it happens), FIX (the verified remediation), and
  VERIFY (how to confirm the fix works).

  Audit agents: scan the project for the TRIGGER signals listed in each entry.
  Remediation agents: when you encounter an issue matching one of these entries,
  apply the FIX as written — do not improvise unless the code has diverged.

  These are NOT speculative best practices. Every entry below is a bug that
  shipped to production at least once and caused real damage. Treat them as
  load-bearing checks, not style preferences.
-->

# Swift / iOS / macOS Gotcha Catalogue

## Quick index

| # | Failure mode | Detect when |
|---|---|---|
| 1 | CKContainer eager-init crash in unsigned test builds | Project uses CloudKit AND CI runs `xcodebuild test ... CODE_SIGNING_ALLOWED=NO` |
| 2 | SwiftData missing inverse relationship crash | Project has `@Model` classes with `@Relationship` properties |
| 3 | SwiftData CloudKit cross-Apple-ID sharing gap | SwiftData with `cloudKitDatabase: .automatic` AND household/team/family/share keywords |
| 4 | iCloud ubiquity container silent failure | iCloud entitlement AND `url(forUbiquityContainerIdentifier:)` calls |
| 5 | iCloud symlink content corruption | Code mirrors content into `~/Library/Mobile Documents/` paths |
| 6 | SwiftUI xcstrings localization silent failures | `Localizable.xcstrings` file present OR `String(localized:)` calls |
| 7 | XcodeGen project generation gotchas | `project.yml` (XcodeGen) detected |
| 8 | TestFlight upload validation gotchas | CI workflow uploads to TestFlight via `apple-actions/upload-testflight-build` or `xcrun altool` |
| 9 | xcodebuild App Group provisioning auth failure | App Groups, Push, or extension targets in `.entitlements` |
| 10 | iOS first-IAP submission rejection | `import StoreKit` AND `Product.products(for:)` calls |
| 11 | `.foregroundStyle(.accentColor)` compile failure | Any SwiftUI code using `.foregroundStyle(.accentColor)` |
| 12 | Keychain test failures in simulator | `SecItemAdd` / `SecItemCopyMatching` used for symmetric keys |

---

## 1. CKContainer eager-init crash in unsigned test builds

### Trigger
- `xcodebuild test ... CODE_SIGNING_ALLOWED=NO` fails with: `Early unexpected exit, operation never finished bootstrapping - no restart will be attempted` and `The test runner crashed before establishing connection`
- Crash report shows `EXC_BREAKPOINT (SIGTRAP)` with frames in `CKContainer.__allocating_init(identifier:)`
- CloudKit emits a "Significant issue" log: `In order to use CloudKit, your process must have a com.apple.developer.icloud-services entitlement`
- Tests pass with full code signing but fail with `CODE_SIGNING_ALLOWED=NO`
- All CloudKit usage IS gated behind a feature flag, yet the app still crashes at launch

### Root cause
`CKContainer(identifier:)` does **not** throw or return nil when the iCloud entitlement is missing — it traps the process via an OS-level fault (`brk 1`). `CODE_SIGNING_ALLOWED=NO` strips entitlements from the simulator build. A stored property like `private let container = CKContainer(...)` runs its initializer the moment the enclosing object is constructed, so any code that touches the singleton (even just to hold a reference) triggers the trap. Feature flags do not protect against this — construction happens before any flag check.

### Fix
Convert every CloudKit stored property to `lazy var`:

```swift
final class CloudKitSync {
    static let shared = CloudKitSync()

    // Lazy so CKContainer is only constructed when CloudKit is actually used.
    // CKContainer(identifier:) traps when the iCloud entitlement is missing
    // (e.g. unsigned test builds with CODE_SIGNING_ALLOWED=NO).
    private lazy var container = CKContainer(identifier: "iCloud.foo.bar")
    private var privateDB: CKDatabase { container.privateCloudDatabase }

    private init() {}
}
```

`lazy` requires `var`, not `let`. Safe because the property is private and the singleton is `@MainActor`-isolated. Same fix applies to `CKDatabase`, `CKQuerySubscription`, `CKRecordZone`, and any other CloudKit type whose initializer touches the container.

Audit checklist:
- Every stored property of type `CKContainer`, `CKDatabase`, `CKQuerySubscription`, `CKRecordZone` must be `lazy var` or computed
- No app-launch code path (`App.init`, `@StateObject` default value, eager singleton ref) calls a method on the singleton that touches the lazy container

### Verify
```bash
xcodebuild test \
  -project YourApp.xcodeproj \
  -scheme YourApp \
  -destination "platform=iOS Simulator,name=iPhone 17 Pro" \
  -configuration Debug \
  CODE_SIGNING_ALLOWED=NO \
  -only-testing:YourAppTests
```
Tests should build, launch, and execute. Production signed builds remain unaffected — the `lazy` change is transparent.

### Notes
- `try?` around `CKContainer(identifier:)` does NOT help — the init is not `throws`, it OS-faults
- This crash is silent in `-quiet` mode — re-run without `-quiet` and grep for `CK]`, `EXC_`, or `Significant issue`

---

## 2. SwiftData missing inverse relationship crash

### Trigger
- `ModelContainer(for:configurations:)` throws `SwiftDataError._Error.loadIssueModelContainer`
- The error occurs for BOTH persistent AND in-memory `ModelConfiguration` (rules out migration / CloudKit / corrupted store)
- Recently added a new `@Model` class with a `@Relationship` to an existing model
- The error message does NOT identify which model or relationship is broken

### Root cause
SwiftData CAN auto-infer inverse relationships when both sides declare them, but it CANNOT create the inverse property when only one side does. Every `@Relationship` property must have a matching declaration on the target model. CloudKit (`cloudKitDatabase: .automatic`) makes the requirement even stricter — all relationships must have explicit inverses.

### Fix
1. Map all relationships across every `@Model` class:

   | Model A property | Model B property | Status |
   |---|---|---|
   | `Horse.vetRecords: [VetRecord]?` | `VetRecord.horse: Horse?` | OK — auto-inferred |
   | `BarnNote.horse: Horse?` | _(nothing on Horse)_ | BROKEN — missing inverse |

2. Add the missing inverse on the target model:
   ```swift
   // Horse.swift — ADD THIS:
   @Relationship(deleteRule: .cascade)
   var barnNotes: [BarnNote]? = nil
   ```

3. Delete the app from the simulator/device to clear any corrupted local store, then rebuild.

4. Add this unit test so the issue can never silently regress:
   ```swift
   func testModelContainerSchemaIsValid() throws {
       _ = try ModelContainer(
           for: ModelA.self, ModelB.self, /* every @Model type */,
           configurations: ModelConfiguration(isStoredInMemoryOnly: true)
       )
   }
   ```

### Verify
The unit test above passes. If the in-memory container initializes successfully, the schema is valid — any remaining persistent-store errors are migration issues, not schema issues.

### Diagnostic flow when you see `loadIssueModelContainer`
1. It's NOT a migration issue (in-memory stores don't migrate)
2. It's NOT a CloudKit issue (in-memory stores don't use CloudKit)
3. It IS a schema definition issue — check ALL `@Relationship` properties
4. Use `git log` to find the commit that added the new model and verify both sides were updated

---

## 3. SwiftData CloudKit cross-Apple-ID sharing gap

### Trigger
- App uses `cloudKitDatabase: .automatic` and needs spouse / family member / teammate (different Apple ID) to collaborate
- Compiler error: `type 'CKShare.Metadata' has no member 'activityType'` or `activityTypeKey`
- Compiler error: `(saved, _) = try await db.modifyRecords(...)` doesn't compile
- `ModelConfiguration` has no `cloudKitDatabase: .shared` case
- Spouse/teammate logs in on a different Apple ID and sees an empty database despite the inviter having data

### Root cause
SwiftData's `cloudKitDatabase: .automatic` only syncs the user's own private database across the user's own devices. There is no `.shared` option. Apple's official answer is "drop SwiftData and use `NSPersistentCloudKitContainer` directly" — but you can keep SwiftData and overlay a `CKShare` on a custom `CKRecordZone` instead.

### Fix
Architecture: keep SwiftData as the local source of truth, overlay a `CKShare` on a custom `CKRecordZone` per shareable root, and let the CKShare handshake piggyback on the same CloudKit container SwiftData is already using.

Step 1 — add a stable zone identifier to your shareable root model:
```swift
@Model
final class Household {
    var name: String = ""
    var cloudZoneName: String = ""           // ← stable per-household zone ID
    var ownerUserRecordName: String?         // nil = local user owns it
    var shareIsActive: Bool = false

    init(name: String) {
        self.name = name
        self.cloudZoneName = "Household-\(UUID().uuidString)"
    }
    var isOwner: Bool { ownerUserRecordName == nil }
}
```

Step 2 — sharing service. Two non-obvious bits:
1. The modern async `db.modifyRecords(saving:deleting:)` returns DICTIONARIES, not arrays:
   ```swift
   let result = try await privateDB.modifyRecords(saving: [rootRecord, share], deleting: [])
   // result.saveResults is [CKRecord.ID: Result<CKRecord, Error>]
   let savedShare = result.saveResults.values.compactMap { res -> CKShare? in
       if case .success(let record) = res { return record as? CKShare }
       return nil
   }.first
   ```
2. `container.accept([metadata])` returns a value the compiler will warn about — bind it explicitly:
   ```swift
   _ = try await container.accept([metadata])
   ```

Step 3 — accept incoming shares. The activity type is the well-known string `"com.apple.CloudKit.ShareMetadata"` and the metadata lives under `"CKShareMetadata"` in `userInfo`. **There is NO `CKShare.Metadata.activityType` constant** even though older Apple sample code references one. Hardcode the strings:
```swift
WindowGroup {
    ContentView()
        .modelContainer(container)
        .onContinueUserActivity("com.apple.CloudKit.ShareMetadata") { activity in
            guard let metadata = activity.userInfo?["CKShareMetadata"] as? CKShare.Metadata else { return }
            Task { @MainActor in
                _ = try? await CloudKitSharingService.shared.acceptShare(metadata: metadata)
            }
        }
}
```

Step 4 — SceneDelegate fallback. The SwiftUI `onContinueUserActivity` callback is unreliable on cold launch (iOS 17/18). Implement BOTH paths if your app supports cold-launch share acceptance:
```swift
// UIWindowSceneDelegate
func windowScene(_ windowScene: UIWindowScene,
                 userDidAcceptCloudKitShareWith metadata: CKShare.Metadata) {
    Task { @MainActor in
        try? await CloudKitSharingService.shared.acceptShare(metadata: metadata)
    }
}
```
On macOS: `application(_:userDidAcceptCloudKitShareWith:)` on `NSApplicationDelegate`.

Step 5 — owner records live in `privateCloudDatabase`, accepted shares live in `sharedCloudDatabase`. SwiftData's CloudKit mirror handles both automatically once accepted, but if you query CKRecords directly you must pick the right database.

### Verify
1. Owner-side: create a household, tap Invite. `UICloudSharingController` opens with a share URL. CloudKit Dashboard → Zones shows a new `Household-<UUID>` zone with a `HouseholdRoot` record containing a `cloudkit.share` field.
2. Member-side: send the URL to a different Apple ID via Messages. Tap the URL. Your `onContinueUserActivity` (or scene delegate) callback fires with metadata.
3. Sync test: owner adds a child entity → member sees it within ~10 seconds. (No manual record mirroring.)
4. To ship to TestFlight you must hit **Deploy Schema Changes…** in CloudKit Console to promote custom record types to PRODUCTION.

### Notes
- `@MainActor` deinit gotcha: if you make the sharing service `@MainActor`, you cannot reference any main-actor-isolated stored properties from `deinit`. Just delete the deinit (singletons live forever).

---

## 4. iCloud ubiquity container silent failure

### Trigger
- App has `com.apple.developer.icloud-container-identifiers` entitlement
- `FileManager.url(forUbiquityContainerIdentifier:)` returns a non-nil URL
- App shows empty state (0 items) despite files in local Documents directory
- Import operations appear to succeed but data is never persisted
- Removing `try?` reveals: "You don't have permission to save the file 'foo' in the folder 'Documents'"

### Root cause
`url(forUbiquityContainerIdentifier:)` returning non-nil only means the entitlement is **configured** — NOT that the container is ready for use. `try?` then swallows the actual permission error, leaving the app silently operating on an inaccessible directory.

### Fix
Verify-then-use pattern with fallback. Never trust the URL alone:
```swift
private init() {
    let fm = FileManager.default
    let resolvedDir: URL
    let resolvedICloud: Bool

    if let iCloudURL = fm.url(forUbiquityContainerIdentifier: "iCloud.com.example.App") {
        let targetDir = iCloudURL.appendingPathComponent("Documents/data")
        var iCloudWorks = false
        do {
            try fm.createDirectory(at: targetDir, withIntermediateDirectories: true)
            // Critical: verify the directory is actually accessible
            _ = try fm.contentsOfDirectory(at: targetDir, includingPropertiesForKeys: nil)
            iCloudWorks = true
        } catch {
            // iCloud container exists but isn't accessible (permission denied, etc.)
        }
        if iCloudWorks {
            resolvedDir = targetDir
            resolvedICloud = true
        } else {
            // Fall back to local Documents
            let docs = fm.urls(for: .documentDirectory, in: .userDomainMask)[0]
            let local = docs.appendingPathComponent("data")
            try? fm.createDirectory(at: local, withIntermediateDirectories: true)
            resolvedDir = local
            resolvedICloud = false
        }
    } else {
        let docs = fm.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let local = docs.appendingPathComponent("data")
        try? fm.createDirectory(at: local, withIntermediateDirectories: true)
        resolvedDir = local
        resolvedICloud = false
    }

    self.dataDirectory = resolvedDir
    self.isICloud = resolvedICloud
}
```

Anti-pattern to flag during audit:
```swift
// BAD: assumes non-nil URL means the directory is usable
if let iCloudURL = fm.url(forUbiquityContainerIdentifier: "...") {
    let dir = iCloudURL.appendingPathComponent("Documents/data")
    try? fm.createDirectory(at: dir, withIntermediateDirectories: true)  // silently fails!
    self.dataDirectory = dir
}
```

### Verify
1. Add temporary logging of the resolved path
2. Verify `contentsOfDirectory` succeeds on the chosen path
3. Write a test file and read it back

### Notes
- Common in: Debug builds from Xcode without full iCloud provisioning, capability added but container not created in Apple Developer portal, first launch before iCloud sync initialized, user not signed into iCloud
- In sandboxed macOS apps, `FileManager.urls(for: .documentDirectory)` returns `~/Library/Containers/<bundleId>/Data/Documents/`, not the user's Documents folder

---

## 5. iCloud symlink content corruption (sparse / dehydrated files)

### Trigger
- `stat -f '%z' file` shows size > 0 but `stat -f '%b' file` shows `0` blocks
- Files open and read successfully but return empty content
- `JSONDecoder` fails on files that "exist" with non-zero reported size
- Content directory was symlinked or rsynced into iCloud Drive

### Root cause
When you migrate content from local storage to iCloud Drive (symlink or rsync), iCloud may create "dehydrated" placeholder files: non-zero `st_size` but `st_blocks=0`. The files appear to exist but read as empty. This silently corrupts data.

### Fix
1. Detect sparse files (macOS `stat` syntax):
   ```bash
   for f in $(find /path/to/content -type f); do
     size=$(stat -f '%z' "$f" 2>/dev/null)
     blocks=$(stat -f '%b' "$f" 2>/dev/null)
     if [ "$size" -gt 0 ] 2>/dev/null && [ "$blocks" = "0" ]; then
       echo "SPARSE: $f"
     fi
   done
   ```
2. Recovery priority order: git history (only for previously-tracked files) → Time Machine → manual reconstruction.
3. Delete irrecoverable sparse placeholders — they waste space and cause misleading `stat` results.
4. **Never rsync local → iCloud with `--delete`** if you suspect corruption — the backup mirrors the corruption.

### Audit checks
Flag any code that mirrors content into `~/Library/Mobile Documents/` paths without integrity verification (e.g., post-write `stat` or hash check). Binary files (images, video) that were never in git are completely irrecoverable from history.

---

## 6. SwiftUI xcstrings localization silent failures

A connected family of bugs. Each is silent — the app builds and runs, but UI ships in the wrong language.

### 6.1 — `Text(stringVariable)` does NOT auto-localize
**Trigger:** strings appear in English in the UI; xcstrings has correct translations; device language is set correctly.
**Cause:** `Text("literal")` accepts `LocalizedStringKey` and auto-localizes. `Text(someVar)` where `someVar: String` does NOT — it renders raw. Any reusable component accepting `title: String` and passing it to `Text(title)` ships untranslated UI.
**Fix:** Either change the parameter type to `LocalizedStringKey` (for literal-only callers), OR document that callers must pre-localize via `String(localized:)`.

### 6.2 — `String(localized:)` ignores SwiftUI environment locale
**Trigger:** in-app language picker changes formatting (dates/numbers) but not string translations.
**Cause:** `String(localized:)` uses `Bundle.main.preferredLocalizations`, controlled by `UserDefaults["AppleLanguages"]` — NOT by `.environment(\.locale)`. The SwiftUI environment locale only affects formatting, not catalog lookups.
**Fix:** Either (a) write to `AppleLanguages` and prompt for restart, OR (b) build an `appLocalized()` helper that passes the user's chosen locale explicitly:
```swift
extension Locale {
    static var app: Locale {
        let id = UserDefaults.standard.string(forKey: "com.example.appLocale") ?? ""
        return id.isEmpty ? .current : Locale(identifier: id)
    }
}

func appLocalized(_ key: String.LocalizationValue, comment: StaticString = "") -> String {
    String(localized: key, locale: .app, comment: comment)
}
```
Use `appLocalized()` everywhere instead of `String(localized:)`. Always pass `comment:` so the xcstrings extractor populates context for translators.

### 6.3 — AGA `^[...](inflect: true)` requires `LocalizedStringKey`
**Trigger:** Badge or label shows `^[0 horse](inflect: true)` literally instead of "0 horses".
**Cause:** Apple's Automatic Grammar Agreement only fires when rendered as `Text(LocalizedStringKey)`. `String(localized: "^[\(count) horse](inflect: true)")` returns a plain `String`, strips the AGA pipeline, and renders the markup literally. AGA `inflect: true` is also unreliable for non-English locales.
**Fix:** Use xcstrings `variations.plural` for ALL locales including English:
```json
"^[%lld horse](inflect: true)": {
  "localizations": {
    "en": {
      "variations": { "plural": {
        "one":   { "stringUnit": { "state": "translated", "value": "%lld horse" } },
        "other": { "stringUnit": { "state": "translated", "value": "%lld horses" } }
      }}
    }
  }
}
```

### 6.4 — Static cached `DateFormatter` breaks locale switching
**Trigger:** Dates render in the original device language even after the user switches in-app language.
**Cause:** Static `DateFormatter` instances capture locale at creation time and never update.
**Fix:** Use `Date.FormatStyle` (respects current locale, Foundation caches internally), OR construct a fresh formatter per call. Static caching IS safe for locale-independent formats like `yyyyMMdd` — set `locale = Locale(identifier: "en_US_POSIX")` to prevent calendar interference.

### 6.5 — `date.formatted(...)` vs `Text(date, format:)` in views
**Cause:** `date.formatted(...)` returns a `String` using `Locale.current` (system locale, non-reactive). `Text(date, format: ...)` uses the SwiftUI environment locale and IS reactive.
**Fix:** Prefer `Text(date, format: .dateTime.weekday(.abbreviated))` in view bodies.

### 6.6 — Localized strings stored in SwiftData / CoreData
**Cause:** Storing `"Lektion"` (German) and reading in French gives mixed-language UI.
**Fix:** Always store raw enum values; compute `displayName` at render time:
```swift
@Model final class Transaction {
    var categoryRaw: String = "lesson"  // raw enum value
    var category: TransactionCategory {
        get { TransactionCategory(rawValue: categoryRaw) ?? .other }
        set { categoryRaw = newValue.rawValue }
    }
}
```
Same rule for dates: store `Date`, format for display only. Use `ISO8601DateFormatter` for export/import.

### 6.7 — Missing `comment:` parameter on `String(localized:)`
Translators have no context, and the xcstrings extractor won't auto-populate hints. Always pass `comment:`.

### 6.8 — Missing `en` entry in xcstrings when other languages are present
Causes English UI to display with raw `^[...]` markup or fall back to keys.

---

## 7. XcodeGen project generation gotchas

### 7.1 — Missing bundle ID on simulator install
**Trigger:** `xcodebuild test` fails with "Simulator device failed to install the application. Missing bundle ID." despite `PRODUCT_BUNDLE_IDENTIFIER` being correctly set.
**Cause:** `GENERATE_INFOPLIST_FILE: false` with a custom Info.plist that contains only app-specific keys. Xcode expects the plist to contain ALL required keys (`CFBundleIdentifier`, `CFBundleExecutable`, `CFBundlePackageType`).
**Fix:** Set `GENERATE_INFOPLIST_FILE: true` even when providing a custom Info.plist. Xcode will merge your custom keys with auto-generated standard keys.
```yaml
settings:
  base:
    INFOPLIST_FILE: MyApp/Info.plist
    GENERATE_INFOPLIST_FILE: true  # merges custom + standard keys
```

### 7.2 — Preview Content Swift files not compiling
**Trigger:** Build fails with "cannot find 'PreviewSampleData' in scope".
**Cause:** `buildPhase: none` on the entire `Preview Content/` directory excludes ALL files including Swift sources. Correct for asset catalogs, wrong for Swift files needed at runtime (e.g., `PreviewSampleData.swift` used via `-SeedSampleData` launch argument).
**Fix:** Only exclude the asset catalog, not the entire directory:
```yaml
# CORRECT
sources:
  - path: MyApp
    excludes:
      - Preview Content/PreviewAssets.xcassets
  - path: MyApp/Preview Content/PreviewAssets.xcassets
    buildPhase: none
```
Note: in Release builds on CI, `DEVELOPMENT_ASSET_PATHS` files may be stripped — for runtime-needed Swift files, MOVE them OUT of `Preview Content/` into the main source tree.

### 7.3 — UILaunchScreen disappears after `xcodegen generate` (iOS letterbox mode)
**Trigger:** iOS app renders in a tiny letterboxed/compatibility window with large black borders. App was full-screen before but regressed after `xcodegen generate`.
**Cause:** When using XcodeGen's `info.path`, `xcodegen generate` **overwrites the entire plist file** from scratch using only the keys in `info.properties`. Any keys you manually added to the plist (like `UILaunchScreen`) are silently deleted. Without `UILaunchScreen` (even as an empty dict), iOS falls back to legacy compatibility mode.
**Fix:** Move `UILaunchScreen` into `project.yml`'s `info.properties`:
```yaml
targets:
  MyApp:
    info:
      path: MyApp/Info.plist
      properties:
        UILaunchScreen: {}    # Empty dict = auto-generated launch screen
        CFBundleDisplayName: MyApp
```
Also REMOVE `INFOPLIST_KEY_UILaunchScreen_Generation: true` from build settings if both are present — they create a nested `UILaunchScreen > UILaunchScreen` structure. After fixing, **uninstall the app from the simulator** before reinstalling — the simulator caches the old launch screen configuration.

### 7.4 — General rule
**Never manually edit the Info.plist file when using XcodeGen's `info.path`.** All custom keys must go in `info.properties` in `project.yml`, or they will be lost on next `xcodegen generate`.

---

## 8. TestFlight upload validation gotchas

These all happen SERVER-SIDE at Apple, not during local build/archive. CI shows green and the build succeeds, but the IPA never appears in TestFlight.

### 8.1 — iPad multitasking interface orientations (code 409, fatal)
**Symptom:** `Invalid bundle. The "UIInterfaceOrientationPortrait" orientations were provided ... but you need to include all of the [4 orientations] to support iPad multitasking.`
**Cause:** Apple requires all 4 interface orientations declared in `UISupportedInterfaceOrientations`, OR the app must opt out of iPad multitasking via `UIRequiresFullScreen: true`. Applies even to iPhone-only apps.
**Fix:** Add to Info.plist:
```xml
<key>UISupportedInterfaceOrientations</key>
<array>
    <string>UIInterfaceOrientationPortrait</string>
    <string>UIInterfaceOrientationPortraitUpsideDown</string>
    <string>UIInterfaceOrientationLandscapeLeft</string>
    <string>UIInterfaceOrientationLandscapeRight</string>
</array>
<key>UIRequiresFullScreen</key>
<true/>
```
Or as XcodeGen build settings:
```yaml
INFOPLIST_KEY_UISupportedInterfaceOrientations: "UIInterfaceOrientationPortrait UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight"
INFOPLIST_KEY_UISupportedInterfaceOrientations_iPad: "UIInterfaceOrientationPortrait UIInterfaceOrientationPortraitUpsideDown UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight"
INFOPLIST_KEY_UIRequiresFullScreen: YES
```

### 8.2 — Missing document configuration (code 90737, warning today / fatal future)
**Symptom:** `Missing Document Configuration. By declaring the CFBundleDocumentTypes key ... you've indicated that your app is able to open documents. Please set the LSSupportsOpeningDocumentsInPlace key to YES (recommended) or NO.`
**Cause:** Declaring `CFBundleDocumentTypes` requires also declaring how the app handles document access.
**Fix:**
```xml
<key>LSSupportsOpeningDocumentsInPlace</key>
<true/>
```

### 8.3 — `apple-actions/upload-testflight-build` reports success on UPLOAD FAILED
**Cause:** The action wraps `xcrun altool`, which outputs validation errors in XML plist format. The action exit code can still be 0 even when the plist contains `UPLOAD FAILED`.
**Fix:** In CI release workflows, always grep raw upload logs:
```bash
gh run view --job=<JOB_ID> --log 2>&1 | grep -i -E '(UPLOAD FAILED|product-errors|product-warnings)'
```
Always check TestFlight after CI completes to confirm the build actually arrived. Don't trust the green checkmark.

---

## 9. xcodebuild App Group provisioning auth failure

### Trigger
- `xcodebuild archive -allowProvisioningUpdates` fails with: `Authentication failed: Make sure a bearer token was provided, it is properly configured and signed, and it has not expired.`
- AND: `Provisioning profile "iOS Team Provisioning Profile: <bundle-id>" doesn't include the App Groups capability`
- The same API key WORKS for `xcrun altool --upload-app`
- Common scenario: adding a WidgetKit extension with shared App Group to an existing app

### Root cause
The App Store Connect API key (`.p8`) has different permission scopes:
- **Upload / App Management**: works via `altool` for submitting builds
- **Provisioning Profile Management**: requires Xcode GUI session OR an API key with Admin/Developer role and certificate/profile management permissions

When `xcodebuild` encounters a new capability not in the existing provisioning profile, it tries to register the App Group identifier and regenerate profiles via the Apple Developer Portal API. This requires higher permissions than upload-only.

The error message ("bearer token not provided") is misleading — it's actually a permissions issue.

### Fix
Manually fix provisioning ONCE in Xcode GUI before committing to CI:
1. `open YourProject.xcodeproj`
2. Select the main app target → Signing & Capabilities
3. Click "Fix Issue" / "Register" for each capability
4. Repeat for the widget/extension target
5. Once Xcode builds successfully, the CLI deploy script will work

Alternative: register the App Group + bundle ID capabilities manually via the Apple Developer Portal at `https://developer.apple.com/account/resources/identifiers/`.

For XcodeGen multi-platform targets with widget extensions: use `platformFilter: iOS` on the dependency since widgets are primarily iOS.

---

## 10. iOS first-IAP submission rejection (Guideline 2.1b / 3.1.1)

### Trigger
- App rejected with "Unable to make IAP purchases" in sandbox review
- All IAPs show "Developer Action Needed" / "Rejected" status
- Error in app: "Purchase failed: Unable to Complete Request"
- App rejected for missing "Restore Purchases" button (Guideline 3.1.1)

### Root causes (often combined)
1. **Missing Restore button:** apps that offer IAPs MUST include a distinct, user-tappable Restore button on the same screen where IAPs are shown. Not buried in deep settings.
2. **Hardcoded fallback price:** `Text(price ?? "$0.99")` shows a tappable button before products load, which the App Reviewer taps and gets a failed purchase.
3. **First-time IAPs CANNOT be tested in TestFlight sandbox.** Products will load (prices display correctly) but `product.purchase()` will fail with "Unable to Complete Request". This is NOT a code bug — it's a sandbox limitation for unapproved IAPs.

### Fixes

**Restore button (StoreKit 2):**
```swift
func restorePurchases() async -> Bool {
    do {
        try await AppStore.sync()
    } catch {
        purchaseError = "Failed to restore: \(error.localizedDescription)"
        return false
    }
    await refreshPurchaseState()
    return true
}
```
Place the button on the same screen where IAPs are shown AND in Settings for discoverability. Show loading state during restore, error/success alerts.

**PurchaseButton UX — never show a hardcoded fallback price:**
```swift
// BAD: shows tappable $0.99 even when product isn't loaded
Text(price ?? "$0.99")

// GOOD: ProgressView until product resolves
if let price {
    Button(action: action) { Text(price) }
} else {
    ProgressView()
}
```

**Local StoreKit testing:** add a `.storekit` configuration file and reference it in the scheme's `LaunchAction` (`storeKitConfigurationFileReference`). Run from Xcode — purchases use the local test environment with no App Store Connect dependency. Note: only affects debug runs; archived/TestFlight builds use real sandbox.

**Submitting first-time IAPs alongside the app version (the App Store Connect UI changed):**
1. Go to the app version page → click "Add for Review" — this creates a Draft Submission
2. Go to each individual IAP page → click "Submit for Review" on each — adds it to the same draft
3. Open the Draft Submission (bottom of any page) → click "Submit for Review"

**Clearing rejected IAP localizations:** for each IAP, edit the English (U.S.) localization (any minor edit), Save → status changes from "Rejected" to "Prepare for Submission". This can be automated with Playwright since App Store Connect is a web app.

### Notes
- Sandbox tester accounts (Users and Access > Sandbox) now require an existing Apple Account
- For TestFlight, sandbox purchases use the user's real Apple ID automatically — no separate sandbox account needed
- Bank account "Processing" status does NOT block sandbox purchases for approved IAPs

---

## 11. `.foregroundStyle(.accentColor)` compile failure

### Trigger
SwiftUI compile error on `.foregroundStyle(.accentColor)`.

### Cause
`ShapeStyle` has no `.accentColor` member.

### Fix
```swift
// WRONG
.foregroundStyle(.accentColor)

// CORRECT
.foregroundStyle(Color.accentColor)
```

---

## 12. Keychain test failures in simulator (CryptoKit)

### Trigger
- AES-GCM encryption with key stored in Keychain via CryptoKit
- `SecItemAdd` and `SecItemCopyMatching` silently return non-success in test environment
- Encrypt-then-decrypt roundtrip test fails because a new key is generated on each `getOrCreateKey()` call

### Fix
Add an in-memory key cache as fallback so tests don't depend on Keychain persistence:
```swift
private static var cachedKey: SymmetricKey?

private static func getOrCreateKey() -> SymmetricKey? {
    if let existingKey = loadKeyFromKeychain() {
        cachedKey = existingKey
        return existingKey
    }
    if let cached = cachedKey {
        return cached
    }
    let newKey = SymmetricKey(size: .bits256)
    cachedKey = newKey
    saveKeyToKeychain(newKey)
    return newKey
}
```

---

## How audit agents should use this catalogue

1. In Phase 0, the orchestrator detects project characteristics (CloudKit, SwiftData, iCloud, xcstrings, StoreKit, XcodeGen, CI release path) and lists the relevant entries from this catalogue's quick index for each downstream audit agent.
2. Audit agents grep / read for the **TRIGGER** signals in each relevant entry. When a trigger matches, the agent files a finding referencing the entry number and severity.
3. Remediation agents receive this catalogue as part of their context. When fixing an issue that matches an entry, they apply the FIX **as written** rather than improvising. The fixes here have all shipped in real projects.
4. Test enhancement (Phase 4c) uses the test patterns embedded in entries 1, 2, 6, and 10 (CloudKit smoke test, `testModelContainerSchemaIsValid`, localization round-trip, IAP product-loading test) when the relevant project characteristics are present.

Severity guidance:
- **CRITICAL**: app-launch crashes (#1, #2), App Store rejection (#10 missing Restore), data loss (#5)
- **HIGH**: silent data corruption (#4, #6.6), build/release pipeline failures (#7.1, #7.3, #8.1), compile failures (#11)
- **MEDIUM**: UX bugs that ship to users (#6.1–6.5, #6.7), warnings that may become fatal (#8.2)
- **LOW**: code clarity / convention drift
