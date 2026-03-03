---
description: Audit and optimize markdown files against best practices, extracting inappropriate content to external docs
argument-hint: "[file.md | --all] (defaults to CLAUDE.md)"
allowed-tools: Read, Write, Edit, MultiEdit, LS, Glob, Grep, WebFetch
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
- `PLAN.md`
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

## Phase 1: File-Type Detection & Best Practices

Identify the file type and load appropriate guidelines. Each type has different optimization goals:

### CLAUDE.md
**Purpose**: AI assistant instructions — focused, concise, actionable directives.
**Best practices source**: WebFetch https://www.anthropic.com/engineering/claude-code-best-practices and https://docs.anthropic.com/en/docs/claude-code/memory

Key principles:
- Root CLAUDE.md is loaded at startup — keep it lean
- Subfolder CLAUDE.md files load only when Claude reads files in that subtree
- Content should be imperative instructions, not prose explanations
- Module-specific content belongs in subfolder CLAUDE.md files
- Verbose details belong in external docs referenced from CLAUDE.md

### README.md
**Purpose**: Project introduction for humans — first thing visitors see.
**Best practices source**: WebFetch https://www.makeareadme.com/

Key principles:
- Lead with a clear, concise project description (what it does, why it exists)
- Follow with installation/quickstart — get users running fast
- Standard sections in order: Description, Installation, Usage, API/Configuration, Contributing, License
- Badges should be current and meaningful (not decorative)
- Examples should be copy-pasteable and tested
- Remove stale feature lists, outdated screenshots, or dead links
- Keep it scannable — use headers, bullet points, code blocks
- Long guides or tutorials belong in `docs/` with a link from README

### AGENTS.md
**Purpose**: Agent definitions and configuration for AI coding tools.

Key principles:
- Each agent should have a clear role, tools, and constraints
- Remove agents that duplicate built-in behavior
- Keep agent instructions concise — verbose prompts waste context
- Ensure agent names and descriptions are distinct

### CONTRIBUTING.md
**Purpose**: Guide for new contributors — reduce friction to first PR.

Key principles:
- Start with setup instructions (clone, install, run)
- Document the PR process (branch naming, commit style, review expectations)
- List code style rules only if not enforced by tooling
- Remove rules that are already handled by linters/formatters/CI
- Keep it short — long contributing guides discourage contributors

### CHANGELOG.md
**Purpose**: Human-readable release history.

Key principles:
- Follow Keep a Changelog format (Added, Changed, Deprecated, Removed, Fixed, Security)
- Most recent version first
- Remove duplicate entries within the same version
- Ensure version numbers match actual releases
- Link version headers to git diffs/tags when possible

### GOALS.md / PLAN.md
**Purpose**: Strategic direction and tactical backlog.

Key principles:
- GOALS.md: high-level vision and non-goals — should rarely change
- PLAN.md: current work items — should reflect reality, not aspirations
- Remove completed items from PLAN.md (they're in git history)
- Remove stale/abandoned goals
- Ensure goals are measurable and specific, not vague

### SECURITY.md
**Purpose**: Security policy and vulnerability reporting instructions.

Key principles:
- Clear reporting process (email, not public issues)
- Supported versions table
- Response time expectations
- Keep concise — link to detailed policies if needed

### Other Markdown Files
**Purpose**: Varies — apply general markdown best practices.

Key principles:
- Clear purpose stated at the top
- Logical section ordering
- No orphaned content (sections that don't relate to the file's purpose)
- Remove stale TODOs, dead links, outdated references
- Consistent formatting throughout

## Phase 2: Audit

For each file in the queue, perform a type-aware audit:

1. **Read the file** — parse structure, content, line count
2. **Check against type-specific standards** from Phase 1
3. **Identify issues** in these categories:

**Content issues:**
- Outdated or obsolete information
- Stale TODOs, completed migration notes, old changelog entries
- Dead links or references to removed files/features
- Information that duplicates what's in other files
- Content that belongs in a different file (e.g., contributing guidelines in README)

**Structure issues:**
- Missing standard sections for the file type
- Sections in non-standard order
- Inconsistent heading levels
- Missing or excessive table of contents
- Wall-of-text sections that need breaking up

**Scope issues (especially for CLAUDE.md):**
- Module-specific content in root CLAUDE.md → move to subfolder CLAUDE.md
- Verbose implementation details → move to external docs
- Human-oriented content in CLAUDE.md → move to README or CONTRIBUTING
- AI-oriented instructions in README → move to CLAUDE.md

**Quality issues:**
- Vague or non-actionable instructions
- Redundant or repetitive content
- Inconsistent formatting or style
- Overly verbose where concise would suffice

## Phase 3: Optimization

For each file, apply fixes in order of impact:

### 3a: Remove
- Delete outdated, obsolete, or redundant content
- Remove stale TODOs, completed items, dead links
- Drop sections that no longer reflect reality
- Don't create external docs for removed content — it's gone for a reason

### 3b: Relocate
- Move content to the correct file based on scope and purpose
- For CLAUDE.md: move module-specific content to subfolder CLAUDE.md files
- For README: move detailed guides to `docs/`, move AI instructions to CLAUDE.md
- When moving content, add a brief reference in the source file if the content is important
- Only create new files when there's substantial content to move

### 3c: Restructure
- Reorder sections to match type-specific conventions
- Fix heading hierarchy
- Add missing standard sections (with minimal placeholder content)
- Break up wall-of-text sections with sub-headers or bullet points
- Add table of contents if the file exceeds ~100 lines and has 4+ sections

### 3d: Refine
- Tighten language — remove filler words, passive voice, unnecessary qualifiers
- Convert prose to bullet points where appropriate (especially in CLAUDE.md)
- Ensure examples are current and functional
- Standardize formatting (consistent list styles, code block languages, etc.)

## Phase 4: Cross-File Consistency (Full Scan Mode Only)

When optimizing multiple files, check for cross-file issues:

- **Duplication**: Same information in README and CONTRIBUTING → keep in one place, reference from the other
- **Contradictions**: README says "use npm" but CLAUDE.md says "use yarn" → resolve the conflict
- **Missing cross-references**: CLAUDE.md references a doc that doesn't exist, README doesn't mention CONTRIBUTING.md
- **Orphaned docs**: Files in `docs/` that nothing links to — either add references or consider removal
- **CLAUDE.md index**: Ensure CLAUDE.md has a documentation index section pointing to other relevant files

## Phase 5: Validate & Report

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
- WebFetch fails → Use embedded knowledge with a warning that best practices may not reflect latest guidelines
- No changes needed → Report "File is already well-optimized" with brief confirmation of what was checked
- Conflicting content across files → Flag for user decision rather than auto-resolving
