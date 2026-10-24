## Remediation Agent Template

Use this template when spawning remediation agents in Phase 3c. Replace all `{PLACEHOLDERS}` with actual values.

```
<context>
Project type: {PROJECT_TYPE}
Build command: {BUILD_CMD}
Test command: {TEST_CMD}
Working directory: {WORKTREE_DIR} (this is a git worktree — all work happens here)
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
fixes. Use conventional prefixes (fix:, refactor:, feat:, security:). Because
sibling workers share {WORKTREE_DIR} concurrently, never run `git add -A`,
`git add .`, or an unscoped `git commit` — commit only your owned files
atomically with `git commit --only -m "<subject>" -- <owned-files>` (retry once
if `.git/index.lock` is transiently held). If {BUILD_CMD} fails solely due to a
sibling worker's in-progress edit to a file outside your ownership, commit your
verified owned files and report the external build noise for Phase 4's full-tree
verification. No co-author annotations or version bumps. Leave no uncommitted
work.
</commit_strategy>

<report>
Commits made, files modified, findings addressed, and findings skipped with the
evidence or reason for each (when running as a team task, also mark the task
completed via TaskUpdate).
</report>
```
