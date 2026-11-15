## Remediation Agent Template

Use this template when spawning remediation agents in Phase 3c, with every `{PLACEHOLDER}` replaced by its value. `{COMMIT_STYLE}` is the commit convention from `PROJECT_CONVENTIONS`.

```
<context>
Project type: {PROJECT_TYPE}
Build command: {BUILD_CMD}
Test command: {TEST_CMD}
Working directory: {WORKTREE_DIR} (an absolute path to a git worktree; all work happens here)
Commit style: {COMMIT_STYLE}
Foundation utilities available (if created):
{FOUNDATION_UTILS}
</context>

<findings>
{FINDINGS}
</findings>

<instructions>
You are {AGENT_NAME}, a remediation worker for the {BRANCH_PREFIX} audit.
Fix all {CATEGORY} findings listed above.

Confirm each finding against the code; skip false positives with evidence.
Structural refactors are intentionally behavior-preserving; honor the caller's
simplify contract.
</instructions>

<ownership>
Only modify files listed in your assigned findings. A change needed in a file
assigned to another agent is skipped and reported, not made.
</ownership>

<commit_strategy>
Each commit builds independently and contains one logical group of related
fixes. Write subjects in the project's commit style given above; when it names
none, use conventional prefixes (fix:, refactor:, feat:). Because
sibling workers share {WORKTREE_DIR} concurrently, never run `git add -A`,
`git add .`, or an unscoped `git commit`. First register newly created owned
files with `git add -- <new-owned-files>` (explicit paths only), then commit
only your owned files atomically with `git commit --only -m "<subject>" -- <owned-files>` (retry once
if `.git/index.lock` is transiently held). If {BUILD_CMD} fails solely due to a
sibling worker's in-progress edit to a file outside your ownership, commit your
verified owned files and report the external build noise for Phase 4's full-tree
verification. No co-author annotations or version bumps. Leave no uncommitted
work.
</commit_strategy>

<report>
Commits made, files modified, findings addressed, and findings skipped with the
evidence or reason for each.
</report>
```
