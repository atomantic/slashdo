## Better pipeline — Per-Category PR Creation & CI Verification (Phases 5 / 5d)

The shared branch-splitting, PR-creation, and CI-green gate for every `better-*`
audit pipeline. `/do:better` and `/do:better-swift` include this file verbatim;
the pipeline-specific bits (category slugs, version-bump mechanics, PR body
extras, stack-specific CI causes) arrive through the inputs below.

### Inputs

In addition to `{BRANCH_PREFIX}`, `{VERIFY_SCOPE_SUFFIX}`, and `{SIMPLIFY_ONLY}`,
which every `better-*` command defines and `~/.claude/lib/better-verification.md`
documents:

- `{PIPELINE_TITLE}` — the PR body's heading prefix (`Better Audit`,
  `Better Swift Audit`).
- `{CATEGORY_SLUGS}` — the pipeline's branch-slug set, as the prose line step 2
  prints (e.g. `` `security`, `code-quality`, … ``).
- `{CATEGORY_SLUG_RULE}` — a mode-dependent narrowing of that slug set, or
  **empty**. It sits under the slug list in 5a step 2, where branch names are
  actually chosen.
- `{COMMIT_PREFIX_RULE}` — a mode-dependent rule about the conventional prefix
  the per-category commit and its PR title take, or **empty**. It is repeated at
  5a step 4 and 5c because it governs both.
- `{MULTI_CATEGORY_FILE_EXAMPLE}` — a representative file from this stack that
  could pick up changes from two categories, used in the file-isolation rule
  (e.g. "`server/index.js` with both security and stack-specific changes").
- `{COMPAT_SHIM}` — the stack's backward-compatible shim for a symbol that moved
  between branches (`re-export` for JS/TS, `typealias` for Swift).
- `{COMPAT_HOST}` — what that shim is added to (`module`, `file`).
- `{VERSION_BUMP_SECTION}` — the name of the section the calling command defines
  inline that performs the actual bump; the mechanics are stack-specific
  (`npm version` vs `agvtool`), the surrounding policy is not.
- `{PR_BODY_SUMMARY_EXTRA}` — extra line(s) for the PR body's Summary section,
  or empty (e.g. "Platforms verified: {PLATFORMS}").
- `{PR_BODY_EXTRA_SECTIONS}` — extra `###` section(s) for the PR body, or empty
  (e.g. a "Platform Impact" section).
- `{CI_FAILURE_CAUSES_EXTRA}` — extra bullet(s) for the CI failure-cause list, or
  empty (e.g. a JS-only "missing exports" cause, platform-conditional build
  failures, code-signing noise). Its placeholder sits six spaces deep inside the
  lettered sub-list, so every line of the value must carry that indent.

The substitution rules in `~/.claude/lib/better-verification.md` — empty values
drop their line, indented values keep their indent — apply to all of these.

## Phase 5: Per-Category PR Creation

Instead of one mega PR, create **separate branches and PRs for each category**. This enables independent review, targeted CI, and granular merge decisions.

### 5a: Build the Category Branches

Using the `FILE_OWNER_MAP` from Phase 2 (updated in Phase 4c.3), create one branch per category.

Initialize `CREATED_CATEGORY_SLUGS=""` (empty space-delimited string). After each category branch is successfully created and pushed below, append its slug: `CREATED_CATEGORY_SLUGS="$CREATED_CATEGORY_SLUGS {CATEGORY_SLUG}"`. Phase 7 uses this as the set of candidate branches for cleanup; when deleting branches, either run cleanup only after all desired merges are complete or explicitly verify that each branch in `CREATED_CATEGORY_SLUGS` has been merged before deleting it.

For each category that has findings:
1. Switch to `{DEFAULT_BRANCH}`: `git checkout {DEFAULT_BRANCH}`
2. Create a category branch: `git checkout -b {BRANCH_PREFIX}/{CATEGORY_SLUG}`
   - Use slugs: {CATEGORY_SLUGS}
   - {CATEGORY_SLUG_RULE}
3. For each file assigned to this category in `FILE_OWNER_MAP`:
   - **Modified files**: `git checkout {BRANCH_PREFIX}/{DATE} -- {file_path}`
   - **New files (Added)**: `git checkout {BRANCH_PREFIX}/{DATE} -- {file_path}`
   - **Deleted files**: `git rm {file_path}`
4. Commit all staged changes with a descriptive message:
   ```bash
   git commit -m "{prefix}: {category summary}"
   ```
   {COMMIT_PREFIX_RULE}
5. Push the branch: `git push -u origin {BRANCH_PREFIX}/{CATEGORY_SLUG}`

**File isolation rule** (one file per branch) — each file must appear in exactly ONE branch. If a file has changes from multiple categories (e.g., {MULTI_CATEGORY_FILE_EXAMPLE}), assign the whole file to one category based on the file ownership map. Do not split file-level changes across PRs.

**Cross-PR dependency check** — verify each branch builds independently{VERIFY_SCOPE_SUFFIX}:
```bash
git checkout {BRANCH_PREFIX}/{CATEGORY_SLUG} && {BUILD_CMD}
```
If a branch fails because it references something created in another branch:
- Add a backward-compatible {COMPAT_SHIM} in the original {COMPAT_HOST}, in the branch that owns it
- Or move the new file to the branch that needs it
- Or revert the import change to use the original path

### 5b: Version Bump

Only if ALL category branches pass build{VERIFY_SCOPE_SUFFIX}:
1. Set `FIRST_CATEGORY` to the first category slug that has a branch (e.g., `security` if it exists, otherwise the next in order)
2. Analyze all commits across ALL category branches to determine the aggregate SemVer bump:
   - Any `breaking:` or `BREAKING CHANGE` → **major**
   - Any `feat:` → **minor**
   - Otherwise (fix:, refactor:, security:, chore:) → **patch**
3. Check out `{BRANCH_PREFIX}/{FIRST_CATEGORY}` and bump the version there following the **{VERSION_BUMP_SECTION}** section of this command, then commit it as `chore: bump version to {NEW_VERSION}` and push.
4. If `HAS_CHANGELOG`, add an entry to `CHANGELOG_TARGET` in that project's established format and include it in the commit. Otherwise the commit message carries the change.

### 5c: Create PRs

For each category branch, create a PR. Its title takes the same conventional prefix as that branch's commit in 5a step 4. {COMMIT_PREFIX_RULE}

**GitHub:**
```bash
gh pr create --head {BRANCH_PREFIX}/{CATEGORY_SLUG} --base {DEFAULT_BRANCH} \
  --title "{prefix}: {short description}" \
  --body "$(cat <<'EOF'
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
{dependency info if applicable, e.g., "Depends on Security PR for shared helper exports" or "Independent — can be merged in any order"}
EOF
)"
```

**GitLab:**
```bash
glab mr create --source-branch {BRANCH_PREFIX}/{CATEGORY_SLUG} --target-branch {DEFAULT_BRANCH} \
  --title "{prefix}: {short description}" --description "..."
```

When `SIMPLIFY_ONLY=true`, add a line to each PR/MR body stating that the change is behavior-preserving and naming the safety net that verified it:

```markdown
Behavior-preserving refactor: no observable change to return values, side
effects, errors, or public API. Verified by `{TEST_CMD}` passing unmodified.
```

Record all `PR_NUMBERS` and `PR_URLS` in a map: `{category: {number, url}}`.

**GATE: If `--no-merge` was passed, STOP HERE.** Print all PR URLs and summary.

**GATE: If `VCS_HOST` is `gitlab`, STOP HERE.** Print all MR URLs and summary. The automated Phase 6 review loop + auto-merge run on GitHub PRs only; GitLab MRs are left open for manual review and merge.

## Phase 5d: CI Verification

After creating all PRs, verify CI passes on each one:

1. Wait 30 seconds for CI to start
2. For each PR, poll CI status:
   ```bash
   gh pr checks {PR_NUMBER}
   ```
   Poll every 30 seconds, max 10 minutes per PR.

3. If CI **passes** on all PRs → proceed to Phase 6

4. If CI **fails** on any PR:
   a. Fetch the failure logs:
      ```bash
      gh run view {RUN_ID} --job {JOB_ID} --log-failed
      ```
   b. Analyze the failure — common causes:
      - **Missing imports**: a file references a symbol that lives in another PR's branch. Fix by adding a backward-compatible {COMPAT_SHIM} or reverting the import.
      - **Test failures**: a test depends on code changed in the PR. Fix the test or the code.
      {CI_FAILURE_CAUSES_EXTRA}
   c. Switch to the failing branch:
      ```bash
      git checkout {BRANCH_PREFIX}/{CATEGORY_SLUG}
      ```
   d. Make the fix, commit, and push:
      ```bash
      git add <specific files>
      git commit -m "fix: resolve CI failure - {description}"
      git push
      ```
   e. Re-poll CI until it passes or max retries (3) are exhausted
   f. If CI still fails after 3 fix attempts, inform the user and continue with other PRs
