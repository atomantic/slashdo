## Phase 0: Discovery & Setup

When dispatching agents, resolve model tiers using:

!read lib/model-tiers.md

Detect the project environment before any scanning or remediation.

### 0a: VCS Host Detection
Resolve `VCS_HOST` and `CLI_TOOL` here, before any phase reaches for a forge CLI:

!read lib/vcs-host.md

- **When `VCS_HOST=github`, also derive `GH_HOST` from the `origin` remote** and carry it in state, following the shared derivation (and its per-host auth precheck) included below. The Phase 6 GitHub-side reviewer loops use `gh api`, which ignores the repo remote and defaults to github.com — so on a GitHub Enterprise repo `GH_HOST` must be forwarded to them or they poll the wrong host and time out.

**GitHub only — skip the snippet below entirely on GitLab**, whose `glab` calls resolve the host from the remote themselves and where its `gh auth` precheck would abort the run.

!read lib/gh-host.md

### 0b: Project Type Detection
Detect the project's primary manifest and record its ecosystem as
`PROJECT_TYPE`.

From that same manifest, resolve **version ownership** for Phase 5b's version
bump (`lib/better-pr-and-ci.md`): if the manifest declares a version field,
record `HAS_VERSION_BUMP=true` and `VERSION_BUMP_CMD` as the ecosystem
(`npm`/`cargo`/`python`/`java`/`ruby`/`dotnet`). Record `HAS_VERSION_BUMP=false`
for Go (which versions by VCS tag, not an in-repo file), for any manifest with
no discoverable version field, or when no manifest exists — a project with no
version convention of its own must not be handed an invented one. Phase 5b
skips its version-bump step entirely when `HAS_VERSION_BUMP=false`, and
otherwise dispatches on `VERSION_BUMP_CMD` through the calling command's
`Version Bump Procedure` section.

Also record `HAS_UI=true`/`false` — whether the project ships a user-facing UI
(web, desktop, or mobile frontend code, or server-rendered HTML templates).
This gates the `ux` audit scope (Phase 1) and its category downstream.

### 0c: Build & Test Command Detection
Prefer commands the project already documents (manifest scripts, CI config,
README/CONTRIBUTING.md); fall back to the ecosystem's conventional build/test
invocation only when none are documented. Record as `BUILD_CMD` and
`TEST_CMD`.

### 0d: State Snapshot
- Record `REPO_DIR` via `git rev-parse --show-toplevel`
- Record `CURRENT_BRANCH` via `git rev-parse --abbrev-ref HEAD`
- Record `DEFAULT_BRANCH` via `gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name'` (or `glab` equivalent)
- Record `IS_DIRTY` via `git status --porcelain`
- Resolve how this project logs changes (stated convention in CLAUDE.md/AGENT.md/CONTRIBUTING.md first, else whatever changelog artifacts already exist — a rolling `CHANGELOG.md`, a per-release directory, a fragment tool, or nothing because the notes come from commit messages). Record the target as `CHANGELOG_TARGET` (empty when there is none) and `HAS_CHANGELOG` accordingly
- Check `git worktree list` for existing run paths. Resume only a proven matching task; otherwise select a unique run path and branch. Do not remove unrelated worktrees. Record any suffix in `DATE` so all later paths agree.

### 0e: Simplify-Only Inputs _(only when `SIMPLIFY_ONLY=true`)_

Three cheap reads: two gate inputs plus the project's vocabulary. Skip this step entirely in a normal run.

1. **`HOT_FILES`** (gate 3) — the files worth refactoring, because they're the ones people edit:
   ```bash
   git -C {REPO_DIR} log --since="6 months ago" --format= --name-only \
     | grep -Fxf <(git -C {REPO_DIR} ls-files) \
     | sort | uniq -c | sort -rn | head -40
   ```
   The `ls-files` filter drops paths that no longer exist, so deleted files can't crowd out live ones. Record the paths with their commit counts. If the repo is younger than the window or the list comes back near-empty, re-run **the same pipeline** with `--since` dropped rather than treating every file as cold — a young repo has no dormant code to deprioritize. Never run a bare `git log --name-only` without the `sort | uniq -c | head` aggregation: on a mid-size repo that is tens of thousands of lines straight into context.
2. **`PRIOR_REJECTIONS`** (gate 4) — reframings earlier runs tried and rejected, as a do-not-re-propose list for the audit agents. Default: the `### Rejected reframings` subsections of PLAN.md. Under `--issues`: issues carrying **both** `{PLAN_LABEL}` and `rejected-reframing`, which is what makes this a bounded read rather than a scan of every closed plan issue —
   ```bash
   {CLI_TOOL} issue list --state closed --label "{PLAN_LABEL}" --label rejected-reframing \
     --limit 200 --json number,title,body
   ```
3. **`DOMAIN_DOCS`** — whichever of `CONTEXT.md`, `GOALS.md`, `docs/adr/`, and `docs/decisions/` exist (read the index or the most recent handful of ADRs, not the whole directory). **Distill them here, once**, into a short glossary of domain terms plus a list of reframings the ADRs already ruled out, and pass *that* to the audit agents — not the documents. Fanning 20–50 KB of docs out to five agents buys nothing the glossary doesn't. Its purpose is that proposed modules, seams, and names use the project's own vocabulary instead of invented ones.
