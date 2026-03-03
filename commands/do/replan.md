---
description: Review and clean up PLAN.md, extract docs from completed work
---

# Replan Command

You are tasked with reviewing and updating the PLAN.md file to keep it clean, current, and action-oriented.

**This is an interactive process.** Do NOT assume items are still pending or still relevant. Verify with the user.

## Boundary Rule: PLAN.md vs GOALS.md

**PLAN.md is tactical. GOALS.md is strategic.**

PLAN.md answers: *What are we building next? What's the backlog? What's done?*
GOALS.md answers: *Why does this project exist? What does success look like? What will we never do?*

**PLAN.md owns:**
- Checkbox task lists (`- [ ] Add feature X`)
- Implementation details, subtasks, and technical steps
- Known issues and testing gaps
- Prioritized next-action lists
- Completed work archive
- Documentation index

**PLAN.md must NOT duplicate:**
- Mission statements, core tenets, or non-goals (those belong in GOALS.md)
- Milestone definitions written as outcome prose (GOALS.md territory)

**Cross-reference:** PLAN.md should link to GOALS.md for strategic context, and GOALS.md should link back to PLAN.md for tactical details.

## Your Responsibilities

### 1. Gather Evidence

Before touching PLAN.md, gather signals about what's actually happened since the plan was last updated. Run these in parallel:

**Agent 1: Git History**
```bash
git log --oneline -30
```
Look for commits that may have completed items listed in PLAN.md.

**Agent 2: Codebase Scan**
Search for evidence that "pending" items may already be implemented:
- Grep for function names, component names, or feature keywords mentioned in pending items
- Check test files for coverage of features listed as untested
- Look at recently modified files for signs of completed work

**Agent 3: GOALS.md Boundary Check**
If `GOALS.md` exists:
- Read it and check for checkbox task lists or implementation details that leaked in
- Note any items that should be absorbed into PLAN.md

### 2. Interactive Item Review

**This is the most important step. Do NOT skip it.**

Walk through PLAN.md with the user, section by section. For each section that has pending items, present your findings and ask the user to confirm status.

**For each group of related pending items**, use `AskUserQuestion` to verify. Batch related items together (don't ask one-by-one for 20 items). For example:

```
I found these items still marked as pending under "Testing Gaps":
- [ ] Server route unit tests
- [ ] Aggregate calculation tests
- [ ] Visual regression tests for charts

Git history shows commits for "add server route tests" on Feb 15.
I also found test files at packages/server/test/routes/.

Which of these are actually done?
```

**How to batch the review:**
- Group items by section (Next Up, Remaining Work, Future, etc.)
- Present each group with any evidence you found (git commits, files that exist, grep matches)
- Ask the user to confirm: which are done, which are still needed, which should be removed or rephrased
- Use multiSelect questions when asking about multiple items (let the user check off what's done)
- If a section has no evidence of changes, still ask briefly: "These items under [section] — still accurate, or any updates?"

**For known issues**, ask whether they're still reproducible or have been fixed.

**For "Next Actions" / priority ordering**, ask if the priorities still reflect the user's current thinking.

### 3. Extract Documentation from Completed Work

For each completed item with substantial documentation:
- Determine the appropriate docs location (create docs/ directory if needed)
- Extract the detailed documentation sections
- Move them to appropriate docs files with proper formatting
- Follow existing documentation patterns if they exist

**Common docs files to consider:**
- `docs/ARCHITECTURE.md` - System design, data flow, architecture
- `docs/API.md` - API endpoints, schemas, events
- `docs/TROUBLESHOOTING.md` - Common issues and solutions
- `docs/features/*.md` - Individual feature documentation
- `README.md` - User-facing documentation

### 4. Clean Up PLAN.md

Using the verified information from the interactive review:
- Mark confirmed-completed items as [x] and move to archive
- Remove items the user confirmed are no longer relevant
- Update wording for items the user rephrased
- Replace detailed documentation with brief summaries + doc links
- Remove redundant or outdated information

**Example transformation:**
```markdown
Before:
- [x] Feature X: Authentication System

### Architecture
- **Auth Service**: Core authentication logic
- **JWT Tokens**: Token generation and validation
[... 50 more lines of detailed docs ...]

After:
- [x] Feature X: Authentication System - JWT-based auth with session management. See [Authentication](./docs/features/authentication.md)
```

### 5. Update Documentation Index
- Ensure PLAN.md references all relevant docs files
- Add any new docs files you created
- Verify all links are correct
- Add a Documentation section if it doesn't exist

### 6. Rewrite Next Actions

Based on the interactive review, rebuild the "Next Actions" section:
- Ask the user: "Based on what's left, what are your top 3-5 priorities right now?"
- Present a suggested ordering based on what you learned, but let the user override
- Make action items specific and actionable

### 7. Absorb GOALS.md Violations

If you found checkbox items or tactical details in GOALS.md during step 1:
- Show the user what you found
- Offer to move them into the appropriate PLAN.md section
- Update GOALS.md to remove the tactical items (replace with outcome prose or remove entirely)

### 8. Commit Your Changes
After reorganizing (if in a git repository):
- Commit changes with a clear message like:
  ```
  docs: reorganize PLAN.md and extract completed work to docs

  - Moved completed feature docs to docs/features/
  - Updated PLAN.md to focus on next actions
  - Added Next Actions section
  ```

## Guidelines

- **Verify, don't assume**: The whole point of this command is to sync PLAN.md with reality. Never mark items as done or still-pending without checking.
- **Be thorough**: Read all completed items and assess documentation value
- **Be surgical**: Only move substantial documentation (>20 lines), keep brief summaries in PLAN
- **Be organized**: Group related content in docs files with clear headings
- **Be consistent**: Match the style and format of existing docs files
- **Be helpful**: Make it easy to find information by adding clear references
- **Respect boundaries**: Tactical items in PLAN.md, strategic items in GOALS.md
- **Batch intelligently**: Don't ask 20 individual questions — group related items and ask about sections at a time. Aim for 3-6 interactive checkpoints, not 20.

## Example Output Structure

After running `/replan`, the PLAN.md should have:
```markdown
# Project Name - Development Plan

The tactical backlog. For mission and milestones, see [GOALS.md](./GOALS.md).

## Documentation
- [Architecture Overview](./docs/ARCHITECTURE.md)
- [API Reference](./docs/API.md)

## Next Up
- [ ] Feature C: Brief description with subtasks

## Remaining Work
### Known Issues
- ...
### Testing Gaps
- [ ] ...

## Future (v2.0+)
- [ ] Feature D: Brief description of planned work

## Next Actions

1. **Task 1**: Brief description of what needs to be done
2. **Task 2**: Brief description of next task
3. **Task 3**: Brief description of another task

## Completed Work (Archive)
<details>
<summary>v0.x Features</summary>
- [x] Feature A - See [Feature A Docs](./docs/features/feature-a.md)
- [x] Feature B - See [Feature B Docs](./docs/features/feature-b.md)
</details>
```

## Notes

- Don't delete information - move it to appropriate docs files
- Keep related information consolidated in single docs files
- Create feature-specific docs in docs/features/ for complex systems
- Preserve all historical information but organize it better
- If no PLAN.md exists, inform the user rather than creating one
- Adapt to the existing structure and conventions of the project
- If GOALS.md has task lists that belong in PLAN.md, migrate them
