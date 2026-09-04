## Shared Pipeline Inputs

Phases 4, 4b, 5, 5d, 6, and 7 below are the **shared `better-*` pipeline** — the
platform-agnostic mechanics this command runs verbatim with `/do:better-swift`
via `lib/better-*.md`. Everything that differs between the two commands arrives
through the inputs below, so a change to the pipeline lands in both by
construction. The substitution rules for them all (empty values drop their line;
indented values keep their indent) are in `~/.claude/lib/better-verification.md`.
Resolve these before Phase 4:

- `{BRANCH_PREFIX}` = `better` (staging branch `better/{DATE}`, category branches `better/{CATEGORY_SLUG}`)
- `{PIPELINE_LABEL}` = `better audit`
- `{PIPELINE_TITLE}` = `Better Audit`
- `{VERIFY_SCOPE_SUFFIX}` = *(empty — single build target)*
- `{VERIFY_SCOPE_NOTE}` = *(empty)*
- `{VERIFY_FAILURE_SCOPE}` = *(empty)*
- `{VERIFY_FAILURE_COMMIT_SLOT}` = *(empty)*
- `{VERIFY_STATUS_CLAUSE}` = *(empty)*
- `{REVIEW_CHECKLIST}` = `Code Review Checklist` (the section below)
- `{VERSION_BUMP_SECTION}` = `Version Bump Procedure` (the section below)
- `{SIMPLIFY_ONLY}` — `true` when `--simplify-only` / `--refactor-only` was passed, else `false`
- `{COMPAT_SHIM}` = `re-export`, `{COMPAT_HOST}` = `module`
- `{MULTI_CATEGORY_FILE_EXAMPLE}` = ``server/index.js`` with both security and stack-specific changes
- `{CATEGORY_SLUGS}` = `security`, `code-quality`, `dry`, `architecture`, `bugs-perf`, `stack-specific`, `deps`, `tests`, `ux` (UI projects only), `structural` (strict mode only), and `cognitive-load` (simplify-only mode)
- `{CATEGORY_SLUG_RULE}` = **When `SIMPLIFY_ONLY=true`**, the only possible slugs are the [`SIMPLIFY_CATEGORIES`](./better-simplify.md) ones
- `{COMMIT_PREFIX_RULE}` = **When `SIMPLIFY_ONLY=true`**, the per-category commit and its PR title take the `refactor:` prefix. This does not touch the pipeline's other mandated messages — the version bump stays `chore:`, and build/review/CI fixes stay `fix:`
- `{PR_BODY_SUMMARY_EXTRA}` = *(empty)*
- `{PR_BODY_EXTRA_SECTIONS}` = *(empty)*
- `{CI_FAILURE_CAUSES_EXTRA}` = a single bullet, indented to match the ones above it:

      - **Missing exports**: a module removed an export that other code still references. Fix by adding a re-export.

- `{REVIEW_LOOP_EXTRA_INSTRUCTION}` = *(empty)*
- `{REVIEW_STATUS_EXTRA}` = *(empty)*
- `{SUMMARY_TABLE_ROWS}` / `{SUMMARY_TABLE_ROW_RULES}` / `{SUMMARY_TABLE_FOOTER}` = see the **Final Summary Table** section below

### Code Review Checklist

The checklist Phase 4b reviews the remediation diff against:

!read lib/code-review-checklist.md

### Version Bump Procedure

The stack-specific half of Phase 5b — run on `better/{FIRST_CATEGORY}` once the
aggregate SemVer `{LEVEL}` has been determined. Phase 5b already gates this
section on `HAS_VERSION_BUMP=true`, so it never runs for a project with no
version convention of its own. Dispatch on `VERSION_BUMP_CMD` (Phase 0b). Where
the bump is a direct file edit rather than a native command, first read the
manifest's current version and apply `{LEVEL}` to it per SemVer to get
`{NEW_VERSION}`, then write that value into the file:

- **`npm`** (Node — `package.json`):
  ```bash
  npm version {LEVEL} --no-git-tag-version
  git diff --name-only -z -- package.json '**/package.json' package-lock.json '**/package-lock.json' | xargs -0 git add
  ```
- **`cargo`** (Rust — `Cargo.toml`): probe in order — `cargo release version {LEVEL} --execute` if `cargo-release` is installed (`command -v cargo-release`; the bare form is a dry run), else `cargo set-version --bump {LEVEL}` if `cargo-edit` is installed (`command -v cargo-set-version`; its positional argument takes a concrete version, not a level keyword), else edit the `version = "x.y.z"` line directly to `{NEW_VERSION}` and run `cargo update -p <crate name from Cargo.toml>` to refresh the lockfile. Then:
  ```bash
  git diff --name-only -z -- Cargo.toml '**/Cargo.toml' Cargo.lock | xargs -0 git add
  ```
- **`python`** (Python — `pyproject.toml`): `poetry version {LEVEL}` for a Poetry project, else edit the `[project] version = "..."` (or `[tool.poetry] version = "..."`) line directly to `{NEW_VERSION}`. Then:
  ```bash
  git diff --name-only -z -- pyproject.toml '**/pyproject.toml' poetry.lock | xargs -0 git add
  ```
- **`java`** (Java/Kotlin — `pom.xml` / `build.gradle` / `build.gradle.kts`): edit the `<version>` element (Maven) or `version = "..."` assignment (Gradle) directly to `{NEW_VERSION}`. Then:
  ```bash
  git diff --name-only -z -- pom.xml '**/pom.xml' build.gradle '**/build.gradle' build.gradle.kts '**/build.gradle.kts' | xargs -0 git add
  ```
- **`ruby`** (Ruby — a gemspec or `lib/**/version.rb`): edit the `VERSION = "..."` constant directly to `{NEW_VERSION}` in `lib/**/version.rb` if that file exists (the common convention — the gemspec then reads `spec.version = SomeModule::VERSION`), else edit the gemspec's own `spec.version = "..."` (or `.version = "..."`) assignment directly. Then:
  ```bash
  git diff --name-only -z -- '*.gemspec' 'lib/**/version.rb' '**/lib/**/version.rb' | xargs -0 git add
  ```
- **`dotnet`** (.NET — `*.csproj`): edit the `<Version>` element directly to `{NEW_VERSION}`. Then:
  ```bash
  git diff --name-only -z -- '*.csproj' | xargs -0 git add
  ```

Every branch stages only the files the bump actually modified via
`git diff --name-only`, never a hardcoded path — a Node project without
`package-lock.json` has nothing there to fail on, since an absent file simply
never appears in that diff.

### Final Summary Table

The rows Phase 7 prints (`{SUMMARY_TABLE_ROWS}`), at column 0 in the printed block:

      | Category           | Findings | Fixed | Skipped | PR       | CI     | Review   |
      |--------------------|----------|-------|---------|----------|--------|----------|
      | Security & Secrets | ...      | ...   | ...     | #number  | pass   | approved |
      | Code Quality       | ...      | ...   | ...     | #number  | pass   | approved |
      | DRY & YAGNI        | ...      | ...   | ...     | #number  | pass   | approved |
      | Architecture       | ...      | ...   | ...     | #number  | pass   | approved |
      | Bugs & Perf        | ...      | ...   | ...     | #number  | pass   | approved |
      | Stack-Specific     | ...      | ...   | ...     | #number  | pass   | approved |
      | Dep Freedom        | ...      | ...   | ...     | #number  | pass   | approved |
      | Tests              | ...      | ...   | ...     | #number  | pass   | approved |
      | UX                 | ...      | ...   | ...     | #number  | pass   | approved |
      | Structural         | ...      | ...   | ...     | #number  | pass   | approved |
      | Cognitive Load     | ...      | ...   | ...     | #number  | pass   | approved |
      | TOTAL              | ...      | ...   | ...     | N PRs    |        |          |

The rules for which of those rows to include (`{SUMMARY_TABLE_ROW_RULES}` — an
instruction to you, never printed):

> Omit the **UX** row when `HAS_UI=false`, the **Structural** row when `STRICT_MODE=false`, and the **Cognitive Load** row when `SIMPLIFY_ONLY=false`. When `SIMPLIFY_ONLY=true`, keep only the [`SIMPLIFY_CATEGORIES`](./better-simplify.md) rows and report every Test Enhancement stat below as `— (skipped: --simplify-only)`.

`{SUMMARY_TABLE_FOOTER}` is empty — this pipeline prints nothing under the table.

---
