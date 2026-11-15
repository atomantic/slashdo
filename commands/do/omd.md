---
description: Audit and optimize markdown files against best practices, extracting inappropriate content to external docs
argument-hint: "[file.md | --all] (defaults to CLAUDE.md)"
allowed-tools: Read, Write, Edit, Glob, Grep
---

Make the target markdown files focused, high-signal documents that serve their purpose without bloat.

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
Find these files in the repo root and common locations: `CLAUDE.md` (including subfolder `CLAUDE.md` files), `README.md`, `AGENTS.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `GOALS.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `LICENSE.md`, `docs/*.md`.

Print the queue before editing:
```
Found {N} markdown files to audit:
- README.md (X lines)
- CLAUDE.md (Y lines)
- ...
```

Skip generated or vendored files (`node_modules/`, `vendor/`, anything a tool regenerates).

A legacy `PLAN.md` is not a governance doc to optimize (the backlog lives in the issue tracker) — skip it, and if one exists, suggest running `/do:replan` once to migrate its items to tracker issues.

## Phase 1: File-Type Preferences

The project's own documentation conventions come first: what its `CLAUDE.md` / `AGENTS.md` / `CONTRIBUTING.md` says about docs, and the shape its existing files already share (heading style, changelog format, whether long files carry a table of contents). The table below records only what is specific to each file type and applies where the project has no convention of its own; generic markdown hygiene is assumed.

| File type | Preference |
|---|---|
| `CLAUDE.md` / `AGENTS.md` | Lean, imperative agent instructions, not prose. `AGENTS.md` is the cross-tool equivalent of `CLAUDE.md` — agent-facing project instructions (conventions, constraints, how to work in this repo) — not a list of sub-agent or sub-command definitions, so don't rewrite it as one. A root `CLAUDE.md` loads at startup, so keep it lean; subfolder `CLAUDE.md` files load only when the agent reads that subtree, so module-specific content belongs there. |
| `README.md` | Written for humans, not agents. Lead with what/why, then installation/quickstart. Long guides or tutorials belong in `docs/` with a link from README. |
| `GOALS.md` | Follow the `/do:goals` boundaries: strategic outcome-prose with no checkboxes — the tactical backlog lives in the issue tracker. Don't restructure it against what `/do:goals` expects to read and write. |
| `CONTRIBUTING.md` | Setup steps + PR process. Drop rules already enforced by linters/CI. |
| `CHANGELOG.md` | Keep whatever format the file already uses; don't convert it to another one. Released entries are history: never delete, merge, or reword them, however old. Fixing broken formatting is fine; anything else (a duplicate entry, a missing version) goes in the report's Recommendations. If release tooling generates the file, leave it alone. |
| `SECURITY.md` | Reporting process (not public issues), supported versions, response-time expectations — concise. |
| Other | Clear purpose stated at the top, logical section order. |

## Phase 2: Audit & Optimize

For each file in the queue: read it, check it against the project's conventions and its Phase 1 row, and apply the fixes directly in one pass, most impactful first.

- **Remove** what is obsolete (stale TODOs, completed migration notes, dead links, references to removed features) or duplicated in another file (keep one copy, link from the other). Removed content is not archived into a new doc. Changelog history is the exception stated in Phase 1.
- **Relocate** content that belongs to a different file's scope: module-specific rules in a root `CLAUDE.md` move to a subfolder `CLAUDE.md`, human-oriented content in `CLAUDE.md` moves to README/CONTRIBUTING, agent instructions in README move to `CLAUDE.md`, verbose implementation detail moves to `docs/`. Leave a short pointer behind when the content matters, and create a new file only when there is substantial content to move.
- **Restructure and tighten** in the file's existing style. Don't add a standard section, placeholder header, or table of contents the project's other docs don't already use.

## Phase 3: Cross-File Consistency (Full Scan Mode Only)

- **Duplication**: the same information in two files → keep it in one place, reference from the other
- **Contradictions**: README says "use npm" but CLAUDE.md says "use yarn" → check the repo for which is true and fix the wrong one; if the repo doesn't settle it, flag it for the user rather than picking
- **Missing cross-references**: a file references a doc that doesn't exist
- **Orphaned docs**: files in `docs/` that nothing links to → add a reference, or recommend removal in the report

## Phase 4: Validate & Report

Before reporting, confirm that nothing still-true was lost, that relocated content landed where the pointer says, and that every touched file is well-formed markdown.

```
## Optimization Report

### Files Audited: {N}

| File | Before | After | Change | Issues Fixed |
|------|--------|-------|--------|-------------|
| README.md | 150 lines | 120 lines | -20% | 5 |
| ... | ... | ... | ... | ... |

### Changes Made
- **README.md**: Moved installation guide to docs/, removed stale badges
- ...

### Files Created
- `src/components/CLAUDE.md` — React component conventions (moved from root CLAUDE.md)
- ...

### Recommendations
- Consider adding SECURITY.md for vulnerability reporting
- ...
```

If a file needs no changes, say so with a brief note of what was checked.
