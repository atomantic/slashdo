---
description: Automated audit/triage of PLAN.md — archive completed items to DONE.md, suggest new work, keep PLAN.md lean
argument-hint: "[--interactive]"
---

# Replan Command

Automatically audit PLAN.md against the codebase, prune completed/stale items, archive what's done, suggest new work, and leave PLAN.md lean and actionable.

**Default mode: fully autonomous.** Scans the codebase, archives done items, removes stale items, adds suggested new items, and commits — no user interaction.

**`--interactive` mode:** Pauses after evidence gathering to present findings and get user approval before making changes.

**Philosophy:** PLAN.md should be short enough to paste into a prompt. Completed items belong in a done log, not cluttering the active plan.

**Phase ordering:** This command runs phases 0 → 7. Phase 0 (plan-item ID assignment) was added so concurrent agents can claim distinct PLAN.md items via worktree branch names; existing phases keep their original numbering.

## Boundary Rule: PLAN.md vs GOALS.md

**PLAN.md is tactical. GOALS.md is strategic.**

PLAN.md answers: *What are we building next? What's the backlog?*
GOALS.md answers: *Why does this project exist? What does success look like? What will we never do?*

**PLAN.md must NOT contain:**
- Mission statements, core tenets, or non-goals (those belong in GOALS.md)
- Completed items (those belong in `DONE.md`)
- Detailed documentation (those belong in `docs/`)

## Phase 0: Assign Plan-Item IDs

**`/do:replan` owns the ID-assignment pass.** Every `- [ ]` / `- [x]` checkbox
in PLAN.md must carry a stable slug ID in `[brackets]` immediately after the
checkbox. The ID lets concurrent agents claim distinct items by encoding the
slug in their worktree branch name (`cos/<task>/<plan-id>/<agent>`) and lets
other agents detect what's in flight by scanning branches/PRs for the slug.

Run this phase BEFORE the evidence-gathering agents below.

**Precondition:** PLAN.md exists. If PLAN.md is missing (fresh repo, never
replanned), skip Phase 0 entirely and let Phase 3 create PLAN.md from the
suggested items (slugs will be assigned at insert time, since there's
nothing to back-fill).

1. Read PLAN.md and DONE.md (if either exists). Collect every `[slug]`
   into a `takenIds` set **using the strict positional pattern** spelled
   out in [lib/plan-id-format.md](../../lib/plan-id-format.md) (section
   "Strict positional pattern for the Phase 0 collision scan"). In
   short: PLAN.md slugs live at the bracketed token directly after
   `- [ ] ` / `- [x] ` (or the indented variant); DONE.md slugs live at
   the bracketed token directly after `- **`. Do NOT collect any
   `[…]` token that appears elsewhere in a line (inline links,
   reference shorthand) — those are not slugs and treating them as
   taken would force unnecessary collision suffixes onto unrelated
   future items.
2. For each `- [ ]` / `- [x]` line in PLAN.md that does NOT already have an
   ID, derive a slug per the rules in
   [lib/plan-id-format.md](../../lib/plan-id-format.md):
   - strip markdown wrappers from the title; lowercase + kebab-case;
     truncate to 50 chars at the last `-` boundary; append `-2`/`-3`/... on
     collision against `takenIds`.
3. Rewrite the line as `- [ ] [<slug>] <rest>` (preserving the checkbox
   state, indent, and trailing content unchanged). Add the new slug to
   `takenIds` so subsequent items in the same pass don't collide.
4. **Never rewrite an existing `[slug]`** — slugs are immutable once
   assigned. Only items missing an ID get one.
5. Track the count `{I}` of IDs assigned for the Phase 3 / Phase 7 summary.

If no IDs were assigned (every item already had one), this phase is a no-op
and produces no commit on its own — proceed to Phase 1.

**Concurrent-appender arbitration.** Audit commands like `do:better`,
`do:better-swift`, and `do:depfree` independently append `- [ ]` items
with their own slugs. Each command must re-read PLAN.md (and DONE.md)
*immediately before* writing, so its uniqueness check sees the freshest
state. If two such commands race and produce colliding slugs, Phase 0
on the next replan is the safety net: it leaves existing slugs
unchanged (immutability), so the collision is visible to the human via
duplicate `[slug]` tokens and can be hand-resolved. No additional
locking is provided — `/do:replan` is the single point that
re-canonicalises the namespace.

## Phase 1: Automated Evidence Gathering

Launch these agents in parallel — no user interaction needed.

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
- Formulate 1-3 suggested new items

**Agent 4: GOALS.md Boundary Check**
If `GOALS.md` exists:
- Check for checkbox task lists or implementation details that leaked in
- Note any items that should be absorbed into PLAN.md

**Agent 5: Drift Detection**
For every checkbox in PLAN.md — **both `- [ ]` (open) and `- [x]` (completed-but-not-yet-archived) lines** — determine whether executing the item as currently worded would *remove or regress a feature that has been added since the plan item was written*. Agent 5 must evaluate `- [x]` items too because the Phase 2 precedence rule ("Drift takes precedence over done-ness") needs drift signal on `likely-done` candidates in order to fire — if Agent 5 skipped `- [x]` items, the `likely-done` ∩ `drifted` case described below could never actually arise. Agent 5 runs in Phase 1 alongside Agents 1–4, before Phase 2's `still-pending` classification exists; Phase 2 reconciles drift results against the done-ness evidence. Plans can drift: a "rip out X" or "replace Y with Z" item written six weeks ago may now collide with new functionality built on top of X or Y.

For each item, look at:
- Files/modules/functions the item would touch (infer from item text)
- Git history of those paths since the plan item appeared. Derive
  `<plan-item-date>` with this fallback chain:
  1. `git blame -L <line>,<line> -- PLAN.md` on the checkbox line to find
     the commit that introduced the item; use that commit's author date.
  2. If blame is unhelpful (item moved by a recent reformat, file rewrite,
     etc.), fall back to a fixed lookback window of **60 days**.
  Then run `git log --since=<plan-item-date> -- <path>` on each touched path.
- New exports, public APIs, tests, or call sites added to those paths
- Whether the item's stated goal (remove / replace / simplify / consolidate) would delete code that other new code now depends on

Classify each item as:
- `drift-safe` — no conflict; executing the item as written is still correct
- `drift-conflict` — executing as written would remove a new feature or break new call sites
- `drift-unclear` — touches recently-changed code but impact is ambiguous

For every `drift-conflict` / `drift-unclear`, record: the item, the conflicting feature/commit(s), and a one-line description of the collision.

## Phase 2: Auto-Triage

Using agent results, classify every PLAN.md item:

| Status | Criteria | Action |
|--------|----------|--------|
| `confirmed-done` | Git commit + code exists + tests pass | Archive to DONE.md |
| `likely-done` | Strong evidence but not 100% certain | Archive to DONE.md |
| `stale` | No commits, no code, no recent discussion; item is >30 days old with zero progress | Remove from PLAN.md |
| `drifted` | Agent 5 flagged `drift-conflict` or `drift-unclear` | **Never auto-modify** — surface to human (replan / examine / delete) |
| `still-pending` | No evidence of completion and no drift | Keep in PLAN.md |

**Drift takes precedence over done-ness.** If an item is both `likely-done` and `drifted`, treat it as `drifted` and surface it — the human needs to confirm what "done" actually means now.

## Phase 3: Apply Changes (or Checkpoint if Interactive)

### Default Mode (autonomous)

Apply all changes immediately without prompting — **except for `drifted` items, which are never auto-modified**:

1. Archive `confirmed-done` and `likely-done` items to DONE.md
2. Remove `stale` items from PLAN.md
3. Add suggested new items to the appropriate PLAN.md section
4. Absorb any tactical items found in GOALS.md
5. For each `drifted` item: leave it in PLAN.md but prepend a `> ⚠️ DRIFT:` blockquote describing the collision (conflicting feature + commit SHA). Do not edit or delete the item itself.
6. Print a brief summary of what was done:

```
Replan complete:
- Assigned {I} new plan-item IDs (Phase 0)
- Archived {N} completed items to DONE.md
- Removed {S} stale items
- Added {P} new suggested items
- {any GOALS.md boundary fixes}

⚠️ {D} drifted item(s) require human review — annotated in PLAN.md.
   Re-run with --interactive to resolve (replan / examine / delete).
```

If `D > 0`, emphasize the drift count visually in the printed summary (e.g. bold + the `⚠️` prefix shown above) so the user notices it. Do **not** actually exit with a non-zero process exit code — `/do:replan` is often chained into other commands and a non-zero exit would break that automation. Do not commit drifted-item resolutions silently.

### Interactive Mode (`--interactive`)

Present ONE consolidated summary to the user:

```
AskUserQuestion([{
  question: "Replan audit complete. Here's what I found:\n\n**Auto-archiving to DONE.md** ({N} items):\n{list of confirmed-done items}\n\n**Likely done — archive?** ({M} items):\n{list with evidence}\n\n**Flagged as stale** ({S} items):\n{list with last-activity dates}\n\n**⚠️ Drifted — would remove new features** ({D} items):\n{list with collision details}\n\n**New suggestions** ({P} items):\n{numbered list of proposed new items with rationale}\n\nHow should I proceed?",
  multiSelect: true,
  options: [
    { label: "Archive confirmed-done", description: "Move {N} confirmed items to DONE.md" },
    { label: "Archive likely-done too", description: "Also move {M} likely-done items to DONE.md" },
    { label: "Remove stale items", description: "Delete {S} stale items from PLAN.md" },
    { label: "Add suggested items", description: "Add {P} new items to PLAN.md" },
    { label: "Resolve drifted items", description: "Walk through {D} drifted items one-by-one" }
  ]
}])
```

**Exclusive options** (present only if the user asks, as a separate follow-up):
- "Show me the details" — print full evidence, then re-ask the above
- "Just clean up formatting" — only reformat PLAN.md, skip all archive/remove/add actions

If the user selects "Show me the details" as a response, print the full evidence and re-ask.

For suggested new items: if the user selects "Add suggested items", present each suggestion individually so they can accept, reject, or modify each one.

**For drifted items: never bundle.** If the user selects "Resolve drifted items", walk through each one individually with this prompt:

```
AskUserQuestion([{
  question: "**Drift detected** on plan item:\n\n> {item text}\n\n**Collision:** {one-line description}\n**Conflicting commit(s):** {SHAs + subjects}\n**New feature(s) at risk:** {names / paths}\n\nHow do you want to handle this?",
  multiSelect: false,
  options: [
    { label: "Replan — rewrite item", description: "I'll propose a revised version that preserves the new feature; you approve before it lands" },
    { label: "Examine — leave annotated", description: "Keep the item with the ⚠️ DRIFT note so you can investigate offline" },
    { label: "Delete from PLAN.md", description: "The new feature supersedes this item; remove it entirely" }
  ]
}])
```

If "Replan — rewrite item": draft a revised item that explicitly accounts for the new feature, then ask the user to accept / edit / reject the rewrite before writing to PLAN.md. Never auto-apply a rewrite.

## Phase 4: Archive to DONE.md

`DONE.md` lives at project root. It's the append-only log of completed work.

### Format

```markdown
# Done Log

Completed items archived from PLAN.md. For release notes, see `.changelogs/`.

## 2026-03-16

- **[auth-middleware-jwt] Implemented feature X** — added auth middleware and JWT validation
- **[user-profile-null-check] Fixed bug Y** — null check on user profile load
- **[extract-monolithic-handler] Refactored Z** — extracted shared utilities from monolithic handler

## 2026-03-10

- **[staging-ci-pipeline] Added CI pipeline for staging deploys** — GitHub Actions workflow gating PRs into the `staging` branch
- **[api-route-test-coverage] Test coverage for API routes** — added Vitest specs for every handler in `server/routes/`
```

### Rules

- Group by date (newest first)
- One line per item — concise description of what was done, not the original checkbox text
- **Lift the `[plan-id]` slug verbatim** from the source PLAN.md line — do NOT re-derive the slug from the (possibly-rewritten) archive description. Slugs are immutable once assigned (see [lib/plan-id-format.md](../../lib/plan-id-format.md)) and Phase 0's collision check parses DONE.md expecting the exact slug that was issued. The bold-wrapped title format makes the slug easy to grep across DONE.md and keeps the uniqueness check correct on future replans (retired slugs are not reused).
- If the completed item had substantial documentation (>20 lines), extract it to `docs/` and add a link: `- **[plan-id] Feature X** — see [docs/features/x.md](./docs/features/x.md)`
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

- [ ] [item-d-slug] Item D: Description
- [ ] [item-e-slug] Item E: Description

## Future / Ideas

- Item F: One-line description
- Item G: One-line description
```

### Guidelines

- **"Next Up" is ordered** — numbered list, max 5 items, these are the immediate priorities
- **"Backlog" is unordered** — checkbox items that are planned but not prioritized; each carries its `[plan-id]` slug from Phase 0
- **"Future / Ideas" has no checkboxes** — these are possibilities, not commitments, so they don't need slug IDs
- **No completed items** — they're in DONE.md
- **No detailed docs** — link to `docs/` files instead
- **No section if it's empty** — don't include "Backlog" with zero items
- **Preserve existing `[plan-id]` slugs verbatim** when items are moved between sections or rewritten — slugs are immutable once assigned (see [lib/plan-id-format.md](../../lib/plan-id-format.md)). Only Phase 0 generates new slugs.

## Phase 6: Absorb GOALS.md Violations

If tactical items (checkboxes, implementation details) were found in GOALS.md:
- Move them into the appropriate PLAN.md section
- Update GOALS.md to remove tactical content

## Phase 7: Commit

Stage and commit all files modified during this replan:
```bash
git add PLAN.md
# Stage optional files only if they exist and were modified
git add DONE.md 2>/dev/null || true
git add GOALS.md 2>/dev/null || true
git add docs/ 2>/dev/null || true
git commit -m "docs: replan — archive {N} completed items, update priorities"
```

Do NOT push unless explicitly asked.

## Notes

- If no PLAN.md exists, inform the user and offer to create one from codebase analysis
- The opportunity scanner suggestion is the key differentiator — every replan should surface at least one new idea
- DONE.md is append-only — never delete entries from it
- Keep PLAN.md under ~50 lines whenever possible — it should be scannable in seconds
- Adapt to existing project structure and conventions
- **Never silently resolve a `drifted` item.** Autonomous mode annotates and surfaces; only the human decides between replan / examine / delete.
