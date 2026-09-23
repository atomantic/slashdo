# Issue Mode — the shared `/do:replan --issues` contract

`replan.md` reads this file **once**, gated on `ISSUE_MODE=true`, before Phase 0
begins. It is the only place that documents `/do:replan`'s issue-mode behavior;
every "Issue mode:" pointer in `replan.md`'s phases means "see the matching
heading below" instead of restating the mechanics inline.

## Actionable-issues invariant

Every issue replan files must be **well-formed and decision-complete**. Before
migrating an item, replan surfaces any open question or pending decision on it
(Phase 3) and asks the human to resolve it, folding the resolution into the issue
body. If the human explicitly **defers**, that item stays in PLAN.md (reported in
the summary) — the only thing that may remain there.

**A `Depends on #N` does NOT violate this invariant.** "Actionable" means "no
unresolved question/decision," not "pickable this very second." A
blocked-but-well-formed issue is merely *sequenced* (`/do:next` claims it once #N
closes); only an *undecided* item is barred.

## Phase 0 — VCS host + label setup

1. **Detect the VCS host.** Read the single selection rule now — it sets
   `VCS_HOST` (`github`/`gitlab`) and `CLI_TOOL` (`gh`/`glab`) from the `origin`
   remote, then confirms that host's credentials (probing `gh auth status` first
   would pick GitHub on any machine logged in to both services), and halts the
   run when the selected CLI cannot reach this repo:

   !read lib/vcs-host.md

   **Surface its abort message**, plus one line: "Or drop `--issues` to plan
   against PLAN.md instead." Never fall back to PLAN.md or to the other CLI.
2. **Ensure the scoping label exists.** `gh label create <PLAN_LABEL> --description "Tracked by /do:replan" 2>/dev/null || true` (glab: `glab label create --name <PLAN_LABEL> --color "#428BCA" 2>/dev/null || true` — glab requires a color).

Then proceed to Phase 1.

## Phase 1 — Evidence gathering (issues + migration + dependency graph)

Wherever `replan.md`'s Agents 1–5 say "PLAN.md item," read "open `PLAN_LABEL`
issue." Source the item list once, up front:
`gh issue list --label <PLAN_LABEL> --state open --limit 1000 --json number,title,body,labels,createdAt,updatedAt`
(glab: `glab issue list --label <PLAN_LABEL> --output json --per-page 100` —
GitLab's `--per-page` maxes out at 100 with no "give me everything" pagination for
a plain issue list; `--issues-label` keeps a busy GitLab tracker under it). Only
**open** labeled issues are triaged. Agents 1–3 and 5 operate per open issue;
**Agent 4 (GOALS.md) is unchanged**. For Agent 5's drift dating, use each issue's
`createdAt` as the `<plan-item-date>` (no `git blame`); use `updatedAt` for the
Phase 2 staleness window.

**Migration candidates + open-question detection.** **Always read PLAN.md if one
exists.** Every open item in it (`- [ ]`, plus open prose/numbered roadmap entries)
is a migration candidate for Phase 3; completed (`- [x]`) and stale items are
dropped when PLAN.md is emptied. If there's no PLAN.md (or it's already the
tracker-pointer stub), there's simply nothing to migrate — seed the backlog
straight from the opportunity scanner (Agent 3) instead. Across the migration
candidates and Agent 3's suggestions, flag every item carrying an **open question
or undecided choice**. Signals: an `## Open Questions` / `## Decisions` section; a
line ending in `?`; markers like `TBD`, `TODO: decide`, `decision needed`,
`unclear`, `needs input`, `should we`, or an unresolved `A vs B` / `either…or`; a
`> QUESTION:` / `> DECISION:` blockquote. Record each as
`{item, question, options-if-any}` for the Phase 3 resolution gate.

### Agent 6: Dependency & Priority Graph (issue mode only)

Only runs when `ISSUE_MODE=true`. For every open issue under consideration:
- Parse the body for `Depends on #<N>` / `Blocked by #<N>` lines (case-insensitive; a line may list several `#<N>`) — the portable, cross-host convention. Also read GitHub's **native** blocked-by relationship where the API exposes it (GitHub-only; on GitLab the body lines are the only source). Record each issue's blocker set.
- Resolve each referenced #N's state with the **detected `CLI_TOOL`** (`gh issue view <N> --json state -q .state`; glab: `glab issue view <N> --output json` then read `.state`), and **normalize the value** before comparing: GitHub reports `OPEN`/`CLOSED`, GitLab `opened`/`closed`. Mark the issue **blocked** if any blocker is still open, **clearable** if a referenced blocker is now closed (a stale marker to strip), **broken** if a referenced number doesn't exist, and detect **cycles** across the collected edges.
- Note each issue's `priority:<N>` label if present (summary only — not triage evidence).

Feed this graph to Phase 2: `blocked` and `clearable` issues are both kept `still-pending` (never `stale` — a parked issue's old `updatedAt` is expected, and the run that unblocks it must not close it); `clearable`/`broken`/`cycle` findings drive the dependency-marker hygiene fixes in the Phase 2 section.

## Phase 2 — Auto-triage (issues)

Classify every open `PLAN_LABEL` issue with `replan.md`'s Phase 2 table —
"Remove from PLAN.md" becomes "Close the issue" (Phase 3 maps the actions).
Staleness is measured from the issue's `updatedAt`.

**Epics are classified by their children, not by code evidence.** For any issue
that is an epic (carries `epic`/a repo umbrella label, has native sub-issues, or
task-lists other issues in its body), resolve its children and compute its
completeness state with the shared epic logic.

**GitHub only — derive `GH_HOST` first with the shared snippet below** (skip it entirely
on GitLab, whose `glab` calls resolve the host from the remote themselves and where the
snippet's `gh auth` precheck would abort the run). That logic's `gh api` calls ignore the
repo remote and default to github.com, so pass `--hostname "$GH_HOST"` on every one:

!`cat ~/.claude/lib/gh-host.md`

!`cat ~/.claude/lib/epic-children.md`

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
[plan-issue-setup.md](./plan-issue-setup.md) "The dispatch hint") on
**new** work it investigated well enough to justify, but must **not** stamp hints
onto migrated PLAN.md items or existing issues in bulk. A `Depends on #N` issue is
**deferred, not un-actionable** — see the invariant above.

## Phase 3 — Apply changes (issue mode)

**Resolve open questions FIRST.** For each item from Phase 1 carrying an
unresolved question or decision, ask the human to resolve it — even in autonomous
(non-`--interactive`) runs:

```
AskUserQuestion([{
  question: "Before I file this as an issue, it needs a decision:\n\n> {item text}\n\n**Open question:** {question}",
  multiSelect: false,
  options: [
    { label: "{option A}", description: "File the issue scoped to option A" },
    { label: "{option B}", description: "File the issue scoped to option B" },
    { label: "Defer — don't file yet", description: "Leave this item in PLAN.md until the decision is made" }
  ]
}])
```

(When the item names explicit choices, surface them as options; otherwise offer
"Decide now" with free-text and "Defer.") Fold the decision into the issue body
(e.g. a `## Decision` line). If the human **defers**, do not file — keep the item
in PLAN.md and list it under "deferred — needs a decision" in the summary.

**Dedup before every create.** Fetch the open issues once
([plan-issue-filing.md](./plan-issue-filing.md) "Fetch existing open issues" —
`gh issue list --state open --limit 1000 --json number,title,labels,body`, glab:
`glab issue list --state opened --per-page 100 -F json`) as `EXISTING_ISSUES`.
Before filing a migration candidate or a new suggestion, check whether an open
issue already covers it — match on the same file path/symbol or a clearly
equivalent title, not just an exact string. On a match, **skip creation** and
reuse that issue's `#<number>` (optionally comment if the new item adds detail).
Only file when nothing existing covers it.

**Apply the triage decisions** as issue operations (GitHub `gh`; glab in parens):

- `confirmed-done` / `likely-done` → **close** with an evidence comment:
  `gh issue close <n> --comment "Closed by /do:replan — <evidence>"`
  (glab: `glab issue note <n> -m "<evidence>"` then `glab issue close <n>`).
- **epic mapped to `confirmed-done`** (state `epic-done`) → **close** listing the
  closed children: `gh issue close <n> --comment "All children closed (#a, #b, …) and wrap-up complete — closing epic. (/do:replan)"`.
  An `epic-wrapup`/`epic-open` epic is never closed here (when `epic-wrapup`,
  optionally comment that only the epic's own wrap-up remains).
- `stale` → close with a stale-reason comment (note the last-activity date).
- new suggestions **and every pending PLAN.md item being migrated** → dedup against
  `EXISTING_ISSUES` (above), then **create**:
  `gh issue create --title "<title>" --body "<body incl. any ## Decision>" --label <PLAN_LABEL>`
  (glab: `glab issue create --title "<title>" --description "<body>" --label <PLAN_LABEL>`).
  Capture the returned issue number (created or reused) for the summary and for
  Phase 4.
- `drifted` → **never auto-close.** Post the `⚠️ DRIFT:` description as a
  comment (`gh issue comment <n> --body "⚠️ DRIFT: <collision> — conflicting commit <sha>"`)
  and apply a `drift` label (`gh label create drift 2>/dev/null || true` first, then
  `gh issue edit <n> --add-label drift`; glab: `glab label create --name drift --color "#E8A33D" 2>/dev/null || true` first, then `glab issue note <n> -m "<drift>"` + `glab issue update <n> --label drift`).

The audit trail is the issue's close event + comment — **not** git log. Skip
`replan.md`'s Phase 3 "Default Mode" steps 1–5 and print the issue-mode summary
below instead. (`--interactive` still applies — see below.)

### Default mode summary

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

### Interactive mode (`--interactive`)

Same consolidated-summary prompt `replan.md`'s Phase 3 describes, but each
selected action runs the Phase 3 issue operation above — "Remove …" closes, "Add
suggested items" creates — and the per-drifted walk-through offers **Replan —
rewrite issue** (`gh issue edit <n>` after approval) / **Examine — leave
commented** (keep the `drift` label + comment) / **Close the issue** (the new
feature supersedes it). Reference items by `#<number>`.

## Phase 4 — Backlog print + PLAN.md stub

Don't rebuild PLAN.md. Instead:

1. **Print the open labeled set** as the post-replan backlog:
   `gh issue list --label <PLAN_LABEL> --state open --limit 1000`
   (glab: `glab issue list --label <PLAN_LABEL> --per-page 100`).
2. **Empty PLAN.md** — remove every item, keeping only one the human explicitly
   deferred. **Do not list issue numbers in PLAN.md.** Replace the body with:

   ```markdown
   # Development Plan

   This project tracks its roadmap as issues — see the open issues labeled
   `{PLAN_LABEL}` on the repository's Issues page. Managed by `/do:replan --issues`.
   ```

   (If an item was deferred, list it under a `## Pending a decision` heading below
   the note.) `/do:next` detects this stub by its sentinel phrases — keep the two
   quoted phrases above byte-for-byte.

The PLAN.md edit is committed in Phase 6. Then continue to Phase 5.

## Phase 5 — GOALS.md leaks → issues

Same intent as PLAN.md mode, different destination — create an issue for each
leaked tactical item (`gh issue create --title … --body … --label <PLAN_LABEL>`),
then strip the tactical content from GOALS.md; its edit is committed in Phase 6.

## Phase 6 — Commit (issue mode)

The tracker is the audit trail, not a commit. Commit **only** on-disk changes this
run made (the Phase 4 PLAN.md edit, Phase 5 GOALS.md or `docs/` edits) — e.g.
`git add PLAN.md GOALS.md 2>/dev/null || true; git commit -m "docs: replan — migrated plan to issues #c, #d; pruned PLAN.md"`.
If nothing on disk changed, there is no commit. Do NOT push unless explicitly asked.
