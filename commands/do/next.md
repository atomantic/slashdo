---
description: Claim the next unclaimed PLAN.md item (or tracker issue with --issues) by its ID, do the work in an isolated worktree, ship a PR, and clean up — or, with --swarm, claim and ship several independent issues in parallel (auto-picked, or the exact issue numbers you name). Works on GitHub (gh) or GitLab (glab), including Enterprise/self-managed hosts — it ships via /do:pr.
argument-hint: "[<slug>|#<issue> …] [--issues|--no-issues] [--issues-label <name>] [--model <tier>[,…]] [--effort <level>[,…]] [--self|--no-self] [--swarm[=<N>]] [--plan] [--review-with <agent>[,…]] [--review-iterations <n>] [--review-mode <series|parallel>] [--review-stop-on-findings|--review-stop-on-clean] [--reviewer-applies] [--no-review]"
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

**Drain one item — or several at once (`--swarm`).** By default `/do:next` ships exactly one item per run. With `--swarm` (issues mode) it claims and ships **several independent open issues in parallel**, each in its own worktree subagent, and serializes only the merge — a throughput multiplier over running `/do:next` one item at a time. The batch is auto-picked off the queue (`/do:next --swarm`) or **exactly the issues you name** (`/do:next --swarm #12 #14 #15`), which is the natural follow-up to filing a set of issues with `/do:plan-task`. See **Swarm mode** below; the single-issue Phases 1–7 are unchanged when `--swarm` is absent.

## Parse Arguments

Split `$ARGUMENTS` on whitespace — tokens starting with `--` are flags, the remaining non-flag tokens are **targets**. Value flags accept either `--flag=value` or `--flag value` (consume the next token as the value, don't mistake it for a target). Order is free.

Collect targets into an ordered list `TARGETS` in three steps, **in this order**: **(1) expand** any token carrying a **comma-separated** run of issue numbers (`12,14,15`, `#12,#14`) into one target each; **(2) normalize** each target (strip any leading `#`); **(3) de-duplicate**, order preserved. Expanding before de-duplicating matters as much as normalizing does: `#12` and `12`, and a `12,14` run alongside a separate `14`, are the same target — not two batch members that would have two agents race for one issue. **One target** is the single item to claim (the cherry-pick described next). **Several targets** — issue numbers only — are an **explicit `--swarm` batch**; see the `--swarm` bullet. Several targets **without** `--swarm` is ambiguous, so claim nothing and say so — pick the message that matches what they named, so a slug list learns in one step that swarm can't batch it:
  - numeric targets: ``You named <n> issues, but /do:next ships one item per run — add --swarm to batch them in parallel, or name a single item.`` (Don't silently enable swarm: that's an ≈N× token bill the user didn't ask for.)
  - slug (PLAN.md) targets: ``You named <n> PLAN.md items, but /do:next ships one item per run — and --swarm works on issue numbers only. Name a single slug.``

- **`<slug>` / `#<issue>`** — claim THAT specific item instead of auto-picking (cherry-pick out of order). PLAN.md mode: a slug that must already exist as a `- [ ]` line (this command never *assigns* IDs — that's `/do:replan`'s job). Issues mode: an issue number, bare (`123`) or `#`-prefixed (`#123`, strip the `#`); must be open. An explicit number is a deliberate cherry-pick that **bypasses every auto-pick skip except the `--self` security boundary** — it can claim a parking-labelled issue (`future`/`blocked`/…), an epic (resolved per its children — see Phase 1 step 3), or, when a label filter is active, an issue outside that filter; state it when you do. The one exception is `--self`: an explicit number for an issue **another user filed is refused, not overridden** (see Phase 1 step 5 and the `--self` bullet below) — a security gate is not a curation preference.
- **`--issues`** / **`--no-issues`** — switch the source from PLAN.md to the **tracker**, or force PLAN.md mode. `--issues` sets `ISSUE_MODE=true`; `--no-issues` sets `ISSUE_MODE=false`. Setup (host detection, label, abort-if-unauthenticated) follows [lib/plan-issue-mode.md](../../lib/plan-issue-mode.md). In issue mode PLAN.md is never read or edited.
- **`--issues-label <name>`** — when set, **restricts auto-pick to issues carrying that label** (a curated queue, e.g. only the `plan`-labelled items `/do:replan --issues` produced). **Auto-pick is unfiltered by default** — without this flag it considers *all* open issues, gated only by the parking-label skip and the in-flight/assigned checks. The label is recorded as `PLAN_LABEL` (default `plan`); that default is still the label applied to issues this command *files* (discovered/queued work, Phase 4), but it only *filters* auto-pick when the flag (or a saved `issues-label` default) explicitly supplied it. Track whether a filter is active as `LABEL_FILTER` (set to the label only when explicitly provided; empty otherwise). Only meaningful in issue mode.
- **`--model <tier>[,…]`** / **`--effort <level>[,…]`** — **restrict auto-pick to issues carrying that dispatch hint** (see [lib/plan-issue-mode.md](../../lib/plan-issue-mode.md) "The dispatch hint"). `<tier>` ∈ `light` / `medium` / `heavy`; `<level>` ∈ `low` / `medium` / `high` / `xhigh` / `max`. Record them as `MODEL_FILTER` / `EFFORT_FILTER` (empty when absent). Reject an unknown value with `--model must be one of light, medium, heavy, none (got: {value}).` / `--effort must be one of low, medium, high, xhigh, max, none (got: {value}).`
  - **Comma-list is OR *within* an axis; the two axes AND *across*.** `--model light,medium --effort low` claims work that is (light **or** medium) **and** low. Each flag is single-use — a repeated `--model` is an error (`--model given twice — pass one comma-separated list.`), not an implicit union, so a typo can't silently widen the queue.
  - **The sentinel `none`** matches an issue carrying **no** label on that axis, so `--model light,none` reads "light work, or work nobody has tiered yet" — the flag you want on a tracker that is only partly labelled. Bare `--model light` **excludes untiered issues**, exactly as `--issues-label` excludes unlabelled ones; that's a filter doing its job, but it's the reason an all-untiered tracker comes back empty (say so in the "no eligible issue" message rather than reporting a bare empty queue).
  - **Filtering is not dispatching.** These flags choose *which* issues are eligible; what a swarm worker actually runs on is the claimed issue's own `model:`/`effort:` labels (Swarm Phase B). The two coincide whenever you filter — filtering to `light` yields `light`-labelled issues — but `--model heavy` never *upgrades* an issue, and neither flag changes the model of the session you typed it in.
  - **Issues mode only** (PLAN.md lines carry no labels) — state the skip and continue if both are in play. **Advisory, like `--issues-label`, not a security boundary like `--self`:** an explicit `#<num>` overrides both filters (see Phase 1 step 5), and an issue with no dispatch hint is never *unclaimable*, just filtered out of this particular walk.
- **`--self`** / **`--no-self`** — **security gate: restrict issue work to issues YOU filed.** `--self` sets `SELF_MODE=true`; `--no-self` sets `SELF_MODE=false`. When `SELF_MODE` is on, `/do:next` only ever claims an open issue whose **author is the authenticated user** (`@me` — the `gh`/host account running the command), and **never considers an issue filed by anyone else** — auto-pick filters them out and an explicit `#<num>` for someone else's issue is **refused, not overridden** (see Phase 1). The point is to avoid acting on instructions/work embedded in a third party's issue: in `--self` mode the author filter is a hard boundary that even an explicit number cannot cross. **Issues mode only** — PLAN.md items carry no author, so `--self` is a no-op there (state the skip if both are in play). Resolve `SELF_MODE` from the flag, else the saved `self` default (per-project `.slashdo.json` over global `~/.claude/.slashdo-config.json`, same precedence as `issues`), else built-in default `false`. A typed `--self`/`--no-self` on the run wins over the saved default.
- **Saved defaults.** If the user passed **neither** `--issues` nor `--no-issues`, resolve `ISSUE_MODE` from the saved `issues` default — per-project `.slashdo.json` overrides the global `~/.claude/.slashdo-config.json` (the precedence is the one in [lib/review-config-defaults.md](../../lib/review-config-defaults.md)), built-in default `false`. Likewise take `PLAN_LABEL` from the saved `issues-label` default when `--issues-label` is absent — and a saved `issues-label` default counts as an explicit choice, so it sets `LABEL_FILTER` (activating the curated-queue filter) exactly as the flag would. With neither flag nor saved default, `LABEL_FILTER` stays empty and auto-pick is label-agnostic. Likewise resolve `SELF_MODE` from the saved `self` default when neither `--self` nor `--no-self` was typed (built-in default `false`). (Only resolve `issues` / `issues-label` / `self` here — the review flags are passed through to `/do:pr`, which resolves *its* defaults itself; don't pre-resolve them.) **`--model` / `--effort` have no saved default by design** — they narrow the queue, and a forgotten saved narrowing is indistinguishable from an empty backlog. They apply only when typed on the run. The Phase 1 auto-redirect still applies independently: a repo with no PLAN.md / the issue-mode stub switches to issue mode even when no default is saved (or when a saved `issues=false` would otherwise pick PLAN.md mode — there's simply no PLAN.md backlog to read). The one exception is an **explicit** `--no-issues` on the command line, which wins over the redirect per the usual "typed flag wins" rule (see Phase 1).
- **`--swarm` / `--swarm=<N>`** — drain **several independent issues in parallel** instead of one, either **auto-picked** off the queue or **exactly the issue numbers you name**. Records `SWARM=true`. **Issues mode only**, and it short-circuits the single-issue Phases 1–7 into the **Swarm mode** flow below — see there for the preconditions and the partition → fan-out → serialized-merge pipeline. Ignored (with a note) when only one issue is eligible / named. Review flags below are passed through to each swarm agent's `/do:pr` exactly as in the single-issue flow.
  - **Batch membership.** With **no target**, swarm auto-picks the first `SWARM_N` independent eligible issues (Phase A). With **two or more targets** (`--swarm #12 #14 #15`, `--swarm 12,14,15`), that list **is** the batch, in the order given — a deliberate cherry-pick, so it bypasses the auto-pick skips exactly as a single explicit `#<num>` does (see Phase A). With **one target** (`--swarm #12`), run the normal single-issue flow and say so — a one-agent swarm is just `/do:next #12` with overhead.
  - **Concurrency (`SWARM_N`).** Bare `--swarm` resolves `SWARM_N=3` in **both** cases (auto-pick and an explicit list — a bare flag never silently raises the concurrency just because you named more issues); `--swarm=<N>` sets it, **clamped to `1..6`** (state the clamp if the user asked for more). A batch bigger than `SWARM_N` runs in **waves** of `SWARM_N` — every named issue still ships, just not all at once (Phase B).
  - **Count vs. target disambiguation.** `--swarm=<N>` (attached form) is always the count. The space-separated `--swarm <N>` form consumes the next token as the count **only when** that token is a bare integer **in `1..6`** with no `#` or comma **and** it is the *only* target token — so `--swarm 3` is three agents (unchanged), while `--swarm #12 #14`, `--swarm 12,14`, and `--swarm 12 14` are all two-issue batches, and `--swarm 12` is **issue 12** (a lone bare integer above 6 is far likelier an issue number than a request for 12 agents — and reading it as a clamped count would claim six issues the user never named). Say which reading you took, and note that `--swarm=12` is how you'd ask for a count that gets clamped.
- **`--plan`** — before writing code, enter an **interactive plan-mode session** (Phase 3.5): present a written plan, surface open questions, get explicit approval before implementing. Runs *after* the worktree is claimed so you plan with full context. Rejection routes to Phase 7 cleanup exactly like a Phase 3 skip. **Ignored in `--swarm` mode when more than one issue actually runs** (parallel agents can't each hold an interactive plan session; state the skip). When swarm degenerates to the single-issue flow — one target, one surviving named issue, or one eligible issue — `--plan` is honored as normal: there's only one agent, so there's nothing to skip it for.
- **`--review-with` / `--review-iterations` / `--review-mode` / `--review-stop-on-findings` / `--review-stop-on-clean` / `--reviewer-applies` / `--no-review`** — **passed through to `/do:pr`** in Phase 6, which owns the review/ship machinery. (`--review-mode series|parallel` selects how `/do:pr`'s multi-reviewer loop dispatches the reviewers; series is the default.) Same grammar as every other slashdo command (see `/do:pr`). `--no-review` opts out of both `/simplify` and the external pass. When neither `--review-with` nor `--no-review` is given, you decide in Phase 6 whether the diff warrants `/simplify` and/or an external review (a value swap doesn't; a multi-file change does).

## Swarm mode (`--swarm`) — drain several independent issues in parallel

**When `SWARM` is true, this section replaces Phases 1–7 for the run.** It claims and ships up to `SWARM_N` independent open issues at once — each in its own worktree subagent running the normal single-issue flow — then serializes only the merge. When `--swarm` is absent, skip this section entirely and run Phases 1–7 below. Swarm reuses the single-issue phases wholesale: each agent runs the single-issue **Phases 2–6** for one issue (claim → implement → changelog → review, **no merge, no Phase 7 cleanup** — the orchestrator owns those), so the claim/lease, worktree, implement, changelog, and review-gate semantics are exactly the single-issue ones. The only new logic is partitioning the batch up front (Phase A) and serializing the merges at the end (Phase C).

**Preconditions — check first; abort cleanly if any fails (do not partially claim):**
- **Issues mode only.** Swarm's claim/lease is the tracker's issue-assignee marker (GitHub or GitLab), and partitioning by dependency needs the tracker. **Resolve `ISSUE_MODE` here first, including Phase 1's auto-redirect** — because swarm replaces Phases 1–7, that redirect won't fire on its own: if `--issues`/a saved default didn't already set it, apply the same structural check Phase 1 does — a repo with **no PLAN.md, or only the issue-mode stub**, *is* issue-tracked, so set `ISSUE_MODE=true` (state the switch). **An explicit numeric target settles this too** — issue numbers are inherently tracker references, so **any** numeric target (one or several) sets `ISSUE_MODE=true` (state the switch) even in a repo with a real PLAN.md backlog — **unless the user explicitly typed `--no-issues`**, which wins per this file's usual typed-flag-beats-inference rule and routes straight to the abort below. One target matters as much as several here: a lone `#12` hands off to the single-issue Phases 1–7, which must run in *issues* mode or Phase 1 would go looking for a PLAN.md slug named `12`. Abort when it still resolves to PLAN.md mode — a real PLAN.md backlog with either (no `--issues` and no numeric targets) or an explicit `--no-issues`: ``--swarm works in issues mode only — pass --issues (or run in an issue-tracked repo). PLAN.md-mode swarm is a future enhancement.``
- **GitHub or GitLab, with the matching CLI authenticated** — the same Phase 1 pre-flight (it ships through `/do:pr`, which supports both).
- **A subagent-capable harness.** Swarm fans out parallel agents via the harness's subagent mechanism (Claude Code's `Agent`/Task tool, or the equivalent). **If the environment cannot spawn parallel subagents, fall back to sequential** — run Phase B's per-issue task (Phases 2–6, **no merge**) for each partitioned issue one after another in this same session, then proceed to Phase C so the merge stays owned by the serialized queue, not each iteration (still useful: it drains `SWARM_N` items in one invocation, just not concurrently). State that you're doing so.
- **Targets are optional — and may be an explicit list.** **Check target *shape* first, before mode resolution or any claim:** every target must be an **issue number** (bare or `#`-prefixed), because a PLAN.md slug can never be a swarm member — abort on one, and let this abort win over the issues-mode abort above so the message names the real problem: ``--swarm works on issue numbers only — "<slug>" looks like a PLAN.md item. Drop --swarm to claim it, or pass issue numbers.`` Then route by count: **no target** → Phase A auto-picks the batch; **two or more** → that list IS the batch (Phase A's explicit-list path; the same `#<num>` cherry-pick semantics, `SWARM_N` at a time); **exactly one** → this isn't a swarm: run the single-issue **Phases 1–7** for it (in issues mode, per the bullet above) and say so.

**Concurrency & cost.** `SWARM_N` parallel agents multiply token spend roughly N×. State the resolved N and that implication up front (e.g. `launching 3 parallel agents — ≈3× the tokens of a single /do:next`). The `1..6` clamp (Parse Arguments) is deliberate: beyond ~6 concurrent worktrees/PRs, git-index-lock contention and merge-queue churn outweigh the throughput gain. **`SWARM_N` caps concurrency, not batch size** — an explicit list of 9 issues costs ≈9× regardless of how many waves it takes, so state the total (`9 issues named — ≈9× the tokens, 3 at a time`) and let the user cut the list if that's more than they meant: **for a named list of more than 8 members, stop and confirm before launching wave 1** — print the total cost and the wave plan, and proceed only on an explicit go-ahead. Below that threshold, state the cost and continue. (If the caller genuinely can't be asked — a non-interactive/subagent context — proceed, but log the total prominently rather than burying it.)

### Swarm Phase A — Triage & partition (orchestrator, in the main repo)

**Two paths in.** With **no target**, run **A1–A2** (auto-pick). With an **explicit list of two or more issue numbers**, skip the picker and run **A1e–A2e** instead. Both paths converge on **A3** and hand Phase B an ordered batch, split into waves of at most `SWARM_N`.

1. **A1 — Build the eligible queue** exactly as **Phase 1 — issues mode** below: the priority-then-oldest walk with EVERY skip applied (in-flight, already-assigned, parking-labelled, `epic-open`/`epic-done` epics, blocked-by an open declared dependency), the **dispatch-hint filter** when `MODEL_FILTER`/`EFFORT_FILTER` is active (so `/do:next --swarm --model light` drains a wave of cheap work), and — **when `SELF_MODE` is on** — the `--author "@me"` filter so the batch only ever contains issues you filed (same security boundary as the single-issue flow). An `epic-wrapup` epic is eligible like any issue. Reuse that logic verbatim — do not invent a second picker.
2. **A2 — Select the first `SWARM_N` *independent* eligible issues** off the top of that ordered queue:
   - **Intra-batch dependency.** If a candidate declares `Depends on #N` / `Blocked by #N` (or native blocked-by) on **another candidate in the batch**, keep only the predecessor this round — the successor self-clears and is picked next run once the predecessor merges. (Blockers *outside* the batch were already handled by the Phase 1 skip.)
   - **File-overlap avoidance (best-effort).** From each issue's title/body, predict the rough files/paths/components it touches. When two candidates obviously target the same file(s), keep the higher-priority one and skip the other **this round** — not for correctness (the serialized merge + re-sync handles that) but to avoid two agents thrashing or duplicating the same file. This is a cheap heuristic, not a guarantee; note when you apply it.
   - **Under-fill is fine.** If fewer than `SWARM_N` independent issues exist, run the swarm at the smaller size and say so. **If only one is eligible, run the normal single-issue flow instead** (Phases 1–7) and say so — a one-agent swarm is just `/do:next` with overhead.

   Auto-pick never selects more than `SWARM_N`, so it always yields exactly **one wave**.

**A1e — Vet each named issue; no picker, no substitutions.** The list is a deliberate cherry-pick, so it **bypasses the auto-pick skips exactly as a single explicit `#<num>` does**: parking labels (`future`/`blocked`/`discussion`/…), an active `LABEL_FILTER`, an active `MODEL_FILTER`/`EFFORT_FILTER`, and an open declared blocker that was **never named in the list** are all overridden — state each override as you apply it (e.g. `claiming future-labelled #123 by explicit request`). A named member still keeps its own dispatch hint for Phase B: overriding the *filter* selects the issue, it does not restate what the issue needs. **A blocker that *was* named and is then removed from the batch while still OPEN is a different case** — removed as in-flight/already-assigned, removed by *this very rule* as a hold, or removed by A2e as part of an unorderable dependency cycle: it still blocks its dependent, so **hold that dependent here, before A2e orders anything** — drop it from the batch with a note (`#21 held: depends on #17, which is claimed elsewhere and won't merge this run`) and carry it into Phase D's summary as `held`. **Apply this rule repeatedly until no new holds appear** — a member you just held is itself a still-open removed blocker, so a chain (`#23` depends on `#21` depends on `#17`) must hold `#21` **and** `#23`, never just the first link. If A2e later drops cycle members, re-run this hold pass over what remains and re-apply the survivor routing before ordering waves. Don't defer any of this to Phase B's wave rule: A2e only defers a member behind *another surviving member*, so a removed blocker produces no deferral for that rule to act on, and the dependent would otherwise launch in wave 1 anyway. Holding here also matters because of what comes next — if the hold leaves a single survivor, the single-issue hand-off below would claim it through Phase 1 step 5's explicit-`#num` path, which *overrides* the open-blocker skip (`claiming #21 despite open blocker #17 by explicit request`) — the exact opposite of the hold. **Count survivors *after* these holds** when applying the "nothing survives / exactly one survives" rules below. A blocker dropped because it is **closed or doesn't exist doesn't block at all** (Phase 1 step 4), so its dependent runs normally — never hold work behind a dependency that's already satisfied. Do still check each named issue, in this order:
   - **`--self` is the one gate a list cannot cross.** When `SELF_MODE` is on, verify every named issue's author is the running account (the same check as Phase 1 step 5) — an issue that **doesn't exist or can't be read** falls through to the drop rule below rather than the refusal, so a typo'd number is a skip, not a bogus "filed by someone else". Refuse the whole run only when a real issue resolves to another author: ``Issue #<num> was filed by <author>, not you — /do:next --self only works on issues you filed. Drop --self, or drop #<num> from the list.`` Don't quietly drop it and swarm the rest — a silently shrunk batch hides a refused security gate.
   - **Closed, or no such issue → drop with a note** (`#<num>: already closed — skipping`).
   - **In flight or already assigned → drop with a note** (`#<num>: already claimed (branch/assignee) — skipping`). **Never substitute another issue for a dropped one** — the user named these; auto-pick is not in play.
   - **Epic → resolve with Phase 1 step 3** and act on the state: an `epic-wrapup` joins the batch like any issue; an `epic-done` is closed inline and dropped from the batch; an `epic-open` joins the batch only as an explicit override (say that children are still open).
   - **Nothing survives → stop** and list why per issue. **Exactly one survives → run the single-issue flow** (Phases 1–7) for it and say so.
**A2e — Order the batch and split it into waves.** Keep the **user's order** as the *default* sequence — a named list is a stated preference, so never re-sort it by priority. The two placement constraints below **outrank that order**: sort the members topologically with respect to intra-list dependencies first (a predecessor always precedes its dependent, even when the user named the dependent first), using the user's order only to break ties. Then:
   - **Intra-list dependency ⇒ a later wave, not a drop.** If a member declares `Depends on #N` / `Blocked by #N` (or native blocked-by) on **another member**, place the dependent in a **later wave than its predecessor** instead of dropping it: Phase C merges each wave before the next one starts, so the dependency is satisfied by the time the successor's agent branches. A true cycle among members can't be ordered — drop those members with a note so a human can break it, then **re-run A1e's hold pass** over what remains: a dropped cycle member is a still-open removed blocker for anything that depends on it.
   - **File-overlap ⇒ a later wave, not a drop.** Same best-effort title/body prediction as A2, but for a named list the remedy is separation in time rather than exclusion: put members that obviously touch the same file(s) in different waves, and note it.
   - **Chunk into waves of at most `SWARM_N`,** preserving that (dependency-topological, else user) order **and the two placement constraints above** — which outrank both the chunk size and the stated order: a member deferred behind a predecessor or an overlap peer must land in a **strictly later** wave than it, so a wave may come out smaller than `SWARM_N`. Only when **nothing was deferred** and the batch that **survived A1e** is `<= SWARM_N` is this a single wave (the common case) — count survivors, not named targets, since A1e may have dropped some. State the plan up front: `9 issues survived vetting, 3 at a time — 3 waves (≈3× the tokens of a single /do:next per wave)`.
**A3 — Do NOT claim here (both paths).** Each issue is claimed *inside* its own subagent so the assignee-marker + race read-back runs per issue, atomically. The orchestrator only hands each agent one specific issue number.

### Swarm Phase B — Fan out (one subagent per issue)

Launch the current wave's agents **in parallel** (all Agent/Task calls in a single response) and wait for all to return.

**Apply each issue's dispatch hint to its own agent.** Read `model:<tier>` / `effort:<level>` off the issue you're about to hand out and configure that agent from it. **A1's auto-pick queue already carries `labels` (its issue-list call requests them); A1e's explicit-list path does not** — it vets each named issue individually — so for a named batch, fetch them per issue before dispatching rather than assuming they're in hand: GitHub `gh issue view <num> --json labels -q '[.labels[].name]'`; GitLab `glab issue view <num> --output json --jq '.labels'` (labels already come back as a flat string array, no `.name` needed). Skipping that is how a named swarm silently runs every worker at the session default despite A1e promising each member keeps its own hint — this is the payoff for the labels, and it's why a mixed batch shouldn't cost one flat rate per agent.

**The labels name tiers, not models — resolve each against the host you're running on** using the shared rules in [lib/model-tiers.md](../../lib/model-tiers.md): `light` → this host's cheapest capable coding model, `medium` → its workhorse, `heavy` → **its strongest available model, named by alias** (`model: "opus"` on Claude Code — an alias, never a pinned version ID), and `effort:<level>` → **advisory**: it tells the worker how careful this issue needs to be, and you **may** additionally set the sub-agent's reasoning-effort control from it (clamped to the host's nearest level) where the dispatch API has one — Claude Code's `Agent` tool does not, so pass the level in the worker's brief instead and let it run at session effort. An issue missing either label inherits the session's setting for that axis. That file also carries the two consequences that matter here:

- **`model:heavy` reaches up, not just sideways** — it names this host's strongest alias, so a `heavy` issue runs on the strongest model even when the orchestrating session is mid-tier. That is the point of the tier: `heavy` marks work where a weaker model produces confident wrong answers. If the dispatch is rejected for lack of entitlement to that tier, retry that agent once with `model` omitted (inherit), note the degrade, and proceed. A stale advisory label must never block a swarm.
- **Degrade, never abort.** If this host can't set a per-agent model or effort (or can't spawn sub-agents at all — see the precondition), run each agent at the session default and report the hint in the Phase D summary instead. Dispatch is an optimization; the swarm is the feature.

Two things this is **not**: it is not the `--model`/`--effort` *filter* (that chose the batch; this runs it), and it is not `--review-models` (that pins each *reviewer*, and passes through to `/do:pr` untouched — a worker's own model has no bearing on who reviews its PR).

Give each subagent exactly one issue number and this task:

> Run the `/do:next` single-issue flow for issue **#`<num>`** — the **Phase 1 explicit-`#<num>` path** (for validation + variable setup) followed by **Phases 2 through 6 only** — in your own sibling worktree, with these adjustments:
> - **Validate & set up via Phase 1's explicit-number path first:** run Phase 1's `#<num>` branch to confirm the issue is open and not in flight, resolve it if it's an epic, and set `ISSUE_NUM=<num>` / `SLUG=issue-<num>` — Phase 2's worktree/branch and every later `gh issue`/`glab issue` call depend on those variables. (Skip the auto-pick walk; the orchestrator already vetted this issue in Phase A, and an explicit number deliberately bypasses the auto-pick skips.) **Map this validation's failures to the structured result instead of the explicit-path's normal print-and-stop:** if it fails because the issue is now **in flight or already assigned** (a sibling `/do:next` claimed it between Phase A and now — a lost race, not an error), return `{ issue, status: "yielded" }`; if it fails because the issue is **closed or no longer exists**, return `{ issue, status: "skipped", reason }`. Either way, do NOT pick a different issue.
> - **Then claim via that same explicit-number path:** it performs the Phase 2 worktree creation + assignee-marker claim with the race read-back. If the read-back shows a sibling won the race, **yield** (release the marker, retract the claim branch, clean up your worktree) and return `{ issue, status: "yielded" }` — do NOT pick a different issue.
> - **Phase 3 still applies:** if the issue is stale/superseded/awaiting-input, skip it (release the marker, clean up) and return `{ issue, status: "skipped", reason }`.
> - Implement (Phase 4) and record completion + changelog (Phase 5) as normal.
> - **Ship via `/do:pr --no-merge`** with the run's review flags (Phase 6) and **STOP before the merge** — open the PR, run the review gate, but DO NOT merge and DO NOT run Phase 7 cleanup. The orchestrator owns the merge and the cleanup.
> - **Wait on external reviewers/CI ACTIVELY — never end your turn to "wait for a notification."** You are a subagent: if you stop while a background reviewer (`codex review`, `claude -p`, `agy`) or a CI watch is still running, your run is over — completion notifications are not guaranteed to reach a stopped subagent, and the orchestrator will read your premature last words as your final result while the reviewer's findings are lost. Wait with bounded blocking-chunk foreground Bash calls, each safely under the host's ~10-minute foreground cap, repeated until the reviewer's done-marker exists (the local-agent review loop's `$DONE_FILE` pattern): `for i in $(seq 1 55); do [ -f "$DONE_FILE" ] && break; sleep 10; done` — then immediately issue the same call again if it's still running. End your turn only to return the structured result below.
> - **Return a structured result**, one of two shapes Phase C dispatches on by whether `pr_number` is present:
>   - **PR opened:** `{ issue, pr_number, branch, worktree, review_status, notes }`, where `review_status` is `/do:pr`'s aggregate (`clean` / `partial` / `inconclusive` / `dirty`) or `opened-no-review` when no external reviewer ran and the Local Code Review gate passed.
>   - **No PR** (claim yielded to a race winner, or Phase 3 skipped it as stale): `{ issue, status: "yielded" | "skipped", reason }` — no `pr_number`.

Pass each agent the review flags verbatim (`--review-with` / `--review-iterations` / `--review-mode` / stop-mode / `--reviewer-applies` / `--no-review`). **Also pass the orchestrator's resolved self decision as an explicit `--self` or `--no-self`** so each worker honors *this run's* mode instead of re-resolving the saved `self` default. This matters because the worker runs a fresh `/do:next #<num>` whose Phase 1 would otherwise re-read the saved default: with a saved `self=true` and a per-run `--no-self`, Phase A correctly selected third-party issues but a worker re-resolving `self=true` would refuse them at the explicit-#num gate. Passing the typed flag makes the worker's gate use the orchestrator's mode (typed wins over saved default) — a redundant re-check when `--self` is on (Phase A already filtered the batch to your issues) and correctly any-author when `--no-self`. The **fix regression guard** and **CI flake handling** apply inside each agent automatically (they live in `/do:pr`'s loop and merge gate). Concurrent `git worktree add` against the shared repo can briefly contend on `.git` index locks — an agent that hits a transient lock retries once before failing.

**Harness without parallel subagents?** Per the precondition, run this same per-issue task **sequentially** in the current session — one issue at a time, identical task body — collecting each result, then proceed to Phase C unchanged. The merge queue is already serialized, so sequential fan-out only loses the concurrency, not any correctness. **The dispatch hints degrade to reports here**, exactly as in the single-issue flow (Phase 1 step 6): there's no fresh agent to configure, so note each issue's hint and run in the current session.

**Multi-wave batches (any batch A2e split into more than one wave).** Run **B → C once per wave, in wave order** — merge wave *K*'s PRs before launching wave *K+1*, so the next wave's agents branch off a default branch that already carries the previous wave's merged work. That ordering is what makes A2e's deferral correct: a member deferred for a dependency or a file overlap starts from a base that already contains what it was waiting on, so it needs no re-sync gymnastics. Phase D runs **once, after the last wave**, over the accumulated results. Re-state progress between waves (`wave 2/3 — #17 #21 #23`). If a wave leaves an issue **unmerged for ANY reason** — PR left open (unmergeable or review gate unsatisfied), agent `yielded`, Phase 3 `skipped` it as stale, or the agent never returned (Phase D reconciles it, but not until after the last wave) — continue to the next wave anyway, but **hold back any later member A2e deferred behind that issue**: its declared blocker is genuinely still open, so skip it with a note (`#21 held: depends on #17, which did not merge this run`), exactly as Phase 1's blocked-by skip would. Gate the hold on *not merged*, never on *PR left open* — a yielded or dead-agent predecessor leaves the dependent just as unsupported as an open PR does. Members deferred only for file overlap still run.

### Swarm Phase C — Serialized merge queue (orchestrator)

After the barrier, merge the wave's returned PRs **one at a time, never concurrently** — each merge advances the default branch, so the next PR may need a re-sync. Walk the results in the batch's own order: priority/oldest for an auto-picked batch, the **user's order** for an explicit list (A2e). For each:

1. **Skip non-mergeable results.** A result with `status: "yielded"`/`"skipped"` (no `pr_number`) has nothing to merge — record it. For the rest, apply **single-issue Phase 6's merge gate** to `review_status`: never merge `dirty` (build/test broken) or `inconclusive` (a requested reviewer missing/timed-out/errored) — leave that PR open and record why; merge only `clean`, `opened-no-review` (Local gate passed, no external reviewer requested), or `partial` **with** an explicit `--review-stop-on-*` flag. (Agents that never returned are reconciled in Phase D, not here.)
2. **Re-sync onto the advanced default branch** from the PR's worktree — `git fetch origin <default>` then `git merge --no-edit origin/<default>` — resolving any PLAN.md/changelog conflict **deletions-win** (a line removed on either side stays removed; keep additions from both). If the merge **can't be resolved cleanly**, leave that PR open, record it for human follow-up, and move to the next — **never force it**.
3. **Gate on required CI, then merge.** Because each swarm agent opened its PR with `/do:pr --no-merge`, `/do:pr`'s own CI merge gate never ran — and the re-sync in step 2 just pushed a new SHA whose checks are pending — so the orchestrator must run the CI gate here, exactly as the single-issue Phase 6 / `/do:pr` merge does, before merging. Push the re-synced SHA, wait for CI, and only then merge; on a check failure apply **CI flake handling** (one re-run on the same commit; flake → proceed, real → leave that PR open, record it, and move to the next — see `~/.claude/lib/ci-flake-handling.md`).
   - GitHub (`gh`) — scope the watch to **required** checks only so an optional/non-required job can't block a merge branch protection would allow (vacuously satisfied when no required checks exist):
     ```bash
     git -C "<worktree>" push
     # &&, not three separate lines: `--fail-fast` makes `gh pr checks` exit non-zero on
     # a failing required check, but an unchained next line merges anyway — which is the
     # opposite of what this step's own prose promises. Chain it so a red gate stops here.
     gh pr checks <pr_number> --required --watch --fail-fast && \
       gh pr merge <pr_number> --merge
     # Delete the head branch ONLY once the PR really reads MERGED.
     if [ "$(gh pr view <pr_number> --json state -q .state)" = "MERGED" ]; then
       if ! git push origin --delete "<branch>"; then
         # rc 2 means "no such ref" — already gone, which is success. Any other rc is
         # a transport/auth failure that proves nothing about the branch.
         git ls-remote --exit-code --heads origin "<branch>" >/dev/null 2>&1; RC=$?
         [ "$RC" -eq 2 ] || echo "ERROR: could not confirm <branch> is gone (ls-remote rc=$RC) — record this PR for follow-up"
       fi
     else
       echo "PR <pr_number> is not MERGED — keeping <branch>"
     fi
     ```
     **No `--delete-branch`** — it deletes the *local* branch too, and `<branch>` (the `branch` field the worker returned, normally `next/issue-<num>`) is checked out in the agent's worktree, so git refuses (`cannot delete branch 'next/issue-<num>' used by worktree at …`) and **`gh` exits non-zero after the merge already succeeded**. That reads as a merge failure and fires any `||` fallback wrapped around the merge. Delete the remote branch with the explicit `git push origin --delete` above — it needs no local checkout — and let Phase D remove the worktree and the local branch from the main repo, where that works. **The `MERGED` read-back is load-bearing**: `--delete-branch` only ever deleted the head branch *because* the merge had happened, and an ungated delete would retract the head of a PR that is still open — either the merge failed (unmergeable, branch protection, a lost race) or, on a repo with a **merge queue**, `gh pr merge` returned success having merely *queued* it. GitHub auto-closes a PR whose head branch disappears, which destroys both the "leave that PR open, record it, and move to the next" outcome step 3 requires and the queued merge itself. Read the state back rather than trusting the merge command's exit status.
   - GitLab (`glab`) — there's no discrete "required checks" list to scope to; the project's own merge/pipeline-success requirement governs, so wait on the pipeline explicitly and merge only then:
     ```bash
     git -C "<worktree>" push
     glab ci status --wait && glab mr merge <pr_number> --yes --remove-source-branch
     # Read the state back for the same reason the gh path does: --auto-merge returns
     # while the MR is still queued behind the pipeline, and step 4 gates issue closure
     # on this answer.
     if [ "$(glab mr view <pr_number> --output json --jq .state)" = "merged" ]; then
       echo "MR <pr_number> merged"
     else
       echo "MR <pr_number> is not merged (queued on the pipeline) — leaving its issue open and keeping <branch>"
     fi
     ```
**Why `glab ci status --wait` and not `--auto-merge`:** `--auto-merge` does not wait — it sets merge-when-pipeline-succeeds server-side and returns while the MR is still `opened`. The read-back above would then be `opened` on every run, so step 4 would never close an issue and Phase D would never reclaim a worktree: the guard against closing unlanded work would become a guard against closing anything. Waiting first makes one read authoritative. If you must use `--auto-merge` (a very long pipeline, say), replace the single read with a bounded poll of `glab mr view <pr_number> --output json --jq .state` and treat "still `opened` at the deadline" as queued, not merged.
4. **Close out the issue — only when step 3 read back `MERGED`.** A PR the merge left open or queued has shipped nothing, so closing its issue would drop live work out of the queue: record it as left-open with the reason instead, and let Phase D keep its worktree and branch. For a genuinely merged PR, apply single-issue Phase 7's closure step: confirm `Closes #<num>` auto-closed it on merge to the default branch; if still open, close it explicitly (GitHub: `gh issue close <num> --comment "Shipped in PR #<pr_number>."`; GitLab: `glab issue note <num> -m "Shipped in PR #<pr_number>." && glab issue close <num>`). Drop the `in-progress` label.

### Swarm Phase D — Reconcile, clean up, report

Runs **once per invocation**, after the last wave, over every result the batch produced.

1. **Sweep worktrees & branches** from the main repo: `git worktree remove` + `git branch -d`/`-D` each merged agent's worktree/branch, then `git worktree prune`. **Keep** the worktree/branch of any PR left open so the work can be finished.
2. **Handle agent death / spend-limit.** If an agent never returned (crash, monthly spend cap), reconcile from **tracker state, not its last words** — and **never assume a review status survived the death** (slashdo's local-reviewer verdicts aren't persisted to the PR, so there's no stored `review_status` to read back). A worktree/branch/PR may exist:
   - **A PR opened:** recompute its gate from scratch before merging — re-run the run's review flags against it (`/do:pr --no-merge` with the same `--review-with`), or, for a no-external-review run, treat green required-CI + a mergeable state as `opened-no-review`-eligible. Merge it through the Phase C queue only on a clean recompute; if requested external reviewers can't be re-run to clean, leave the PR open and flag it for a human.
   - **No PR (or an unclean recompute you won't finish):** **release the claim** — remove the assignee (GitHub: `gh issue edit <num> --remove-assignee @me`; GitLab: `glab issue update <num> --assignee "-$ME"`), delete the local+remote `next/issue-<num>` branch, drop `in-progress` — so the issue returns to the queue, and flag it for human follow-up.
3. **Re-evaluate parent epics** for every issue that closed — a shipped issue may have been an epic's last child (the Phase 7 "re-evaluate the parent epic" step, run once per closed child).
4. **Reconcile changelog/PLAN churn.** Parallel claims all touch the same changelog file, when the project has one; the deletions-win re-syncs in Phase C should have kept it consistent — confirm the merged default branch's changelog carries every shipped issue's entry with no duplicate or resurrected lines. Skip this check for a project whose release notes come from commit messages.
5. **Print a summary table** — one row per batch issue, including the ones dropped in A1e and any held in a later wave: `issue · wave · dispatch (model/effort actually used, or `session` when the issue carried no hint — or when this host couldn't set them) · PR · result (merged / open: why / yielded / skipped / held / needs-input) · review status`. The dispatch column is what makes a wrong hint visible: a `model:light` issue whose agent needed three review iterations is a label to correct, not a mystery. For an explicit list, **account for every number the user named** — a named issue that never ran must appear with its reason, never be silently absent.

## Phase 1: Pick

> **Pre-flight — `/do:next` requires GitHub (`gh`) or GitLab (`glab`), in BOTH modes.** The command ships via `/do:pr`, which supports both hosts (including GitHub Enterprise and self-managed/Enterprise GitLab — both CLIs resolve a custom host from the repo's `origin` remote on their own). So even PLAN.md mode (whose *claiming* is git-only) needs a working `gh` or `glab` to *complete* the ship step. **Detect the host up front and abort if the matching CLI isn't authenticated — before claiming or implementing anything** — so the user never claims work they can't ship. Detection follows the exact same rule `/do:pr`'s own "Detect VCS Host" step uses (the `origin` remote is authoritative for which host the repo lives on; `auth status` only tells you which CLI is *usable*), so the two commands never disagree about which host a given repo is on:
> ```bash
> # Derive VCS_HOST/CLI_TOOL from the origin remote. A GitLab remote may be
> # gitlab.com, gitlab.<company>.com, or any self-managed hostname that happens to
> # contain "gitlab" — matching on that substring (rather than an exact-domain list)
> # is what lets this work on a custom/Enterprise instance with zero configuration.
> ORIGIN_HOST="$(git remote get-url origin 2>/dev/null | sed -E 's#^[a-z]+://##; s#^[^@/]+@##; s#[:/].*$##')"
> if printf '%s' "$ORIGIN_HOST" | grep -qi gitlab; then
>   VCS_HOST=gitlab; CLI_TOOL=glab
> elif [ -n "$ORIGIN_HOST" ]; then
>   VCS_HOST=github; CLI_TOOL=gh
> else
>   # No origin remote at all — fall back to whichever CLI is authenticated.
>   if gh auth status --active >/dev/null 2>&1; then VCS_HOST=github; CLI_TOOL=gh
>   elif glab auth status >/dev/null 2>&1; then VCS_HOST=gitlab; CLI_TOOL=glab
>   else
>     echo "/do:next needs an authenticated gh (GitHub) or glab (GitLab). Run 'gh auth login' or 'glab auth login'."; exit 1
>   fi
> fi
> # `--active` scopes the gh check to the active account. A bare `gh auth status` exits
> # non-zero if ANY configured account has a stale/invalid token — even when the active
> # account is authenticated fine — which would fail this pre-flight on every run.
> if [ "$CLI_TOOL" = gh ]; then
>   gh auth status --active >/dev/null 2>&1 && gh repo view >/dev/null 2>&1 || {
>     echo "/do:next detected a GitHub repo ($ORIGIN_HOST) but gh is not authenticated to it. Run 'gh auth login'."; exit 1; }
>   # Seed the API host for the `gh api` calls below. `gh api` ignores the repo remote
>   # and defaults to github.com, so on a GHES repo it must be passed --hostname "$GH_HOST".
>   # $ORIGIN_HOST is the first step of the shared derivation included at the end of this
>   # section — seed GH_HOST with it, then apply that snippet's remaining fallbacks and its
>   # per-host auth precheck. `gh issue`/`gh pr` calls resolve the host on their own.
>   GH_HOST="$ORIGIN_HOST"
> else
>   glab auth status >/dev/null 2>&1 || {
>     echo "/do:next detected a GitLab repo ($ORIGIN_HOST) but glab is not authenticated to it. Run 'glab auth login'."; exit 1; }
>   # No GH_HOST-style workaround needed here: unlike `gh api`, `glab api` and
>   # `glab issue`/`glab mr` already resolve the host from the repo's origin remote.
> fi
> ```
> Print: `VCS host: {VCS_HOST} (via {CLI_TOOL})`. Carry `CLI_TOOL`/`VCS_HOST` (and `GH_HOST` on GitHub) through every later phase — [lib/plan-issue-mode.md](../../lib/plan-issue-mode.md)'s own setup step reuses `CLI_TOOL` rather than re-detecting it.

Build the in-flight set (identical in both modes):

```bash
git fetch --prune 2>/dev/null
git branch -a --no-color --format='%(refname:short)'
if [ "$CLI_TOOL" = gh ]; then
  gh pr list --state open --limit 500 --json headRefName -q '.[].headRefName' 2>/dev/null || true   # 500 cap avoids silent truncation; || true keeps a transient gh hiccup from aborting the scan (the pre-flight already confirmed gh works)
else
  glab mr list --per-page 100 --output json --jq '.[].source_branch' 2>/dev/null || true   # open is the default state; 100 is GitLab's per-page max (lower than gh's 500) — same "note the cap" caveat applies on a pathologically large open-MR backlog
fi
```

For every ref, split on `/` and collect each segment — that's the raw in-flight set.

**GitHub only — finish the `GH_HOST` derivation with the shared snippet at the end of this section.** `$ORIGIN_HOST` already is its first step (the same `origin`-remote parse), so seed `GH_HOST` with it and continue from the fallbacks, then run the per-host auth precheck before any `gh api` call.

!`cat ~/.claude/lib/gh-host.md`

### Phase 1 — PLAN.md mode (default)

1. **Locate the queue — auto-redirect to issues when PLAN.md isn't the source of truth.** Read `PLAN.md` from the repo root, then route:
   - **PLAN.md is absent, OR its body is the issue-mode stub** (`/do:replan --issues` empties PLAN.md to a "roadmap lives in the tracker" note — detect the sentinel phrase **"tracks its roadmap as issues"** or **"Managed by `/do:replan --issues`"**, i.e. a note pointing at the tracker with zero `- [ ]` items) → this repo is issue-tracked. **Unless the user explicitly typed `--no-issues`** — an explicit request for PLAN.md mode wins over the structural heuristic, so in that case report `No PLAN.md backlog and --no-issues was set — create a PLAN.md or drop --no-issues to work the tracker.` and stop — **switch to issue mode automatically**: set `ISSUE_MODE=true` and continue from the issues-mode Phase 1 below (which runs the [lib/plan-issue-mode.md](../../lib/plan-issue-mode.md) setup). State the switch plainly: `No PLAN.md backlog — this repo tracks work as issues; continuing in --issues mode.` If the issue-mode setup aborts because **no host is authenticated**, surface that abort to the user (the message tells them to run `gh auth login`/`glab auth login` or create a PLAN.md) — do NOT silently report an empty queue.
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

Run the shared issue-mode setup — it reuses the `CLI_TOOL` (`gh`/`glab`) the Pre-flight above already detected, ensures `PLAN_LABEL` exists, and aborts if neither host is authenticated (this file is inlined at install time, so it's available in every environment — not a dead link):

!`cat ~/.claude/lib/plan-issue-mode.md`

> **Issue mode works on GitHub or GitLab.** `/do:next`'s claim mechanics (Phase 2) use the tracker's **assignee** field as the cross-machine marker on either host — GitHub via `gh issue edit --add-assignee`/`--remove-assignee`, GitLab via `glab issue update --assignee "+<user>"`/`--assignee "-<user>"` (the `+`/`-` prefix adds/removes one assignee without clobbering any others already on the issue, which matters for the race read-back below). Every `gh issue`/`gh api` call in this phase has a `glab issue`/`glab api` equivalent alongside it, selected by `$CLI_TOOL`. One structural gap to know about: GitHub exposes a native, project-scoped **sub-issues** API for epic/child resolution (step 3) that GitLab does not — GitLab's closest analog (group-level Epics) is a different, tier-gated feature, so on GitLab the **convention fallback** (body task-lists + `Part of #N` back-references, per [lib/epic-children.md](../../lib/epic-children.md)) is the primary path rather than a fallback of last resort. It's fully host-agnostic once every `gh` call in it is paired with its `glab` form, which it already is.

Then:

1. **List candidates** — open issues, **by priority then oldest-first**, **across all labels by default** (`gh issue list`/`glab issue list` never return pull/merge requests, so those are excluded automatically). **By default there is no author filter and no required label** — auto-pick claims any open issue regardless of who filed it or what label it carries — the guards against claiming the wrong thing are the parking-label skip (step 3), the declared-dependency skip (step 4), and the in-flight/assigned checks, *not* a gating label. Three opt-in narrowings apply when active: a label filter (`LABEL_FILTER` set via `--issues-label` or a saved `issues-label` default) restricts the set to one curated label; a **dispatch-hint filter** (`MODEL_FILTER` / `EFFORT_FILTER` set via `--model` / `--effort`) restricts it to issues whose `model:`/`effort:` labels match; and — **when `SELF_MODE` is on (`--self` / saved `self` default)** — an **author filter restricts the set to issues YOU filed** (`--author "@me"`), so issues opened by anyone else are excluded at the source. The author filter is a **security boundary**, not advisory ordering like priority: it removes other people's issues from consideration entirely.
   ```bash
   # LABEL_FILTER is empty by default → all open issues; non-empty only when the user
   # explicitly opted into a curated queue via --issues-label / a saved issues-label default.
   # The author filter is empty by default, or "@me" when SELF_MODE is on (--self / saved
   # self default) → restricts the queue to issues authored by the running account. gh
   # resolves "@me" to the authenticated login server-side, so other people's issues never
   # load.
   # Build the optional flags as a shell ARRAY, not via `${VAR:+--flag "$VAR"}`. zsh (a
   # common host shell) does NOT word-split the result of a parameter expansion, so
   # `${AUTHOR_FILTER:+--author "$AUTHOR_FILTER"}` expands to ONE argv word `--author @me`
   # and `gh issue list` aborts with `unknown flag: --author @me` whenever --self is on
   # (same trap for --label). An array element-appends each flag and its value as separate
   # words in BOTH bash and zsh, and expands to zero words when the filter is unset.
   # Sort key is [priorityRank, createdAt]: a `priority:<N>` label (lower N = higher
   # priority, e.g. priority:0 before priority:1) sorts first; an issue with NO priority
   # label gets rank +infinity (jq `infinite`) so it falls after EVERY prioritized one —
   # a finite sentinel like 9999 would tie a real `priority:9999` label and let unlabeled
   # work jump ahead of it — and createdAt breaks ties. With no `priority:*` labels
   # anywhere the order collapses to plain oldest-first — fully backward compatible.
   # `body` is fetched here for the step-4 dependency parse.
   LIST_ARGS=(--state open)
   [ -n "$LABEL_FILTER" ] && LIST_ARGS+=(--label "$LABEL_FILTER")
   [ "$SELF_MODE" = "true" ] && LIST_ARGS+=(--author "@me")
   gh issue list "${LIST_ARGS[@]}" --limit 500 \
     --json number,title,assignees,labels,createdAt,body \
     -q 'sort_by([ (([.labels[].name | select(test("^priority:[0-9]+$")) | ltrimstr("priority:") | tonumber] | min) // infinite), .createdAt ]) | .[]'
   ```
   The high `--limit` (500) avoids silently truncating the queue before the client-side priority/oldest sort — `gh issue list` defaults to 30, which would hide older eligible work. If a repo ever has >500 open candidate issues the queue is pathologically large (run `/do:replan --issues` to prune, or pass `--issues-label` to scope it); note the cap rather than silently dropping the overflow. **Priority is advisory ordering, not a gate** — an unprioritized issue is still claimable; the `priority:<N>` label only moves it earlier or later in the walk.

   **On GitLab, the same walk uses `glab issue list` — field names and shapes differ, not just the binary.** GitLab's JSON returns `iid` (not `number`), `labels` as a flat array of strings (not objects with `.name`), `assignees[].username` (not `.login`), `author.username` (not `.login`), `created_at` (not `createdAt`), `description` (not `body`), and `state` of `"opened"`/`"closed"` (not `OPEN`/`CLOSED`) — every jq expression below that touches these fields is adjusted accordingly, not just the flag names:
   ```bash
   LIST_ARGS=(--output json)
   [ -n "$LABEL_FILTER" ] && LIST_ARGS+=(--label "$LABEL_FILTER")
   # glab's --author takes a username. Unlike `gh`, it does not resolve the
   # GitHub-CLI token `@me` — pass the authenticated login so --self actually
   # filters (the explicit-#num path below already compares against this same
   # `glab api user` value).
   if [ "$SELF_MODE" = "true" ]; then
     ME="$(glab api user --jq .username)"
     LIST_ARGS+=(--author "$ME")
   fi
   glab issue list "${LIST_ARGS[@]}" --per-page 100 \
     --jq 'sort_by([ (([.labels[] | select(test("^priority:[0-9]+$")) | ltrimstr("priority:") | tonumber] | min) // infinite), .created_at ]) | .[]'
   ```
   GitLab's `--per-page` maxes out at 100 (lower than `gh`'s 500-item `--limit`) with no built-in "give me everything" pagination flag for a plain open-issue list — the same "note the cap, don't silently drop the overflow" guidance applies, just at a lower threshold; `--issues-label` is the practical way to keep a busy GitLab tracker's candidate set under it.

   **Dispatch-hint filter — client-side, in the same list-and-filter program.** When `MODEL_FILTER` / `EFFORT_FILTER` is non-empty, `map(select(…))` the array **before** `sort_by`, one clause per active axis. It cannot go in `LIST_ARGS`: repeated `--label` flags AND together on both `gh` and `glab`, so `--label model:light --label model:medium` asks for issues carrying *both* — the opposite of the OR this flag means. Build each clause from the **validated enum values only** (they come from the fixed sets in Parse Arguments, never from raw user text), where `<axis>` is `model`/`effort` and `V1…Vn` are the requested values with the `none` sentinel removed:
   ```
   # GitHub (labels are {name: "..."} objects) — membership clause, present whenever
   # at least one real value was requested:
   any(.labels[].name; . == "<axis>:V1" or . == "<axis>:V2" …)
   # untiered clause — OR'd in ONLY when `none` was among the values:
   ([.labels[].name | select(startswith("<axis>:"))] | length == 0)

   # GitLab (labels are plain strings) — same two clauses without the `.name`:
   any(.labels[]; . == "<axis>:V1" or . == "<axis>:V2" …)
   ([.labels[] | select(startswith("<axis>:"))] | length == 0)
   ```
   An axis whose only value is `none` uses the untiered clause alone. Worked example — `--model light,none --effort max`:
   ```bash
   # GitHub
   gh issue list "${LIST_ARGS[@]}" --limit 500 \
     --json number,title,assignees,labels,createdAt,body \
     -q 'map(select(any(.labels[].name; . == "model:light")
                    or ([.labels[].name | select(startswith("model:"))] | length == 0)))
         | map(select(any(.labels[].name; . == "effort:max")))
         | sort_by([ (([.labels[].name | select(test("^priority:[0-9]+$")) | ltrimstr("priority:") | tonumber] | min) // infinite), .createdAt ]) | .[]'

   # GitLab
   glab issue list "${LIST_ARGS[@]}" --output json --per-page 100 \
     --jq 'map(select(any(.labels[]; . == "model:light")
                   or ([.labels[] | select(startswith("model:"))] | length == 0)))
         | map(select(any(.labels[]; . == "effort:max")))
         | sort_by([ (([.labels[] | select(test("^priority:[0-9]+$")) | ltrimstr("priority:") | tonumber] | min) // infinite), .created_at ]) | .[]'
   ```
   Omit the `map` for an inactive axis entirely rather than emitting `select(true)`. **This filter runs before every other skip**, so an issue it excludes is never even considered for the parking-label / dependency / epic checks — and, unlike those skips, exclusion here means "not what you asked for," not "not workable." Report it that way in step 7: if the unfiltered queue had eligible work and the filter emptied it, say which filter did it — and **write the flags space-separated, exactly as they'd be typed** (`no eligible issue matching --model light --effort max — 14 open issues carry no dispatch hint; add `none` to include them`); joining them with a comma would render as one axis's OR-list in this flag's own grammar, telling the user a nonsensical invocation caused the empty queue, because a bare "nothing to do" on a barely-labelled tracker reads as a broken command.
2. **Determine in-flight issues.** Issue `N` is in flight if EITHER `issue-N` appears in the raw in-flight set, OR the issue **already has an assignee** (someone took it via the Phase 2 marker, possibly on another machine). The assignee check is the cross-machine half of the claim — a local-only `next/issue-N` branch on a sibling machine is invisible here, but its assignee is not.
3. **Resolve epics before picking (child-aware).** An epic (umbrella issue) is **not** a single claimable unit — its done-ness depends on its children, not on code evidence. For any candidate that is an epic (carries `epic`/a repo umbrella label, has native sub-issues, or whose body task-lists other issues), classify it with the shared epic logic (inlined here so it's available in every environment — not a dead link):

!`cat ~/.claude/lib/epic-children.md`

   Act on the resulting state:
   - `epic-open` (≥1 child still OPEN) → **skip** as not-yet-workable; note `epic #N: X/Y children open`.
   - `epic-done` (all children CLOSED, no wrap-up tasks) → nothing to implement; **close it inline** as housekeeping using [lib/epic-children.md](../../lib/epic-children.md)'s "Closing an epic" step (GitHub: `gh issue close "$N" --comment "..."`; GitLab: `glab issue note "$N" -m "..." && glab issue close "$N"`), note it, and keep scanning for the next item.
   - `epic-wrapup` (all children CLOSED, wrap-up tasks remain) → **this IS claimable work**: the work unit is "complete epic #N's remaining wrap-up tasks." Claim it like any issue — Phase 4 does the wrap-up (and ticks the wrap-up checkboxes in the epic body), and the Phase 6 PR carries `Closes #<N>` so merging closes the now-fully-done epic.
   - `epic-empty` (no children resolvable either way) → not really an umbrella; treat as an ordinary issue.
4. **Resolve declared dependencies before picking (blocked-by).** A candidate may declare a hard dependency in its **body**: a line matching `Depends on #<N>` or `Blocked by #<N>` (case-insensitive; one such line may list several, e.g. `Depends on #12, #15`). Collect every `#<N>` referenced on those lines. A candidate is **blocked** when ANY referenced issue is still open — check the freshest state (GitHub: `gh issue view <N> --json state -q .state`; GitLab: `glab issue view <N> --output json --jq .state`) and test for "closed" rather than an exact "open" match, since the two hosts spell it differently (`OPEN`/`CLOSED` vs `opened`/`closed`); a referenced number that is closed, or doesn't exist, does not block. Resolve this **lazily** as you walk the queue (only for the candidate you're about to pick), so a long backlog doesn't fan out a `gh`/`glab` call per issue up front.
   - `blocked` (≥1 referenced issue still open) → **skip** in auto-pick; note `#N blocked by #M (open)`. The skip is **self-clearing** — when #M closes, #N becomes eligible on the next run with no manual relabel.
   - Also honor each host's **native** blocked-by relationship when the API surfaces it — GitHub's GraphQL `blockedBy` connection, or GitLab's Issue Links API filtered to `link_type: "is_blocked_by"` (`glab api projects/:id/issues/<N>/links --jq '.[] | select(.link_type == "is_blocked_by")'`, id/iid resolved the same way the rest of this phase resolves them); the body convention is the portable default and the two are OR'd (blocked by *either* source ⇒ skip).
   - **Cycle / unresolvable chain** (A depends on B, B depends on A) → both stay skipped; note the cycle so a human can break it. Never loop trying to resolve one.
5. **Pick the target issue:**
   - **With argument** — the issue number (strip `#`); **set `ISSUE_NUM` to that stripped number now** (pulling step 6's assignment earlier so the checks below can reference `$ISSUE_NUM` — on a fresh run it isn't set yet). Verify open and NOT in flight. **`--self` first, as a hard gate:** when `SELF_MODE` is on, confirm the issue's author is the running account before anything else — GitHub: `gh issue view "$ISSUE_NUM" --json author -q .author.login` must equal `gh api --hostname "$GH_HOST" user -q .login`; GitLab: `glab issue view "$ISSUE_NUM" --output json --jq .author.username` must equal `glab api user --jq .username`; if it does not, **refuse and stop** with `Issue #<num> was filed by <author>, not you — /do:next --self only works on issues you filed. Drop --self to claim it.` This is the **one skip an explicit number does NOT override** — `--self` is a security boundary, not a curation preference, so a deliberate cherry-pick cannot cross it (unlike a parking label or label filter). If it's an epic, resolve its state (step 3) first and act on that state — claim an `epic-wrapup`, close an `epic-done`, or warn that children are still open on an `epic-open` (the explicit request still overrides — state that you're doing so). Otherwise a named number is an **explicit override**: it claims even an issue auto-pick would skip — a parking-labelled one, one with an **open declared blocker** (step 4), one outside the curated label when `LABEL_FILTER` is active, or one outside the dispatch-hint filter when `MODEL_FILTER`/`EFFORT_FILTER` is active (but **never** an issue another user filed while `--self` is on). State plainly when you're overriding a skip (e.g. "claiming `future`-labelled #123 by explicit request", "claiming #123 despite open blocker #120 by explicit request", or "claiming `model:heavy` #123 despite --model light by explicit request"). If any other check fails (closed, in flight), print why and stop.
   - **Without argument** — pick the FIRST candidate in the priority/oldest walk (step 1) that is NOT in flight, NOT already assigned, NOT carrying a parking label (`blocked`, `needs-input`, `wontfix`, `discussion`, `future`, or any repo-specific parking label — skip and note it), NOT blocked by an open declared dependency (step 4 — skip and note it), and NOT an `epic-open`/`epic-done` epic per step 3 (an `epic-wrapup` epic **is** eligible). Because auto-pick is label-agnostic by default, the parking-label skip, the dependency skip, and the epic resolution are the primary guards against claiming parked, blocked, or umbrella work. An explicit `#num` can still claim a skipped issue; auto-pick never surfaces one.
6. **Set `ISSUE_NUM=<num>` and `SLUG="issue-${ISSUE_NUM}"`** — later phases use `SLUG` for worktree/branch/commit/PR and `ISSUE_NUM` for `gh issue`/`glab issue` calls.
   - **Surface the claimed issue's dispatch hint, if it carries one** (`model:<tier>` / `effort:<level>`): `#42 hints model:heavy + effort:high`. In the **single-issue** flow this is a *report, not a dispatch* — a session cannot switch its own model or effort mid-run on any host, so the work proceeds in whatever session you're already in. Say so when there's a real mismatch worth acting on (`this session is on <current model> and #42 hints model:heavy — consider restarting on a stronger model, or continue as-is`), naming the mechanism **this** CLI uses to switch models if it has one, and then continue; never stall waiting for permission over an advisory label. Swarm is where the hint is actually *applied*, because that flow spawns a fresh agent per issue (Phase B).
7. **If no eligible issue exists**, print why and stop — and **name the filter that emptied the queue** when one did (`LABEL_FILTER`, `MODEL_FILTER`/`EFFORT_FILTER`, or `SELF_MODE`), rather than reporting a bare empty backlog: an opt-in narrowing that hides workable issues looks identical to having none, and only one of those is worth the user's time. Do NOT open new issues here — that only happens for work *discovered while implementing* (Phase 4/6).

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
# Default-branch lookup via git (not `gh repo view`/`glab repo view`) — one less
# API round-trip and works even mid-auth-hiccup. Try the local origin/HEAD ref
# first, fall back to querying the remote if it isn't set.
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
if [ "$CLI_TOOL" = gh ]; then
  ME="$(gh api --hostname "$GH_HOST" user -q .login)"
  gh issue edit "$ISSUE_NUM" --add-assignee @me
else
  ME="$(glab api user --jq .username)"
  # `+` ADDS one assignee without touching whatever's already on the issue. A bare
  # `--assignee "$ME"` REPLACES the whole assignee list, which would silently
  # overwrite a sibling who claimed first and defeat the read-back check below.
  glab issue update "$ISSUE_NUM" --assignee "+$ME"
fi || {
  echo "Could not claim issue #$ISSUE_NUM (missing write access?) — aborting."
  # Phase 2 already created and (best-effort) pushed next/issue-<num>. Retract the
  # REMOTE claim here (works from the worktree); then STOP and run Phase 7 cleanup from
  # the MAIN repo to drop the local worktree + branch. (Do NOT try to remove the worktree
  # from inside it — `cd ..` here lands in the worktree's parent, not the main repo.)
  git push origin --delete "next/${SLUG}" 2>/dev/null || true
  exit 1   # then: cd <main repo>, git worktree remove --force "$WORKTREE", git branch -D "next/${SLUG}"
}

# Confirm exclusivity: adding an assignee is NOT a compare-and-swap — both GitHub
# issues and GitLab issues allow MULTIPLE assignees, so a sibling machine that
# picked the same issue in the race window can also add itself and keep going.
# Re-read the assignees; if anyone OTHER than you is now assigned, a sibling won
# the race — yield: release your marker and stop (re-run Phase 1 to pick the next issue).
if [ "$CLI_TOOL" = gh ]; then
  ASSIGNEES="$(gh issue view "$ISSUE_NUM" --json assignees -q '[.assignees[].login] | join(",")')"
else
  ASSIGNEES="$(glab issue view "$ISSUE_NUM" --output json --jq '[.assignees[].username] | join(",")')"
fi
if printf '%s' "$ASSIGNEES" | tr ',' '\n' | grep -qvxF "$ME" ; then
  # A sibling won the race. Release the marker and STOP — do NOT add the label,
  # do NOT continue to Phase 3+. Run Phase 7 cleanup (remove the worktree + branch)
  # and re-run Phase 1 to pick the NEXT issue. This is a hard exit from the claim.
  echo "Issue #$ISSUE_NUM already claimed by: $ASSIGNEES — yielding."
  if [ "$CLI_TOOL" = gh ]; then
    gh issue edit "$ISSUE_NUM" --remove-assignee @me 2>/dev/null || true
  else
    glab issue update "$ISSUE_NUM" --assignee "-$ME" 2>/dev/null || true
  fi
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
  if [ "$CLI_TOOL" = gh ]; then
    gh label create in-progress --color FFA500 --description "Claimed and being worked" 2>/dev/null || true
    gh issue edit "$ISSUE_NUM" --add-label in-progress 2>/dev/null || true
  else
    glab label create --name in-progress --color "#FFA500" --description "Claimed and being worked" 2>/dev/null || true
    glab issue update "$ISSUE_NUM" --label in-progress 2>/dev/null || true
  fi
fi
```

**The race-detected branch is a hard stop, not a warning.** When the read-back shows another assignee, you have NOT claimed the issue — release your assignee, run Phase 7 cleanup to remove the worktree + branch you just created, and re-enter Phase 1 to pick the next eligible issue. Only the `else` branch (you are the sole assignee) proceeds to Phase 3.

The re-read narrows the race from "the whole implementation" to "the sub-second window between the assignee add and the read-back" — still not a true distributed lock (two reads can interleave so both yield, or in a tie both proceed), but close to compare-and-swap and far tighter than a blind assign. The assignee is the marker; the label is convenience (`|| true` keeps a label failure from aborting). **If you must stop after this (worktree failed, or the read-back showed a sibling won), release the marker before stopping:** GitHub `gh issue edit "$ISSUE_NUM" --remove-assignee @me --remove-label in-progress 2>/dev/null || true`; GitLab `glab issue update "$ISSUE_NUM" --assignee "-$ME" --unlabel in-progress 2>/dev/null || true` — so a half-claimed issue isn't stranded as permanently "taken."

## Phase 3: Verify still valid

Before writing code, sanity-check that executing the item as worded won't regress newer work. **Ask the user before proceeding if ANY hold:**

- **(PLAN.md)** The picked line has a `> ⚠️ DRIFT:` blockquote (you should have filtered it, but double-check), OR `git blame -L <line>,<line> -- PLAN.md` shows it was added in the last 24h AND conflicts with a since-merged commit.
- **(issues)** The full issue body/comments (GitHub: `gh issue view <num> --comments`; GitLab: `glab issue view <num> --comments`) supersede the title, the issue is already resolved, it's a pure discussion/question with no actionable change, or it awaits an unanswered clarification.
- **(both)** The item references a function/file/component that no longer exists or was heavily rewritten — `grep -rn` the named identifiers; if absent, it's stale and needs a human re-spec. OR it depends on an unshipped predecessor. OR the work would touch >5 unrelated files (bigger than estimated).

On "skip", run Phase 7 cleanup and re-run Phase 1 for the next item. **In issues mode also release the marker** — the same command Phase 2 uses to yield (GitHub `gh issue edit "$ISSUE_NUM" --remove-assignee @me --remove-label in-progress 2>/dev/null || true`; GitLab `glab issue update "$ISSUE_NUM" --assignee "-$ME" --unlabel in-progress 2>/dev/null || true`).

## Phase 3.5: Plan (interactive) — only when `--plan` was passed

Skip unless `--plan` is set. When present, don't touch code yet:

1. **Gather just enough context to plan** — read the files the item names, grep its identifiers, confirm integration points.
2. **Enter plan mode** (via the harness's plan-mode entry, e.g. `EnterPlanMode` under Claude Code) and present: the item (slug/`issue-<num>`), approach, files to add/change, tests, and any migration/compat/changelog obligations the repo's CLAUDE.md triggers.
3. **Clarify interactively** — ask only the questions whose answers change the implementation; pick obvious defaults and state them.
4. **Get explicit approval** (via the harness's plan-approval exit, e.g. `ExitPlanMode`) before Phase 4. Don't implement on an unapproved plan.
5. **On rejection/stop** — treat exactly like a Phase 3 skip: Phase 7 cleanup, and in issues mode release the marker.

## Phase 4: Implement

Write the code, tests, and docs the item requires, following the **target repo's** `CLAUDE.md` conventions. Run the relevant test suite as you go.

**Claimed an `epic-wrapup` epic** (Phase 1 step 3)? The work unit is the epic's own remaining wrap-up tasks (its children are already closed). Do that work, then **tick the corresponding `- [ ]` boxes in the epic body** so the audit trail is accurate — GitHub: `gh issue edit "$ISSUE_NUM" --body …` (or via the API); GitLab: `glab issue update "$ISSUE_NUM" --description …`. The Phase 6 PR carries `Closes #<epic>`, so merging closes the now-fully-done epic — no separate close needed.

**Roll discovered backbone work INTO this PR — don't defer it.** A helper to extract, a shared abstraction the change should sit on, a small refactor that makes the fix cleaner — fold it in, test it, mention it in the PR body. Only defer work that is **genuinely large** (its own multi-file feature, a migration, a cross-cutting redesign warranting its own plan/PR). The bar is "this needs its own PR," not "slightly outside the line-item's wording." When in doubt, roll it in.

**Where deferred work lands depends on the mode:**
- **PLAN.md mode** → add a NEW `- [ ] [<slug>] **Title** — rationale` item (slug per [lib/plan-id-format.md](../../lib/plan-id-format.md)).
- **Issues mode** → file a NEW tracker issue (never PLAN.md), with enough context to pick up cold (file paths, why split out, which issue surfaced it), tagged `PLAN_LABEL` so the next `/do:next --issues` and `/do:replan` treat it as queued. **Add a dispatch hint (`model:<tier>` / `effort:<level>`) when you can justify one** — you just had your hands in this code, which is the best evidence anyone will ever have for the call; leave the axis off rather than guessing, per [lib/plan-issue-mode.md](../../lib/plan-issue-mode.md) "The dispatch hint". Create each hint label lazily before applying it (GitHub: `gh label create <name> --color <hex> 2>/dev/null || true`; GitLab: `glab label create --name <name> --color "#<hex>" 2>/dev/null || true`, colors in that file), then create the issue itself using the same `<label flags>` form that file's "Recording a plan item" section uses:
  ```bash
  # GitHub
  gh issue create --title "<concise actionable title>" --label "$PLAN_LABEL" \
    <hint label flags — e.g. --label model:<tier> and/or --label effort:<level>; OMIT ENTIRELY when you can't justify one> \
    --body "$(printf 'Discovered while working issue #%s.\n\n<what, where (file:line), why it needs its own PR>\n' "$ISSUE_NUM")"
  # GitLab
  glab issue create --title "<concise actionable title>" --label "$PLAN_LABEL" \
    <hint label flags — same as above, same placeholder rule> \
    --description "$(printf 'Discovered while working issue #%s.\n\n<what, where (file:line), why it needs its own PR>\n' "$ISSUE_NUM")"
  ```
  The hint flags are a **placeholder like every other `<…>` in that command, not a default** — do not copy a literal `model:light` / `effort:high` through. Filing every discovered issue with the same stamped pair is worse than filing none: it contradicts the "leave the axis off rather than guessing" rule above and poisons `/do:next --model`, which would then claim work nobody ever assessed.

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

**Changelog (both modes).** Log the shipped work **the way this project already logs changes** — slashdo has no opinion about the format. Resolve the convention the same way `/do:push` does (stated convention in `CLAUDE.md` / `AGENT.md` / `AGENTS.md` / `CONTRIBUTING.md` first; otherwise imitate whatever changelog artifacts already exist — a rolling `CHANGELOG.md`, a per-release directory with an unreleased staging file, a fragment tool like `.changeset/` or `changelog.d/`; otherwise nothing). If the project has **no** file-based changelog — because its release notes are derived from commit messages — skip this step entirely: the PR title and commits carry the entry instead. Never invent a changelog file the project didn't ask for.

Whatever the format: **lead the bullet with the slug in brackets** so the work stays grep-able, and write for a *user* of the app, not a coder inside it (no file paths, module/function names, test counts). Purely internal work with no user-visible effect is the exception and may be described in code terms. Match the existing entries' grouping; where there's no established shape yet, prefer a `##` heading named for the feature or capability touched (e.g. `## PR review loop`) over generic `Added`/`Changed`/`Fixed` buckets.

```markdown
## <Feature or capability name>
- **[<slug>] <Short, user-facing title>** — <one sentence on the user-visible effect>
```

Stage and commit. `{CHANGELOG_FILE}` below is whatever file you actually wrote above — there may be none:

```bash
# PLAN.md mode:
git add PLAN.md
git add {CHANGELOG_FILE}   # omit entirely if the project has no file-based changelog
git commit -m "docs([<slug>]): remove from PLAN.md and log the change"

# Issues mode (no PLAN.md edit): commit ONLY if something was actually staged.
# A repo whose release notes come from commit messages stages nothing here, and
# PLAN.md is untouched in issue mode — so an unconditional `git commit` would exit
# non-zero ("nothing to commit") and abort an otherwise-valid run. Guard on staged:
git add {CHANGELOG_FILE}   # omit entirely if there is none
git diff --cached --quiet || git commit -m "docs([issue-<num>]): log issue #<num>"
```

## Phase 6: Review and ship — delegate to `/do:pr`

> **Issues mode — link the PR to the issue.** The PR body MUST contain `Closes #<num>` (or `Fixes #<num>`) so merging auto-closes the claimed issue. Reference any discovered follow-up issues you filed with plain `#<n>` (NOT `Closes` — they're not resolved by this PR).
>
> **Issues mode — major review findings become tracker issues, not PLAN.md items.** A substantial finding you decide *not* to fix here gets filed as a NEW issue (GitHub `gh issue create --label "$PLAN_LABEL" …`, GitLab `glab issue create --label "$PLAN_LABEL" …`, same form as Phase 4). Nit/style findings just get parked verbally.

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

**Encode the slug in the PR title** for grep-ability if `/do:pr` didn't — GitHub: `gh pr edit <num> --title "feat([<slug>]): <description>"`; GitLab: `glab mr update <num> --title "feat([<slug>]): <description>"`.

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
# Only reached when the review gate passed AND the tree is conflict-free.
# GitHub — no `--delete-branch` (see below); Phase 7 deletes both branches:
gh pr merge <num> --merge
# GitLab — wait for the pipeline HERE rather than handing the MR to `--auto-merge`:
# that flag sets merge-when-pipeline-succeeds server-side and returns while the MR is
# still `opened`, so Phase 7's state read-back below would never see `merged` and the
# worktree, claim branch, issue, and in-progress label would be stranded on every run.
glab ci status --wait && glab mr merge <num> --yes --remove-source-branch
```

**Why no `--delete-branch` on the `gh` merge:** you are inside the linked worktree, and `--delete-branch` deletes the *local* branch too — for which `gh` first checks out the default branch. That fails in a linked worktree (`fatal: '<default>' is already used by worktree at …`, because the parent repo has it checked out) and **`gh` exits non-zero even though the merge itself succeeded**. Any `||` fallback chain wrapped around the merge then fires on a merge that already landed. Without the flag the exit status means what it says, and Phase 7 owns both branches: it removes the worktree, deletes the local branch from the main repo, and deletes the remote branch explicitly.

## Phase 7: Clean up

**If this run opened and merged a PR, confirm it actually merged before touching
anything.** (A run that never opened one — a Phase 2 race hard-stop, a Phase 3 skip, or a
Phase 3.5 reject — has no PR to read back: skip this gate entirely and go straight to the
**Abandoned a claim** teardown below, which is what returns the item to the queue. Applying
the gate there would strand the claim branch Phase 2 already published, which is the
phantom claim this same phase verifies against.) `gh pr merge` exits zero on a repo with a **merge queue** while the PR is still open, and this phase removes the worktree first — so an unverified entry discards the working tree of a PR that has not landed. Read it back (GitHub: `gh pr view <num> --json state -q .state`, expect `MERGED`; GitLab: `glab mr view <num> --output json --jq .state`, expect `merged` — the merge step above waits on the pipeline precisely so this single read is meaningful; if you nonetheless merged with `--auto-merge`, an immediate read is *always* `opened`, so poll every 30s for up to 30 minutes before concluding it is queued); on anything else, **run none of this phase** — leave the worktree, branch, issue, and `in-progress` marker exactly as they are, and report the PR as queued/left-open.

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
if ! git push origin --delete "next/${SLUG}"; then
  # A branch that is already gone is success; anything else is not — a surviving
  # claim branch keeps reading as in-flight to every other machine. rc 2 is
  # "no such ref"; every other rc is a transport/auth failure that proves nothing.
  git ls-remote --exit-code --heads origin "next/${SLUG}" >/dev/null 2>&1; RC=$?
  if [ "$RC" -eq 2 ]; then
    echo "note: remote branch next/${SLUG} was already gone"
  else
    echo "ERROR: could not confirm next/${SLUG} is gone (ls-remote rc=$RC) — delete it manually"; false
  fi
fi
```

(Order matters: remove the worktree, **sync the default branch, delete the local claim branch, and only THEN touch the remote** — every step is `&&`-gated so the chain short-circuits on the first failure. Three invariants hold: (1) a `git branch -d` failure ("not fully merged") can't skip the sync, because the sync already ran; (2) any earlier failure (worktree-remove, fetch, checkout, rebase conflict) stops the chain *before* the local delete, so the claim branch is never removed while the default branch is stale; and (3) **the remote-delete is the LAST link**, so a failed/partial cleanup — which may still hold unmerged work in the worktree — never retracts the remote claim and re-exposes the item to other machines. On GitHub the merge deliberately does **not** pass `--delete-branch` (it would fail from inside the worktree), so this trailing delete is the real remote deletion — and because it is now load-bearing rather than a no-op, a failure must be **distinguished, not swallowed**. A blanket `|| true` would report a clean sweep while the claim branch survives on the remote, where Phase 1's in-flight scan keeps reading the issue as claimed on every machine, forever. So the delete falls back to `git ls-remote`: a branch that is already gone (GitLab's `--remove-source-branch`, or a repo that auto-deletes merged heads) is success, and one that is still there after a failed delete — network, branch protection, revoked push rights — prints and fails the chain.)

**Abandoned a claim (Phase 3 skip / Phase 3.5 reject — no PR, work discarded)?** The branch is unmerged, so `git branch -d` won't remove it. Retract the claim explicitly instead (force-delete local, delete remote) so the item returns to the queue — and **verify the remote retract landed**, because Phase 2 published this branch to origin the moment it was created: a silently failed delete leaves a phantom claim that Phase 1's in-flight scan honours forever, on every machine, with no local artifact left to hint at it. From the main repo:

```bash
git worktree remove --force "${WORKTREE}"
git branch -D "next/${SLUG}"
if ! git push origin --delete "next/${SLUG}"; then
  git ls-remote --exit-code --heads origin "next/${SLUG}" >/dev/null 2>&1; RC=$?
  [ "$RC" -eq 2 ] || echo "ERROR: claim NOT retracted — delete next/${SLUG} manually (ls-remote rc=$RC)"
fi
```

(Issues-mode abort branches in Phase 2 do the same teardown inline, before any branch is published.)

**Issues mode — confirm closed, then clear the marker — but only for a PR that actually merged.** On a repo with a merge queue `gh pr merge` exits zero while the PR is still open, so read the PR back first (`gh pr view <num> --json state -q .state`; GitLab: `glab mr view <num>`): anything other than `MERGED` means nothing shipped — leave the issue open, keep its `in-progress` label and assignee, and report the PR as queued/left-open instead of running this step. For a genuinely merged PR, a `Closes #<num>` in the PR body auto-closes the issue on merge to the **default branch**. Verify state (GitHub: `gh issue view <num> --json state -q .state`, expect `CLOSED`; GitLab: `glab issue view <num> --output json --jq .state`, expect `closed`); if still open, close explicitly (GitHub: `gh issue close <num> --comment "Shipped in PR #<PR_NUM>."`; GitLab: `glab issue note <num> -m "Shipped in PR #<PR_NUM>." && glab issue close <num>`). Then drop the stale label (GitHub: `gh issue edit "$ISSUE_NUM" --remove-label in-progress 2>/dev/null || true`; GitLab: `glab issue update "$ISSUE_NUM" --unlabel in-progress 2>/dev/null || true`). (Leave the assignee — it records who shipped it; a closed issue is never a Phase 1 candidate anyway.)

**Issues mode — re-evaluate the parent epic (the shipped issue may have been an epic's last child).** Once the issue is confirmed closed, resolve its parent epic with the shared epic logic ("Resolving a child's parent epic" in [lib/epic-children.md](../../lib/epic-children.md), inlined in Phase 1). If a parent epic `#P` exists, re-classify it:
- `epic-done` (this was the last open child and `#P` has no remaining wrap-up tasks) → **close the epic** with an evidence comment (GitHub: `gh issue close "$P" --comment "All children closed (incl. #<num>) — closing epic. (slashdo)"`; GitLab: `glab issue note "$P" -m "All children closed (incl. #<num>) — closing epic. (slashdo)" && glab issue close "$P"`).
- `epic-wrapup` (children all closed but wrap-up tasks remain) → **don't close**; comment so a later `/do:next` surfaces it (GitHub: `gh issue comment "$P" --body "All child issues are now closed — only the epic's own wrap-up tasks remain."`; GitLab: `glab issue note "$P" -m "All child issues are now closed — only the epic's own wrap-up tasks remain."`).
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
- **Swarm is an orchestration layer, not a new claim path.** `--swarm` adds exactly two things over the single-issue flow: a batch step that decides which issues run — auto-picking `SWARM_N` independent ones, or vetting and wave-ordering the ones you named — and a serialized merge queue at the end. Everything between — claim, worktree, implement, changelog, review gate — is the unchanged single-issue flow run once per agent. Keep it that way: never special-case a swarm agent's claim/ship logic, because divergence is how the lease protection rots. Cost scales ≈N×; correctness across the batch comes from the serialized, re-synced merges (deletions-win), not from trusting the agents not to overlap.
- **Empty pick is not a failure.** Everything in flight / drifted / NEEDS_INPUT (PLAN.md), or every open issue in flight / assigned / parking-labelled / blocked by an open dependency — or, when `--issues-label` is active, no open issue carrying that label (issues) — is a healthy queue — exit clean and say so.
- **Ordering issues mode (no new flags).** Auto-pick walks the queue **by priority then oldest-first**, with two opt-in, backward-compatible controls — neither changes behavior for a repo that uses neither:
  - **Hard dependencies — `Depends on #<N>` / `Blocked by #<N>` in the issue body** (or each host's native blocked-by relationship — GitHub's GraphQL `blockedBy`, GitLab's Issue Links API). Auto-pick **skips** an issue while any declared blocker is still open and surfaces it automatically once the blocker closes (self-clearing — Phase 1 step 4). This encodes the real dependency DAG without hand-maintained sequence numbers; an explicit `#num` overrides it. Use this to guarantee a predecessor ships first instead of parking the successor by hand.
  - **Soft priority — a `priority:<N>` label** (lower N = earlier; unlabeled sorts last, `createdAt` breaks ties — Phase 1 step 1). Use this to sequence *independent, unblocked* issues. It only reorders the walk; it never gates.
  - Prefer `Depends on #N` for correctness ("Y needs X") and `priority:<N>` only for preference ("do these first"). Both are populated by humans or by `/do:replan` triage, never by `/do:next` itself.
- **`/do:next` only *consumes* the queue.** New work comes from `/do:replan`, `/do:better`, `/do:depfree`, or human edits — never invented here, except *discovered* work split out of the current item (Phase 4/6).
- **`--issues` resolves the same three ways on every slashdo command.** An explicit `--issues`/`--no-issues` on this run wins; otherwise the saved `issues` default (`/do:config --issues`, global or per-project `.slashdo.json`) applies; otherwise it's off. A repo that works issues-first can save the default once instead of passing `--issues` every time — and even without a saved default, the Phase 1 auto-redirect below covers the common case.
- **Auto-redirect makes `--issues` optional for issue-tracked repos.** When there's no PLAN.md, or PLAN.md is the stub `/do:replan --issues` leaves behind, a bare `/do:next` recognizes the repo is issue-tracked and continues in issue mode on its own (stating the switch). So a repo that ran `/do:replan --issues` once doesn't need every contributor to remember the flag — the stub *is* the config signal. Passing `--issues` explicitly still works and skips the detection.
- **Host support — GitHub or GitLab, including Enterprise/self-managed instances of either.** `/do:next` requires a repo on one of those two hosts with the matching CLI (`gh`/`glab`) authenticated, in **both** modes, and the Phase 1 pre-flight aborts up front otherwise — it *ships* through `/do:pr`, which supports both, and issue mode's cross-machine claim marker (Phase 2) is the issue **assignee** field, which both hosts have. `$CLI_TOOL`, detected once in the Phase 1 pre-flight from the `origin` remote, selects which CLI every later phase uses; `/do:plan-task`'s VCS-host detection follows the identical rule, so the two commands never disagree about which host a given repo is on. The one real structural gap is epic/child resolution (Phase 1 step 3): GitHub has a native project-scoped sub-issues API, GitLab does not, so on GitLab the host-agnostic convention fallback ([lib/epic-children.md](../../lib/epic-children.md) — body task-lists + `Part of #N` back-references) is the primary path rather than a fallback of last resort.
- **`--self` is a security boundary — claim only issues you filed.** By default `/do:next --issues` claims any open issue regardless of author, which means it can act on a work item (and the instructions embedded in its body) opened by *anyone* with access to the tracker. `--self` (or a saved `self` default, or per-project `.slashdo.json`) restricts every claim — auto-pick, swarm batch, and explicit `#<num>` — to issues whose author is the running `gh`/host account (`@me`). Other people's issues are filtered out of auto-pick at the API (`--author "@me"`) and an explicit number for someone else's issue is **refused, not overridden** — the one skip a deliberate cherry-pick cannot cross, because it's a security gate rather than a curation preference. Save it once with `/do:config --self` (globally or `--project` per-repo) so a shared/multi-contributor tracker never auto-feeds third-party issues into your agent. Issues mode only (PLAN.md items have no author); works on GitHub or GitLab, same as issue mode generally.
- **Auto-pick is label-agnostic by default — `--issues-label` opts into a curated queue.** Without a label filter, every open issue is claimable regardless of what label it carries (and, unless `--self` is set, regardless of who filed it — see the `--self` note above); the guards against claiming the wrong thing are the parking-label skip (`future`/`blocked`/`needs-input`/`wontfix`/`discussion`/repo-specific), the child-aware epic resolution (Phase 1 step 3 — `epic-open`/`epic-done` epics are skipped, an `epic-wrapup` epic is claimable wrap-up work), and the in-flight/assigned checks — not a required label. This is deliberately permissive so a repo that files normal `enhancement`/`bug`/`area:*` issues works with `/do:next --issues` out of the box, without first running `/do:replan --issues` to stamp a `plan` label on everything. To restrict auto-pick to a curated set, pass `--issues-label <name>` (or save it as a default) — e.g. drain only the `plan`-labelled items `/do:replan --issues` produced. Newly-filed discovered/queued work still gets the `plan` label (so a default run and a `--issues-label plan` run agree on it), and an explicit `#num` always overrides every *other* skip — including parking labels and an active filter — **except** the `--self` security boundary (an explicit number for another user's issue is still refused while `--self` is on; see the `--self` note above).
