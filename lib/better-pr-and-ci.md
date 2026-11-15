## Phase 5: Per-Category PR Creation

One branch and one PR per category by default. Categories whose changes depend on each other ship together in one PR (5a): the split is a convenience for reviewers and never a reason to add code to the user's project.

### 5a: Build the Category Branches

Each category in `FILE_OWNER_MAP` (as updated in Phase 4c) gets a branch `{BRANCH_PREFIX}/{CATEGORY_SLUG}` carrying that category's files from `{BRANCH_PREFIX}/{DATE}` (added, modified, and deleted) in one commit that summarises the category (fallback subject `{prefix}: {category summary}`). Cut it from `{DEFAULT_BRANCH}`, or from the Phase 3b Foundation commit when its files use Foundation utilities, so the utilities travel with every branch that needs them. Slugs: {CATEGORY_SLUGS}.

- **Whole files.** A file with changes from several categories ships whole in the category that owns it in `FILE_OWNER_MAP`; a file's changes are never split across PRs.
- **Independent build, by combining rather than shimming.** Each branch passes `{BUILD_CMD}` on its own. When a branch only builds with another category's changes (a moved symbol, a new file both use), combine those categories into one branch and PR: use the slug that comes first in the list above, carry all of their files, and say in the PR body which categories it combines and why. Do not add a re-export, alias, or other compatibility shim to the user's code only to make the branches build separately, and do not revert a fix for that reason. If most categories depend on each other, a single PR is the right outcome.
- **Push.** Push with upstream tracking; a branch that still fails after one `git pull --rebase --autostash` retry is reported blocked while the others continue.
- **`CREATED_CATEGORY_SLUGS`.** Record every slug whose branch was created and pushed (a combined branch once, under its branch slug). Phase 7 deletes only from this set, and only after merge is confirmed.

### 5b: No Version Bump in Audit PRs

Do not bump package or manifest versions (`package.json`, `Cargo.toml`, `pyproject.toml`, `*.pbxproj`, `VERSION`, etc.) on any category branch. Version bumps belong to the project's release flow, and a bump here would conflict across the category PRs or mark a release before they have all merged.

### 5c: Create PRs

Each PR targets `{DEFAULT_BRANCH}` from its category branch (`gh pr create` on GitHub, `glab mr create` on GitLab), titled like its 5a commit. When the repository has a PR/MR template, fill that template in with the content below; otherwise use this body:

```markdown
## {PIPELINE_TITLE} — {Category Name}

### Summary
{count} findings addressed across {files} files.

### Changes
{bulleted list of changes with severity levels}

### Merge Order
{"Independent", or the PR this one should follow; for a combined PR, the categories it combines and why}
```

When `SIMPLIFY_ONLY=true`, add the simplify contract's Phase 5 body line.

Record each category's PR number and URL.

**Gate:** if `--no-merge` was passed, skip CI, review, and merge and go straight to [Phase 7 safe finalization](./better-cleanup.md). Report all PR URLs, restore this run's stash, and retain open-PR branches and the worktree for resumption.

## Phase 5d: CI Verification

A PR passes this gate only when every expected check for its current pushed HEAD has passed; runs for an earlier HEAD do not count. Allow each PR up to 10 minutes for checks to attach and finish. No checks reported is ambiguous: confirm the repository has no applicable CI or external required checks before treating it as green. If expected checks never attach within the wait limit, leave that PR open.

- GitHub: `gh pr checks {PR_NUMBER} --required --watch --fail-fast` (also non-zero on the vacuously-green "no checks" case).
- GitLab: `glab ci status --wait --branch {BRANCH_PREFIX}/{CATEGORY_SLUG}`; no separate required-checks list.

On a failing check, read its failed-job log and fix the cause on that PR's branch in a new commit (fallback subject `fix: resolve CI failure - {description}`, specific files staged), push, and re-gate. One cause is specific to the split: a symbol that lives in another PR's branch means those categories depend on each other. Fold the other branch into this one per 5a and close its PR with a note pointing here, rather than adding a shim.

Allow at most 3 CI fix attempts per PR. A PR still failing after the third is left open and reported; continue with the other PRs.
