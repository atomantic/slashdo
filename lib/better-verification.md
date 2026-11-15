## Phase 4: Verification

After all remediation workers return, `{BUILD_CMD}` and `{TEST_CMD}` must pass in `{WORKTREE_DIR}` before Phase 4b.

On a failure, find the commits that caused it and either fix it in a new commit (fallback subject `fix: resolve build/test failure from {category} changes`) or revert them and record the findings as skipped. When `SIMPLIFY_ONLY=true`, the simplify contract's Phase 4 and 4b rules also apply.

<!-- if:teams -->
Then shut down all agents via `SendMessage` with `type: "shutdown_request"` and clean up the team via `TeamDelete`.
<!-- /if:teams -->

## Phase 4b: Internal Code Review

Before any PR exists, review the whole remediation diff (`git diff {DEFAULT_BRANCH}...HEAD` in `{WORKTREE_DIR}`) against the **{REVIEW_CHECKLIST}** section of this command. Fix each finding in its own commit (fallback subject `fix: {description of review finding}`), with `{BUILD_CMD}` and `{TEST_CMD}` passing again afterward.

By default, print a brief summary of findings and fixes and proceed to PR creation. Under `--interactive`, ask the user once: "Code review complete. {N} issues found and fixed. {list}. Proceed to PR creation?" with the choices **Proceed** (create per-category PRs), **Commit directly** (merge into `{CURRENT_BRANCH}`, with no PRs and no review loops), **Show diff** (print it and ask again), and **Abort** (stop and print the worktree path).

**Commit directly** replaces Phases 5–7 entirely. On exit:
- Nothing is left uncommitted on `{BRANCH_PREFIX}/{DATE}`; any remaining changes are committed with specific files staged.
- `{BRANCH_PREFIX}/{DATE}` is merged into `{CURRENT_BRANCH}` in `{REPO_DIR}`. Only after a clean merge are `{WORKTREE_DIR}` and the staging branch removed; on a conflict both are kept and the user gets the resolve-then-remove commands.
- The stash is restored and the final summary (with filed or deferred issues) is printed. Stop there.
