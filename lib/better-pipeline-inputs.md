## Shared Pipeline Inputs

Phases 3–7 are shared with `/do:better-swift`; resolve these inputs before Phase 3
(substitution rules are in `~/.claude/lib/better-verification.md`):

- `{BRANCH_PREFIX}` = `better`
- `{PIPELINE_LABEL}` = `better audit`
- `{PIPELINE_TITLE}` = `Better Audit`
- `{VERIFY_SCOPE_SUFFIX}` = *(empty — single build target)*
- `{VERIFY_SCOPE_NOTE}` = *(empty)*
- `{VERIFY_FAILURE_SCOPE}` = *(empty)*
- `{VERIFY_FAILURE_COMMIT_SLOT}` = *(empty)*
- `{VERIFY_STATUS_CLAUSE}` = *(empty)*
- `{REVIEW_CHECKLIST}` = `Review Preferences` (the section below)
- `{VERSION_BUMP_SECTION}` = `Version Bump Procedure` (the section below)
- `{SIMPLIFY_ONLY}` — `true` when `--simplify-only` / `--refactor-only` was passed, else `false`
- `{COMPAT_SHIM}` = `re-export`, `{COMPAT_HOST}` = `module`
- `{MULTI_CATEGORY_FILE_EXAMPLE}` = ``server/index.js`` with both security and stack-specific changes
- `{CATEGORY_SLUGS}` = `security`, `code-quality`, `dry`, `architecture`, `bugs-perf`, `stack-specific`, `deps`, `tests`, `ux` (UI projects only), `structural` (strict mode only), and `cognitive-load` (simplify-only mode)
- `{CATEGORY_SLUG_RULE}` = **When `SIMPLIFY_ONLY=true`**, the only possible slugs are the [`SIMPLIFY_CATEGORIES`](./better-simplify.md) ones
- `{COMMIT_PREFIX_RULE}` = **When `SIMPLIFY_ONLY=true`**, the per-category commit and its PR title take the `refactor:` prefix (the version bump stays `chore:`; build/review/CI fixes stay `fix:`)
- `{PR_BODY_SUMMARY_EXTRA}` = *(empty)*
- `{PR_BODY_EXTRA_SECTIONS}` = *(empty)*
- `{CI_FAILURE_CAUSES_EXTRA}` = a single bullet, indented to match the ones above it:

      - **Missing exports**: a module removed an export that other code still references. Fix by adding a re-export.

- `{REVIEW_LOOP_EXTRA_INSTRUCTION}` = *(empty)*
- `{REVIEW_STATUS_EXTRA}` = *(empty)*
- `{SUMMARY_TABLE_ROWS}` / `{SUMMARY_TABLE_ROW_RULES}` / `{SUMMARY_TABLE_FOOTER}` = see the **Final Summary Table** section below

### Review Preferences

The preferences Phase 4b reviews the remediation diff under:

!read lib/review-preferences.md

### Version Bump Procedure

The stack-specific half of Phase 5b, run on `better/{FIRST_CATEGORY}` with the
aggregate SemVer `{LEVEL}`: bump with the `VERSION_BUMP_CMD` ecosystem's native
version tool when installed (e.g. `npm version {LEVEL} --no-git-tag-version`),
otherwise edit the manifest's version field to `{NEW_VERSION}` and regenerate any
lockfile the tool would have touched. Stage only the files `git diff --name-only`
reports changed, never a hardcoded path. Commit as `chore: bump version to {NEW_VERSION}`.

### Final Summary Table

`{SUMMARY_TABLE_ROWS}` is a table with columns `Category | Findings | Fixed | Skipped | PR | CI | Review`: one row per Phase 2 category, by short label, then a `TOTAL` row (`N PRs` in its PR column), printed at column 0.

`{SUMMARY_TABLE_ROW_RULES}` (an instruction to you, never printed): omit the rows Phase 2 omits (UX, Structural, Cognitive Load by their conditions); when `SIMPLIFY_ONLY=true`, keep only the [`SIMPLIFY_CATEGORIES`](./better-simplify.md) rows and report every Test Enhancement stat as `— (skipped: --simplify-only)`.

`{SUMMARY_TABLE_FOOTER}` is empty — this pipeline prints nothing under the table.
