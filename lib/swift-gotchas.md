<!--
  swift-gotchas.md — failure modes in Swift / iOS / macOS projects that have shipped
  and are hard to see in the code, read by /do:better-swift audit and remediation
  agents. General Swift and SwiftUI practice is deliberately left out.

  Audit agents: look for an entry's "Detect" signals and cite the entry number in
  the finding. Remediation agents: treat an entry's fix as the known-good starting
  point and adapt it to the project's code. Entries marked "Surface to the user"
  need an action in Xcode, App Store Connect, or the Apple Developer portal that an
  agent cannot take: report them, do not attempt a code workaround.
-->

# Swift / iOS / macOS Gotcha Catalogue

## Quick index

| # | Failure mode | In scope when | Typical severity |
|---|---|---|---|
| 1 | `CKContainer` eager-init crash in unsigned test builds | CloudKit, and CI or tests build with `CODE_SIGNING_ALLOWED=NO` | CRITICAL |
| 2 | SwiftData `loadIssueModelContainer` from a relationship with no inverse | `@Model` classes with relationships, synced through CloudKit | CRITICAL |
| 3 | SwiftData cannot sync across Apple IDs | `cloudKitDatabase: .automatic` plus household/team/family/share features | Surface to the user |
| 4 | iCloud ubiquity container URL is non-nil but unusable | `url(forUbiquityContainerIdentifier:)` | HIGH |
| 5 | Dehydrated iCloud placeholder files read as empty | Code mirrors content into `~/Library/Mobile Documents/` | CRITICAL (data loss) |
| 6 | String-catalog localization fails silently | `Localizable.xcstrings` or `String(localized:)` | MEDIUM (6.6 HIGH) |
| 7 | XcodeGen regenerates away plist keys and sources | `project.yml` | HIGH |
| 8 | TestFlight upload rejected server-side while CI is green | A CI workflow uploads to TestFlight | HIGH |
| 9 | `xcodebuild` cannot provision a new capability | App Groups, Push, or extension targets in `.entitlements` | Surface to the user |
| 10 | First in-app-purchase submission rejected | StoreKit `Product.products(for:)` | CRITICAL (missing Restore) |
| 11 | Keychain calls fail in simulator tests | `SecItemAdd` / `SecItemCopyMatching` | HIGH |

---

## 1. `CKContainer` eager-init crash in unsigned test builds

**Detect.** `xcodebuild test ... CODE_SIGNING_ALLOWED=NO` fails with `Early unexpected exit, operation never finished bootstrapping` / `The test runner crashed before establishing connection`; the crash report shows `EXC_BREAKPOINT (SIGTRAP)` in `CKContainer.__allocating_init(identifier:)`; the same tests pass when signed. In code: any stored property of type `CKContainer`, `CKDatabase`, `CKQuerySubscription`, or `CKRecordZone` initialised inline, or an app-launch path (`App.init`, a `@StateObject` default, an eager singleton reference) that reaches one.

**Cause.** `CKContainer(identifier:)` neither throws nor returns nil when the iCloud entitlement is missing; it traps the process. `CODE_SIGNING_ALLOWED=NO` builds carry no entitlements. A stored `let container = CKContainer(...)` runs when its owner is constructed, so a feature flag checked later does not help, and neither does `try?` (the initializer is not `throws`).

**Fix.** Make every CloudKit stored property `lazy var` or computed, so the container is built on first real use:

```swift
final class CloudKitSync {
    static let shared = CloudKitSync()
    // CKContainer(identifier:) traps without the iCloud entitlement
    // (unsigned test builds), so construct it only when CloudKit is used.
    private lazy var container = CKContainer(identifier: "iCloud.foo.bar")
    private var privateDB: CKDatabase { container.privateCloudDatabase }
    private init() {}
}
```

`lazy var` is not thread-safe, so keep the owner actor-isolated (for example `@MainActor`) or otherwise serialise first access. Then check that nothing on the launch path touches the lazy property.

**Verify.** Run the test target unsigned (`xcodebuild test ... CODE_SIGNING_ALLOWED=NO`). The crash is invisible under `-quiet`; rerun without it and search the log for `CK]`, `EXC_`, or `Significant issue`.

---

## 2. SwiftData `loadIssueModelContainer` from a relationship with no inverse

**Detect.** In an app that syncs through CloudKit, `ModelContainer(for:configurations:)` throws `SwiftDataError._Error.loadIssueModelContainer`, usually just after a new `@Model` gained a relationship to an existing one. `localizedDescription` is generic, but `print(error)` shows the underlying `NSCocoaErrorDomain Code=134060` with `CloudKit integration requires that all relationships have an inverse, the following do not: <Model>: <property>`.

**Diagnostic flow.** Reproduce in memory with `cloudKitDatabase: .private("<container id>")` and again with `.none`. The CloudKit schema check runs even for an in-memory store and (at least on macOS) without the iCloud entitlement; the default `.automatic` skips it when the process has no entitlement, so an unsigned test with the default configuration passes. Failing only with CloudKit means a CloudKit schema rule; failing with `.none` too means a different schema or migration problem. Without CloudKit, a one-sided relationship loads and saves normally, so it is not the cause there.

**Cause and fix.** CloudKit requires every relationship to have an inverse and be optional. Add the missing side on the target (for example `var barn: Barn?`) and name it with `@Relationship(inverse:)` on the other side. A store created under the broken schema may need the app deleted from the simulator before the fix shows.

**Guard.** Add a test that builds the container in memory with every `@Model` type and the app's CloudKit setting, so a schema error fails in CI rather than at launch:

```swift
func testModelContainerSchemaIsValid() throws {
    _ = try ModelContainer(
        for: ModelA.self, ModelB.self, // every @Model type
        configurations: ModelConfiguration(isStoredInMemoryOnly: true,
                                           cloudKitDatabase: .private("iCloud.foo.bar"))
    )
}
```

---

## 3. SwiftData cannot sync across Apple IDs

**Detect.** The app uses `cloudKitDatabase: .automatic` and its features imply collaboration between different Apple IDs (household, family, team, invite, share); or a second user signs in and sees an empty database.

**Cause.** SwiftData's CloudKit mirroring covers only the signed-in user's private database. `ModelConfiguration` has no shared-database option.

**Surface to the user.** Cross-account sharing is a product and architecture decision (overlay `CKShare` on a custom record zone alongside SwiftData, or move to `NSPersistentCloudKitContainer`), not a remediation. File it as a deferred finding that explains the gap. If the project already has a `CKShare` implementation, two facts explain compile errors seen there: the async `modifyRecords(saving:deleting:)` returns dictionaries of per-record `Result`s, not arrays; and there is no `CKShare.Metadata.activityType` constant, so share acceptance matches the literal activity type `"com.apple.CloudKit.ShareMetadata"`. SwiftUI's `onContinueUserActivity` has been unreliable for share acceptance on cold launch, so such apps also implement `windowScene(_:userDidAcceptCloudKitShareWith:)` (on macOS, `application(_:userDidAcceptCloudKitShareWith:)`).

---

## 4. iCloud ubiquity container URL is non-nil but unusable

**Detect.** The app shows an empty state although files exist locally, or imports appear to succeed but nothing persists. In code: the result of `url(forUbiquityContainerIdentifier:)` is used directly, typically with `try? fm.createDirectory(...)` after it.

**Rule.** A non-nil URL means only that the entitlement is configured, not that the container is usable (unprovisioned debug builds, a container never created in the developer portal, first launch before iCloud has initialised). Before adopting the directory, create it and list its contents with errors propagated, not `try?`; if either fails, fall back to a local directory and record that iCloud is off. The `try?` is what turns a permission error into silent data loss.

Note for sandboxed macOS apps: `FileManager.urls(for: .documentDirectory, ...)` is `~/Library/Containers/<bundle id>/Data/Documents/`, not the user's Documents folder.

---

## 5. Dehydrated iCloud placeholder files read as empty

**Detect.** Code or scripts symlink, copy, or rsync content into `~/Library/Mobile Documents/` (iCloud Drive) and read it back without an integrity check. On disk, an affected file reports a non-zero size but zero allocated blocks (`stat -f '%z %b' <file>` on macOS) and decodes as empty.

**Fix.** Add a post-write and pre-read integrity check (allocated blocks, or a content hash) to the mirroring code, and never mirror with a delete-on-sync option, which propagates the loss.

**Surface to the user.** Recovering already-emptied files is theirs to do, from git history for tracked files or from a backup. Report which paths are affected; do not delete placeholders or attempt recovery.

---

## 6. String-catalog localization fails silently

The app builds and runs; the UI simply ships in the wrong language.

### 6.2 `String(localized:)` ignores the SwiftUI environment locale

**Detect.** An in-app language picker changes date and number formatting but not the translated strings.

**Cause.** `String(localized:)` resolves against the bundle's preferred localization, which follows the `AppleLanguages` default, not `.environment(\.locale)`. The environment locale drives formatting and `Text` with a `LocalizedStringKey`; it does not redirect catalog lookups made through `String`. The `locale:` argument of `String(localized:locale:)` likewise formats interpolated values and does not choose the language.

**Fix.** Either write the chosen language to `AppleLanguages` and ask for a relaunch, or route every lookup through one helper that passes the chosen language's `.lproj` bundle as `bundle:`. Views that can take a `LocalizedStringKey` should, since those do follow the environment.

### 6.3 Automatic Grammar Agreement markup rendered literally

**Detect.** A label shows `^[0 horse](inflect: true)` verbatim.

**Cause.** Inflection is applied when the string is rendered as `Text(LocalizedStringKey)` or built as an attributed string. Passing it through a plain `String` first loses that step. Inflection also supports only a few languages.

**Fix.** Use the catalog's `variations.plural` for every locale, English included:

```json
"%lld horse": {
  "localizations": { "en": { "variations": { "plural": {
    "one":   { "stringUnit": { "state": "translated", "value": "%lld horse" } },
    "other": { "stringUnit": { "state": "translated", "value": "%lld horses" } }
  }}}}
}
```

### Other checks in this family

- `Text(someString)` with a `String` variable does not localize; only a literal or `LocalizedStringKey` does. A reusable view taking `title: String` ships untranslated unless its callers localize first.
- A cached `DateFormatter`, or `date.formatted(...)` in a view body, keeps the locale it was created under; `Text(date, format:)` follows the environment.
- 6.6: display strings stored in SwiftData or Core Data stay in the language they were written in. Store raw enum values and `Date`s, and localize at render time.
- The source language needs its own catalog entry when other languages have one, and `String(localized:)` calls should pass `comment:` for translators.

---

## 7. XcodeGen project generation

### 7.1 "Missing bundle ID" on simulator install

**Detect.** `xcodebuild test` fails with `Simulator device failed to install the application. Missing bundle ID.` although `PRODUCT_BUNDLE_IDENTIFIER` is set.

**Cause.** `GENERATE_INFOPLIST_FILE: false` with a custom Info.plist that holds only app-specific keys, so `CFBundleIdentifier`, `CFBundleExecutable`, and `CFBundlePackageType` are absent.

**Fix.** Keep the custom plist and set `GENERATE_INFOPLIST_FILE: true`; Xcode merges the standard keys in.

```yaml
settings:
  base:
    INFOPLIST_FILE: MyApp/Info.plist
    GENERATE_INFOPLIST_FILE: true
```

### 7.2 Swift files under `Preview Content/` not compiled

**Detect.** Build fails with `cannot find 'PreviewSampleData' in scope`.

**Cause.** `buildPhase: none` on the whole `Preview Content/` directory excludes its Swift sources as well as its asset catalog.

**Fix.** Exclude only the asset catalog:

```yaml
sources:
  - path: MyApp
    excludes:
      - Preview Content/PreviewAssets.xcassets
  - path: MyApp/Preview Content/PreviewAssets.xcassets
    buildPhase: none
```

Files under `DEVELOPMENT_ASSET_PATHS` can be stripped from Release builds, so a Swift file the app needs at runtime belongs in the main source tree, not in `Preview Content/`.

### 7.3 `UILaunchScreen` disappears after `xcodegen generate`

**Detect.** The iOS app renders letterboxed with black borders after a regenerate.

**Cause.** With `info.path`, `xcodegen generate` rewrites the whole plist from `info.properties`, deleting keys that were added to the file by hand. Without `UILaunchScreen` (an empty dictionary is enough) iOS falls back to its legacy compatibility size.

**Fix.** Declare the key in `project.yml`:

```yaml
targets:
  MyApp:
    info:
      path: MyApp/Info.plist
      properties:
        UILaunchScreen: {}
```

Remove `INFOPLIST_KEY_UILaunchScreen_Generation` if it is also set, since the two together nest `UILaunchScreen` inside itself. The simulator caches launch-screen configuration, so uninstall the app before checking the fix.

### 7.4 The general rule

With `info.path`, every custom Info.plist key lives in `info.properties`. A hand edit to the plist file is lost on the next generate, so flag any plist key that is not also in `project.yml`.

---

## 8. TestFlight upload rejected server-side while CI is green

These validations run at Apple after the upload, so the local build and archive succeed and the build never appears in TestFlight.

### 8.1 iPad multitasking orientations (error 409)

**Detect.** `Invalid bundle. The "UIInterfaceOrientationPortrait" orientations were provided ... you need to include all of the ... orientations to support iPad multitasking.` In code: `UISupportedInterfaceOrientations` (or its `~ipad` variant) lists fewer than four orientations for an app that can run on iPad.

**Fix.** Declare all four orientations for iPad (`INFOPLIST_KEY_UISupportedInterfaceOrientations_iPad` in build settings). Do not opt out with `UIRequiresFullScreen`: it is deprecated since iOS/iPadOS 26, and apps built with the iOS 27 SDK are resized regardless of it (Apple TN3192).

### 8.2 Missing document configuration (warning 90737)

**Detect.** The plist declares `CFBundleDocumentTypes` without `LSSupportsOpeningDocumentsInPlace`.

**Fix.** Set `LSSupportsOpeningDocumentsInPlace` to the value that matches how the app handles documents.

### 8.3 The upload step reports success on `UPLOAD FAILED`

**Cause.** `apple-actions/upload-testflight-build` wraps `xcrun altool`, which reports validation errors inside its plist output; the step can exit 0 while that output says `UPLOAD FAILED`.

**Fix.** In a release workflow, fail the job on the content of the upload log, not the exit code. To check a finished run:

```bash
gh run view --job=<JOB_ID> --log 2>&1 | grep -i -E '(UPLOAD FAILED|product-errors|product-warnings)'
```

---

## 9. `xcodebuild` cannot provision a new capability

**Detect.** `xcodebuild archive -allowProvisioningUpdates` fails with `Authentication failed: Make sure a bearer token was provided...` together with `Provisioning profile ... doesn't include the App Groups capability`, typically after adding a widget or other extension that shares an App Group. The same API key still uploads builds.

**Cause.** The message is misleading: the App Store Connect API key is valid but lacks permission to register identifiers and regenerate profiles.

**Surface to the user.** Ask them to open the project in Xcode once and resolve Signing & Capabilities for the app and each extension target, or to register the capability under Identifiers in the Apple Developer portal. After that the command-line build works. Do not change signing settings or entitlements to get around it.

---

## 10. First in-app-purchase submission rejected

**Audit checks (code).**

- A screen that offers purchases has no visible Restore Purchases control. App Review rejects this under guideline 3.1.1; the control calls `AppStore.sync()` and then refreshes entitlements.
- A purchase button shows a hardcoded fallback price (`Text(price ?? "$0.99")`) before products load. A reviewer can tap it and get a failed purchase. Show progress until the product resolves, and enable the button only then.

**Probably not a code bug.** Products that have never been approved have been reported to load and display prices in TestFlight's sandbox and still fail at `product.purchase()` with "Unable to Complete Request". This is field experience, not documented: Apple's sandbox guide asks only for product metadata (reference name, product ID, localized name, price). Check that metadata in App Store Connect before chasing it in code. A `.storekit` configuration file referenced from the scheme exercises the purchase flow locally in debug runs; archived and TestFlight builds use the real sandbox.

**Surface to the user.** First-time products must be submitted together with the app version in App Store Connect, and a rejected product's metadata has to be edited there before it can be resubmitted. Tell the user this is required; an agent cannot do it.

---

## 11. Keychain calls fail in simulator tests

**Detect.** `SecItemAdd` / `SecItemCopyMatching` return a non-success status under test, and an encrypt-then-decrypt round trip fails because a fresh key is generated on every call.

**Cause.** A test-environment problem: Keychain APIs need a signed, entitled process, and the test target has no Keychain entitlement or runs without a host app under `CODE_SIGNING_ALLOWED=NO`.

**Fix.** Do not add an in-memory fallback that production code can also take. Anything encrypted under a key that was never persisted becomes unreadable at the next launch, which is permanent data loss. Put key storage behind a protocol, use the Keychain-backed store in production and an in-memory fake only in tests, and make a failed save abort the encryption with an error. If tests must exercise the real Keychain, fix the test target's entitlements or run it against a host app.
