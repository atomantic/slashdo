## Better pipeline — Verification & Internal Code Review (Phases 4 / 4b)

**Placeholder substitution, for this and every later `better-*` partial:** an empty value alone on its line drops that line entirely (no blank line, stray indent, or empty bullet); an empty value inside a line vanishes in place, collapsing the doubled space — never drop a whole instruction because one token in it is empty. A value landing in an indented list carries that list's indentation on every line.

## Phase 4: Verification

After all remediation agents return, `{BUILD_CMD}` and `{TEST_CMD}` must pass in `{WORKTREE_DIR}`{VERIFY_SCOPE_SUFFIX} before Phase 4b.
{VERIFY_SCOPE_NOTE}

On a failure{VERIFY_FAILURE_SCOPE}, find the commits that caused it and either fix it in a new commit (`fix: resolve {VERIFY_FAILURE_COMMIT_SLOT}build/test failure from {category} changes`) or revert them and record the findings as skipped. When `SIMPLIFY_ONLY=true`, the simplify contract's Phase 4 and 4b rules also apply.

<!-- if:teams -->
Then shut down all agents via `SendMessage` with `type: "shutdown_request"` and clean up the team via `TeamDelete`.
<!-- /if:teams -->

## Phase 4b: Internal Code Review

Before any PR exists, review the whole remediation diff (`git diff {DEFAULT_BRANCH}...HEAD` in `{WORKTREE_DIR}`) against the **{REVIEW_CHECKLIST}** section of this command. Fix each finding in its own `fix: {description of review finding}` commit, with `{BUILD_CMD}` and `{TEST_CMD}` passing again{VERIFY_SCOPE_SUFFIX} afterward.

By default, print a brief summary of findings and fixes and proceed to PR creation. Under `--interactive`, ask once: "Code review complete. {N} issues found and fixed. {list}. {VERIFY_STATUS_CLAUSE}Proceed to PR creation?" with options **Proceed** (create per-category PRs), **Commit directly** (merge into `{CURRENT_BRANCH}` — no PRs, no review loops), **Show diff** (print it and re-ask), and **Abort** (stop and print the worktree path).

**Commit directly** replaces Phases 5–7 entirely. On exit:
- Nothing is left uncommitted on `{BRANCH_PREFIX}/{DATE}` (remaining changes go in as `fix: {PIPELINE_LABEL} remediation — remaining changes`, specific files staged).
- `{BRANCH_PREFIX}/{DATE}` is merged into `{CURRENT_BRANCH}` in `{REPO_DIR}`. Only after a clean merge are `{WORKTREE_DIR}` and the staging branch removed; on a conflict both are kept and the user gets the resolve-then-remove commands.
- The stash is restored and the final summary (with filed or deferred issues) is printed. Stop there.
