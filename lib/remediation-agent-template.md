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
You are {AGENT_NAME}, a remediation worker for the better-{DATE} audit.
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
fixes. Use conventional prefixes (fix:, refactor:, feat:, security:). Stage
specific files only — never `git add -A` or `git add .`. Run {BUILD_CMD} in
{WORKTREE_DIR} before committing. No co-author annotations or version bumps.
Leave no uncommitted work.
</commit_strategy>

<report>
Commits made, files modified, findings addressed, and findings skipped with the
evidence or reason for each (when running as a team task, also mark the task
completed via TaskUpdate).
</report>
```
