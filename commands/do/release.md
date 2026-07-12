---
description: Create a release PR using the project's documented release workflow
argument-hint: "[--interactive] [--review-with <agent>[,<agent>...]] [--review-iterations <n>] [--review-mode <series|parallel>] [--review-stop-on-findings|--review-stop-on-clean] [--reviewer-applies]"
---

**Default mode: fully autonomous.** Auto-detects branches, determines version bump from commits, runs review, creates and merges the release PR without prompting.

**`--interactive` mode:** Pauses for branch confirmation, version approval, and merge confirmation.

## Parse Arguments

Parse `$ARGUMENTS` for `--review-with <agent[,agent,...]>`:
- Accepted values per slot: `copilot`, `codex`, `agy` (aliases `gemini` / `antigravity` — all run the Antigravity CLI's `agy` binary), `claude`, `grok`, `ollama`, or an arbitrary GitHub login `@<login>`
- `ollama` reviews with a local Ollama model. Bare `ollama` auto-selects the most capable installed coding model; pin a specific installed model with the bracket form `ollama[<model>]`, e.g. `ollama[qwen2.5-coder:32b]`. Strip the bracket suffix into a per-entry `OLLAMA_MODEL` (empty for bare `ollama`) and keep the base slug `ollama`.
- `codex`, `claude`, `agy`, and `grok` likewise accept a `<agent>[<model>]` bracket to pin the reviewing model — e.g. `codex[o3]`, `claude[claude-opus-4-8]`, `agy[Gemini 3.5 Flash (High)]`, `grok[grok-code-fast-1]`. Strip the bracket into a per-entry `REVIEW_MODEL` (empty → the reviewer's built-in default) and keep the base slug. The bracket value is free-form (validate shape, not an allowlist); `copilot` and `@<login>` take no model bracket. A saved `review-models` default (see `/do:config`) supplies the model when a token omits the bracket — the bracket wins. See `lib/multi-reviewer-loop.md`.
- `@<login>` requests a review from an **arbitrary GitHub reviewer** — any user or App/bot login (e.g. `@octocat`, `@org-review-bot`, `@some-app[bot]`). slashdo requests their review on the PR and waits for it, fixing what it surfaces (same flow as `copilot`). Strip the leading `@` into a per-entry `REVIEWER_LOGIN`; the login must match `^[A-Za-z0-9][A-Za-z0-9-]*(\[bot\])?$`. GitHub only; never posts an approval itself.
- **Optional (non-blocking) suffix `~opt`:** any slot may end in `~opt` — e.g. `ollama~opt`, `ollama[qwen2.5-coder:32b]~opt`, `@some-bot~opt`, `copilot~opt` — to mark that reviewer **optional**: it is still requested, still runs, and its findings are still fixed, but an *inconclusive* result from it (timeout / skipped / incomplete / no-verdict) is **excluded from the merge gate** and never blocks the release merge. A hard-error from it (broken build / failed tests / rejected) still blocks — optionality never lets a broken tree merge. Strip the `~opt` suffix into a per-entry `{OPTIONAL}` flag **before** the slug/`[model]`/`@login` parsing; it is **not** part of the dedup identity (`ollama~opt` and `ollama` are the same reviewer, optional-wins on collapse). `~opt` is shell-metacharacter-free by design. Full mechanics in `lib/multi-reviewer-loop.md`.
- **Reserved value `none`:** the token `none` (case-insensitive) is not a reviewer slug. `--review-with none` means *no external reviewer this run* — set `REVIEW_AGENTS=[]`, skip the slug validation below, and skip applying any saved `review-with` default. This is the explicit escape hatch over a default saved via `/do:config`.
- The value may be a single agent or a **comma-separated, ordered list** (e.g. `--review-with codex,agy,copilot`). Split on `,`, trim whitespace around each slug. Normalize `gemini`/`antigravity` → `agy`.
- Record the resulting list as `REVIEW_AGENTS`. **There is no built-in default reviewer.** If `--review-with` is omitted, leave `REVIEW_AGENTS` **unset for now** — the saved-defaults step below fills it from `/do:config` if a default exists, and **only if it is still unset after that** does the built-in default apply (`REVIEW_AGENTS=[]` — no external review pass; the Local Code Review gate below still runs unconditionally). Whatever ends up in the list is exactly what runs, in order: `--review-with codex` runs codex only; copilot is never added implicitly.
- Dedupe preserving first-occurrence order (compare on the normalized slug — for a model-taking agent (`codex`/`claude`/`agy`/`grok`/`ollama`) the `[<model>]` bracket suffix is part of the identity, so `codex[a]` and `codex[b]` are distinct while two bare `ollama`s collapse; for `@<login>` the login is the identity, compared lowercased; the `~opt` marker is **not** part of the identity, so `ollama~opt` collapses with `ollama` — the survivor is optional if any collapsed occurrence had `~opt`); if duplicates were dropped, print: `Note: deduped --review-with list to {final list}.`
- If any value is not in the accepted set, abort with a usage error: `Unknown --review-with value: {value}. Use one of: copilot, codex, agy, claude, grok, ollama, @<login> (each optionally suffixed ~opt).`

Parse `$ARGUMENTS` for the stop-mode flags (mutually exclusive):
- `--review-stop-on-findings` — stop the multi-reviewer loop after the first reviewer that fixed at least one finding.
- `--review-stop-on-clean` — stop after the first reviewer that reports a clean pass with zero findings.
- If neither is present, set `REVIEW_STOP_MODE=all` (default — always run every listed reviewer in order). For release PRs the default is appropriate: each reviewer's perspective adds to the merge-gate confidence.
- If both are present, abort with: `--review-stop-on-findings and --review-stop-on-clean cannot be combined`.

Parse `$ARGUMENTS` for `--review-mode <series|parallel>` (how the multi-reviewer loop dispatches its reviewers):
- `series` (default) — reviewers run one-at-a-time in list order, each reviewing against the prior reviewer's committed fixes. Recommended for release PRs, where each perspective should build on the last.
- `parallel` — reviewers' reviews run concurrently against one frozen baseline, then the orchestrator applies the deduped union of findings once (faster, but no reviewer sees another's fixes; `--reviewer-applies` and the stop-modes are ignored).
- If `--review-mode` is omitted, leave `REVIEW_MODE` **unset for now** — the saved-defaults step fills it from the `review-mode` default; the built-in default is `series`.
- If the value is anything other than `series` or `parallel`, abort with: `--review-mode must be one of series, parallel (got: {value}).`

Parse `$ARGUMENTS` for `--reviewer-applies` (boolean, no value):
- Record as `REVIEWER_APPLIES=true` if present, otherwise `REVIEWER_APPLIES=false` (default).
- This flag picks who applies fixes the reviewer surfaces: by default the orchestrating thread (this session) reads the reviewer's findings and applies fixes itself; with `--reviewer-applies` the reviewing CLI applies fixes in the working tree directly. See `lib/local-agent-review-loop.md` "Editing mode" for the rationale and trade-offs.
- The flag is **not supported on the GitHub-side review paths** (`copilot` and `@<login>`) because those reviews are read-only by design (cloud-side comments, no working-tree access). If `REVIEW_AGENTS` contains `copilot` or an `@<login>` entry and `REVIEWER_APPLIES=true`, print a warning (`--reviewer-applies has no effect on the copilot/@<login> passes; fixes there are always applied by the orchestrator's sub-agent`) and continue — the flag still takes effect on the local passes in the list.
- The flag is **also a no-op on the ollama path** because Ollama is non-agentic (`ollama run` returns text and cannot edit files), so the orchestrator always applies the fixes. If `REVIEW_AGENTS` contains an `ollama` entry and `REVIEWER_APPLIES=true`, print a warning (`--reviewer-applies has no effect on the ollama pass; Ollama is non-agentic, so the orchestrator always applies the fixes`) and continue — the flag still takes effect on the codex/agy/claude/grok passes in the list.

Parse `$ARGUMENTS` for `--review-iterations <n>` (affects the GitHub-side passes — `copilot` and `@<login>` — only):
- Record as `REVIEW_ITERATIONS`. If `--review-iterations` is omitted, default to `1` — a single review-and-fix pass per GitHub-side reviewer (request one review, fix everything it surfaces, stop).
- Must be a non-negative integer. Any positive `n` runs at most `n` review-and-fix cycles per GitHub-side reviewer, still exiting early if a review returns 0 comments. `0` means "loop until that reviewer returns 0 comments" (the legacy behavior, bounded by each loop's own 10-iteration safety guardrail).
- If the value is missing or not a non-negative integer, abort with: `--review-iterations must be a non-negative integer (got: {value}).`
- This flag has no effect on local-agent reviewers (`codex`/`gemini`/`claude`) or `ollama`; they keep their own fixed iteration caps. The default `capped` verdict (cap reached after applying fixes) counts as clean-equivalent for the merge gate — see the merge section below.

Then apply any **saved defaults** (set via `/do:config`) to the flags above that the user did NOT pass on this invocation — an explicit flag, or `--review-with none`, always overrides a saved default:

!`cat ~/.claude/lib/review-config-defaults.md`

## Detect Release Workflow

Before doing anything, determine the project's source and target branches for releases. Do NOT hardcode branch names. Instead, discover them:

1. **Source branch** — run `gh repo view --json defaultBranchRef -q '.defaultBranchRef.name'` to get the repo's default branch (typically `main`). While here, **derive the GitHub API host `{GH_HOST}` from the `origin` remote** and forward it to the review loop below — `gh api` (used by the GitHub-side reviewer loops) defaults to github.com and does **not** read the repo remote, so on a GitHub Enterprise repo those loops would silently poll the wrong host and time out. Derive it and run the per-host auth precheck per `~/.claude/lib/gh-host.md`: `GH_HOST="$(git remote get-url origin 2>/dev/null | sed -E 's#^[a-z]+://##; s#^[^@/]+@##; s#[:/].*$##')"; [ -n "$GH_HOST" ] || GH_HOST=github.com` — and if `gh auth token --hostname "$GH_HOST"` fails, stop and tell the user to run `gh auth login --hostname $GH_HOST` rather than proceeding into a loop that will time out.
2. **Target branch** — determine by reading (in priority order):
   - **GitHub Actions workflows** — check `.github/workflows/release.yml` (or similar) for `on: push: branches:` to find the branch that triggers the release pipeline
   - **Project conventions** (already in context) — look for git workflow sections, branch descriptions, or release instructions
   - **Versioning docs** — check `docs/VERSIONING.md`, `CONTRIBUTING.md`, or `RELEASING.md`
   - **Branch convention** — if a `release` branch exists, the target is `release`; otherwise create it from the last release tag (see step 3 below). In `--interactive` mode, ask the user to confirm
3. **Ensure the target branch exists** — if not, create it from the last release tag (or root commit if no tags exist yet — net-new project). The snippet must consult the remote (not just local refs) before deciding to create, because on a fresh clone the remote-tracking ref for `{target}` may not have been fetched yet — creating a new `{target}` branch from the last tag in that case would lose history and the subsequent `git push` would either fail (non-fast-forward) or, worse, succeed and clobber the real release branch. Fetch the target ref first, then probe both the local heads and the freshly-updated remote-tracking refs via `git ls-remote --heads origin {target}`:
   ```bash
   git fetch origin "{target}:refs/remotes/origin/{target}" 2>/dev/null || true
   if ! git show-ref --verify --quiet refs/heads/{target} \
       && ! git show-ref --verify --quiet refs/remotes/origin/{target} \
       && [ -z "$(git ls-remote --heads origin {target})" ]; then
     git branch {target} $(git describe --tags --abbrev=0 2>/dev/null || git rev-list --max-parents=0 HEAD)
     git push -u origin {target}
   fi
   ```
   This ensures the PR diff shows ALL changes since the last release, not just the version bump.

Print the detected workflow: `Detected release flow: {source} → {target}`

**Default mode**: If ambiguous, use the most likely branch (prefer `release` if it exists). If the target branch does not exist, create it from the last release tag (see step 3 above). If detection still yields `target == source`, abort with an error — a release PR cannot merge a branch into itself. **Interactive mode (`--interactive`)**: Ask the user to confirm before proceeding.

**Important**: The PR direction is `{source}` → `{target}` (e.g., `main` → `release`). This gives any reviewer (and the human approver) the full diff of all changes since the last release. Do NOT create a branch from source and PR back into it — that only shows the version bump commit.

## Pre-Release Checks

1. **Ensure you're on the source branch** — checkout if needed
2. **Pull latest source** — `git pull --rebase --autostash`
3. **Pull latest target** — `git fetch origin {target} && (git show-ref --verify --quiet refs/heads/{target} && git checkout {target} || git checkout -b {target} --track origin/{target}) && git pull --rebase --autostash origin {target} && git checkout {source}` — this ensures the local target branch matches `origin/{target}` before any diff or PR creation, even on a fresh clone where the target branch may only exist on the remote. Without this, the diff may be stale or include already-released changes.
4. **Run tests** — execute the project's test suite (per project conventions already in context, or check package.json)
5. **Run build** — execute the project's build command if one exists

## Determine Version and Finalize Changelog

1. **Determine version bump** from commits since the last git tag:
   - Scan commit messages for conventional commit prefixes (also check each commit's body/footer for `BREAKING CHANGE:` — a recognized way to signal a breaking change without the prefix):
     - `breaking:`, any prefix with a `!` (e.g. `feat!:`, `fix!:`, `refactor!:`), or a `BREAKING CHANGE:` footer → **major** bump
     - `feat:` → **minor** bump
     - `fix:`, `build:`, `chore:`, `docs:`, `refactor:`, `perf:`, `style:`, `test:`, `ci:` → **patch** bump
   - Use the **highest applicable level** across all commits
   - **Default mode**: Use the determined version automatically. **Interactive mode (`--interactive`)**: Present the proposed version to the user for confirmation

2. **Bump version**: Use the project's native version-bump command. For Node projects: `npm version <major|minor|patch> --no-git-tag-version` (updates `package.json` and `package-lock.json`). For other ecosystems, detect from the project files in the working directory and use the equivalent. **Rust** has no stock version-bump command — probe in order: `cargo release version <level>` if `cargo-release` is installed (`command -v cargo-release`), else `cargo set-version <level>` if `cargo-edit` is installed (`command -v cargo-set-version`), else fall back to a direct edit of the `version = "x.y.z"` line in `Cargo.toml` followed by `cargo update -p <package>` to refresh `Cargo.lock`. **Python**: `poetry version <level>` (Poetry projects), else direct edit of `pyproject.toml` `[project] version = "..."`. **Elixir**: edit `mix.exs`. **Go**: edit a `VERSION` file. The commit step below stages whichever files the bump command modified — not a hardcoded list.

3. **Finalize changelog**:
   - Check for a changelog directory: `.changelogs/` or `.changelog/` (use whichever exists)
   - If `{changelog_dir}/NEXT.md` exists:
     - Rename it to `{changelog_dir}/v{new_version}.md`
     - Replace the `# Unreleased Changes` header with `# Release v{new_version}`
     - Add `Released: YYYY-MM-DD` with today's date
     - **Lead with a human-readable, feature-grouped `## Highlights` summary** (insert it directly under the header/date, *above* the detailed `Added`/`Changed`/`Fixed` sections). Release notes are read by humans deciding whether to upgrade — they should tell the story of the release **by feature**, not dump a flat list of every file change and issue number. Synthesize the detailed entries into **5–15 plain-language bullets grouped by theme/feature area** (e.g. "Editorial pipeline", "Local LLM", "Infra & deps"). Each bullet: one sentence on *what changed and why it matters to a user*, with **no file paths and no inline `(#1234)` issue spam** (that detail stays in the sections below). If the release is tiny (a handful of entries that are already a clean feature list), a Highlights section is optional — don't pad it. Keep the full detailed entries below as the authoritative record.
     - Add a `## Full Changelog` section with: `**Full Diff**: https://github.com/{owner}/{repo}/compare/v{prev}...v{new}`
   - If `NEXT.md` does not exist:
     - Generate a changelog from commit history since the last tag, **grouped by feature/theme** (not a raw `git log` dump) — collapse the commits into the same human-readable `## Highlights` + detailed-sections shape described above
     - Write it to `{changelog_dir}/v{new_version}.md`
   - **Mind the release-note size limit.** Most release hosts cap the rendered release body — GitHub rejects a release body over **125,000 characters** (HTTP 422), and a multi-hundred-KB body passed to release automation as a command/env input can also overflow `ARG_MAX` ("Argument list too long"). The `## Highlights` summary is what keeps the release readable AND small; the exhaustive per-change detail lives in the changelog file in the repo. If a project's release pipeline injects the whole changelog file into the release body, it should feed it from a file (not an argv/env input) and truncate on a line boundary below the host's limit, appending a link to the full changelog file at the tag. Prefer publishing the Highlights as the release body and linking to the full file rather than pasting the entire changelog.

4. **Commit the release**: Stage whatever files step 2's version-bump command modified (Node: `package.json` and possibly `package-lock.json`; Rust: `Cargo.toml` and `Cargo.lock`; Python: `pyproject.toml`; etc.) plus the changelog file. Commit with message `chore: release v{new_version}`. Listing files explicitly (not `git add -A`) keeps unrelated dirty state out of the release commit.

## Local Code Review (REQUIRED GATE)

A release without a deep code review ships bugs to users. This review is the last line of defense — the full diff since the last release often contains interactions that individual PR reviews missed.

<review_gate>

1. Read all commit messages since last release to understand the scope
2. Run `git diff {target}...{source}` to get the list of changed files
3. For every changed file:
   a. Read the entire file using the Read tool (not just diff hunks)
   b. Check it against the tiered checklist below (always check Tiers 1+4; check Tiers 2-3 when relevance filters match)
   c. For each finding, quote the specific code line and explain why it's a problem
4. After reviewing all files, verify: does the aggregate change set deliver what the release claims?
5. Print a review summary table (see do:review for format)
6. Fix any issues, run tests, verify tests cover the changed code paths, commit and push
7. Only after printing the review summary may you proceed to "Open the Release PR"

If the diff touches more than 15 files, delegate later batches to a subagent to keep context clean.

</review_gate>

Checklist to apply to each file:

!`cat ~/.claude/lib/code-review-checklist.md`

Verification — self-check before proceeding (no user prompt needed):
- [ ] Read every changed file in full (not just diffs)
- [ ] Checked each file against the relevant checklist tiers
- [ ] Quoted specific code for each finding
- [ ] Printed a review summary table with findings

## Open the Release PR

- Push the source branch to remote (it should already be up to date with the release commit)
- Create a PR from `{source}` → `{target}` (e.g., `main` → `release`)
  ```bash
  gh pr create --title "Release v{version}" --base {target} --head {source} --body "..."
  ```
- Title: `Release v{version}` (read version from package.json or equivalent)
- Body: include the changelog content for this version if available, otherwise summarize commits since last release
- Keep the description clean — no co-author or "generated with" messages

**Note**: Do NOT bump the version for review fixes — the version was already set during the release preparation.

## Run the Review Loop

**If `REVIEW_AGENTS` is empty** (no `--review-with` was passed), skip this entire section — no external review loop runs. The Local Code Review gate above plus the passing build/tests are the merge gate; set `OVERALL_STATUS=clean` (no-review path) and proceed to the merge section. The Copilot-specific and local-agent-specific merge checks below do not apply when no reviewer ran.

Otherwise, hand off to the **multi-reviewer loop** with the parsed inputs:

- `{REVIEW_AGENTS}` — ordered list of the agents passed via `--review-with` (non-empty; the empty case was handled above)
- `{REVIEW_STOP_MODE}` — `all` (default) | `on-findings` | `on-clean`
- `{REVIEW_MODE}` — `series` (default) | `parallel`
- `{REVIEWER_APPLIES}` — boolean
- `{REVIEW_ITERATIONS}` — non-negative integer (default `1`); copilot iteration cap (`0` = loop until clean)
- `{GH_HOST}` — the GitHub API host derived in "Detect Release Workflow" above; forwarded to the GitHub-side loops so their `gh api` calls target the right host on GitHub Enterprise

Each pass uses the matching single-reviewer loop:

- `copilot` → Copilot cloud review loop (`lib/copilot-review-loop.md`)
- `@<login>` → GitHub-reviewer loop (`lib/github-reviewer-loop.md`), forwarding `{REVIEWER_LOGIN}`
- `codex` | `agy` | `claude` | `grok` → local-agent headless review loop (`lib/local-agent-review-loop.md`)
- `ollama` → Ollama local-model review loop (`lib/ollama-review-loop.md`)

### Multi-reviewer wrapper

!`cat ~/.claude/lib/multi-reviewer-loop.md`

### Inner loop bodies (referenced by the wrapper)

!`cat ~/.claude/lib/copilot-review-loop.md`

!`cat ~/.claude/lib/github-reviewer-loop.md`

!`cat ~/.claude/lib/local-agent-review-loop.md`

!`cat ~/.claude/lib/ollama-review-loop.md`

### CI flake handling (referenced by the merge gate)

!`cat ~/.claude/lib/ci-flake-handling.md`

## Merge the PR (only after a CLEAN multi-reviewer result)

The merge gate consumes the **wrapper's `{OVERALL_STATUS}`** plus, for any copilot pass that ran, the standard copilot post-pass checks.

### Wrapper status

- `clean` — every executed pass returned `clean` (copilot `too-large`/`capped` and `@<login>` `capped` all count as clean here, per each loop's own rule; `capped` is the default `--review-iterations 1` outcome — one review ran and all its fixes were applied), **or** no external reviewer was requested (`--review-with` omitted → `REVIEW_AGENTS=[]`) and the Local Code Review gate plus build/tests passed (the no-review path set `OVERALL_STATUS=clean`). **Eligible to merge.**
- `partial` — the wrapper stopped early because of an explicit stop-mode flag (`--review-stop-on-findings` or `--review-stop-on-clean`) and the executed passes all completed normally. **Eligible to merge** — the user opted into the short-circuit.
- `inconclusive` — the executed list contained **at least one** pass whose status was inconclusive (`timeout`, `error`, `guardrail`, `skipped`, `not-requestable` — an `@<login>` whose request failed and never reviewed — or ollama `incomplete` — a partially-reviewed diff), regardless of whether other passes returned `clean`. **Do NOT merge** — the user asked for multiple perspectives and at least one never produced a verdict.
- `dirty` — a pass returned a hard-error status (`cli-error`, `broken-build`, `test-failed`, `rejected`) and the wrapper short-circuited. **Do NOT merge.**

For `dirty` or `inconclusive`:
- **Default mode**: leave the PR open and report the proximate status so the user can review manually.
- **Interactive mode (`--interactive`)**: ask the user whether to merge anyway, re-run a specific reviewer, or leave open.

### Copilot-specific checks (when copilot was in the executed list)

- **CRITICAL**: Do NOT merge until the copilot pass returned a verdict status. A missing review is NOT the same as a clean review.
- Merge only on a copilot verdict status. Which verdict is required depends on `{REVIEW_ITERATIONS}`:
  - **Default bounded mode (`--review-iterations` ≥ 1)**: the verdict is `capped` — the configured cap was reached after applying every fix the review surfaced. Merge **without** requiring a confirming zero-comment re-review (that is the whole point of the bounded default; `capped` is clean-equivalent per the wrapper-status block above).
  - **Unlimited mode (`--review-iterations 0`)**: the verdict must be `clean` — the latest Copilot review was submitted AND generated **zero comments**. Check by: (1) confirming a new review node exists with `submittedAt` after your last push; (2) confirming the review body says "generated 0 comments" OR there are no new unresolved threads.
- **Exception — too-large**: if the Copilot review body says the PR exceeds the maximum number of lines (20 000), treat it as a clean review and proceed to merge immediately. Do NOT re-request.
- **Never merge if:**
  - No Copilot review was ever posted (review never arrived — ask user first)
  - "Awaiting requested review" is still shown (review in progress)
  - **In unlimited mode only (`--review-iterations 0`)**: the latest review had comments that you fixed but you didn't get a CLEAN re-review. (In the bounded default this is the expected `capped` outcome and IS eligible to merge.)

### Local-agent-specific checks (when codex/agy/claude/grok was in the executed list)

- The local-agent loop already verified build and tests locally before pushing, so no separate review-comment count is required — its `clean` status in the wrapper table means all iterations of that pass passed verification.

### Merging (after all checks above pass)

- **Gate on required CI first.** If the repo has required checks on the target branch, watch them in-session before merging: `gh pr checks <number> --required --watch --fail-fast`. (If `gh` reports no required checks, this gate is vacuously satisfied — merge directly.)
  - On a required-check **failure**, apply the **CI flake handling** routine — one conservative re-run on the same commit (see `~/.claude/lib/ci-flake-handling.md` and the inlined copy above). If the same SHA passes on the single re-run, treat it as a flake and proceed (logging which check flaked); if it fails again, **abort the release merge** and report which check failed. A release must never merge over a real red.
- Once confirmed clean, merge:
  ```bash
  gh pr merge <number> --merge
  ```
- Verify the merge succeeded: `gh pr view <number> --json state,mergedAt`

## Post-Merge

1. **Tag the release** on the target branch to trigger the publish workflow. Refuse to overwrite an existing tag — a colliding `v{version}` usually means the version bump heuristic picked an already-released value or a prior partial release left state behind, both of which need human attention before force-tagging would be safe:
   ```bash
   git fetch origin {target} 'refs/tags/*:refs/tags/*'
   if git rev-parse -q --verify "refs/tags/v{version}" >/dev/null; then
     echo "Tag v{version} already exists. Aborting tag step. Investigate (rerun version bump? force-tag manually?) before retrying."
     exit 1
   fi
   git tag v{version} origin/{target}
   git push origin v{version}
   ```
2. **Switch back to the source branch** locally: `git checkout {source} && git pull --rebase --autostash`
3. **Report the final status** including version, PR URL, tag, and merge state
4. Remind the user to check for the GitHub release once CI completes (if the project uses automated releases)
