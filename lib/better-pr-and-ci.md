## Phase 5: Per-Category PR Creation

One branch and one PR per category, never one combined PR.

### 5a: Build the Category Branches

Each category in `FILE_OWNER_MAP` (as updated in Phase 4c) gets a branch `{BRANCH_PREFIX}/{CATEGORY_SLUG}`, cut from `{DEFAULT_BRANCH}` and carrying exactly that category's files from `{BRANCH_PREFIX}/{DATE}` (added, modified, and deleted), in one commit `{prefix}: {category summary}`.
- Slugs: {CATEGORY_SLUGS}
- {CATEGORY_SLUG_RULE}
- {COMMIT_PREFIX_RULE}

Invariants:
- **File isolation** — every file is in exactly one branch. A file with changes from several categories (e.g., {MULTI_CATEGORY_FILE_EXAMPLE}) ships whole in the category that owns it in `FILE_OWNER_MAP`; file-level changes are never split across PRs.
- **Independent build** — each branch passes `{BUILD_CMD}`{VERIFY_SCOPE_SUFFIX} on its own. When a branch references something another branch creates, add a backward-compatible {COMPAT_SHIM} in the original {COMPAT_HOST} (in the branch that owns it), move the new file to the branch that needs it, or revert the import to the original path.
- **Push** — push with upstream tracking; a branch that still fails after one `git pull --rebase --autostash` retry is reported blocked while the others continue.
- **`CREATED_CATEGORY_SLUGS`** — a space-delimited list of every slug whose branch was created and pushed. Phase 7 deletes only from this set, and only after merge is confirmed.

### 5b: Version Bump

**Skip when Phase 0b recorded `HAS_VERSION_BUMP=false`** — no version-bump commit on any branch.

Otherwise, only once ALL category branches build{VERIFY_SCOPE_SUFFIX}: set `FIRST_CATEGORY` to the first slug in order that has a branch, compute the aggregate SemVer `{LEVEL}` across every category branch's commits (a `!` after the type/scope, e.g. `feat!:`, or a `BREAKING CHANGE:` footer → major, any `feat:` → minor, else patch), and on `{BRANCH_PREFIX}/{FIRST_CATEGORY}` bump per the **{VERSION_BUMP_SECTION}** section of this command, committed as `chore: bump version to {NEW_VERSION}` and pushed. If `HAS_CHANGELOG`, the same commit adds an entry to `CHANGELOG_TARGET` in the project's established format.

### 5c: Create PRs

Each PR targets `{DEFAULT_BRANCH}` from its category branch (`gh pr create` on GitHub, `glab mr create` on GitLab), titled `{prefix}: {short description}` with the same prefix as its 5a commit. {COMMIT_PREFIX_RULE} Body:

```markdown
## {PIPELINE_TITLE} — {Category Name}

### Summary
{count} findings addressed across {files} files.
{PR_BODY_SUMMARY_EXTRA}

### Changes
{bulleted list of changes with severity levels}

### Files Modified
{list of files}

{PR_BODY_EXTRA_SECTIONS}
### Merge Order
{e.g. "Depends on the Security PR" or "Independent"}
```

When `SIMPLIFY_ONLY=true`, add the simplify contract's Phase 5 body line.

Record each category's PR number and URL.

**GATE: If `--no-merge` was passed, skip CI/review/merge and proceed directly to [Phase 7 safe finalization](./better-cleanup.md).** Report all PR URLs, restore this run's stash, and retain open-PR branches and the worktree for resumption.

**GATE: If `VCS_HOST` is `gitlab`, proceed directly to [Phase 7 safe finalization](./better-cleanup.md).** Report MR URLs and restore this run's stash while retaining open-MR artifacts. Automated Phase 6 review and merge run on GitHub only; GitLab MRs stay open.

## Phase 5d: CI Verification

A PR passes this gate only when every expected check **for its current pushed HEAD** has passed; runs for an earlier HEAD never count. Allow each PR up to 10 minutes for checks to attach and finish. No checks reported is ambiguous: confirm the repository has no applicable CI or external required checks before treating it as green. If expected checks never attach within the wait limit, leave that PR open.

On a failing check, read its failed-job log and fix the cause on that PR's branch in a `fix: resolve CI failure - {description}` commit (specific files staged), push, and re-gate. Causes to rule out first:
- **Missing imports**: a symbol that lives in another PR's branch. Add a backward-compatible {COMPAT_SHIM} or revert the import.
{CI_FAILURE_CAUSES_EXTRA}

**At most 3 CI fix attempts per PR.** A PR still failing after the third is left open and reported; continue with the other PRs.
