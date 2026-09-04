## Phase 0: Discovery & Setup

When dispatching agents, resolve model tiers using:

!read lib/model-tiers.md

Detect the project environment before any scanning or remediation.

### 0a: VCS Host Detection
**The `origin` remote selects the host; credentials are checked second.** Probing `gh auth status` first picks GitHub on any machine logged in to both services — even in a GitLab checkout — and routes default-branch lookup, issue filing, and PR/MR operations to the wrong forge. Follow the shared selection instead:

!read lib/vcs-host.md

- It sets `VCS_HOST` (`github`/`gitlab`) and `CLI_TOOL` (`gh`/`glab`) from the remote, then confirms that CLI can read this repo
- An unsupported or ambiguous remote, or credentials for only the *other* service, halts the run with an actionable message before anything is created. Never fall back to whichever CLI happens to be authenticated, and never infer GitLab from a `gh` auth failure
- **When `VCS_HOST=github`, also derive `GH_HOST` from the `origin` remote** and carry it in state, following the shared derivation (and its per-host auth precheck) included below. The Phase 6 GitHub-side reviewer loops use `gh api`, which ignores the repo remote and defaults to github.com — so on a GitHub Enterprise repo `GH_HOST` must be forwarded to them or they poll the wrong host and time out.

**GitHub only — skip the snippet below entirely on GitLab**, whose `glab` calls resolve the host from the remote themselves and where its `gh auth` precheck would abort the run.

!read lib/gh-host.md

### 0b: Project Type Detection
Check for project manifests to determine the tech stack:
- `package.json` → Node.js (check for `next`, `react`, `vue`, `express`, etc.)
- `Cargo.toml` → Rust
- `pyproject.toml` / `requirements.txt` → Python
- `go.mod` → Go
- `pom.xml` / `build.gradle` → Java/Kotlin
- `Gemfile` → Ruby
- `*.csproj` / `*.sln` → .NET

Record the detected stack as `PROJECT_TYPE` for agent context.

Additionally, detect whether the project ships a user-facing UI:
- Web frontend dependencies (`react`, `vue`, `svelte`, `next`, `nuxt`, `astro`, `angular`, `solid-js`) or UI source files (`*.html`, `*.css`/`*.scss`, JSX/TSX, `*.vue`, `*.svelte`)
- Desktop shells (Electron, Tauri) or mobile UI code (React Native, Flutter)
- Server-rendered templates (ERB, Jinja, Blade, Razor, Go templates) that emit HTML

Record `HAS_UI=true`/`false` — this gates the UX Consistency & Responsive Layout audit agent (Phase 1, agent 9) and its `ux` category downstream.

### 0c: Build & Test Command Detection
Derive build and test commands from the project type:
- Node.js: check `package.json` scripts for `build`, `test`, `typecheck`, `lint`
- Rust: `cargo build`, `cargo test`
- Python: `pytest`, `python -m pytest`
- Go: `go build ./...`, `go test ./...`
- If ambiguous, check project conventions already in context for documented commands

Record as `BUILD_CMD` and `TEST_CMD`.

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
