## Phase 7: Cleanup & Final Summary

1. Refresh every created PR's remote state and head. Classify each branch as merged, open, or blocked/unpublished. A local `-d` refusal does not protect the remote branch: **never delete the remote branch for an open or unmerged PR**. Confirm remote merge and fetch the target before testing ancestry. Limit all deletion to artifacts created by this run.
2. If any PR remains open, any commits are unpublished, or publication/verification failed, retain `WORKTREE_DIR`, the staging branch, and those category branches for resumption; report their paths and status. Otherwise, once all staged changes reached their category PRs, remove `{WORKTREE_DIR}` and force-delete `{BRANCH_PREFIX}/{DATE}` — the only branch that may use `-D`. For each category in `CREATED_CATEGORY_SLUGS`, delete local/remote branches **only after** its PR is confirmed merged and the fetched target contains its tip (`git branch -d`, `git push origin --delete`); skip a refused deletion. If the host used squash/rebase and ancestry cannot prove safety, retain the branch and report it. Do not change the user's current branch merely to make cleanup succeed.
3. **Issue mode — remove the spool.** `rm -rf "$SPOOL_DIR"` with the literal path from run state, per [lib/better-issue-mode.md](./better-issue-mode.md) — **Unless any filer returned `ERROR`**: then leave it and print its path.
4. If Phase 3a stashed, restore it: `git -C {REPO_DIR} stash pop`.
5. Outside issue mode, update PLAN.md: flip completed findings `- [ ]` → `- [x]` **preserving each `[<slug>]` ID** (see [plan-id-format.md](./plan-id-format.md)), add PR links to each category section header, and note skipped findings with reasons. Issue mode updates/reports tracker records instead.
6. Print the final summary table. {SUMMARY_TABLE_ROW_RULES}

```
{SUMMARY_TABLE_ROWS}
{SUMMARY_TABLE_FOOTER}

Test Enhancement Stats:
- Vacuous tests fixed: {VACUOUS_TESTS_FIXED}
- Weak tests strengthened: {WEAK_TESTS_STRENGTHENED}
- New test cases added: {NEW_TEST_CASES}
- New test files created: {NEW_TEST_FILES}
```
