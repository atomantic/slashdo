---
description: Create a release PR using the project's documented release workflow
argument-hint: "[--interactive] [--review-with <agent>[,<agent>...]] [--review-iterations <n>] [--review-mode <series|parallel>] [--review-stop-on-findings|--review-stop-on-clean] [--reviewer-applies]"
---

**Default mode: fully autonomous** — detects branches, determines the version bump from commits, runs review, creates and merges the release PR without prompting. **`--interactive`** pauses for branch confirmation, version approval, and merge confirmation.

## Parse Arguments

!`cat ~/.claude/lib/review-flags.md 2>/dev/null || cat "$(dirname "$(readlink -f .claude/commands/do/release.md)")/../../lib/review-flags.md"`

Then apply any **saved defaults** (set via `/do:config`) to the flags the user did NOT pass — an explicit flag, or `--review-with none`, always overrides a saved default:

!`cat ~/.claude/lib/review-config-defaults.md 2>/dev/null || cat "$(dirname "$(readlink -f .claude/commands/do/release.md)")/../../lib/review-config-defaults.md"`

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

**Placeholders.** Every `{name}` in this command (`{CLI_TOOL}`, `{source}`, `{target}`, `{tag}`, `{PR_NUMBER}`, …) is a value resolved in an earlier step; write its literal value into each command before running it. Shell variables do not survive from one tool call to the next, so no block may rely on a variable set by an earlier one — a block that branches on the host starts from the literal `{CLI_TOOL}` (`gh` or `glab`) and stops when it is neither. An `<angle>` slot is local to the sentence that explains it.

Discover the project's branches and conventions for releases rather than assuming names:

1. **Source branch** (the default branch, typically `main`):
   - GitHub: `gh repo view --json defaultBranchRef -q '.defaultBranchRef.name'`. While here, derive the GitHub API host `{GH_HOST}` from the `origin` remote with the shared snippet at the end of this section and forward it to the review loop — `gh api` (used by the host-side reviewer loops) defaults to github.com rather than reading the remote, so on GitHub Enterprise those loops would silently poll the wrong host and time out. If `gh auth token --hostname {GH_HOST}` fails, stop and tell the user to run `gh auth login --hostname {GH_HOST}`.
   - GitLab: capture `glab api "projects/:id"`, check its exit status, then read `.default_branch` from the captured output with `jq -er`; stop if either step fails. `glab api` has no `--jq` flag, and its output must not be piped directly into jq because that can hide an API failure. `glab` resolves its host from `origin`, so no API-host derivation is needed. For URLs this command builds itself (the changelog's compare link) use `{ORIGIN_HOST}`, already resolved by `lib/vcs-host.md`, rather than parsing the remote a second time.
2. **Target branch** — the first of these that names one:
   - **Release pipeline config** — GitHub: the `on: push: branches:` of `.github/workflows/release.yml` (or similar). GitLab: the `rules`/`only: refs:` of the release/publish job in `.gitlab-ci.yml` and its includes.
   - **Project conventions** already in context, then `docs/VERSIONING.md`, `CONTRIBUTING.md`, or `RELEASING.md`.
   - **An existing `release` branch.**
3. **Confirm the target exists on the remote** with `git ls-remote --heads origin "{target}"`. Consult the remote, not just local refs: on a fresh clone `{target}` may exist only there, and recreating it from the last tag would lose history and clobber the real release branch.
   - It exists: continue.
   - It is missing but the project's own pipeline config or docs name it (a first release): create it from the last release tag, or the root commit when there are no tags, with `git push origin "<start-commit>:refs/heads/{target}"`. In `--interactive` mode confirm first.
   - Nothing names a target and no `release` branch exists: stop. A trunk-only project should not get a new long-lived branch it never asked for. Tell the user to document the release flow (which branch is promoted into which, or a tag-based procedure, in `RELEASING.md` or `CONTRIBUTING.md`) or to create the target branch, then re-run. In `--interactive` mode, ask which branch to promote into instead of stopping.
4. **Naming** — follow the pattern visible in the project's history, and fall back to slashdo's only when history shows none:
   - `{tag}` — the shape of the existing release tags (`git tag --sort=-v:refname`), e.g. `1.2.3` or `pkg-v1.2.3`. Fallback `v{version}`.
   - `{release_subject}` — the subject of the commits that bumped the version for the last few releases. Fallback `chore: release v{version}`.
   - `{release_title}` — the titles of the last merged {CR_NOUN}s into `{target}`. Fallback `Release v{version}`.
   - `{release_subject_regex}` — `{release_subject}` as an extended regex with the version replaced by `[0-9]+\.[0-9]+\.[0-9]+` and other metacharacters escaped (fallback `chore: release v[0-9]+\.[0-9]+\.[0-9]+`). Resume finds the preparation commit by this pattern, so the commit, the admission PR title and the pattern must agree.
5. **Publication ownership** — read the release pipeline config and record two separate facts:
   - `{tag_owner}` — `automation` when the pipeline that runs on the merge into `{target}` creates the version tag itself (a tag-and-push step, `softprops/action-gh-release` or `gh release create` running on a branch push, `semantic-release`, GitLab's `release:` keyword with a new `tag_name`, …). `command` when nothing does. A pipeline that starts on a tag push (`on: push: tags:`, `rules: if: $CI_COMMIT_TAG`) is waiting for someone to push the tag, so it is `command` too.
   - `{publishes_release}` — `true` when the pipeline or the release instructions publish a host release object (GitHub Release: `gh release`, `softprops/action-gh-release`, or an equivalent action; GitLab Release: `glab release create`, `release-cli`, or the CI/CD `release:` keyword), otherwise `false`. A project that publishes only packages or tags finishes after the version-tag checkpoint.

   A tag-triggered publisher is therefore `{tag_owner}=command` with `{publishes_release}=true`: this command pushes the tag, then waits for the release.

Print the detected workflow: `Detected release flow: {source} → {target} (tag {tag} by {tag_owner}, release object: {publishes_release})`.

If detection yields `target == source`, stop with an error: a release {CR_NOUN} cannot merge a branch into itself. In `--interactive` mode, ask the user to confirm the flow before proceeding.

The {CR_NOUN} direction is `{source}` → `{target}` (e.g. `main` → `release`), so reviewers and the human approver see the full diff since the last release. A branch cut from source and merged back into it would show only the version-bump commit.

**GitHub only** — the shared `{GH_HOST}` derivation in step 1 refers to:

!`cat ~/.claude/lib/gh-host.md 2>/dev/null || cat "$(dirname "$(readlink -f .claude/commands/do/release.md)")/../../lib/gh-host.md"`

## Pre-Release Checks

1. Check out the source branch and bring it up to date (`git pull --rebase --autostash`).
2. Fetch the target: `git fetch origin "refs/heads/{target}:refs/remotes/origin/{target}"`. Every later diff and history check reads `origin/{target}`, so the target is never checked out locally.
3. Run the project's test suite and, if it has one, its build (per the project conventions already in context, or its package manifest).

## Recover Prepared Release State

An interrupted run must resume the version it already prepared rather than bump again. Before determining a version, look for prepared state in this order. A forge query that fails or returns malformed data is INCOMPLETE, never "nothing found".

1. **A pending admission {CR_NOUN}.** When `{source}` is gated (see **Resolve Source Branch Admission**), an earlier run may have pushed the preparation to a temporary `release-prep/*` branch that has not merged. List the open {CR_NOUN}s into `{source}` and keep those whose head branch starts with `release-prep/` (`gh pr list --state open --base "{source}" --limit 100 --json number,headRefName,headRefOid`; GitLab: `glab api "projects/:id/merge_requests?state=opened&target_branch={source}"`, filtering on `source_branch`). With exactly one, `git fetch origin "refs/heads/<its branch>" && git merge --ff-only FETCH_HEAD` so the preparation commit is the local `HEAD` again; the admission procedure later reuses that {CR_NOUN}. More than one, or a failed fast-forward, is INCOMPLETE: name the stale {CR_NOUN}s for the user to close.

2. **A preparation commit**, found by its subject:
   ```bash
   git fetch origin "refs/heads/{target}:refs/remotes/origin/{target}" \
     || { echo "INCOMPLETE — Prepared release state is unverified; origin/{target} could not be fetched."; exit 1; }
   TAB="$(printf '\t')"
   echo "UNMERGED=$(git log --format='%H%x09%s' "origin/{target}..HEAD" | grep -m1 -E "${TAB}{release_subject_regex}\$")"
   echo "ON_TARGET=$(git log --format='%H%x09%s' "origin/{target}" | grep -m1 -E "${TAB}{release_subject_regex}\$")"
   ```
   - **`UNMERGED` is set** — a release was prepared and has not reached `{target}`. Resume it: `{PREPARED_RELEASE_SHA}` is its SHA, `{version}` the version in its subject, `{TARGET_RECOVERY}=false`.
   - **Only `ON_TARGET` is set** — that is the newest release already merged. Check that it was published: its tag exists on the remote (`git ls-remote origin "refs/tags/<its tag>"`) and, when `{publishes_release}=true`, its release object is published (`gh release view <its tag> --json isDraft,isPrerelease,publishedAt` shows a non-draft, non-prerelease release with a publish time; on GitLab `glab release view <its tag> -F json`, where there is no draft state, `upcoming_release` is the prerelease flag and `released_at` the publish time). Tell "not found" apart from a failed lookup; only the first means unpublished. If both are present there is nothing to recover. If either is missing, the merge happened but publication was never verified: resume with `{PREPARED_RELEASE_SHA}` and `{version}` from that commit and `{TARGET_RECOVERY}=true`, and identify its release {CR_NOUN} — the merged `{source}` → `{target}` {CR_NOUN} whose head contains that commit (`git merge-base --is-ancestor`). Exactly one must qualify; record its `{PR_NUMBER}` and URL. Zero or several is INCOMPLETE.
   - **Neither is set** — no prepared release; determine a new version below.

When resuming, confirm the checked-out package version equals `{version}`; a mismatch is INCOMPLETE, and the prepared state is left as it is for investigation. Then skip **Determine Version and Finalize Changelog** — no new bump, no rewritten notes, no second release commit — and continue at **Local Code Review**. With `{TARGET_RECOVERY}=true` the release {CR_NOUN} is already merged, so continue directly at **Post-Merge** (Checkpoint 3).

## Determine Version and Finalize Changelog

Only for a release with no prepared commit.

1. **Determine the version bump** from commits since the last release tag. Scan subjects, bodies and footers for conventional-commit prefixes and take the highest level found:
   - `breaking:`, any prefix with a `!` (`feat!:`, `fix!:`, `feat!(scope):`), or a `BREAKING CHANGE:` footer → **major**
   - `feat:` or `feat(scope):` → **minor**
   - `fix:`, `build:`, `chore:`, `docs:`, `refactor:`, `perf:`, `style:`, `test:`, `ci:`, `revert:` (with or without scope) → **patch**
   - Commits with no recognized prefix, and `address review …` commits, are classified by the title of the merged change request they belong to. On GitHub, use `gh pr list --state merged --search <sha>`; on GitLab, capture `glab api --paginate "projects/:id/repository/commits/<sha>/merge_requests"` before parsing and validate the response as an array. Use the title only when exactly one merged {CR_NOUN} is associated with the commit. If the lookup fails, is malformed, is ambiguous, or its title has no recognized prefix, default to **patch**.

   In `--interactive` mode, present the proposed version for confirmation.

2. **Bump the version** with the project's native command — Node: `npm version <major|minor|patch> --no-git-tag-version`; Rust: `cargo set-version --bump <level>`, or edit `Cargo.toml` and run `cargo update -p <package>`; Python: `poetry version <level>`, else edit `pyproject.toml`; Elixir: `mix.exs`; Go: a `VERSION` file; other ecosystems: the equivalent, detected from the project files.

3. **Write the release notes** the way this project does. Resolve that in order:
   1. **A stated convention** — `CLAUDE.md` / `AGENTS.md` / `CONTRIBUTING.md`, or a release workflow that reads a notes file. An explicit instruction wins over anything inferred below.
   2. **A release-automation tool** — `release-please`, `semantic-release`, `changesets`, `towncrier`, `git-cliff` or similar, detected from its config. That tool owns the changelog: run its documented command if the project expects you to, otherwise leave the changelog alone.
   3. **An existing file-based changelog** — a per-release directory (`.changelogs/`, `.changelog/`, `docs/releases/`) or a rolling `CHANGELOG.md`. Match the headings, sections, date line and link style of the previous entries.
   4. **A current-release file** — one fixed-path notes file (e.g. `{changelog_dir}/RELEASE.md`) that each release overwrites; the forge release is the archive and tags keep past versions. Detected when the stated convention names it, or the changelog directory holds that single notes file and no per-version files. Overwrite it with the new version's notes under the heading the project's workflow expects (`# Release v{version}` unless it states another) and stage it in the release commit like any changelog file. Do not migrate a per-release directory to it unasked (see the migration note below).
   5. **No changelog file at all** — the notes become the release body and the {CR_NOUN} description, and no file is created or staged. If the release workflow reads a notes file, create the single overwritten file above rather than a new per-release directory.

   **Content.** If the project stages unreleased entries (a `NEXT.md` beside versioned files, an `## Unreleased` section in `CHANGELOG.md`) and that content exists, promote it: rename or retitle it for `{version}`, whichever matches the repo. Otherwise derive the notes from the commits since the last release tag (the full history for a first release), preferring merge-commit and {CR_NOUN} titles over intermediate "address review" commits, and reading bodies as well as subjects for the user-visible effect.

   **Fallback format**, used where the previous entries or the stated convention do not already settle the shape:
   - a `# Release v{version}` heading and a `Released: YYYY-MM-DD` line;
   - a `## Highlights` summary of 5–15 plain-language bullets grouped by feature area, each one sentence on what changed and why it matters to someone deciding whether to upgrade, without file paths or inline issue numbers (skip it for a tiny release that is already a clean list);
   - the detailed `Added` / `Changed` / `Fixed` sections, grouped by theme rather than dumped from `git log`, with noise commits (formatting, typos, CI churn) dropped or folded into an `Internal` group;
   - a `## Full Changelog` section with the compare link, built from the resolved host because a literal `github.com` or `gitlab.com` 404s on Enterprise and self-managed hosts — GitHub: `https://{GH_HOST}/{owner}/{repo}/compare/{previous_tag}...{tag}`; GitLab: `https://{ORIGIN_HOST}/{owner}/{repo}/-/compare/{previous_tag}...{tag}` (GitLab's path has a `/-/` segment before `compare`).

   **Size limit.** Keep the published body complete. If it would exceed 125,000 characters, tighten the detailed sections until it fits; link to the changelog file at the tag only when the project keeps per-release files. Do not truncate silently.

   **Migrating to a current-release file** (only when the owner asks): switch the release workflow to the fixed path and fail it when the file's version heading does not match the package version; verify every existing per-release file has a matching forge release (list any that do not, and any whose release body was truncated and links to the file at its tag); then delete the old files.

4. **Commit the release.** Stage exactly the files the bump command modified (Node: `package.json` and a lockfile if one exists and changed; Rust: `Cargo.toml` and `Cargo.lock`; Python: `pyproject.toml`; …) plus the changelog file if step 3 wrote one, each named explicitly rather than with `git add -A`. Commit with the subject `{release_subject}`. This commit is `{PREPARED_RELEASE_SHA}`.

## Local Code Review

This review is a required gate: the release {CR_NOUN} is not opened until its summary is printed.

<review_gate>

1. Read the commit messages since the last release to understand the scope.
2. List the changed files with `git diff --name-only origin/{target}...HEAD`.
3. For every changed file:
   a. Read the entire file, not just the diff hunks.
   b. Review it under the review preferences. Load them now, the first time this step runs:
      !read lib/review-preferences.md
   c. For each finding, quote the specific line and name the concrete wrong outcome; a style preference is not a finding.
4. Check that the aggregate change set delivers what the release claims.
5. Print a review summary table (`| File | Tier | Finding | Severity | Status |`).
6. Fix any issues, run tests, confirm they cover the changed code paths, and commit. Do not push yet: publication to `{source}` happens only through **Resolve Source Branch Admission** and **Open the Release PR**, so a gated `{source}` is never updated by a bare push.

If the diff touches more than 15 files, delegate later batches to a sub-agent to keep context clean.

</review_gate>

## Resolve Source Branch Admission

Before the first push of the preparation commit or of any review fix to `{source}`, read what the forge requires to land a commit there. A branch whose rules require status checks or a PR is **gated**: an account with bypass permission can still push straight onto it, and GitHub reports "Bypassed rule violations" — the commit lands before its required remote check exists, and local tests/build/pregate do not satisfy that check. Never use bypass permission, force push, or relax the branch protection to get past a gate.

```bash
incomplete() {
  echo "INCOMPLETE — Source branch admission is unverified; $WHY Preserve the prepared release state and retry."
  exit 1
}
case "{CLI_TOOL}" in
gh)
  RULES_JSON="$(gh api --hostname "{GH_HOST}" "repos/{owner}/{repo}/rules/branches/{source}")" || WHY="the branch-rules query failed." incomplete
  BRANCH_JSON="$(gh api --hostname "{GH_HOST}" "repos/{owner}/{repo}/branches/{source}")" || WHY="the branch query failed." incomplete
  SOURCE_CHECKS_REQUIRED="$(jq -n --argjson rules "$RULES_JSON" --argjson branch "$BRANCH_JSON" '
    $branch.protection.required_status_checks as $raw_checks |
    (if $raw_checks == null then {} else $raw_checks end) as $checks |
    ($checks.contexts | if . == null then [] else . end) as $contexts |
    ($checks.checks | if . == null then [] else . end) as $status_checks |
    if ($rules | type) != "array" or ([$rules[] | select((type != "object") or ((.type | type) != "string"))] | length) > 0
      or ($branch.protected | type) != "boolean" or ($branch.protection | type) != "object"
      or ($checks | type) != "object" or ($contexts | type) != "array" or ($status_checks | type) != "array"
    then error("unexpected shape")
    else (([$rules[] | select(.type == "required_status_checks")] | length) > 0)
      or (($checks.enforcement_level // "configured") != "off" and (($contexts | length) + ($status_checks | length)) > 0)
    end')" \
    || WHY="the branch rules were malformed." incomplete
  # Classic protection hides its pull-request-review requirement from non-admins, so any classic
  # protection counts as a gate: landing through a PR is always allowed, a bare push may not be.
  SOURCE_GATED="$(jq -n --argjson rules "$RULES_JSON" --argjson branch "$BRANCH_JSON" --argjson checks "$SOURCE_CHECKS_REQUIRED" '$checks or (([$rules[] | select(.type == "pull_request")] | length) > 0) or ($branch.protected == true)')" \
    || WHY="the branch rules were malformed." incomplete
  ;;
glab)
  # The branch endpoint reports effective protection, including wildcard protected-branch rules that an exact-name lookup 404s on.
  BRANCH_JSON="$(glab api "projects/:id/repository/branches/$(printf '%s' '{source}' | jq -sRr @uri)")" || WHY="the branch query failed." incomplete
  PROJECT_JSON="$(glab api "projects/:id")" || WHY="the project query failed." incomplete
  SOURCE_GATED="$(printf '%s\n' "$BRANCH_JSON" | jq -r 'if (.protected | type) == "boolean" then .protected else error("missing") end')" || WHY="the branch protection flag was missing." incomplete
  SOURCE_CHECKS_REQUIRED="$(printf '%s\n' "$PROJECT_JSON" | jq -r 'if (.only_allow_merge_if_pipeline_succeeds | type) == "boolean" then .only_allow_merge_if_pipeline_succeeds else error("missing") end')" || WHY="the pipeline-must-succeed setting was missing." incomplete
  ;;
*) WHY="the code host CLI was not resolved." incomplete ;;
esac
case "$SOURCE_GATED/$SOURCE_CHECKS_REQUIRED" in
  true/true|true/false|false/true|false/false) ;;
  *) WHY="the gate result was neither true nor false." incomplete ;;
esac
printf 'SOURCE_ADMISSION_HANDOFF\tSOURCE_GATED=%s\tSOURCE_CHECKS_REQUIRED=%s\n' "$SOURCE_GATED" "$SOURCE_CHECKS_REQUIRED"
```

Unreadable or malformed rules are INCOMPLETE, never "not gated". Carry the two printed values into later steps as `{SOURCE_GATED}` and `{SOURCE_CHECKS_REQUIRED}`.

- **`{SOURCE_GATED}=false`** — no remote admission applies; continue at **Open the Release PR** and push as documented. A project-documented direct-push flow stays supported here.
- **`{SOURCE_GATED}=true`** — read the gate procedure and land the preparation commit (and every later review-fix commit) through a temporary branch and a gated {CR_NOUN} into `{source}` instead of pushing to it. The release {CR_NOUN} is unchanged: it still promotes `{source}` into `{target}` and shows the full unreleased range.

!read lib/release-source-gate.md

## Open the Release PR

### Push, read back, reuse or create

Every {CR_NOUN} this command opens — the release {CR_NOUN}, and the admission {CR_NOUN}s of a gated source — goes through these steps for its head branch, base branch and title, so that a retry never opens a duplicate and never proceeds on a push that did not arrive:

1. **Push and read back.** `git push origin "HEAD:refs/heads/<head>"`, then require `git ls-remote --heads origin "refs/heads/<head>"` to report exactly `git rev-parse HEAD`. An empty or different SHA is INCOMPLETE.
2. **List every {CR_NOUN} from that head into that base, in any state.** GitHub: `gh pr list --state all --base "<base>" --head "<head>" --limit 100 --json number,state,headRefOid,url`. GitLab: `glab api --paginate "projects/:id/merge_requests?source_branch=<head>&target_branch=<base>&state=all&per_page=100"` — `glab mr list` cannot filter on both branches at once; the paginated output is one JSON array per page (combine them with `jq -s add`), and the fields are `iid`, `state` (`opened`/`merged`/`closed`), `sha` and `web_url`. A failed, empty or malformed response is INCOMPLETE rather than "none exist".
3. **Reuse or create.** Among the {CR_NOUN}s whose head SHA is the pushed SHA and whose state is open or merged: exactly one is reused (a merged one means an interrupted run already got this far); none means create it now; more than one is INCOMPLETE. A closed, unmerged {CR_NOUN} is never reused. If creation fails, report INCOMPLETE and let the retry re-list instead of creating again.
4. **Record** the number, URL and state (`OPEN` or `MERGED`).

### The release {CR_NOUN}

- **Checkpoint 1 — source push.** Step 1 above for head `{source}`. When `{SOURCE_GATED}=true` the admission procedure already landed the commits and fast-forwarded the local `{source}`, so skip the push and only do the read-back. A mismatch names `Source push` as the first unverified checkpoint.
- **Checkpoint 2 — release {CR_NOUN}.** Steps 2–4 for head `{source}`, base `{target}`. A failure names `Release {CR_NOUN}` as the first unverified checkpoint. When creating:
  - Title: `{release_title}`.
  - Body: the project's {CR_NOUN} template if it has one, filled with the release notes for this version (or a summary of the commits since the last release when no notes were written). No co-author or "generated with" lines.

Carry `{PREPARED_RELEASE_SHA}`, `{PR_NUMBER}`, `{PR_URL}` and `{PR_STATE}` into the review and merge steps. Review fixes do not bump the version again; it was set during preparation.

## Run the Review Loop

**If the release {CR_NOUN} is already merged** (`{PR_STATE}=MERGED` at Checkpoint 2, because an interrupted run completed the merge), skip this section and **Merge the PR** and continue at **Post-Merge**: a merged {CR_NOUN} is not a merge candidate and needs no further review. Treat `OVERALL_STATUS` as `clean` for the post-merge path.

**If `REVIEW_AGENTS` is empty**, skip this entire section — the Local Code Review gate plus the passing build/tests are the merge gate; set `OVERALL_STATUS=clean` (no-review path) and proceed to the merge section.

Otherwise, hand off to the **multi-reviewer loop** with the inputs resolved in "Parse Arguments" (`{REVIEW_AGENTS}`, `{REVIEW_STOP_MODE}`, `{REVIEW_MODE}`, `{REVIEWER_APPLIES}`, `{REVIEW_ITERATIONS}`, `{REVIEW_MODELS}`) plus `{GH_HOST}` from "Detect Release Workflow" and the per-entry `{WAIT_SCHEDULE}` selected below. On GitHub, the host-side loops use `{GH_HOST}` on every `gh api` call, and the wrapper dispatches each entry to the single-reviewer loop read below.

For each host-side entry, resolve the caller-owned `{WAIT_SCHEDULE}` before dispatch:

- `copilot` — use the previous Copilot review duration on this PR (default 60 seconds if none); max wait 3x that duration, minimum 90 seconds, maximum 5 minutes; poll every 5s, 5s, 10s, 10s, then 15s.
- `@<login>` — a login ending in `[bot]` is an automated reviewer: expected duration 5 minutes; max wait 3x that duration, minimum 3 minutes, maximum 15 minutes; poll every 10s, 10s, 20s, 20s, then 30s. Any other login is presumed human: max wait 4 hours; poll every 30s for the first 5 minutes, then every 60s.

Forward only the selected schedule as `{WAIT_SCHEDULE}`; never give one pass both schedules.

**Gated source.** When `SOURCE_GATED=true`, the loops' fix pushes must not land on `{source}` directly: follow "Review fixes under a gated source" in the gate procedure loaded by **Resolve Source Branch Admission**, so every fix reaches `{source}` through a gated PR and the merge gate below runs on the release PR's updated head.

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

## Merge the PR

Merge only when the wrapper's `{OVERALL_STATUS}` is `clean`, or `partial` with an explicit `--review-stop-on-findings`/`--review-stop-on-clean` flag. The wrapper and the inner loops own what each status means — `~opt` exclusion, `push-failed`, copilot `too-large`, `capped` vs `guardrail` — so apply its verdict as-is rather than re-deriving it from the per-pass table. For `inconclusive` or `dirty`:
- **Default mode**: leave the {CR_NOUN} open and report the proximate status so the user can review manually.
- **Interactive mode (`--interactive`)**: ask the user whether to merge anyway, re-run a specific reviewer, or leave it open.

Then:

1. **Gate on CI.** Apply the shared release CI gate below to this {CR_NOUN}'s live head and `{target}`. It verifies the CI the project configures independently of the checks branch protection requires, so an empty required list is not mistaken for missing CI, and no reported checks is not mistaken for green.

!read lib/release-ci-gate.md

   On a failed check or pipeline, apply **CI flake handling** above: one conservative re-run on the same commit. If that SHA passes, it was a flake; proceed and log which check flaked. If it fails again, stop without merging and report the check.
2. **Merge, pinned to the verified head.** Re-read the {CR_NOUN} state first. If it is still open, merge the head the CI gate verified, `{VERIFIED_HEAD}`:
   - GitHub: `gh pr merge {PR_NUMBER} --merge --match-head-commit {VERIFIED_HEAD}`
   - GitLab: `glab mr merge {PR_NUMBER} --sha {VERIFIED_HEAD} --yes`

   If the head moved, the forge refuses the merge; go back to the CI gate for the new head. Use the merge method the project documents for release {CR_NOUN}s. Without one, use a merge commit: a promotion {CR_NOUN} has to carry the source history into `{target}` unchanged, since a squash or rebase would make the two branches diverge and hide the preparation commit that resume looks for. If the repository does not allow merge commits and documents no alternative, leave the {CR_NOUN} open and report that. Never merge with `--admin`, auto-merge, or any other bypass of the target's protection.

   If the state is already merged, continue. Any other state is INCOMPLETE.

## Post-Merge

Do not infer completion from the merge command's exit status, a local commit, or a pushed tag. Read each fact back from the remote, in order, and when one cannot be verified — empty, malformed, failed, queued or timed out — report INCOMPLETE naming that checkpoint, leave the prepared state as it is, and stop.

**Checkpoint 3 — merged release {CR_NOUN}.** Read back the {CR_NOUN} and require a merged state, a non-empty merge timestamp and a non-empty merge commit: `gh pr view {PR_NUMBER} --json state,mergedAt,mergeCommit,url`; on GitLab capture `glab api "projects/:id/merge_requests/{PR_NUMBER}"` and read `state` (`merged`), `merged_at`, `merge_commit_sha` and `web_url`. Record the merge commit as `{MERGE_COMMIT}`.

**Checkpoints 4 and 5 — target branch and version tag.** The {CR_NOUN} state alone would miss a queued or incomplete target update, so verify the target ref itself, then the tag. Run this as one shell invocation, allowing it at least six minutes:

```bash
incomplete() {
  echo "INCOMPLETE — $WHAT is unverified; $WHY Preserve the prepared release state and retry."
  exit 1
}
# The commit the remote tag points at: the peeled entry of an annotated tag, else the lightweight ref.
remote_tag_commit() {
  TAG_REFS="$(git ls-remote origin "refs/tags/{tag}" "refs/tags/{tag}^{}")" || return 1
  printf '%s\n' "$TAG_REFS" | sort -k2 | tail -n1 | cut -f1 | grep -E '^[0-9a-f]{40}$'
}
on_release_lineage() {
  git merge-base --is-ancestor "{PREPARED_RELEASE_SHA}" "$TAG_COMMIT" && git merge-base --is-ancestor "$TAG_COMMIT" "$TARGET_SHA"
}

# Checkpoint 4. FETCH_HEAD pins the exact target ref fetched; do not resolve a second moving tip with ls-remote.
git fetch origin "refs/heads/{target}" || WHAT="Target branch tree" WHY="fetching {target} failed." incomplete
TARGET_SHA="$(git rev-parse --verify --quiet 'FETCH_HEAD^{commit}')"
{ [ -n "$TARGET_SHA" ] && git merge-base --is-ancestor "{MERGE_COMMIT}" "$TARGET_SHA"; } \
  || WHAT="Target branch tree" WHY="expected {target} to contain {MERGE_COMMIT}, got ${TARGET_SHA:-nothing}." incomplete

# Checkpoint 5. The tag must sit on the merged-release lineage: at or after the preparation commit, and
# reachable from the target (a workflow may add housekeeping commits after the merge). An existing tag
# anywhere else is reported, never moved.
TAG_COMMIT="$(remote_tag_commit)"
if [ -z "$TAG_COMMIT" ]; then
  case "{tag_owner}" in
  automation)
    # The project's pipeline creates the tag. Creating it here can make that pipeline skip publication.
    for ATTEMPT in $(seq 1 30); do
      TAG_COMMIT="$(remote_tag_commit)" && break
      [ "$ATTEMPT" -lt 30 ] && sleep 10
    done
    [ -n "$TAG_COMMIT" ] || WHAT="Version tag {tag}" WHY="the project's automation creates it and it did not appear within five minutes; it was not created here." incomplete
    ;;
  command)
    if TAG_COMMIT="$(git rev-parse --verify --quiet 'refs/tags/{tag}^{commit}')"; then
      on_release_lineage || WHAT="Version tag {tag}" WHY="a local tag of that name is not on the merged release lineage and was not overwritten." incomplete
    else
      git tag "{tag}" "{MERGE_COMMIT}" || WHAT="Version tag {tag}" WHY="local tag creation failed." incomplete
    fi
    # A rejected push may have lost a race with another publisher, so the read-back decides, not the exit status.
    git push origin "refs/tags/{tag}" || true
    TAG_COMMIT="$(remote_tag_commit)"
    ;;
  *) WHAT="Version tag {tag}" WHY="the tag owner was not resolved." incomplete ;;
  esac
fi
{ [ -n "$TAG_COMMIT" ] && on_release_lineage; } \
  || WHAT="Version tag {tag}" WHY="expected a tag on the merged release lineage, got ${TAG_COMMIT:-nothing}; an existing tag is never overwritten." incomplete
printf 'RELEASE_TAG_HANDOFF\tTARGET_SHA=%s\tTAG_COMMIT=%s\n' "$TARGET_SHA" "$TAG_COMMIT"
```

**Checkpoint 6 — release object.** Only when `{publishes_release}=true`; otherwise say it was skipped because the project publishes none. The pipeline may need time after the tag, so poll every 10 seconds for up to five minutes for a published release whose tag is `{tag}`: `gh release view "{tag}" --json tagName,isDraft,isPrerelease,publishedAt` must show the tag, `isDraft` and `isPrerelease` false, and a publish time. On GitLab, `glab release view "{tag}" -F json` must show `tag_name`, a `released_at` time and `upcoming_release` not true (GitLab has no draft state). If the project documents its releases as prereleases, accept that flag. No published release after the wait is INCOMPLETE.

**Report.** Once every applicable checkpoint has passed, report the release as complete with the source SHA, the {CR_NOUN} URL and merge commit, the target SHA, the tag and its commit, and the release URL when one was published. Then switch back: `git checkout {source} && git pull --rebase --autostash`.
