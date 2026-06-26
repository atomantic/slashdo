---
description: Automated audit/triage of PLAN.md (or your GitHub/GitLab issue tracker) — prune completed items, suggest new work, keep the plan lean
argument-hint: "[--interactive] [--issues|--no-issues] [--issues-label <name>]"
---

# Replan Command

Automatically audit the plan against the codebase, prune completed/stale items, suggest new work, and leave the plan lean and actionable. The plan lives in **PLAN.md** by default, or — with `--issues` — in your **GitHub/GitLab issue tracker**.

**Default mode: fully autonomous.** Scans the codebase, removes done and stale items, adds suggested new items, and commits — no user interaction.

**`--interactive` mode:** Pauses after evidence gathering to present findings and get user approval before making changes.

**Philosophy:** PLAN.md should be short enough to paste into a prompt. Completed items don't belong in the active plan — the audit trail lives in git history and the changelog. In issue mode, the equivalent rule is that closed issues are the audit trail; the open labeled set stays lean.

**Phase ordering:** This command runs phases 0 → 6.

## Parse Arguments

Parse `$ARGUMENTS` for:
- **`--interactive`**: pause after evidence gathering to present findings and get approval before applying changes (composes with both modes). Record `INTERACTIVE=true` (default `false`).
- **`--issues`** / **`--no-issues`**: enable **issue mode** — track plan items as GitHub/GitLab issues instead of PLAN.md — or force PLAN.md mode. `--issues` sets `ISSUE_MODE=true`; `--no-issues` sets `ISSUE_MODE=false`.
- **`--issues-label <name>`**: the label that scopes which issues are plan items. Record `PLAN_LABEL` (default `plan`). Only meaningful in issue mode; if passed while issue mode is off (no `--issues` and no saved `issues` default), warn that it has no effect and continue in PLAN.md mode.
- **Saved defaults.** If the user passed **neither** `--issues` nor `--no-issues`, resolve `ISSUE_MODE` from the saved `issues` default — per-project `.slashdo.json` overrides the global `~/.claude/.slashdo-config.json` (the precedence is the one in [lib/review-config-defaults.md](../../lib/review-config-defaults.md)), built-in default `false`. Likewise take `PLAN_LABEL` from the saved `issues-label` default when `--issues-label` is absent. So `/do:config --issues` makes a bare `/do:replan` plan against the tracker.

## Mode Selection

This command operates in one of two modes, selected by the resolved `ISSUE_MODE` (set in Parse Arguments — `true` when `--issues` was passed **or** a saved `issues=true` default applies and `--no-issues` was not passed; `false` otherwise). A bare `/do:replan` in a repo with `/do:config --issues` saved therefore runs in issue mode:

**PLAN.md mode (default).** The plan lives in `PLAN.md`. Every phase below runs as
written: assign slug IDs, gather evidence, triage, prune, rebuild PLAN.md, commit.

**Issue mode (`--issues`).** The plan lives in your GitHub/GitLab issue tracker;
only issues carrying the `PLAN_LABEL` (default `plan`) are plan items. **The point
of this mode is to stop PLAN.md from churning — and generating merge conflicts —
while the team works on issues.** So PLAN.md is not a live tracking file here.
Issue mode **always reads PLAN.md if one exists**, and when it has content,
migrates every open item out to the tracker (one labeled issue each) and **empties
PLAN.md**. PLAN.md **never tracks issue numbers** — it ends as an empty stub
pointing at the tracker, so it no longer changes as issues come and go. After the
first migration it stays empty, so later runs read it, find nothing to migrate, and
leave it untouched. (GOALS.md edits in Phase 5 are still committed.) Each phase has
an **"Issue mode:"** callout describing how it deviates. The phase-by-phase
mapping:

| Phase | PLAN.md mode | Issue mode |
|-------|--------------|------------|
| 0 | Assign kebab-slug IDs to PLAN.md checkboxes | VCS host detection + ensure the `PLAN_LABEL` exists; **no slug pass** (the issue number *is* the ID) |
| 1 | Gather evidence on PLAN.md lines | Gather evidence on open `PLAN_LABEL` issues **+ every open PLAN.md item** (migration candidates), flagging open questions |
| 2 | Triage each line | Triage each issue/item (same classification) |
| 3 | Edit PLAN.md (remove done/stale, add, annotate drift) | **Resolve open questions, then** close / create / comment+label issues; **migrate every pending PLAN.md item to an issue** |
| 4 | Rebuild PLAN.md to target structure | Print the open-issue list; **empty PLAN.md** to a note pointing at the tracker (no issue numbers recorded) |
| 5 | Move GOALS.md tactical items into PLAN.md | Create issues from GOALS.md tactical items |
| 6 | Commit PLAN.md (+ GOALS.md/docs) | Commit only the PLAN.md stub / GOALS.md edits; issue ops are the audit trail |

**Actionable-issues invariant.** Every issue replan files must be immediately
claimable — a well-formed task, not a question. Before migrating an item, replan
surfaces any **open question or pending decision** attached to it (see Phase 3) and
asks the human to resolve it; the resolution is folded into the issue body. The
expected outcome of a migration is that **all** items are resolved and filed, so
PLAN.md ends empty. The one exception: if the human explicitly **defers** a
decision, that single item cannot become a claimable issue, so it stays in PLAN.md
(reported in the summary) until someone decides — it is the only thing that may
remain. The tracker never accumulates un-actionable issues.

**Item IDs.** In PLAN.md mode the stable ID is the kebab-slug (see
[lib/plan-id-format.md](../../lib/plan-id-format.md)); concurrent agents claim
items via `cos/<task>/<plan-id>/<agent>` branches. In issue mode the stable ID is
the **issue number**; the equivalent branch is `cos/<task>/issue-<n>/<agent>`. The
slug pass (Phase 0) and the kebab-slug rules do **not** apply in issue mode.

**Scope.** `--issues` changes the behavior of `/do:replan` only. Other slashdo
commands (`do:better`, `do:push`, `do:depfree`) still append slugged items to
PLAN.md regardless of this flag — issue mode is a replan-local concept.

## Boundary Rule: PLAN.md vs GOALS.md

**PLAN.md is tactical. GOALS.md is strategic.**

PLAN.md answers: *What are we building next? What's the backlog?*
GOALS.md answers: *Why does this project exist? What does success look like? What will we never do?*

**PLAN.md must NOT contain:**
- Mission statements, core tenets, or non-goals (those belong in GOALS.md)
- Completed items (the changelog and git history are the audit trail)
- Detailed documentation (those belong in `docs/`)

## Phase 0: Assign Plan-Item IDs (or Set Up Issue Tracker)

> **Issue mode (`--issues`):** Skip the entire slug-assignment pass below — the
> issue number *is* the ID, assigned by the tracker on creation. Instead do this:
>
> 1. **Detect the VCS host.** Run `gh auth status --active` to check the GitHub CLI
>    (`--active` scopes the check to the active account, so a stale token on another
>    configured account doesn't falsely fail it). If it
>    fails, run `glab auth status` for GitLab. Set `VCS_HOST` to `github` or
>    `gitlab` and `CLI_TOOL` to `gh` or `glab`. **If neither is authenticated,
>    abort** with: "Issue mode needs an authenticated `gh` or `glab`. Run
>    `gh auth login` (or `glab auth login`), or drop `--issues` to plan against
>    PLAN.md instead." Do not silently fall back to PLAN.md.
> 2. **Ensure the scoping label exists.** `gh label create <PLAN_LABEL> --description "Tracked by /do:replan" 2>/dev/null || true` (glab: `glab label create --name <PLAN_LABEL> --color "#428BCA" 2>/dev/null || true` — glab requires a color). Creating it if absent is harmless; the `|| true` swallows the "already exists" error.
>
> Then proceed to Phase 1. Everything in the rest of Phase 0 is PLAN.md-only.

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

1. Read PLAN.md. (PLAN.md presence is the Phase 0 precondition stated
   above — a missing PLAN.md skips Phase 0 entirely.) Collect every
   `[slug]` into a `takenIds` set **using the strict positional pattern**
   spelled out in [lib/plan-id-format.md](../../lib/plan-id-format.md)
   (section "Strict positional pattern for the Phase 0 collision scan").
   In short: PLAN.md slugs live at the bracketed token directly after
   `- [ ] ` / `- [x] ` (or the indented variant). Do NOT collect any
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
5. Track the count `{I}` of IDs assigned for the Phase 3 / Phase 6 summary.

If no IDs were assigned (every item already had one), this phase is a no-op
and produces no commit on its own — proceed to Phase 1.

**Concurrent-appender arbitration.** Audit commands like `do:better`,
`do:better-swift`, and `do:depfree` independently append `- [ ]` items
with their own slugs. Each command must re-read PLAN.md *immediately
before* writing, so its uniqueness check sees the freshest state. If two such commands race and produce colliding slugs, Phase 0
on the next replan is the safety net: it leaves existing slugs
unchanged (immutability), so the collision is visible to the human via
duplicate `[slug]` tokens and can be hand-resolved. No additional
locking is provided — `/do:replan` is the single point that
re-canonicalises the namespace.

## Phase 1: Automated Evidence Gathering

Launch these agents in parallel — no user interaction needed.

> **Issue mode (`--issues`):** Wherever the agents below say "PLAN.md item," read
> "open `PLAN_LABEL` issue." Source the item list once, up front:
> `gh issue list --label <PLAN_LABEL> --state open --json number,title,body,labels,createdAt,updatedAt`
> (glab: `glab issue list --label <PLAN_LABEL> --output json`). Only **open**
> labeled issues are triaged — GitHub may have already auto-closed issues via
> "Fixes #N" in a merged PR, and those are already pruned. Agents 1–3 and 5
> operate per open issue; **Agent 4 (GOALS.md) is unchanged** (GOALS.md is still a
> file). For Agent 5's drift dating, use each issue's `createdAt` as the
> `<plan-item-date>` (no `git blame` — there's no PLAN.md line); use `updatedAt`
> for the staleness window in Phase 2.
>
> **Migration candidates + open-question detection.** **Always read PLAN.md if one
> exists.** Every open item in it (`- [ ]`, plus any open prose/numbered roadmap
> entries) is a migration candidate that will become a labeled issue in Phase 3 —
> the goal is to move the whole plan into the tracker and leave PLAN.md empty.
> Completed (`- [x]`) and stale items are not migrated; they're simply dropped when
> PLAN.md is emptied. While reading both the migration candidates and the
> opportunity-scanner suggestions (Agent 3), flag every item that carries an **open
> question or undecided choice** the human must resolve before it can be worked.
> Treat these as signals: an `## Open Questions` / `## Decisions` section; a line
> ending in `?`; markers like `TBD`, `TODO: decide`, `decision needed`, `unclear`,
> `needs input`, `should we`, or an unresolved `A vs B` / `either…or`; a
> `> QUESTION:` / `> DECISION:` blockquote. Record each as
> `{item, question, options-if-any}` for the Phase 3 resolution gate. An item with
> no open question is already actionable and skips the gate.

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

**Agent 6: Dependency & Priority Graph (issue mode only)**
Only runs when `ISSUE_MODE=true` (PLAN.md items don't carry issue-number dependencies). For every open issue under consideration:
- Parse the body for `Depends on #<N>` / `Blocked by #<N>` lines (case-insensitive; a line may list several `#<N>`), and read GitHub's native blocked-by relationship where the API exposes it. Record each issue's blocker set.
- Resolve each referenced #N's state (`gh issue view <N> --json state`): mark the issue **blocked** if any blocker is still OPEN, **clearable** if a referenced blocker is now CLOSED (a stale marker to strip), **broken** if a referenced number doesn't exist, and detect **cycles** across the collected edges.
- Note each issue's `priority:<N>` label if present (for the summary only — priority is not triage evidence).

Feed this graph to Phase 2: `blocked` issues are kept (`still-pending`, never `stale`), and `clearable`/`broken`/`cycle` findings drive the dependency-marker hygiene fixes in the Phase 2 issue-mode callout.

## Phase 2: Auto-Triage

> **Issue mode (`--issues`):** Classify every open `PLAN_LABEL` issue using the
> same table — "Remove from PLAN.md" becomes "Close the issue" (Phase 3 maps the
> actions). Staleness is measured from the issue's `updatedAt`.
>
> **Epics are classified by their children, not by code evidence.** An epic
> (umbrella) issue has no single code artifact, so the Agent-2 codebase grep can't
> judge it — judging it that way risks closing it while children are still open, or
> never closing it at all. For any issue that is an epic (carries `epic`/a repo
> umbrella label, has native sub-issues, or task-lists other issues in its body),
> resolve its children and compute its completeness state with the shared epic logic
> (inlined here so it's available in every environment):
>
> !`cat ~/.claude/lib/epic-children.md`
>
> Then map the epic's state onto the triage table: `epic-done` → `confirmed-done`
> (close it); `epic-wrapup` or `epic-open` → `still-pending` (**keep open** — there
> is outstanding work, whether the epic's own wrap-up tasks or unfinished children);
> `epic-empty` → fall back to ordinary classification. **Never** close an
> `epic-open`/`epic-wrapup` epic even if its title reads as done.
>
> **Blocked issues are not stale.** An issue that declares a hard dependency —
> a `Depends on #<N>` / `Blocked by #<N>` line in its body (or GitHub's native
> blocked-by relationship) where #N is still OPEN — is **legitimately waiting**, not
> abandoned. Classify it `still-pending` (**keep open**) regardless of its
> `updatedAt` age; the inactivity is expected. (`/do:next` skips it for the same
> reason — see its Phase 1 step 4.) Do not let the >30-day `stale` rule close work
> that is correctly parked behind an unshipped predecessor.
>
> **Dependency-marker hygiene (close the loop).** While triaging, reconcile each
> issue's declared dependencies against reality and fold fixes into Phase 3:
> - A `Depends on #N` whose **#N is now CLOSED** → the marker is satisfied; **strip
>   that reference** from the body (the issue is no longer blocked, so it should
>   re-enter the claimable walk). If a line listed several, drop only the closed ones.
> - A `Depends on #N` referencing a **non-existent / wrong number** → flag it (in
>   `--interactive`, surface for correction; autonomously, comment so a human fixes it
>   rather than silently deleting a real intent).
> - A **dependency cycle** (A↔B, or longer) → flag it as a planning error; both ends
>   stay blocked until a human breaks it. Note the cycle, don't try to resolve it.
>
> **Priority labels are advisory, never a triage signal.** A `priority:<N>` label
> only orders `/do:next`'s walk; it has no bearing on done/stale/pending
> classification. Don't add, remove, or treat it as evidence here. When replan
> *files* new work that has a clear ordering relationship, it MAY set `Depends on #N`
> (for a hard predecessor) or `priority:<N>` (for soft sequencing) on the new
> issue — keeping every filed issue immediately claimable per the actionable-issues
> invariant.

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

> **Issue mode (`--issues`): resolve open questions FIRST.** Before filing any
> issue, walk the open-question signals collected in Phase 1. For each item that
> carries an unresolved question or decision, ask the human to resolve it — even in
> autonomous (non-`--interactive`) runs, because filing a non-actionable issue
> would violate the actionable-issues invariant:
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
> "Decide now" with free-text and "Defer.") Fold the chosen decision into the issue
> body so the filed issue is self-contained and claimable (e.g. a `## Decision`
> line). If the human **defers**, do not file the issue — keep the item in PLAN.md
> (it is not migrated this run) and list it under "deferred — needs a decision" in
> the summary. Only items with no open question, or whose question was resolved
> here, proceed to creation below.
>
> **Apply the triage decisions** as issue operations instead of PLAN.md edits. The
> mapping (GitHub `gh`; glab equivalents in parens):
>
> - `confirmed-done` / `likely-done` → **close** the issue with an evidence
>   comment: `gh issue close <n> --comment "Closed by /do:replan — <evidence>"`
>   (glab: `glab issue note <n> -m "<evidence>"` then `glab issue close <n>`).
> - **epic mapped to `confirmed-done`** (state `epic-done` — all children closed,
>   no wrap-up tasks left) → **close** with a child-evidence comment that lists the
>   closed children: `gh issue close <n> --comment "All children closed (#a, #b, …) and wrap-up complete — closing epic. (/do:replan)"`.
>   An `epic-wrapup`/`epic-open` epic stays `still-pending` and is never closed here
>   (when `epic-wrapup`, optionally comment that only the epic's own wrap-up remains).
> - `stale` → close with a stale-reason comment (note the last-activity date).
> - new suggestions **and every pending PLAN.md item being migrated** (questions
>   resolved above) → **create** an issue:
>   `gh issue create --title "<title>" --body "<body incl. any ## Decision>" --label <PLAN_LABEL>`
>   (glab: `glab issue create --title "<title>" --description "<body>" --label <PLAN_LABEL>`).
>   Capture the returned issue number for the summary and for clearing the migrated
>   item from PLAN.md in Phase 4.
> - `drifted` → **never auto-close.** Post the `⚠️ DRIFT:` description as a
>   comment (`gh issue comment <n> --body "⚠️ DRIFT: <collision> — conflicting commit <sha>"`)
>   and apply a `drift` label (`gh label create drift 2>/dev/null || true` first, then
>   `gh issue edit <n> --add-label drift`; glab: `glab label create --name drift --color "#E8A33D" 2>/dev/null || true` first, then `glab issue note <n> -m "<drift>"` + `glab issue update <n> --label drift`).
>
> The audit trail is the issue's close event + comment — **not** git log. In issue
> mode there is no PLAN.md edit in this phase; skip steps 1–5 below and use the
> issue operations above, then jump to the issue-mode summary at the end of this
> phase. (`--interactive` still applies — see the Interactive Mode note below.)

### Default Mode (autonomous)

Apply all changes immediately without prompting — **except for `drifted` items, which are never auto-modified**:

1. Remove `confirmed-done` and `likely-done` items from PLAN.md. The commit message should list the removed slugs (e.g. `docs: replan — completed [slug-a], [slug-b]`) so git log + the changelog remain the audit trail.
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

**Issue mode** prints the issue-number variant instead (list the actual numbers
so they're clickable / greppable):

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

Omit the deferred block when `{Q}` is 0. List the migrated-vs-scanner split only
when a PLAN.md was present (migration only happens then).

If `D > 0`, emphasize the drift count visually in the printed summary (e.g. bold + the `⚠️` prefix shown above) so the user notices it. Do **not** actually exit with a non-zero process exit code — `/do:replan` is often chained into other commands and a non-zero exit would break that automation. Do not commit drifted-item resolutions silently.

### Interactive Mode (`--interactive`)

> **Issue mode (`--issues`):** The consolidated prompt is identical, but each
> selected action runs the issue operation from the Phase 3 mapping instead of a
> PLAN.md edit — "Remove …" options close the corresponding issues, "Add suggested
> items" creates them, and the per-drifted walk-through offers **Replan — rewrite
> issue** (edit the issue title/body via `gh issue edit <n>` after approval) /
> **Examine — leave commented** (keep the `drift` label + comment) / **Close the
> issue** (the new feature supersedes it). Reference items by `#<number>` in the
> presented lists.

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

## Phase 4: Rebuild PLAN.md

> **Issue mode (`--issues`):** Don't rebuild PLAN.md into the target structure.
> Instead: (1) print the resulting lean plan as the current open labeled set
> (`gh issue list --label <PLAN_LABEL> --state open`, glab equivalent) so the user
> sees the post-replan backlog; (2) **empty PLAN.md** — remove every item (migrated
> ones became issues; completed/stale ones are dropped), keeping only an item the
> human explicitly deferred. **Do not list issue numbers in PLAN.md** — that would
> reintroduce the churn this mode exists to avoid. Replace the body with a short
> note that the roadmap now lives in the tracker:
>
> ```markdown
> # Development Plan
>
> This project tracks its roadmap as issues — see the open issues labeled
> `{PLAN_LABEL}` on the repository's Issues page. Managed by `/do:replan --issues`.
> ```
>
> (If an item was deferred, list it under a `## Pending a decision` heading below
> the note; everything else is gone.) The PLAN.md edit is staged and committed in
> Phase 6. Then continue to Phase 5.

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

- **"Next Up" is ordered** — numbered list, max 5 items, these are the immediate priorities
- **"Backlog" is unordered** — checkbox items that are planned but not prioritized; each carries its `[plan-id]` slug from Phase 0
- **"Future / Ideas" has no checkboxes** — these are possibilities, not commitments, so they don't need slug IDs
- **No completed items** — the changelog and git log are the audit trail
- **No detailed docs** — link to `docs/` files instead
- **No section if it's empty** — don't include "Backlog" with zero items
- **Preserve existing `[plan-id]` slugs verbatim** when items are moved between sections or rewritten — slugs are immutable once assigned (see [lib/plan-id-format.md](../../lib/plan-id-format.md)). Only Phase 0 generates new slugs.

## Phase 5: Absorb GOALS.md Violations

If tactical items (checkboxes, implementation details) were found in GOALS.md:
- Move them into the appropriate PLAN.md section
- Update GOALS.md to remove tactical content

> **Issue mode (`--issues`):** Same intent, different destination — create an
> issue for each leaked tactical item
> (`gh issue create --title … --body … --label <PLAN_LABEL>`), then strip the
> tactical content from GOALS.md. GOALS.md is still a tracked file, so its edit is
> committed in Phase 6.

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

> **Issue mode (`--issues`):** The issue tracker is the audit trail (close events
> + comments), not a commit. Commit **only** the on-disk changes this run actually
> made: the PLAN.md migration edit from Phase 4 (cleared migrated items / stub) and
> any GOALS.md or `docs/` edits from Phase 5 — e.g.
> `git add PLAN.md GOALS.md 2>/dev/null || true; git commit -m "docs: replan — migrated plan to issues #c, #d; pruned PLAN.md"`.
> If nothing on disk changed (steady-state run: no PLAN.md, no GOALS.md edits),
> there is no commit; the closed/created issue numbers from the Phase 3 summary are
> the record. Do NOT push unless explicitly asked.

Do NOT push unless explicitly asked.

## Notes

- If no PLAN.md exists, inform the user and offer to create one from codebase analysis
- The opportunity scanner suggestion is the key differentiator — every replan should surface at least one new idea
- Keep PLAN.md under ~50 lines whenever possible — it should be scannable in seconds
- Adapt to existing project structure and conventions
- **Never silently resolve a `drifted` item.** Autonomous mode annotates and surfaces; only the human decides between replan / examine / delete (or, in issue mode, replan / examine / close).
- **Issue mode (`--issues`), migration:** issue mode always reads PLAN.md if one
  exists. When it has content, every open item is migrated into the tracker as a
  labeled issue (after its open questions are resolved), and PLAN.md is emptied to a
  short note that the roadmap now lives on the Issues page — it never records issue
  numbers, so it stops generating merge conflicts as work proceeds. If there's no
  PLAN.md (or it's already empty), seed the backlog from the opportunity scanner.
  Either way, every replan should surface at least one new idea.
- **Issue mode — actionable-issues invariant:** never file an issue that still
  contains an open question or undecided choice. Resolve it with the human first
  (Phase 3 gate) and fold the decision into the issue body, or defer the item and
  leave it in PLAN.md. The tracker holds only claimable tasks.
- **Issue mode** still changes only `/do:replan`. Items created by other slashdo
  commands land in PLAN.md, not the tracker; reconciling the two is out of scope
  for this flag.
