---
description: Create a release PR using the project's documented release workflow
argument-hint: "[--interactive] [--review-with <agent>[,<agent>...]] [--review-iterations <n>] [--review-mode <series|parallel>] [--review-stop-on-findings|--review-stop-on-clean] [--reviewer-applies]"
---

**Default mode: fully autonomous.** Auto-detects branches, determines version bump from commits, runs review, creates and merges the release PR without prompting.

**`--interactive` mode:** Pauses for branch confirmation, version approval, and merge confirmation.

## Parse Arguments

Parse `$ARGUMENTS` for `--review-with <agent[,agent,...]>`:
- Accepted values per slot: `codex`, `agy` (aliases `gemini` / `antigravity` — all run the Antigravity CLI's `agy` binary), `claude`, `grok`, `cursor` (alias `cursor-agent` — the Cursor Agent CLI), `ollama`, `copilot` (**legacy** — GitHub's cloud Copilot review; still supported when you name it, never selected implicitly), or an arbitrary GitHub login `@<login>`
- `ollama` reviews with a local Ollama model. Bare `ollama` auto-selects the most capable installed coding model; pin a specific installed model with the bracket form `ollama[<model>]`, e.g. `ollama[qwen2.5-coder:32b]`. Strip the bracket suffix into a per-entry `OLLAMA_MODEL` (empty for bare `ollama`) and keep the base slug `ollama`.
- `codex`, `claude`, `agy`, `grok`, and `cursor` likewise accept a `<agent>[<model>]` bracket to pin the reviewing model — e.g. `codex[o3]`, `claude[claude-opus-4-8]`, `agy[Gemini 3.5 Flash (High)]`, `grok[grok-code-fast-1]`, `cursor[gpt-5]`. Strip the bracket into a per-entry `REVIEW_MODEL` (empty → the reviewer's built-in default) and keep the base slug. The bracket value is free-form (validate shape, not an allowlist); `copilot` and `@<login>` take no model bracket. A saved `review-models` default (see `/do:config`) supplies the model when a token omits the bracket — the bracket wins. See `lib/multi-reviewer-loop.md`.
- `@<login>` requests a review from an **arbitrary GitHub reviewer** — any user or App/bot login (e.g. `@octocat`, `@org-review-bot`, `@some-app[bot]`). slashdo requests their review on the PR and waits for it, fixing what it surfaces (same flow as `copilot`). Strip the leading `@` into a per-entry `REVIEWER_LOGIN`; the login must match `^[A-Za-z0-9][A-Za-z0-9-]*(\[bot\])?$`. GitHub only; never posts an approval itself.
- **Optional (non-blocking) suffix `~opt`:** any slot may end in `~opt` — e.g. `ollama~opt`, `ollama[qwen2.5-coder:32b]~opt`, `@some-bot~opt`, `copilot~opt` — to mark that reviewer **optional**: it is still requested, still runs, and its findings are still fixed, but an *inconclusive* result from it (timeout / skipped / incomplete / no-verdict) is **excluded from the merge gate** and never blocks the release merge. A hard-error from it (broken build / failed tests / rejected) still blocks — optionality never lets a broken tree merge. Strip the `~opt` suffix into a per-entry `{OPTIONAL}` flag **before** the slug/`[model]`/`@login` parsing; it is **not** part of the dedup identity (`ollama~opt` and `ollama` are the same reviewer, optional-wins on collapse). `~opt` is shell-metacharacter-free by design. Full mechanics in `lib/multi-reviewer-loop.md`.
- **Per-reviewer iteration cap suffix `~max=<n>`:** any slot may also end in `~max=<n>` — e.g. `claude~max=2`, `ollama[qwen2.5-coder:32b]~max=1`, `@some-bot~max=3` — capping how many **review → fix → re-review cycles** that one reviewer runs. This is the per-entry form of `--review-iterations` and, unlike that flag, it applies to every reviewer type including the local agents and `ollama` (whose caps are otherwise fixed at 3), so one call can budget each reviewer separately: `--review-with claude~max=2,ollama~max=1,codex~max=3`. `<n>` must be a non-negative integer; `0` means "loop until clean", bounded by each inner loop's 10-iteration safety guardrail. Strip `~max=<n>` into a per-entry `{ENTRY_MAX}` alongside `~opt` and `~effort=<level>` — all suffixes come off the right of the token, in any order, **before** the slug/`[model]`/`@login` parsing. Full mechanics in `lib/multi-reviewer-loop.md`.
- **Per-reviewer reasoning effort suffix `~effort=<level>`:** any slot may also end in `~effort=<level>` — e.g. `codex[gpt-5.6-luna]~effort=max~opt`, `claude~effort=high~max=2` — specifying the reasoning effort level (`low`, `medium`, `high`, `xhigh`, `max`) for that reviewer. Strip `~effort=<level>` into a per-entry `{ENTRY_EFFORT}` alongside `~opt` and `~max=<n>`. Reject a malformed or repeated suffix with `Invalid --review-with suffix on {entry}: ~max must be a non-negative integer and ~effort must be one of low, medium, high, xhigh, max, each appearing at most once; the only suffixes are ~opt, ~max=<n>, and ~effort=<level>.` Full mechanics in `lib/multi-reviewer-loop.md`.
- **Reserved value `none`:** the token `none` (case-insensitive) is not a reviewer slug. `--review-with none` means *no external reviewer this run* — set `REVIEW_AGENTS=[]`, skip the slug validation below, and skip applying any saved `review-with` default. This is the explicit escape hatch over a default saved via `/do:config`.
- The value may be a single agent or a **comma-separated, ordered list** (e.g. `--review-with codex,agy,copilot`). Split on `,`, trim whitespace around each slug. Normalize `gemini`/`antigravity` → `agy`, `cursor-agent` → `cursor`.
- Record the resulting list as `REVIEW_AGENTS`. **There is no built-in default reviewer.** If `--review-with` is omitted, leave `REVIEW_AGENTS` **unset for now** — the saved-defaults step below fills it from `/do:config` if a default exists, and **only if it is still unset after that** does the built-in default apply (`REVIEW_AGENTS=[]` — no external review pass; the Local Code Review gate below still runs unconditionally). Whatever ends up in the list is exactly what runs, in order: `--review-with codex` runs codex only; copilot is never added implicitly.
- Dedupe preserving first-occurrence order (compare on the normalized slug — for a model-taking agent (`codex`/`claude`/`agy`/`grok`/`cursor`/`ollama`) the `[<model>]` bracket suffix is part of the identity, so `codex[a]` and `codex[b]` are distinct while two bare `ollama`s collapse; for `@<login>` the login is the identity, compared lowercased; no `~` suffix is part of the identity, so `ollama~opt`, `ollama~max=2`, `ollama~effort=high` all collapse with `ollama` — the survivor is optional if any collapsed occurrence had `~opt`, and takes its cap and effort level from the first occurrence that carried them); if duplicates were dropped, print: `Note: deduped --review-with list to {final list}.`
- If any value is not in the accepted set, abort with a usage error: `Unknown --review-with value: {value}. Use one of: codex, agy, claude, grok, cursor, ollama, copilot, @<login> (each optionally suffixed ~opt, ~max=<n>, and/or ~effort=<level>).`

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
- The flag is **also a no-op on the ollama path** because Ollama is non-agentic (`ollama run` returns text and cannot edit files), so the orchestrator always applies the fixes. If `REVIEW_AGENTS` contains an `ollama` entry and `REVIEWER_APPLIES=true`, print a warning (`--reviewer-applies has no effect on the ollama pass; Ollama is non-agentic, so the orchestrator always applies the fixes`) and continue — the flag still takes effect on the codex/agy/claude/grok/cursor passes in the list.

Parse `$ARGUMENTS` for `--review-iterations <n>` (affects the GitHub-side passes — `copilot` and `@<login>` — only):
- Record as `REVIEW_ITERATIONS`. If `--review-iterations` is omitted, default to `1` — a single review-and-fix pass per GitHub-side reviewer (request one review, fix everything it surfaces, stop).
- Must be a non-negative integer. Any positive `n` runs at most `n` review-and-fix cycles per GitHub-side reviewer, still exiting early if a review returns 0 comments. `0` means "loop until that reviewer returns 0 comments" (the legacy behavior, bounded by each loop's own 10-iteration safety guardrail).
- If the value is missing or not a non-negative integer, abort with: `--review-iterations must be a non-negative integer (got: {value}).`
- This flag has no effect on local-agent reviewers (`codex`/`agy`/`claude`/`grok`/`cursor`) or `ollama`; they keep their own fixed iteration caps. To move *their* caps — or to give each reviewer a different budget in one run — use the per-entry `--review-with <agent>~max=<n>` suffix, which overrides this flag for the entry that carries it. The `capped` verdict (an explicitly configured cap reached after applying fixes, from either source) counts as clean-equivalent for the merge gate — see the merge section below.

Then apply any **saved defaults** (set via `/do:config`) to the flags above that the user did NOT pass on this invocation — an explicit flag, or `--review-with none`, always overrides a saved default:

!`cat ~/.claude/lib/review-config-defaults.md`

## Detect Release Workflow

Before doing anything, determine the project's source and target branches for releases. Do NOT hardcode branch names. Instead, discover them:

1. **Source branch** — run `gh repo view --json defaultBranchRef -q '.defaultBranchRef.name'` to get the repo's default branch (typically `main`). While here, **derive the GitHub API host `{GH_HOST}` from the `origin` remote** and forward it to the review loop below — `gh api` (used by the GitHub-side reviewer loops) defaults to github.com and does **not** read the repo remote, so on a GitHub Enterprise repo those loops would silently poll the wrong host and time out. Derive it and run the per-host auth precheck with the shared snippet included at the end of this section — and if `gh auth token --hostname "$GH_HOST"` fails, stop and tell the user to run `gh auth login --hostname $GH_HOST` rather than proceeding into a loop that will time out.
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

4. **Detect GitHub Release publication** — set `{publishes_github_release}` to true
   only when the documented workflow or release instructions publish a GitHub
   Release (for example, they use `gh release`, `softprops/action-gh-release`, or
   an equivalent release action). Projects that publish only packages or tags do
   not have a GitHub Release checkpoint; their successful completion ends after
   the version-tag checkpoint.

Print the detected workflow: `Detected release flow: {source} → {target}`

**Default mode**: If ambiguous, use the most likely branch (prefer `release` if it exists). If the target branch does not exist, create it from the last release tag (see step 3 above). If detection still yields `target == source`, abort with an error — a release PR cannot merge a branch into itself. **Interactive mode (`--interactive`)**: Ask the user to confirm before proceeding.

**Important**: The PR direction is `{source}` → `{target}` (e.g., `main` → `release`). This gives any reviewer (and the human approver) the full diff of all changes since the last release. Do NOT create a branch from source and PR back into it — that only shows the version bump commit.

**GitHub only** — the shared `{GH_HOST}` derivation step 1 refers to:

!`cat ~/.claude/lib/gh-host.md`

## Pre-Release Checks

1. **Ensure you're on the source branch** — checkout if needed
2. **Pull latest source** — `git pull --rebase --autostash`
3. **Pull latest target** — `git fetch origin {target} && (git show-ref --verify --quiet refs/heads/{target} && git checkout {target} || git checkout -b {target} --track origin/{target}) && git pull --rebase --autostash origin {target} && git checkout {source}` — this ensures the local target branch matches `origin/{target}` before any diff or PR creation, even on a fresh clone where the target branch may only exist on the remote. Without this, the diff may be stale or include already-released changes.
4. **Run tests** — execute the project's test suite (per project conventions already in context, or check package.json)
5. **Run build** — execute the project's build command if one exists

## Recover Prepared Release State

Before determining a new version, look for an existing release-preparation commit
on the current source history. An interrupted run must resume the prepared version,
not bump it again:

```bash
case "{publishes_github_release}" in
  true|false) ;;
  *)
    echo "INCOMPLETE — GitHub Release publication flag is unresolved; preserve the prepared release state."
    exit 1
    ;;
esac
RECOVERED_TARGET_RELEASE=false
if ! git fetch origin "refs/heads/{target}:refs/remotes/origin/{target}" >/dev/null 2>&1 \
   || ! git show-ref --verify --quiet "refs/remotes/origin/{target}"; then
  echo "INCOMPLETE — Prepared release state is unverified; origin/{target} could not be resolved. Preserve the prepared state and retry."
  exit 1
fi
  PREPARED_RELEASE="$(git log --extended-regexp --format='%H%x09%s' "origin/{target}..HEAD" | awk -F '\t' '$2 ~ /^chore: release v[0-9]+\.[0-9]+\.[0-9]+$/ { print; exit }')"
  TARGET_PREPARED_RELEASE="$(git log --extended-regexp --format='%H%x09%s' "origin/{target}" | awk -F '\t' '$2 ~ /^chore: release v[0-9]+\.[0-9]+\.[0-9]+$/ { print; exit }')"
if [ -z "$PREPARED_RELEASE" ] && [ -n "$TARGET_PREPARED_RELEASE" ]; then
  TARGET_VERSION="$(printf '%s\n' "$TARGET_PREPARED_RELEASE" | sed -E 's/.*release v//')"
  TARGET_TAG="$(git ls-remote origin "refs/tags/v${TARGET_VERSION}^{}" | awk 'NF { print $1; exit }')"
  if ! printf '%s\n' "$TARGET_TAG" | grep -Eq '^[0-9a-f]{40}$'; then
    TARGET_TAG="$(git ls-remote origin "refs/tags/v${TARGET_VERSION}" | awk 'NF { print $1; exit }')"
  fi
  TARGET_RELEASE_STATUS="$(gh api --include "repos/{owner}/{repo}/releases/tags/v${TARGET_VERSION}" 2>/dev/null | awk '$1 ~ /^HTTP\// { print $2; exit }' || true)"
  case "$TARGET_RELEASE_STATUS" in
    200)
      TARGET_RELEASE_JSON="$(gh release view "v${TARGET_VERSION}" --json isDraft,isPrerelease,publishedAt 2>/dev/null)" || {
        echo "INCOMPLETE — Prepared release state is unverified; GitHub Release metadata could not be read. Preserve the prepared state and retry."
        exit 1
      }
      ;;
    404) TARGET_RELEASE_JSON="" ;;
    *)
      echo "INCOMPLETE — Prepared release state is unverified; GitHub Release lookup returned ${TARGET_RELEASE_STATUS:-empty}. Preserve the prepared state and retry."
      exit 1
      ;;
  esac
  if [ -z "$TARGET_TAG" ] || { [ "{publishes_github_release}" = "true" ] && ! printf '%s\n' "$TARGET_RELEASE_JSON" | jq -e 'type == "object" and .isDraft == false and .isPrerelease == false and (.publishedAt | type == "string") and (.publishedAt | length > 0)' >/dev/null 2>&1; }; then
    PREPARED_RELEASE="$TARGET_PREPARED_RELEASE"
    RECOVERED_TARGET_RELEASE=true
  fi
fi
if [ -n "$PREPARED_RELEASE" ]; then
  PREPARED_RELEASE_SHA="$(printf '%s\n' "$PREPARED_RELEASE" | cut -f1)"
  VERSION="$(printf '%s\n' "$PREPARED_RELEASE" | sed -E 's/.*release v//')"
  echo "Resuming prepared release v${VERSION} at ${PREPARED_RELEASE_SHA}; skipping version bump and changelog generation."
  if [ "$RECOVERED_TARGET_RELEASE" = "true" ]; then
    TARGET_RELEASE_PRS_JSON="$(gh pr list --state merged --base "{target}" --limit 100 --json number,state,headRefOid,baseRefName,headRefName,url,mergedAt,mergeCommit)" || {
      echo "INCOMPLETE — Merged release PR is unverified; the forge query failed. Preserve the prepared state and retry."
      exit 1
    }
    if ! printf '%s\n' "$TARGET_RELEASE_PRS_JSON" | jq -e 'type == "array"' >/dev/null; then
      echo "INCOMPLETE — Merged release PR is unverified; the forge returned empty or malformed data. Preserve the prepared state and retry."
      exit 1
    fi
    MATCHING_TARGET_RELEASE_PRS="$(printf '%s\n' "$TARGET_RELEASE_PRS_JSON" | jq -c --arg sha "$PREPARED_RELEASE_SHA" --arg source "{source}" '[.[] | select(.headRefOid == $sha and .baseRefName == "{target}" and .headRefName == $source)]')"
    MATCHING_TARGET_RELEASE_COUNT="$(printf '%s\n' "$MATCHING_TARGET_RELEASE_PRS" | jq 'length')"
    if [ "$MATCHING_TARGET_RELEASE_COUNT" -ne 1 ]; then
      echo "INCOMPLETE — Merged release PR is unverified; expected exactly one merged PR for prepared SHA $PREPARED_RELEASE_SHA, found $MATCHING_TARGET_RELEASE_COUNT. Preserve the prepared state and retry."
      exit 1
    fi
    PR_NUMBER="$(printf '%s\n' "$MATCHING_TARGET_RELEASE_PRS" | jq -r '.[0].number')"
    PR_URL="$(printf '%s\n' "$MATCHING_TARGET_RELEASE_PRS" | jq -r '.[0].url')"
    PR_STATE="MERGED"
    printf 'RELEASE_TARGET_HANDOFF\tPREPARED_RELEASE_SHA=%s\tPR_NUMBER=%s\tPR_URL=%s\tPR_STATE=%s\n' "$PREPARED_RELEASE_SHA" "$PR_NUMBER" "$PR_URL" "$PR_STATE"
  fi
  printf 'RELEASE_PREPARED_HANDOFF\tPREPARED_RELEASE_SHA=%s\tVERSION=%s\tTARGET_RECOVERY=%s\n' "$PREPARED_RELEASE_SHA" "$VERSION" "$RECOVERED_TARGET_RELEASE"
else
  echo "No prepared release commit found; determine a new version and finalize its changelog below."
fi
```

When `PREPARED_RELEASE` is non-empty, verify that the checked-out package version
is `{version}` and continue directly to **Local Code Review**. Do not determine a
new bump, rewrite release notes, or create another `chore: release` commit. If the
package version does not match the prepared commit's version, fail closed and
preserve the prepared state for investigation. When `TARGET_RECOVERY=true`, the
prepared release is already merged into `{target}`: carry the
`RELEASE_TARGET_HANDOFF` values and skip Local Code Review, Checkpoints 1–2, and
the open-PR review/CI/merge gates; continue directly to Checkpoint 3 and then
verify the target tree, tag, and GitHub Release.

## Determine Version and Finalize Changelog

Skip this entire section when `PREPARED_RELEASE` is non-empty; it is only for a
release with no prepared release commit.

1. **Determine version bump** from commits since the last git tag:
   - Scan commit messages for conventional commit prefixes (also check each commit's body/footer for `BREAKING CHANGE:` — a recognized way to signal a breaking change without the prefix):
     - `breaking:`, any prefix with a `!` (e.g. `feat!:`, `fix!:`, `refactor!:`), or a `BREAKING CHANGE:` footer → **major** bump
     - `feat:` → **minor** bump
     - `fix:`, `build:`, `chore:`, `docs:`, `refactor:`, `perf:`, `style:`, `test:`, `ci:` → **patch** bump
   - Use the **highest applicable level** across all commits
   - **Default mode**: Use the determined version automatically. **Interactive mode (`--interactive`)**: Present the proposed version to the user for confirmation

2. **Bump version**: Use the project's native version-bump command. For Node projects: `npm version <major|minor|patch> --no-git-tag-version` (updates `package.json` and `package-lock.json`). For other ecosystems, detect from the project files in the working directory and use the equivalent. **Rust** has no stock version-bump command — probe in order: `cargo release version <level> --execute` if `cargo-release` is installed (`command -v cargo-release`; the bare form is a dry run), else `cargo set-version --bump <level>` if `cargo-edit` is installed (`command -v cargo-set-version`; its positional argument takes a concrete version, not a level keyword), else fall back to a direct edit of the `version = "x.y.z"` line in `Cargo.toml` followed by `cargo update -p <package>` to refresh `Cargo.lock`. **Python**: `poetry version <level>` (Poetry projects), else direct edit of `pyproject.toml` `[project] version = "..."`. **Elixir**: edit `mix.exs`. **Go**: edit a `VERSION` file. The commit step below stages whichever files the bump command modified — not a hardcoded list.

3. **Finalize changelog / build the release notes**:

   First **resolve how this project produces release notes** — do not assume a layout. In order:
   1. **Stated convention** — the repo's `CLAUDE.md` / `AGENT.md` / `AGENTS.md` / `CONTRIBUTING.md`, or a release workflow in `.github/workflows/`, if any of them describe the release-notes process. An explicit instruction wins over everything inferred below.
   2. **An existing release-automation tool** — `release-please`, `semantic-release`, `changesets`, `towncrier`, `git-cliff`, or similar, detected from its config file. **That tool owns the changelog**: let it generate the notes on its own terms rather than hand-writing a file it will overwrite. Run its documented command if the project expects you to; otherwise leave the changelog alone entirely.
   3. **An existing file-based changelog** — a per-release directory (`.changelogs/`, `.changelog/`, `docs/releases/`) or a rolling `CHANGELOG.md`. Follow the shape already in the repo (see the two branches below).
   4. **No file-based changelog at all** — **build the release notes from the commits since the last release** (below).

   **If the project stages unreleased entries in a file** (e.g. a `NEXT.md` alongside versioned files, or an `## Unreleased` section at the top of `CHANGELOG.md`) and that staging content exists:
     - Promote it to the release: rename `NEXT.md` → `v{new_version}.md` in a per-release directory, or retitle the `## Unreleased` section, whichever matches the repo
     - Replace the unreleased header with `# Release v{new_version}` (or the project's equivalent)
     - Add `Released: YYYY-MM-DD` with today's date
     - **Lead with a human-readable, feature-grouped `## Highlights` summary** (insert it directly under the header/date, *above* the detailed `Added`/`Changed`/`Fixed` sections). Release notes are read by humans deciding whether to upgrade — they should tell the story of the release **by feature**, not dump a flat list of every file change and issue number. Synthesize the detailed entries into **5–15 plain-language bullets grouped by theme/feature area** (e.g. "Editorial pipeline", "Local LLM", "Infra & deps"). Each bullet: one sentence on *what changed and why it matters to a user*, with **no file paths and no inline `(#1234)` issue spam** (that detail stays in the sections below). If the release is tiny (a handful of entries that are already a clean feature list), a Highlights section is optional — don't pad it. Keep the full detailed entries below as the authoritative record.
     - Add a `## Full Changelog` section with: `**Full Diff**: https://{GH_HOST}/{owner}/{repo}/compare/v{prev}...v{new}` — built from the `{GH_HOST}` derived above, never a literal `github.com`, or the link 404s on every GitHub Enterprise install

   **If there is no staged unreleased content — or no file-based changelog at all — derive the notes from the commits since the last release.** This is the normal path for a repo whose history *is* its changelog (conventional commits, no changelog file), not a fallback:
     - Take the commit range since the last release tag (`git log {last_tag}..HEAD`, or the full history if this is the first release). Prefer merge-commit/PR titles over every intermediate "address review" commit — squash-merge repos already give you one commit per shipped change.
     - **Group by feature/theme, never a raw `git log` dump.** Collapse the commits into the same human-readable `## Highlights` + detailed-sections shape described above: read each commit's subject *and body* for the user-visible effect, drop pure-noise commits (formatting, "fix typo", CI churn) or fold them into an `Internal` group, and write each bullet for someone deciding whether to upgrade — no file paths, no `(#1234)` spam.
     - Where the notes go depends on the convention you resolved: into the project's per-release file (`{changelog_dir}/v{new_version}.md`) or the top of a rolling `CHANGELOG.md` if one exists — **or nowhere on disk at all** if the project keeps no changelog file, in which case the generated notes become the release body (and the PR description) and no changelog file is created or staged.

   - **Mind the release-note size limit.** Most release hosts cap the rendered release body — GitHub rejects a release body over **125,000 characters** (HTTP 422), and a multi-hundred-KB body passed to release automation as a command/env input can also overflow `ARG_MAX` ("Argument list too long"). The `## Highlights` summary is what keeps the release readable AND small; when the project keeps a changelog file, the exhaustive per-change detail lives there rather than in the release body. If a project's release pipeline injects the whole changelog file into the release body, it should feed it from a file (not an argv/env input) and truncate on a line boundary below the host's limit, appending a link to the full changelog file at the tag. Prefer publishing the Highlights as the release body and linking to the full file rather than pasting the entire changelog.

4. **Commit the release**: Stage whatever files step 2's version-bump command modified (Node: `package.json` and possibly `package-lock.json`; Rust: `Cargo.toml` and `Cargo.lock`; Python: `pyproject.toml`; etc.) plus the changelog file **if step 3 wrote one** (a project whose notes come from commit history has none to stage). Commit with message `chore: release v{new_version}`. Listing files explicitly (not `git add -A`) keeps unrelated dirty state out of the release commit.

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

When `TARGET_RECOVERY=true`, use the carried `RELEASE_TARGET_HANDOFF` instead of
running Checkpoints 1–2; the already-merged PR is the release PR for this retry.
Continue with Checkpoint 3 and the post-merge verification blocks below.

- **Checkpoint 1 — source push.** Push the prepared source commit and verify the
  forge reports the exact same commit before creating or reusing a PR. A successful
  `git push` by itself is not proof that the remote ref was updated; empty,
  malformed, or mismatched output is an incomplete release and must name
  `Source push` as the first unverified checkpoint:
  ```bash
  git push -u origin "HEAD:refs/heads/{source}"
  SOURCE_SHA="$(git rev-parse HEAD)"
  PREPARED_RELEASE_SHA="$(git log --extended-regexp --format='%H%x09%s' | awk -F '\t' '$2 ~ /^chore: release v[0-9]+\.[0-9]+\.[0-9]+$/ { print $1; exit }')"
  if ! printf '%s\n' "$PREPARED_RELEASE_SHA" | grep -Eq '^[0-9a-f]{40}$'; then
    echo "INCOMPLETE — Prepared release state is unverified; the release preparation commit could not be identified. Preserve the prepared state and retry."
    exit 1
  fi
  REMOTE_SOURCE_SHA="$(git ls-remote --heads origin "refs/heads/{source}" | awk 'NF { print $1; exit }')"
  if ! printf '%s\n' "$REMOTE_SOURCE_SHA" | grep -Eq '^[0-9a-f]{40}$' || [ "$REMOTE_SOURCE_SHA" != "$SOURCE_SHA" ]; then
    echo "INCOMPLETE — Source push is unverified; expected $SOURCE_SHA, got ${REMOTE_SOURCE_SHA:-empty}. Preserve the prepared release state and retry."
    exit 1
  fi
  ```
- **Checkpoint 2 — release PR.** Query all matching PRs for the current source SHA
  before creating one. Reuse an open PR, or a merged PR whose head is still this
  source SHA when an interrupted rerun already completed it; never create a
  duplicate. Missing, empty, malformed, or ambiguous forge output is incomplete
  and must name `Release PR` as the first unverified checkpoint. A closed,
  unmerged PR is not reusable, so a later run may create a new PR for the newly
  pushed source SHA:
  ```bash
  SOURCE_SHA="$(git rev-parse HEAD)"
  PREPARED_RELEASE_SHA="$(git log --extended-regexp --format='%H%x09%s' | awk -F '\t' '$2 ~ /^chore: release v[0-9]+\.[0-9]+\.[0-9]+$/ { print $1; exit }')"
  REMOTE_SOURCE_SHA="$(git ls-remote --heads origin "refs/heads/{source}" | awk 'NF { print $1; exit }')"
  if ! printf '%s\n' "$REMOTE_SOURCE_SHA" | grep -Eq '^[0-9a-f]{40}$' || [ "$REMOTE_SOURCE_SHA" != "$SOURCE_SHA" ]; then
    echo "INCOMPLETE — Source push is unverified; expected $SOURCE_SHA, got ${REMOTE_SOURCE_SHA:-empty}. Preserve the prepared release state and retry."
    exit 1
  fi
  RELEASE_PRS_JSON="$(gh pr list --state all --base "{target}" --head "{source}" --limit 100 \
    --json number,state,headRefOid,baseRefName,headRefName,url,createdAt)" || {
    echo "INCOMPLETE — Release PR is unverified; the forge query failed. Preserve the prepared release state and retry."
    exit 1
  }
  if ! printf '%s\n' "$RELEASE_PRS_JSON" | jq -e 'type == "array"' >/dev/null; then
    echo "INCOMPLETE — Release PR is unverified; the forge returned empty or malformed data. Preserve the prepared release state and retry."
    exit 1
  fi
  MATCHING_RELEASE_PRS="$(printf '%s\n' "$RELEASE_PRS_JSON" | jq -c --arg sha "$SOURCE_SHA" \
    '[.[] | select(.headRefOid == $sha and (.state == "OPEN" or .state == "MERGED"))]')"
  MATCHING_COUNT="$(printf '%s\n' "$MATCHING_RELEASE_PRS" | jq 'length')"
  if [ "$MATCHING_COUNT" -gt 1 ]; then
    echo "INCOMPLETE — Release PR is ambiguous; more than one open or merged PR matches $SOURCE_SHA. Preserve the prepared release state and investigate."
    exit 1
  elif [ "$MATCHING_COUNT" -eq 1 ]; then
    PR_NUMBER="$(printf '%s\n' "$MATCHING_RELEASE_PRS" | jq -r '.[0].number')"
    PR_URL="$(printf '%s\n' "$MATCHING_RELEASE_PRS" | jq -r '.[0].url')"
    PR_STATE="$(printf '%s\n' "$MATCHING_RELEASE_PRS" | jq -r '.[0].state')"
  else
    PR_URL="$(gh pr create --title "Release v{version}" --base "{target}" --head "{source}" --body "...")" || {
      echo "INCOMPLETE — Release PR is unverified; creation failed. Preserve the prepared release state and retry without creating another PR."
      exit 1
    }
    PR_NUMBER="${PR_URL##*/}"
    if ! printf '%s\n' "$PR_NUMBER" | grep -Eq '^[0-9]+$'; then
      echo "INCOMPLETE — Release PR is unverified; creation returned empty or malformed data. Preserve the prepared release state and retry."
      exit 1
    fi
    PR_STATE="OPEN"
  fi
  printf 'RELEASE_PR_HANDOFF\tPREPARED_RELEASE_SHA=%s\tPR_NUMBER=%s\tPR_URL=%s\tPR_STATE=%s\n' "$PREPARED_RELEASE_SHA" "$PR_NUMBER" "$PR_URL" "$PR_STATE"
  ```
- Title: `Release v{version}` (read version from package.json or equivalent)
- Body: include the changelog content for this version if available, otherwise summarize commits since last release
- Keep the description clean — no co-author or "generated with" messages

**Note**: Do NOT bump the version for review fixes — the version was already set during the release preparation.

Record the printed `RELEASE_PREPARED_HANDOFF` and `RELEASE_PR_HANDOFF` lines and
carry their literal `PREPARED_RELEASE_SHA`, `PR_NUMBER`, `PR_URL`, and `PR_STATE`
values into the review and merge steps. Shell variables do not survive separate
tool calls; do not re-expand them later expecting them to be populated.

## Run the Review Loop

If the selected PR already has `PR_STATE=MERGED`, skip this section entirely.
Do not request another review or treat an already-merged PR as an open merge
candidate; set `OVERALL_STATUS=clean` for the post-merge verification path.

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
- `codex` | `agy` | `claude` | `grok` | `cursor` → local-agent headless review loop (`lib/local-agent-review-loop.md`)
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

If `PR_STATE=MERGED`, skip all review-verdict and CI/merge gates in this section
and continue directly to Checkpoint 3's remote read-back. An already-merged PR
does not need another reviewer verdict to recover its post-merge checkpoints.

The merge gate consumes the **wrapper's `{OVERALL_STATUS}`** plus, for any copilot pass that ran, the standard copilot post-pass checks.

### Wrapper status

- `clean` — every executed pass returned `clean` (copilot `too-large`, and `capped` from any of the four loops, all count as clean here, per each loop's own rule; `capped` means an **explicitly configured** cap was reached after applying every fix — the default `--review-iterations 1` outcome on a GitHub-side pass, or a per-entry `~max=<n>`. A *built-in* cap that cuts off a still-productive loop is `guardrail`, which is inconclusive below), **or** no external reviewer was requested (`--review-with` omitted → `REVIEW_AGENTS=[]`) and the Local Code Review gate plus build/tests passed (the no-review path set `OVERALL_STATUS=clean`). **Eligible to merge.**
- `partial` — the wrapper stopped early because of an explicit stop-mode flag (`--review-stop-on-findings` or `--review-stop-on-clean`) and the executed passes all completed normally. **Eligible to merge** — the user opted into the short-circuit.
- `inconclusive` — the executed list contained **at least one** pass whose status was inconclusive (`timeout`, `error`, `guardrail`, `skipped`, `not-requestable` — an `@<login>` whose request failed and never reviewed — `no-verdict` — a local agent that ran but did not answer in the verdict format — ollama `incomplete` — a partially-reviewed diff — or `push-failed`, a pass whose fix commits never reached the remote, which counts here even on an `~opt` pass), regardless of whether other passes returned `clean`. **Do NOT merge** — the user asked for multiple perspectives and at least one never produced a verdict.
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

### Local-agent-specific checks (when codex/agy/claude/grok/cursor was in the executed list)

- The local-agent loop already verified build and tests locally before pushing, so no separate review-comment count is required — its `clean` status in the wrapper table means all iterations of that pass passed verification.

### Merging (after all checks above pass)

If `PR_STATE=MERGED`, skip the CI gate and merge command below and continue
directly to **Checkpoint 3**. Otherwise, run the gate and merge command. This
conditional is required for an interrupted rerun to recover from a merge that
already succeeded remotely.

- **Gate on required CI first.** If the repo has required checks on the target branch, watch them in-session before merging: `gh pr checks <number> --required --watch --fail-fast`. (If `gh` reports no required checks, this gate is vacuously satisfied — merge directly.)
  - On a required-check **failure**, apply the **CI flake handling** routine — one conservative re-run on the same commit (see `~/.claude/lib/ci-flake-handling.md` and the inlined copy above). If the same SHA passes on the single re-run, treat it as a flake and proceed (logging which check flaked); if it fails again, **abort the release merge** and report which check failed. A release must never merge over a real red.
- Once confirmed clean, merge:
  ```bash
  PR_NUMBER="<number>"
  CURRENT_PR_STATE="$(gh pr view "$PR_NUMBER" --json state -q .state)" || {
    echo "INCOMPLETE — Merged release PR is unverified; the forge state query failed. Preserve the prepared release state and retry."
    exit 1
  }
  if [ "$CURRENT_PR_STATE" = "OPEN" ]; then
    gh pr merge "$PR_NUMBER" --merge
  elif [ "$CURRENT_PR_STATE" != "MERGED" ]; then
    echo "INCOMPLETE — Merged release PR is unverified; expected OPEN or MERGED, got ${CURRENT_PR_STATE:-empty}. Preserve the prepared release state and retry."
    exit 1
  fi
  ```
- **Checkpoint 3 — merged release PR.** Do not infer completion from the merge
  command's exit status. Read back all three remote fields and require a merged
  state, a non-empty merge timestamp, and a non-empty merge commit. Empty,
  malformed, timed-out, queued, or otherwise inconclusive output is incomplete;
  name `Merged release PR` as the first unverified checkpoint and preserve the
  prepared state:
  Run the Checkpoint 3 through Checkpoint 6 blocks below with a command timeout of
  at least 600 seconds and as one shell invocation;
  this keeps their verified values together. Substitute the carried preparation
  SHA and selected PR number for `<prepared-release-sha>` and `<number>` rather
  than relying on variables from earlier shell calls.
  ```bash
  PR_NUMBER="<number>"
  MERGE_JSON="$(gh pr view "$PR_NUMBER" --json state,mergedAt,mergeCommit)" || {
    echo "INCOMPLETE — Merged release PR is unverified; the forge query failed. Preserve the prepared release state and retry."
    exit 1
  }
  if ! printf '%s\n' "$MERGE_JSON" | jq -e \
    'type == "object" and .state == "MERGED" and (.mergedAt | type == "string") and (.mergedAt | length > 0) and (.mergeCommit.oid | type == "string") and (.mergeCommit.oid | length > 0)' >/dev/null; then
    echo "INCOMPLETE — Merged release PR is unverified; state, mergedAt, or mergeCommit is missing or not MERGED. Preserve the prepared release state and retry."
    exit 1
  fi
  MERGE_COMMIT="$(printf '%s\n' "$MERGE_JSON" | jq -r '.mergeCommit.oid')"
  printf 'RELEASE_PR_HANDOFF\tPR_NUMBER=%s\tPR_URL=%s\tPR_STATE=MERGED\tMERGE_COMMIT=%s\n' "$PR_NUMBER" "$(gh pr view "$PR_NUMBER" --json url -q .url)" "$MERGE_COMMIT"
  ```

## Post-Merge

1. **Checkpoint 4 — target-branch tree.** Fetch the target and verify its remote
   ref is a real commit with a tree that contains the merged release commit. This
   proves the source-to-target promotion landed; checking only PR state would miss
   a queued or otherwise incomplete target update. If any command is empty,
   malformed, timed out, or fails, report `Target branch tree` as the first
   unverified checkpoint and do not create or reuse a tag. The Checkpoint 3 through
   Checkpoint 6 commands below must run as one shell invocation so verified values
   survive between checkpoints:
   ```bash
   PREPARED_RELEASE_SHA="<prepared-release-sha>"
   PR_NUMBER="<number>"
   if [ "<target-recovery>" = "true" ]; then
     SOURCE_SHA="$PREPARED_RELEASE_SHA"
   else
     SOURCE_SHA="$(git rev-parse HEAD)"
   fi
   MERGE_JSON="$(gh pr view "$PR_NUMBER" --json state,mergedAt,mergeCommit)" || {
     echo "INCOMPLETE — Merged release PR is unverified; the forge query failed. Preserve the prepared release state and retry."
     exit 1
   }
   if ! printf '%s\n' "$MERGE_JSON" | jq -e \
    'type == "object" and .state == "MERGED" and (.mergedAt | type == "string") and (.mergedAt | length > 0) and (.mergeCommit.oid | type == "string") and (.mergeCommit.oid | length > 0)' >/dev/null; then
     echo "INCOMPLETE — Merged release PR is unverified; the remote merge state is incomplete. Preserve the prepared release state and retry."
     exit 1
   fi
   MERGE_COMMIT="$(printf '%s\n' "$MERGE_JSON" | jq -r '.mergeCommit.oid')"
   PR_URL="$(gh pr view "$PR_NUMBER" --json url -q .url)" || {
     echo "INCOMPLETE — Merged release PR is unverified; the PR URL could not be read. Preserve the prepared release state and retry."
     exit 1
   }
   # Checkpoint 4 — FETCH_HEAD pins the exact target ref fetched; do not resolve
   # a second moving tip with ls-remote.
   git fetch origin "refs/heads/{target}" || {
     echo "INCOMPLETE — Target branch tree is unverified; fetching {target} failed. Preserve the prepared release state and retry."
     exit 1
   }
   TARGET_SHA="$(git rev-parse --verify --quiet FETCH_HEAD^{commit} || true)"
   if ! printf '%s\n' "$TARGET_SHA" | grep -Eq '^[0-9a-f]{40}$' \
      || ! git cat-file -e "$TARGET_SHA^{tree}" 2>/dev/null \
      || ! git merge-base --is-ancestor "$MERGE_COMMIT" "$TARGET_SHA"; then
     echo "INCOMPLETE — Target branch tree is unverified; expected {target} to contain $MERGE_COMMIT, got ${TARGET_SHA:-empty}. Preserve the prepared release state and retry."
     exit 1
   fi
   # Checkpoint 5 — version tag. A workflow may add housekeeping commits after
   # the merge, so accept only a tag on the merged-release lineage, never an
   # unrelated or stale tag, and never overwrite an existing tag. A failed push
   # may have raced with another successful publisher, so re-read the tag before
   # reporting failure.
   TAG_SHA="$(git ls-remote origin "refs/tags/v{version}^{}" | awk 'NF { print $1; exit }')"
   if ! printf '%s\n' "$TAG_SHA" | grep -Eq '^[0-9a-f]{40}$'; then
     TAG_SHA="$(git ls-remote origin "refs/tags/v{version}" | awk 'NF { print $1; exit }')"
   fi
   if printf '%s\n' "$TAG_SHA" | grep -Eq '^[0-9a-f]{40}$'; then
     TAG_COMMIT="$TAG_SHA"
     if ! git merge-base --is-ancestor "$PREPARED_RELEASE_SHA" "$TAG_COMMIT" \
        || ! git merge-base --is-ancestor "$TAG_COMMIT" "$TARGET_SHA"; then
       echo "INCOMPLETE — Version tag v{version} is not on the merged release lineage; refusing to overwrite it."
       exit 1
     fi
   else
     if git rev-parse --verify --quiet "refs/tags/v{version}^{commit}" >/dev/null; then
       LOCAL_TAG_COMMIT="$(git rev-parse --verify --quiet "refs/tags/v{version}^{commit}")" || {
         echo "INCOMPLETE — Version tag is unverified; the local tag could not be read. Preserve the prepared release state and retry."
         exit 1
       }
       if ! git merge-base --is-ancestor "$PREPARED_RELEASE_SHA" "$LOCAL_TAG_COMMIT" \
          || ! git merge-base --is-ancestor "$LOCAL_TAG_COMMIT" "$TARGET_SHA"; then
         echo "INCOMPLETE — Local version tag v{version} is not on the merged release lineage; refusing to overwrite it."
         exit 1
       fi
     else
       git tag "v{version}" "$MERGE_COMMIT" || {
         echo "INCOMPLETE — Version tag is unverified; local tag creation failed. Preserve the prepared release state and retry."
         exit 1
       }
     fi
     git push origin "refs/tags/v{version}" || true
     TAG_SHA="$(git ls-remote origin "refs/tags/v{version}^{}" | awk 'NF { print $1; exit }')"
     if ! printf '%s\n' "$TAG_SHA" | grep -Eq '^[0-9a-f]{40}$'; then
       TAG_SHA="$(git ls-remote origin "refs/tags/v{version}" | awk 'NF { print $1; exit }')"
     fi
     TAG_COMMIT="$TAG_SHA"
     if ! printf '%s\n' "$TAG_COMMIT" | grep -Eq '^[0-9a-f]{40}$' \
        || ! git merge-base --is-ancestor "$PREPARED_RELEASE_SHA" "$TAG_COMMIT" \
        || ! git merge-base --is-ancestor "$TAG_COMMIT" "$TARGET_SHA"; then
       echo "INCOMPLETE — Version tag is unverified; expected a tag on the merged release lineage, got ${TAG_COMMIT:-empty}. Preserve the prepared release state and retry."
       exit 1
     fi
   fi

   # Checkpoint 6 — GitHub Release. The release workflow may need time to publish
   # after the tag. Missing, empty, malformed, or timed-out output is incomplete
   # when GitHub Release publication is part of the documented workflow.
   case "{publishes_github_release}" in
     true|false) ;;
     *)
       echo "INCOMPLETE — GitHub Release publication flag is unresolved; preserve the prepared release state."
       exit 1
       ;;
   esac
   if [ "{publishes_github_release}" = "true" ]; then
   RELEASE_JSON=""
   for ATTEMPT in $(seq 1 30); do
     RELEASE_JSON="$(gh release view "v{version}" --json tagName,isDraft,isPrerelease,publishedAt 2>/dev/null || true)"
     if printf '%s\n' "$RELEASE_JSON" | jq -e \
       'type == "object" and .tagName == "v{version}" and .isDraft == false and .isPrerelease == false and (.publishedAt | type == "string") and (.publishedAt | length > 0)' >/dev/null 2>&1; then
       break
     fi
     RELEASE_JSON=""
     [ "$ATTEMPT" -lt 30 ] && sleep 10
   done
   if ! printf '%s\n' "$RELEASE_JSON" | jq -e \
     'type == "object" and .tagName == "v{version}" and .isDraft == false and .isPrerelease == false and (.publishedAt | type == "string") and (.publishedAt | length > 0)' >/dev/null 2>&1; then
     echo "INCOMPLETE — GitHub Release is unverified after the bounded wait; preserve the prepared release state and retry."
     exit 1
   fi
   else
     echo "Checkpoint 6 — GitHub Release: skipped because the documented workflow does not publish one."
   fi

   echo "COMPLETE — source $SOURCE_SHA; PR $PR_NUMBER merged at $MERGE_COMMIT; target $TARGET_SHA; tag $TAG_COMMIT."
   ```
2. **Only after all six checkpoints pass** report the release as complete, including
   the source SHA, PR URL and merged state, target SHA, tag SHA, and published
   GitHub Release. A local prepared commit, a successful PR merge command, or a
   pushed tag is never sufficient on its own. Switch back to the source branch
   locally only after the remote verification succeeds:
   `git checkout {source} && git pull --rebase --autostash`.
