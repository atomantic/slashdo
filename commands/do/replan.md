---
description: Automated audit/triage of PLAN.md (or your GitHub/GitLab issue tracker) — prune completed items, suggest new work, keep the plan lean
argument-hint: "[--interactive] [--issues|--no-issues] [--issues-label <name>]"
---

# Replan Command

Audit the plan against the codebase, prune completed/stale items, suggest new work, and leave the plan lean. The plan lives in **PLAN.md** by default, or — with `--issues` — in your **GitHub/GitLab issue tracker**.

**Default mode: fully autonomous** — scan, prune, add, commit, no prompts. **`--interactive`** pauses after evidence gathering for approval.

**Philosophy:** PLAN.md should be short enough to paste into a prompt. Completed items don't belong in it — git history and the changelog are the audit trail (in issue mode: closed issues).

**Phase ordering:** phases 0 → 6.

## Parse Arguments

Parse `$ARGUMENTS` for:
- **`--interactive`**: pause after evidence gathering for approval (composes with both modes). Record `INTERACTIVE=true` (default `false`).
- **`--issues`** / **`--no-issues`**: enable **issue mode** (plan items are GitHub/GitLab issues) or force PLAN.md mode. `--issues` sets `ISSUE_MODE=true`; `--no-issues` sets `ISSUE_MODE=false`.
- **`--issues-label <name>`**: the label that scopes which issues are plan items. Record `PLAN_LABEL` (default `plan`). If passed while issue mode is off (no `--issues` and no saved `issues` default), warn that it has no effect and continue in PLAN.md mode.
- **Saved defaults.** If **neither** `--issues` nor `--no-issues` was passed, resolve `ISSUE_MODE` from the saved `issues` default — per-project `.slashdo.json` overrides the global `~/.claude/.slashdo-config.json`, key by key, built-in default `false`. Likewise take `PLAN_LABEL` from the saved `issues-label` default when `--issues-label` is absent. So `/do:config --issues` makes a bare `/do:replan` plan against the tracker.

## Mode Selection

The resolved `ISSUE_MODE` selects the mode:

**PLAN.md mode (default).** Every phase runs as written: assign slug IDs, gather evidence, triage, prune, rebuild PLAN.md, commit.

**Issue mode (`--issues`).** Only issues carrying `PLAN_LABEL` are plan items. PLAN.md is not a live tracking file (that churn is what this mode avoids): issue mode **always reads PLAN.md if one exists**, migrates every open item to the tracker (one labeled issue each), and **empties** PLAN.md to a stub that **never tracks issue numbers**, so later runs leave it untouched. (GOALS.md edits in Phase 5 are still committed.)

| Phase | PLAN.md mode | Issue mode |
|-------|--------------|------------|
| 0 | Assign kebab-slug IDs to PLAN.md checkboxes | VCS host detection + ensure the `PLAN_LABEL` exists; **no slug pass** (the issue number *is* the ID) |
| 1 | Gather evidence on PLAN.md lines | Gather evidence on open `PLAN_LABEL` issues **+ every open PLAN.md item** (migration candidates), flagging open questions |
| 2 | Triage each line | Triage each issue/item (same classification) |
| 3 | Edit PLAN.md (remove done/stale, add, annotate drift) | **Resolve open questions, then** close / create / comment+label issues; **migrate every pending PLAN.md item to an issue** |
| 4 | Rebuild PLAN.md to target structure | Print the open-issue list; **empty PLAN.md** to a note pointing at the tracker (no issue numbers recorded) |
| 5 | Move GOALS.md tactical items into PLAN.md | Create issues from GOALS.md tactical items |
| 6 | Commit PLAN.md (+ GOALS.md/docs) | Commit only the PLAN.md stub / GOALS.md edits; issue ops are the audit trail |

**Issue mode reads a single satellite file, once, up front.** The table above is the overview; every "Issue mode:" pointer in the phases below means "see the matching heading in that file" rather than restating the mechanics inline:

> Only when `ISSUE_MODE=true`, before Phase 0 begins:
>
> !read lib/replan-issues.md

**Item IDs.** PLAN.md mode: the kebab-slug (see [lib/plan-id-format.md](../../lib/plan-id-format.md)), claimed via a `next/<plan-id>` branch (`/do:next`'s claim convention — see that file). Issue mode: the **issue number**, claimed via `next/issue-<n>`; the slug pass (Phase 0) does not apply.

**Scope.** `--issues` changes `/do:replan` only; `do:better` and `do:depfree` still append slugged items to PLAN.md (`do:push` only marks existing items done — it never appends one).

## Boundary Rule: PLAN.md vs GOALS.md

**PLAN.md is tactical** (what are we building next, the backlog). **GOALS.md is strategic** (why the project exists, what success looks like, what we will never do).

**PLAN.md must NOT contain:**
- Mission statements, core tenets, or non-goals (GOALS.md)
- Completed items (changelog and git history are the audit trail)
- Detailed documentation (`docs/`)

## Phase 0: Assign Plan-Item IDs (or Set Up Issue Tracker)

**Issue mode (`--issues`):** skip this entire phase — see lib/replan-issues.md "Phase 0" (already read above via the gated include in Mode Selection).

**`/do:replan` owns the ID-assignment pass.** Every `- [ ]` / `- [x]` checkbox in PLAN.md must carry a stable slug ID in `[brackets]` immediately after the checkbox, so concurrent agents can claim distinct items via a `next/<plan-id>` branch name (see [lib/plan-id-format.md](../../lib/plan-id-format.md)). Run this phase BEFORE the evidence-gathering agents.

**Precondition:** PLAN.md exists. If missing, skip Phase 0 — creating PLAN.md is Phase 3/4's job, not this one's, and there is exactly one behavior for that: **autonomous mode creates it from codebase analysis without prompting** (slugs assigned at insert time); `--interactive` instead pauses to offer creating one before continuing.

1. Read PLAN.md. Collect every `[slug]` into a `takenIds` set **using the strict positional pattern** in [lib/plan-id-format.md](../../lib/plan-id-format.md) (section "Strict positional pattern for the Phase 0 collision scan"): slugs live at the bracketed token directly after `- [ ] ` / `- [x] ` (or the indented variant). Do NOT collect `[…]` tokens elsewhere in a line (inline links, reference shorthand) — treating them as taken forces needless collision suffixes.
2. For each `- [ ]` / `- [x]` line without an ID, derive a slug per [lib/plan-id-format.md](../../lib/plan-id-format.md): strip markdown wrappers from the title; lowercase + kebab-case; truncate to 50 chars at the last `-` boundary; append `-2`/`-3`/... on collision against `takenIds`.
3. Rewrite the line as `- [ ] [<slug>] <rest>` (checkbox state, indent, and trailing content unchanged). Add the new slug to `takenIds`.
4. **Never rewrite an existing `[slug]`** — slugs are immutable once assigned.
5. Track the count `{I}` of IDs assigned for the Phase 3 / Phase 6 summary.

If no IDs were assigned, this phase is a no-op with no commit of its own.

**Concurrent-appender arbitration.** `do:better`, `do:better-swift`, and `do:depfree` append `- [ ]` items with their own slugs, each re-reading PLAN.md immediately before writing. If two race and collide, Phase 0 leaves both slugs unchanged so the duplicate is visible for hand-resolution; `/do:replan` is the only re-canonicalisation point.

## Phase 1: Automated Evidence Gathering

**Issue mode (`--issues`):** see lib/replan-issues.md "Phase 1" (already read above) — it redefines the item source as open `PLAN_LABEL` issues, adds the migration-candidate + open-question scan over PLAN.md, and adds Agent 6 (dependency graph).

Launch these agents in parallel.

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
For every checkbox in PLAN.md — **both `- [ ]` and `- [x]` lines** — determine whether executing the item as worded would *remove or regress a feature added since it was written*. `- [x]` items are included because the Phase 2 rule "Drift takes precedence over done-ness" needs drift signal on `likely-done` candidates.

For each item, look at:
- Files/modules/functions the item would touch (infer from item text)
- Git history of those paths since the plan item appeared. Derive `<plan-item-date>`:
  1. `git blame -L <line>,<line> -- PLAN.md` on the checkbox line; use the introducing commit's author date.
  2. If blame is unhelpful (reformat, file rewrite), fall back to a fixed lookback window of **60 days**.
  Then run `git log --since=<plan-item-date> -- <path>` on each touched path.
- New exports, public APIs, tests, or call sites added to those paths
- Whether the item's goal (remove / replace / simplify / consolidate) would delete code that new code now depends on

Classify each item as:
- `drift-safe` — no conflict; executing the item as written is still correct
- `drift-conflict` — executing as written would remove a new feature or break new call sites
- `drift-unclear` — touches recently-changed code but impact is ambiguous

For every `drift-conflict` / `drift-unclear`, record: the item, the conflicting feature/commit(s), and a one-line description of the collision.

(Issue mode adds **Agent 6: Dependency & Priority Graph**, which only runs when `ISSUE_MODE=true` — see lib/replan-issues.md "Phase 1".)

## Phase 2: Auto-Triage

**Issue mode (`--issues`):** see lib/replan-issues.md "Phase 2" (already read above) — same classification table below, retargeted to issues (`updatedAt` for staleness), plus epic handling, the blocked-issue staleness exemption, and dependency-marker hygiene.

Using agent results, classify every PLAN.md item:

| Status | Criteria | Action |
|--------|----------|--------|
| `confirmed-done` | Git commit + code exists + tests pass | Remove from PLAN.md |
| `likely-done` | Strong evidence but not 100% certain | Remove from PLAN.md |
| `stale` | No commits, no code, no recent discussion; item is >30 days old with zero progress | Remove from PLAN.md |
| `drifted` | Agent 5 flagged `drift-conflict` or `drift-unclear` | **Never auto-modify** — surface to human (replan / examine / delete) |
| `still-pending` | No evidence of completion and no drift | Keep in PLAN.md |

**Drift takes precedence over done-ness.** If an item is both `likely-done` and `drifted`, treat it as `drifted` and surface it — the human needs to confirm what "done" actually means now.

## Phase 3: Apply Changes (or Checkpoint if Interactive)

**Issue mode (`--issues`):** see lib/replan-issues.md "Phase 3" (already read above) — resolves open questions first (even autonomously), then applies triage decisions as issue operations (close / create / comment+label) instead of PLAN.md edits, dedups every create against existing open issues, and prints its own summary format.

### Default Mode (autonomous)

Apply all changes immediately without prompting — **except for `drifted` items, which are never auto-modified**:

1. Remove `confirmed-done` and `likely-done` items from PLAN.md. The commit message lists the removed slugs (e.g. `docs: replan — completed [slug-a], [slug-b]`).
2. Remove `stale` items from PLAN.md
3. Add suggested new items to the appropriate PLAN.md section
4. Absorb any tactical items found in GOALS.md
5. For each `drifted` item: leave it in PLAN.md but prepend a `> ⚠️ DRIFT:` blockquote describing the collision (conflicting feature + commit SHA). Do not edit or delete the item itself.
6. Print a brief summary of what was done:

```
Replan complete:
- Assigned {I} new plan-item IDs (Phase 0)
- Removed {N} completed items from PLAN.md
- Removed {S} stale items
- Added {P} new suggested items
- {any GOALS.md boundary fixes}

⚠️ {D} drifted item(s) require human review — annotated in PLAN.md.
   Re-run with --interactive to resolve (replan / examine / delete).
```

If `D > 0`, emphasize the drift count visually (bold + the `⚠️` prefix). Do **not** exit non-zero — `/do:replan` is often chained into other commands. Do not commit drifted-item resolutions silently.

### Interactive Mode (`--interactive`)

**Issue mode (`--issues`):** same prompt below, but see lib/replan-issues.md "Phase 3" — each selected action runs the matching issue operation and the drifted walk-through offers replan / examine / close instead of replan / examine / delete.

Present ONE consolidated summary to the user:

```
AskUserQuestion([{
  question: "Replan audit complete. Here's what I found:\n\n**Confirmed done — remove from PLAN.md** ({N} items):\n{list of confirmed-done items}\n\n**Likely done — remove?** ({M} items):\n{list with evidence}\n\n**Flagged as stale** ({S} items):\n{list with last-activity dates}\n\n**⚠️ Drifted — would remove new features** ({D} items):\n{list with collision details}\n\n**New suggestions** ({P} items):\n{numbered list of proposed new items with rationale}\n\nHow should I proceed?",
  multiSelect: true,
  options: [
    { label: "Remove confirmed-done", description: "Strike {N} confirmed items from PLAN.md (git log + changelog are the audit trail)" },
    { label: "Remove likely-done too", description: "Also strike {M} likely-done items from PLAN.md" },
    { label: "Remove stale items", description: "Delete {S} stale items from PLAN.md" },
    { label: "Add suggested items", description: "Add {P} new items to PLAN.md" },
    { label: "Resolve drifted items", description: "Walk through {D} drifted items one-by-one" }
  ]
}])
```

**Exclusive options** (present only if the user asks, as a separate follow-up):
- "Show me the details" — print full evidence, then re-ask the above
- "Just clean up formatting" — only reformat PLAN.md, skip all remove/add actions

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

## Phase 4: Rebuild PLAN.md

**Issue mode (`--issues`):** see lib/replan-issues.md "Phase 4" (already read above) — doesn't rebuild PLAN.md; instead prints the open-issue list and empties PLAN.md to a stub pointing at the tracker.

Rewrite PLAN.md to be lean and actionable:

### Target Structure

```markdown
# Development Plan

For project mission and milestones, see [GOALS.md](./GOALS.md).

## Backlog

- [ ] [item-a-slug] Item A: Brief actionable description
- [ ] [item-b-slug] Item B: Brief actionable description
- [ ] [item-c-slug] Item C: Brief actionable description

## Future / Ideas

- Item F: One-line description
- Item G: One-line description
```

### Guidelines

- **"Backlog" is ordered** — top-to-bottom priority. It uses unordered-list syntax (each entry is a `- [ ]` checkbox carrying its `[plan-id]` slug from Phase 0) but the *position* is meaningful: `/do:next` walks it top-to-bottom and claims the first item whose slug isn't in flight, so put the highest-priority actionable work first. There is no separate "Next Up" section — that would put the top-priority items where `/do:next` can't find a `[slug]` to claim.
- **"Future / Ideas" has no checkboxes** — possibilities, not commitments, so no slug IDs
- **No completed items**, **no detailed docs** (link to `docs/`), **no empty sections**
- **Preserve existing `[plan-id]` slugs verbatim** when items are moved or rewritten (see [lib/plan-id-format.md](../../lib/plan-id-format.md)). Only Phase 0 generates new slugs.

## Phase 5: Absorb GOALS.md Violations

If tactical items (checkboxes, implementation details) were found in GOALS.md:
- Move them into the appropriate PLAN.md section
- Update GOALS.md to remove tactical content

**Issue mode (`--issues`):** see lib/replan-issues.md "Phase 5" (already read above) — creates an issue for each leaked tactical item instead of moving it into PLAN.md.

## Phase 6: Commit

Stage and commit all files modified during this replan:
```bash
git add PLAN.md
# Stage optional files only if they exist and were modified
git add GOALS.md 2>/dev/null || true
git add docs/ 2>/dev/null || true
git commit -m "docs: replan — completed [slug-a], [slug-b]; pruned {S} stale, added {P} new"
```

The commit subject is the audit trail — list the completed slugs explicitly so `git log --grep=<slug>` finds them later.

**Issue mode (`--issues`):** see lib/replan-issues.md "Phase 6" (already read above) — the tracker is the audit trail, not a commit; commit only on-disk changes this run made (the Phase 4 PLAN.md edit, Phase 5 GOALS.md/`docs/` edits), and only if something changed on disk.

Do NOT push unless explicitly asked.

## Notes

- The opportunity scanner suggestion is the key differentiator — every replan should surface at least one new idea
- Keep PLAN.md under ~50 lines whenever possible
- Adapt to existing project structure and conventions
- **Never silently resolve a `drifted` item.** Only the human decides between replan / examine / delete (issue mode: replan / examine / close).
