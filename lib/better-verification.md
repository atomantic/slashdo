## Better pipeline — Verification & Internal Code Review (Phases 4 / 4b)

### Inputs

The calling command must have resolved these before reaching Phase 4:
`{BRANCH_PREFIX}`, `{PIPELINE_LABEL}`, `{VERIFY_SCOPE_SUFFIX}`,
`{VERIFY_SCOPE_NOTE}`, `{VERIFY_FAILURE_SCOPE}`, `{VERIFY_FAILURE_COMMIT_SLOT}`,
`{VERIFY_STATUS_CLAUSE}`, `{REVIEW_CHECKLIST}`, `{SIMPLIFY_ONLY}`, plus the
pipeline's own `{WORKTREE_DIR}`, `{REPO_DIR}`, `{CURRENT_BRANCH}`,
`{DEFAULT_BRANCH}`, `{DATE}`, `{BUILD_CMD}`, and `{TEST_CMD}`.

**Substitution rules for every input above, and for the other `better-*`
partials.**

- An **empty** value that stands **alone on its line** drops that line entirely —
  no blank line, no stray indent, no empty bullet in its place.
- An **empty** value **inside a line** vanishes in place; keep the rest of the
  line and collapse the doubled space it leaves behind. Most placeholders are of
  this kind, so never drop a whole instruction because the token in it is empty.
- A value that lands inside an indented list carries that list's indentation on
  every one of its lines. A value pasted at column 0 inside a lettered or
  numbered sub-list terminates the list and orphans the steps after it.

## Phase 4: Verification

After all remediation agents return, `{BUILD_CMD}` and `{TEST_CMD}` must pass in `{WORKTREE_DIR}`{VERIFY_SCOPE_SUFFIX} before Phase 4b.
{VERIFY_SCOPE_NOTE}

On a failure{VERIFY_FAILURE_SCOPE}, find the commits that caused it and either fix it in a new commit (`fix: resolve {VERIFY_FAILURE_COMMIT_SLOT}build/test failure from {category} changes`) or revert them (`git -C {WORKTREE_DIR} revert <sha>`) and record the findings as skipped. **When `SIMPLIFY_ONLY=true`**, a failing test is a regression by definition — the run promised identical behavior. Fix the refactor or revert it; do not edit the test to match the new behavior.

<!-- if:teams -->
Then shut down all agents via `SendMessage` with `type: "shutdown_request"` and clean up the team via `TeamDelete`.
<!-- /if:teams -->

## Phase 4b: Internal Code Review

Before any PR exists, review the whole remediation diff (`git diff {DEFAULT_BRANCH}...HEAD` in `{WORKTREE_DIR}`) against the **{REVIEW_CHECKLIST}** section of this command.

**When `SIMPLIFY_ONLY=true`**, carry one extra question through this same pass: *does any hunk change what this program does?* — different return value, different side effect, different error type or message, changed validation, changed output format, changed public API without a re-export. Every such hunk is reverted, not fixed. Then dispose of the finding behind it: if the improvement is still worth making in a run that's allowed to change behavior, **defer** it (a tracker issue noting it needs behavior review); if the transformation cannot be done at all without changing behavior it must not change, record it as a rejection per gate 4 of the run's **Finding gates** section.<!-- Not a link: #finding-gates is an anchor in /do:better only, and this partial is shared. -->

Fix each review finding in its own `fix: {description of review finding}` commit, with `{BUILD_CMD}` and `{TEST_CMD}` passing again{VERIFY_SCOPE_SUFFIX} afterward.

**Default mode**: print a brief summary of findings and fixes, then proceed to PR creation.
**Interactive mode (`--interactive`)**:
```
AskUserQuestion([{
  question: "Code review complete. {N} issues found and fixed. {list}. {VERIFY_STATUS_CLAUSE}Proceed to PR creation?",
  options: [
    { label: "Proceed", description: "Create per-category PRs" },
    { label: "Commit directly", description: "Merge worktree changes into {CURRENT_BRANCH} — no PRs, no review loops" },
    { label: "Show diff", description: "Show the full diff for manual review before proceeding" },
    { label: "Abort", description: "Stop here — I'll review manually" }
  ]
}])
```
"Show diff" prints the diff and re-asks. "Abort" stops and prints the worktree path.

**"Commit directly"** replaces Phases 5–7 entirely (no category branches or PRs exist). On exit:
- Nothing is left uncommitted on `{BRANCH_PREFIX}/{DATE}` (remaining changes go in as `fix: {PIPELINE_LABEL} remediation — remaining changes`, specific files staged).
- `{BRANCH_PREFIX}/{DATE}` is merged into `{CURRENT_BRANCH}` in `{REPO_DIR}`. Only after a clean merge are `{WORKTREE_DIR}` and the staging branch removed; on a merge conflict both are kept and the user gets the resolve-then-remove commands.
- The stash is restored and the final summary (with filed or deferred issues) is printed. Stop there.
