## Better pipeline — Cleanup & Final Summary (Phase 7)

The shared teardown every `better-*` audit pipeline runs after its PRs are
merged or left open. `/do:better` and `/do:better-swift` include this file
verbatim.

### Inputs

In addition to `{BRANCH_PREFIX}`, which every `better-*` command defines and
`~/.claude/lib/better-verification.md` documents:

- `{SUMMARY_TABLE_ROWS}` — the pipeline's category rows for the final summary
  table, one `| Category | … |` line per category it can produce, TOTAL row
  included.
- `{SUMMARY_TABLE_ROW_RULES}` — instructions to the agent about which rows to
  omit in which mode, or empty. Printed nowhere; read before building the table.
- `{SUMMARY_TABLE_FOOTER}` — extra line(s) that belong in the printed output
  under the table (e.g. platform / deployment-target lines), or empty.

## Phase 7: Cleanup

1. Refresh every created PR's remote state and head. Classify each branch as merged, open, or blocked/unpublished. A local `-d` refusal does not protect the remote branch: **never delete the remote branch for an open or unmerged PR**. Confirm remote merge and fetch the target before testing ancestry. Limit all deletion to artifacts created by this run.
2. If any PR remains open, any commits are unpublished, or publication/verification failed, retain `WORKTREE_DIR`, the staging branch, and those category branches for resumption; report their paths and status. Otherwise remove the worktree and staging branch after confirming all staged changes reached their category PRs:
   ```bash
   git worktree remove {WORKTREE_DIR}
   git branch -D {BRANCH_PREFIX}/{DATE}
   ```
   Only the intentionally unmerged staging branch may use `-D`. For each category in `CREATED_CATEGORY_SLUGS`, delete local/remote branches **only after** its PR is confirmed merged and the fetched target contains its tip. Use `git branch -d` locally and `git push origin --delete` remotely; skip a refused deletion. If the host used squash/rebase and ancestry cannot prove safety, retain the branch and report it. Do not change the user's current branch merely to make cleanup succeed.
3. **Issue mode — remove the spool.** Phase 4c was the last reader of `SPOOL_DIR`, so remove it using the literal path from run state:
   ```bash
   rm -rf "$SPOOL_DIR"
   ```
   **Unless any filer returned `ERROR`** — those findings were never filed, and their bodies exist nowhere else. Leave the directory and print its path so they can be filed by hand.
4. Restore stashed changes (if stashed in Phase 3a):
   ```bash
   git -C {REPO_DIR} stash pop
   ```
5. Update PLAN.md only outside issue mode (issue mode updates/reports tracker records):
   - Mark completed findings by flipping `- [ ]` → `- [x]` — **preserve the `[<slug>]` ID** on each line (only the box character changes, the slug stays). See [plan-id-format.md](./plan-id-format.md).
   - Add PR links to each category section header
   - Note any skipped findings with reasons
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
