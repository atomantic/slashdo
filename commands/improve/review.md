---
description: Learn from PR review feedback to improve the self-review checklist
argument-hint: "<PR URL or owner/repo#number>"
---

# Improve Review Checklist from PR Feedback

Analyze code review feedback on a PR, identify patterns our self-review checklist missed, and update `~/.claude/lib/code-review-checklist.md` with new generic checks.

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

Fetch PR review comments (inline code comments from all reviewers):
```bash
gh api repos/{OWNER}/{REPO}/pulls/{PR_NUM}/comments --paginate
```

Also fetch review bodies (top-level review summaries):
```bash
gh api repos/{OWNER}/{REPO}/pulls/{PR_NUM}/reviews --paginate
```

Save both to `/tmp/improve-review-comments.json` and `/tmp/improve-review-bodies.json`.

### 1c: Extract actionable feedback

From the raw comments, extract only **actionable code review feedback** — comments that identify bugs, anti-patterns, missing validation, security issues, or correctness problems. Skip:
- Purely informational comments ("nice work", "looks good")
- Style-only comments that don't affect correctness
- Comments the PR author already addressed (resolved threads)
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

1. **Database-agnostic**: Replace "PostgreSQL", "SQLite", "MongoDB" references with "database" or "data store". The principle (e.g., "parameterize queries", "validate constraints at the boundary") applies regardless of engine.
2. **Framework-agnostic**: Replace "React", "Express", "Next.js" with the general concept ("UI component", "route handler", "server framework"). Keep framework-specific terms only when the check is genuinely framework-specific (e.g., `useEffect` cleanup is React-specific).
3. **Consolidate related items**: If three comments boil down to "validate inputs at the API boundary", write ONE checklist item, not three. Mention the variants inline with em-dashes or parentheticals.
4. **Action-oriented**: Each item should tell the reviewer what to look for and why it's a problem. Pattern: `{thing to look for} — {consequence if missed}`.
5. **Concise**: One to two sentences max per item. If it needs more, it's two separate items.
6. **Subsumable**: Before adding a new item, check if an existing checklist item could be broadened to cover this case instead. Prefer widening an existing item over adding a new one.

## Phase 3: Diff Against Existing Checklist

### 3a: Read current checklist

Read the installed checklist:
```bash
cat ~/.claude/lib/code-review-checklist.md
```

### 3b: Classify each theme

For each generalized theme from Phase 2b, classify it as:

- **Already covered**: An existing checklist item already catches this. Note which item.
- **Partially covered**: An existing item is close but could be broadened. Note the item and the gap.
- **Not covered**: No existing item would catch this class of bug. This needs a new entry.

### 3c: Check for consolidation opportunities

Scan the existing checklist for items that could be merged:
- Two items in different sections that describe the same underlying principle
- Items that are overly specific to one technology when a generic version would cover both the existing and new case
- Sections with 8+ items that could benefit from grouping sub-items under a broader principle

## Phase 4: Update Checklist

### 4a: Apply changes

For each theme classified in Phase 3b:

- **Already covered**: No change needed. Skip.
- **Partially covered**: Edit the existing item to broaden its scope. Use the Edit tool to modify just that line.
- **Not covered**: Add a new item under the most appropriate existing section. If no section fits, consider whether it belongs in an existing section with a slightly broadened header, or truly needs a new section (rare — prefer reuse).

When adding or editing items:
- Place new items adjacent to related existing items within their section
- Maintain the existing formatting style (indented bullet with bold section headers)
- Do not add project-specific references, file names, or variable names
- Do not add items that only apply to one programming language unless they're in a clearly language-scoped section

### 4b: Consolidation pass

After all additions, re-read the full checklist and look for:
- Redundant items that now overlap after additions — merge them
- Items that could be folded under a broader principle without losing specificity
- Sections that have grown too long (>12 items) — consider splitting or consolidating

The goal is a checklist that is **wide** (covers many categories of bugs) but **tight** (no redundancy, each item pulls its weight). A reviewer scanning this list should be able to hold the full set of principles in mind during a single review pass.

### 4c: Verify the file

After editing, read back `~/.claude/lib/code-review-checklist.md` to verify:
- No formatting errors (broken markdown, missing bullets)
- No duplicate items
- No project-specific language leaked in
- Items flow logically within their sections

## Phase 5: Report

Print a summary of what was learned:

```
## Review Learning Summary

**PR**: {owner}/{repo}#{number} — {PR title}
**Reviewer(s)**: {list of reviewers who left comments}
**Actionable comments**: {N} comments across {M} themes

### Themes Identified
| Theme | Comments | Status |
|---|---|---|
| {theme name} | {count} | Added / Broadened existing / Already covered |

### Checklist Changes
- **Added**: {N} new items
- **Broadened**: {N} existing items updated
- **Consolidated**: {N} items merged
- **Unchanged**: {N} themes already covered

### New/Modified Items
{list each new or modified checklist item with a brief explanation of what PR feedback inspired it}
```

## Guidelines

- This command is **read-only on the PR** — it never pushes code, resolves threads, or modifies the reviewed repo
- The checklist should work for ANY codebase — never add project-specific checks
- Prefer fewer, broader items over many narrow ones — a good checklist item catches a class of bugs, not one specific instance
- When in doubt about whether something is too specific, generalize it one level: "PostgreSQL index" → "database index" → "query performance"
- If the PR review feedback is all noise (no actionable items), report that and exit without changes
