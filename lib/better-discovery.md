## Phase 0: Discovery & Setup

When dispatching agents, resolve model tiers using:

!read lib/model-tiers.md

Detect the project environment before any scanning or remediation.

### 0a: VCS Host Detection
Resolve the host here, before any phase reaches for a forge CLI:

!read lib/vcs-host.md

- On GitHub, carry the `GH_HOST` seed in state; Phase 6 finishes deriving it for the reviewer loops' `gh api` calls.
- **Record `TRACKER_AVAILABLE` once.** `true` when `TRACKER_CLI` is set and reaches this repo's enabled issues; otherwise `false`, and deferred findings follow the setup partial's "No tracker" rule (Phase 7 report).

### 0b: Project Type Detection
Record the primary manifest's ecosystem as `PROJECT_TYPE`, and `HAS_UI=true`/`false` (whether the project ships web, desktop, mobile, or server-rendered UI; it gates the `ux` scope).

Record version ownership for Phase 5b: `HAS_VERSION_BUMP=true` with `VERSION_BUMP_CMD` = the ecosystem only when its own version source declares a version (the manifest for `npm`/`cargo`/`python`/`java`/`dotnet`; for `ruby`, a `VERSION` constant in `lib/**/version.rb`, else the gemspec's `version =`). Otherwise — Go (versions by VCS tag), no discoverable version, or no manifest — record `HAS_VERSION_BUMP=false`; never invent a version convention.

### 0c: Build & Test Command Detection
Record `BUILD_CMD` and `TEST_CMD`, preferring commands the project documents (manifest scripts, CI config, README/CONTRIBUTING.md) over ecosystem conventions.

### 0d: State Snapshot
- Record `REPO_DIR` via `git rev-parse --show-toplevel` and `CURRENT_BRANCH` via `git rev-parse --abbrev-ref HEAD`
- Record `DEFAULT_BRANCH` via `gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name'` (or `glab` equivalent)
- Record `IS_DIRTY` via `git status --porcelain`
- Record `CHANGELOG_TARGET` (empty when none) and `HAS_CHANGELOG` from the project's stated changelog convention (CLAUDE.md/AGENTS.md/CONTRIBUTING.md), else its existing changelog artifacts
- Set `DATE` to today (`YYYY-MM-DD`) and check `git worktree list` for existing run paths. Resume only a proven matching task; otherwise select a unique run path and branch. Do not remove unrelated worktrees. Record any suffix in `DATE` so all later paths agree.

Under `SIMPLIFY_ONLY=true`, also collect the simplify contract's Phase 0e inputs.
