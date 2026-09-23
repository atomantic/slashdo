---
description: SwiftUI DevSecOps audit, remediation, test enhancement, per-category PRs, CI verification, and an optional multi-reviewer review loop with worktree isolation — optimized for multi-platform Swift/SwiftUI apps (iOS, macOS, watchOS, tvOS, visionOS)
argument-hint: "[--interactive] [--scan-only] [--no-merge] [--review-with <agent>[,<agent>...]] [--review-iterations <n>] [--review-mode <series|parallel>] [--review-stop-on-findings|--review-stop-on-clean] [--reviewer-applies] [--issues-label <name>] [path filter or focus areas]"
---

# Better Swift — Unified DevSecOps Pipeline for SwiftUI Apps

Run the full DevSecOps lifecycle for Swift/SwiftUI multi-platform projects: audit with 8 deduplicated agents (including a UX Consistency & Responsive Layout agent — SwiftUI apps ship a user-facing UI by definition), consolidate findings, remediate in an isolated worktree, create **separate PRs per category** with SemVer bump, verify CI, run the requested review loop(s), and merge.

**Default mode: fully autonomous.** Balanced model profile, no prompts. **There is no default reviewer**: without `--review-with`, no external review runs and PRs are left open for manual review (no auto-merge). Pass `--review-with <agent>` to run a review loop and auto-merge PRs with clean reviews.

**`--interactive` mode:** pauses for model profile selection, review findings approval, guardrail decisions, and merge confirmation.

Parse `$ARGUMENTS` for:
- **`--interactive`**: pause at each decision point for user approval
- **`--scan-only`**: run Phase 0 + 1 + 2 only (audit and plan) — no worktree, no code changes, no PRs. This is the "audit and file the work, don't touch my code" combination: every surviving finding is filed as a labelled tracker issue before the run exits, not just the deferred subset (see the Phase 2 gate)
- **`--no-merge`**: run through PR creation (Phase 5), skip the review loop and merge
- **`--review-with <agent[,agent,...]>`**: reviewer(s) for the Phase 6 review loop on each PR. Accepted slugs: `codex`, `agy` (aliases `gemini` / `antigravity` — the Antigravity CLI's `agy` binary), `claude`, `grok`, `pi`, `cursor` (alias `cursor-agent` — the Cursor Agent CLI), `opencode` (aliases `zen` / `opencode-zen` — the OpenCode CLI), `ollama` (bare `ollama` auto-selects the most capable installed coding model; `ollama[<model>]` pins one, e.g. `ollama[qwen2.5-coder:32b]` — strip the bracket into a per-entry `OLLAMA_MODEL`; `codex`/`claude`/`agy`/`grok`/`pi`/`cursor`/`opencode` likewise accept `<agent>[<model>]` — e.g. `codex[o3]`, `claude[claude-opus-4-8]`, `grok[grok-code-fast-1]`, `opencode[provider/model]` — stripped into a per-entry `REVIEW_MODEL`; empty uses each other CLI's default, while OpenCode receives no slashdo model override, so select an explicit or configured supported provider/model; `copilot` and `@<login>` take no model bracket), `copilot` (**legacy** — GitHub's cloud Copilot review; supported when named, never selected implicitly), `cmd[<invocation>]` — an escape hatch for any harness not in this list (operator-authored shell command, read prompt on stdin, print the same verdict contract; always review-only), or an arbitrary GitHub login `@<login>` — any GitHub user or App/bot (e.g. `@octocat`, `@org-review-bot`, `@some-app[bot]`); slashdo requests its review on the PR and waits for it (GitHub only, never posts an approval itself). Comma-separated, ordered: split on `,` **outside the outermost brackets** (a `,` inside a `cmd[<invocation>]` or a nested `[<model>]` is part of the value; "outermost" is the first `[` to the last `]` of the token), trim, normalize `gemini`/`antigravity` → `agy`, `cursor-agent` → `cursor`, `zen`/`opencode-zen` → `opencode`, dedupe preserving first-occurrence order (each model-taking agent's `[<model>]` bracket, and `cmd`'s verbatim `[<invocation>]`, are part of the dedup identity). Record as `REVIEW_AGENTS`. **No built-in default** — if omitted, leave `REVIEW_AGENTS` unset; the saved-defaults step below fills it from `/do:config`, and only if still unset after that is `REVIEW_AGENTS=[]` (Phase 6 skipped, PRs left open). `copilot` is never added implicitly. Any slot may end in `~opt` (e.g. `ollama~opt`, `ollama[qwen2.5-coder:32b]~opt`) to mark that reviewer **optional/non-blocking** — still requested and its findings still fixed, but an inconclusive result (timeout/skipped/incomplete/no-verdict) never blocks the merge (a hard-error still does); strip `~opt` into a per-entry `{OPTIONAL}` flag before slug parsing; it is not part of the dedup identity (`ollama~opt` == `ollama`, optional-wins on collapse). A slot may also end in `~max=<n>` (e.g. `claude~max=2`, `ollama~max=1`) to cap how many review → fix → re-review cycles that one reviewer runs, or `~effort=<level>` (e.g. `codex[gpt-5.6-luna]~effort=max~opt`, `claude~effort=high~max=2`) to set its reasoning effort (`low`, `medium`, `high`, `xhigh`, `max`). Strip suffixes off the right of each token in any order before slug parsing; dedup excludes `~` suffixes (survivor takes `~opt` if any had it, and cap/effort from the first that carried them). Reject a malformed suffix with `Invalid --review-with suffix on {entry}: ~max must be a non-negative integer and ~effort must be one of low, medium, high, xhigh, max, each appearing at most once; the only suffixes are ~opt, ~max=<n>, and ~effort=<level>.` Abort on an unknown slug with `Unknown --review-with value: {value}. Use one of: codex, agy, claude, grok, pi, cursor, opencode, ollama, copilot, cmd[<invocation>], @<login> (each optionally suffixed ~opt, ~max=<n>, and/or ~effort=<level>).` The reserved token `none` (case-insensitive) is not validated as a slug — `--review-with none` means no reviewer (`REVIEW_AGENTS=[]`) and overrides any saved `review-with` default.
- **`--review-stop-on-findings`** / **`--review-stop-on-clean`** (mutually exclusive): forwarded to each PR's multi-reviewer loop; control when a per-PR reviewer list stops early. Set `REVIEW_STOP_MODE` (`all` default, `on-findings`, or `on-clean`). If both are present, abort with `--review-stop-on-findings and --review-stop-on-clean cannot be combined`.
- **`--review-mode <series|parallel>`**: forwarded to each PR's multi-reviewer loop. `series` (default) runs reviewers one-at-a-time so each sees the prior's committed fixes; `parallel` runs reviews concurrently against one baseline and applies the deduped union once (`--reviewer-applies` and the stop-modes are ignored in parallel). Set `REVIEW_MODE`; if omitted, leave it unset (saved-defaults fills it from `review-mode`; built-in default `series`). Abort with `--review-mode must be one of series, parallel (got: {value}).` on any other value.
- **`--reviewer-applies`**: forwarded to each PR's review loop — the reviewing CLI applies fixes directly instead of the orchestrator — **only on the `codex` pass**, the one reviewer with a verified write-isolated profile; the loop forces every other local reviewer (`claude`/`agy`/`grok`/`pi`/`cursor`/`opencode`/`cmd`) back to review-only (and it has no effect on copilot or `@<login>` passes, which are read-only cloud-side reviews). Record `REVIEWER_APPLIES=true`/`false`.
- **`--review-iterations <n>`**: cap how many review-and-fix cycles a **copilot** or **`@<login>`** pass runs per PR (Phase 6); no effect on `codex`/`agy`/`claude`/`grok`/`pi`/`cursor`/`opencode`/`cmd`/`ollama` passes (their own fixed iteration caps). Set `REVIEW_ITERATIONS`; default `1` (one pass per PR, exiting early on 0 comments). `0` = loop until that reviewer returns 0 comments (legacy, bounded by the 10-iteration guardrail). Must be a non-negative integer; otherwise abort with `--review-iterations must be a non-negative integer (got: {value}).` To move the local-agent / `ollama` caps — or give each reviewer a different budget — use the per-entry `--review-with <agent>~max=<n>` suffix, which overrides this flag for that entry.

After parsing the review flags, apply any **saved defaults** (set via `/do:config`) to the flags the user did NOT pass (the review flags **and** `--issues-label`) — an explicit flag, or `--review-with none`, always overrides a saved default:

!`cat ~/.claude/lib/review-config-defaults.md`

!`cat ~/.claude/lib/config-defaults-issues-merge.md`

- **`--issues-label <name>`**: the label on the GitHub/GitLab issues deferred findings are filed as (see Phase 2). Set `PLAN_LABEL` from `--issues-label`, else the saved `issues-label` default, else `plan`. A saved `issues` key is ignored.
- **`--issues`**: deprecated no-op; print once: `--issues is now the default (PLAN.md mode was removed); the flag can be dropped.`
- **`--no-issues`**: abort with `--no-issues is no longer supported: PLAN.md mode was removed. slashdo records work only as GitHub/GitLab issues.`
- **Path filter**: limit scanning scope to specific directories or files
- **Focus areas**: e.g., "security only", "platform coverage and accessibility"

## Configuration

### Default Mode (autonomous)

Use the **Balanced** model profile (`AUDIT_MODEL_TIER=medium`, `REMEDIATION_MODEL_TIER=medium`).

### Interactive Mode (`--interactive`)

Present the configuration options with `AskUserQuestion`:

```
AskUserQuestion([
  {
    question: "Which model profile for audit and remediation agents?",
    header: "Model",
    multiSelect: false,
    options: [
      { label: "Quality", description: "Strongest available model for all agents — fewest false positives, best results, highest cost" },
      { label: "Balanced (Recommended)", description: "Workhorse model for audit and remediation — good quality at moderate cost" },
      { label: "Budget", description: "Cheapest model for audit, workhorse for remediation — fastest and cheapest" }
    ]
  }
])
```

Record the selection as `MODEL_PROFILE` and derive two **tiers**:

| Agent Role | Quality | Balanced | Budget |
|------------|---------|----------|--------|
| Audit agents (8 Explore agents, Phase 1) | `heavy` | `medium` | `light` |
| Remediation agents (general-purpose, Phase 3) | `heavy` | `medium` | `medium` |

- `AUDIT_MODEL_TIER`: `heavy` / `medium` / `light` based on profile
- `REMEDIATION_MODEL_TIER`: `heavy` / `medium` / `medium` based on profile

These are tiers, not model names — resolve each against the host per [lib/model-tiers.md](../../lib/model-tiers.md). `heavy` means this host's strongest available model **named by its alias** (on Claude Code, `model: "opus"`); never write a fully-qualified version ID. A host that can't set a per-agent model runs everything at the session default — state it and continue. If a `heavy` dispatch is rejected because the account lacks that tier, retry once with `model` omitted, note the degrade, and continue.

### Model Profile Rationale

`heavy` reduces audit false positives. `medium` is the **floor for code-writing agents** — never drop remediation to `light` (the Budget profile keeps remediation at `medium` for this reason).

## Compaction Guidance

When compacting during this workflow, always preserve:
- The `FILE_OWNER_MAP` (complete, not summarized)
- All CRITICAL/HIGH findings with file:line references
- The current phase number and what phases remain
- All PR numbers and URLs created so far
- `BUILD_CMD`, `TEST_CMD`, `PROJECT_TYPE`, `WORKTREE_DIR`, `REPO_DIR` values
- `VCS_HOST`, `CLI_TOOL`, `GH_HOST`, `TRACKER_AVAILABLE`, `DEFAULT_BRANCH`, `CURRENT_BRANCH`
- `PLATFORMS` (list of supported platforms: iOS, macOS, etc.)
- `DEPLOYMENT_TARGETS` (minimum OS versions per platform)
- `BUILD_SYSTEM` (xcodebuild / swift build / xcodegen / tuist)
- `SCHEME`, `WORKSPACE_OR_PROJECT` (Xcode build identifiers)
- `PHASE_4C_START_SHA` (needed for FILE_OWNER_MAP update in Phase 4c.3)
- `VACUOUS_TESTS_FIXED`, `WEAK_TESTS_STRENGTHENED`, `NEW_TEST_CASES`, `NEW_TEST_FILES`
- `CREATED_CATEGORY_SLUGS` (list of branch slugs created in Phase 5)
- `SPOOL_DIR` (the literal spool path Phase 1 created; it cannot be re-derived, and the bodies are read four times: Phase 2 step 3's Foundation grouping, the Phase 2 filer agents, the Phase 3c remediation workers, and the Phase 4c.1 triage — so it is removed in Phase 7, not before)
- `GOTCHA_ENTRIES_IN_SCOPE` (swift-gotchas catalogue entry numbers in scope, recorded in Phase 0e)

## Phase 0: Discovery & Setup

### 0a: VCS Host Detection
Resolve `VCS_HOST` and `CLI_TOOL` here, before any phase reaches for a forge CLI:

!read lib/vcs-host.md

- **When `VCS_HOST=github`, also derive `GH_HOST` from the `origin` remote** and carry it in state, per the shared derivation (and its per-host auth precheck) below. The Phase 6 GitHub-side reviewer loops use `gh api`, which defaults to github.com, so on a GitHub Enterprise repo `GH_HOST` must be forwarded to them or they poll the wrong host and time out.
- **Record `TRACKER_AVAILABLE` once.** `true` when the confirmed `CLI_TOOL` reaches this repo and its issues feature is enabled; otherwise `false`. Deferred findings are filed as issues only when it is `true`; when `false` the run continues, files nothing, and lists every deferred finding (title, one-line rationale, `file:line`) in the Phase 7 report under "Deferred (not filed — no issue tracker available)". Never write PLAN.md as a fallback.

**GitHub only — skip the snippet below entirely on GitLab**, whose `glab` calls resolve the host from the remote themselves and where its `gh auth` precheck would abort the run.

!`cat ~/.claude/lib/gh-host.md`

### 0b: Swift Project Type Detection
Check for Swift project manifests and determine the build system:
- `Package.swift` → Swift Package Manager (SPM)
- `*.xcodeproj` → Xcode project (check for SwiftUI, UIKit, AppKit usage)
- `*.xcworkspace` → Xcode workspace (check for CocoaPods or multi-project)
- `project.yml` → XcodeGen
- `Project.swift` → Tuist

Record the detected system as `BUILD_SYSTEM`.

Determine supported platforms:
1. **SPM**: Read `Package.swift` for `.iOS`, `.macOS`, `.watchOS`, `.tvOS`, `.visionOS` platform declarations
2. **Xcode project**: Run `xcodebuild -list` to get schemes and targets; then `xcodebuild -showBuildSettings -scheme {SCHEME}` to read `SUPPORTED_PLATFORMS` and `IPHONEOS_DEPLOYMENT_TARGET` / `MACOSX_DEPLOYMENT_TARGET` / etc.
3. **XcodeGen/Tuist**: Read `project.yml` / `Project.swift` for platform declarations

Record:
- `PLATFORMS`: list of supported platforms (e.g., `["iOS", "macOS"]`)
- `DEPLOYMENT_TARGETS`: map of platform → minimum version (e.g., `{"iOS": "16.0", "macOS": "13.0"}`)
- `SCHEME`: primary scheme name
- `WORKSPACE_OR_PROJECT`: path to `.xcworkspace` or `.xcodeproj`

Detect additional project characteristics:
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

Record `HAS_VERSION_BUMP=true` — this pipeline always attempts its own Swift-specific **Version Bump Procedure** below (Phase 5b's shared gate, `lib/better-pr-and-ci.md`, otherwise expects Phase 0 to set this).

### 0c: Build & Test Command Detection

**SPM project:**
```bash
BUILD_CMD="swift build"
TEST_CMD="swift test"
```

**Xcode project (single platform):** derive an available simulator dynamically:
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

Then build the commands. Execute these directly (not via shell variable expansion) to avoid quoting issues:
```bash
xcodebuild -scheme {SCHEME} -destination "generic/platform=iOS Simulator" build
xcodebuild -scheme {SCHEME} -destination "platform=iOS Simulator,name=$SIM_DEST" test
```

**Xcode project (multi-platform)** — for each platform in `PLATFORMS`:
- **iOS**: `BUILD_CMD_IOS="xcodebuild -scheme {SCHEME} -destination 'generic/platform=iOS Simulator' build"` / `TEST_CMD_IOS="xcodebuild -scheme {SCHEME} -destination 'platform=iOS Simulator,name=$SIM_DEST' test"`
- **macOS**: `BUILD_CMD_MACOS="xcodebuild -scheme {SCHEME} -destination 'platform=macOS' build"` / `TEST_CMD_MACOS="xcodebuild ... test"`
- **watchOS**: `BUILD_CMD_WATCHOS="xcodebuild -scheme {SCHEME} -destination 'generic/platform=watchOS Simulator' build"`
- **tvOS**: `BUILD_CMD_TVOS="xcodebuild -scheme {SCHEME} -destination 'generic/platform=tvOS Simulator' build"`
- **visionOS**: `BUILD_CMD_VISIONOS="xcodebuild -scheme {SCHEME} -destination 'generic/platform=visionOS Simulator' build"`

Only generate commands for platforms declared in `PLATFORMS`. Set `BUILD_CMD` to run all platform builds sequentially (joined with `&&`) and `TEST_CMD` to run all platform tests.

If the project has a `Makefile` or `fastlane/Fastfile`, prefer its custom build/test lanes when they already handle multi-platform builds.

Record as `BUILD_CMD` and `TEST_CMD`.

### 0d: State Snapshot
- Record `REPO_DIR` via `git rev-parse --show-toplevel`
- Record `CURRENT_BRANCH` via `git rev-parse --abbrev-ref HEAD`
- Record `DEFAULT_BRANCH` via `gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name'` (or `glab` equivalent)
- Record `IS_DIRTY` via `git status --porcelain`
- Resolve how this project logs changes (stated convention in CLAUDE.md/AGENT.md/CONTRIBUTING.md first, else whatever changelog artifacts already exist — a rolling `CHANGELOG.md`, a per-release directory, a fragment tool, or nothing because the notes come from commit messages). Record the target as `CHANGELOG_TARGET` (empty when there is none) and `HAS_CHANGELOG` accordingly
- Check for existing `../better-*` worktrees: `git worktree list`. If found, inform the user and ask whether to resume (use existing worktree) or clean up (remove it and start fresh)

### 0e: Known Gotchas Catalogue

`~/.claude/lib/swift-gotchas.md` catalogues real-world Swift / iOS / macOS failure modes — trigger conditions, root cause, verified fix, and verification steps for bugs that have shipped to production. Skip this section entirely (and leave `GOTCHA_ENTRIES_IN_SCOPE` empty) unless the project shows at least one of: CloudKit, SwiftData, iCloud entitlements, `Localizable.xcstrings`/`String(localized:)`, XcodeGen (`project.yml`), a TestFlight-uploading CI workflow, StoreKit, or Keychain use (`SecItemAdd`/`SecItemCopyMatching`). Otherwise, read the catalogue once:

!read lib/swift-gotchas.md

Match the project against the catalogue's own Quick index (top of the file) — do not duplicate its trigger table here. Record the matching entry numbers as `GOTCHA_ENTRIES_IN_SCOPE` (e.g., `[1, 2, 6, 7, 8, 10]`), routed by category: #1, #2, #4, #5, #12 → Agent 5 (Bugs); #2 also → Agent 7 (Tests); #3 → Agent 4 (Architecture) + Agent 5 (Bugs); #4 also, #6, #7, #8, #9, #10 → Agent 6 (Platform).

<audit_instructions>

## Phase 1: Unified Audit

Project conventions are already in your context; pass relevant conventions to each agent. The gotcha catalogue was already read once in Phase 0e (skip entirely if `GOTCHA_ENTRIES_IN_SCOPE` is empty).

Pass each agent ONLY the `GOTCHA_ENTRIES_IN_SCOPE` entries matching its category (per the Phase 0e routing above), not the whole catalogue.

Launch 8 Explore agents in two batches. Each agent must report findings in this format:
```
- **[CRITICAL/HIGH/MEDIUM/LOW]** `file:line` - Description. Suggested fix: ... Complexity: Simple/Medium/Complex
```

**Findings are spooled to disk, not returned in full.** Create the spool directory before dispatching any agent:

```bash
SPOOL_DIR="$(mktemp -d "${TMPDIR:-/tmp}/slashdo-issues-XXXXXX")"; echo "$SPOOL_DIR"
```

Record the printed path as `SPOOL_DIR` in run state and pass **that literal path** to every agent — a shell variable does not survive between tool calls, so re-deriving it later would hand the filer agents an empty directory.

Pass `SPOOL_DIR` to every audit agent along with the **"Bulk filing — spool the bodies, dedup on an index"** contract from [lib/plan-issue-filing.md](../../lib/plan-issue-filing.md) (the partial Phase 2 reads in). Each agent writes one ready-to-file issue body per finding to `$SPOOL_DIR/<category-slug>.md` — its own slug from Phase 2's summary table (`security`, `code-quality`, `dry`, `architecture`, `bugs-perf`, `platform-swiftui`, `tests`, `ux`), so no two agents write the same file — and **returns only the compact index**:

```
<id> | <SEVERITY> | <category> | <file:line> | <one-line title>
```

Audit agents are `Explore` agents with no `Write` tool — they write their spool file with a quoted-heredoc `cat > "$SPOOL_DIR/<slug>.md" <<'EOF'` via Bash, so backticks and `$` in quoted evidence survive verbatim. **Only the first write uses `>`; every later one must use `>>`** — a second `cat >` truncates everything already written.

The bodies stay on disk until the filer agents move them to the tracker: everything Phase 2 decides — cross-agent dedup, dedup against `EXISTING_ISSUES`, and the `FILE_OWNER_MAP` — keys off the index fields alone, and pulling hundreds of bodies through this context is where tail findings get truncated.

**Context requirement.** Before flagging, read at least 30 lines of surrounding context to confirm the issue is real. Common false positives:
- A force unwrap that IS inside a `guard`/`precondition`-protected path where nil is truly impossible
- An `@ObservedObject` that IS correctly passed from a parent that owns the `@StateObject`
- A `try?` that IS intentionally ignoring the error because the operation is optional/best-effort
- A `#if os(iOS)` block that IS correctly omitting macOS because the feature genuinely doesn't apply to macOS
- A `Task {}` without explicit cancellation that IS inside a `.task` modifier (which auto-cancels)

If the surrounding context shows the code is correct, do NOT flag it. If uncertain, report it as **[UNCERTAIN]** with your reasoning; consolidation evaluates these separately. Fewer confident findings beat padding with questionable ones.

<approach>
For each potential finding:
1. Read the file and 30+ lines of surrounding context
2. Quote the specific code that demonstrates the issue
3. Explain why it's a problem given the context
4. Only then classify severity and suggest a fix
Skip step 4 if steps 1-3 reveal the code is correct.
</approach>

### Batch 1 (5 parallel Explore agents via Task tool):

**Model**: Resolve `AUDIT_MODEL_TIER` to this host's model per [lib/model-tiers.md](../../lib/model-tiers.md) and pass it as the `model` parameter on each agent (`heavy` → this host's strongest alias, `model: "opus"` on Claude Code).

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
   - **Gotcha catalogue:** check in-scope entries #1–#5 and #12 (CloudKit eager-init crash, SwiftData missing inverse relationship, SwiftData CloudKit sharing gap, iCloud ubiquity container, iCloud symlink corruption, Keychain test failures) against this codebase using the excerpts passed in; cite the entry number (`gotcha catalogue #N`) in any finding rather than restating the fix.

### Batch 2 (3 agents after Batch 1 completes):

**Model**: Same `AUDIT_MODEL_TIER` as Batch 1.

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
   - **Gotcha catalogue:** check in-scope entries #7–#9 (XcodeGen project generation, TestFlight upload validation, App Group provisioning) against this codebase using the excerpts passed in; cite the entry number in any finding rather than restating the fix.

   **iCloud & data persistence (when iCloud entitlements detected):**
   - **Gotcha catalogue:** check in-scope entries #4–#5 (iCloud ubiquity container silent failure, iCloud symlink content corruption) against this codebase using the excerpts passed in; cite the entry number in any finding.

   **Localization & String Catalogs (when `Localizable.xcstrings` or `String(localized:)` detected):**
   - **Gotcha catalogue:** check in-scope entry #6 (SwiftUI xcstrings localization silent failures — 8 sub-gotchas including `Text(someStringVariable)`, AGA inflection, stale `DateFormatter`) against this codebase using the excerpts passed in; cite the entry number in any finding.

   **In-App Purchases & StoreKit (when StoreKit imports detected):**
   - **Gotcha catalogue:** check in-scope entry #10 (iOS first-IAP submission rejection — missing Restore button, hardcoded fallback price, TestFlight IAP sandbox limitation) against this codebase using the excerpts passed in; cite the entry number in any finding.

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

> Keep the consolidated findings (steps 2–4 below) as your **in-run working plan in
> context** — the plan is never written to a file. The tracker is the source of truth
> for known work: the disposition partial below fetches open issues into
> `EXISTING_ISSUES` during setup (reuse `CLI_TOOL` from Phase 0a), and step 2 must
> **dedup against `EXISTING_ISSUES`** as well as across agents, reusing an existing
> issue's `#<number>` instead of filing a duplicate. Remediation (Phase 3+) proceeds
> from the in-context plan as normal; for any finding you **defer** (per the
> finding-disposition rules — LOW findings included), file a labeled tracker issue.
> Report created **and** reused issue numbers (`#<n>`) in the Phase 2 summary.
> Phase 1 spooled the finding **bodies** to `SPOOL_DIR` and returned only the
> **index**; consolidate and dedup against those index lines without opening a
> spool file. **Step 3 is the exception**: grouping the Foundation extractions
> needs the duplication counts and call-site lists that live only in the bodies,
> so read `$SPOOL_DIR/dry.md` for the ids step 2 kept in the `dry` category before
> writing the Foundation list Phase 3b builds from. When the surviving set is
> larger than ~20 findings, hand the ids off to per-category **filer agents** per
> the partial's "Bulk filing — spool the bodies, dedup on an index" section; at or
> below that, file them inline —
> still lifting each id's block verbatim out of its spool file into a `--body-file`,
> never retyping it from the index line.

Unless `TRACKER_AVAILABLE=false`, read the tracker setup and filing partials now:

!read lib/plan-issue-setup.md
!read lib/plan-issue-filing.md

1. Fetch `EXISTING_ISSUES` per those partials (skip when `TRACKER_AVAILABLE=false`).
2. Consolidate all findings from Phase 1, deduplicating across agents (same file:line flagged by multiple agents → keep the most specific description) and against `EXISTING_ISSUES` (a finding with an open issue reuses its `#<number>`)
3. Identify **shared utility extractions** — patterns duplicated 3+ times that should become reusable extensions, view modifiers, or utility types. Group these as "Foundation" work for Phase 3b.
4. **Build the file ownership map** (required by Phase 5 for conflict-free PRs):
   - For each finding, record which file(s) it touches
   - Assign each file to exactly ONE category (its primary category)
   - If a file is touched by multiple categories, assign it to the category with the highest-severity finding for that file
   - Record the mapping as `FILE_OWNER_MAP` — no two PRs may modify the same file
   - If a module extraction creates a new file (e.g., extracting `NetworkClient.swift` from a view model), add a backward-compatible re-export (typealias or import forwarding) in the original file so other PRs don't break
5. **Disposition.** CRITICAL/HIGH/MEDIUM code findings go to Phase 3 (tests to Phase 4c). LOW findings, unconfirmed follow-ups, and anything else not remediated this run are **deferred** (under `--scan-only`, the gate below files everything instead): file each as a labeled issue, deduped against `EXISTING_ISSUES`, per the partials above — or, when `TRACKER_AVAILABLE=false`, hold them for the Phase 7 "Deferred (not filed — no issue tracker available)" list.

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

**GATE: If `--scan-only` was passed, STOP HERE** — but first, **file every surviving finding as an issue first**, then print the summary and exit. (When `TRACKER_AVAILABLE=false`, list them under "Deferred (not filed — no issue tracker available)" instead.)

**Filing every surviving finding** means all of them, not just the ones the disposition rules would defer — a scan-only run remediates nothing, so the filed issues ARE the run's output. Apply the same labels, dedup-against-`EXISTING_ISSUES`, and title/body rules the disposition partial specifies, and report the created and reused `#<number>`s in the summary. Do not open a worktree or write any code. **Then remove `SPOOL_DIR`** (`rm -rf "$SPOOL_DIR"`, same errored-filer exception) — a scan-only run has no Phase 3c or 4c to read the bodies, so filing is the last read.

**Hand the filing to per-category filer agents when the surviving set exceeds ~20.**
Dispatch one filer agent per category **in parallel** (never shard a category —
dedup gave each finding exactly one, so filers cannot collide), giving each the
surviving ids for its category, the `$SPOOL_DIR/<category-slug>.md` file those bodies
live in, `CLI_TOOL`, `PLAN_LABEL`, the label rules, the `${URL##*/}` number-capture
form, and the secondary-rate-limit retry rule. Each returns only its
`<id> -> #<number>` map.

Merge the returned maps for the summary. **An id a filer returned as `ERROR` was not
filed** — report those separately with their spool path so they can be filed by hand,
and keep `SPOOL_DIR` on disk when any error occurred. At or below ~20 surviving
findings, skip the fan-out and file them inline — still `--body-file`ing each block
verbatim out of the spool, never retyped from the index line.

## Phase 3: Worktree Remediation

Only CRITICAL, HIGH, and MEDIUM findings are remediated; LOW findings are filed as issues, not auto-remediated. Test Quality & Coverage findings are handled in Phase 4c.

### 3a: Setup

1. If `IS_DIRTY` is true: `git stash --include-untracked -m "better-swift: pre-scan stash"`
2. Set `DATE` to today's date in YYYY-MM-DD format
3. Create the worktree:
   ```bash
   git worktree add ../better-swift-{DATE} -b better-swift/{DATE}
   ```
4. Set `WORKTREE_DIR` to `../better-swift-{DATE}`

### 3b: Foundation Utilities

Done by the team lead (you) directly — NOT delegated — because every subsequent agent depends on these files existing and compiling.

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

One worker per category that has CRITICAL, HIGH, or MEDIUM findings (only act on categories with actionable findings):
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
3. Spawn up to 5 general-purpose agents as teammates. **Resolve `REMEDIATION_MODEL_TIER` to this host's model per [lib/model-tiers.md](../../lib/model-tiers.md) and pass it as the `model` parameter on each agent.** If `REMEDIATION_MODEL_TIER` is `heavy`, pass this host's strongest alias (`model: "opus"` on Claude Code). Each teammate marks its task complete via `TaskUpdate` when done.
<!-- else -->
1. Spawn up to 5 general-purpose `Agent` sub-agents — one per category above that has actionable findings. **Resolve `REMEDIATION_MODEL_TIER` to this host's model per [lib/model-tiers.md](../../lib/model-tiers.md) and pass it as the `model` parameter on each `Agent` call.** If `REMEDIATION_MODEL_TIER` is `heavy`, pass this host's strongest alias (`model: "opus"` on Claude Code).
2. Launch all `Agent` calls **in parallel** (multiple tool calls in a single response) and wait for all to return. Each sub-agent returns its results directly — no task board or shutdown step is needed.
<!-- /if:teams -->

**The finding bodies are on disk, not in this context.** Phase 1 returned
only index lines, so a `{FINDINGS}` block built from those alone hands the worker a
one-line title with no evidence and no suggested fix. Build `{FINDINGS}` from each
worker's index lines **plus the literal `SPOOL_DIR` path**, and instruct the worker to
read the full body for each of its ids out of `$SPOOL_DIR/<slug>.md`, where `<slug>` is
the category on **that id's own index line** — **Conflict avoidance** below merges two
categories into one worker when they touch the same file, so such a worker
must open every spool file its ids name, not just the one matching its own category.
Read the bodies before fixing; never remediate from titles.

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

GOTCHA CATALOGUE:
For findings citing a gotcha catalogue entry number (#N, one of {GOTCHA_ENTRIES_IN_SCOPE} — see `~/.claude/lib/swift-gotchas.md`'s Quick index for what each covers), read that entry and apply its FIX section as written. Do not paraphrase — these are load-bearing patterns where minor variations regress the bug.
```

### Conflict avoidance:
- Review all findings before task assignment. If two categories touch the same file, assign both sets of findings to the same agent.
- Security agent gets priority on Keychain/data protection; Platform agent gets priority on #if os(...) blocks; UX agent gets priority on design-token/theme files and shared component files.

</plan_and_remediate>

<verification_and_pr>

## Shared Pipeline Inputs

Phases 4, 4b, 5, 5d, 6, and 7 are the **shared `better-*` pipeline** this command runs verbatim with `/do:better` via `lib/better-*.md`; everything Swift-specific arrives through the inputs below. Substitution rules (empty values drop their line; indented values keep their indent) are in `~/.claude/lib/better-verification.md`. Resolve these before Phase 4:

- `{BRANCH_PREFIX}` = `better-swift` (staging branch `better-swift/{DATE}`, category branches `better-swift/{CATEGORY_SLUG}`)
- `{PIPELINE_LABEL}` = `better-swift audit`
- `{PIPELINE_TITLE}` = `Better Swift Audit`
- `{VERIFY_SCOPE_SUFFIX}` = ` on ALL supported platforms`
- `{VERIFY_SCOPE_NOTE}` = This must succeed for every platform in `PLATFORMS`. A fix that works on iOS but breaks macOS is not acceptable.
- `{VERIFY_FAILURE_SCOPE}` = ` on any platform`
- `{VERIFY_FAILURE_COMMIT_SLOT}` = `{platform} ` — the failing platform is a required field in the commit subject, not an afterthought
- `{VERIFY_STATUS_CLAUSE}` = `All {PLATFORMS} platforms build and test successfully. `
- `{REVIEW_CHECKLIST}` = `Swift Code Review Checklist` (the section below)
- `{VERSION_BUMP_SECTION}` = `Version Bump Procedure` (the section below)
- `{SIMPLIFY_ONLY}` = `false` — this command has no refactor-only mode, so every clause in the shared partials gated on it is inert
- `{COMPAT_SHIM}` = `typealias`, `{COMPAT_HOST}` = `file`
- `{MULTI_CATEGORY_FILE_EXAMPLE}` = ``ContentView.swift`` with both platform and architecture changes
- `{CATEGORY_SLUGS}` = `security`, `code-quality`, `dry`, `architecture`, `bugs-perf`, `platform-swiftui`, `tests`, `ux`
- `{CATEGORY_SLUG_RULE}` = *(empty — every slug above is always available)*
- `{COMMIT_PREFIX_RULE}` = *(empty — this command has no mode that changes the prefix)*
- `{PR_BODY_SUMMARY_EXTRA}` = `Platforms verified: {PLATFORMS}`
- `{PR_BODY_EXTRA_SECTIONS}` = one extra section, at column 0 like the sections around it, and ending with a blank line:

      ### Platform Impact
      {which platforms are affected by these changes, any platform-specific notes}

- `{CI_FAILURE_CAUSES_EXTRA}` = two bullets, indented to match the ones above them:

      - **Platform build failure**: a change compiles on iOS but not macOS (or vice versa). Add `#if os(...)` guard.
      - **Code signing**: ignore code signing failures in CI if not configured — these are environment-specific.

- `{REVIEW_LOOP_EXTRA_INSTRUCTION}` = **Additional Swift-specific instruction for review loop agents:** After each fix, verify the code compiles on ALL platforms: `{BUILD_CMD}`. If a reviewer's suggestion would break another platform, add a platform-conditional implementation instead.
- `{REVIEW_STATUS_EXTRA}` = `\n\nAll PRs verified on: {PLATFORMS}`
- `{SUMMARY_TABLE_ROWS}` / `{SUMMARY_TABLE_ROW_RULES}` / `{SUMMARY_TABLE_FOOTER}` = see the **Final Summary Table** section below

### Swift Code Review Checklist

The checklist Phase 4b reviews the remediation diff against:

```
!`cat ~/.claude/lib/swift-review-checklist.md`
```

### Version Bump Procedure

The Swift-specific half of Phase 5b — run on `better-swift/{FIRST_CATEGORY}` once the aggregate SemVer `{LEVEL}` has been determined:

**SPM package (no Xcode project):** if the project uses a `VERSION` file or
documents its version in README, update it.

**Xcode project:**
```bash
# Bump CFBundleShortVersionString (marketing version)
agvtool new-marketing-version {NEW_VERSION}
# Bump CFBundleVersion (build number)
agvtool next-version -all
git diff --name-only -z -- '*.plist' '*.pbxproj' | xargs -0 git add  # stage only files agvtool modified
```

### Final Summary Table

The rows Phase 7 prints (`{SUMMARY_TABLE_ROWS}`), at column 0 in the printed block:

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

Every row above is always printed, so `{SUMMARY_TABLE_ROW_RULES}` is empty. The lines printed under the table (`{SUMMARY_TABLE_FOOTER}`), at column 0 in that same block, are:

      Platforms verified: {PLATFORMS}
      Deployment targets: {DEPLOYMENT_TARGETS}

---

!read lib/better-verification.md

## Phase 4c: Test Enhancement

After internal code review passes, act on Agent 7's findings AND ensure all Phase 3 remediation has test coverage.

### 4c.0: Record Start SHA

Capture the current HEAD so Phase 4c changes can be diffed later:
```bash
cd {WORKTREE_DIR}
PHASE_4C_START_SHA="$(git rev-parse HEAD)"
```

### 4c.1: Test Audit Triage

**Agent 7's findings are on disk, not in this context.** The index
(`<id> | <SEVERITY> | <category> | <file:line> | <title>`) carries no `[VACUOUS]`/`[WEAK]`/`[MISSING]` tag at all, so triage cannot run off it. Read `$SPOOL_DIR/tests.md` (the literal path from run state) and triage off each finding's full body; populate `{VACUOUS_AND_WEAK_FINDINGS}` / `{MISSING_FINDINGS}` from those bodies, never from the index titles.

Categorize Agent 7's findings:

1. **`[VACUOUS]` findings** — tests that exist but don't test real behavior. These are the highest priority because they create a false sense of safety.
2. **`[WEAK]` findings** — tests that partially cover behavior but miss important cases. Strengthen with additional assertions and edge cases.
3. **`[MISSING]` findings** — no tests exist for critical paths. Write new test files or add test cases to existing files.

Additionally, scan all remediation changes from Phase 3:
- For each file modified by remediation agents, check if corresponding tests exist
- If tests exist, verify they cover the specific behavior that was fixed/changed
- If no tests exist for a remediated module, flag for new test creation

### 4c.2: Test Enhancement Execution

Spawn a general-purpose agent (using `REMEDIATION_MODEL_TIER`) in the worktree. Populate `{VACUOUS_AND_WEAK_FINDINGS}` from `[VACUOUS]`/`[WEAK]` findings, `{MISSING_FINDINGS}` from `[MISSING]` findings, and `{REMEDIATED_FILES_WITHOUT_TESTS}` from the remediation-change scan. The agent instructions:

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

!read lib/better-pr-and-ci.md

!read lib/better-review-loop.md

</verification_and_pr>

!read lib/better-cleanup.md

## Error Recovery

- **Agent failure**: continue with remaining agents, note gaps in the summary
- **Build failure in worktree**: attempt fix in a new commit; if unfixable, revert problematic commits and ask the user
- **Platform-specific build failure**: add `#if os(...)` guards; if the fix only works on one platform, wrap in availability check
- **Push failure**: `git pull --rebase --autostash` then retry push
- **CI failure on PR**: investigate logs, fix in a new commit, push, re-check (max 3 attempts per PR)
- **Cross-PR dependency breakage**: add backward-compatible typealiases or move shared files to the PR that creates them
- **Reviewer timeout / error / guardrail** (copilot review not received in the timeout window, a local CLI errored, or a copilot pass hit its 10-iteration limit): the per-PR sub-agent surfaces it as an `inconclusive` aggregate. **Default mode**: leave that PR open. **Interactive mode**: ask whether to merge without a clean review, re-run, or skip
- **Missing reviewer CLI** (`--review-with codex`/`agy`/`claude`/`grok`/`pi`/`cursor`/`opencode` but the binary isn't installed — `cmd[<invocation>]` has no fixed binary to probe, so a command-not-found surfaces as `skipped` at dispatch instead, and any other launch failure as `cli-error`): the multi-reviewer loop records that pass as `skipped` (→ inconclusive aggregate). It does NOT silently fall back to copilot
- **Existing worktree found at startup**: ask user — resume (reuse worktree) or cleanup (remove and start fresh)
- **No findings above LOW**: skip Phases 3-7, print "No actionable findings" with the LOW summary
- **Merge conflict after prior PR merged**: rebase the branch onto the updated default branch, push with `--force-with-lease`, re-run CI
- **Code signing errors in CI**: ignore unless the project has CI code signing configured — flag to user as informational

!`cat ~/.claude/lib/graphql-escaping.md`

## Notes

- **Every build and test verification runs on ALL supported platforms** — a fix that works on iOS but breaks macOS is not acceptable
- **One PR per category**, each file in exactly ONE PR (file ownership map), with backward-compatible typealiases when types are extracted
- Agent 6 (Platform Coverage & SwiftUI Patterns) is the differentiator from the generic `do:better`; Agent 8 (UX) always runs (no `HAS_UI` gate) and bumps first-frame findings one severity tier
- **No default reviewer**: without `--review-with`, Phase 6 and the auto-merge are skipped and all PRs are left open. `copilot` is never added implicitly
- GitLab projects skip the Phase 6 review loop + auto-merge entirely and stop after MR creation
- CI must pass on each PR before its review loop runs or it is merged
