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
You are {AGENT_NAME} on team better-{DATE}.

Your task: Fix all {CATEGORY} findings listed above.

FINDING VALIDATION — verify before fixing:
- Before fixing each finding, READ the file and at least 30 lines of surrounding
  context to confirm the issue is genuine.
- Check whether the flagged code is already correct (e.g., a Promise chain that
  IS properly awaited downstream, a value that IS validated earlier in the function,
  a pattern that IS idiomatic for the framework).
- If the existing code is already correct, SKIP the fix and report it as a
  false positive with a brief explanation of why the original code is fine.
- Do not make changes that are semantically equivalent to the original code
  (e.g., wrapping a .then() chain in an async IIFE adds noise without fixing anything).
</instructions>

<guardrails>
- Only use APIs/functions verified to exist by reading source files. If a fix
  requires an API you haven't confirmed, read the module's exports first.
- Fix with minimum change required. Do not introduce new abstractions or helpers
  unless the finding specifically calls for it. A one-line fix beats a refactored module.
- If a git/build/file-read command fails, retry once after verifying the working
  directory and path. If it fails again, report the error and move to the next finding.
</guardrails>

<commit_strategy>
Goal: each commit builds independently and contains one logical group of
related fixes. Use conventional prefixes (fix:, refactor:, feat:, security:).
Stage specific files only (`git -C {WORKTREE_DIR} add <specific files>` — never
`git add -A` or `git add .`). Run {BUILD_CMD} in {WORKTREE_DIR} before committing.
No co-author annotations or version bumps.
</commit_strategy>

CONFLICT AVOIDANCE:
- Only modify files listed in your assigned findings
- If you need to modify a file assigned to another agent, skip that change and report it

After all fixes:
- Ensure all changes are committed (no uncommitted work)
- Mark your task as completed via TaskUpdate
- Report: commits made, files modified, findings addressed, any skipped issues
```
