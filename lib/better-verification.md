## Better pipeline — Verification & Internal Code Review (Phases 4 / 4b)

The shared build-and-review gate every `better-*` audit pipeline runs after its
remediation agents finish and before it creates any PR. `/do:better` and
`/do:better-swift` include this file verbatim; the differences between them are
carried entirely by the inputs below, so a change to the gate applies to both by
construction.

### Inputs

The calling command must have resolved these before reaching Phase 4:

- `{BRANCH_PREFIX}` — the pipeline's branch namespace, without a trailing slash
  (`better` for `/do:better`, `better-swift` for `/do:better-swift`). The staging
  branch is `{BRANCH_PREFIX}/{DATE}`.
- `{PIPELINE_LABEL}` — human name of the run used in commit subjects
  (`better audit`, `better-swift audit`).
- `{VERIFY_SCOPE_SUFFIX}` — a prose phrase appended to every build/test
  instruction to widen its scope, or **empty** for a single-target project. A
  multi-platform pipeline sets it to ` on ALL supported platforms` (leading
  space included). The PR/CI partial reads it too, so define it once for the
  whole run.
- `{VERIFY_SCOPE_NOTE}` — one extra sentence spelling out that scope
  requirement, or empty. A multi-platform pipeline names its platform set here
  (e.g. "This must succeed for every platform in `PLATFORMS`. A fix that works
  on iOS but breaks macOS is not acceptable.").
- `{VERIFY_FAILURE_SCOPE}` — how a failure is scoped in the "if the build
  fails" branch, or **empty** for a single target (e.g. ` on any platform`).
- `{VERIFY_FAILURE_COMMIT_SLOT}` — the leading slot in the build-failure commit
  subject, or **empty** (a multi-platform pipeline sets it to `{platform} ` so
  the failing platform is a required field, not an afterthought).
- `{VERIFY_STATUS_CLAUSE}` — an extra sentence (trailing space included)
  appended to the interactive review summary, or empty (e.g. "All {PLATFORMS}
  platforms build and test successfully. ").
- `{REVIEW_CHECKLIST}` — the name of the code-review checklist section the
  calling command defines inline; each pipeline includes a different checklist
  lib. Step 2 of Phase 4b reviews the diff against that section.
- `{SIMPLIFY_ONLY}` — `true` only in a refactor-only run that promised identical
  behavior. Pipelines with no such mode leave it `false`, which makes every
  clause below gated on it inert.
- Plus the pipeline's own `{WORKTREE_DIR}`, `{REPO_DIR}`, `{CURRENT_BRANCH}`,
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

After all agents complete:

1. Run the full build in the worktree{VERIFY_SCOPE_SUFFIX}:
   ```bash
   cd {WORKTREE_DIR} && {BUILD_CMD}
   ```
   {VERIFY_SCOPE_NOTE}

2. Run tests in the worktree{VERIFY_SCOPE_SUFFIX}:
   ```bash
   cd {WORKTREE_DIR} && {TEST_CMD}
   ```
3. If build or tests fail{VERIFY_FAILURE_SCOPE}:
   - Identify which commits caused the failure via `git bisect` or manual review
   - Attempt to fix in a new commit: `fix: resolve {VERIFY_FAILURE_COMMIT_SLOT}build/test failure from {category} changes`
   - If unfixable, revert the problematic commit(s): `git -C {WORKTREE_DIR} revert <sha>` and note which findings were skipped
   - **When `SIMPLIFY_ONLY=true`**, a failing test is a regression by definition — the run promised identical behavior. Fix the refactor or revert it; do not edit the test to match the new behavior
<!-- if:teams -->
4. Shut down all agents via `SendMessage` with `type: "shutdown_request"`
5. Clean up team via `TeamDelete`
<!-- else -->
4. No teardown needed — the parallel sub-agents from Phase 3c have already returned.
<!-- /if:teams -->

## Phase 4b: Internal Code Review

Before creating PRs, run a deep code review on all remediation changes to catch issues that automated agents may have introduced.

1. Generate the diff of all changes in the worktree:
   ```bash
   cd {WORKTREE_DIR} && git diff {DEFAULT_BRANCH}...HEAD
   ```
2. Review the diff against the **{REVIEW_CHECKLIST}** section of this command.

   **When `SIMPLIFY_ONLY=true`**, carry one extra question through this same pass: *does any hunk change what this program does?* — different return value, different side effect, different error type or message, changed validation, changed output format, changed public API without a re-export. Every such hunk is reverted, not fixed. Then dispose of the finding behind it: if the improvement is still worth making in a run that's allowed to change behavior, **defer** it (an open PLAN.md item / tracker issue noting it needs behavior review); if the transformation cannot be done at all without changing behavior it must not change, record it as a rejection per gate 4 of the run's **Finding gates** section.<!-- Not a link: #finding-gates is an anchor in /do:better only, and this partial is shared. -->
3. For each issue found:
   - Fix in a new commit: `fix: {description of review finding}`
   - Re-run `{BUILD_CMD}` and `{TEST_CMD}`{VERIFY_SCOPE_SUFFIX} to verify
4. **Default mode**: Print a brief summary of findings and fixes, then proceed to PR creation automatically.
   **Interactive mode (`--interactive`)**: Present a summary to the user via `AskUserQuestion`:
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
5. (Interactive only) If "Show diff" selected, print the diff and re-ask. If "Abort", stop and print the worktree path.
6. If "Commit directly" selected:
   - All remediation and review fixes are already committed incrementally in the worktree branch `{BRANCH_PREFIX}/{DATE}`. If any uncommitted changes remain, stage and commit them now:
     ```bash
     cd {WORKTREE_DIR}
     git diff --quiet && git diff --cached --quiet || {
       git add <list of remaining changed files>
       git commit -m "fix: {PIPELINE_LABEL} remediation — remaining changes"
     }
     ```
   - Return to the main repo checkout, merge the worktree branch, and clean up on success:
     ```bash
     cd {REPO_DIR}
     git checkout {CURRENT_BRANCH}
     if git merge {BRANCH_PREFIX}/{DATE}; then
       git worktree remove {WORKTREE_DIR}
       git branch -D {BRANCH_PREFIX}/{DATE}
     else
       echo "Merge conflict — resolve in {REPO_DIR}, then run:"
       echo "  git worktree remove {WORKTREE_DIR}"
       echo "  git branch -D {BRANCH_PREFIX}/{DATE}"
     fi
     ```
   - Restore stash if needed (`git stash pop`), update PLAN.md, print final summary, then **stop** — this completes the workflow (Phases 5, 6, and 7 are skipped entirely since no PRs or category branches were created)
