---
description: Audit and optimize markdown files against best practices, extracting inappropriate content to external docs
argument-hint: "[file.md | --all] (defaults to CLAUDE.md)"
allowed-tools: Read, Write, Edit, MultiEdit, LS, Glob, Grep
---

You are a markdown optimization specialist. Your goal is to make markdown files focused, high-signal documents that serve their intended purpose without becoming bloated or disorganized.

## Argument Parsing

Parse `$ARGUMENTS` to determine scope:
- **No argument**: Default to `./CLAUDE.md`
- **`--all`**: Full scan mode — discover and optimize all standard markdown files in the repo
- **Specific file path** (e.g., `README.md`, `docs/API.md`): Optimize that single file
- Users may also provide extra context in their slash command prompt (e.g., "focus on the installation section") — incorporate any such guidance

## Phase 0: Discovery

### Single-File Mode (default)
Read the target file. If it doesn't exist, offer to create it with a sensible template for its type.

### Full Scan Mode (`--all`)
Glob for markdown files in the repo root and common locations:

**Standard files to scan for:**
- `CLAUDE.md` (and subfolder CLAUDE.md files)
- `README.md`
- `AGENTS.md`
- `CONTRIBUTING.md`
- `CHANGELOG.md`
- `GOALS.md`
- `CODE_OF_CONDUCT.md`
- `SECURITY.md`
- `LICENSE.md`
- `docs/*.md`

For each file found, add it to the optimization queue. Print a summary:
```
Found {N} markdown files to audit:
- README.md (X lines)
- CLAUDE.md (Y lines)
- ...
```

Skip files that are clearly generated (e.g., `node_modules/`, `vendor/`, lock files).

A legacy `PLAN.md` is not a governance doc to optimize (the backlog lives in the issue tracker) — skip it, and if one exists, suggest running `/do:replan` once to migrate its items to tracker issues.

## Phase 1: File-Type Preferences

Identify the file type and apply its row below. A capable model already knows generic markdown hygiene (clear structure, no dead links, no stale content) — this table only records what's specific to this project's conventions, not restated elsewhere.

| File type | Preference |
|---|---|
| `CLAUDE.md` / `AGENTS.md` | Lean, imperative agent instructions, not prose. **`AGENTS.md` is the cross-tool equivalent of `CLAUDE.md`** — agent-facing project instructions (conventions, constraints, how to work in this repo) — never a list of sub-agent/sub-command definitions; don't rewrite it as one. Root `CLAUDE.md` loads at startup, so keep it lean; subfolder `CLAUDE.md` files load only when Claude reads that subtree — module-specific content belongs there, not at the root. |
| `README.md` | Written for humans, not agents. Lead with what/why, then installation/quickstart. Long guides or tutorials belong in `docs/` with a link from README. |
| `GOALS.md` | Follow the `/do:goals` boundaries: GOALS.md is strategic outcome-prose with no checkboxes — the tactical backlog lives in the issue tracker, not a markdown file. Don't restructure it against what `/do:goals` expects to read and write. |
| `CONTRIBUTING.md` | Setup steps + PR process. Drop rules already enforced by linters/CI. |
| `CHANGELOG.md` | Keep a Changelog format (Added/Changed/Deprecated/Removed/Fixed/Security), most recent first, no duplicate entries within a version. |
| `SECURITY.md` | Reporting process (not public issues), supported versions, response-time expectations — concise. |
| Other | Clear purpose stated at the top, logical section order, no orphaned or stale content. |

## Phase 2: Audit & Optimize

For each file in the queue: read it, check it against its Phase 1 row, then apply fixes directly in this order of impact — don't produce a separate issues list first and a fixes list second, they're the same pass.

### 2a: Remove
- Outdated or obsolete information; stale TODOs, completed migration notes, old changelog entries; dead links or references to removed files/features
- Information that duplicates what's in another file (keep it in one place, reference from the other)
- Don't create external docs for removed content — it's gone for a reason

### 2b: Relocate
- Content that belongs in a different file for its scope/purpose — e.g. module-specific content in root `CLAUDE.md` moves to a subfolder `CLAUDE.md`, human-oriented content in `CLAUDE.md` moves to README/CONTRIBUTING, AI-oriented instructions in README move to `CLAUDE.md`, verbose implementation detail moves to external docs
- When moving content, add a brief reference in the source file if the content is important
- Only create new files when there's substantial content to move

### 2c: Restructure
- Reorder sections to match the file type's convention; fix inconsistent heading levels; break up wall-of-text sections with sub-headers or bullet points
- Add a table of contents if the file exceeds ~100 lines and has 4+ sections
- Don't add a standard section that has no real content to put in it — a placeholder header is bloat, not structure

### 2d: Refine
- Tighten language — remove filler words, passive voice, unnecessary qualifiers
- Convert prose to bullet points where appropriate (especially in `CLAUDE.md`)
- Ensure examples are current and functional
- Standardize formatting (consistent list styles, code block languages, etc.)

## Phase 3: Cross-File Consistency (Full Scan Mode Only)

When optimizing multiple files, check for cross-file issues:

- **Duplication**: Same information in README and CONTRIBUTING → keep in one place, reference from the other
- **Contradictions**: README says "use npm" but CLAUDE.md says "use yarn" → resolve the conflict
- **Missing cross-references**: CLAUDE.md references a doc that doesn't exist, README doesn't mention CONTRIBUTING.md
- **Orphaned docs**: Files in `docs/` that nothing links to — either add references or consider removal

## Phase 4: Validate & Report

### Per-File Validation
- Verify no critical information was lost (only outdated content removed)
- Confirm relocated content landed in the right place
- Check that new/modified files are well-formed markdown
- Calculate metrics: lines before → after, sections restructured, issues fixed

### Output Report

```
## Optimization Report

### Files Audited: {N}

| File | Before | After | Change | Issues Fixed |
|------|--------|-------|--------|-------------|
| README.md | 150 lines | 120 lines | -20% | 5 |
| CLAUDE.md | 200 lines | 80 lines | -60% | 8 |
| ... | ... | ... | ... | ... |

### Changes Made
- **README.md**: Moved installation guide to docs/, removed stale badges, added missing License section
- **CLAUDE.md**: Extracted module-specific rules to 3 subfolder CLAUDE.md files, removed outdated API notes
- ...

### Files Created
- `src/components/CLAUDE.md` — React component conventions (moved from root CLAUDE.md)
- ...

### Recommendations
- [ ] Consider adding SECURITY.md for vulnerability reporting
- [ ] CHANGELOG.md has no entries for v2.x — consider backfilling
- ...
```

## Error Handling
- File not found → Offer to create it with a type-appropriate template
- No changes needed → Report "File is already well-optimized" with brief confirmation of what was checked
- Conflicting content across files → Flag for user decision rather than auto-resolving
