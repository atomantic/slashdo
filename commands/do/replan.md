---
description: Review and clean up PLAN.md, extract docs from completed work
---

# Replan Command

Automatically audit PLAN.md against the codebase, prune completed/stale items, archive what's done, suggest new work, and leave PLAN.md lean and actionable.

**Philosophy:** PLAN.md should be short enough to paste into a prompt. Completed items belong in a done log, not cluttering the active plan.

## Boundary Rule: PLAN.md vs GOALS.md

**PLAN.md is tactical. GOALS.md is strategic.**

PLAN.md answers: *What are we building next? What's the backlog?*
GOALS.md answers: *Why does this project exist? What does success look like? What will we never do?*

**PLAN.md must NOT contain:**
- Mission statements, core tenets, or non-goals (those belong in GOALS.md)
- Completed items (those belong in `DONE.md`)
- Detailed documentation (those belong in `docs/`)

## Phase 1: Automated Evidence Gathering

Launch these agents in parallel — no user interaction needed yet.

**Agent 1: Git History Analysis**
- `git log --oneline -50` — identify commits that completed plan items
- `git log --since="2 weeks ago" --oneline` — surface recent work not yet reflected in the plan
- Cross-reference commit messages against pending PLAN.md items to auto-detect completions

**Agent 2: Codebase Verification**
- For each pending item in PLAN.md, grep for function names, component names, or feature keywords
- Check test files for coverage of features listed as untested
- Look at recently modified files for signs of completed work
- Build a confidence score per item: `confirmed-done`, `likely-done`, `still-pending`, `stale`

**Agent 3: Opportunity Scanner**
- Scan for TODOs, FIXMEs, HACKs in the codebase that aren't in PLAN.md
- Look for test coverage gaps (files with no corresponding test)
- Check for outdated dependencies (`npm outdated`, `cargo outdated`, etc. as appropriate)
- Review GOALS.md (if it exists) for strategic goals not yet represented in the plan
- Identify code quality opportunities (large files, complex functions, missing error handling)
- Formulate 1-3 suggested new items to propose to the user

**Agent 4: GOALS.md Boundary Check**
If `GOALS.md` exists:
- Check for checkbox task lists or implementation details that leaked in
- Note any items that should be absorbed into PLAN.md

## Phase 2: Auto-Triage (No User Input)

Using agent results, automatically classify every PLAN.md item:

| Status | Criteria | Action |
|--------|----------|--------|
| `confirmed-done` | Git commit + code exists + tests pass | Move to DONE.md |
| `likely-done` | Strong evidence but not 100% certain | Present to user for confirmation |
| `stale` | No commits, no code, no recent discussion; item is >30 days old with zero progress | Flag for removal |
| `still-pending` | No evidence of completion | Keep in PLAN.md |

## Phase 3: Single Interactive Checkpoint

Present ONE consolidated summary to the user. Keep it tight:

```
AskUserQuestion([{
  question: "Replan audit complete. Here's what I found:\n\n**Auto-archiving to DONE.md** ({N} items):\n{list of confirmed-done items}\n\n**Likely done — confirm?** ({M} items):\n{list with evidence}\n\n**Flagged as stale** ({S} items):\n{list with last-activity dates}\n\n**New suggestions** ({P} items):\n{numbered list of proposed new items with rationale}\n\nHow should I proceed?",
  multiSelect: true,
  options: [
    { label: "Archive confirmed-done", description: "Move {N} confirmed items to DONE.md" },
    { label: "Archive likely-done too", description: "Also move {M} likely-done items to DONE.md" },
    { label: "Remove stale items", description: "Delete {S} stale items from PLAN.md" },
    { label: "Add suggested items", description: "Add {P} new items to PLAN.md" },
    { label: "Show me the details", description: "Print full evidence before I decide" },
    { label: "Just clean up formatting", description: "Only reformat PLAN.md, don't change content" }
  ]
}])
```

If "Show me the details" is selected, print the full evidence and re-ask.

For suggested new items: if the user selects "Add suggested items", present each suggestion individually so they can accept, reject, or modify each one.

## Phase 4: Archive to DONE.md

`DONE.md` lives at project root. It's the append-only log of completed work.

### Format

```markdown
# Done Log

Completed items archived from PLAN.md. For release notes, see `.changelogs/`.

## 2026-03-16

- Implemented feature X — added auth middleware and JWT validation
- Fixed bug Y — null check on user profile load
- Refactored Z — extracted shared utilities from monolithic handler

## 2026-03-10

- Added CI pipeline for staging deploys
- Test coverage for API routes
```

### Rules

- Group by date (newest first)
- One line per item — concise description of what was done, not the original checkbox text
- If the completed item had substantial documentation (>20 lines), extract it to `docs/` and add a link: `- Feature X — see [docs/features/x.md](./docs/features/x.md)`
- Do NOT duplicate changelog entries — DONE.md captures plan-item completion, changelogs capture release-level changes

## Phase 5: Rebuild PLAN.md

Rewrite PLAN.md to be lean and actionable:

### Target Structure

```markdown
# Development Plan

For project mission and milestones, see [GOALS.md](./GOALS.md).
For completed work, see [DONE.md](./DONE.md).

## Next Up

1. **Item A**: Brief actionable description
2. **Item B**: Brief actionable description
3. **Item C**: Brief actionable description

## Backlog

- [ ] Item D: Description
- [ ] Item E: Description

## Future / Ideas

- Item F: One-line description
- Item G: One-line description
```

### Guidelines

- **"Next Up" is ordered** — numbered list, max 5 items, these are the immediate priorities
- **"Backlog" is unordered** — checkbox items that are planned but not prioritized
- **"Future / Ideas" has no checkboxes** — these are possibilities, not commitments
- **No completed items** — they're in DONE.md
- **No detailed docs** — link to `docs/` files instead
- **No section if it's empty** — don't include "Backlog" with zero items

## Phase 6: Absorb GOALS.md Violations

If tactical items (checkboxes, implementation details) were found in GOALS.md:
- Move them into the appropriate PLAN.md section
- Update GOALS.md to remove tactical content

## Phase 7: Commit

Stage and commit all changes:
```bash
git add PLAN.md DONE.md
# Also add GOALS.md if it was modified, and any docs/ files if documentation was extracted
git diff --name-only --cached | grep -q GOALS.md || git add GOALS.md 2>/dev/null || true
git commit -m "docs: replan — archive {N} completed items, update priorities"
```

Do NOT push unless explicitly asked.

## Notes

- If no PLAN.md exists, inform the user and offer to create one from codebase analysis
- The opportunity scanner suggestion is the key differentiator — every replan should surface at least one new idea
- DONE.md is append-only — never delete entries from it
- Keep PLAN.md under ~50 lines whenever possible — it should be scannable in seconds
- Adapt to existing project structure and conventions
