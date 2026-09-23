---
description: Automated audit/triage of your GitHub/GitLab issue tracker — close completed issues, suggest new work, keep the backlog lean (migrates a legacy PLAN.md once)
argument-hint: "[--interactive] [--issues-label <name>]"
---

# Replan Command

Audit the backlog against the codebase, close completed/stale issues, suggest new work, and leave the backlog lean. The backlog lives in your **GitHub/GitLab issue tracker** — only issues carrying `PLAN_LABEL` are plan items.

**Default mode: fully autonomous** — scan, close, file, no prompts. **`--interactive`** pauses after evidence gathering for approval.

**Philosophy:** the backlog should be short enough to scan in one screen. Completed work doesn't belong in it — closed issues are the audit trail.

**Phase ordering:** phases 0 → 6.

## Parse Arguments

Parse `$ARGUMENTS` for:
- **`--interactive`**: pause after evidence gathering for approval. Record `INTERACTIVE=true` (default `false`).
- **`--issues-label <name>`**: the label that scopes which issues are plan items. Record `PLAN_LABEL` (default `plan`); when the flag is absent, take it from the saved `issues-label` default — per-project `.slashdo.json` overrides the global `~/.claude/.slashdo-config.json`, key by key. A saved `issues` key is ignored.
- **`--issues`**: deprecated no-op. Print once: `--issues is now the default (PLAN.md mode was removed); the flag can be dropped.` and continue.
- **`--no-issues`**: abort with `--no-issues is no longer supported: PLAN.md mode was removed. slashdo records work only in the project's issue tracker.`

**Actionable-issues invariant.** Every issue replan files must be **well-formed and decision-complete**. Before filing an item, replan surfaces any open question or pending decision on it (Phase 3) and asks the human to resolve it, folding the resolution into the issue body. If the human explicitly **defers**, the item is not filed (reported in the summary).

**A `Depends on #N` does NOT violate this invariant.** "Actionable" means "no unresolved question/decision," not "pickable this very second." A blocked-but-well-formed issue is merely *sequenced* (`/do:next` claims it once #N closes); only an *undecided* item is barred.

**Item IDs.** The **issue number** is the ID; `/do:next` claims it on a `next/issue-<n>` branch.

## Boundary Rule: Issue Tracker vs GOALS.md

**The tracker is tactical** (what are we building next, the backlog). **GOALS.md is strategic** (why the project exists, what success looks like, what we will never do).

**Plan issues must NOT contain:**
- Mission statements, core tenets, or non-goals (GOALS.md)
- Detailed documentation (`docs/`)

## Phase 0: Set Up the Issue Tracker

1. **Detect the VCS host.** Read the single selection rule now — it sets
   `VCS_HOST` (`github`/`gitlab`) and `CLI_TOOL` (`gh`/`glab`) from the `origin`
   remote, then confirms that host's credentials (probing `gh auth status` first
   would pick GitHub on any machine logged in to both services), and halts the
   run when the selected CLI cannot reach this repo:

!read lib/vcs-host.md

   **Surface its abort message.** Never fall back to the other CLI.
2. **Ensure the scoping label exists.** `gh label create <PLAN_LABEL> --description "Tracked by /do:replan" 2>/dev/null || true` (glab: `glab label create --name <PLAN_LABEL> --color "#428BCA" 2>/dev/null || true` — glab requires a color).
3. **Legacy PLAN.md.** If a `PLAN.md` exists, this run migrates it once (Phases 1, 3, 4): its open items become issues and the plan content is removed.

## Phase 1: Automated Evidence Gathering

Source the item list once, up front:
`gh issue list --label <PLAN_LABEL> --state open --limit 1000 --json number,title,body,labels,createdAt,updatedAt`
(glab: `glab issue list --label <PLAN_LABEL> --output json --per-page 100` —
GitLab's `--per-page` maxes out at 100 with no "give me everything" pagination for
a plain issue list; `--issues-label` keeps a busy GitLab tracker under it). Only
**open** labeled issues are triaged. For Agent 5's drift dating, use each issue's `createdAt` as the
`<item-date>`; use `updatedAt` for the Phase 2 staleness window.

**Migration candidates + open-question detection.** If a legacy `PLAN.md` exists,
every open item in it (`- [ ]`, plus open prose/numbered roadmap entries) is a
migration candidate for Phase 3; completed (`- [x]`) items are dropped. Strip any
legacy `[<slug>]` ID from a migrated item's text — the issue title is the plain task,
and the new issue number replaces the slug as its ID. Across the
migration candidates and Agent 3's suggestions, flag every item carrying an **open
question or undecided choice**. Signals: an `## Open Questions` / `## Decisions`
section; a line ending in `?`; markers like `TBD`, `TODO: decide`, `decision needed`,
`unclear`, `needs input`, `should we`, or an unresolved `A vs B` / `either…or`; a
`> QUESTION:` / `> DECISION:` blockquote. Record each as `{item, question, options-if-any}`
for the Phase 3 resolution gate.

Launch these agents in parallel. Agents 1–3 and 5 operate per open issue (and per migration candidate).

**Agent 1: Git History Analysis**
- `git log --oneline -50` — identify commits that completed plan items
- `git log --since="2 weeks ago" --oneline` — surface recent work not yet reflected in the backlog
- Cross-reference commit messages (`#<n>`, `Closes #<n>`, titles) against open issues to auto-detect completions

**Agent 2: Codebase Verification**
- For each open issue, grep for function names, component names, or feature keywords
- Check test files for coverage of features listed as untested
- Look at recently modified files for signs of completed work
- Build a confidence score per item: `confirmed-done`, `likely-done`, `still-pending`, `stale`

**Agent 3: Opportunity Scanner**
- Scan for TODOs, FIXMEs, HACKs in the codebase that aren't tracked as issues
- Look for test coverage gaps (files with no corresponding test)
- Check for outdated dependencies (`npm outdated`, `cargo outdated`, etc. as appropriate)
- Review GOALS.md (if it exists) for strategic goals not yet represented in the backlog
- Identify code quality opportunities (large files, complex functions, missing error handling)
- Formulate 1-3 suggested new items

**Agent 4: GOALS.md Boundary Check**
If `GOALS.md` exists:
- Check for checkbox task lists or implementation details that leaked in
- Note any items that should be filed as issues

**Agent 5: Drift Detection**
For every open issue, determine whether executing it as worded would *remove or regress a feature added since it was written*. `likely-done` candidates are included because the Phase 2 rule "Drift takes precedence over done-ness" needs drift signal on them.

For each item, look at:
- Files/modules/functions the item would touch (infer from item text)
- Git history of those paths since the issue was created: `git log --since=<item-date> -- <path>` on each touched path
- New exports, public APIs, tests, or call sites added to those paths
- Whether the item's goal (remove / replace / simplify / consolidate) would delete code that new code now depends on

Classify each item as:
- `drift-safe` — no conflict; executing the item as written is still correct
- `drift-conflict` — executing as written would remove a new feature or break new call sites
- `drift-unclear` — touches recently-changed code but impact is ambiguous

For every `drift-conflict` / `drift-unclear`, record: the item, the conflicting feature/commit(s), and a one-line description of the collision.

**Agent 6: Dependency & Priority Graph**
For every open issue under consideration:
- Parse the body for `Depends on #<N>` / `Blocked by #<N>` lines (case-insensitive; a line may list several `#<N>`) — the portable, cross-host convention. Also read GitHub's **native** blocked-by relationship where the API exposes it (GitHub-only; on GitLab the body lines are the only source). Record each issue's blocker set.
- Resolve each referenced #N's state with the **detected `CLI_TOOL`** (`gh issue view <N> --json state -q .state`; glab: `glab issue view <N> --output json` then read `.state`), and **normalize the value** before comparing: GitHub reports `OPEN`/`CLOSED`, GitLab `opened`/`closed`. Mark the issue **blocked** if any blocker is still open, **clearable** if a referenced blocker is now closed (a stale marker to strip), **broken** if a referenced number doesn't exist, and detect **cycles** across the collected edges.
- Note each issue's `priority:<N>` label if present (summary only — not triage evidence).

Feed this graph to Phase 2: `blocked` and `clearable` issues are both kept `still-pending` (never `stale` — a parked issue's old `updatedAt` is expected, and the run that unblocks it must not close it); `clearable`/`broken`/`cycle` findings drive the dependency-marker hygiene fixes in the Phase 2 callout.

## Phase 2: Auto-Triage

Using agent results, classify every open `PLAN_LABEL` issue. Staleness is measured from the issue's `updatedAt`.

| Status | Criteria | Action |
|--------|----------|--------|
| `confirmed-done` | Git commit + code exists + tests pass | Close the issue |
| `likely-done` | Strong evidence but not 100% certain | Close the issue |
| `stale` | No commits, no code, no recent discussion; item is >30 days old with zero progress | Close the issue |
| `drifted` | Agent 5 flagged `drift-conflict` or `drift-unclear` | **Never auto-close** — surface to human (replan / examine / close) |
| `still-pending` | No evidence of completion and no drift | Keep open |

**Drift takes precedence over done-ness.** If an item is both `likely-done` and `drifted`, treat it as `drifted` and surface it — the human needs to confirm what "done" actually means now.

**Epics are classified by their children, not by code evidence.** For any issue
that is an epic (carries `epic`/a repo umbrella label, has native sub-issues, or
task-lists other issues in its body), resolve its children and compute its
completeness state with the shared epic logic.

**GitHub only — derive `GH_HOST` first with the shared snippet below** (skip it entirely
on GitLab, whose `glab` calls resolve the host from the remote themselves and where the
snippet's `gh auth` precheck would abort the run). That logic's `gh api` calls ignore the
repo remote and default to github.com, so pass `--hostname "$GH_HOST"` on every one:

!read lib/gh-host.md

When at least one open issue is an epic, apply the shared epic logic:

!read lib/epic-children.md

Map the epic's state onto the triage table: `epic-done` → `confirmed-done` (close
it); `epic-wrapup` or `epic-open` → `still-pending` (**keep open**); `epic-empty` →
ordinary classification. **Never** close an `epic-open`/`epic-wrapup` epic even if
its title reads as done.

**Blocked issues are not stale.** An issue with a `Depends on #<N>` / `Blocked by
#<N>` line (or GitHub's native blocked-by relationship) where #N is still OPEN is
`still-pending` (**keep open**) regardless of `updatedAt` age. (`/do:next` skips it
for the same reason — see its Phase 1 step 4.)

**Dependency-marker hygiene.** Reconcile declared dependencies against reality and
fold fixes into Phase 3:
- A `Depends on #N` **or `Blocked by #N`** reference whose **#N is now CLOSED** →
  **strip that reference** from the body (if a line listed several, drop only the
  closed ones). **Classify this just-unblocked issue `still-pending` for this run —
  exempt from the >30-day `stale` rule even though its `updatedAt` is old.**
- A `Depends on #N` referencing a **non-existent / wrong number** → flag it (in
  `--interactive`, surface for correction; autonomously, comment so a human fixes it
  rather than silently deleting a real intent).
- A **dependency cycle** (A↔B, or longer) → flag it as a planning error; both ends
  stay blocked until a human breaks it.

**Priority labels and dispatch hints (`priority:<N>`, `model:`, `effort:`) are
advisory, never a triage signal.** They only steer `/do:next`; don't add, remove, or
read them as evidence here. Replan MAY set `Depends on #N` (hard predecessor),
`priority:<N>` (soft sequencing), or a dispatch hint (per
[lib/plan-issue-setup.md](../../lib/plan-issue-setup.md) "The dispatch hint") on
**new** work it investigated well enough to justify, but must **not** stamp hints
onto migrated PLAN.md items or existing issues in bulk. A `Depends on #N` issue is
**deferred, not un-actionable** — see the invariant note above.

## Phase 3: Apply Changes (or Checkpoint if Interactive)

**Resolve open questions FIRST.** For each item from Phase 1 carrying an unresolved
question or decision, ask the human to resolve it — even in autonomous
(non-`--interactive`) runs:

```
AskUserQuestion([{
  question: "Before I file this as an issue, it needs a decision:\n\n> {item text}\n\n**Open question:** {question}",
  multiSelect: false,
  options: [
    { label: "{option A}", description: "File the issue scoped to option A" },
    { label: "{option B}", description: "File the issue scoped to option B" },
    { label: "Defer — don't file yet", description: "Don't file this item until the decision is made" }
  ]
}])
```

(When the item names explicit choices, surface them as options; otherwise offer
"Decide now" with free-text and "Defer.") Fold the decision into the issue body
(e.g. a `## Decision` line). If the human **defers**, do not file a new suggestion — list it under
"deferred — needs a decision" in the summary. A deferred **migrated PLAN.md item**
is still filed (so it isn't lost when PLAN.md is removed), with the open question
under a `## Open question` heading in its body and a `needs-decision` label
(create that label first, as for `drift` below).

**Dedup before every create.** Fetch the open issues once
([lib/plan-issue-filing.md](../../lib/plan-issue-filing.md) "Fetch existing open issues" —
`gh issue list --state open --limit 1000 --json number,title,labels,body`, glab:
`glab issue list --state opened --per-page 100 -F json`) as `EXISTING_ISSUES`.
Before filing a migration candidate or a new suggestion, check whether an open
issue already covers it — match on the same file path/symbol or a clearly
equivalent title, not just an exact string. On a match, **skip creation** and
reuse that issue's `#<number>` (optionally comment if the new item adds detail).
`EXISTING_ISSUES` is **every** open issue, not just `PLAN_LABEL`-scoped ones, so
a reused match may not carry `PLAN_LABEL` yet — **add it**
(`gh issue edit <n> --add-label <PLAN_LABEL>`; glab:
`glab issue update <n> --label <PLAN_LABEL>`) so Phase 4's backlog print and
future replan runs actually see it; skip the add if it already carries the
label. Only file when nothing existing covers it.

### Default Mode (autonomous)

Apply the triage decisions as issue operations (GitHub `gh`; glab in parens) —
**except for `drifted` items, which are never auto-closed**:

- `confirmed-done` / `likely-done` → **close** with an evidence comment:
  `gh issue close <n> --comment "Closed by /do:replan — <evidence>"`
  (glab: `glab issue note <n> -m "<evidence>"` then `glab issue close <n>`).
- **epic mapped to `confirmed-done`** (state `epic-done`) → **close** listing the
  closed children: `gh issue close <n> --comment "All children closed (#a, #b, …) and wrap-up complete — closing epic. (/do:replan)"`.
  An `epic-wrapup`/`epic-open` epic is never closed here (when `epic-wrapup`,
  optionally comment that only the epic's own wrap-up remains).
- `stale` → close with a stale-reason comment (note the last-activity date).
- new suggestions **and every pending PLAN.md item being migrated** → dedup against
  `EXISTING_ISSUES` (below), then **create**:
  `gh issue create --title "<title>" --body "<body incl. any ## Decision>" --label <PLAN_LABEL>`
  (glab: `glab issue create --title "<title>" --description "<body>" --label <PLAN_LABEL>`).
  Capture the returned issue number (created or reused) for the summary.
- `drifted` → **never auto-close.** Post the `⚠️ DRIFT:` description as a
  comment (`gh issue comment <n> --body "⚠️ DRIFT: <collision> — conflicting commit <sha>"`)
  and apply a `drift` label (`gh label create drift 2>/dev/null || true` first, then
  `gh issue edit <n> --add-label drift`; glab: `glab label create --name drift --color "#E8A33D" 2>/dev/null || true` first, then `glab issue note <n> -m "<drift>"` + `glab issue update <n> --label drift`).

The audit trail is the issue's close event + comment — **not** git log. Then print a
brief summary (list the actual numbers):

```
Replan complete (label: {PLAN_LABEL}):
- Closed {N} completed issue(s): #a, #b, …
- Closed {S} stale issue(s): #c, …
- Created {P} new issue(s): #d, …  ({Mg} migrated from PLAN.md, {Op} from the opportunity scan)
- {any GOALS.md boundary fixes}

⚠️ {D} drifted issue(s) require human review — commented + labeled `drift`: #e, …
   Re-run with --interactive to resolve (replan / examine / close).

⏸️ {Q} item(s) deferred — need a decision before they can be filed:
   {one line each}
```

Omit the deferred block when `{Q}` is 0. List the migrated-vs-scanner split only when a PLAN.md was migrated, and add the migration mapping (`PLAN.md item → #n`, noting reused duplicates).

If `D > 0`, emphasize the drift count visually (bold + the `⚠️` prefix). Do **not** exit non-zero — `/do:replan` is often chained into other commands. Do not resolve drifted items silently.

### Interactive Mode (`--interactive`)

Present ONE consolidated summary to the user (reference items by `#<number>`); each selected action runs the matching Default Mode issue operation:

```
AskUserQuestion([{
  question: "Replan audit complete. Here's what I found:\n\n**Confirmed done — close** ({N} issues):\n{list of confirmed-done issues}\n\n**Likely done — close?** ({M} issues):\n{list with evidence}\n\n**Flagged as stale** ({S} issues):\n{list with last-activity dates}\n\n**⚠️ Drifted — would remove new features** ({D} issues):\n{list with collision details}\n\n**New suggestions** ({P} items):\n{numbered list of proposed new items with rationale}\n\nHow should I proceed?",
  multiSelect: true,
  options: [
    { label: "Close confirmed-done", description: "Close {N} confirmed issues with an evidence comment" },
    { label: "Close likely-done too", description: "Also close {M} likely-done issues" },
    { label: "Close stale issues", description: "Close {S} stale issues with a stale-reason comment" },
    { label: "Add suggested items", description: "File {P} new issues" },
    { label: "Resolve drifted items", description: "Walk through {D} drifted issues one-by-one" }
  ]
}])
```

**Exclusive option** (present only if the user asks, as a separate follow-up):
- "Show me the details" — print full evidence, then re-ask the above

Filing migrated PLAN.md items and Phase 4 run regardless of the selections above, still gated by the open-question resolution.

For suggested new items: if the user selects "Add suggested items", present each suggestion individually so they can accept, reject, or modify each one.

**For drifted items: never bundle.** If the user selects "Resolve drifted items", walk through each one individually with this prompt:

```
AskUserQuestion([{
  question: "**Drift detected** on issue #{n}:\n\n> {issue title}\n\n**Collision:** {one-line description}\n**Conflicting commit(s):** {SHAs + subjects}\n**New feature(s) at risk:** {names / paths}\n\nHow do you want to handle this?",
  multiSelect: false,
  options: [
    { label: "Replan — rewrite issue", description: "I'll propose a revised version that preserves the new feature; you approve before it lands" },
    { label: "Examine — leave commented", description: "Keep the issue with the ⚠️ DRIFT comment and `drift` label so you can investigate offline" },
    { label: "Close the issue", description: "The new feature supersedes this item" }
  ]
}])
```

If "Replan — rewrite issue": draft a revised issue body that explicitly accounts for the new feature, then ask the user to accept / edit / reject the rewrite before running `gh issue edit <n>` (glab: `glab issue update <n>`). Never auto-apply a rewrite.

## Phase 4: Retire the Legacy PLAN.md

Skip this phase when no `PLAN.md` exists. Otherwise, once every open item has been
filed (or matched to an existing issue) in Phase 3:

- **Delete `PLAN.md`** if nothing remains but plan items and boilerplate (title,
  headings, links to GOALS.md/PRD.md, notes about how the plan is managed).
- **Otherwise remove only the plan sections** (checkbox lists, `Next Up` / `Backlog` /
  `Future` roadmap entries) and leave the rest — the user may keep other notes there.

Then print the open labeled set (`gh issue list --label <PLAN_LABEL> --state open --limit 1000`,
glab: `glab issue list --label <PLAN_LABEL> --per-page 100`) as the post-replan backlog.

## Phase 5: Absorb GOALS.md Violations

If tactical items (checkboxes, implementation details) were found in GOALS.md, file
an issue for each (`gh issue create --title … --body … --label <PLAN_LABEL>`, deduped
as in Phase 3), then strip the tactical content from GOALS.md.

## Phase 6: Commit

The tracker is the audit trail, not a commit. Commit **only** on-disk changes this
run made (the Phase 4 PLAN.md removal, Phase 5 GOALS.md or `docs/` edits) — e.g.
`for p in PLAN.md GOALS.md docs; do git add -A -- "$p" 2>/dev/null; done; git commit -m "docs: replan — migrated PLAN.md to issues #c, #d"`.
If nothing on disk changed, there is no commit. Do NOT push unless explicitly asked.

## Notes

- If there are no open `PLAN_LABEL` issues (and no PLAN.md to migrate), seed the backlog from the opportunity scanner.
- The opportunity scanner suggestion is the key differentiator — every replan should surface at least one new idea
- Adapt to existing project structure and conventions
- **Never silently resolve a `drifted` item.** Only the human decides between replan / examine / close.
