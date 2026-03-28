---
description: Learn from PR review feedback to improve the self-review checklist and multi-agent review process
argument-hint: "<PR URL or owner/repo#number>"
---

# Improve Review System from PR Feedback

Analyze code review feedback on a PR, identify patterns our review system missed, update the master checklist and agent-specific instruction files, and evaluate whether the agent architecture itself needs restructuring.

## Architecture Overview

The `/do:review` system uses 3 parallel agents, each with focused reading strategies:

| Agent | File | Focus |
|---|---|---|
| Surface Scan | `lib/review-surface-scan.md` | Per-file bugs: runtime, hygiene, domain-specific, quality, conventions |
| Security Audit | `lib/review-security-audit.md` | Trust boundaries, injection, SSRF, data exposure, access control |
| Cross-File Tracing | `lib/review-cross-file-tracing.md` | Cross-file contracts, state flows, lifecycle, deep tracing checks |

Additionally:
- `lib/code-review-checklist.md` — master source-of-truth (canonical reference, not directly used by agents)
- `commands/do/review.md` — orchestrator (dispatches agents, deduplicates, fixes, reports)

## Phase 1: Parse Input & Fetch Feedback

### 1a: Parse PR reference

Extract owner, repo, and PR number from `$ARGUMENTS`. Accept formats:
- `https://github.com/owner/repo/pull/123`
- `owner/repo#123`
- `#123` (uses current repo via `gh repo view --json owner,name`)

```bash
# Example extraction from URL:
echo "$URL" | sed -E 's|.*/([^/]+)/([^/]+)/pull/([0-9]+).*|\1 \2 \3|'
```

If no argument is provided, ask the user for a PR URL.

### 1b: Fetch all review comments

Use GraphQL to fetch review threads with resolution state, inline comments, and review bodies in a single query:
```bash
gh api graphql --paginate -f query='{ repository(owner: "{OWNER}", name: "{REPO}") { pullRequest(number: {PR_NUM}) { reviewThreads(first: 100) { nodes { isResolved comments(first: 10) { nodes { body path line author { login } } } } } reviews(first: 50) { nodes { body state author { login } submittedAt } } } } }'
```

Save the result to `/tmp/improve-review-data.json`.

### 1c: Extract actionable feedback

From the raw comments, extract only **actionable code review feedback** — comments that identify bugs, anti-patterns, missing validation, security issues, or correctness problems. Skip:
- Purely informational comments ("nice work", "looks good")
- Style-only comments that don't affect correctness
- Comments the PR author already addressed (threads where `isResolved: true` in the GraphQL response)
- Duplicate comments across review rounds (same issue flagged again after a fix attempt counts once)

For each actionable comment, record:
- **file path** and **line number**
- **category** (bug, security, validation, error handling, async, data integrity, testing, etc.)
- **gist**: one-sentence summary of what the reviewer caught
- **root cause**: why our self-review missed this (what general principle was violated?)

## Phase 2: Thematic Analysis

### 2a: Cluster feedback into themes

Group the extracted comments by root cause, not by file or reviewer. Examples of themes:
- "Server trusts client-computed values" (not "meatspacePost.js line 88")
- "Async operation failure leaves UI in wrong state" (not "PostTab.jsx line 34")
- "Schema accepts fields the implementation ignores" (not "postValidation.js line 45")

For each theme, record:
- **theme name**: generic description of the pattern
- **count**: how many comments relate to this theme
- **representative examples**: 2-3 specific comments that illustrate it

### 2b: Generalize themes

For each theme, write a **generic, technology-agnostic checklist item** that would catch this class of bug in any codebase. Rules for generalization:

1. **Database-agnostic**: Replace "PostgreSQL", "SQLite", "MongoDB" references with "database" or "data store".
2. **Framework-agnostic**: Replace "React", "Express", "Next.js" with the general concept ("UI component", "route handler", "server framework"). Keep framework-specific terms only when genuinely framework-specific.
3. **Consolidate related items**: If three comments boil down to "validate inputs at the API boundary", write ONE checklist item. Mention variants inline.
4. **Action-oriented**: Pattern: `{thing to look for} — {consequence if missed}`.
5. **Concise**: One to two sentences max per item.
6. **Subsumable**: Check if an existing item could be broadened instead. Prefer widening over adding.

### 2c: Assign each theme to an agent

For each generalized theme, determine which agent **should have caught it** based on the reading strategy required:

- **Surface Scan** — catchable by reading a single file in isolation (per-file runtime bugs, hygiene, domain-specific issues, quality, conventions)
- **Security Audit** — requires adversarial thinking about trust boundaries, injection, data exposure, access control
- **Cross-File Tracing** — requires tracing call chains, data flows, or contracts across multiple files
- **None (new agent needed)** — requires a fundamentally different reading strategy not covered by any existing agent
- **Orchestrator** — requires changes to how agents are dispatched, how findings are collected, or how the review is scoped

Record this assignment for each theme — it determines which files to update in Phase 4.

## Phase 3: Diff Against Existing System

### 3a: Read current files

Read all source-of-truth files:
```
lib/code-review-checklist.md          # master checklist
lib/review-surface-scan.md            # surface scan agent
lib/review-security-audit.md          # security agent
lib/review-cross-file-tracing.md      # cross-file agent
commands/do/review.md                 # orchestrator
```

### 3b: Classify each theme

For each generalized theme, classify it as:

- **Already covered**: An existing item in the assigned agent already catches this. Note which item and which agent file.
- **Covered but wrong agent**: An existing item catches this, but it's in the wrong agent (e.g., a cross-file check sitting in the surface scan agent). Note the misplacement.
- **Partially covered**: An existing item is close but could be broadened. Note the item, the gap, and which agent file(s).
- **Not covered**: No existing item catches this. Note which agent should own it.

### 3c: Check for structural issues

Beyond individual items, evaluate the agent architecture:

1. **Agent scope drift** — Has any agent accumulated items that belong to a different agent's reading strategy? (e.g., the surface scan agent has items requiring cross-file tracing, or the security agent has generic quality checks)
2. **Coverage gaps between agents** — Are there categories of bugs that fall between agents? (e.g., items requiring both adversarial thinking AND cross-file tracing that neither agent prioritizes)
3. **Agent overload** — Has any agent grown so large that attention dilution is likely? Count items per agent and flag if any exceeds ~80 items.
4. **Missing agent** — Would a new specialized agent (with a distinct reading strategy) catch a recurring class of issues better than broadening existing agents?

### 3d: Check for consolidation opportunities

Scan each agent file for:
- Redundant items within the same agent
- Items across agents that overlap (some overlap is intentional for critical checks; flag only excessive duplication)
- Items that could be folded under a broader principle

## Phase 4: Update Files

### 4a: Update master checklist

For each theme:
- **Already covered**: Skip.
- **Partially covered**: Broaden the existing item in `lib/code-review-checklist.md`.
- **Not covered**: Add new item under the appropriate section.

Rules:
- Maintain existing formatting (indented bullets with bold section headers)
- No project-specific references, file names, or variable names
- No language-specific items unless in a clearly language-scoped section

### 4b: Update agent files

For each theme, update the **assigned agent's instruction file** (`lib/review-surface-scan.md`, `lib/review-security-audit.md`, or `lib/review-cross-file-tracing.md`):

- **New item**: Add under the most appropriate section in the agent file
- **Broadened item**: Edit the existing item in the agent file to match the broadened master
- **Misplaced item**: Move from the current agent file to the correct one
- **Wrong agent**: If a theme was found in one agent but belongs in another, move the item

When adding items to agent files:
- Match the agent file's existing style (more concise than the master checklist)
- Place adjacent to related items
- Include the key pattern + consequence, not every sub-clause from the master

### 4c: Update orchestrator (if needed)

Edit `commands/do/review.md` if:
- A new agent is being added (add its dispatch section)
- Agent dispatch instructions need updating (e.g., new context to pass)
- The deduplication or reporting logic needs changes

### 4d: Consolidation pass

After all updates, re-read each modified file and check:
- No formatting errors
- No duplicate items within any file
- No project-specific language
- Items flow logically within their sections
- Agent files haven't grown past ~80 items

### 4e: Sync to installed locations

```bash
cp lib/code-review-checklist.md ~/.claude/lib/code-review-checklist.md
cp lib/review-surface-scan.md ~/.claude/lib/review-surface-scan.md
cp lib/review-security-audit.md ~/.claude/lib/review-security-audit.md
cp lib/review-cross-file-tracing.md ~/.claude/lib/review-cross-file-tracing.md
cp commands/do/review.md ~/.claude/commands/do/review.md
```

## Phase 5: Report

```
## Review Learning Summary

**Actionable comments**: {N} comments across {M} themes

### Themes Identified
| Theme | Comments | Agent | Status |
|---|---|---|---|
| {theme name} | {count} | Surface/Security/Cross-File | Added / Broadened / Moved / Already covered |

### Checklist Changes
- **Added**: {N} new items
- **Broadened**: {N} existing items updated
- **Moved between agents**: {N} items reassigned
- **Consolidated**: {N} items merged
- **Unchanged**: {N} themes already covered

### Files Modified
| File | Items Added | Items Broadened | Items Moved In | Items Moved Out |
|---|---|---|---|---|
| code-review-checklist.md | N | N | — | — |
| review-surface-scan.md | N | N | N | N |
| review-security-audit.md | N | N | N | N |
| review-cross-file-tracing.md | N | N | N | N |
| review.md (orchestrator) | — | — | — | — |

### New/Modified Items
{list each item with brief explanation of the pattern it catches and which agent owns it}

### Architecture Assessment
- **Agent balance**: Surface({N} items) / Security({N} items) / Cross-File({N} items)
- **Scope drift detected**: {yes/no — list any misplaced items that were moved}
- **Coverage gaps**: {description or "none found"}
- **Agent overload risk**: {which agent, if any, is approaching the ~80 item threshold}

### Structural Recommendations (for user consideration)
{Only if the analysis reveals structural issues. Examples:}
- "Consider splitting Cross-File agent into State/Lifecycle and Data/Schema agents — it has {N} items and the two domains have distinct reading patterns"
- "Consider a dedicated Migration agent — {N} of the last {M} PR feedback themes were migration-related and they require a distinct strategy (trace old→new format preservation)"
- "The security agent at {N} items is lean; consider merging its input-handling checks into surface scan to reduce dispatch overhead"

(If no structural changes are warranted, print "Architecture is balanced — no restructuring needed.")
```

## Phase 6: Commit

After all changes:
1. Stage only the modified files under `lib/` and `commands/`
2. Commit: `chore: improve review system from PR feedback`
3. Do NOT push unless the user explicitly asks

## Guidelines

- This command is **read-only on the PR** — it never pushes code, resolves threads, or modifies the reviewed repo
- **No project references anywhere** — never mention the source PR, repo, owner, or project name in file edits, commit messages, or the summary report. All output must be fully generic
- All checklist and agent items should work for ANY codebase — never add project-specific checks
- Prefer fewer, broader items over many narrow ones
- When in doubt about specificity, generalize one level: "PostgreSQL index" → "database index" → "query performance"
- If the PR review feedback is all noise (no actionable items), report that and exit without changes
- Structural recommendations (new agents, merges, splits) are logged in the report but never auto-implemented — they require user approval
- The master checklist is the canonical reference; agent files are focused extracts. New agent items should normally have a corresponding (possibly broader) item in the master; if they don't, either add one or explicitly document why the item is agent-specific
- When moving items between agents, verify the item's reading strategy matches the destination agent's mandate
