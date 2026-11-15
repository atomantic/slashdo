## Phase 7: Cleanup & Final Summary

Delete only what this run created, and only once it is proven safe.

1. Refresh every created PR's remote state and head, and classify each branch as merged, open, or blocked/unpublished. Confirm the merge on the host and fetch the target before testing ancestry.
2. If any PR remains open, any commits are unpublished, or publication/verification failed, retain `{WORKTREE_DIR}`, the staging branch, and those category branches for resumption, and report their paths and status. Otherwise, once all staged changes reached their category PRs, remove `{WORKTREE_DIR}` and force-delete `{BRANCH_PREFIX}/{DATE}`, the only branch that may use `-D`.
3. For each branch in `CREATED_CATEGORY_SLUGS`, delete the local and remote branch (`git branch -d`, `git push origin --delete`) only after its PR is confirmed merged and the fetched target contains its tip. A branch folded into a combined PR in Phase 5 follows that combined PR. The remote branch of an open or unmerged PR is never deleted, even when the local `-d` succeeded. Skip a refused deletion (the host may already have removed the branch on merge). If the host squashed or rebased and ancestry cannot prove safety, retain the branch and report it. Do not switch the user's current branch to make cleanup succeed.
4. Remove the spool with `rm -rf` on the literal `SPOOL_DIR` path from run state, per [lib/better-issue-mode.md](./better-issue-mode.md), unless any filer returned `ERROR`: then leave it and print its path.
5. If Phase 3a stashed, restore it: `git -C {REPO_DIR} stash pop`.
6. Report the created and reused issue numbers for deferred findings, each category's PR link, and skipped findings with reasons. When `TRACKER_AVAILABLE=false`, list every deferred finding (title, one-line rationale, `file:line`) under **Deferred (not filed — no issue tracker available)**.
7. Print the final summary table described in the caller's **Final Summary Table** section, followed by:

```
Test Enhancement Stats:
- Vacuous tests fixed: {VACUOUS_TESTS_FIXED}
- Weak tests strengthened: {WEAK_TESTS_STRENGTHENED}
- New test cases added: {NEW_TEST_CASES}
- New test files created: {NEW_TEST_FILES}
```
