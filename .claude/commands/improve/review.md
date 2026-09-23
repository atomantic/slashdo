---
description: Learn from PR review feedback to improve the self-review checklist and multi-agent review process
argument-hint: "<PR URL or owner/repo#number>"
---

# Improve Review System from PR Feedback

Analyze code review feedback on a PR, identify patterns our review system missed, update the agent-specific instruction files, and evaluate whether the agent architecture itself needs restructuring.

## Architecture Overview

The `/do:review` system has one host orchestrator and a set of optional focused
review lenses. The orchestrator inspects each PR and selects zero or more lenses
based on the changed behavior; selected lenses run in parallel, and a simple change
may use no sub-agents at all.

The lens set below can drift as lenses are added, renamed, or removed. Before
relying on it — and before Phases 2c, 3a, 4c, and 5 below, which each enumerate
the lens set again — re-derive it from the orchestrator itself rather than trusting
memory:

```bash
sed -n '/### Select the review lenses/,/^## /p' commands/do/review.md | grep -o '!read lib/review-[a-z-]*\.md' | sed 's/!read //' | sort -u
```

If that list differs from the table below, update the table first (it is the
lens-focus reference every later phase points back to), then carry the same set
into every phase that names lenses individually.

| Agent | File | Focus |
|---|---|---|
| Surface Scan | `lib/review-surface-scan.md` | Per-file RUNTIME bugs: crashes, type/coercion, async/state, error handling, streaming, domain-specific runtime patterns |
| Surface Quality | `lib/review-surface-quality.md` | Per-file QUALITY: intent-vs-implementation drift, AI-generated code patterns, dead config, missing tests, supply chain hygiene, style |
| Security Audit | `lib/review-security-audit.md` | Trust boundaries, injection, SSRF, data exposure, access control |
| Cross-File Tracing | `lib/review-cross-file-tracing.md` | State/lifecycle/concurrency across files: stale state propagation, lifecycle gaps, resource leaks, lock/flag exit paths, races |
| Cross-File Contract | `lib/review-cross-file-contract.md` | Contracts across files: schema/shape agreements, validation parity, error classification, field-set enumerations, architectural-pattern adherence |
| Structural Ambition | `lib/review-structural-ambition.md` | Strict-mode structural concerns: code-judo simplifications, file-size growth, abstraction sprawl, boundary leaks, and bespoke duplicates |

Additionally:
- `lib/review-preferences.md` — shared review preferences (logic not lint, evidence, severity) inlined into `/do:pr`, `/do:fpr`, `/do:release`, and the better pipeline; it holds no catalog items
- `commands/do/review.md` — orchestrator (dispatches agents, deduplicates, fixes, reports)
- `lib/review-agent-selection.md` — orchestrator's evidence-based lens-selection policy

## Phase 1: Parse Input & Fetch Feedback

### 1a: Parse PR reference

Extract owner, repo, and PR number from `$ARGUMENTS`. Accept formats:
- `https://github.com/owner/repo/pull/123`
- `owner/repo#123`
- `#123` (uses current repo via `gh repo view --json owner,name`)

Also capture the GitHub API host as `{GH_HOST}` — from the PR URL's host when a full URL is given, otherwise with the canonical derivation chain in `~/.claude/lib/gh-host.md` (do not re-type a shortened version: its `gh repo view --json url` fallback is what keeps an unparsable `origin` from silently resolving to github.com). `gh api` ignores the repo remote and defaults to github.com, so on a GitHub Enterprise repo the query below must be passed `--hostname {GH_HOST}` (see `~/.claude/lib/gh-host.md`).

```bash
# Example extraction from URL:
echo "$URL" | sed -E 's|.*/([^/]+)/([^/]+)/pull/([0-9]+).*|\1 \2 \3|'
```

If no argument is provided, ask the user for a PR URL.

### 1b: Fetch all review comments

Use GraphQL to fetch review threads with resolution state, inline comments, and review bodies in a single query:
```bash
gh api --hostname {GH_HOST} graphql --paginate -f query='{ repository(owner: "{OWNER}", name: "{REPO}") { pullRequest(number: {PR_NUM}) { reviewThreads(first: 100) { nodes { isResolved comments(first: 10) { nodes { body path line author { login } } } } } reviews(first: 50) { nodes { body state author { login } submittedAt } } } } }'
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

For each theme, draft a **generic, technology-agnostic checklist item** that would catch this class of bug in any codebase. This is a candidate only — Phase 4 decides whether it becomes an actual checklist item or is better fixed as a preferences/orchestration change or a mandate/boundary fix. Rules for generalization:

1. **Database-agnostic**: Replace "PostgreSQL", "SQLite", "MongoDB" references with "database" or "data store".
2. **Framework-agnostic**: Replace "React", "Express", "Next.js" with the general concept ("UI component", "route handler", "server framework"). Keep framework-specific terms only when genuinely framework-specific.
3. **Consolidate related items**: If three comments boil down to "validate inputs at the API boundary", write ONE checklist item. Mention variants inline.
4. **Action-oriented**: Pattern: `{thing to look for} — {consequence if missed}`.
5. **Concise**: One to two sentences max per item.
6. **Subsumable**: Check if an existing item could be broadened instead. Prefer widening over adding.

### 2c: Assign each theme to an agent

For each generalized theme, determine which agent **should have caught it** based on the reading strategy required. This list mirrors the current lens set from the Architecture Overview check above — add, rename, or drop an option here if that check found the lens set changed:

- **Surface Scan** — catchable by reading a single file in isolation; per-file RUNTIME bugs (crashes, type/coercion, async/state, error handling, streaming, domain-specific runtime patterns)
- **Surface Quality** — catchable by reading a single file; intent-vs-implementation drift, AI-generated code patterns, dead config, missing tests, supply chain hygiene, style
- **Security Audit** — requires adversarial thinking about trust boundaries, injection, data exposure, access control
- **Cross-File Tracing** — requires tracing STATE / LIFECYCLE / CONCURRENCY across files (stale state propagation, resource leaks, lock/flag exit paths, races)
- **Cross-File Contract** — requires tracing CONTRACTS across files (schema/shape agreements, validation parity, error classification, field-set enumerations, architectural-pattern adherence)
- **Structural Ambition** — requires STRICT-MODE structural judgment: code-judo simplifications, file-size growth, abstraction sprawl, boundary leaks, bespoke duplicates
- **None (new agent needed)** — requires a fundamentally different reading strategy not covered by any existing agent
- **Orchestrator** — requires changes to how agents are dispatched, how findings are collected, or how the review is scoped

The distinction between the two cross-file agents: Tracing follows DATA and CONTROL FLOW (what state propagates when, what cleanup runs, what races); Contract follows SHAPE and AGREEMENT (does field X exist on both sides, does verb Y validate like verb Z, does this error class survive the wrapper). If a finding is about "X happens at the wrong time" → Tracing. If it's about "X and Y disagree on the shape" → Contract.

Record this assignment for each theme — it determines which files to update in Phase 4.

## Phase 3: Diff Against Existing System

### 3a: Read current files

Read all source-of-truth files:
```
lib/review-preferences.md             # shared review preferences
lib/review-agent-selection.md         # orchestrator's lens-selection policy
lib/review-surface-scan.md            # surface scan agent (runtime)
lib/review-surface-quality.md         # surface quality agent
lib/review-security-audit.md          # security agent
lib/review-cross-file-tracing.md      # cross-file tracing (state/lifecycle)
lib/review-cross-file-contract.md     # cross-file contract (schema/shape)
lib/review-structural-ambition.md     # structural ambition agent (strict-mode)
commands/do/review.md                 # orchestrator
```
This is the current lens set plus its two orchestration files; if the Architecture
Overview check above found a different lens set, read those files instead.

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
3. **Missing agent** — Would a new specialized agent (with a distinct reading strategy) catch a recurring class of issues better than broadening existing agents?

### 3d: Check for consolidation opportunities

Scan each agent file for:
- Redundant items within the same agent
- Items across agents that overlap (some overlap is intentional for critical checks; flag only excessive duplication)
- Items that could be folded under a broader principle

## Phase 4: Update Files

For each theme, prefer the highest change in this list that actually fixes the miss;
only fall through to the next when it doesn't apply. A checklist bullet (4c) is the
**last** resort, not the default — the goal is a system that reasons its way to the
finding, not a longer list of things to check for.

### 4a: Review preferences or orchestration (preferred)

Change `lib/review-preferences.md` when a theme changes how every review reasons
(evidence, severity, what counts as a finding), or `lib/review-agent-selection.md` /
`commands/do/review.md` when the miss is really a dispatch problem — the right lens
existed but wasn't selected, or the orchestrator's evidence-based selection policy
needs adjusting. These changes generalize instead of adding to a list.

### 4b: Lens mandate or boundary

If a theme reveals that an agent's mandate is drawn wrong — a reading strategy that
should own the finding isn't stated, or two agents' boundaries leave a gap or overlap
(see 3c) — fix the mandate/boundary language in the relevant `lib/review-*.md` agent
file(s) rather than adding a new bullet under it.

### 4c: New checklist item (last resort)

Add a new what-to-look-for item to the **assigned agent's instruction file**
(`lib/review-surface-scan.md`, `lib/review-surface-quality.md`,
`lib/review-security-audit.md`, `lib/review-cross-file-tracing.md`,
`lib/review-cross-file-contract.md`, or `lib/review-structural-ambition.md`) only
when both hold:
- the miss **recurs** — this is not the first PR where this exact class of finding
  was missed (note the prior instance(s) you're aware of, or say why you believe it
  will recur)
- a capable model **demonstrably** doesn't catch it unprompted — 4a/4b (reasoning
  from preferences, evidence, or a corrected mandate) would not have caught it either

If a theme doesn't meet both bars, classify it under 4a or 4b instead, or leave it
unaddressed and say why in the report.

When a new or broadened item does apply:
- **New item**: Add under the most appropriate section in the agent file
- **Broadened item**: Edit the existing item in the agent file
- **Misplaced item**: Move from the current agent file to the correct one
- **Wrong agent**: If a theme was found in one agent but belongs in another, move the item

Match the agent file's existing style, place adjacent to related items, and include
the key pattern + consequence, not every sub-clause.

### 4d: Consolidation pass

After all updates, re-read each modified file and check:
- No formatting errors
- No duplicate items within any file
- No project-specific language
- Items flow logically within their sections

### 4e: Sync to installed locations

**Never `cp` source files into `~/.claude`** — the installer transforms `!read
lib/…` lines, lib paths, and `CLAUDE_CONFIG_DIR` on the way in (`src/transformer.js`);
a raw copy leaves the installed `/do:review` with literal, unexecuted `!read` text.
Reinstall through the CLI instead (see CONTRIBUTING.md). Scoping the positional
argument to `review` limits which *command* file is reinstalled (`/do:review`
itself, so other installed commands aren't touched), but `lib/` is a shared,
global directory for this environment, so every lib file (not just `review-*.md`)
gets refreshed too — that's expected, not a bug:

```bash
node bin/cli.js --env claude review
```

## Phase 5: Report

```
## Review Learning Summary

**Actionable comments**: {N} comments across {M} themes

### Themes Identified
| Theme | Comments | Agent | Resolution | Status |
|---|---|---|---|---|
| {theme name} | {count} | Surface Scan/Surface Quality/Security/Cross-File Tracing/Cross-File Contract/Structural Ambition/Orchestrator | Preferences (4a) / Orchestration (4a) / Mandate-boundary (4b) / Checklist item (4c) | Added / Broadened / Moved / Already covered |

### Changes Made
- **Preferences or orchestration changes**: {N} (4a)
- **Mandate/boundary fixes**: {N} (4b)
- **New checklist items**: {N} (4c — each with its recurrence + demonstrated-miss justification)
- **Broadened checklist items**: {N}
- **Moved between agents**: {N} items reassigned
- **Consolidated**: {N} items merged
- **Unchanged**: {N} themes already covered

### Files Modified
{list each modified file with a one-line description of what changed and why}

### New/Modified Items
{list each item with brief explanation of the pattern it catches, which agent owns it, and (for new checklist items) the recurrence + demonstrated-miss justification from 4c}

### Architecture Assessment
- **Scope drift detected**: {yes/no — list any misplaced items that were moved}
- **Coverage gaps**: {description or "none found"}

### Structural Recommendations (for user consideration)
{Only if the analysis reveals structural issues. Examples:}
- "Consider splitting Cross-File Tracing and Cross-File Contract further — {theme} keeps landing in the overlap between the two and neither mandate clearly owns it"
- "Consider a dedicated Migration agent — {N} of the last {M} PR feedback themes were migration-related and they require a distinct strategy (trace old→new format preservation) that no existing lens's mandate covers"
- "Security Audit and Surface Scan mandates overlap on input handling; consider narrowing one to reduce dispatch overhead"

(If no structural changes are warranted, print "Architecture is balanced — no restructuring needed.")
```

## Phase 6: Commit

After all changes:
1. Stage all modified files (under `lib/`, `commands/`, and `.claude/commands/`)
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
- When moving items between agents, verify the item's reading strategy matches the destination agent's mandate
