---
description: Create a release PR using the project's documented release workflow
argument-hint: "[--interactive] [--review-with <agent>[,<agent>...]] [--review-iterations <n>] [--review-mode <series|parallel>] [--review-stop-on-findings|--review-stop-on-clean] [--reviewer-applies]"
---

**Default mode: fully autonomous** — detects branches, determines the version bump from commits, runs review, creates and merges the release PR without prompting. **`--interactive`** pauses for branch confirmation, version approval, and merge confirmation.

## Parse Arguments

Parse `$ARGUMENTS` for `--review-with <agent[,agent,...]>` (full mechanics in `lib/multi-reviewer-loop.md`):
- Accepted values per slot: `codex`, `agy` (aliases `gemini` / `antigravity` — the Antigravity CLI's `agy` binary), `claude`, `grok`, `pi`, `cursor` (alias `cursor-agent` — the Cursor Agent CLI), `opencode` (aliases `zen` / `opencode-zen` — the OpenCode CLI), `ollama`, `copilot` (**legacy** — GitHub's cloud Copilot review; supported when named, never selected implicitly), `cmd[<invocation>]` — an escape hatch for any harness not in this list (see `lib/local-agent-review-loop.md` "The `cmd` reviewer"; always review-only, no `[<model>]`/`~effort=` — bake those into the invocation), or an arbitrary GitHub login `@<login>`
- `ollama` reviews with a local Ollama model: bare `ollama` auto-selects the most capable installed coding model; `ollama[<model>]` (e.g. `ollama[qwen2.5-coder:32b]`) pins one. Strip the bracket into a per-entry `OLLAMA_MODEL` (empty for bare `ollama`) and keep the base slug `ollama`.
- `codex`, `claude`, `agy`, `grok`, `pi`, `cursor`, and `opencode` likewise accept `<agent>[<model>]` — e.g. `codex[o3]`, `claude[claude-opus-4-8]`, `agy[Gemini 3.8 Flash (High)]`, `grok[grok-code-fast-1]`, `cursor[gpt-5]`, `opencode[muse-1.3]`. Strip the bracket into a per-entry `REVIEW_MODEL` (empty → the reviewer's built-in default); keep the base slug. The value is free-form (validate shape, not an allowlist); `copilot` and `@<login>` take no model bracket. A saved `review-models` default (see `/do:config`) supplies the model when the token omits the bracket; an explicit bracket wins.
- `@<login>` requests a review from any GitHub user or App/bot login (e.g. `@octocat`, `@org-review-bot`, `@some-app[bot]`): slashdo requests their review on the PR, waits, and fixes what it surfaces (same flow as `copilot`); it never posts an approval itself. Strip the leading `@` into a per-entry `REVIEWER_LOGIN`; the login must match `^[A-Za-z0-9][A-Za-z0-9-]*(\[bot\])?$`. GitHub only.
- **Optional suffix `~opt`** (e.g. `ollama~opt`, `ollama[qwen2.5-coder:32b]~opt`, `@some-bot~opt`): the reviewer still runs and its findings are still fixed, but an *inconclusive* result (timeout / skipped / incomplete / no-verdict) is **excluded from the merge gate** and never blocks the release merge; a hard-error (broken build / failed tests / rejected) still blocks. Strip `~opt` into a per-entry `{OPTIONAL}` flag; it is not part of the dedup identity (optional-wins on collapse).
- **Per-reviewer iteration cap suffix `~max=<n>`** (e.g. `claude~max=2`, `@some-bot~max=3`): caps that reviewer's review → fix → re-review cycles. Unlike `--review-iterations` it applies to every reviewer type, including local agents and `ollama` (caps otherwise fixed at 3), so one call can budget each reviewer: `--review-with claude~max=2,ollama~max=1,codex~max=3`. `<n>` is a non-negative integer; `0` means "loop until clean", bounded by each inner loop's 10-iteration safety guardrail. Strip into a per-entry `{ENTRY_MAX}`.
- **Per-reviewer reasoning effort suffix `~effort=<level>`** (e.g. `codex[gpt-5.6-luna]~effort=max~opt`, `claude~effort=high~max=2`): `low`, `medium`, `high`, `xhigh`, or `max`. Strip into a per-entry `{ENTRY_EFFORT}`. All `~` suffixes come off the right of the token, in any order, **before** the slug/`[model]`/`@login` parsing. Reject a malformed or repeated suffix with `Invalid --review-with suffix on {entry}: ~max must be a non-negative integer and ~effort must be one of low, medium, high, xhigh, max, each appearing at most once; the only suffixes are ~opt, ~max=<n>, and ~effort=<level>.`
- **Reserved value `none`** (case-insensitive): not a slug. `--review-with none` means no external reviewer this run — set `REVIEW_AGENTS=[]`, skip the slug validation below, and skip applying any saved `review-with` default (the explicit escape hatch over a `/do:config` default).
- The value may be a single agent or a comma-separated, ordered list (e.g. `--review-with codex,agy,copilot`). Split on `,`, trim whitespace. Normalize `gemini`/`antigravity` → `agy`, `cursor-agent` → `cursor`, `zen`/`opencode-zen` → `opencode`.
- Record the list as `REVIEW_AGENTS`. **There is no built-in default reviewer.** If `--review-with` is omitted, leave `REVIEW_AGENTS` unset for now — the saved-defaults step fills it from `/do:config`; only if still unset after that does `REVIEW_AGENTS=[]` apply (no external review pass; the Local Code Review gate still runs). Exactly the listed reviewers run, in order; copilot is never added implicitly.
- Dedupe preserving first-occurrence order on the normalized slug: for a model-taking agent the `[<model>]` bracket is part of the identity (`codex[a]` and `codex[b]` are distinct; two bare `ollama`s collapse); for `cmd`, the verbatim `[<invocation>]` is the identity (two different invocations are distinct reviewers, never collapsed); for `@<login>` the login is the identity, compared lowercased; no `~` suffix is part of the identity (`ollama~opt`, `ollama~max=2`, `ollama~effort=high` all collapse with `ollama` — the survivor is optional if any occurrence had `~opt`, and takes its cap and effort from the first occurrence that carried them). If duplicates were dropped, print: `Note: deduped --review-with list to {final list}.`
- If any value is not in the accepted set, abort with: `Unknown --review-with value: {value}. Use one of: codex, agy, claude, grok, pi, cursor, opencode, ollama, copilot, cmd[<invocation>], @<login> (each optionally suffixed ~opt, ~max=<n>, and/or ~effort=<level>).`

Parse `$ARGUMENTS` for the stop-mode flags (mutually exclusive):
- `--review-stop-on-findings` — stop the multi-reviewer loop after the first reviewer that fixed at least one finding.
- `--review-stop-on-clean` — stop after the first reviewer that reports a clean pass with zero findings.
- If neither is present, set `REVIEW_STOP_MODE=all` (default — run every listed reviewer in order).
- If both are present, abort with: `--review-stop-on-findings and --review-stop-on-clean cannot be combined`.

Parse `$ARGUMENTS` for `--review-mode <series|parallel>`:
- `series` (default, recommended) — reviewers run one at a time in list order, each reviewing against the prior reviewer's committed fixes.
- `parallel` — reviews run concurrently against one frozen baseline, then the orchestrator applies the deduped union of findings once; no reviewer sees another's fixes, and `--reviewer-applies` and the stop-modes are ignored.
- If omitted, leave `REVIEW_MODE` unset for now — the saved-defaults step fills it from the `review-mode` default; the built-in default is `series`.
- Any other value: abort with `--review-mode must be one of series, parallel (got: {value}).`

Parse `$ARGUMENTS` for `--reviewer-applies` (boolean):
- Record as `REVIEWER_APPLIES=true` if present, otherwise `REVIEWER_APPLIES=false` (default).
- By default the orchestrating thread applies the fixes a reviewer surfaces; with `--reviewer-applies` the reviewing CLI edits the working tree directly (see `lib/local-agent-review-loop.md` "Editing mode"). It only affects the codex/agy/claude/grok/cursor/opencode passes. When `REVIEWER_APPLIES=true` and `REVIEW_AGENTS` contains `copilot` or an `@<login>` (read-only cloud reviews), print `--reviewer-applies has no effect on the copilot/@<login> passes; fixes there are always applied by the orchestrator's sub-agent` and continue; when it contains `ollama` (`ollama run` returns text and cannot edit files), print `--reviewer-applies has no effect on the ollama pass; Ollama is non-agentic, so the orchestrator always applies the fixes` and continue.

Parse `$ARGUMENTS` for `--review-iterations <n>` (GitHub-side passes — `copilot` and `@<login>` — only):
- Record as `REVIEW_ITERATIONS`; default `1` — one review-and-fix pass per GitHub-side reviewer.
- A positive `n` runs at most `n` review-and-fix cycles per GitHub-side reviewer, exiting early if a review returns 0 comments; `0` means "loop until that reviewer returns 0 comments" (legacy behavior, bounded by each loop's 10-iteration safety guardrail).
- If missing or not a non-negative integer, abort with: `--review-iterations must be a non-negative integer (got: {value}).`
- No effect on local-agent reviewers or `ollama`, which keep their own fixed caps; the per-entry `~max=<n>` suffix moves those and overrides this flag for the entry that carries it. The `capped` verdict (an explicitly configured cap reached after applying fixes, from either source) counts as clean-equivalent for the merge gate — see the merge section below.

Then apply any **saved defaults** (set via `/do:config`) to the flags the user did NOT pass — an explicit flag, or `--review-with none`, always overrides a saved default:

!`cat ~/.claude/lib/review-config-defaults.md`

## Select the Project Release Procedure

Before creating or changing branches, read the repository's `AGENTS.md` / `CLAUDE.md`,
`docs/RELEASING.md`, `RELEASING.md`, `docs/VERSIONING.md`, `CONTRIBUTING.md`, and
release automation configuration where present. **The documented project procedure
wins over the generic promotion recipe below.** A workflow's push trigger identifies
where publication starts, not necessarily the head of its release PR.

Choose exactly one execution path:

- **Documented project procedure** — when the project documents release preparation
  and publication, execute **Documented Release Delivery** below. This includes a
  temporary `release/vX.Y.Z` branch into `main`, tag-triggered publication, and
  tool-managed releases. Do not run the generic branch detection or its
  `target == source` guard first, and do not invent a permanent `release` branch.
- **Generic promotion** — when no project release procedure is documented, continue
  at **Detect Release Workflow**. Its source-to-target promotion recipe and self-PR
  guard apply only to this path.

Print the selected path and the documentation/configuration that establishes it.
If instructions conflict with live automation, investigate the concrete mismatch;
report INCOMPLETE with that evidence if it cannot be resolved. A documented
version-bump PR is supported, not a branch-topology error.

## Documented Release Delivery

This is an execution path, not a handoff: own preparation, review, publication,
and verification in this run. Preserve the parsed reviewer list, optional flags,
iteration caps, stop mode, and autonomous/interactive mode. Never invoke a bare
second release workflow that reloads saved reviewer defaults.

1. **Resolve the release contract without mutations.** Record the integration
   branch, PR head (if any), previous published version, version/notes owner,
   required test/build commands, publication trigger, and expected artifacts
   (tag, GitHub Release, package, deployment, or the documented subset). Derive
   `{GH_HOST}` and authenticate using the shared host snippet below before forge
   operations. A PR head must differ from its base; the integration branch may
   legitimately be both the development branch and publication trigger.
2. **Recover before preparing.** Fetch the relevant remote branches and inspect
   remote tags, published releases, and open/merged release PRs. Resume an existing
   prepared version or interrupted publication rather than bumping again or
   opening a duplicate PR. Confirm the version, head/base, commit, and notes agree.
   An already-merged preparation proceeds directly to publication verification;
   it does not need a new PR or another review. Never overwrite conflicting tags.
3. **Prepare in isolation.** For a documented version-bump PR, choose the version
   from unreleased commits (including breaking-change footers), then create or
   reuse an isolated worktree and the documented temporary branch from the freshly
   fetched integration ref. Keep the running application's checkout, branch, dirty
   files, and data untouched. Perform all edits, tests, commits, and pushes from
   that worktree. Follow project dependency setup rules; never install through
   symlinked dependencies. Follow the project's native version/notes command;
   when a release tool owns those outputs, let that tool produce them. The
   **Determine Version and Finalize Changelog** section supplies defaults only
   where the project has not specified them. Do not create a second version bump
   when recovering prepared state. Commit only the intended release files.
4. **Validate and review the release scope.** Run the documented tests/build,
   including isolated test-database provisioning where required. Resolve failures
   before delivery. Apply **Local Code Review** below to the full previous-release
   commit-to-prepared-head diff, replacing its promotion-only
   `git diff {target}...{source}` command with that range. A version-bump PR diff
   alone does not cover the release. Include the previous-tag comparison in the
   PR description. For a **PR workflow**, run the configured review loops from
   **Run the Review Loop** below after step 5 creates the PR and before step 6
   merges it, preserving their verdict and optionality rules from **Merge the
   PR**. For a **tool-managed or tag-only workflow** — which never creates a
   PR — run every configured **local-agent and Ollama** reviewer (`codex`,
   `agy`, `claude`, `grok`, `pi`, `cursor`, `opencode`, `ollama`) against this
   same prepared diff **before** step 5's submission command, enforcing their
   aggregate verdict exactly as **Merge the PR** would gate a merge; a
   configured `copilot` or `@<login>` reviewer has no PR to attach to on this
   path; a required (non-`~opt`) one is not requestable at all here, so report
   INCOMPLETE naming it rather than publishing ungated, while an `~opt` one is
   skipped. Those sections' promotion-specific delivery commands are replaced
   by steps 5–7 here.
5. **Publish the preparation.** For a PR workflow, push its head and read back the
   exact remote SHA, create or reuse the matching head/base PR, and read back its
   URL, head SHA, base, and state. For tool-managed or tag-only workflows, run the
   documented submission command — only once step 4's review gate is clean —
   and verify its equivalent remote preparation. Do not fabricate a PR for a
   process that does not use one. Empty, failed, or mismatched readback is
   INCOMPLETE; preserve the prepared state for retry.
6. **Deliver through the project's gates.** For an open PR, wait for the expected
   CI on the current head and satisfy the configured review gate before merging
   with a repository-supported method. No reported checks is not green when CI
   is expected: poll for up to five minutes, then report INCOMPLETE if none attach.
   Diagnose and fix red CI; never merge over a failure. Read back `state=MERGED`,
   `mergedAt`, and `mergeCommit`, fetch the integration branch, and verify it
   contains that merge commit. Squash/rebase merges need verification of the
   merged version and release-file contents, not ancestry of the pre-merge head.
7. **Verify publication, respecting its owner.** Watch the documented release
   pipeline for the merge/tag/dispatch being delivered and require success.
   **When automation creates the tag or release, wait for it; do not pre-create
   its tag using the generic Post-Merge commands.** That can make automation skip
   publication. Bound the wait (five minutes unless project docs specify another
   bound); a queued, failed, missing, or inconclusive pipeline is INCOMPLETE.
   Read back each required artifact: resolve the remote tag to a commit on the
   verified release lineage, check the GitHub Release's tag and published/non-draft
   status (and prerelease status appropriate to this release), and verify package
   version or deployment identity when documented. Recover a missing artifact
   only by the documented recovery procedure; never overwrite an existing tag or
   claim publication merely because the PR merged.
8. **Report and stop.** Report the version, preparation SHA, PR URL/merged SHA
   when applicable, integration SHA, and verified artifact URLs/identities. A
   documented no-release-needed result is valid. Otherwise identify the first
   unverified checkpoint as INCOMPLETE and preserve recoverable state. Clean up
   only the temporary resources created by this run after successful verification.
   **Do not fall through into the generic promotion workflow after this path.**

## Detect Release Workflow

Discover the project's source and target branches for releases; do NOT hardcode branch names:

1. **Source branch** — `gh repo view --json defaultBranchRef -q '.defaultBranchRef.name'` (typically `main`). While here, **derive the GitHub API host `{GH_HOST}` from the `origin` remote** with the shared snippet at the end of this section and forward it to the review loop — `gh api` (used by the GitHub-side reviewer loops) defaults to github.com rather than reading the remote, so on GitHub Enterprise those loops would silently poll the wrong host and time out. If `gh auth token --hostname "$GH_HOST"` fails, stop and tell the user to run `gh auth login --hostname $GH_HOST`.
2. **Target branch** — determine by reading (in priority order):
   - **GitHub Actions workflows** — check `.github/workflows/release.yml` (or similar) for `on: push: branches:` to find the branch that triggers the release pipeline
   - **Project conventions** (already in context) — git workflow sections, branch descriptions, or release instructions
   - **Versioning docs** — `docs/VERSIONING.md`, `CONTRIBUTING.md`, or `RELEASING.md`
   - **Branch convention** — if a `release` branch exists, the target is `release`; otherwise create it from the last release tag (step 3). In `--interactive` mode, ask the user to confirm
3. **Ensure the target branch exists** — if not, create it from the last release tag (or the root commit if no tags exist yet). Consult the remote, not just local refs: on a fresh clone `{target}` may exist only on the remote, and recreating it from the last tag would lose history and clobber the real release branch:
   ```bash
   git fetch origin "{target}:refs/remotes/origin/{target}" 2>/dev/null || true
   if ! git show-ref --verify --quiet refs/heads/{target} \
       && ! git show-ref --verify --quiet refs/remotes/origin/{target} \
       && [ -z "$(git ls-remote --heads origin {target})" ]; then
     git branch {target} $(git describe --tags --abbrev=0 2>/dev/null || git rev-list --max-parents=0 HEAD)
     git push -u origin {target}
   fi
   ```
4. **Detect GitHub Release publication** — set `{publishes_github_release}` to true only when the documented workflow or release instructions publish a GitHub Release (e.g. `gh release`, `softprops/action-gh-release`, or an equivalent action). Projects that publish only packages or tags have no GitHub Release checkpoint; their successful completion ends after the version-tag checkpoint.

Print the detected workflow: `Detected release flow: {source} → {target}`

**Default mode**: If ambiguous, use the most likely branch (prefer `release` if it exists). If detection still yields `target == source`, abort with an error — a release PR cannot merge a branch into itself. **Interactive mode (`--interactive`)**: Ask the user to confirm before proceeding.

The PR direction is `{source}` → `{target}` (e.g., `main` → `release`), so reviewers and the human approver see the full diff since the last release. Do NOT create a branch from source and PR back into it — that only shows the version bump commit.

**GitHub only** — the shared `{GH_HOST}` derivation step 1 refers to:

!`cat ~/.claude/lib/gh-host.md`

## Pre-Release Checks

1. **Ensure you're on the source branch** — checkout if needed
2. **Pull latest source** — `git pull --rebase --autostash`
3. **Pull latest target** — `git fetch origin {target} && (git show-ref --verify --quiet refs/heads/{target} && git checkout {target} || git checkout -b {target} --track origin/{target}) && git pull --rebase --autostash origin {target} && git checkout {source}` — so the local target matches `origin/{target}` before any diff or PR creation, even on a fresh clone where it exists only on the remote.
4. **Run tests** — execute the project's test suite (per project conventions already in context, or check package.json)
5. **Run build** — execute the project's build command if one exists

## Recover Prepared Release State

Before determining a new version, look for an existing release-preparation commit on the current source history; an interrupted run must resume the prepared version, not bump it again:

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
   - Scan commit messages (subject and body/footer) for conventional commit prefixes:
     - `breaking:`, any prefix with a `!` (e.g. `feat!:`, `fix!:`, `refactor!:`), or a `BREAKING CHANGE:` footer → **major** bump
     - `feat:` → **minor** bump
     - `fix:`, `build:`, `chore:`, `docs:`, `refactor:`, `perf:`, `style:`, `test:`, `ci:` → **patch** bump
   - Use the **highest applicable level** across all commits
   - **Default mode**: Use the determined version automatically. **Interactive mode (`--interactive`)**: Present the proposed version to the user for confirmation

2. **Bump version** with the project's native command. Node: `npm version <major|minor|patch> --no-git-tag-version` (updates `package.json` and `package-lock.json`). **Rust** has no stock command — probe in order: `cargo release version <level> --execute` if `cargo-release` is installed (`command -v cargo-release`; the bare form is a dry run), else `cargo set-version --bump <level>` if `cargo-edit` is installed (`command -v cargo-set-version`; its positional argument takes a concrete version, not a level keyword), else edit the `version = "x.y.z"` line in `Cargo.toml` directly and run `cargo update -p <package>` to refresh `Cargo.lock`. **Python**: `poetry version <level>` (Poetry projects), else edit `pyproject.toml` `[project] version = "..."`. **Elixir**: edit `mix.exs`. **Go**: edit a `VERSION` file. Other ecosystems: the equivalent, detected from the project files.

3. **Finalize changelog / build the release notes**:

   First **resolve how this project produces release notes**, in order:
   1. **Stated convention** — `CLAUDE.md` / `AGENT.md` / `AGENTS.md` / `CONTRIBUTING.md`, or a release workflow in `.github/workflows/`, describing the release-notes process. An explicit instruction wins over everything inferred below.
   2. **An existing release-automation tool** — `release-please`, `semantic-release`, `changesets`, `towncrier`, `git-cliff`, or similar, detected from its config file. **That tool owns the changelog**: run its documented command if the project expects you to; otherwise leave the changelog alone.
   3. **An existing file-based changelog** — a per-release directory (`.changelogs/`, `.changelog/`, `docs/releases/`) or a rolling `CHANGELOG.md`. Follow the shape already in the repo (the two branches below).
   4. **No file-based changelog at all** — build the release notes from the commits since the last release (below).

   **If the project stages unreleased entries in a file** (e.g. a `NEXT.md` alongside versioned files, or an `## Unreleased` section at the top of `CHANGELOG.md`) and that staging content exists:
     - Promote it to the release: rename `NEXT.md` → `v{new_version}.md` in a per-release directory, or retitle the `## Unreleased` section, whichever matches the repo
     - Replace the unreleased header with `# Release v{new_version}` (or the project's equivalent)
     - Add `Released: YYYY-MM-DD` with today's date
     - **Lead with a feature-grouped `## Highlights` summary** directly under the header/date, *above* the detailed `Added`/`Changed`/`Fixed` sections: **5–15 plain-language bullets grouped by theme/feature area** (e.g. "Editorial pipeline", "Local LLM", "Infra & deps"), each one sentence on *what changed and why it matters to a user*, with **no file paths and no inline `(#1234)` issue spam** (that detail stays in the sections below). For a tiny release that is already a clean feature list, Highlights is optional — don't pad it. The detailed entries below remain the authoritative record.
     - Add a `## Full Changelog` section with: `**Full Diff**: https://{GH_HOST}/{owner}/{repo}/compare/v{prev}...v{new}` — from the derived `{GH_HOST}`, never a literal `github.com` (404s on GitHub Enterprise)

   **If there is no staged unreleased content — or no file-based changelog at all — derive the notes from the commits since the last release** (the normal path for a repo whose history *is* its changelog):
     - Take the range since the last release tag (`git log {last_tag}..HEAD`, or the full history for a first release). Prefer merge-commit/PR titles over intermediate "address review" commits.
     - **Group by feature/theme, never a raw `git log` dump**, in the same `## Highlights` + detailed-sections shape: read each commit's subject *and body* for the user-visible effect, drop pure-noise commits (formatting, "fix typo", CI churn) or fold them into an `Internal` group, and write each bullet for someone deciding whether to upgrade — no file paths, no `(#1234)` spam.
     - Destination per the resolved convention: the project's per-release file (`{changelog_dir}/v{new_version}.md`), the top of a rolling `CHANGELOG.md` — **or nowhere on disk** if the project keeps no changelog file, in which case the notes become the release body (and the PR description) and no changelog file is created or staged.

   - **Mind the release-note size limit.** GitHub rejects a release body over **125,000 characters** (HTTP 422), and a multi-hundred-KB body passed to release automation as a command/env input can overflow `ARG_MAX` ("Argument list too long"). Publish the Highlights as the release body and link to the full changelog file at the tag; a pipeline that injects the whole changelog into the release body should feed it from a file (not argv/env) and truncate on a line boundary below the host's limit, appending that link.

4. **Commit the release**: Stage exactly the files step 2's bump command modified (Node: `package.json` and possibly `package-lock.json`; Rust: `Cargo.toml` and `Cargo.lock`; Python: `pyproject.toml`; etc.) plus the changelog file **if step 3 wrote one** — list files explicitly, never `git add -A`. Commit with message `chore: release v{new_version}`.

## Local Code Review (REQUIRED GATE)

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
  forge reports the exact same commit before creating or reusing a PR; empty,
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
- Body: the changelog content for this version if available, otherwise a summary of commits since last release; no co-author or "generated with" messages
- Do NOT bump the version for review fixes — it was already set during release preparation.

Record the printed `RELEASE_PREPARED_HANDOFF` and `RELEASE_PR_HANDOFF` lines and carry their literal `PREPARED_RELEASE_SHA`, `PR_NUMBER`, `PR_URL`, and `PR_STATE` values into the review and merge steps; shell variables do not survive separate tool calls.

## Run the Review Loop

If the selected PR already has `PR_STATE=MERGED`, skip this section entirely.
Do not request another review or treat an already-merged PR as an open merge
candidate; set `OVERALL_STATUS=clean` for the post-merge verification path.

**If `REVIEW_AGENTS` is empty**, skip this entire section — the Local Code Review gate plus the passing build/tests are the merge gate; set `OVERALL_STATUS=clean` (no-review path) and proceed to the merge section. The Copilot-specific and local-agent-specific merge checks below do not apply.

Otherwise, hand off to the **multi-reviewer loop** with the parsed inputs:

- `{REVIEW_AGENTS}` — the ordered, non-empty list from `--review-with`
- `{REVIEW_STOP_MODE}` — `all` (default) | `on-findings` | `on-clean`
- `{REVIEW_MODE}` — `series` (default) | `parallel`
- `{REVIEWER_APPLIES}` — boolean
- `{REVIEW_ITERATIONS}` — non-negative integer (default `1`); copilot iteration cap (`0` = loop until clean)
- `{GH_HOST}` — from "Detect Release Workflow", so the GitHub-side loops' `gh api` calls target the right host on GitHub Enterprise

Each pass uses the matching single-reviewer loop:

- `copilot` → Copilot cloud review loop (`lib/copilot-review-loop.md`)
- `@<login>` → GitHub-reviewer loop (`lib/github-reviewer-loop.md`), forwarding `{REVIEWER_LOGIN}`
- `codex` | `agy` | `claude` | `grok` | `pi` | `cursor` | `opencode` → local-agent headless review loop (`lib/local-agent-review-loop.md`)
- `ollama` → Ollama local-model review loop (`lib/ollama-review-loop.md`)

### Multi-reviewer wrapper

Read when `REVIEW_AGENTS` is non-empty:

!read lib/multi-reviewer-loop.md

### Inner loop bodies (referenced by the wrapper)

Read only the bodies for reviewer kinds present in the agent list.

Only for `copilot` entries:

!read lib/copilot-review-loop.md

Only for `@<login>` entries:

!read lib/github-reviewer-loop.md

Only for an entry that is none of `copilot`, `ollama`, or `@<login>` (every other slug — the fixed CLIs and `cmd[<invocation>]` alike — dispatches through this one loop; a future addition needs no new gate here):

!read lib/local-agent-review-loop.md

Only for `ollama` entries:

!read lib/ollama-review-loop.md

### CI flake handling (referenced by the merge gate)

Only when the in-session merge gate sees a required check fail:

!read lib/ci-flake-handling.md

## Merge the PR (only after a CLEAN multi-reviewer result)

If `PR_STATE=MERGED`, skip all review-verdict and CI/merge gates in this section and continue directly to Checkpoint 3's remote read-back.

The merge gate consumes the **wrapper's `{OVERALL_STATUS}`** plus, for any copilot pass that ran, the copilot post-pass checks.

### Wrapper status

- `clean` — every executed pass returned `clean` (copilot `too-large` and `capped` from any of the four loops count as clean; `capped` means an **explicitly configured** cap — the default `--review-iterations 1` on a GitHub-side pass, or a per-entry `~max=<n>` — was reached after applying every fix, whereas a *built-in* cap cutting off a still-productive loop is `guardrail`, inconclusive below), **or** no external reviewer was requested and the no-review path set `OVERALL_STATUS=clean`. **Eligible to merge.**
- `partial` — the wrapper stopped early because of an explicit stop-mode flag (`--review-stop-on-findings` or `--review-stop-on-clean`) and the executed passes all completed normally. **Eligible to merge** — the user opted into the short-circuit.
- `inconclusive` — **at least one** executed pass was inconclusive (`timeout`, `error`, `guardrail`, `skipped`, `not-requestable` — an `@<login>` whose request failed — `no-verdict` — a local agent that did not answer in the verdict format — ollama `incomplete` — a partially-reviewed diff — or `push-failed`, a pass whose fix commits never reached the remote, which counts here even on an `~opt` pass), regardless of other passes. **Do NOT merge** — a requested perspective never produced a verdict.
- `dirty` — a pass returned a hard-error status (`cli-error`, `broken-build`, `test-failed`, `rejected`) and the wrapper short-circuited. **Do NOT merge.**

For `dirty` or `inconclusive`:
- **Default mode**: leave the PR open and report the proximate status so the user can review manually.
- **Interactive mode (`--interactive`)**: ask the user whether to merge anyway, re-run a specific reviewer, or leave open.

### Copilot-specific checks (when copilot was in the executed list)

- Do NOT merge until the copilot pass returned a verdict status; a missing review is not a clean review. The required verdict depends on `{REVIEW_ITERATIONS}`:
  - **Default bounded mode (`--review-iterations` ≥ 1)**: `capped` — the configured cap was reached after applying every fix the review surfaced. Merge **without** a confirming zero-comment re-review.
  - **Unlimited mode (`--review-iterations 0`)**: `clean` — the latest Copilot review was submitted AND generated **zero comments**: (1) a new review node exists with `submittedAt` after your last push; (2) its body says "generated 0 comments" OR there are no new unresolved threads. A fixed-but-not-re-reviewed pass is not eligible here (in the bounded default it is the expected `capped` outcome and IS eligible).
- **Exception — too-large**: if the Copilot review body says the PR exceeds the maximum number of lines (20 000), treat it as a clean review and merge immediately. Do NOT re-request.
- **Never merge if** no Copilot review was ever posted (ask user first) or "Awaiting requested review" is still shown.

### Local-agent-specific checks (when codex/agy/claude/grok/cursor/opencode was in the executed list)

- The local-agent loop already verified build and tests before pushing; its `clean` status in the wrapper table means every iteration of that pass passed verification, and no separate review-comment count is required.

### Merging (after all checks above pass)

If `PR_STATE=MERGED`, skip the CI gate and merge command below and continue
directly to **Checkpoint 3**, so an interrupted rerun can recover from a merge
that already succeeded remotely. Otherwise:

- **Gate on required CI first.** Watch the target branch's required checks in-session before merging: `gh pr checks <number> --required --watch --fail-fast`. (No required checks ⇒ the gate is vacuously satisfied — merge directly.)
  - On a required-check **failure**, apply the **CI flake handling** routine — one conservative re-run on the same commit (see `~/.claude/lib/ci-flake-handling.md`, inlined above). If the same SHA passes on the re-run, treat it as a flake and proceed (logging which check flaked); if it fails again, **abort the release merge** and report which check failed.
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
  command's exit status: read back all three remote fields and require a merged
  state, a non-empty merge timestamp, and a non-empty merge commit. Empty,
  malformed, timed-out, queued, or otherwise inconclusive output is incomplete;
  name `Merged release PR` as the first unverified checkpoint and preserve the
  prepared state. Run the Checkpoint 3 through Checkpoint 6 blocks with a command
  timeout of at least 600 seconds and as one shell invocation, substituting the
  carried preparation SHA and PR number for `<prepared-release-sha>` and
  `<number>`.
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
   ref is a real commit whose tree contains the merged release commit (PR state
   alone would miss a queued or incomplete target update). If any command is
   empty, malformed, timed out, or fails, report `Target branch tree` as the first
   unverified checkpoint and do not create or reuse a tag. Checkpoints 3–6 run as
   one shell invocation:
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
   GitHub Release; a local prepared commit, a merge command's exit status, or a
   pushed tag is never sufficient on its own. Only then switch back locally:
   `git checkout {source} && git pull --rebase --autostash`.
