---
description: Claim the next unclaimed PLAN.md item (or GitHub issue with --issues) by its ID, do the work in an isolated worktree, ship a PR, and clean up — or, with --swarm, claim and ship several independent issues in parallel. Requires GitHub (gh) — it ships via /do:pr.
argument-hint: "[<slug>|#<issue>] [--issues|--no-issues] [--issues-label <name>] [--swarm[=<N>]] [--plan] [--review-with <agent>[,…]] [--review-iterations <n>] [--review-mode <series|parallel>] [--review-stop-on-findings|--review-stop-on-clean] [--reviewer-applies] [--no-review]"
---

# Next — Pick the next plan item (or issue) and ship it

Claim the next unclaimed `- [ ]` item from **PLAN.md** via the slug-ID system — or, with `--issues`, the next open tracker issue (any label by default; `--issues-label` narrows to a curated queue) — work it in an **isolated worktree**, run review, open a PR, merge, and clean up. This is the **consumer** counterpart to `/do:replan`, `/do:better`, and `/do:depfree` (which *populate* the queue): `/do:next` *drains* it, one item per run.

**Two work sources.** The work queue comes from one of two places, selected by the resolved `ISSUE_MODE` (the `--issues`/`--no-issues` flag, a saved `issues` default, or the Phase 1 auto-redirect — see Parse Arguments):

| Source | Selected by | Work unit | Branch | "Done" action | Discovered work goes to |
|---|---|---|---|---|---|
| **PLAN.md** (default) | `ISSUE_MODE=false` | a `- [ ]` line with a `[<slug>]` ID | `next/<slug>` | remove the line + log to the changelog | a new PLAN.md item (only if genuinely large) |
| **Tracker issues** | `ISSUE_MODE=true` (`--issues`, saved default, or auto-redirect) | an open issue (any label by default; `--issues-label` narrows to one) | `next/issue-<num>` | close the issue via `Closes #<num>` in the PR | a new tracker issue (only if genuinely large) — never PLAN.md |

The two sources never mix in one run. In issues mode, treat `issue-<num>` as the "slug" everywhere the PLAN.md flow says `<slug>` — worktree (`../next-issue-<num>`), branch (`next/issue-<num>`), commit/PR-title prefix (`[issue-<num>]`), and in-flight scan all work unchanged because `issue-<num>` is a single `/`-segment in the branch name just like a PLAN slug.

**How the claim works.** Every PLAN.md checkbox carries a `[<slug>]` ID (see [lib/plan-id-format.md](../../lib/plan-id-format.md)). A slug is **"in flight"** when it appears as a `/`-separated segment in any local or remote branch (`git branch -a`) or any open PR head ref. `/do:next` picks the first `- [ ]` whose slug is NOT in flight and creates a `next/<slug>` branch — that branch name *is* the claim, visible to every other agent and human running this command. Issues mode adds a second, cross-machine marker (assignee) described in Phase 2.

**Drain one item — or several at once (`--swarm`).** By default `/do:next` ships exactly one item per run. With `--swarm` (issues mode) it claims and ships **several independent open issues in parallel**, each in its own worktree subagent, and serializes only the merge — a throughput multiplier over running `/do:next` one item at a time. See **Swarm mode** below; the single-issue Phases 1–7 are unchanged when `--swarm` is absent.

## Parse Arguments

Split `$ARGUMENTS` on whitespace — tokens starting with `--` are flags, the first remaining non-flag token is the target slug/issue. Value flags accept either `--flag=value` or `--flag value` (consume the next token as the value, don't mistake it for the slug). Order is free.

- **`<slug>` / `#<issue>`** — claim THAT specific item instead of auto-picking (cherry-pick out of order). PLAN.md mode: a slug that must already exist as a `- [ ]` line (this command never *assigns* IDs — that's `/do:replan`'s job). Issues mode: an issue number, bare (`123`) or `#`-prefixed (`#123`, strip the `#`); must be open. An explicit number is a deliberate cherry-pick that **bypasses every auto-pick skip** — it can claim a parking-labelled issue (`future`/`blocked`/…), an epic (resolved per its children — see Phase 1 step 3), or, when a label filter is active, an issue outside that filter; state it when you do.
- **`--issues`** / **`--no-issues`** — switch the source from PLAN.md to the **tracker**, or force PLAN.md mode. `--issues` sets `ISSUE_MODE=true`; `--no-issues` sets `ISSUE_MODE=false`. Setup (host detection, label, abort-if-unauthenticated) follows [lib/plan-issue-mode.md](../../lib/plan-issue-mode.md). In issue mode PLAN.md is never read or edited.
- **`--issues-label <name>`** — when set, **restricts auto-pick to issues carrying that label** (a curated queue, e.g. only the `plan`-labelled items `/do:replan --issues` produced). **Auto-pick is unfiltered by default** — without this flag it considers *all* open issues, gated only by the parking-label skip and the in-flight/assigned checks. The label is recorded as `PLAN_LABEL` (default `plan`); that default is still the label applied to issues this command *files* (discovered/queued work, Phase 4), but it only *filters* auto-pick when the flag (or a saved `issues-label` default) explicitly supplied it. Track whether a filter is active as `LABEL_FILTER` (set to the label only when explicitly provided; empty otherwise). Only meaningful in issue mode.
- **Saved defaults.** If the user passed **neither** `--issues` nor `--no-issues`, resolve `ISSUE_MODE` from the saved `issues` default — per-project `.slashdo.json` overrides the global `~/.claude/.slashdo-config.json` (the precedence is the one in [lib/review-config-defaults.md](../../lib/review-config-defaults.md)), built-in default `false`. Likewise take `PLAN_LABEL` from the saved `issues-label` default when `--issues-label` is absent — and a saved `issues-label` default counts as an explicit choice, so it sets `LABEL_FILTER` (activating the curated-queue filter) exactly as the flag would. With neither flag nor saved default, `LABEL_FILTER` stays empty and auto-pick is label-agnostic. (Only resolve `issues` / `issues-label` here — the review flags are passed through to `/do:pr`, which resolves *its* defaults itself; don't pre-resolve them.) The Phase 1 auto-redirect still applies independently: a repo with no PLAN.md / the issue-mode stub switches to issue mode even when no default is saved (or when a saved `issues=false` would otherwise pick PLAN.md mode — there's simply no PLAN.md backlog to read). The one exception is an **explicit** `--no-issues` on the command line, which wins over the redirect per the usual "typed flag wins" rule (see Phase 1).
- **`--swarm` / `--swarm=<N>`** — drain **several independent issues in parallel** instead of one. Bare `--swarm` resolves `SWARM_N=3`; `--swarm=<N>` (or `--swarm <N>`) sets it, **clamped to `1..6`** (state the clamp if the user asked for more). Records `SWARM=true`. **Issues mode only**, **incompatible with an explicit `<slug>`/`#issue` target**, and it short-circuits the single-issue Phases 1–7 into the **Swarm mode** flow below — see there for the preconditions and the partition → fan-out → serialized-merge pipeline. Ignored (with a note) when only one eligible issue exists. Review flags below are passed through to each swarm agent's `/do:pr` exactly as in the single-issue flow.
- **`--plan`** — before writing code, enter an **interactive plan-mode session** (Phase 3.5): present a written plan, surface open questions, get explicit approval before implementing. Runs *after* the worktree is claimed so you plan with full context. Rejection routes to Phase 7 cleanup exactly like a Phase 3 skip. **Ignored in `--swarm` mode** (parallel agents can't each hold an interactive plan session; state the skip).
- **`--review-with` / `--review-iterations` / `--review-mode` / `--review-stop-on-findings` / `--review-stop-on-clean` / `--reviewer-applies` / `--no-review`** — **passed through to `/do:pr`** in Phase 6, which owns the review/ship machinery. (`--review-mode series|parallel` selects how `/do:pr`'s multi-reviewer loop dispatches the reviewers; series is the default.) Same grammar as every other slashdo command (see `/do:pr`). `--no-review` opts out of both `/simplify` and the external pass. When neither `--review-with` nor `--no-review` is given, you decide in Phase 6 whether the diff warrants `/simplify` and/or an external review (a value swap doesn't; a multi-file change does).

## Swarm mode (`--swarm`) — drain several independent issues in parallel

**When `SWARM` is true, this section replaces Phases 1–7 for the run.** It claims and ships up to `SWARM_N` independent open issues at once — each in its own worktree subagent running the normal single-issue flow — then serializes only the merge. When `--swarm` is absent, skip this section entirely and run Phases 1–7 below. Swarm reuses the single-issue phases wholesale: each agent runs the single-issue **Phases 2–6** for one issue (claim → implement → changelog → review, **no merge, no Phase 7 cleanup** — the orchestrator owns those), so the claim/lease, worktree, implement, changelog, and review-gate semantics are exactly the single-issue ones. The only new logic is partitioning the batch up front (Phase A) and serializing the merges at the end (Phase C).

**Preconditions — check first; abort cleanly if any fails (do not partially claim):**
- **Issues mode only.** Swarm's claim/lease is the GitHub assignee marker, and partitioning by dependency needs the tracker. **Resolve `ISSUE_MODE` here first, including Phase 1's auto-redirect** — because swarm replaces Phases 1–7, that redirect won't fire on its own: if `--issues`/a saved default didn't already set it, apply the same structural check Phase 1 does — a repo with **no PLAN.md, or only the issue-mode stub**, *is* issue-tracked, so set `ISSUE_MODE=true` (state the switch). Abort **only** when it still resolves to PLAN.md mode (a real PLAN.md backlog and no `--issues`): ``--swarm works in issues mode only — pass --issues (or run in an issue-tracked repo). PLAN.md-mode swarm is a future enhancement.``
- **GitHub + authenticated `gh`** — the same Phase 1 pre-flight (it ships through `/do:pr`).
- **A subagent-capable harness.** Swarm fans out parallel agents via the harness's subagent mechanism (Claude Code's `Agent`/Task tool, or the equivalent). **If the environment cannot spawn parallel subagents, fall back to sequential** — run Phase B's per-issue task (Phases 2–6, **no merge**) for each partitioned issue one after another in this same session, then proceed to Phase C so the merge stays owned by the serialized queue, not each iteration (still useful: it drains `SWARM_N` items in one invocation, just not concurrently). State that you're doing so.
- **No explicit target.** `--swarm` auto-picks a batch; combining it with an explicit `<slug>`/`#issue` is contradictory — abort: ``--swarm auto-picks a batch; drop the explicit target, or drop --swarm to claim that one item.``

**Concurrency & cost.** `SWARM_N` parallel agents multiply token spend roughly N×. State the resolved N and that implication up front (e.g. `launching 3 parallel agents — ≈3× the tokens of a single /do:next`). The `1..6` clamp (Parse Arguments) is deliberate: beyond ~6 concurrent worktrees/PRs, git-index-lock contention and merge-queue churn outweigh the throughput gain.

### Swarm Phase A — Triage & partition (orchestrator, in the main repo)

1. **Build the eligible queue** exactly as **Phase 1 — issues mode** below: the priority-then-oldest walk with EVERY skip applied (in-flight, already-assigned, parking-labelled, `epic-open`/`epic-done` epics, blocked-by an open declared dependency). An `epic-wrapup` epic is eligible like any issue. Reuse that logic verbatim — do not invent a second picker.
2. **Select the first `SWARM_N` *independent* eligible issues** off the top of that ordered queue:
   - **Intra-batch dependency.** If a candidate declares `Depends on #N` / `Blocked by #N` (or native blocked-by) on **another candidate in the batch**, keep only the predecessor this round — the successor self-clears and is picked next run once the predecessor merges. (Blockers *outside* the batch were already handled by the Phase 1 skip.)
   - **File-overlap avoidance (best-effort).** From each issue's title/body, predict the rough files/paths/components it touches. When two candidates obviously target the same file(s), keep the higher-priority one and skip the other **this round** — not for correctness (the serialized merge + re-sync handles that) but to avoid two agents thrashing or duplicating the same file. This is a cheap heuristic, not a guarantee; note when you apply it.
   - **Under-fill is fine.** If fewer than `SWARM_N` independent issues exist, run the swarm at the smaller size and say so. **If only one is eligible, run the normal single-issue flow instead** (Phases 1–7) and say so — a one-agent swarm is just `/do:next` with overhead.
3. **Do NOT claim here.** Each issue is claimed *inside* its own subagent so the assignee-marker + race read-back runs per issue, atomically. The orchestrator only hands each agent one specific issue number.

### Swarm Phase B — Fan out (one subagent per issue)

Launch the agents **in parallel** (all Agent/Task calls in a single response) and wait for all to return. Give each subagent exactly one issue number and this task:

> Run the `/do:next` single-issue flow for issue **#`<num>`** — the **Phase 1 explicit-`#<num>` path** (for validation + variable setup) followed by **Phases 2 through 6 only** — in your own sibling worktree, with these adjustments:
> - **Validate & set up via Phase 1's explicit-number path first:** run Phase 1's `#<num>` branch to confirm the issue is open and not in flight, resolve it if it's an epic, and set `ISSUE_NUM=<num>` / `SLUG=issue-<num>` — Phase 2's worktree/branch and every later `gh issue` call depend on those variables. (Skip the auto-pick walk; the orchestrator already vetted this issue in Phase A, and an explicit number deliberately bypasses the auto-pick skips.)
> - **Then claim via that same explicit-number path:** it performs the Phase 2 worktree creation + assignee-marker claim with the race read-back. If the read-back shows a sibling won the race, **yield** (release the marker, retract the claim branch, clean up your worktree) and return `{ issue, status: "yielded" }` — do NOT pick a different issue.
> - **Phase 3 still applies:** if the issue is stale/superseded/awaiting-input, skip it (release the marker, clean up) and return `{ issue, status: "skipped", reason }`.
> - Implement (Phase 4) and record completion + changelog (Phase 5) as normal.
> - **Ship via `/do:pr --no-merge`** with the run's review flags (Phase 6) and **STOP before the merge** — open the PR, run the review gate, but DO NOT merge and DO NOT run Phase 7 cleanup. The orchestrator owns the merge and the cleanup.
> - **Return a structured result**, one of two shapes Phase C dispatches on by whether `pr_number` is present:
>   - **PR opened:** `{ issue, pr_number, branch, worktree, review_status, notes }`, where `review_status` is `/do:pr`'s aggregate (`clean` / `partial` / `inconclusive` / `dirty`) or `opened-no-review` when no external reviewer ran and the Local Code Review gate passed.
>   - **No PR** (claim yielded to a race winner, or Phase 3 skipped it as stale): `{ issue, status: "yielded" | "skipped", reason }` — no `pr_number`.

Pass each agent the review flags verbatim (`--review-with` / `--review-iterations` / `--review-mode` / stop-mode / `--reviewer-applies` / `--no-review`). The **fix regression guard** and **CI flake handling** apply inside each agent automatically (they live in `/do:pr`'s loop and merge gate). Concurrent `git worktree add` against the shared repo can briefly contend on `.git` index locks — an agent that hits a transient lock retries once before failing.

**Harness without parallel subagents?** Per the precondition, run this same per-issue task **sequentially** in the current session — one issue at a time, identical task body — collecting each result, then proceed to Phase C unchanged. The merge queue is already serialized, so sequential fan-out only loses the concurrency, not any correctness.

### Swarm Phase C — Serialized merge queue (orchestrator)

After the barrier, merge the returned PRs **one at a time, never concurrently** — each merge advances the default branch, so the next PR may need a re-sync. Walk the results in the same priority/oldest order. For each:

1. **Skip non-mergeable results.** A result with `status: "yielded"`/`"skipped"` (no `pr_number`) has nothing to merge — record it. For the rest, apply **single-issue Phase 6's merge gate** to `review_status`: never merge `dirty` (build/test broken) or `inconclusive` (a requested reviewer missing/timed-out/errored) — leave that PR open and record why; merge only `clean`, `opened-no-review` (Local gate passed, no external reviewer requested), or `partial` **with** an explicit `--review-stop-on-*` flag. (Agents that never returned are reconciled in Phase D, not here.)
2. **Re-sync onto the advanced default branch** from the PR's worktree — `git fetch origin <default>` then `git merge --no-edit origin/<default>` — resolving any PLAN.md/changelog conflict **deletions-win** (a line removed on either side stays removed; keep additions from both). If the merge **can't be resolved cleanly**, leave that PR open, record it for human follow-up, and move to the next — **never force it**.
3. **Merge**, then on a required-check failure apply **CI flake handling** (one re-run on the same commit; flake → proceed, real → leave open — see `~/.claude/lib/ci-flake-handling.md`):
   ```bash
   git -C "<worktree>" push
   gh pr merge <pr_number> --merge --delete-branch
   ```
4. **Close out the issue** — single-issue Phase 7's closure step applied per merged PR: confirm `Closes #<num>` auto-closed it on merge to the default branch; if still open, `gh issue close <num> --comment "Shipped in PR #<pr_number>."`. Drop the `in-progress` label.

### Swarm Phase D — Reconcile, clean up, report

1. **Sweep worktrees & branches** from the main repo: `git worktree remove` + `git branch -d`/`-D` each merged agent's worktree/branch, then `git worktree prune`. **Keep** the worktree/branch of any PR left open so the work can be finished.
2. **Handle agent death / spend-limit.** If an agent never returned (crash, monthly spend cap), reconcile from **GitHub state, not its last words** — and **never assume a review status survived the death** (slashdo's local-reviewer verdicts aren't persisted to the PR, so there's no stored `review_status` to read back). A worktree/branch/PR may exist:
   - **A PR opened:** recompute its gate from scratch before merging — re-run the run's review flags against it (`/do:pr --no-merge` with the same `--review-with`), or, for a no-external-review run, treat green required-CI + a mergeable state as `opened-no-review`-eligible. Merge it through the Phase C queue only on a clean recompute; if requested external reviewers can't be re-run to clean, leave the PR open and flag it for a human.
   - **No PR (or an unclean recompute you won't finish):** **release the claim** — remove the assignee, delete the local+remote `next/issue-<num>` branch, drop `in-progress` — so the issue returns to the queue, and flag it for human follow-up.
3. **Re-evaluate parent epics** for every issue that closed — a shipped issue may have been an epic's last child (the Phase 7 "re-evaluate the parent epic" step, run once per closed child).
4. **Reconcile changelog/PLAN churn.** Parallel claims all touch `NEXT.md`; the deletions-win re-syncs in Phase C should have kept it consistent — confirm the merged default branch's `NEXT.md` carries every shipped issue's entry with no duplicate or resurrected lines.
5. **Print a summary table** — one row per batch issue: `issue · PR · result (merged / open: why / yielded / skipped / needs-input) · review status`.

## Phase 1: Pick

> **Pre-flight — `/do:next` requires GitHub (`gh`), in BOTH modes.** The command ships via `/do:pr` and merges with `gh pr merge`, both of which are GitHub-only. So even PLAN.md mode (whose *claiming* is git-only) can't *complete* on a non-GitHub host. **Abort up front — before claiming or implementing anything — if the repo's `origin` isn't GitHub or `gh` isn't authenticated**, so the user never claims work they can't ship:
> ```bash
> # `--active` scopes the check to the active account. A bare `gh auth status` exits
> # non-zero if ANY configured account has a stale/invalid token — even when the active
> # account is authenticated fine — which would fail this pre-flight on every run.
> gh auth status --active >/dev/null 2>&1 && git remote get-url origin 2>/dev/null | grep -qi github.com || {
>   echo "/do:next requires a GitHub repo with an authenticated gh CLI (it ships via /do:pr). Run 'gh auth login', or use a different workflow for non-GitHub hosts."; exit 1; }
> ```

Build the in-flight set (identical in both modes):

```bash
git fetch --prune 2>/dev/null
git branch -a --no-color --format='%(refname:short)'
gh pr list --state open --limit 500 --json headRefName -q '.[].headRefName' 2>/dev/null || true   # 500 cap avoids silent truncation; || true keeps a transient gh hiccup from aborting the scan (the pre-flight already confirmed gh works)
```

For every ref, split on `/` and collect each segment — that's the raw in-flight set.

### Phase 1 — PLAN.md mode (default)

1. **Locate the queue — auto-redirect to issues when PLAN.md isn't the source of truth.** Read `PLAN.md` from the repo root, then route:
   - **PLAN.md is absent, OR its body is the issue-mode stub** (`/do:replan --issues` empties PLAN.md to a "roadmap lives in the tracker" note — detect the sentinel phrase **"tracks its roadmap as issues"** or **"Managed by `/do:replan --issues`"**, i.e. a note pointing at the tracker with zero `- [ ]` items) → this repo is issue-tracked. **Unless the user explicitly typed `--no-issues`** — an explicit request for PLAN.md mode wins over the structural heuristic, so in that case report `No PLAN.md backlog and --no-issues was set — create a PLAN.md or drop --no-issues to work the tracker.` and stop — **switch to issue mode automatically**: set `ISSUE_MODE=true` and continue from the issues-mode Phase 1 below (which runs the [lib/plan-issue-mode.md](../../lib/plan-issue-mode.md) setup). State the switch plainly: `No PLAN.md backlog — this repo tracks work as issues; continuing in --issues mode.` If the issue-mode setup aborts because **no host is authenticated**, surface that abort to the user (the message tells them to run `gh auth login` or create a PLAN.md) — do NOT silently report an empty queue.
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

First run the shared issue-mode setup — detect `gh`/`glab` as `CLI_TOOL`, ensure `PLAN_LABEL` exists, and abort if neither host is authenticated (this file is inlined at install time, so it's available in every environment — not a dead link):

!`cat ~/.claude/lib/plan-issue-mode.md`

> **Issue mode requires GitHub (`gh`).** `/do:next`'s claim mechanics depend on the GitHub assignee model as the cross-machine marker (Phase 2). **If the setup selected `CLI_TOOL=glab`, abort issue mode** with: "`/do:next --issues` currently supports GitHub only — the cross-machine claim relies on GitHub issue assignees. Use PLAN.md mode (drop `--issues`), or track GitLab claim support as a feature request." Don't attempt the GitLab path with untested `glab` assignee commands — a half-working claim is worse than a clean abort. (The shared label/list *setup* above is cross-host, but the claim/marker flow below is not yet.) All commands below are therefore `gh`.

Then:

1. **List candidates** — open issues, **by priority then oldest-first**, **across all labels by default** (`gh issue list` never returns pull requests, so PRs are excluded automatically). **There is no author filter and no required label.** Auto-pick claims any open issue regardless of who filed it or what label it carries — the guards against claiming the wrong thing are the parking-label skip (step 3), the declared-dependency skip (step 4), and the in-flight/assigned checks, *not* a gating label. Only when a label filter is active (`LABEL_FILTER` set via `--issues-label` or a saved `issues-label` default) is the candidate set narrowed to that one curated label:
   ```bash
   # LABEL_FILTER is empty by default → all open issues; non-empty only when the user
   # explicitly opted into a curated queue via --issues-label / a saved issues-label default.
   # Sort key is [priorityRank, createdAt]: a `priority:<N>` label (lower N = higher
   # priority, e.g. priority:0 before priority:1) sorts first; an issue with NO priority
   # label gets rank +infinity (jq `infinite`) so it falls after EVERY prioritized one —
   # a finite sentinel like 9999 would tie a real `priority:9999` label and let unlabeled
   # work jump ahead of it — and createdAt breaks ties. With no `priority:*` labels
   # anywhere the order collapses to plain oldest-first — fully backward compatible.
   # `body` is fetched here for the step-4 dependency parse.
   gh issue list --state open ${LABEL_FILTER:+--label "$LABEL_FILTER"} --limit 500 \
     --json number,title,assignees,labels,createdAt,body \
     -q 'sort_by([ (([.labels[].name | select(test("^priority:[0-9]+$")) | ltrimstr("priority:") | tonumber] | min) // infinite), .createdAt ]) | .[]'
   ```
   The high `--limit` (500) avoids silently truncating the queue before the client-side priority/oldest sort — `gh issue list` defaults to 30, which would hide older eligible work. If a repo ever has >500 open candidate issues the queue is pathologically large (run `/do:replan --issues` to prune, or pass `--issues-label` to scope it); note the cap rather than silently dropping the overflow. **Priority is advisory ordering, not a gate** — an unprioritized issue is still claimable; the `priority:<N>` label only moves it earlier or later in the walk.
2. **Determine in-flight issues.** Issue `N` is in flight if EITHER `issue-N` appears in the raw in-flight set, OR the issue **already has an assignee** (someone took it via the Phase 2 marker, possibly on another machine). The assignee check is the cross-machine half of the claim — a local-only `next/issue-N` branch on a sibling machine is invisible here, but its assignee is not.
3. **Resolve epics before picking (child-aware).** An epic (umbrella issue) is **not** a single claimable unit — its done-ness depends on its children, not on code evidence. For any candidate that is an epic (carries `epic`/a repo umbrella label, has native sub-issues, or whose body task-lists other issues), classify it with the shared epic logic (inlined here so it's available in every environment — not a dead link):

!`cat ~/.claude/lib/epic-children.md`

   Act on the resulting state:
   - `epic-open` (≥1 child still OPEN) → **skip** as not-yet-workable; note `epic #N: X/Y children open`.
   - `epic-done` (all children CLOSED, no wrap-up tasks) → nothing to implement; **close it inline** as housekeeping (`gh issue close "$N" --comment "All children closed (#…) — closing epic. (slashdo)"`), note it, and keep scanning for the next item.
   - `epic-wrapup` (all children CLOSED, wrap-up tasks remain) → **this IS claimable work**: the work unit is "complete epic #N's remaining wrap-up tasks." Claim it like any issue — Phase 4 does the wrap-up (and ticks the wrap-up checkboxes in the epic body), and the Phase 6 PR carries `Closes #<N>` so merging closes the now-fully-done epic.
   - `epic-empty` (no children resolvable either way) → not really an umbrella; treat as an ordinary issue.
4. **Resolve declared dependencies before picking (blocked-by).** A candidate may declare a hard dependency in its **body**: a line matching `Depends on #<N>` or `Blocked by #<N>` (case-insensitive; one such line may list several, e.g. `Depends on #12, #15`). Collect every `#<N>` referenced on those lines. A candidate is **blocked** when ANY referenced issue is still OPEN — check the freshest state (`gh issue view <N> --json state -q .state`); a referenced number that is CLOSED, or doesn't exist, does not block. Resolve this **lazily** as you walk the queue (only for the candidate you're about to pick), so a long backlog doesn't fan out a `gh` call per issue up front.
   - `blocked` (≥1 referenced issue still OPEN) → **skip** in auto-pick; note `#N blocked by #M (open)`. The skip is **self-clearing** — when #M closes, #N becomes eligible on the next run with no manual relabel.
   - Also honor GitHub's **native** blocked-by relationship when the API surfaces it; the body convention is the portable default and the two are OR'd (blocked by *either* source ⇒ skip).
   - **Cycle / unresolvable chain** (A depends on B, B depends on A) → both stay skipped; note the cycle so a human can break it. Never loop trying to resolve one.
5. **Pick the target issue:**
   - **With argument** — the issue number (strip `#`). Verify open and NOT in flight. If it's an epic, resolve its state (step 3) first and act on that state — claim an `epic-wrapup`, close an `epic-done`, or warn that children are still open on an `epic-open` (the explicit request still overrides — state that you're doing so). Otherwise a named number is an **explicit override**: it claims even an issue auto-pick would skip — a parking-labelled one, one with an **open declared blocker** (step 4), or (when `LABEL_FILTER` is active) one outside the curated label. State plainly when you're overriding a skip (e.g. "claiming `future`-labelled #123 by explicit request", or "claiming #123 despite open blocker #120 by explicit request"). If any other check fails (closed, in flight), print why and stop.
   - **Without argument** — pick the FIRST candidate in the priority/oldest walk (step 1) that is NOT in flight, NOT already assigned, NOT carrying a parking label (`blocked`, `needs-input`, `wontfix`, `discussion`, `future`, or any repo-specific parking label — skip and note it), NOT blocked by an open declared dependency (step 4 — skip and note it), and NOT an `epic-open`/`epic-done` epic per step 3 (an `epic-wrapup` epic **is** eligible). Because auto-pick is label-agnostic by default, the parking-label skip, the dependency skip, and the epic resolution are the primary guards against claiming parked, blocked, or umbrella work. An explicit `#num` can still claim a skipped issue; auto-pick never surfaces one.
6. **Set `ISSUE_NUM=<num>` and `SLUG="issue-${ISSUE_NUM}"`** — later phases use `SLUG` for worktree/branch/commit/PR and `ISSUE_NUM` for `gh issue` calls.
7. **If no eligible issue exists**, print why and stop. Do NOT open new issues here — that only happens for work *discovered while implementing* (Phase 4/6).

## Phase 2: Claim (worktree) — REQUIRED, NOT OPTIONAL

> `/do:next` always uses a worktree so a *second* `/do:next` in another tab doesn't fight over the main repo's working tree. **A `/do:next` without a worktree is a broken claim — it blocks every subsequent claim until cleaned up.**
>
> - ❌ NEVER `git checkout -b next/<slug>` or `git switch -c next/<slug>` in the main repo.
> - ✅ ALWAYS use `git worktree add` with an explicit path, then `cd` in and verify with `pwd`. (The bash-tool "avoid `cd`" guidance does not apply — the user explicitly requested a working-directory change by invoking `/do:next`.)

slashdo's worktree convention is a **sibling directory** (`../next-<slug>`) on branch `next/<slug>`. In issues mode `<slug>` is `issue-<num>`. Run as a **single Bash invocation** so the shell vars stay in scope, substituting the real slug:

```bash
SLUG="<picked-slug>" && \
# Fail-closed pre-check: if origin ALREADY has this claim branch, a sibling machine
# claimed it between Phase 1's scan and now — abort and re-pick (don't build a worktree
# you'll just discard). This catches the common cross-machine collision cheaply.
if git ls-remote --exit-code --heads origin "next/${SLUG}" >/dev/null 2>&1; then
  echo "next/${SLUG} already on origin — another machine claimed it; re-run /do:next to pick the next item."; exit 1
fi && \
# Default-branch lookup via git (not `gh repo view`) — one less gh round-trip and
# works even mid-auth-hiccup. Try the local origin/HEAD ref first, fall back to
# querying the remote if it isn't set.
DEFAULT_BRANCH="$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@' || true)" && \
DEFAULT_BRANCH="${DEFAULT_BRANCH:-$(git remote show origin | sed -n 's/.*HEAD branch: //p')}" && \
WORKTREE="../next-${SLUG}" && \
git fetch origin "${DEFAULT_BRANCH}" && \
git worktree add -b "next/${SLUG}" "${WORKTREE}" "origin/${DEFAULT_BRANCH}" && \
cd "${WORKTREE}" && \
pwd && \
# Publish the (empty) claim branch IMMEDIATELY so the claim is remote-visible to
# other clones/machines right now — not only after /do:pr pushes in Phase 6. This
# is the PLAN.md-mode analog of the issue-mode assignee marker: Phase 1's in-flight
# scan on another machine fetches remote branches, so an early push is what stops two
# machines from claiming the same PLAN line. Non-fatal: if the push fails (no write
# access yet), warn and continue — the claim degrades to LOCAL-only (still protects
# parallel claims on THIS machine, just not across machines).
git push -u origin "next/${SLUG}" || echo "WARN: could not publish next/${SLUG} — claim is local-only (no cross-machine protection until /do:pr pushes)."
```

**Verify `pwd` is the worktree path**, not the main repo. If it printed the main repo path, the worktree creation or `cd` failed — STOP, report the error, do not proceed. **Re-anchor every later Bash call** with `cd "${WORKTREE}"` or absolute paths; working directory persists but a stray `cd` can drop you back at the main repo silently. **Stash both `WORKTREE` and `DEFAULT_BRANCH` for the later phases — and re-export them at the top of each subsequent Bash snippet.** Shell *variables* do NOT persist across separate Bash tool calls (only the working directory does), so `${DEFAULT_BRANCH}` and `${WORKTREE}` referenced in Phases 5/6/7 would otherwise expand empty (`git fetch origin ""` fails *after* you've already done the work). Either re-assign them literally at the start of each snippet, or recompute `DEFAULT_BRANCH` with the same git-native one-liner used above.

> **Claim exclusivity is best-effort by design — not a distributed lock.** The `ls-remote` pre-check + immediate push narrow the cross-machine race to the sub-second window between two machines that both pass the pre-check before either's push lands; in that window a plain `git push` of an identical-commit branch succeeds for both, so neither "wins" atomically. This is intentional and matches the issue-mode assignee marker (and PortOS's original design): the load-bearing protection is the in-flight branch/PR scan, the markers just shrink the window. slashdo is single-user/few-machines, so this is the right trade-off — true ref-CAS locking (e.g. a lock branch with `--force-with-lease`, or a server-side hook) is deliberately out of scope. If two of your machines genuinely race the same item sub-second, the duplicate surfaces at PR time (two PRs for one slug) and you close one.

### Phase 2 — mark the issue in progress (issues mode only)

Immediately after the worktree is verified, claim the issue **on the host** so a `/do:next --issues` on any other machine sees it as taken (Phase 1's assignee check is the reader). Do this before writing code — it's the cross-machine half of the claim:

```bash
ISSUE_NUM="<picked-issue-number>"; SLUG="issue-${ISSUE_NUM}"; WORKTREE="../next-${SLUG}"   # re-declare — shell vars don't cross snippets
# Load-bearing marker — if the assign itself FAILS (no triage/write access, API
# error), you have NOT claimed the issue. Abort immediately; do NOT fall through to
# the read-back, which would see zero assignees, take the `else` path, and proceed
# without a marker (letting a second machine work the same issue).
gh issue edit "$ISSUE_NUM" --add-assignee @me || {
  echo "Could not claim issue #$ISSUE_NUM (missing write access?) — aborting."
  # Phase 2 already created and (best-effort) pushed next/issue-<num>. Retract the
  # REMOTE claim here (works from the worktree); then STOP and run Phase 7 cleanup from
  # the MAIN repo to drop the local worktree + branch. (Do NOT try to remove the worktree
  # from inside it — `cd ..` here lands in the worktree's parent, not the main repo.)
  git push origin --delete "next/${SLUG}" 2>/dev/null || true
  exit 1   # then: cd <main repo>, git worktree remove --force "$WORKTREE", git branch -D "next/${SLUG}"
}

# Confirm exclusivity: --add-assignee is NOT a compare-and-swap — GitHub issues
# allow MULTIPLE assignees, so a sibling machine that picked the same issue in the
# race window can also add itself and keep going. Re-read the assignees; if anyone
# OTHER than you is now assigned, a sibling won the race — yield: release your marker
# and stop (re-run Phase 1 to pick the next issue).
ASSIGNEES="$(gh issue view "$ISSUE_NUM" --json assignees -q '[.assignees[].login] | join(",")')"
ME="$(gh api user -q .login)"
if printf '%s' "$ASSIGNEES" | tr ',' '\n' | grep -qvxF "$ME" ; then
  # A sibling won the race. Release the marker and STOP — do NOT add the label,
  # do NOT continue to Phase 3+. Run Phase 7 cleanup (remove the worktree + branch)
  # and re-run Phase 1 to pick the NEXT issue. This is a hard exit from the claim.
  echo "Issue #$ISSUE_NUM already claimed by: $ASSIGNEES — yielding."
  gh issue edit "$ISSUE_NUM" --remove-assignee @me 2>/dev/null || true
  # Retract the REMOTE claim branch here (works from the worktree) so the yielded issue
  # doesn't read as in-flight to the next picker; the local worktree + branch are dropped
  # by Phase 7 cleanup run from the MAIN repo (not from inside the worktree).
  git push origin --delete "next/${SLUG}" 2>/dev/null || true
  exit 1   # HARD STOP — do not fall through to the label step or Phase 3. Then run Phase 7
           # cleanup from the main repo (cd out, git worktree remove --force, git branch -D)
           # and re-run /do:next to pick the next issue.
else
  # Claim is exclusive (only you assigned) — mark in-progress for human visibility
  # and proceed to Phase 3.
  gh label create in-progress --color FFA500 --description "Claimed and being worked" 2>/dev/null || true
  gh issue edit "$ISSUE_NUM" --add-label in-progress 2>/dev/null || true
fi
```

**The race-detected branch is a hard stop, not a warning.** When the read-back shows another assignee, you have NOT claimed the issue — release your assignee, run Phase 7 cleanup to remove the worktree + branch you just created, and re-enter Phase 1 to pick the next eligible issue. Only the `else` branch (you are the sole assignee) proceeds to Phase 3.

The re-read narrows the race from "the whole implementation" to "the sub-second window between `--add-assignee` and the read-back" — still not a true distributed lock (two reads can interleave so both yield, or in a tie both proceed), but close to compare-and-swap and far tighter than a blind assign. The assignee is the marker; the label is convenience (`|| true` keeps a label failure from aborting). **If you must stop after this (worktree failed, or the read-back showed a sibling won), release the marker before stopping:** `gh issue edit "$ISSUE_NUM" --remove-assignee @me --remove-label in-progress 2>/dev/null || true` — so a half-claimed issue isn't stranded as permanently "taken."

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

**Claimed an `epic-wrapup` epic** (Phase 1 step 3)? The work unit is the epic's own remaining wrap-up tasks (its children are already closed). Do that work, then **tick the corresponding `- [ ]` boxes in the epic body** (`gh issue edit "$ISSUE_NUM" --body …`, or via the API) so the audit trail is accurate. The Phase 6 PR carries `Closes #<epic>`, so merging closes the now-fully-done epic — no separate close needed.

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
> # Re-declare — shell vars don't survive across Bash snippets (only cwd does):
> SLUG="<picked-slug>"; WORKTREE="../next-${SLUG}"
> DEFAULT_BRANCH="$(git -C "${WORKTREE}" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@' || true)"
> [ -n "$DEFAULT_BRANCH" ] || DEFAULT_BRANCH="$(git -C "${WORKTREE}" remote show origin | sed -n 's/.*HEAD branch: //p')"
> cd "${WORKTREE}" && git fetch origin "${DEFAULT_BRANCH}" && git merge --no-edit "origin/${DEFAULT_BRANCH}"
> ```
> **Conflict rule — deletions win.** Resolve any PLAN.md / changelog conflict so a line removed on *either* side stays removed; keep additions from both. Then `git add` and `git commit --no-edit`.

**Mark the work item done:**
- **PLAN.md mode** — **remove the picked `- [ ]` line outright** (the changelog and git history are the audit trail; don't leave a checked `- [x]` behind unless the repo keeps items as a design log). If removing it empties a heading, leave the heading — section curation is `/do:replan`'s job.
- **Issues mode** — **don't touch PLAN.md.** Close the issue via the PR: put `Closes #<num>` in the PR body (Phase 6) so merge auto-closes it.

**Changelog (both modes).** Check for `.changelogs/` or `.changelog/` (whichever exists); if found, append a user-facing entry to its `NEXT.md`, creating `NEXT.md` with just a `# Unreleased Changes` title if absent. **Group the entry under a `##` heading named for the feature or capability it touches** (e.g. `## PR review loop`) — reuse an existing feature heading if one fits; do NOT use generic `## Added` / `## Changed` / `## Fixed` / `## Removed` buckets. Lead the bullet with the slug in brackets; write for a *user* of the app, not a coder inside it (no file paths, module/function names, test counts). The one exception: purely internal code-administration/organization work with no user-visible effect goes under a `## Internal` heading and may be described in code terms. If no changelog directory exists, skip this step.

```markdown
## <Feature or capability name>
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

`/do:pr` already owns the entire review/ship pipeline — the required Local Code Review gate, `--review-with` multi-reviewer loop, `--review-iterations`, stop-modes, and `--reviewer-applies`. **Do not re-implement any of it here.** From inside the worktree, decide the review intensity, then invoke `/do:pr` with the flags this command received. **Always pass `--no-merge` to `/do:pr`** so it opens the PR but does not merge it — `/do:next` owns the merge decision (the gate below) plus its post-merge worktree/branch cleanup and `Closes #<num>` handling, and must stay in control even if the user has a global `/do:config --merge` default that would otherwise make `/do:pr` auto-merge out from under it:

> **A note on `/simplify`.** It's a quality-pass command in the slashdo ecosystem but **not part of a stock slashdo install** (slashdo ships only `/do:*`). Treat it as **optional**: run `/simplify` when your environment provides it; otherwise do the equivalent reuse/quality pass by hand (or skip it for a trivial diff). Never let a missing `/simplify` block the run — the load-bearing review is `/do:pr`'s gate plus any `--review-with` pass.

| The user passed… | Run |
|---|---|
| `--review-with=<agents>` | `/simplify` if available (skip when the diff is genuinely trivial), then `/do:pr --no-merge --review-with=<agents>` (pass through `--review-iterations` / `--review-mode` / stop-mode / `--reviewer-applies` verbatim) |
| `--no-review` | `/do:pr --no-merge` with no `--review-with` — its Local Code Review gate still fires; no external pass, no `/simplify` |
| neither | **Judge the diff.** New code paths / abstractions / multi-file work → `/simplify` (if available) then `/do:pr --no-merge --review-with=…` with a sensible reviewer. A value swap / typo / single-line fix → `/do:pr --no-merge` alone. State the call before acting. |

State any skip/trim and why ("Diff is 3 lines in one file; skipping the quality pass and external review — matches existing pattern"). `/do:pr` pushes `next/<slug>`, opens the PR (include `Closes #<num>` in issues mode), runs the chosen review loop, and reports the aggregate status.

**Gate the merge on the review result — do NOT merge unconditionally.** Two cases, by whether an external reviewer ran:

- **An external review ran** (`--review-with=<agents>`): `/do:pr`'s multi-reviewer loop reports an aggregate `OVERALL_STATUS`, and it explicitly leaves merge eligibility to the caller. **Never merge on `dirty` (build/test broken, or a hard-error short-circuit) or `inconclusive` (a requested reviewer was missing / timed out / errored / was skipped — you asked for that perspective and didn't get it).** Merge only when the status is `clean` (or `partial` *and* you explicitly passed a `--review-stop-on-*` flag — the only case where a short-circuited reviewer list is acceptable).
- **No external review ran** (`--no-review`, or a trivial diff where you ran `/do:pr` alone): there is no aggregate `OVERALL_STATUS` — `/do:pr` skipped the multi-reviewer loop. The merge bar is then simply that **`/do:pr`'s own Local Code Review gate passed** (it always runs) and the PR opened cleanly. That counts as merge-eligible; proceed.

On a non-mergeable external-review status (`dirty`/`inconclusive`), **stop and leave the PR open** for the user: report the status and the PR URL, do NOT run the merge below, and do NOT run Phase 7 cleanup (the worktree/branch must stay so the work can be finished). The whole point of `--review-with` is the gate; merging through a non-clean result silently defeats it.

**Encode the slug in the PR title** for grep-ability if `/do:pr` didn't: `gh pr edit <num> --title "feat([<slug>]): <description>"`.

**Re-sync, then merge (only when the gate above passed).** A long review loop can let sibling claims merge after your Phase-5 sync — re-sync once more so a stale PLAN.md can't resurrect their removed items at merge time:

```bash
# Re-declare — shell vars don't survive across Bash snippets (only cwd does):
SLUG="<picked-slug>"; WORKTREE="../next-${SLUG}"
DEFAULT_BRANCH="$(git -C "${WORKTREE}" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@' || true)"
[ -n "$DEFAULT_BRANCH" ] || DEFAULT_BRANCH="$(git -C "${WORKTREE}" remote show origin | sed -n 's/.*HEAD branch: //p')"
cd "${WORKTREE}" && git fetch origin "${DEFAULT_BRANCH}" && git merge --no-edit "origin/${DEFAULT_BRANCH}"
```

**If that merge reports a conflict** (unmerged PLAN.md / changelog paths — `git merge` exits non-zero and leaves `<<<<<<<` markers), **STOP and resolve it by hand** before going further: apply the deletions-win rule (a line removed on *either* side stays removed; keep additions from both), then `git add` the **specific resolved files** and `git commit --no-edit`. **Do NOT `git add -A`/`git add .` while paths are still unmerged** — that would stage raw conflict markers and push a broken tree. Only once `git status` shows no unmerged paths (a clean merge or "Already up to date" needs no commit at all) is it safe to push and merge:

```bash
git push
gh pr merge <num> --merge --delete-branch   # only reached when the review gate passed AND the tree is conflict-free
```

## Phase 7: Clean up

From the **main repo** (not the worktree), as a single Bash invocation, re-substituting the slug and worktree path stashed in Phase 2:

```bash
SLUG="<picked-slug>" && \
WORKTREE="../next-${SLUG}" && \
# Recompute the default branch (shell vars don't survive across snippets) and sync
# THAT branch explicitly — not "whatever HEAD happens to be". /do:next may have been
# launched from a feature branch in the main repo, in which case a bare `git pull`
# would update the wrong branch and leave the merged default stale.
DEFAULT_BRANCH="$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@' || true)" && \
DEFAULT_BRANCH="${DEFAULT_BRANCH:-$(git remote show origin | sed -n 's/.*HEAD branch: //p')}" && \
git worktree remove "${WORKTREE}" && \
git fetch origin "${DEFAULT_BRANCH}" && \
git checkout "${DEFAULT_BRANCH}" && \
git pull --rebase --autostash && \
git branch -d "next/${SLUG}" && \
{ git push origin --delete "next/${SLUG}" 2>/dev/null || true; }   # remote no-op after --delete-branch merge
```

(Order matters: remove the worktree, **sync the default branch, delete the local claim branch, and only THEN touch the remote** — every step is `&&`-gated so the chain short-circuits on the first failure. Three invariants hold: (1) a `git branch -d` failure ("not fully merged") can't skip the sync, because the sync already ran; (2) any earlier failure (worktree-remove, fetch, checkout, rebase conflict) stops the chain *before* the local delete, so the claim branch is never removed while the default branch is stale; and (3) **the remote-delete is the LAST link**, so a failed/partial cleanup — which may still hold unmerged work in the worktree — never retracts the remote claim and re-exposes the item to other machines. On the happy path `gh pr merge --delete-branch` already removed the remote branch, so the trailing delete is a harmless no-op.)

**Abandoned a claim (Phase 3 skip / Phase 3.5 reject — no PR, work discarded)?** The branch is unmerged, so `git branch -d` won't remove it. Retract the claim explicitly instead (force-delete local, delete remote) so the item returns to the queue: from the main repo, `git worktree remove --force "${WORKTREE}"; git branch -D "next/${SLUG}"; git push origin --delete "next/${SLUG}" 2>/dev/null || true`. (Issues-mode abort branches in Phase 2 already do this inline.)

**Issues mode — confirm closed, then clear the marker.** A `Closes #<num>` in the PR body auto-closes on merge to the **default branch**. Verify with `gh issue view <num> --json state -q .state` (expect `CLOSED`); if still `OPEN`, close explicitly: `gh issue close <num> --comment "Shipped in PR #<PR_NUM>."`. Then drop the stale label: `gh issue edit "$ISSUE_NUM" --remove-label in-progress 2>/dev/null || true`. (Leave the assignee — it records who shipped it; a closed issue is never a Phase 1 candidate anyway.)

**Issues mode — re-evaluate the parent epic (the shipped issue may have been an epic's last child).** Once the issue is confirmed closed, resolve its parent epic with the shared epic logic ("Resolving a child's parent epic" in [lib/epic-children.md](../../lib/epic-children.md), inlined in Phase 1). If a parent epic `#P` exists, re-classify it:
- `epic-done` (this was the last open child and `#P` has no remaining wrap-up tasks) → **close the epic** with an evidence comment: `gh issue close "$P" --comment "All children closed (incl. #<num>) — closing epic. (slashdo)"`.
- `epic-wrapup` (children all closed but wrap-up tasks remain) → **don't close**; comment so a later `/do:next` surfaces it: `gh issue comment "$P" --body "All child issues are now closed — only the epic's own wrap-up tasks remain."`.
- `epic-open` (other children still open) → leave it untouched.

This is the child-side half of epic closing; the auto-pick side (Phase 1 step 3) handles an epic encountered directly. Skip this step entirely when the shipped issue was *itself* an epic (its `Closes #<N>` already closed it).

Print a one-line summary:

```
# PLAN.md mode:
Shipped [<slug>] <Title>. PR #<num>. Worktree + branch cleaned.

# Issues mode:
Shipped issue #<num> "<Title>". PR #<PR_NUM>. Issue closed. Worktree + branch cleaned.
```

## Notes

- **Concurrency model.** The worry isn't strangers — it's *your own parallel agents* (a second tab, a scheduled job, **or `--swarm`'s own fan-out**) picking the same item. The branch+PR scan in Phase 1 catches both; issues mode's assignee marker extends the protection across machines. `--swarm` relies on this exact mechanism: each swarm agent claims its handed issue through the normal Phase 2 assignee marker + race read-back, so the same race protection that guards two tabs guards two swarm agents — the orchestrator's partition just makes a collision unlikely rather than relying on the lease alone.
- **Swarm is an orchestration layer, not a new claim path.** `--swarm` adds exactly two things over the single-issue flow: a partition step that picks `SWARM_N` independent issues up front, and a serialized merge queue at the end. Everything between — claim, worktree, implement, changelog, review gate — is the unchanged single-issue flow run once per agent. Keep it that way: never special-case a swarm agent's claim/ship logic, because divergence is how the lease protection rots. Cost scales ≈N×; correctness across the batch comes from the serialized, re-synced merges (deletions-win), not from trusting the agents not to overlap.
- **Empty pick is not a failure.** Everything in flight / drifted / NEEDS_INPUT (PLAN.md), or every open issue in flight / assigned / parking-labelled / blocked by an open dependency — or, when `--issues-label` is active, no open issue carrying that label (issues) — is a healthy queue — exit clean and say so.
- **Ordering issues mode (no new flags).** Auto-pick walks the queue **by priority then oldest-first**, with two opt-in, backward-compatible controls — neither changes behavior for a repo that uses neither:
  - **Hard dependencies — `Depends on #<N>` / `Blocked by #<N>` in the issue body** (or GitHub's native blocked-by relationship). Auto-pick **skips** an issue while any declared blocker is still OPEN and surfaces it automatically once the blocker closes (self-clearing — Phase 1 step 4). This encodes the real dependency DAG without hand-maintained sequence numbers; an explicit `#num` overrides it. Use this to guarantee a predecessor ships first instead of parking the successor by hand.
  - **Soft priority — a `priority:<N>` label** (lower N = earlier; unlabeled sorts last, `createdAt` breaks ties — Phase 1 step 1). Use this to sequence *independent, unblocked* issues. It only reorders the walk; it never gates.
  - Prefer `Depends on #N` for correctness ("Y needs X") and `priority:<N>` only for preference ("do these first"). Both are populated by humans or by `/do:replan` triage, never by `/do:next` itself.
- **`/do:next` only *consumes* the queue.** New work comes from `/do:replan`, `/do:better`, `/do:depfree`, or human edits — never invented here, except *discovered* work split out of the current item (Phase 4/6).
- **`--issues` resolves the same three ways on every slashdo command.** An explicit `--issues`/`--no-issues` on this run wins; otherwise the saved `issues` default (`/do:config --issues`, global or per-project `.slashdo.json`) applies; otherwise it's off. A repo that works issues-first can save the default once instead of passing `--issues` every time — and even without a saved default, the Phase 1 auto-redirect below covers the common case.
- **Auto-redirect makes `--issues` optional for issue-tracked repos.** When there's no PLAN.md, or PLAN.md is the stub `/do:replan --issues` leaves behind, a bare `/do:next` recognizes the repo is issue-tracked and continues in issue mode on its own (stating the switch). So a repo that ran `/do:replan --issues` once doesn't need every contributor to remember the flag — the stub *is* the config signal. Passing `--issues` explicitly still works and skips the detection.
- **Host support — GitHub only.** `/do:next` requires a GitHub repo with an authenticated `gh`, in **both** modes, and the Phase 1 pre-flight aborts up front otherwise. This is because it *ships* through `/do:pr` and `gh pr merge` (GitHub-only) — so even though PLAN.md *claiming* is pure git, the run can't complete on a non-GitHub host, and issue mode additionally depends on the GitHub assignee model for the cross-machine claim. GitLab support is a clean follow-up: it needs a host-agnostic ship path (a `/do:pr` that speaks `glab`) plus a tested `glab` assignee read-back for the claim marker — until both exist, aborting early is more honest than failing at the ship step after the work is done.
- **Auto-pick is label-agnostic by default — `--issues-label` opts into a curated queue.** Without a label filter, every open issue is claimable regardless of who filed it or what label it carries; the guards against claiming the wrong thing are the parking-label skip (`future`/`blocked`/`needs-input`/`wontfix`/`discussion`/repo-specific), the child-aware epic resolution (Phase 1 step 3 — `epic-open`/`epic-done` epics are skipped, an `epic-wrapup` epic is claimable wrap-up work), and the in-flight/assigned checks — not a required label. This is deliberately permissive so a repo that files normal `enhancement`/`bug`/`area:*` issues works with `/do:next --issues` out of the box, without first running `/do:replan --issues` to stamp a `plan` label on everything. To restrict auto-pick to a curated set, pass `--issues-label <name>` (or save it as a default) — e.g. drain only the `plan`-labelled items `/do:replan --issues` produced. Newly-filed discovered/queued work still gets the `plan` label (so a default run and a `--issues-label plan` run agree on it), and an explicit `#num` always overrides every skip — including parking labels and an active filter.
