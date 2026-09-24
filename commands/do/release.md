---
description: Create a release PR using the project's documented release workflow
argument-hint: "[--interactive] [--review-with <agent>[,<agent>...]] [--review-iterations <n>] [--review-mode <series|parallel>] [--review-stop-on-findings|--review-stop-on-clean] [--reviewer-applies]"
---

**Default mode: fully autonomous** — detects branches, determines the version bump from commits, runs review, creates and merges the release PR without prompting. **`--interactive`** pauses for branch confirmation, version approval, and merge confirmation.

## Parse Arguments

!`cat ~/.claude/lib/review-flags.md`

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

Only load and execute this section when **Select the Project Release Procedure**
above chose the documented project procedure path; the generic promotion path
skips straight to **Detect Release Workflow** and never needs this content.

!read lib/release-documented.md

## Detect Release Workflow

**Detect the code host first.** The shared preflight selects the forge from the
`origin` remote, confirms the selected CLI can read this checkout, rejects
unsupported forges, and derives `{CR_NOUN}` (`PR` on GitHub, `MR` on GitLab)
for every message below:

!read lib/vcs-host.md

Discover the project's source and target branches for releases; do NOT hardcode branch names:

1. **Source branch**:
   - GitHub: `gh repo view --json defaultBranchRef -q '.defaultBranchRef.name'` (typically `main`). While here, **derive the GitHub API host `{GH_HOST}` from the `origin` remote** with the shared snippet at the end of this section and forward it to the review loop — `gh api` (used by the GitHub-side reviewer loops) defaults to github.com rather than reading the remote, so on GitHub Enterprise those loops would silently poll the wrong host and time out. If `gh auth token --hostname "$GH_HOST"` fails, stop and tell the user to run `gh auth login --hostname $GH_HOST`.
   - GitLab: `glab api "projects/:id" --jq .default_branch` (typically `main`). GitLab needs no separate API-host derivation for `glab` calls — it already resolves the host from `origin`, and the GitLab-side reviewer loop (`host-gitlab.md`) never needs `{GH_HOST}`. A plain host string is still needed for URLs this file builds itself (e.g. the changelog's compare link): use `{ORIGIN_HOST}`, already resolved by `lib/vcs-host.md` above — never re-derive it with a second copy of that parse.
2. **Target branch** — determine by reading (in priority order):
   - **Release pipeline config** — GitHub: check `.github/workflows/release.yml` (or similar) for `on: push: branches:` to find the branch that triggers the release pipeline. GitLab: check `.gitlab-ci.yml` (and any included files) for a release/publish job's `rules`/`only: refs:` to find the equivalent trigger branch.
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
4. **Detect release publication** — set `{publishes_github_release}` to true only when the documented workflow or release instructions publish a host release object (GitHub Release: `gh release`, `softprops/action-gh-release`, or an equivalent action; GitLab Release: `glab release create`, `release-cli`, or the CI/CD `release:` keyword — checked with `glab release view` below). The flag name is unchanged from the GitHub-only history of this file, but it now gates either host's release-publication checkpoint. Projects that publish only packages or tags have no release-object checkpoint; their successful completion ends after the version-tag checkpoint.

Print the detected workflow: `Detected release flow: {source} → {target}`

**Default mode**: If ambiguous, use the most likely branch (prefer `release` if it exists). If detection still yields `target == source`, abort with an error — a release PR cannot merge a branch into itself. **Interactive mode (`--interactive`)**: Ask the user to confirm before proceeding.

The {CR_NOUN} direction is `{source}` → `{target}` (e.g., `main` → `release`), so reviewers and the human approver see the full diff since the last release. Do NOT create a branch from source and {CR_NOUN} back into it — that only shows the version bump commit.

**GitHub only** — the shared `{GH_HOST}` derivation in step 1 refers to:

!`cat ~/.claude/lib/gh-host.md`

## Pre-Release Checks

1. **Ensure you're on the source branch** — checkout if needed
2. **Pull latest source** — `git pull --rebase --autostash`
3. **Pull latest target** — `git fetch origin {target} && (git show-ref --verify --quiet refs/heads/{target} && git checkout {target} || git checkout -b {target} --track origin/{target}) && git pull --rebase --autostash origin {target} && git checkout {source}` — so the local target matches `origin/{target}` before any diff or PR creation, even on a fresh clone where it exists only on the remote.
4. **Run tests** — execute the project's test suite (per project conventions already in context, or check package.json)
5. **Run build** — execute the project's build command if one exists

## Recover Prepared Release State

Before determining a new version, look for an existing release-preparation commit on the current source history; an interrupted run must resume the prepared version, not bump it again. This block also defines the shared checkpoint helpers reused by the merged checkpoint blocks below — **redefine them at the top of any other block that calls them**, since shell state does not persist across separate tool invocations:

```bash
incomplete() {
  echo "INCOMPLETE — $1 is unverified; $2 Preserve the prepared release state and retry."
  exit 1
}
prepared_release_sha() {
  git log --format='%H%x09%s' "$1" | awk -F '\t' '$2 ~ /^chore: release v[0-9]+\.[0-9]+\.[0-9]+$/ { print; exit }'
}

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
  incomplete "Prepared release state" "origin/{target} could not be resolved."
fi
PREPARED_RELEASE="$(prepared_release_sha "origin/{target}..HEAD")"
TARGET_PREPARED_RELEASE="$(prepared_release_sha "origin/{target}")"
if [ -z "$PREPARED_RELEASE" ] && [ -n "$TARGET_PREPARED_RELEASE" ]; then
  TARGET_VERSION="$(printf '%s\n' "$TARGET_PREPARED_RELEASE" | sed -E 's/.*release v//')"
  TARGET_TAG="$(git ls-remote origin "refs/tags/v${TARGET_VERSION}^{}" | awk 'NF { print $1; exit }')"
  if ! printf '%s\n' "$TARGET_TAG" | grep -Eq '^[0-9a-f]{40}$'; then
    TARGET_TAG="$(git ls-remote origin "refs/tags/v${TARGET_VERSION}" | awk 'NF { print $1; exit }')"
  fi
  if [ "$CLI_TOOL" = gh ]; then
    TARGET_RELEASE_STATUS="$(gh api --include --hostname "{GH_HOST}" "repos/{owner}/{repo}/releases/tags/v${TARGET_VERSION}" 2>/dev/null | awk '$1 ~ /^HTTP\// { print $2; exit }' || true)"
    case "$TARGET_RELEASE_STATUS" in
      200)
        TARGET_RELEASE_JSON="$(gh release view "v${TARGET_VERSION}" --json isDraft,isPrerelease,publishedAt 2>/dev/null)" || incomplete "Prepared release state" "GitHub Release metadata could not be read."
        ;;
      404) TARGET_RELEASE_JSON="" ;;
      *)
        incomplete "Prepared release state" "GitHub Release lookup returned ${TARGET_RELEASE_STATUS:-empty}."
        ;;
    esac
  else
    # GitLab: `glab release view` (per #414/#415's spec) has no separate HTTP-status
    # probe; fold "not found" into an empty $TARGET_RELEASE_JSON and let the jq
    # gate below fail closed on any other unreadable/malformed response.
    TARGET_RELEASE_ERR="$(mktemp)"
    if TARGET_RELEASE_JSON="$(glab release view "v${TARGET_VERSION}" -F json 2>"$TARGET_RELEASE_ERR")"; then
      :
    elif grep -qi '404\|not found' "$TARGET_RELEASE_ERR"; then
      TARGET_RELEASE_JSON=""
    else
      incomplete "Prepared release state" "GitLab Release lookup failed: $(cat "$TARGET_RELEASE_ERR")."
    fi
    rm -f "$TARGET_RELEASE_ERR"
    # GitLab releases have no draft state; map its fields onto the same shape
    # the jq gate below expects (isDraft always false, isPrerelease from
    # `upcoming_release`, publishedAt from `released_at`).
    if [ -n "$TARGET_RELEASE_JSON" ]; then
      TARGET_RELEASE_JSON="$(printf '%s' "$TARGET_RELEASE_JSON" | jq '{isDraft: false, isPrerelease: (.upcoming_release // false), publishedAt: .released_at}')"
    fi
  fi
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
    if [ "$CLI_TOOL" = gh ]; then
      TARGET_RELEASE_PRS_JSON="$(gh pr list --state merged --base "{target}" --limit 100 --json number,state,headRefOid,baseRefName,headRefName,url,mergedAt,mergeCommit)" || incomplete "Merged release PR" "the forge query failed."
      if ! printf '%s\n' "$TARGET_RELEASE_PRS_JSON" | jq -e 'type == "array"' >/dev/null; then
        incomplete "Merged release PR" "the forge returned empty or malformed data."
      fi
      MATCHING_TARGET_RELEASE_PRS="$(printf '%s\n' "$TARGET_RELEASE_PRS_JSON" | jq -c --arg sha "$PREPARED_RELEASE_SHA" --arg source "{source}" '[.[] | select(.headRefOid == $sha and .baseRefName == "{target}" and .headRefName == $source)]')"
    else
      # GitLab: `glab mr list` has no --head/--base filter pair as precise as gh's,
      # so pull merged MRs into `{target}` and filter on source/target/SHA in jq,
      # same shape as the GitHub branch above.
      TARGET_RELEASE_PRS_JSON="$(glab api --paginate "projects/:id/merge_requests?state=merged&target_branch={target}&per_page=100" | jq -s 'add // []' \
        | jq '[.[] | {number: .iid, state: (.state | ascii_upcase), headRefOid: .sha, baseRefName: .target_branch, headRefName: .source_branch, url: .web_url, mergedAt: .merged_at, mergeCommit: {oid: .merge_commit_sha}}]')" \
        || incomplete "Merged release MR" "the forge query failed."
      if ! printf '%s\n' "$TARGET_RELEASE_PRS_JSON" | jq -e 'type == "array"' >/dev/null; then
        incomplete "Merged release MR" "the forge returned empty or malformed data."
      fi
      MATCHING_TARGET_RELEASE_PRS="$(printf '%s\n' "$TARGET_RELEASE_PRS_JSON" | jq -c --arg sha "$PREPARED_RELEASE_SHA" --arg source "{source}" '[.[] | select(.headRefOid == $sha and .baseRefName == "{target}" and .headRefName == $source)]')"
    fi
    MATCHING_TARGET_RELEASE_COUNT="$(printf '%s\n' "$MATCHING_TARGET_RELEASE_PRS" | jq 'length')"
    if [ "$MATCHING_TARGET_RELEASE_COUNT" -ne 1 ]; then
      incomplete "Merged release {CR_NOUN}" "expected exactly one merged {CR_NOUN} for prepared SHA $PREPARED_RELEASE_SHA, found $MATCHING_TARGET_RELEASE_COUNT."
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
     - `breaking:`, any prefix with a `!` (e.g. `feat!:`, `fix!:`, `refactor!:`, `feat!(scope):`), or a `BREAKING CHANGE:` footer → **major** bump
     - `feat:` or `feat(scope):` → **minor** bump
     - `fix:`, `build:`, `chore:`, `docs:`, `refactor:`, `perf:`, `style:`, `test:`, `ci:` (with or without scope) → **patch** bump
     - `revert:` → **patch** bump
     - Commits with no recognized prefix or `address review …` commits: classify by the PR title using `gh pr list --state merged --search <sha>`, or default to **patch** bump. (These commits are part of the PR whose merge-commit title classifies the change.)
   - Use the **highest applicable level** across all commits
   - **Default mode**: Use the determined version automatically. **Interactive mode (`--interactive`)**: Present the proposed version to the user for confirmation

2. **Bump version** with the project's native command. Node: `npm version <major|minor|patch> --no-git-tag-version` (updates `package.json` and `package-lock.json`). **Rust**: `cargo set-version --bump <level>` or edit `Cargo.toml` + `cargo update -p <package>`. **Python**: `poetry version <level>` (Poetry projects), else edit `pyproject.toml` `[project] version = "..."`. **Elixir**: edit `mix.exs`. **Go**: edit a `VERSION` file. Other ecosystems: the equivalent, detected from the project files.

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
     - Add a `## Full Changelog` section with the diff link built from the resolved host, never a literal `github.com` (404s on GitHub Enterprise) or `gitlab.com` (404s on self-managed GitLab):
       - GitHub: `**Full Diff**: https://{GH_HOST}/{owner}/{repo}/compare/v{prev}...v{new}`
       - GitLab: `**Full Diff**: https://{ORIGIN_HOST}/{owner}/{repo}/-/compare/v{prev}...v{new}` (GitLab's compare path has a `/-/` segment before `compare`; `{ORIGIN_HOST}` is the same value `lib/vcs-host.md` resolved in "Detect Release Workflow")

   **If there is no staged unreleased content — or no file-based changelog at all — derive the notes from the commits since the last release** (the normal path for a repo whose history *is* its changelog):
     - Take the range since the last release tag (`git log {last_tag}..HEAD`, or the full history for a first release). Prefer merge-commit/PR titles over intermediate "address review" commits.
     - **Group by feature/theme, never a raw `git log` dump**, in the same `## Highlights` + detailed-sections shape: read each commit's subject *and body* for the user-visible effect, drop pure-noise commits (formatting, "fix typo", CI churn) or fold them into an `Internal` group, and write each bullet for someone deciding whether to upgrade — no file paths, no `(#1234)` spam.
     - Destination per the resolved convention: the project's per-release file (`{changelog_dir}/v{new_version}.md`), the top of a rolling `CHANGELOG.md` — **or nowhere on disk** if the project keeps no changelog file, in which case the notes become the release body (and the PR description) and no changelog file is created or staged.

   - **Mind the release-note size limit.** If the body would exceed **125,000 characters**, publish the Highlights as the release body and link to the full changelog file at the tag.

4. **Commit the release**: Stage exactly the files step 2's bump command modified (Node: `package.json` and possibly `package-lock.json`; Rust: `Cargo.toml` and `Cargo.lock`; Python: `pyproject.toml`; etc.) plus the changelog file **if step 3 wrote one** — list files explicitly, never `git add -A`. Commit with message `chore: release v{new_version}`.

## Local Code Review (REQUIRED GATE)

<review_gate>

1. Read all commit messages since last release to understand the scope
2. Run `git diff --name-only {target}...{source}` to get the list of changed files
3. For every changed file:
   a. Read the entire file using the Read tool (not just diff hunks)
   b. Review it under the review preferences. Load them now, the first time this step runs:
      !read lib/review-preferences.md
   c. For each finding, quote the specific code line and explain why it's a problem
4. After reviewing all files, verify: does the aggregate change set deliver what the release claims?
5. Print a review summary table (`| File | Tier | Finding | Severity | Status |`)
6. Fix any issues, run tests, verify tests cover the changed code paths, commit and push
7. Only after printing the review summary may you proceed to "Open the Release PR"

If the diff touches more than 15 files, delegate later batches to a subagent to keep context clean.

</review_gate>

Verification — self-check before proceeding (no user prompt needed):
- [ ] Read every changed file in full (not just diffs)
- [ ] Every finding names a concrete wrong outcome, not a style preference
- [ ] Quoted specific code for each finding
- [ ] Printed a review summary table with findings

## Open the Release PR

When `TARGET_RECOVERY=true`, use the carried `RELEASE_TARGET_HANDOFF` instead of
running Checkpoints 1–2; the already-merged PR is the release PR for this retry.
Continue with Checkpoint 3 and the post-merge verification blocks below.

- **Checkpoint 1 — source push.** Push the prepared source commit and verify the
  forge reports the exact same commit before creating or reusing a PR; empty,
  malformed, or mismatched output is an incomplete release and must name
  `Source push` as the first unverified checkpoint.
- **Checkpoint 2 — release PR.** Query all matching PRs for the current source SHA
  before creating one. Reuse an open PR, or a merged PR whose head is still this
  source SHA when an interrupted rerun already completed it; never create a
  duplicate. Missing, empty, malformed, or ambiguous forge output is incomplete
  and must name `Release PR` as the first unverified checkpoint. A closed,
  unmerged PR is not reusable, so a later run may create a new PR for the newly
  pushed source SHA. Checkpoints 1 and 2 run as **one** shell invocation — the
  push is verified once, then reused to query or create the PR:
  ```bash
  incomplete() {
    echo "INCOMPLETE — $1 is unverified; $2 Preserve the prepared release state and retry."
    exit 1
  }
  prepared_release_sha() {
    git log --format='%H%x09%s' "$1" | awk -F '\t' '$2 ~ /^chore: release v[0-9]+\.[0-9]+\.[0-9]+$/ { print; exit }'
  }

  git push -u origin "HEAD:refs/heads/{source}"
  SOURCE_SHA="$(git rev-parse HEAD)"
  PREPARED_RELEASE_SHA="$(prepared_release_sha HEAD | cut -f1)"
  if ! printf '%s\n' "$PREPARED_RELEASE_SHA" | grep -Eq '^[0-9a-f]{40}$'; then
    incomplete "Prepared release state" "the release preparation commit could not be identified."
  fi
  REMOTE_SOURCE_SHA="$(git ls-remote --heads origin "refs/heads/{source}" | awk 'NF { print $1; exit }')"
  if ! printf '%s\n' "$REMOTE_SOURCE_SHA" | grep -Eq '^[0-9a-f]{40}$' || [ "$REMOTE_SOURCE_SHA" != "$SOURCE_SHA" ]; then
    incomplete "Source push" "expected $SOURCE_SHA, got ${REMOTE_SOURCE_SHA:-empty}."
  fi
  if [ "$CLI_TOOL" = gh ]; then
    RELEASE_PRS_JSON="$(gh pr list --state all --base "{target}" --head "{source}" --limit 100 \
      --json number,state,headRefOid,baseRefName,headRefName,url,createdAt)" || incomplete "Release PR" "the forge query failed."
  else
    # GitLab: `glab mr list` has no combined source+target filter as precise as
    # gh's, so query the REST endpoint directly and reshape onto the same field
    # names the jq below already expects.
    RELEASE_PRS_JSON="$(glab api --paginate "projects/:id/merge_requests?source_branch={source}&target_branch={target}&state=all&per_page=100" | jq -s 'add // []' \
      | jq '[.[] | {number: .iid, state: (.state | ascii_upcase), headRefOid: .sha, baseRefName: .target_branch, headRefName: .source_branch, url: .web_url, createdAt: .created_at}]')" \
      || incomplete "Release MR" "the forge query failed."
  fi
  if ! printf '%s\n' "$RELEASE_PRS_JSON" | jq -e 'type == "array"' >/dev/null; then
    incomplete "Release {CR_NOUN}" "the forge returned empty or malformed data."
  fi
  MATCHING_RELEASE_PRS="$(printf '%s\n' "$RELEASE_PRS_JSON" | jq -c --arg sha "$SOURCE_SHA" \
    '[.[] | select(.headRefOid == $sha and (.state == "OPEN" or .state == "MERGED"))]')"
  MATCHING_COUNT="$(printf '%s\n' "$MATCHING_RELEASE_PRS" | jq 'length')"
  if [ "$MATCHING_COUNT" -gt 1 ]; then
    incomplete "Release {CR_NOUN}" "more than one open or merged {CR_NOUN} matches $SOURCE_SHA; investigate the ambiguity."
  elif [ "$MATCHING_COUNT" -eq 1 ]; then
    PR_NUMBER="$(printf '%s\n' "$MATCHING_RELEASE_PRS" | jq -r '.[0].number')"
    PR_URL="$(printf '%s\n' "$MATCHING_RELEASE_PRS" | jq -r '.[0].url')"
    PR_STATE="$(printf '%s\n' "$MATCHING_RELEASE_PRS" | jq -r '.[0].state')"
  else
    if [ "$CLI_TOOL" = gh ]; then
      PR_URL="$(gh pr create --title "Release v{version}" --base "{target}" --head "{source}" --body "...")" || incomplete "Release PR" "creation failed; retry without creating another PR."
    else
      PR_URL="$(glab mr create --source-branch "{source}" --target-branch "{target}" --title "Release v{version}" --description "..." --yes)" || incomplete "Release MR" "creation failed; retry without creating another MR."
    fi
    PR_NUMBER="${PR_URL##*/}"
    if ! printf '%s\n' "$PR_NUMBER" | grep -Eq '^[0-9]+$'; then
      incomplete "Release {CR_NOUN}" "creation returned empty or malformed data."
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

**If `REVIEW_AGENTS` is empty**, skip this entire section — the Local Code Review gate plus the passing build/tests are the merge gate; set `OVERALL_STATUS=clean` (no-review path) and proceed to the merge section.

Otherwise, hand off to the **multi-reviewer loop** with the inputs resolved in "Parse Arguments" (`{REVIEW_AGENTS}`, `{REVIEW_STOP_MODE}`, `{REVIEW_MODE}`, `{REVIEWER_APPLIES}`, `{REVIEW_ITERATIONS}`, `{REVIEW_MODELS}`) plus `{GH_HOST}` from "Detect Release Workflow" and the per-entry `{WAIT_SCHEDULE}` selected below. The GitHub-side loops use `{GH_HOST}` on every `gh api` call, and the wrapper dispatches each entry to the single-reviewer loop read below.

For each host-side entry, resolve the caller-owned `{WAIT_SCHEDULE}` before dispatch:

- `copilot` — use the previous Copilot review duration on this PR (default 60 seconds if none); max wait 3x that duration, minimum 90 seconds, maximum 5 minutes; poll every 5s, 5s, 10s, 10s, then 15s.
- `@<login>` — expected duration 5 minutes; max wait 3x that duration, minimum 3 minutes, maximum 15 minutes; poll every 10s, 10s, 20s, 20s, then 30s.

Forward only the selected schedule as `{WAIT_SCHEDULE}`; never give one pass both schedules.

### Multi-reviewer wrapper

Read when `REVIEW_AGENTS` is non-empty:

!read lib/multi-reviewer-loop.md

### Inner loop bodies (referenced by the wrapper)

Read only the bodies for reviewer kinds present in the agent list.

For every `copilot` or `@<login>` entry, read the shared host-reviewer template (its sub-agent runs the `{CODE_HOST}` verb file):

!read lib/host-reviewer-loop.md

Only for `copilot` entries on GitHub, also read the Copilot delta:

!read lib/copilot-review-loop.md

Only for an entry that is none of `copilot`, `ollama`, or `@<login>` (every other slug — the fixed CLIs and `cmd[<invocation>]` alike — dispatches through this one loop; a future addition needs no new gate here):

!read lib/local-agent-review-loop.md

Only for `ollama` entries:

!read lib/ollama-review-loop.md

### CI flake handling (referenced by the merge gate)

Only when the in-session merge gate sees a required check fail:

!read lib/ci-flake-handling.md

## Merge the PR (only after a CLEAN multi-reviewer result)

If `PR_STATE=MERGED`, skip all review-verdict and CI/merge gates in this section and continue directly to Checkpoint 3's remote read-back.

Merge only when the wrapper's `{OVERALL_STATUS}` is `clean`, or `partial` with an explicit `--review-stop-on-findings`/`--review-stop-on-clean` flag. The wrapper and the inner loops own what each status means — `~opt` exclusion, `push-failed`, copilot `too-large`, `capped` vs `guardrail` — so apply its verdict as-is rather than re-deriving it from the per-pass table. For `inconclusive` or `dirty`:
- **Default mode**: leave the PR open and report the proximate status so the user can review manually.
- **Interactive mode (`--interactive`)**: ask the user whether to merge anyway, re-run a specific reviewer, or leave open.

### Merging

If `PR_STATE=MERGED`, skip the CI gate and merge command below and continue
directly to **Checkpoint 3**, so an interrupted rerun can recover from a merge
that already succeeded remotely. Otherwise:

- **Gate on required CI first, following the same rule as step 6 above.**
  - **GitHub** (`ci-status` verb, `host-github.md`) — check once, without watching: `gh pr checks <number> --required`. If the output matches `no (required )?checks reported`, that is not automatically green: when a workflow is configured to run on PRs into `{target}`, poll for up to five minutes for a required check to attach (re-running the same command), then report INCOMPLETE if none does; when no such workflow exists for `{target}`, the gate is vacuously satisfied — merge directly. Once at least one required check is reported, watch it in-session: `gh pr checks <number> --required --watch --fail-fast`.
  - **GitLab** (`ci-status` verb, `host-gitlab.md`) — GitLab has no separate list of required checks; the project's pipeline-must-succeed setting applies instead. Watch the head pipeline in-session: `glab ci status --wait --branch {source}`. If it reports no pipeline at all for `{source}`, poll for up to five minutes for one to attach, then report INCOMPLETE if none does.
  - On a required-check/pipeline **failure**, apply the **CI flake handling** routine — one conservative re-run on the same commit (see **CI flake handling** above). If the same SHA passes on the re-run, treat it as a flake and proceed (logging which check flaked); if it fails again, **abort the release merge** and report which check failed.
- Once confirmed clean, merge (the `merge` verb — GitHub reads the PR state and merges directly since a release PR is never squashed/rebased away from its exact head; GitLab has no separate list-required-checks step, so the pipeline wait above is its whole gate):
  ```bash
  PR_NUMBER="<number>"
  if [ "$CLI_TOOL" = gh ]; then
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
  else
    CURRENT_PR_STATE="$(glab mr view "$PR_NUMBER" --output json --jq .state)" || {
      echo "INCOMPLETE — Merged release MR is unverified; the forge state query failed. Preserve the prepared release state and retry."
      exit 1
    }
    if [ "$CURRENT_PR_STATE" = "opened" ]; then
      glab mr merge "$PR_NUMBER" --yes
    elif [ "$CURRENT_PR_STATE" != "merged" ]; then
      echo "INCOMPLETE — Merged release MR is unverified; expected opened or merged, got ${CURRENT_PR_STATE:-empty}. Preserve the prepared release state and retry."
      exit 1
    fi
  fi
  ```
- **Checkpoint 3 — merged release PR.** Do not infer completion from the merge
  command's exit status: read back all three remote fields and require a merged
  state, a non-empty merge timestamp, and a non-empty merge commit. Empty,
  malformed, timed-out, queued, or otherwise inconclusive output is incomplete;
  name `Merged release PR` as the first unverified checkpoint and preserve the
  prepared state. Checkpoints 3 through 6 run as **one** shell invocation — the
  single fenced block under **Post-Merge** below — with a command timeout of at
  least 600 seconds, substituting the carried preparation SHA and PR number for
  `<prepared-release-sha>` and `<number>`.

## Post-Merge

1. **Checkpoints 3–6 — merged remote verification.** Read back the merged PR
   (Checkpoint 3), then fetch the target and verify its remote ref is a real
   commit whose tree contains the merged release commit (Checkpoint 4 — PR
   state alone would miss a queued or incomplete target update), then publish
   or verify the version tag (Checkpoint 5) and, when documented, the GitHub
   Release (Checkpoint 6). If any command is empty, malformed, timed out, or
   fails, report the first unverified checkpoint by name and do not create or
   reuse a tag. Checkpoints 3–6 run as **one** shell invocation with a command
   timeout of at least 600 seconds:
   ```bash
   incomplete() {
     echo "INCOMPLETE — $1 is unverified; $2 Preserve the prepared release state and retry."
     exit 1
   }
   remote_tag_commit() {
     local sha
     sha="$(git ls-remote origin "refs/tags/v{version}^{}" | awk 'NF { print $1; exit }')"
     if ! printf '%s\n' "$sha" | grep -Eq '^[0-9a-f]{40}$'; then
       sha="$(git ls-remote origin "refs/tags/v{version}" | awk 'NF { print $1; exit }')"
     fi
     printf '%s\n' "$sha"
   }
   release_published_json() {
     if [ "$CLI_TOOL" = gh ]; then
       gh release view "v{version}" --json tagName,isDraft,isPrerelease,publishedAt 2>/dev/null
     else
       # `glab release view` (per #414/#415's spec) has no draft state, so map
       # onto the same {tagName,isDraft,isPrerelease,publishedAt} shape the
       # shared release_is_published gate below expects: isDraft is always
       # false, isPrerelease comes from `upcoming_release`, publishedAt from
       # `released_at`.
       glab release view "v{version}" -F json 2>/dev/null \
         | jq '{tagName: .tag_name, isDraft: false, isPrerelease: (.upcoming_release // false), publishedAt: .released_at}'
     fi
   }
   release_is_published() {
     printf '%s\n' "$1" | jq -e \
       'type == "object" and .tagName == "v{version}" and .isDraft == false and .isPrerelease == false and (.publishedAt | type == "string") and (.publishedAt | length > 0)' >/dev/null 2>&1
   }

   PREPARED_RELEASE_SHA="<prepared-release-sha>"
   PR_NUMBER="<number>"
   if [ "<target-recovery>" = "true" ]; then
     SOURCE_SHA="$PREPARED_RELEASE_SHA"
   else
     SOURCE_SHA="$(git rev-parse HEAD)"
   fi

   # Checkpoint 3 — merged release PR/MR.
   if [ "$CLI_TOOL" = gh ]; then
     MERGE_JSON="$(gh pr view "$PR_NUMBER" --json state,mergedAt,mergeCommit)" || incomplete "Merged release PR" "the forge query failed."
   else
     # GitLab has no separate mergedAt field distinct from the merge commit's
     # presence; reshape onto the same {state,mergedAt,mergeCommit.oid} the
     # shared jq gate below expects.
     MERGE_JSON="$(glab api "projects/:id/merge_requests/$PR_NUMBER" \
       | jq '{state: (if .state == "merged" then "MERGED" else (.state | ascii_upcase) end), mergedAt: .merged_at, mergeCommit: {oid: .merge_commit_sha}}')" \
       || incomplete "Merged release MR" "the forge query failed."
   fi
   if ! printf '%s\n' "$MERGE_JSON" | jq -e \
    'type == "object" and .state == "MERGED" and (.mergedAt | type == "string") and (.mergedAt | length > 0) and (.mergeCommit.oid | type == "string") and (.mergeCommit.oid | length > 0)' >/dev/null; then
     incomplete "Merged release {CR_NOUN}" "state, mergedAt, or mergeCommit is missing or not MERGED."
   fi
   MERGE_COMMIT="$(printf '%s\n' "$MERGE_JSON" | jq -r '.mergeCommit.oid')"
   if [ "$CLI_TOOL" = gh ]; then
     PR_URL="$(gh pr view "$PR_NUMBER" --json url -q .url)" || incomplete "Merged release PR" "the PR URL could not be read."
   else
     PR_URL="$(glab api "projects/:id/merge_requests/$PR_NUMBER" --jq .web_url)" || incomplete "Merged release MR" "the MR URL could not be read."
   fi
   printf 'RELEASE_PR_HANDOFF\tPR_NUMBER=%s\tPR_URL=%s\tPR_STATE=MERGED\tMERGE_COMMIT=%s\n' "$PR_NUMBER" "$PR_URL" "$MERGE_COMMIT"

   # Checkpoint 4 — target-branch tree. FETCH_HEAD pins the exact target ref
   # fetched; do not resolve a second moving tip with ls-remote.
   git fetch origin "refs/heads/{target}" || incomplete "Target branch tree" "fetching {target} failed."
   TARGET_SHA="$(git rev-parse --verify --quiet FETCH_HEAD^{commit} || true)"
   if ! printf '%s\n' "$TARGET_SHA" | grep -Eq '^[0-9a-f]{40}$' \
      || ! git cat-file -e "$TARGET_SHA^{tree}" 2>/dev/null \
      || ! git merge-base --is-ancestor "$MERGE_COMMIT" "$TARGET_SHA"; then
     incomplete "Target branch tree" "expected {target} to contain $MERGE_COMMIT, got ${TARGET_SHA:-empty}."
   fi

   # Checkpoint 5 — version tag. A workflow may add housekeeping commits after
   # the merge, so accept only a tag on the merged-release lineage, never an
   # unrelated or stale tag, and never overwrite an existing tag. A failed push
   # may have raced with another successful publisher, so re-read the tag before
   # reporting failure.
   TAG_SHA="$(remote_tag_commit)"
   if ! printf '%s\n' "$TAG_SHA" | grep -Eq '^[0-9a-f]{40}$' && [ "{publishes_github_release}" = "true" ]; then
     # Automation owns tag creation for this project — poll for it with the
     # same bound Checkpoint 6 uses; never pre-create it here (see step 7 above).
     for ATTEMPT in $(seq 1 30); do
       TAG_SHA="$(remote_tag_commit)"
       printf '%s\n' "$TAG_SHA" | grep -Eq '^[0-9a-f]{40}$' && break
       TAG_SHA=""
       [ "$ATTEMPT" -lt 30 ] && sleep 10
     done
   fi
   if printf '%s\n' "$TAG_SHA" | grep -Eq '^[0-9a-f]{40}$'; then
     TAG_COMMIT="$TAG_SHA"
     if ! git merge-base --is-ancestor "$PREPARED_RELEASE_SHA" "$TAG_COMMIT" \
        || ! git merge-base --is-ancestor "$TAG_COMMIT" "$TARGET_SHA"; then
       echo "INCOMPLETE — Version tag v{version} is not on the merged release lineage; refusing to overwrite it."
       exit 1
     fi
   elif [ "{publishes_github_release}" = "true" ]; then
     incomplete "Version tag v{version}" "automation owns tag creation for this project, so it was never pre-created here."
   else
     if git rev-parse --verify --quiet "refs/tags/v{version}^{commit}" >/dev/null; then
       LOCAL_TAG_COMMIT="$(git rev-parse --verify --quiet "refs/tags/v{version}^{commit}")" || incomplete "Version tag" "the local tag could not be read."
       if ! git merge-base --is-ancestor "$PREPARED_RELEASE_SHA" "$LOCAL_TAG_COMMIT" \
          || ! git merge-base --is-ancestor "$LOCAL_TAG_COMMIT" "$TARGET_SHA"; then
         echo "INCOMPLETE — Local version tag v{version} is not on the merged release lineage; refusing to overwrite it."
         exit 1
       fi
     else
       git tag "v{version}" "$MERGE_COMMIT" || incomplete "Version tag" "local tag creation failed."
     fi
     git push origin "refs/tags/v{version}" || true
     TAG_COMMIT="$(remote_tag_commit)"
     if ! printf '%s\n' "$TAG_COMMIT" | grep -Eq '^[0-9a-f]{40}$' \
        || ! git merge-base --is-ancestor "$PREPARED_RELEASE_SHA" "$TAG_COMMIT" \
        || ! git merge-base --is-ancestor "$TAG_COMMIT" "$TARGET_SHA"; then
       incomplete "Version tag" "expected a tag on the merged release lineage, got ${TAG_COMMIT:-empty}."
     fi
   fi

   # Checkpoint 6 — GitHub Release. The release workflow may need time to publish
   # after the tag. Missing, empty, malformed, or timed-out output is incomplete
   # when GitHub Release publication is part of the documented workflow.
   if [ "{publishes_github_release}" != "true" ] && [ "{publishes_github_release}" != "false" ]; then
     echo "INCOMPLETE — GitHub Release publication flag is unresolved; preserve the prepared release state."
     exit 1
   fi
   if [ "{publishes_github_release}" = "true" ]; then
   RELEASE_JSON=""
   for ATTEMPT in $(seq 1 30); do
     CANDIDATE_RELEASE_JSON="$(release_published_json)"
     if release_is_published "$CANDIDATE_RELEASE_JSON"; then
       RELEASE_JSON="$CANDIDATE_RELEASE_JSON"
       break
     fi
     [ "$ATTEMPT" -lt 30 ] && sleep 10
   done
   if ! release_is_published "$RELEASE_JSON"; then
     incomplete "GitHub Release" "no published release was found after the bounded wait."
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
