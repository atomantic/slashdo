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
- **Saved defaults.** If **neither** `--issues` nor `--no-issues` was passed, resolve `ISSUE_MODE` from the saved `issues` default — per-project `.slashdo.json` overrides the global `~/.claude/.slashdo-config.json` (precedence per [lib/review-config-defaults.md](../../lib/review-config-defaults.md)), built-in default `false`. Likewise take `PLAN_LABEL` from the saved `issues-label` default when `--issues-label` is absent. So `/do:config --issues` makes a bare `/do:replan` plan against the tracker.

## Mode Selection

The resolved `ISSUE_MODE` selects the mode:

**PLAN.md mode (default).** Every phase runs as written: assign slug IDs, gather evidence, triage, prune, rebuild PLAN.md, commit.

**Issue mode (`--issues`).** Only issues carrying `PLAN_LABEL` are plan items. PLAN.md is not a live tracking file (that churn is what this mode avoids): issue mode **always reads PLAN.md if one exists**, migrates every open item to the tracker (one labeled issue each), and **empties** PLAN.md to a stub that **never tracks issue numbers**, so later runs leave it untouched. (GOALS.md edits in Phase 5 are still committed.) Each phase has an **"Issue mode:"** callout:

| Phase | PLAN.md mode | Issue mode |
|-------|--------------|------------|
| 0 | Assign kebab-slug IDs to PLAN.md checkboxes | VCS host detection + ensure the `PLAN_LABEL` exists; **no slug pass** (the issue number *is* the ID) |
| 1 | Gather evidence on PLAN.md lines | Gather evidence on open `PLAN_LABEL` issues **+ every open PLAN.md item** (migration candidates), flagging open questions |
| 2 | Triage each line | Triage each issue/item (same classification) |
| 3 | Edit PLAN.md (remove done/stale, add, annotate drift) | **Resolve open questions, then** close / create / comment+label issues; **migrate every pending PLAN.md item to an issue** |
| 4 | Rebuild PLAN.md to target structure | Print the open-issue list; **empty PLAN.md** to a note pointing at the tracker (no issue numbers recorded) |
| 5 | Move GOALS.md tactical items into PLAN.md | Create issues from GOALS.md tactical items |
| 6 | Commit PLAN.md (+ GOALS.md/docs) | Commit only the PLAN.md stub / GOALS.md edits; issue ops are the audit trail |

**Actionable-issues invariant.** Every issue replan files must be **well-formed and decision-complete**. Before migrating an item, replan surfaces any open question or pending decision on it (Phase 3) and asks the human to resolve it, folding the resolution into the issue body. If the human explicitly **defers**, that item stays in PLAN.md (reported in the summary) — the only thing that may remain there.

**A `Depends on #N` does NOT violate this invariant.** "Actionable" means "no unresolved question/decision," not "pickable this very second." A blocked-but-well-formed issue is merely *sequenced* (`/do:next` claims it once #N closes); only an *undecided* item is barred.

**Item IDs.** PLAN.md mode: the kebab-slug (see [lib/plan-id-format.md](../../lib/plan-id-format.md)), claimed via `cos/<task>/<plan-id>/<agent>` branches. Issue mode: the **issue number**, branch `cos/<task>/issue-<n>/<agent>`; the slug pass (Phase 0) does not apply.

**Scope.** `--issues` changes `/do:replan` only; `do:better`, `do:push`, `do:depfree` still append slugged items to PLAN.md.

## Boundary Rule: PLAN.md vs GOALS.md

**PLAN.md is tactical** (what are we building next, the backlog). **GOALS.md is strategic** (why the project exists, what success looks like, what we will never do).

**PLAN.md must NOT contain:**
- Mission statements, core tenets, or non-goals (GOALS.md)
- Completed items (changelog and git history are the audit trail)
- Detailed documentation (`docs/`)

## Phase 0: Assign Plan-Item IDs (or Set Up Issue Tracker)

> **Issue mode (`--issues`):** Skip the slug-assignment pass — the issue number *is* the ID. Instead:
>
> 1. **Detect the VCS host** per [lib/vcs-host.md](../../lib/vcs-host.md): select it
>    from the `origin` remote, then check that host's credentials (probing
>    `gh auth status` first would pick GitHub on any machine logged in to both
>    services). It sets `VCS_HOST` (`github`/`gitlab`) and `CLI_TOOL` (`gh`/`glab`),
>    and halts the run when the selected CLI cannot reach this repo. **Surface its
>    message as the abort**, plus one line: "Or drop `--issues` to plan against
>    PLAN.md instead." Never fall back to PLAN.md or to the other CLI.
> 2. **Ensure the scoping label exists.** `gh label create <PLAN_LABEL> --description "Tracked by /do:replan" 2>/dev/null || true` (glab: `glab label create --name <PLAN_LABEL> --color "#428BCA" 2>/dev/null || true` — glab requires a color).
>
> Then proceed to Phase 1. The rest of Phase 0 is PLAN.md-only.

**`/do:replan` owns the ID-assignment pass.** Every `- [ ]` / `- [x]` checkbox in PLAN.md must carry a stable slug ID in `[brackets]` immediately after the checkbox, so concurrent agents can claim distinct items via `cos/<task>/<plan-id>/<agent>` branch names. Run this phase BEFORE the evidence-gathering agents.

**Precondition:** PLAN.md exists. If missing, skip Phase 0 and let Phase 3 create PLAN.md (slugs assigned at insert time).

1. Read PLAN.md. Collect every `[slug]` into a `takenIds` set **using the strict positional pattern** in [lib/plan-id-format.md](../../lib/plan-id-format.md) (section "Strict positional pattern for the Phase 0 collision scan"): slugs live at the bracketed token directly after `- [ ] ` / `- [x] ` (or the indented variant). Do NOT collect `[…]` tokens elsewhere in a line (inline links, reference shorthand) — treating them as taken forces needless collision suffixes.
2. For each `- [ ]` / `- [x]` line without an ID, derive a slug per [lib/plan-id-format.md](../../lib/plan-id-format.md): strip markdown wrappers from the title; lowercase + kebab-case; truncate to 50 chars at the last `-` boundary; append `-2`/`-3`/... on collision against `takenIds`.
3. Rewrite the line as `- [ ] [<slug>] <rest>` (checkbox state, indent, and trailing content unchanged). Add the new slug to `takenIds`.
4. **Never rewrite an existing `[slug]`** — slugs are immutable once assigned.
5. Track the count `{I}` of IDs assigned for the Phase 3 / Phase 6 summary.

If no IDs were assigned, this phase is a no-op with no commit of its own.

**Concurrent-appender arbitration.** `do:better`, `do:better-swift`, and `do:depfree` append `- [ ]` items with their own slugs, each re-reading PLAN.md immediately before writing. If two race and collide, Phase 0 leaves both slugs unchanged so the duplicate is visible for hand-resolution; `/do:replan` is the only re-canonicalisation point.

## Phase 1: Automated Evidence Gathering

Launch these agents in parallel.

> **Issue mode (`--issues`):** Wherever the agents say "PLAN.md item," read "open
> `PLAN_LABEL` issue." Source the item list once, up front:
> `gh issue list --label <PLAN_LABEL> --state open --json number,title,body,labels,createdAt,updatedAt`
> (glab: `glab issue list --label <PLAN_LABEL> --output json`). Only **open** labeled
> issues are triaged. Agents 1–3 and 5 operate per open issue; **Agent 4 (GOALS.md)
> is unchanged**. For Agent 5's drift dating, use each issue's `createdAt` as the
> `<plan-item-date>` (no `git blame`); use `updatedAt` for the Phase 2 staleness window.
>
> **Migration candidates + open-question detection.** **Always read PLAN.md if one
> exists.** Every open item in it (`- [ ]`, plus open prose/numbered roadmap entries)
> is a migration candidate for Phase 3; completed (`- [x]`) and stale items are
> dropped when PLAN.md is emptied. Across the migration candidates and Agent 3's
> suggestions, flag every item carrying an **open question or undecided choice**.
> Signals: an `## Open Questions` / `## Decisions` section; a line ending in `?`;
> markers like `TBD`, `TODO: decide`, `decision needed`, `unclear`, `needs input`,
> `should we`, or an unresolved `A vs B` / `either…or`; a `> QUESTION:` /
> `> DECISION:` blockquote. Record each as `{item, question, options-if-any}` for the
> Phase 3 resolution gate.

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

**Agent 6: Dependency & Priority Graph (issue mode only)**
Only runs when `ISSUE_MODE=true`. For every open issue under consideration:
- Parse the body for `Depends on #<N>` / `Blocked by #<N>` lines (case-insensitive; a line may list several `#<N>`) — the portable, cross-host convention. Also read GitHub's **native** blocked-by relationship where the API exposes it (GitHub-only; on GitLab the body lines are the only source). Record each issue's blocker set.
- Resolve each referenced #N's state with the **detected `CLI_TOOL`** (`gh issue view <N> --json state -q .state`; glab: `glab issue view <N> --output json` then read `.state`), and **normalize the value** before comparing: GitHub reports `OPEN`/`CLOSED`, GitLab `opened`/`closed`. Mark the issue **blocked** if any blocker is still open, **clearable** if a referenced blocker is now closed (a stale marker to strip), **broken** if a referenced number doesn't exist, and detect **cycles** across the collected edges.
- Note each issue's `priority:<N>` label if present (summary only — not triage evidence).

Feed this graph to Phase 2: `blocked` and `clearable` issues are both kept `still-pending` (never `stale` — a parked issue's old `updatedAt` is expected, and the run that unblocks it must not close it); `clearable`/`broken`/`cycle` findings drive the dependency-marker hygiene fixes in the Phase 2 callout.

## Phase 2: Auto-Triage

> **Issue mode (`--issues`):** Classify every open `PLAN_LABEL` issue with the same
> table — "Remove from PLAN.md" becomes "Close the issue" (Phase 3 maps the actions).
> Staleness is measured from the issue's `updatedAt`.
>
> **Epics are classified by their children, not by code evidence.** For any issue
> that is an epic (carries `epic`/a repo umbrella label, has native sub-issues, or
> task-lists other issues in its body), resolve its children and compute its
> completeness state with the shared epic logic.
>
> **GitHub only — derive `GH_HOST` first with the shared snippet below** (skip it entirely
> on GitLab, whose `glab` calls resolve the host from the remote themselves and where the
> snippet's `gh auth` precheck would abort the run). That logic's `gh api` calls ignore the
> repo remote and default to github.com, so pass `--hostname "$GH_HOST"` on every one:
>
> !`cat ~/.claude/lib/gh-host.md`
>
> !`cat ~/.claude/lib/epic-children.md`
>
> Map the epic's state onto the triage table: `epic-done` → `confirmed-done` (close
> it); `epic-wrapup` or `epic-open` → `still-pending` (**keep open**); `epic-empty` →
> ordinary classification. **Never** close an `epic-open`/`epic-wrapup` epic even if
> its title reads as done.
>
> **Blocked issues are not stale.** An issue with a `Depends on #<N>` / `Blocked by
> #<N>` line (or GitHub's native blocked-by relationship) where #N is still OPEN is
> `still-pending` (**keep open**) regardless of `updatedAt` age. (`/do:next` skips it
> for the same reason — see its Phase 1 step 4.)
>
> **Dependency-marker hygiene.** Reconcile declared dependencies against reality and
> fold fixes into Phase 3:
> - A `Depends on #N` **or `Blocked by #N`** reference whose **#N is now CLOSED** →
>   **strip that reference** from the body (if a line listed several, drop only the
>   closed ones). **Classify this just-unblocked issue `still-pending` for this run —
>   exempt from the >30-day `stale` rule even though its `updatedAt` is old.**
> - A `Depends on #N` referencing a **non-existent / wrong number** → flag it (in
>   `--interactive`, surface for correction; autonomously, comment so a human fixes it
>   rather than silently deleting a real intent).
> - A **dependency cycle** (A↔B, or longer) → flag it as a planning error; both ends
>   stay blocked until a human breaks it.
>
> **Priority labels and dispatch hints (`priority:<N>`, `model:`, `effort:`) are
> advisory, never a triage signal.** They only steer `/do:next`; don't add, remove, or
> read them as evidence here. Replan MAY set `Depends on #N` (hard predecessor),
> `priority:<N>` (soft sequencing), or a dispatch hint (per
> [lib/plan-issue-mode.md](../../lib/plan-issue-mode.md) "The dispatch hint") on
> **new** work it investigated well enough to justify, but must **not** stamp hints
> onto migrated PLAN.md items or existing issues in bulk. A `Depends on #N` issue is
> **deferred, not un-actionable** — see the invariant note above.

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

> **Issue mode (`--issues`): resolve open questions FIRST.** For each item from
> Phase 1 carrying an unresolved question or decision, ask the human to resolve it —
> even in autonomous (non-`--interactive`) runs:
>
> ```
> AskUserQuestion([{
>   question: "Before I file this as an issue, it needs a decision:\n\n> {item text}\n\n**Open question:** {question}",
>   multiSelect: false,
>   options: [
>     { label: "{option A}", description: "File the issue scoped to option A" },
>     { label: "{option B}", description: "File the issue scoped to option B" },
>     { label: "Defer — don't file yet", description: "Leave this item in PLAN.md until the decision is made" }
>   ]
> }])
> ```
>
> (When the item names explicit choices, surface them as options; otherwise offer
> "Decide now" with free-text and "Defer.") Fold the decision into the issue body
> (e.g. a `## Decision` line). If the human **defers**, do not file — keep the item
> in PLAN.md and list it under "deferred — needs a decision" in the summary.
>
> **Apply the triage decisions** as issue operations (GitHub `gh`; glab in parens):
>
> - `confirmed-done` / `likely-done` → **close** with an evidence comment:
>   `gh issue close <n> --comment "Closed by /do:replan — <evidence>"`
>   (glab: `glab issue note <n> -m "<evidence>"` then `glab issue close <n>`).
> - **epic mapped to `confirmed-done`** (state `epic-done`) → **close** listing the
>   closed children: `gh issue close <n> --comment "All children closed (#a, #b, …) and wrap-up complete — closing epic. (/do:replan)"`.
>   An `epic-wrapup`/`epic-open` epic is never closed here (when `epic-wrapup`,
>   optionally comment that only the epic's own wrap-up remains).
> - `stale` → close with a stale-reason comment (note the last-activity date).
> - new suggestions **and every pending PLAN.md item being migrated** → **create**:
>   `gh issue create --title "<title>" --body "<body incl. any ## Decision>" --label <PLAN_LABEL>`
>   (glab: `glab issue create --title "<title>" --description "<body>" --label <PLAN_LABEL>`).
>   Capture the returned issue number for the summary and for Phase 4.
> - `drifted` → **never auto-close.** Post the `⚠️ DRIFT:` description as a
>   comment (`gh issue comment <n> --body "⚠️ DRIFT: <collision> — conflicting commit <sha>"`)
>   and apply a `drift` label (`gh label create drift 2>/dev/null || true` first, then
>   `gh issue edit <n> --add-label drift`; glab: `glab label create --name drift --color "#E8A33D" 2>/dev/null || true` first, then `glab issue note <n> -m "<drift>"` + `glab issue update <n> --label drift`).
>
> The audit trail is the issue's close event + comment — **not** git log. Skip steps
> 1–5 below and print the issue-mode summary. (`--interactive` still applies.)

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

**Issue mode** prints the issue-number variant instead (list the actual numbers):

```
Replan complete (issue mode, label: {PLAN_LABEL}):
- Closed {N} completed issue(s): #a, #b, …
- Closed {S} stale issue(s): #c, …
- Created {P} new issue(s): #d, …  ({Mg} migrated from PLAN.md, {Op} from the opportunity scan)
- {any GOALS.md boundary fixes}

⚠️ {D} drifted issue(s) require human review — commented + labeled `drift`: #e, …
   Re-run with --interactive to resolve (replan / examine / close).

⏸️ {Q} item(s) deferred — need a decision before they can be filed (left in PLAN.md):
   {one line each}
```

Omit the deferred block when `{Q}` is 0. List the migrated-vs-scanner split only when a PLAN.md was present.

If `D > 0`, emphasize the drift count visually (bold + the `⚠️` prefix). Do **not** exit non-zero — `/do:replan` is often chained into other commands. Do not commit drifted-item resolutions silently.

### Interactive Mode (`--interactive`)

> **Issue mode (`--issues`):** Same prompt, but each selected action runs the Phase 3
> issue operation — "Remove …" closes, "Add suggested items" creates — and the
> per-drifted walk-through offers **Replan — rewrite issue** (`gh issue edit <n>`
> after approval) / **Examine — leave commented** (keep the `drift` label + comment)
> / **Close the issue** (the new feature supersedes it). Reference items by `#<number>`.

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

> **Issue mode (`--issues`):** Don't rebuild PLAN.md. Instead: (1) print the open
> labeled set (`gh issue list --label <PLAN_LABEL> --state open`, glab equivalent)
> as the post-replan backlog; (2) **empty PLAN.md** — remove every item, keeping only
> one the human explicitly deferred. **Do not list issue numbers in PLAN.md.**
> Replace the body with:
>
> ```markdown
> # Development Plan
>
> This project tracks its roadmap as issues — see the open issues labeled
> `{PLAN_LABEL}` on the repository's Issues page. Managed by `/do:replan --issues`.
> ```
>
> (If an item was deferred, list it under a `## Pending a decision` heading below
> the note.) The PLAN.md edit is committed in Phase 6. Then continue to Phase 5.

Rewrite PLAN.md to be lean and actionable:

### Target Structure

```markdown
# Development Plan

For project mission and milestones, see [GOALS.md](./GOALS.md).

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

- **"Next Up" is ordered** — numbered list, max 5 items
- **"Backlog" is unordered** — checkbox items, each carrying its `[plan-id]` slug from Phase 0
- **"Future / Ideas" has no checkboxes** — possibilities, not commitments, so no slug IDs
- **No completed items**, **no detailed docs** (link to `docs/`), **no empty sections**
- **Preserve existing `[plan-id]` slugs verbatim** when items are moved or rewritten (see [lib/plan-id-format.md](../../lib/plan-id-format.md)). Only Phase 0 generates new slugs.

## Phase 5: Absorb GOALS.md Violations

If tactical items (checkboxes, implementation details) were found in GOALS.md:
- Move them into the appropriate PLAN.md section
- Update GOALS.md to remove tactical content

> **Issue mode (`--issues`):** Same intent, different destination — create an
> issue for each leaked tactical item
> (`gh issue create --title … --body … --label <PLAN_LABEL>`), then strip the
> tactical content from GOALS.md; its edit is committed in Phase 6.

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

> **Issue mode (`--issues`):** The tracker is the audit trail, not a commit. Commit
> **only** on-disk changes this run made (the Phase 4 PLAN.md edit, Phase 5 GOALS.md
> or `docs/` edits) — e.g.
> `git add PLAN.md GOALS.md 2>/dev/null || true; git commit -m "docs: replan — migrated plan to issues #c, #d; pruned PLAN.md"`.
> If nothing on disk changed, there is no commit. Do NOT push unless explicitly asked.

Do NOT push unless explicitly asked.

## Notes

- If no PLAN.md exists, inform the user and offer to create one from codebase analysis
- The opportunity scanner suggestion is the key differentiator — every replan should surface at least one new idea
- Keep PLAN.md under ~50 lines whenever possible
- Adapt to existing project structure and conventions
- **Never silently resolve a `drifted` item.** Only the human decides between replan / examine / delete (issue mode: replan / examine / close).
- **Issue mode (`--issues`)**: if there's no PLAN.md (or it's empty), seed the backlog from the opportunity scanner. Items created by other slashdo commands still land in PLAN.md; reconciling the two is out of scope.
