---
description: Claim the next unclaimed PLAN.md item (or GitHub/GitLab issue with --issues) by its ID, do the work in an isolated worktree, ship a PR, and clean up.
argument-hint: "[<slug>|#<issue>] [--issues] [--issues-label <name>] [--plan] [--review-with <agent>[,…]] [--review-iterations <n>] [--review-stop-on-findings|--review-stop-on-clean] [--reviewer-applies] [--no-review]"
---

# Next — Pick the next plan item (or issue) and ship it

Claim the next unclaimed `- [ ]` item from **PLAN.md** via the slug-ID system — or, with `--issues`, the next open tracker issue filed by the repo creator — work it in an **isolated worktree**, run review, open a PR, merge, and clean up. This is the **consumer** counterpart to `/do:replan`, `/do:better`, and `/do:depfree` (which *populate* the queue): `/do:next` *drains* it, one item per run.

**Two work sources.** The work queue comes from one of two places, selected by `--issues`:

| Source | Selected by | Work unit | Branch | "Done" action | Discovered work goes to |
|---|---|---|---|---|---|
| **PLAN.md** (default) | no flag | a `- [ ]` line with a `[<slug>]` ID | `next/<slug>` | remove the line + log to the changelog | a new PLAN.md item (only if genuinely large) |
| **Tracker issues** | `--issues` | an open issue **filed by the repo creator** | `next/issue-<num>` | close the issue via `Closes #<num>` in the PR | a new tracker issue (only if genuinely large) — never PLAN.md |

The two sources never mix in one run. In issues mode, treat `issue-<num>` as the "slug" everywhere the PLAN.md flow says `<slug>` — worktree (`../next-issue-<num>`), branch (`next/issue-<num>`), commit/PR-title prefix (`[issue-<num>]`), and in-flight scan all work unchanged because `issue-<num>` is a single `/`-segment in the branch name just like a PLAN slug.

**How the claim works.** Every PLAN.md checkbox carries a `[<slug>]` ID (see [lib/plan-id-format.md](../../lib/plan-id-format.md)). A slug is **"in flight"** when it appears as a `/`-separated segment in any local or remote branch (`git branch -a`) or any open PR head ref. `/do:next` picks the first `- [ ]` whose slug is NOT in flight and creates a `next/<slug>` branch — that branch name *is* the claim, visible to every other agent and human running this command. Issues mode adds a second, cross-machine marker (assignee) described in Phase 2.

## Parse Arguments

Split `$ARGUMENTS` on whitespace — tokens starting with `--` are flags, the first remaining non-flag token is the target slug/issue. Value flags accept either `--flag=value` or `--flag value` (consume the next token as the value, don't mistake it for the slug). Order is free.

- **`<slug>` / `#<issue>`** — claim THAT specific item instead of auto-picking (cherry-pick out of order). PLAN.md mode: a slug that must already exist as a `- [ ]` line (this command never *assigns* IDs — that's `/do:replan`'s job). Issues mode: an issue number, bare (`123`) or `#`-prefixed (`#123`, strip the `#`); must be open and creator-authored.
- **`--issues`** — switch the source from PLAN.md to the **tracker**. Set `ISSUE_MODE=true`. Setup (host detection, label, abort-if-unauthenticated) follows [lib/plan-issue-mode.md](../../lib/plan-issue-mode.md). In this mode PLAN.md is never read or edited.
- **`--issues-label <name>`** — label scoping tracked issues. `PLAN_LABEL` (default `plan`). Only meaningful with `--issues`.
- **`--plan`** — before writing code, enter an **interactive plan-mode session** (Phase 3.5): present a written plan, surface open questions, get explicit approval before implementing. Runs *after* the worktree is claimed so you plan with full context. Rejection routes to Phase 7 cleanup exactly like a Phase 3 skip.
- **`--review-with` / `--review-iterations` / `--review-stop-on-findings` / `--review-stop-on-clean` / `--reviewer-applies` / `--no-review`** — **passed through to `/do:pr`** in Phase 6, which owns the review/ship machinery. Same grammar as every other slashdo command (see `/do:pr`). `--no-review` opts out of both `/simplify` and the external pass. When neither `--review-with` nor `--no-review` is given, you decide in Phase 6 whether the diff warrants `/simplify` and/or an external review (a value swap doesn't; a multi-file change does).

## Phase 1: Pick

Build the in-flight set first (identical in both modes):

```bash
git fetch --prune 2>/dev/null
git branch -a --no-color --format='%(refname:short)'
gh pr list --state open --json headRefName -q '.[].headRefName' 2>/dev/null   # glab: glab mr list --json | jq -r '.[].source_branch'
```

For every ref, split on `/` and collect each segment — that's the raw in-flight set.

### Phase 1 — PLAN.md mode (default)

1. **Locate the queue — auto-redirect to issues when PLAN.md isn't the source of truth.** Read `PLAN.md` from the repo root, then route:
   - **PLAN.md is absent, OR its body is the issue-mode stub** (`/do:replan --issues` empties PLAN.md to a "roadmap lives in the tracker" note — detect the sentinel phrase **"tracks its roadmap as issues"** or **"Managed by `/do:replan --issues`"**, i.e. a note pointing at the tracker with zero `- [ ]` items) → **this repo is issue-tracked. Switch to issue mode automatically**: set `ISSUE_MODE=true` and continue from the issues-mode Phase 1 below (which runs the [lib/plan-issue-mode.md](../../lib/plan-issue-mode.md) setup). State the switch plainly: `No PLAN.md backlog — this repo tracks work as issues; continuing in --issues mode.` If the issue-mode setup aborts because **no host is authenticated**, surface that abort to the user (the message tells them to run `gh auth login` or create a PLAN.md) — do NOT silently report an empty queue.
   - **PLAN.md exists with real `- [ ]` items** → continue in PLAN.md mode (steps 2–5).
   - **PLAN.md exists, is not the stub, but has zero `- [ ]` items** (a genuinely empty backlog) → report `PLAN.md has no open items.` and stop, suggesting `/do:replan` or `/do:goals` to populate it (or `--issues` to work the tracker).
2. **If any `- [ ]` line lacks a `[<slug>]` ID, stop and tell the user to run `/do:replan` first** — its Phase 0 populates IDs in one pass, after which `/do:next` can find work.
3. Keep raw in-flight segments that exactly match a slug present in PLAN.md — that's the in-flight set.
4. **Pick the target slug:**
   - **With argument** — verify the slug exists as a `- [ ]` line and is NOT in flight. If either fails, print why and stop.
   - **Without argument** — walk PLAN.md top-to-bottom; pick the FIRST `- [ ]` line where ALL hold: slug NOT in flight; the immediately-preceding line is NOT a `> ⚠️ DRIFT:` blockquote (drift items need a human-driven `/do:replan --interactive` decision); the line carries no `<!-- NEEDS_INPUT -->` annotation.
5. **If no eligible item exists**, print why (all in flight / all drifted / all NEEDS_INPUT / nothing unchecked) and stop. Do NOT invent new work — that's `/do:replan`'s job.

> **`<slug>` argument + auto-redirect.** If the user passed an explicit `<slug>` but the queue auto-redirected to issues (no PLAN.md / stub), the slug can't be a PLAN item — tell them so and ask whether they meant an issue number (`#<num>`); don't silently reinterpret it.

### Phase 1 — issues mode (`--issues`)

Run the issue-mode setup from [lib/plan-issue-mode.md](../../lib/plan-issue-mode.md) (detect `gh`/`glab` as `CLI_TOOL`, ensure `PLAN_LABEL` exists, abort if neither host is authenticated). Then:

1. **Resolve the repo creator** — only creator-authored issues are auto-pick candidates: `CREATOR="$(gh repo view --json owner -q .owner.login)"`. (Reads `origin`; for fork users this is their own login, which is correct. Pass an explicit `owner/repo` to target upstream.)
2. **List candidates** — open, authored by `$CREATOR`, **carrying `PLAN_LABEL`** (default `plan`; set by `--issues-label`), oldest-first (`gh issue list` never returns pull requests, so PRs are excluded automatically). The label filter is what makes this consistent with the rest of slashdo's issue mode: `/do:replan --issues` and `lib/plan-issue-mode.md` treat **only labeled issues** as plan items, so an unlabeled owner-authored bug report is NOT auto-claimable work:
   ```bash
   gh issue list --state open --author "$CREATOR" --label "$PLAN_LABEL" --limit 100 \
     --json number,title,assignees,labels,createdAt -q 'sort_by(.createdAt) | .[]'
   ```
3. **Determine in-flight issues.** Issue `N` is in flight if EITHER `issue-N` appears in the raw in-flight set, OR the issue **already has an assignee** (someone took it via the Phase 2 marker, possibly on another machine). The assignee check is the cross-machine half of the claim — a local-only `next/issue-N` branch on a sibling machine is invisible here, but its assignee is not.
4. **Pick the target issue:**
   - **With argument** — the issue number (strip `#`). Verify open, creator-authored, NOT in flight. If it lacks `PLAN_LABEL`, this is an **explicit override** (the user named a specific issue): proceed, but state that you're claiming an unlabeled issue so the choice is visible. If any other check fails, print why and stop.
   - **Without argument** — pick the FIRST (oldest) candidate (the candidate list is already `PLAN_LABEL`-scoped) NOT in flight and NOT carrying a parking label (`blocked`, `needs-input`, `wontfix`, `discussion`, `future`, or any repo-specific parking label — skip and note it). An explicit `#num` can still claim a `future`-labelled issue; auto-pick never surfaces it.
5. **Set `ISSUE_NUM=<num>` and `SLUG="issue-${ISSUE_NUM}"`** — later phases use `SLUG` for worktree/branch/commit/PR and `ISSUE_NUM` for `gh issue` calls.
6. **If no eligible issue exists**, print why and stop. Do NOT open new issues here — that only happens for work *discovered while implementing* (Phase 4/6).

## Phase 2: Claim (worktree) — REQUIRED, NOT OPTIONAL

> `/do:next` always uses a worktree so a *second* `/do:next` in another tab doesn't fight over the main repo's working tree. **A `/do:next` without a worktree is a broken claim — it blocks every subsequent claim until cleaned up.**
>
> - ❌ NEVER `git checkout -b next/<slug>` or `git switch -c next/<slug>` in the main repo.
> - ✅ ALWAYS use `git worktree add` with an explicit path, then `cd` in and verify with `pwd`. (The bash-tool "avoid `cd`" guidance does not apply — the user explicitly requested a working-directory change by invoking `/do:next`.)

slashdo's worktree convention is a **sibling directory** (`../next-<slug>`) on branch `next/<slug>`. In issues mode `<slug>` is `issue-<num>`. Run as a **single Bash invocation** so the shell vars stay in scope, substituting the real slug:

```bash
SLUG="<picked-slug>" && \
DEFAULT_BRANCH="$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name)" && \
WORKTREE="../next-${SLUG}" && \
git fetch origin "${DEFAULT_BRANCH}" && \
git worktree add -b "next/${SLUG}" "${WORKTREE}" "origin/${DEFAULT_BRANCH}" && \
cd "${WORKTREE}" && \
pwd
```

**Verify `pwd` is the worktree path**, not the main repo. If it printed the main repo path, the worktree creation or `cd` failed — STOP, report the error, do not proceed. **Re-anchor every later Bash call** with `cd "${WORKTREE}"` or absolute paths; working directory persists but a stray `cd` can drop you back at the main repo silently. Stash the absolute worktree path for Phase 7.

### Phase 2 — mark the issue in progress (issues mode only)

Immediately after the worktree is verified, claim the issue **on the host** so a `/do:next --issues` on any other machine sees it as taken (Phase 1's assignee check is the reader). Do this before writing code — it's the cross-machine half of the claim:

```bash
gh issue edit "$ISSUE_NUM" --add-assignee @me                                   # load-bearing marker
gh label create in-progress --color FFA500 --description "Claimed and being worked" 2>/dev/null || true
gh issue edit "$ISSUE_NUM" --add-label in-progress 2>/dev/null || true          # human-visibility only
```

The assignee is the marker; the label is convenience (`|| true` keeps a label failure from aborting). **If you must stop after this (worktree failed, or `--add-assignee` shows a sibling machine grabbed it in the race window), release the marker before stopping:** `gh issue edit "$ISSUE_NUM" --remove-assignee @me --remove-label in-progress 2>/dev/null || true` — so a half-claimed issue isn't stranded as permanently "taken."

## Phase 3: Verify still valid

Before writing code, sanity-check that executing the item as worded won't regress newer work. **Ask the user before proceeding if ANY hold:**

- **(PLAN.md)** The picked line has a `> ⚠️ DRIFT:` blockquote (you should have filtered it, but double-check), OR `git blame -L <line>,<line> -- PLAN.md` shows it was added in the last 24h AND conflicts with a since-merged commit.
- **(issues)** The full issue body/comments (`gh issue view <num> --comments`) supersede the title, the issue is already resolved, it's a pure discussion/question with no actionable change, or it awaits an unanswered clarification.
- **(both)** The item references a function/file/component that no longer exists or was heavily rewritten — `grep -rn` the named identifiers; if absent, it's stale and needs a human re-spec. OR it depends on an unshipped predecessor. OR the work would touch >5 unrelated files (bigger than estimated).

On "skip", run Phase 7 cleanup and re-run Phase 1 for the next item. **In issues mode also release the marker:** `gh issue edit "$ISSUE_NUM" --remove-assignee @me --remove-label in-progress 2>/dev/null || true`.

## Phase 3.5: Plan (interactive) — only when `--plan` was passed

Skip unless `--plan` is set. When present, don't touch code yet:

1. **Gather just enough context to plan** — read the files the item names, grep its identifiers, confirm integration points.
2. **Enter plan mode** (via the harness's plan-mode entry, e.g. `EnterPlanMode` under Claude Code) and present: the item (slug/`issue-<num>`), approach, files to add/change, tests, and any migration/compat/changelog obligations the repo's CLAUDE.md triggers.
3. **Clarify interactively** — ask only the questions whose answers change the implementation; pick obvious defaults and state them.
4. **Get explicit approval** (via the harness's plan-approval exit, e.g. `ExitPlanMode`) before Phase 4. Don't implement on an unapproved plan.
5. **On rejection/stop** — treat exactly like a Phase 3 skip: Phase 7 cleanup, and in issues mode release the marker.

## Phase 4: Implement

Write the code, tests, and docs the item requires, following the **target repo's** `CLAUDE.md` conventions. Run the relevant test suite as you go.

**Roll discovered backbone work INTO this PR — don't defer it.** A helper to extract, a shared abstraction the change should sit on, a small refactor that makes the fix cleaner — fold it in, test it, mention it in the PR body. Only defer work that is **genuinely large** (its own multi-file feature, a migration, a cross-cutting redesign warranting its own plan/PR). The bar is "this needs its own PR," not "slightly outside the line-item's wording." When in doubt, roll it in.

**Where deferred work lands depends on the mode:**
- **PLAN.md mode** → add a NEW `- [ ] [<slug>] **Title** — rationale` item (slug per [lib/plan-id-format.md](../../lib/plan-id-format.md)).
- **Issues mode** → file a NEW tracker issue (never PLAN.md), with enough context to pick up cold (file paths, why split out, which issue surfaced it), tagged `PLAN_LABEL` so the next `/do:next --issues` and `/do:replan` treat it as queued:
  ```bash
  gh issue create --title "<concise actionable title>" --label "$PLAN_LABEL" \
    --body "$(printf 'Discovered while working issue #%s.\n\n<what, where (file:line), why it needs its own PR>\n' "$ISSUE_NUM")"
  ```

**Commit messages.** Reference the slug in the subject so the work is grep-able across changelog, branches, and PR titles: `feat([<slug>]): <one-line description>` (use `fix:`/`refactor:`/`chore:` per conventional prefixes).

## Phase 5: Record completion + changelog

> **Re-sync with the default branch BEFORE editing tracked files — required when claims run in parallel.** Every claim touches the same hot changelog (and, in PLAN.md mode, the backlog list). This worktree was cut at claim-start; editing that stale snapshot silently *re-adds* lines sibling claims removed. Sync first, from inside the worktree:
> ```bash
> cd "${WORKTREE}" && git fetch origin "${DEFAULT_BRANCH}" && git merge --no-edit "origin/${DEFAULT_BRANCH}"
> ```
> **Conflict rule — deletions win.** Resolve any PLAN.md / changelog conflict so a line removed on *either* side stays removed; keep additions from both. Then `git add` and `git commit --no-edit`.

**Mark the work item done:**
- **PLAN.md mode** — **remove the picked `- [ ]` line outright** (the changelog and git history are the audit trail; don't leave a checked `- [x]` behind unless the repo keeps items as a design log). If removing it empties a heading, leave the heading — section curation is `/do:replan`'s job.
- **Issues mode** — **don't touch PLAN.md.** Close the issue via the PR: put `Closes #<num>` in the PR body (Phase 6) so merge auto-closes it.

**Changelog (both modes).** Check for `.changelogs/` or `.changelog/` (whichever exists); if found, append a user-facing entry to its `NEXT.md`, creating `NEXT.md` from the standard template (`# Unreleased Changes` / `## Added` / `## Changed` / `## Fixed` / `## Removed`) if absent. Lead with the slug in brackets; write for a *user* of the app, not a coder inside it (no file paths, module/function names, test counts). If the change has no user-visible effect, keep it to one terse sentence under **Changed**. If no changelog directory exists, skip this step.

```markdown
- **[<slug>] <Short, user-facing title>** — <one sentence on the user-visible effect>
```

Stage and commit:

```bash
# PLAN.md mode:
git add PLAN.md
git add .changelogs/NEXT.md 2>/dev/null || git add .changelog/NEXT.md 2>/dev/null || true
git commit -m "docs([<slug>]): remove from PLAN.md and log to changelog"

# Issues mode (no PLAN.md edit): commit ONLY if a changelog was actually staged.
# A repo with no .changelogs/.changelog dir stages nothing here, and PLAN.md is
# untouched in issue mode — so an unconditional `git commit` would exit non-zero
# ("nothing to commit") and abort an otherwise-valid run. Guard with a staged check:
git add .changelogs/NEXT.md 2>/dev/null || git add .changelog/NEXT.md 2>/dev/null || true
git diff --cached --quiet || git commit -m "docs([issue-<num>]): log issue #<num> to changelog"
```

## Phase 6: Review and ship — delegate to `/do:pr`

> **Issues mode — link the PR to the issue.** The PR body MUST contain `Closes #<num>` (or `Fixes #<num>`) so merging auto-closes the claimed issue. Reference any discovered follow-up issues you filed with plain `#<n>` (NOT `Closes` — they're not resolved by this PR).
>
> **Issues mode — major review findings become tracker issues, not PLAN.md items.** A substantial finding you decide *not* to fix here gets filed as a NEW issue (`gh issue create --label "$PLAN_LABEL" …`, same form as Phase 4). Nit/style findings just get parked verbally.

`/do:pr` already owns the entire review/ship pipeline — the required Local Code Review gate, `--review-with` multi-reviewer loop, `--review-iterations`, stop-modes, and `--reviewer-applies`. **Do not re-implement any of it here.** From inside the worktree, decide the review intensity, then invoke `/do:pr` with the flags this command received:

| The user passed… | Run |
|---|---|
| `--review-with=<agents>` | `/simplify` (unless the diff is genuinely trivial), then `/do:pr --review-with=<agents>` (pass through `--review-iterations` / stop-mode / `--reviewer-applies` verbatim) |
| `--no-review` | `/do:pr` with no `--review-with` — its Local Code Review gate still fires; no external pass, no `/simplify` |
| neither | **Judge the diff.** New code paths / abstractions / multi-file work → `/simplify` then `/do:pr --review-with=…` with a sensible reviewer. A value swap / typo / single-line fix → `/do:pr` alone. State the call before acting. |

State any skip/trim and why ("Diff is 3 lines in one file; skipping `/simplify` and external review — matches existing pattern"). `/do:pr` pushes `next/<slug>`, opens the PR (include `Closes #<num>` in issues mode), runs the chosen review loop, and reports the aggregate status.

**Encode the slug in the PR title** for grep-ability if `/do:pr` didn't: `gh pr edit <num> --title "feat([<slug>]): <description>"`.

**Re-sync, then merge.** A long review loop can let sibling claims merge after your Phase-5 sync — re-sync once more so a stale PLAN.md can't resurrect their removed items at merge time:

```bash
cd "${WORKTREE}" && git fetch origin "${DEFAULT_BRANCH}" && git merge --no-edit "origin/${DEFAULT_BRANCH}"
# Resolve any PLAN.md / changelog conflict deletions-win (Phase 5 rule), then:
git push
gh pr merge <num> --merge --delete-branch
```

## Phase 7: Clean up

From the **main repo** (not the worktree), as a single Bash invocation, re-substituting the slug and worktree path stashed in Phase 2:

```bash
SLUG="<picked-slug>" && \
WORKTREE="../next-${SLUG}" && \
git worktree remove "${WORKTREE}" && \
git pull --rebase --autostash
git branch -d "next/${SLUG}"
```

(Sync the main repo BEFORE deleting the local branch — `git branch -d` is safe-delete and **fails with "not fully merged" when the PR was squash- or rebase-merged**, so chaining the pull after it with `&&` would skip the sync and strand main behind the merge. Keep the delete as its own statement; only fall back to `-D` after confirming no unmerged work.)

**Issues mode — confirm closed, then clear the marker.** A `Closes #<num>` in the PR body auto-closes on merge to the **default branch**. Verify with `gh issue view <num> --json state -q .state` (expect `CLOSED`); if still `OPEN`, close explicitly: `gh issue close <num> --comment "Shipped in PR #<PR_NUM>."`. Then drop the stale label: `gh issue edit "$ISSUE_NUM" --remove-label in-progress 2>/dev/null || true`. (Leave the assignee — it records who shipped it; a closed issue is never a Phase 1 candidate anyway.)

Print a one-line summary:

```
# PLAN.md mode:
Shipped [<slug>] <Title>. PR #<num>. Worktree + branch cleaned.

# Issues mode:
Shipped issue #<num> "<Title>". PR #<PR_NUM>. Issue closed. Worktree + branch cleaned.
```

## Notes

- **Concurrency model.** The worry isn't strangers — it's *your own parallel agents* (a second tab, a scheduled job) picking the same item. The branch+PR scan in Phase 1 catches both; issues mode's assignee marker extends the protection across machines.
- **Empty pick is not a failure.** Everything in flight / drifted / NEEDS_INPUT (PLAN.md), or every creator-authored issue in flight / assigned / parking-labelled (issues) is a healthy queue — exit clean and say so.
- **`/do:next` only *consumes* the queue.** New work comes from `/do:replan`, `/do:better`, `/do:depfree`, or human edits — never invented here, except *discovered* work split out of the current item (Phase 4/6).
- **`--issues` is per-invocation, consistent with every other slashdo command.** There is no separate config file (YAGNI) — a repo that works issues-first simply always passes `--issues`, the same way it would to `/do:replan --issues`.
- **Auto-redirect makes `--issues` optional for issue-tracked repos.** When there's no PLAN.md, or PLAN.md is the stub `/do:replan --issues` leaves behind, a bare `/do:next` recognizes the repo is issue-tracked and continues in issue mode on its own (stating the switch). So a repo that ran `/do:replan --issues` once doesn't need every contributor to remember the flag — the stub *is* the config signal. Passing `--issues` explicitly still works and skips the detection.
- **GitLab.** Examples show `gh` (GitHub); GitLab is supported via `glab` following the same model in [lib/plan-issue-mode.md](../../lib/plan-issue-mode.md) — substitute the `glab issue`/`glab mr` equivalents and GitLab's assignee semantics.
- **Issues-mode creator filter is a hard filter.** Auto-pick and explicit `#num` both reject issues NOT authored by the repo owner, so `/do:next --issues` never acts on community/bot-filed issues without a human triaging them first (those surface via `/do:replan`).
