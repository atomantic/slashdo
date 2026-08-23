# Better pipeline — Cleanup & Final Summary (Phase 7)

The shared teardown every `better-*` audit pipeline runs after its PRs are
merged or left open. `/do:better` and `/do:better-swift` include this file
verbatim.

## Inputs

In addition to `{BRANCH_PREFIX}` (defined in `~/.claude/lib/better-verification.md`):

- `{SUMMARY_TABLE_ROWS}` — the pipeline's category rows for the final summary
  table, one `| Category | … |` line per category it can produce, TOTAL row
  included.
- `{SUMMARY_TABLE_NOTES}` — the notes that follow the table (which rows to omit
  in which mode, any platform/target lines), or empty.

## Phase 7: Cleanup

1. Remove the worktree:
   ```bash
   git worktree remove {WORKTREE_DIR}
   ```
2. Delete the local staging branch and per-category branches (local + remote). Use the tracked list of branches from Phase 5 rather than a fixed list:
   ```bash
   git checkout {DEFAULT_BRANCH}
   git branch -D {BRANCH_PREFIX}/{DATE}
   # CREATED_CATEGORY_SLUGS is a space-delimited string, e.g. "security code-quality tests"
   for slug in $CREATED_CATEGORY_SLUGS; do
     git branch -d "{BRANCH_PREFIX}/$slug" || echo "warning: local branch {BRANCH_PREFIX}/$slug not found or not fully merged — skipping (use -D to force)"
     git push origin --delete "{BRANCH_PREFIX}/$slug" || echo "warning: remote branch {BRANCH_PREFIX}/$slug not found or already deleted"
   done
   ```
   `-D` (force delete) is used only for the staging branch `{BRANCH_PREFIX}/{DATE}` because it is intentionally unmerged — its file contents are cherry-picked into category branches. Category branches use `-d` (safe delete) so that unmerged work is not accidentally lost; if a category branch was not merged, the warning will surface it. The guards prevent errors from interrupting cleanup.
3. **Issue mode — remove the spool.** Phase 4c was the last reader of `SPOOL_DIR`, so remove it using the literal path from run state:
   ```bash
   rm -rf "$SPOOL_DIR"
   ```
   **Unless any filer returned `ERROR`** — those findings were never filed, and their bodies exist nowhere else. Leave the directory and print its path so they can be filed by hand.
4. Restore stashed changes (if stashed in Phase 3a):
   ```bash
   git stash pop
   ```
5. Update PLAN.md:
   - Mark completed findings by flipping `- [ ]` → `- [x]` — **preserve the `[<slug>]` ID** on each line (only the box character changes, the slug stays). See [plan-id-format.md](./plan-id-format.md).
   - Add PR links to each category section header
   - Note any skipped findings with reasons
6. Print the final summary table:

```
{SUMMARY_TABLE_ROWS}

{SUMMARY_TABLE_NOTES}

Test Enhancement Stats:
- Vacuous tests fixed: {VACUOUS_TESTS_FIXED}
- Weak tests strengthened: {WEAK_TESTS_STRENGTHENED}
- New test cases added: {NEW_TEST_CASES}
- New test files created: {NEW_TEST_FILES}
```
