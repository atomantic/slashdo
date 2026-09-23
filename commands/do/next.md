---
description: Claim the next unclaimed PLAN.md item (or tracker issue with --issues) by its ID, do the work in an isolated worktree, ship a PR, and clean up — or, with --swarm, claim and ship several independent issues in parallel (auto-picked, or the exact issue numbers you name). Works on GitHub (gh) or GitLab (glab), including Enterprise/self-managed hosts — it ships via /do:pr.
argument-hint: "[<slug>|#<issue> …] [--issues|--no-issues] [--issues-label <name>] [--model <tier>[,…]] [--effort <level>[,…]] [--self|--no-self] [--collaborators|--no-collaborators] [--trusted-authors <list>] [--swarm[=<N>]] [--plan] [--review-with <agent>[,…]] [--review-iterations <n>] [--review-mode <series|parallel>] [--review-stop-on-findings|--review-stop-on-clean] [--reviewer-applies] [--no-review] [--merge|--no-merge|--merge=<method>] [--merge-method <method>]"
---

# Next — Pick the next plan item (or issue) and ship it

Claim the next unclaimed `- [ ]` item from **PLAN.md** via the slug-ID system — or, with `--issues`, the next open tracker issue (any label by default; `--issues-label` narrows to a curated queue) — work it in an **isolated worktree**, run review, open a PR, merge, and clean up. `/do:replan`, `/do:better`, and `/do:depfree` populate the queue; `/do:next` drains it, one item per run.

**Two work sources**, selected by the resolved `ISSUE_MODE` (`--issues`/`--no-issues`, a saved `issues` default, or the Phase 1 auto-redirect):

| Source | Selected by | Work unit | Branch | "Done" action | Discovered work goes to |
|---|---|---|---|---|---|
| **PLAN.md** (default) | `ISSUE_MODE=false` | a `- [ ]` line with a `[<slug>]` ID | `next/<slug>` | remove the line + log to the changelog | a new PLAN.md item (only if genuinely large) |
| **Tracker issues** | `ISSUE_MODE=true` (`--issues`, saved default, or auto-redirect) | an open issue (any label by default; `--issues-label` narrows to one) | `next/issue-<num>` | close the issue via `Closes #<num>` in the PR | a new tracker issue (only if genuinely large) — never PLAN.md |

The two sources never mix in one run. In issues mode, `issue-<num>` is the slug everywhere the PLAN.md flow says `<slug>` — worktree `../next-issue-<num>`, branch `next/issue-<num>`, commit/PR-title prefix `[issue-<num>]`, in-flight scan.

**How the claim works.** Every PLAN.md checkbox carries a `[<slug>]` ID (a stable kebab-case identifier derived from the title). A slug is **"in flight"** when it appears as a `/`-separated segment in any local or remote branch (`git branch -a`) or any open PR head ref. `/do:next` picks the first `- [ ]` whose slug is NOT in flight and creates a `next/<slug>` branch — that branch name *is* the claim. Issues mode adds a cross-machine marker (the assignee) in Phase 2.

**Drain one item — or several (`--swarm`).** By default `/do:next` ships one item per run. `--swarm` (issues mode) claims and ships several independent open issues in parallel, each in its own worktree subagent, serializing only the merge — auto-picked (`/do:next --swarm`) or exactly the issues you name (`/do:next --swarm #12 #14 #15`). See **Swarm mode**; Phases 1–7 are unchanged without `--swarm`.

## Parse Arguments

Split `$ARGUMENTS` on whitespace — `--` tokens are flags, the rest are **targets**. Value flags accept `--flag=value` or `--flag value` (the next token is the value, not a target). Order is free.

Collect targets into an ordered list `TARGETS`, **in this order**: **(1) expand** any comma-separated run of issue numbers (`12,14,15`, `#12,#14`) into one target each; **(2) normalize** (strip a leading `#`); **(3) de-duplicate**, order preserved — so `#12`/`12`, or `12,14` alongside `14`, never become two batch members racing for one issue. **One target** is the single item to claim. **Several targets** — issue numbers only — are an explicit `--swarm` batch. Several targets **without** `--swarm` is ambiguous: claim nothing and say so, with the message matching what they named:
  - numeric targets: ``You named <n> issues, but /do:next ships one item per run — add --swarm to batch them in parallel, or name a single item.`` (Never silently enable swarm — it's an ≈N× token bill.)
  - slug (PLAN.md) targets: ``You named <n> PLAN.md items, but /do:next ships one item per run — and --swarm works on issue numbers only. Name a single slug.``

- **`<slug>` / `#<issue>`** — claim THAT item instead of auto-picking. PLAN.md mode: a slug that already exists as a `- [ ]` line (this command never assigns IDs — `/do:replan` does). Issues mode: an open issue number, bare (`123`) or `#`-prefixed. An explicit number is a deliberate cherry-pick that **bypasses every auto-pick skip except the `--self` / `--collaborators` security boundaries** — it can claim a parking-labelled issue (`future`/`blocked`/…), an epic (resolved per its children — Phase 1 step 3), or an issue outside an active label filter; state it when you do. Under `--self` an issue **another user filed is refused**; under `--collaborators` an issue filed by a non-collaborator not on `--trusted-authors` is **refused** (Phase 1 step 5).
- **`--issues`** / **`--no-issues`** — switch the source to the **tracker** (`ISSUE_MODE=true`) or force PLAN.md mode (`ISSUE_MODE=false`). Setup (host detection, label, abort-if-unauthenticated) follows [lib/plan-issue-setup.md](../../lib/plan-issue-setup.md). In issue mode PLAN.md is never read or edited.
- **`--issues-label <name>`** — **restricts auto-pick to issues carrying that label** (a curated queue, e.g. the `plan`-labelled items `/do:replan --issues` produced). Auto-pick is unfiltered by default. Record the label as `PLAN_LABEL` (default `plan`) — the default is still the label applied to issues this command *files* (Phase 4), but it only *filters* auto-pick when the flag (or a saved `issues-label` default) supplied it. Track an active filter as `LABEL_FILTER` (the label when explicitly provided; empty otherwise). Issue mode only.
- **`--model <tier>[,…]`** / **`--effort <level>[,…]`** — **restrict auto-pick to issues carrying that dispatch hint** (see [lib/plan-issue-setup.md](../../lib/plan-issue-setup.md) "The dispatch hint"). `<tier>` ∈ `light` / `medium` / `heavy`; `<level>` ∈ `low` / `medium` / `high` / `xhigh` / `max`. Record as `MODEL_FILTER` / `EFFORT_FILTER` (empty when absent). Reject an unknown value with `--model must be one of light, medium, heavy, none (got: {value}).` / `--effort must be one of low, medium, high, xhigh, max, none (got: {value}).`
  - **Comma-list is OR *within* an axis; the two axes AND *across*.** `--model light,medium --effort low` = (light **or** medium) **and** low. Each flag is single-use — a repeated `--model` is an error (`--model given twice — pass one comma-separated list.`), not a union.
  - **The sentinel `none`** matches an issue with **no** label on that axis: `--model light,none` = "light, or untiered". Bare `--model light` **excludes untiered issues** (as `--issues-label` excludes unlabelled ones), so an all-untiered tracker comes back empty — say so in the "no eligible issue" message.
  - **Filtering is not dispatching.** These flags choose which issues are eligible; a swarm worker runs on the claimed issue's own `model:`/`effort:` labels (Swarm Phase B). `--model heavy` never *upgrades* an issue, and neither flag changes the current session's model.
  - **Issues mode only** (state the skip and continue in PLAN.md mode). Advisory like `--issues-label`, not a security boundary: an explicit `#<num>` overrides both filters (Phase 1 step 5).
- **`--self`** / **`--no-self`** — **security gate: restrict issue work to issues YOU filed.** `--self` sets `SELF_MODE=true`; `--no-self` sets `SELF_MODE=false`. When on, `/do:next` only claims an open issue whose **author is the authenticated user** (`@me`): auto-pick filters everyone else out and an explicit `#<num>` for someone else's issue is **refused, not overridden** (Phase 1), so instructions embedded in a third party's issue are never acted on. **Issues mode only** (PLAN.md items carry no author — state the skip). Resolve from the flag, else the saved `self` default (per-project `.slashdo.json` over global `~/.claude/.slashdo-config.json`, same precedence as `issues`), else `false`.
- **`--collaborators`** / **`--no-collaborators`** — **security gate: restrict issue work to issues filed by a current repo collaborator (union `--trusted-authors`).** Sets `COLLAB_MODE=true`/`false`. When on, `/do:next` only claims an issue whose **author is in the trusted claim pool**: the **live collaborator set** from the host API (GitHub: `repos/:owner/:repo/collaborators`; GitLab: project members with `access_level >= 30` Developer) **UNION** the `--trusted-authors` list. Collaborators always come live from the API, never from a saved allowlist; `--trusted-authors` adds extra trusted *authors* only. An issue filed by someone in neither set is skipped by auto-pick and **refused, not overridden** on an explicit `#<num>` (Phase 1). **`--self` is stricter and wins:** when `SELF_MODE` is on, skip the collaborator/trusted-authors filter. `--no-self` does NOT disable `COLLAB_MODE`; `--no-collaborators` is the escape hatch to any-author. **When `COLLAB_MODE` is off, `--trusted-authors` does not restrict or widen auto-pick.** **Issues mode only** (state the skip). Resolve from the flag, else the saved `collaborators` default (same precedence as `issues`/`self`), else `false`.
- **`--trusted-authors <list>`** — extra GitHub/GitLab logins unioned into the trusted claim pool **when `COLLAB_MODE` is on**. Comma-separated logins (e.g. `howlingmime,Joebok`); a leading `@` is stripped; compare **case-insensitively**. This is **not** a saved collaborator allowlist — collaborators stay live from the API. Empty / the sentinel `none` (case-insensitive) means no extra authors for this run (overrides a saved default). Repeated `--trusted-authors` is an error (`--trusted-authors given twice — pass one comma-separated list.`). Validate each login against `^[A-Za-z0-9][A-Za-z0-9-]*(\[bot\])?$` (the same shape as `/do:config`'s `@<login>` reviewer); abort with `Invalid --trusted-authors login: {value}. Use GitHub/GitLab logins (comma-separated), or none to clear.` Dedupe case-insensitively, preserving first-occurrence spelling. Carry the normalized comma-separated string as `TRUSTED_AUTHORS` (empty when none). Resolve from the flag, else the saved `trusted-authors` default (per-project over global); a saved `none` (case-insensitive) is a tombstone meaning no extra authors (masks an inherited global list, like `review-with=none`); else empty. **`--self` still wins over both.** Issues mode only.
- **Saved defaults.** Read both config files — `cat ~/.claude/.slashdo-config.json` (global) and `cat "$(git rev-parse --show-toplevel)/.slashdo.json"` (per-project; skip a missing file silently) — and merge their `.defaults` objects **project over global**; a typed flag always wins over its saved default. With neither `--issues` nor `--no-issues`, resolve `ISSUE_MODE` from the saved `issues` default, built-in `false`. Likewise `PLAN_LABEL` from the saved `issues-label` default — a saved `issues-label` counts as an explicit choice and sets `LABEL_FILTER` exactly as the flag would; with neither, `LABEL_FILTER` stays empty. Likewise `SELF_MODE` from `self`, `COLLAB_MODE` from `collaborators`, `TRUSTED_AUTHORS` from `trusted-authors` (a saved `none` resolves to empty), and `MERGE_ENABLED` / `MERGE_METHOD` from `merge` / `merge-method` (see `--merge` above). Resolve only these keys here — the review flags pass through to `/do:pr`, which resolves its own defaults. **`--model` / `--effort` have no saved default by design** — a forgotten saved narrowing is indistinguishable from an empty backlog; they apply only when typed. The Phase 1 auto-redirect applies independently: a repo with no PLAN.md / the issue-mode stub switches to issue mode even with no saved default or a saved `issues=false`; only an **explicit** `--no-issues` on the command line wins over it (Phase 1).
- **`--swarm` / `--swarm=<N>`** — drain **several independent issues in parallel**, auto-picked or exactly the issue numbers you name. Records `SWARM=true`. **Issues mode only**; short-circuits Phases 1–7 into the **Swarm mode** flow below. Ignored (with a note) when only one issue is eligible / named. Review flags pass through to each swarm agent's `/do:pr` as in the single-issue flow.
  - **Batch membership.** **No target** → swarm auto-picks the first `SWARM_N` independent eligible issues (Phase A). **Two or more targets** (`--swarm #12 #14 #15`, `--swarm 12,14,15`) → that list **is** the batch, in the order given — a deliberate cherry-pick that bypasses the auto-pick skips exactly as a single explicit `#<num>` does (Phase A). **One target** (`--swarm #12`) → run the single-issue flow and say so.
  - **Concurrency (`SWARM_N`).** Bare `--swarm` resolves `SWARM_N=3` in **both** cases (a bare flag never raises concurrency because you named more issues); `--swarm=<N>` sets it, **clamped to `1..6`** (state the clamp). A batch bigger than `SWARM_N` runs in **waves** of `SWARM_N` (Phase B).
  - **Count vs. target disambiguation.** `--swarm=<N>` (attached) is always the count. Space-separated `--swarm <N>` consumes the next token as the count **only when** it is a bare integer **in `1..6`** with no `#` or comma **and** it is the *only* target token — so `--swarm 3` is three agents, while `--swarm #12 #14`, `--swarm 12,14`, and `--swarm 12 14` are two-issue batches, and `--swarm 12` is **issue 12** (a lone integer above 6 is far likelier an issue number). Say which reading you took, and note that `--swarm=12` is how to ask for a count that gets clamped.
- **`--plan`** — before writing code, enter an **interactive plan-mode session** (Phase 3.5): present a written plan, surface open questions, get explicit approval. Runs *after* the worktree is claimed. Rejection routes to Phase 7 cleanup like a Phase 3 skip. **Ignored in `--swarm` mode when more than one issue actually runs** (state the skip); honored when swarm degenerates to the single-issue flow.
- **`--review-with` / `--review-iterations` / `--review-mode` / `--review-stop-on-findings` / `--review-stop-on-clean` / `--reviewer-applies`** — **passed through to `/do:pr`** in Phase 6, which owns the review/ship machinery. (`--review-mode series|parallel` selects how `/do:pr`'s multi-reviewer loop dispatches reviewers; series is the default.) Same grammar as every other slashdo command (see `/do:pr`). With neither `--review-with` nor `--no-review`, Phase 6 still decides whether the diff warrants a quality pass (`/simplify` or equivalent) — it never decides the external reviewer: `/do:pr` applies its own saved `--review-with` default, if any, and no reviewer is invented here.
- **`--no-review`** opts out of both the quality pass and the external pass. `/do:pr` has no `--no-review` flag of its own, so Phase 6 **translates it** rather than forwarding it verbatim: `--no-review` becomes `/do:pr --no-merge --review-with none`, which forces `REVIEW_AGENTS=[]` and skips any saved `review-with` default.
- **`--merge`** / **`--no-merge`** / **`--merge=<method>`** / **`--merge-method <method>`** — control **`/do:next`'s own merge**, not `/do:pr`'s: Phase 6 always ships through `/do:pr --no-merge` (review/ship pipeline only — see below), then `/do:next` itself merges the resulting PR once its own gate passes (single-issue Phase 6 / swarm Phase C). `--merge` (the **default**, accepted explicitly too) keeps that existing behavior — resolves `MERGE_ENABLED=true`. `--no-merge` resolves `MERGE_ENABLED=false`: **stop right after Phase 6 opens the PR** — report its URL, leave the worktree and (in issues mode) the assignee + `in-progress` claim in place, and **skip Phase 7 cleanup** — reusing the same stop path Phase 6 already uses for a `dirty`/`inconclusive` review result. If both `--merge` and `--no-merge` appear (directly, or via `--merge=<method>` standing in for `--merge`), abort with `--merge and --no-merge cannot be combined` (same wording as `/do:pr`). `--merge=<method>` sets `MERGE_ENABLED=true` **and** `MERGE_METHOD=<method>`; `--merge-method <method>` sets `MERGE_METHOD` alone, without implying `--merge`. `<method>` ∈ `squash`/`rebase`/`merge` (GitHub only — `glab mr merge` takes no method flag); reject an unrecognized value with `--merge=<method> must be one of squash, rebase, merge (got: {value}).` / `--merge-method must be one of squash, rebase, merge (got: {value}).`, and a conflicting pair (`--merge=squash --merge-method rebase`) with `--merge=<method> and --merge-method specify conflicting methods ({first} vs {second})` (identical methods are fine). With neither `--merge` nor `--no-merge` typed, resolve `MERGE_ENABLED` from the saved `merge` default, else the **built-in `true`** — `/do:next`'s built-in default is the opposite of `/do:pr`'s `false`, because `/do:next` has always merged once its own gate passed; `--no-merge` is a new opt-out, not a change to that default. `MERGE_METHOD` resolves the same way regardless of where it came from — see step 1 of the merge gate ([lib/merge-gate.md](../../lib/merge-gate.md)). **Under `--swarm`, only the enable/disable half is ignored** (state the skip): the orchestrator always attempts its own serialized merge in Phase C for every eligible result, so `--merge`/`--no-merge`/`MERGE_ENABLED` don't apply there, and every worker still ships via `/do:pr --no-merge` regardless of these flags. `--merge=<method>`/`--merge-method` still resolve `MERGE_METHOD` for that Phase C merge, through the same merge gate.
- **Any other `--flag`** not defined above aborts immediately, before any claim is made: `Unknown /do:next option: {flag}. Supported: --issues, --no-issues, --issues-label, --model, --effort, --self, --no-self, --collaborators, --no-collaborators, --trusted-authors, --swarm, --plan, --review-with, --review-iterations, --review-mode, --review-stop-on-findings, --review-stop-on-clean, --reviewer-applies, --no-review, --merge, --no-merge, --merge-method.`

## Conventions

Three shapes recur below and are defined once here, then invoked by name (a fourth — the GitLab-only `glab api` capture rule, a two-step capture never piped straight to jq — is defined in [lib/next-gitlab.md](../../lib/next-gitlab.md)).

**`PRIORITY_SORT`** — every open-issue walk's priority/oldest sort: a `priority<SEP><N>` label (lower N first) ranks first; no label sorts last (jq `infinite` — a finite sentinel like `9999` would tie a real `priority<SEP>9999` and let unlabeled work jump ahead); creation date breaks ties.
```
sort_by([ (([<labels> | select(test("^priority${LABEL_SEP}[0-9]+$")) | ltrimstr("priority${LABEL_SEP}") | tonumber] | min) // infinite), <created> ])
```
`<labels>`/`<created>` are `.labels[].name`/`.createdAt` on GitHub, `.labels[]`/`.created_at` on GitLab (mapping table in [lib/next-gitlab.md](../../lib/next-gitlab.md)) — `$LABEL_SEP` is never hardcoded, or this misses GitLab's scoped `priority::<N>`. `PRIORITY_SORT` means this fragment with the host's fields filled in; a filtered walk just prepends its `map(select(…))` clauses.

**The default-branch one-liner.**
```bash
DEFAULT_BRANCH="$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@' || true)"
DEFAULT_BRANCH="${DEFAULT_BRANCH:-$(git remote show origin | sed -n 's/.*HEAD branch: //p')}"
```
Git-native, not `gh repo view`/`glab repo view` — one less API round-trip, still works mid-auth-hiccup: local `origin/HEAD` first, remote query as fallback. **Shell variables do NOT persist across Bash tool calls — only the working directory does**, so every phase below that needs `DEFAULT_BRANCH` (or `SLUG`/`WORKTREE`) after Phase 2 re-declares them at the top of its own snippet, recomputing this one-liner rather than trusting it survived.

**`release_marker` — retracting an issues-mode claim without shipping it:** drop your assignee, drop the `in-progress` label.
- GitHub: `gh issue edit "$ISSUE_NUM" --remove-assignee @me --remove-label in-progress 2>/dev/null || true`
- GitLab: `glab issue update "$ISSUE_NUM" --assignee "-$ME" --unlabel in-progress 2>/dev/null || true`

## Swarm mode (`--swarm`)

**When `--swarm` is absent — the default — skip this section entirely and run Phases 1–7 below.**

When `SWARM` is true the swarm flow **replaces Phases 1–7**: it claims and ships up to `SWARM_N` independent open issues at once, each in its own worktree subagent running the normal single-issue flow, and serializes only the merge. Preconditions, the four swarm phases (A triage/partition, B fan-out, C merge queue, D reconcile), and the batch-abort rules all live in one file — read it only when `SWARM` is true:

!read lib/next-swarm.md

## Phase 1: Pick

**Pre-flight — `/do:next` requires GitHub (`gh`) or GitLab (`glab`), in BOTH modes.** It ships via `/do:pr`, which supports both hosts (including GitHub Enterprise and self-managed GitLab — both CLIs resolve a custom host from the `origin` remote), so even PLAN.md mode (git-only claiming) needs a working `gh`/`glab`. **Detect the host up front and abort if the matching CLI isn't authenticated — before claiming or implementing anything.** Same rule as `/do:pr`'s "Detect VCS Host" step and every other command that resolves `VCS_HOST`/`CLI_TOOL` (the `origin` remote is authoritative for the host; `auth status` only says which CLI is *usable*):

!read lib/vcs-host.md

Carry `CLI_TOOL`/`VCS_HOST` (and `GH_HOST` on GitHub) and `LABEL_SEP` through every later phase — [lib/plan-issue-setup.md](../../lib/plan-issue-setup.md)'s own setup step reuses `CLI_TOOL` rather than re-detecting it, and every prefixed-label match below (the priority sort key, the dispatch-hint filter) is built from `LABEL_SEP`, not a hardcoded `:` — a hardcoded colon would silently stop matching `priority::5` / `model::light` on a GitLab tracker.

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

### Phase 1 — PLAN.md mode (default)

1. **Locate the queue — auto-redirect to issues when PLAN.md isn't the source of truth.** Read `PLAN.md` from the repo root, then route:
   - **PLAN.md is absent, OR its body is the issue-mode stub** (`/do:replan --issues` empties PLAN.md to a "roadmap lives in the tracker" note — detect the sentinel phrase **"tracks its roadmap as issues"** or **"Managed by `/do:replan --issues`"**, i.e. a note pointing at the tracker with zero `- [ ]` items) → this repo is issue-tracked. **Unless the user explicitly typed `--no-issues`** — in that case report `No PLAN.md backlog and --no-issues was set — create a PLAN.md or drop --no-issues to work the tracker.` and stop — **switch to issue mode automatically**: set `ISSUE_MODE=true`, say `No PLAN.md backlog — this repo tracks work as issues; continuing in --issues mode.`, and continue from the issues-mode Phase 1 below (which runs the [lib/plan-issue-setup.md](../../lib/plan-issue-setup.md) setup). If that setup aborts because **no host is authenticated**, surface the abort (it tells them to run `gh auth login`/`glab auth login` or create a PLAN.md) — do NOT report an empty queue.
   - **PLAN.md exists with real `- [ ]` items** → continue in PLAN.md mode (steps 2–5).
   - **PLAN.md exists, is not the stub, but has zero `- [ ]` items** → report `PLAN.md has no open items.` and stop, suggesting `/do:replan` or `/do:goals` to populate it (or `--issues` to work the tracker).
2. **If any `- [ ]` line lacks a `[<slug>]` ID, stop and tell the user to run `/do:replan` first** (its Phase 0 populates IDs).
3. Keep raw in-flight segments that exactly match a slug present in PLAN.md — that's the in-flight set.
4. **Pick the target slug:**
   - **With argument** — verify the slug exists as a `- [ ]` line and is NOT in flight. If either fails, print why and stop.
   - **Without argument** — walk PLAN.md top-to-bottom; pick the FIRST `- [ ]` line where ALL hold: slug NOT in flight; the immediately-preceding line is NOT a `> ⚠️ DRIFT:` blockquote (drift items need a human-driven `/do:replan --interactive` decision); the line carries no `<!-- NEEDS_INPUT -->` annotation.
5. **If no eligible item exists**, print why (all in flight / all drifted / all NEEDS_INPUT / nothing unchecked) and stop. Do NOT invent new work — that's `/do:replan`'s job.

> **`<slug>` argument + auto-redirect.** If the user passed an explicit `<slug>` but the queue auto-redirected to issues, the slug can't be a PLAN item — say so and ask whether they meant an issue number (`#<num>`); don't silently reinterpret it.

### Phase 1 — issues mode (`--issues`)

Run the shared issue-mode setup — it reuses the `CLI_TOOL` the Pre-flight detected and aborts if neither host is authenticated (`PLAN_LABEL` is created lazily, in Phase 4, only if this run actually files a discovered-work issue). Read it only when `ISSUE_MODE=true`:

!read lib/plan-issue-setup.md

> **`/do:next` reads only the setup partial, not [lib/plan-issue-filing.md](../../lib/plan-issue-filing.md).** That file's dedup fetch, `--scan-only` recording, and bulk-spool path exist for commands that file and dedup *findings* in bulk; `/do:next` files at most one discovered-work issue (Phase 4), so dumping every open issue's body into context buys nothing. The step-1 walk below is the only open-issue listing this phase needs. If Phase 4 does file a discovered-work issue, check for a duplicate with a targeted search (`gh issue list --search "<keywords>"` / `glab issue list --search "<keywords>"`) instead.

> **Issue mode works on GitHub or GitLab.** The claim (Phase 2) uses the tracker's **assignee** field as the cross-machine marker on either host — GitHub via `gh issue edit --add-assignee`/`--remove-assignee`, GitLab via `glab issue update --assignee "+<user>"`/`--assignee "-<user>"` (the `+`/`-` prefix adds/removes one assignee without clobbering others, which the race read-back depends on). Every `gh` call in this phase has a `glab` equivalent selected by `$CLI_TOOL`. One structural gap: GitHub has a native project-scoped **sub-issues** API for epic/child resolution (step 3); GitLab's analog (group-level Epics) is a different, tier-gated feature, so on GitLab the **convention fallback** (body task-lists + `Part of #N` back-references, per [lib/epic-children.md](../../lib/epic-children.md)) is the primary path.

**GitLab only — read `lib/next-gitlab.md` now, before the first plain `glab api` call.**
It carries every GitLab-specific step this phase and the rest of `/do:next` need from
here on — the `jq` probe (`glab api` has no built-in `--jq` flag, only `glab issue`/
`glab mr` do, so this phase and Phase 2 pipe it to the standalone binary), the
collaborator fetch, the candidate-list walk, the Phase 2 claim, and the Phase 6 merge
— keyed by heading, plus the GitHub↔GitLab field-mapping table the jq expressions
below build on. Probe for `jq` now, not in the shared Pre-flight: PLAN.md mode never
calls plain `glab api`, so a pre-flight probe would abort a GitLab + PLAN.md repo that
never needed jq. A GitHub run never reads this file.

!read lib/next-gitlab.md

**Collaborator set — fetch once when `COLLAB_MODE` is on and `SELF_MODE` is not.** If `SELF_MODE` is on, skip this fetch (self is a subset). If `COLLAB_MODE` is off, skip it and do **not** apply `--trusted-authors` as a standalone gate. **Fail closed:** a failed call or an empty login set (the owner should always be present) aborts — never treat "couldn't list them" as any-author, and never fall open to `--trusted-authors` alone. Compare issue authors to the **trusted claim pool** (collaborators UNION `--trusted-authors`) **case-insensitively**.

**GitHub only — finish the `GH_HOST` derivation with the shared snippet below** before the `gh api` call in the block: `$ORIGIN_HOST` already is its first step, so seed `GH_HOST` with it and continue from the fallbacks, then run the per-host auth precheck. (GitLab: skip — `glab api` resolves the host from the remote itself.)

!`cat ~/.claude/lib/gh-host.md`

```bash
# owner/repo from origin for abort messages (gh/glab fill :owner/:repo themselves)
ORIGIN_URL="$(git remote get-url origin 2>/dev/null || true)"
OWNER_REPO="$(printf '%s' "$ORIGIN_URL" | sed -E 's#^[a-z]+://[^/]+/##; s#^[^@]+@[^:]+:##; s#\.git$##' | sed 's#^/##')"

if [ "$COLLAB_MODE" = "true" ] && [ "$SELF_MODE" != "true" ]; then
  [ -n "$OWNER_REPO" ] || {
    echo "Could not list collaborators for <owner/repo> — /do:next --collaborators cannot be enforced. Aborting."; exit 1; }
  if [ "$CLI_TOOL" = gh ]; then
    COLLAB_LOGINS="$(gh api --hostname "$GH_HOST" repos/:owner/:repo/collaborators --paginate -q '.[].login')" || {
      echo "Could not list collaborators for $OWNER_REPO — /do:next --collaborators cannot be enforced. Aborting."; exit 1; }
  else
    # GitLab — the glab api capture rule (lib/next-gitlab.md) sets these same two
    # variables the same fail-closed way; see its § Phase 1 — collaborator fetch.
    MEMBERS_JSON="$(glab api --paginate "projects/:id/members/all")" || {
      echo "Could not list collaborators for $OWNER_REPO — /do:next --collaborators cannot be enforced. Aborting."; exit 1; }
    COLLAB_LOGINS="$(printf '%s' "$MEMBERS_JSON" | jq -r '.[] | select(.access_level >= 30) | .username')" || {
      echo "Could not list collaborators for $OWNER_REPO — /do:next --collaborators cannot be enforced. Aborting."; exit 1; }
  fi
  [ -n "$COLLAB_LOGINS" ] || {
    echo "Could not list collaborators for $OWNER_REPO — /do:next --collaborators cannot be enforced. Aborting."; exit 1; }
  # Trusted claim pool = live collaborators UNION --trusted-authors (newline-separated).
  # Fail-closed already required COLLAB_LOGINS non-empty *before* this union, so an
  # extra-authors list cannot paper over a failed/empty collaborator fetch.
  TRUSTED_CLAIM_POOL="$COLLAB_LOGINS"
  if [ -n "$TRUSTED_AUTHORS" ]; then
    TRUSTED_CLAIM_POOL="$(printf '%s\n%s\n' "$TRUSTED_CLAIM_POOL" "$(printf '%s' "$TRUSTED_AUTHORS" | tr ',' '\n')")"
  fi
fi
```

GitLab collaborators are project members who can push (`access_level >= 30` Developer, including inherited members via `members/all`).

Then:

1. **List candidates** — open issues, **by priority then oldest-first**, **across all labels by default** (`gh issue list`/`glab issue list` never return pull/merge requests). By default there is no author filter and no required label — the guards are the parking-label skip (step 3), the declared-dependency skip (step 4), and the in-flight/assigned checks. Four opt-in narrowings: `LABEL_FILTER` restricts to one curated label; the **dispatch-hint filter** (`MODEL_FILTER` / `EFFORT_FILTER`) restricts to matching `model:`/`effort:` labels; **when `SELF_MODE` is on**, `--author "@me"` restricts to issues YOU filed; when `COLLAB_MODE` is on and `SELF_MODE` is not, there is no API-side author flag, so fetch `author` on each issue and **skip** anyone outside the trusted claim pool during the walk (after the dispatch-hint filter, before pick), noting `#N filed by <author> — not a collaborator (and not on --trusted-authors)`. The author filters are a **security boundary**, not advisory ordering: they remove untrusted issues from consideration entirely.
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
   # The --jq below is PRIORITY_SORT (Conventions) in its GitHub form. `body` is
   # deliberately NOT listed: steps 3–4 fetch it per candidate, so the walk never loads
   # every open issue's body into context just to pick one.
   LIST_ARGS=(--state open)
   [ -n "$LABEL_FILTER" ] && LIST_ARGS+=(--label "$LABEL_FILTER")
   [ "$SELF_MODE" = "true" ] && LIST_ARGS+=(--author "@me")
   gh issue list "${LIST_ARGS[@]}" --limit 500 \
     --json number,title,assignees,labels,createdAt,author \
     --jq "PRIORITY_SORT | .[]"
   ```
   The `--limit 500` avoids truncating the queue before the client-side sort (`gh issue list` defaults to 30). A repo with >500 open candidates is pathologically large (`/do:replan --issues` to prune, or `--issues-label` to scope); note the cap rather than silently dropping the overflow. **Priority is advisory ordering, not a gate** — an unprioritized issue is still claimable.

   **On GitLab, the same walk uses `glab issue list` — field names and shapes differ, not just the binary** (see the mapping table in [lib/next-gitlab.md](../../lib/next-gitlab.md), read above). **See that file's "Phase 1 — issues mode: candidate list"** for the equivalent `glab issue list` call — the two-step `ME` resolution (a `--self` run needs the authenticated username, since `glab` doesn't resolve `@me`), the `--per-page 100` cap (lower than `gh`'s 500, same "note the cap" guidance), and the `description`-projected walk.

   **Dispatch-hint filter — client-side, in the same list-and-filter program.** When `MODEL_FILTER` / `EFFORT_FILTER` is non-empty, `map(select(…))` the array **before** `sort_by`, one clause per active axis. It cannot go in `LIST_ARGS`: repeated `--label` flags AND together on both hosts — the opposite of the OR this flag means. Build each clause from the **validated enum values only**, where `<axis>` is `model`/`effort`, `V1…Vn` are the requested values with the `none` sentinel removed, and `<SEP>` is `$LABEL_SEP` (`:` on GitHub, `::` on GitLab — an exact-match clause built with a hardcoded `:` never matches a GitLab issue's `model::light`):
   ```
   # GitHub (labels are {name: "..."} objects) — membership clause, present whenever
   # at least one real value was requested:
   any(.labels[].name; . == "<axis><SEP>V1" or . == "<axis><SEP>V2" …)
   # untiered clause — OR'd in ONLY when `none` was among the values:
   ([.labels[].name | select(startswith("<axis><SEP>"))] | length == 0)

   # GitLab (labels are plain strings) — same two clauses without the `.name`:
   any(.labels[]; . == "<axis><SEP>V1" or . == "<axis><SEP>V2" …)
   ([.labels[] | select(startswith("<axis><SEP>"))] | length == 0)
   ```
   An axis whose only value is `none` uses the untiered clause alone. Worked example — `--model light,none --effort max`:
   ```bash
   # GitHub ($LABEL_SEP is ":")
   gh issue list "${LIST_ARGS[@]}" --limit 500 \
     --json number,title,assignees,labels,createdAt,author \
     --jq "map(select(any(.labels[].name; . == \"model${LABEL_SEP}light\")
                    or ([.labels[].name | select(startswith(\"model${LABEL_SEP}\"))] | length == 0)))
         | map(select(any(.labels[].name; . == \"effort${LABEL_SEP}max\")))
         | PRIORITY_SORT | .[]"
   ```
   `PRIORITY_SORT` (Conventions) with the two `map(select(…))` clauses above prepended.
   **GitLab ($LABEL_SEP is `::`)** — the same worked example against `glab issue list`, same two clauses without `.name`: see [lib/next-gitlab.md](../../lib/next-gitlab.md) "Phase 1 — issues mode: candidate list".
   Omit the `map` for an inactive axis entirely rather than emitting `select(true)`. **This filter runs before every other skip**, so an excluded issue is never considered for the parking-label / dependency / epic checks — and exclusion here means "not what you asked for," not "not workable." Report it that way in step 7: if the filter emptied a queue that had eligible work, say which filter did it, **writing the flags space-separated, exactly as they'd be typed** (`no eligible issue matching --model light --effort max — 14 open issues carry no dispatch hint; add `none` to include them`) — comma-joined they'd read as one axis's OR-list.
2. **Determine in-flight issues.** Issue `N` is in flight if EITHER `issue-N` appears in the raw in-flight set, OR the issue **already has an assignee** (the Phase 2 marker — a local-only branch on a sibling machine is invisible here, but its assignee is not).
3. **Resolve epics before picking (child-aware).** An epic (umbrella issue) is **not** a single claimable unit — its done-ness depends on its children. For any candidate that is an epic (carries `epic`/a repo umbrella label, has native sub-issues, or whose body — fetched per candidate, see step 4 — task-lists other issues), classify it with the shared epic logic — read it only when a candidate is an epic:

!read lib/epic-children.md

   Act on the resulting state:
   - `epic-open` (≥1 child still OPEN) → **skip** as not-yet-workable; note `epic #N: X/Y children open`.
   - `epic-done` (all children CLOSED, no wrap-up tasks) → nothing to implement; **close it inline** using [lib/epic-children.md](../../lib/epic-children.md)'s "Closing an epic" step (GitHub: `gh issue close "$N" --comment "..."`; GitLab: `glab issue note "$N" -m "..." && glab issue close "$N"`), note it, and keep scanning.
   - `epic-wrapup` (all children CLOSED, wrap-up tasks remain) → **this IS claimable work**: "complete epic #N's remaining wrap-up tasks." Claim it like any issue — Phase 4 does the wrap-up (and ticks the wrap-up checkboxes in the epic body), and the Phase 6 PR carries `Closes #<N>`.
   - `epic-empty` (no children resolvable either way) → treat as an ordinary issue.
4. **Resolve declared dependencies before picking (blocked-by).** A candidate may declare a hard dependency in its **body**: a line matching `Depends on #<N>` or `Blocked by #<N>` (case-insensitive; one line may list several, e.g. `Depends on #12, #15`). Collect every `#<N>` on those lines. The step-1 walk omits bodies, so **fetch the body for this candidate only**, when you evaluate it (GitHub: `gh issue view <N> --json body -q .body`; GitLab: `glab issue view <N> --output json --jq .description`) — the same fetch serves step 3's task-list check. A candidate is **blocked** when ANY referenced issue is still open — check the freshest state (GitHub: `gh issue view <N> --json state -q .state`; GitLab: `glab issue view <N> --output json --jq .state`) and test for "closed" rather than an exact "open" match (`OPEN`/`CLOSED` vs `opened`/`closed`); a referenced number that is closed, or doesn't exist, does not block. Resolve **lazily** as you walk (only for the candidate you're about to pick).
   - `blocked` (≥1 referenced issue still open) → **skip** in auto-pick; note `#N blocked by #M (open)`. Self-clearing: when #M closes, #N becomes eligible.
   - Also honor each host's **native** blocked-by relationship when the API surfaces it — GitHub's GraphQL `blockedBy` connection, or GitLab's Issue Links API filtered to `link_type: "is_blocked_by"` (GitLab: capture first, then filter, per the glab api capture rule ([lib/next-gitlab.md](../../lib/next-gitlab.md)) — `LINKS_JSON="$(glab api projects/:id/issues/<N>/links)" || <treat as UNRESOLVED>` then `printf '%s' "$LINKS_JSON" | jq '.[] | select(.link_type == "is_blocked_by")'`; collapsed into one pipeline, a links-API outage would read as "no native blockers" and the picker would **fail open**). **A failed lookup is UNRESOLVED, not unblocked:** fall back to the body convention alone for that candidate and say so (`#N: native blocked-by lookup failed — using the body convention only`). The two sources are OR'd (blocked by *either* ⇒ skip).
   - **Cycle / unresolvable chain** (A depends on B, B depends on A) → both stay skipped; note the cycle so a human can break it. Never loop trying to resolve one.
5. **Pick the target issue:**
   - **With argument** — the issue number (strip `#`); **set `ISSUE_NUM` to that stripped number now** so the checks below can reference `$ISSUE_NUM`. Verify open and NOT in flight. **`--self` first, as a hard gate:** when `SELF_MODE` is on, confirm the issue's author is the running account — GitHub: `gh issue view "$ISSUE_NUM" --json author -q .author.login` must equal `gh api --hostname "$GH_HOST" user -q .login`; GitLab: `glab issue view "$ISSUE_NUM" --output json --jq .author.username` must equal the authenticated login, read as `glab api user` piped to `jq -er .username` per the glab api capture rule ([lib/next-gitlab.md](../../lib/next-gitlab.md)), exactly as the Phase 2 claim snippet does; if it does not, **refuse and stop** with `Issue #<num> was filed by <author>, not you — /do:next --self only works on issues you filed. Drop --self to claim it.` **`--collaborators` next, as a sibling hard gate:** when `COLLAB_MODE` is on and `SELF_MODE` is not, confirm the author (same `gh issue view`/`glab issue view` fields) is in `TRUSTED_CLAIM_POOL`, compared **case-insensitively**; if not, **refuse and stop** with `Issue #<num> was filed by <author>, who is not a collaborator on <owner/repo> (and not on --trusted-authors) — /do:next --collaborators only claims collaborator-authored issues. Drop --collaborators to claim it.` These are the **skips an explicit number does NOT override** — `--self` and `--collaborators` are security boundaries, not curation preferences. If it's an epic, resolve its state (step 3) first — claim an `epic-wrapup`, close an `epic-done`, or warn that children are still open on an `epic-open` (the explicit request still overrides — say so). Otherwise a named number is an **explicit override**: it claims even an issue auto-pick would skip — a parking-labelled one, one with an **open declared blocker** (step 4), one outside an active `LABEL_FILTER`, or one outside an active `MODEL_FILTER`/`EFFORT_FILTER`. State plainly when you're overriding a skip (e.g. "claiming `future`-labelled #123 by explicit request", "claiming #123 despite open blocker #120 by explicit request", "claiming `model:heavy` #123 despite --model light by explicit request"). If any other check fails (closed, in flight), print why and stop.
   - **Without argument** — pick the FIRST candidate in the priority/oldest walk (step 1) that is NOT in flight, NOT already assigned, NOT carrying a parking label (`blocked`, `needs-input`, `wontfix`, `discussion`, `future`, or any repo-specific parking label — skip and note it), NOT blocked by an open declared dependency (step 4 — skip and note it), NOT an `epic-open`/`epic-done` epic per step 3 (an `epic-wrapup` epic **is** eligible), and — **when `COLLAB_MODE` is on and `SELF_MODE` is not** — NOT authored by someone outside the trusted claim pool (skip and note `#N filed by <author> — not a collaborator (and not on --trusted-authors)`; GitHub author is `.author.login` from the list payload, GitLab is `.author.username`; compare case-insensitively). An explicit `#num` can still claim a skipped issue; auto-pick never surfaces one.
6. **Set `ISSUE_NUM=<num>` and `SLUG="issue-${ISSUE_NUM}"`** — later phases use `SLUG` for worktree/branch/commit/PR and `ISSUE_NUM` for `gh issue`/`glab issue` calls.
   - **Surface the claimed issue's dispatch hint, if it carries one** (`model:<tier>` / `effort:<level>`): `#42 hints model:heavy + effort:high`. In the **single-issue** flow this is a *report, not a dispatch* — a session cannot switch its own model or effort mid-run. On a real mismatch say so (`this session is on <current model> and #42 hints model:heavy — consider restarting on a stronger model, or continue as-is`), naming this CLI's model-switch mechanism if it has one, then continue; never stall over an advisory label. Swarm is where the hint is *applied* (Phase B).
7. **If no eligible issue exists**, print why and stop — and **name the filter that emptied the queue** when one did (`LABEL_FILTER`, `MODEL_FILTER`/`EFFORT_FILTER`, `SELF_MODE`, or `COLLAB_MODE`), since an opt-in narrowing that hides workable issues looks identical to having none. Do NOT open new issues here — that only happens for work *discovered while implementing* (Phase 4/6).

## Phase 2: Claim (worktree) — REQUIRED, NOT OPTIONAL

> `/do:next` always uses a worktree so a *second* `/do:next` in another tab doesn't fight over the main repo's working tree. **A `/do:next` without a worktree is a broken claim — it blocks every subsequent claim until cleaned up.**
>
> - ❌ NEVER `git checkout -b next/<slug>` or `git switch -c next/<slug>` in the main repo.
> - ✅ ALWAYS use `git worktree add` with an explicit path, then `cd` in and verify with `pwd`. (The bash-tool "avoid `cd`" guidance does not apply — invoking `/do:next` is a request for a working-directory change.)

The worktree is a **sibling directory** (`../next-<slug>`) on branch `next/<slug>`; in issues mode `<slug>` is `issue-<num>`. Run as a **single Bash invocation** so the shell vars stay in scope, substituting the real slug:

```bash
SLUG="<picked-slug>" && \
# Fail-closed pre-check: if origin ALREADY has this claim branch, a sibling machine
# claimed it between Phase 1's scan and now — abort and re-pick (don't build a worktree
# you'll just discard). This catches the common cross-machine collision cheaply.
if git ls-remote --exit-code --heads origin "next/${SLUG}" >/dev/null 2>&1; then
  echo "next/${SLUG} already on origin — another machine claimed it; re-run /do:next to pick the next item."; exit 1
fi && \
# The default-branch one-liner (Conventions):
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

**Verify `pwd` is the worktree path**, not the main repo. If it printed the main repo path, the worktree creation or `cd` failed — STOP, report the error, do not proceed. **Re-anchor every later Bash call** with `cd "${WORKTREE}"` or absolute paths. **Re-export `WORKTREE` and `DEFAULT_BRANCH` at the top of each subsequent Bash snippet**, per the default-branch one-liner's rule (Conventions) — otherwise they'd expand empty in Phases 5/6/7.

> **Claim exclusivity is best-effort by design — not a distributed lock.** The `ls-remote` pre-check + immediate push narrow the cross-machine race to the sub-second window in which two machines both pass the pre-check before either's push lands (a plain `git push` of an identical-commit branch succeeds for both). The load-bearing protection is the in-flight branch/PR scan; the markers just shrink the window. True ref-CAS locking is deliberately out of scope; a sub-second race surfaces at PR time (two PRs for one slug) and you close one.

### Phase 2 — mark the issue in progress (issues mode only)

Immediately after the worktree is verified, claim the issue **on the host** so a `/do:next --issues` on any other machine sees it as taken (Phase 1's assignee check is the reader). Do this before writing code:

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
  # GitLab — lib/next-gitlab.md § Phase 2 — claim explains why this resolves the
  # login in two steps (not one `| jq` pipeline) and guards it non-empty before
  # using `+` to ADD one assignee without touching whatever's already on the issue
  # (a bare `--assignee "$ME"` would REPLACE the list and defeat the read-back below).
  ME_JSON="$(glab api user)" && ME="$(printf '%s' "$ME_JSON" | jq -er .username)" && [ -n "$ME" ] && glab issue update "$ISSUE_NUM" --assignee "+$ME"
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

**The race-detected branch is a hard stop, not a warning.** When the read-back shows another assignee, you have NOT claimed the issue — release your assignee, run Phase 7 cleanup to remove the worktree + branch, and re-enter Phase 1 for the next eligible issue. Only the `else` branch (you are the sole assignee) proceeds to Phase 3.

The re-read narrows the race to the window between the assignee add and the read-back — not a true distributed lock (two reads can interleave so both yield, or in a tie both proceed), but close to compare-and-swap. The assignee is the marker; the label is convenience. **If you must stop after this, run `release_marker`** (Conventions) — so a half-claimed issue isn't stranded as "taken."

## Phase 3: Verify still valid

Before writing code, sanity-check that executing the item as worded won't regress newer work. **Ask the user before proceeding if ANY hold:**

- **(PLAN.md)** The picked line has a `> ⚠️ DRIFT:` blockquote (double-check the filter), OR `git blame -L <line>,<line> -- PLAN.md` shows it was added in the last 24h AND conflicts with a since-merged commit.
- **(issues)** The full issue body/comments (GitHub: `gh issue view <num> --comments`; GitLab: `glab issue view <num> --comments`) supersede the title, the issue is already resolved, it's a pure discussion/question with no actionable change, or it awaits an unanswered clarification.
- **(both)** The item references a function/file/component that no longer exists or was heavily rewritten — `grep -rn` the named identifiers; if absent, it's stale and needs a human re-spec. OR it depends on an unshipped predecessor. OR the work would touch >5 unrelated files (bigger than estimated).

On "skip", run Phase 7 cleanup and re-run Phase 1 for the next item. **In issues mode also run `release_marker`** (Conventions) — the same release Phase 2 uses to yield.

## Phase 3.5: Plan (interactive) — only when `--plan` was passed

Skip unless `--plan` is set. When present, don't touch code yet:

1. **Gather just enough context to plan** — read the files the item names, grep its identifiers, confirm integration points.
2. **Enter plan mode** (via the harness's plan-mode entry, e.g. `EnterPlanMode` under Claude Code) and present: the item (slug/`issue-<num>`), approach, files to add/change, tests, and any migration/compat/changelog obligations the repo's CLAUDE.md triggers.
3. **Clarify interactively** — ask only the questions whose answers change the implementation; pick obvious defaults and state them.
4. **Get explicit approval** (via the harness's plan-approval exit, e.g. `ExitPlanMode`) before Phase 4. Don't implement on an unapproved plan.
5. **On rejection/stop** — treat exactly like a Phase 3 skip: Phase 7 cleanup, and in issues mode release the marker.

## Phase 4: Implement

Write the code, tests, and docs the item requires, following the **target repo's** `CLAUDE.md` conventions. Run the relevant test suite as you go.

**Claimed an `epic-wrapup` epic** (Phase 1 step 3)? The work unit is the epic's own remaining wrap-up tasks. Do them, then **tick the corresponding `- [ ]` boxes in the epic body** — GitHub: `gh issue edit "$ISSUE_NUM" --body …`; GitLab: `glab issue update "$ISSUE_NUM" --description …`. The Phase 6 PR's `Closes #<epic>` closes it on merge.

**Roll discovered backbone work INTO this PR — don't defer it.** A helper to extract, a shared abstraction, a small refactor that makes the fix cleaner — fold it in, test it, mention it in the PR body. Only defer work that is **genuinely large** (its own multi-file feature, a migration, a cross-cutting redesign). The bar is "this needs its own PR," not "slightly outside the line-item's wording."

**Where deferred work lands depends on the mode:**
- **PLAN.md mode** → add a NEW `- [ ] [<slug>] **Title** — rationale` item (slug per [lib/plan-id-format.md](../../lib/plan-id-format.md)).
- **Issues mode** → file a NEW tracker issue (never PLAN.md), with enough context to pick up cold (file paths, why split out, which issue surfaced it), tagged `PLAN_LABEL` so `/do:next --issues` and `/do:replan` treat it as queued. **Add a dispatch hint (`model${LABEL_SEP}<tier>` / `effort${LABEL_SEP}<level>`) when you can justify one**; leave the axis off rather than guessing, per [lib/plan-issue-setup.md](../../lib/plan-issue-setup.md) "The dispatch hint". `PLAN_LABEL` is created **lazily** (Phase 1's setup no longer creates it upfront), so create it — along with any hint label — immediately before applying it (GitHub: `gh label create <name> --color <hex> 2>/dev/null || true`; GitLab: `glab label create --name <name> --color "#<hex>" 2>/dev/null || true`, colors in that file), then create the issue using that file's `<label flags>` form:
  ```bash
  # GitHub
  gh label create "$PLAN_LABEL" --description "Tracked by slashdo" 2>/dev/null || true
  gh issue create --title "<concise actionable title>" --label "$PLAN_LABEL" \
    <hint label flags — e.g. --label "model${LABEL_SEP}<tier>" and/or --label "effort${LABEL_SEP}<level>"; OMIT ENTIRELY when you can't justify one> \
    --body "$(printf 'Discovered while working issue #%s.\n\n<what, where (file:line), why it needs its own PR>\n' "$ISSUE_NUM")"
  # GitLab
  glab label create --name "$PLAN_LABEL" --color "#428BCA" 2>/dev/null || true
  glab issue create --title "<concise actionable title>" --label "$PLAN_LABEL" \
    <hint label flags — same as above, same placeholder rule> \
    --description "$(printf 'Discovered while working issue #%s.\n\n<what, where (file:line), why it needs its own PR>\n' "$ISSUE_NUM")"
  ```
  The hint flags are a **placeholder like every other `<…>` in that command, not a default** — never copy a literal `model:light` / `effort:high` through, and always build the separator from `$LABEL_SEP`, not a hardcoded `:` — a stamped pair on every discovered issue poisons `/do:next --model`, and a hardcoded `:` silently fails to apply GitLab's scoped-label exclusivity.

**Commit messages.** Reference the slug in the subject so the work is grep-able across changelog, branches, and PR titles: `feat([<slug>]): <one-line description>` (use `fix:`/`refactor:`/`chore:` per conventional prefixes).

## Phase 5: Record completion + changelog

> **Re-sync with the default branch BEFORE editing tracked files.** Every claim touches the same changelog (and, in PLAN.md mode, the backlog list); editing the stale claim-start snapshot silently *re-adds* lines sibling claims removed. From inside the worktree:
> ```bash
> # Re-declare (Conventions; `-C` since we haven't cd'd yet):
> SLUG="<picked-slug>"; WORKTREE="../next-${SLUG}"
> DEFAULT_BRANCH="$(git -C "${WORKTREE}" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@' || true)"
> [ -n "$DEFAULT_BRANCH" ] || DEFAULT_BRANCH="$(git -C "${WORKTREE}" remote show origin | sed -n 's/.*HEAD branch: //p')"
> cd "${WORKTREE}" && git fetch origin "${DEFAULT_BRANCH}" && git merge --no-edit "origin/${DEFAULT_BRANCH}"
> ```
> **Conflict rule — deletions win.** Resolve any PLAN.md / changelog conflict so a line removed on *either* side stays removed; keep additions from both. Then `git add` the **specific resolved files** and `git commit --no-edit`. **Do NOT `git add -A`/`git add .` while paths are still unmerged** — that stages raw conflict markers. A clean merge needs no commit. Phase 6 re-syncs under this same rule.

**Mark the work item done:**
- **PLAN.md mode** — **remove the picked `- [ ]` line outright** (the changelog and git history are the audit trail; don't leave a checked `- [x]` behind unless the repo keeps items as a design log). If removing it empties a heading, leave the heading — section curation is `/do:replan`'s job.
- **Issues mode** — **don't touch PLAN.md.** Close the issue via `Closes #<num>` in the PR body (Phase 6).

**Changelog (both modes).** Log the shipped work **the way this project already logs changes**. Resolve the convention the same way `/do:push` does (stated convention in `CLAUDE.md` / `AGENT.md` / `AGENTS.md` / `CONTRIBUTING.md` first; otherwise imitate existing changelog artifacts — a rolling `CHANGELOG.md`, a per-release directory with an unreleased staging file, a fragment tool like `.changeset/` or `changelog.d/`; otherwise nothing). If the project has **no** file-based changelog (release notes derived from commit messages), skip this step — the PR title and commits carry the entry. Never invent a changelog file.

Whatever the format: **lead the bullet with the slug in brackets**, and write for a *user* of the app, not a coder inside it (no file paths, module/function names, test counts) — purely internal work may be described in code terms. Match the existing entries' grouping; with no established shape, prefer a `##` heading named for the feature or capability touched (e.g. `## PR review loop`) over generic `Added`/`Changed`/`Fixed` buckets.

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

`/do:pr` owns the entire review/ship pipeline — the required Local Code Review gate, `--review-with` multi-reviewer loop, `--review-iterations`, stop-modes, and `--reviewer-applies`. **Do not re-implement any of it here.** From inside the worktree, decide the review intensity, then invoke the workflow defined in `~/.claude/commands/do/pr.md` (`/do:pr`), forwarding **only the review flags listed in Parse Arguments** (`--review-with` / `--review-iterations` / `--review-mode` / `--review-stop-on-findings` / `--review-stop-on-clean` / `--reviewer-applies`) — translating `--no-review` to `--review-with none` rather than forwarding it verbatim (`/do:pr` has no `--no-review` flag of its own) — never this command's own `--merge` / `--no-merge` / `--merge=<method>` / `--merge-method`, which `/do:next` resolves for itself (below) and never relays to `/do:pr`. **Always pass `--no-merge` to `/do:pr`** — `/do:next` owns the merge decision (the gate below, additionally gated on this run's `MERGE_ENABLED`), the post-merge cleanup, and `Closes #<num>` handling, even when a global `/do:config --merge` default would otherwise make `/do:pr` auto-merge:

> **A note on `/simplify`.** `/simplify` is the harness's built-in quality pass (Claude Code ships one); if absent, do the pass by hand. It is **not** `/do:simplify` (slashdo's own refactor-audit workflow, which opens per-category PRs — do not reach for it mid-run).

| The user passed… | Run |
|---|---|
| `--review-with=<agents>` | `/simplify` if available (skip when the diff is genuinely trivial), then `/do:pr --no-merge --review-with=<agents>` (pass through `--review-iterations` / `--review-mode` / stop-mode / `--reviewer-applies` verbatim) |
| `--no-review` | `/do:pr --no-merge --review-with none` — its Local Code Review gate still fires; no external pass, no `/simplify` |
| neither | Judge the diff for the quality pass only (`/simplify` if available for new code paths / abstractions / multi-file work; skip for a value swap / typo / single-line fix). Then run `/do:pr --no-merge` with **no review flags at all** — `/do:pr` resolves its own saved `--review-with` default, if any. **Never pick or pass a reviewer here.** If the diff is non-trivial and `/do:pr` reports no reviewer ran, say so in the summary and suggest `--review-with` / `/do:config --review-with`. State the call before acting. |

State any skip/trim and why ("Diff is 3 lines in one file; skipping the quality pass and external review — matches existing pattern"). `/do:pr` pushes `next/<slug>`, opens the PR (include `Closes #<num>` in issues mode), runs the chosen review loop, and reports the aggregate status.

**Gate the merge on the review result — do NOT merge unconditionally.**

- **`MERGE_ENABLED` must be `true`** (Parse Arguments' `--merge`/`--no-merge` resolution). `--no-merge` (or a saved `merge=false` default) stops here unconditionally, whatever the review status.
- **`/do:pr` always reports an aggregate `OVERALL_STATUS`** — `clean` when `REVIEW_AGENTS` resolved empty (no external reviewer ran: `--no-review`, `--review-with none`, or no flag and no saved default), otherwise the aggregate of whichever reviewers actually ran. **Gate on that report, not on which review flags this run typed** — an external review can run even when `/do:next` passed no `--review-with`, because `/do:pr` may have applied its own saved `--review-with` default (Parse Arguments, above). Read `/do:pr`'s report, not the flags you sent it.
- **Never merge on `dirty`** (build/test broken, or a hard-error short-circuit) **or `inconclusive`** (a requested reviewer was missing / timed out / errored / was skipped). **Merge only on `clean`** (or `partial` *and* you explicitly passed a `--review-stop-on-*` flag).

On `dirty`/`inconclusive`, or when `MERGE_ENABLED=false` (`--no-merge`), **stop and leave the PR open**: report the status (or, for `--no-merge`, that merging was skipped by request) and the PR URL, do NOT merge, and do NOT run Phase 7 cleanup (the worktree/branch, and in issues mode the assignee + `in-progress` claim, must stay so the work can be finished — by a human, on `--no-merge`, or by fixing the review/CI on `dirty`/`inconclusive`).

**Encode the slug in the PR title** if `/do:pr` didn't — GitHub: `gh pr edit <num> --title "feat([<slug>]): <description>"`; GitLab: `glab mr update <num> --title "feat([<slug>]): <description>"`.

**Re-sync, then merge (only when the gate above passed).** A long review loop can let sibling claims merge after your Phase-5 sync — re-sync once more so a stale PLAN.md can't resurrect their removed items:

```bash
# Re-declare (Conventions; `-C` since we're not cd'd here):
SLUG="<picked-slug>"; WORKTREE="../next-${SLUG}"
DEFAULT_BRANCH="$(git -C "${WORKTREE}" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@' || true)"
[ -n "$DEFAULT_BRANCH" ] || DEFAULT_BRANCH="$(git -C "${WORKTREE}" remote show origin | sed -n 's/.*HEAD branch: //p')"
cd "${WORKTREE}" && git fetch origin "${DEFAULT_BRANCH}" && git merge --no-edit "origin/${DEFAULT_BRANCH}"
```

**If that merge reports a conflict**, **STOP and resolve it by hand** under Phase 5's **deletions win** rule (and its ban on `git add -A` while paths are unmerged). Only once `git status` shows no unmerged paths is it safe to push and merge.

**Merge through the shared merge gate.** Reach this step only when the review gate above passed and the tree has no conflicts. `/do:pr` ran with `--no-merge`, so its CI gate never fired, and the gate's push publishes a **new SHA** whose checks have not run yet. The gate waits on the required checks before it merges. Run it from inside `${WORKTREE}` with these inputs: `{PR}` is the PR/MR number, `{GIT}` is `git`, `{MODE}` is `wait`, `{LINKED_WORKTREE}` is `1`, and `{MERGE_METHOD}` is the `MERGE_METHOD` from Parse Arguments (it may be unset). **Skip the remote delete in the gate's step 5; Phase 7 owns it.** Phase 7 deletes the local branch first, because `git branch -d` checks the branch against its remote-tracking ref, and deletes the remote branch after that:

!read lib/merge-gate.md

If the gate returns **merged**, continue to Phase 7. If it returns **queued** or **left open** (no method resolved, a required check really failed, or the read-back is not `MERGED`/`merged`), leave the PR open, report why, and skip Phase 7, as for `dirty`.

## Phase 7: Clean up

**If this run opened and merged a PR, confirm it actually merged before touching
anything.** (A run that never opened one — a Phase 2 race hard-stop, a Phase 3 skip, or a
Phase 3.5 reject — has no PR to read back: skip this gate entirely and go straight to the
**Abandoned a claim** teardown below.) This phase removes the worktree first, so it relies on the merge gate's step 5 read-back. If that read-back returned anything other than **merged** (for example, a merge queue accepted the PR while it is still open), **run none of this phase** — leave the worktree, branch, issue, and `in-progress` marker exactly as they are, and report the PR as queued/left-open.

From the **main repo** (not the worktree), as a single Bash invocation, re-substituting the slug and worktree path stashed in Phase 2:

```bash
SLUG="<picked-slug>" && \
WORKTREE="../next-${SLUG}" && \
# Recompute the default branch (Conventions) and sync THAT branch's local ref
# explicitly — not "whatever HEAD happens to be" — WITHOUT switching the main
# repo's checkout. /do:next may have been launched from a feature branch in the
# main repo, and this phase never touches that checkout (see the Phase 2 box): if
# the default branch is already checked out, fast-forward it in place; otherwise
# update its ref via a plain fetch refspec, leaving whatever branch the user had
# open untouched.
DEFAULT_BRANCH="$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@' || true)" && \
DEFAULT_BRANCH="${DEFAULT_BRANCH:-$(git remote show origin | sed -n 's/.*HEAD branch: //p')}" && \
git worktree remove "${WORKTREE}" && \
if [ "$(git branch --show-current)" = "${DEFAULT_BRANCH}" ]; then
  git pull --ff-only --autostash
else
  git fetch origin "${DEFAULT_BRANCH}:${DEFAULT_BRANCH}" || {
    echo "note: local ${DEFAULT_BRANCH} could not fast-forward (or is checked out elsewhere) — leaving it alone"
    git fetch origin "${DEFAULT_BRANCH}"
  }
fi && \
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

(Order matters: remove the worktree, **sync the default branch's ref without switching the checkout, delete the local claim branch, and only THEN touch the remote** — every step is `&&`-gated, so a failure never removes the claim branch while the default branch ref is stale, and **the remote-delete is the LAST link**, so a failed/partial cleanup that may still hold unmerged work never retracts the remote claim. This phase never runs `git checkout` in the main repo: the sync step above either fast-forwards `${DEFAULT_BRANCH}` in place when it's already the checked-out branch, or updates its ref via a plain `git fetch` refspec when it isn't — leaving whatever branch the user had open untouched, and leaving a non-fast-forwardable ref alone (noted, not forced) rather than failing the whole cleanup. `git branch -d` needs none of this to be correct: it checks the claim branch against its own tracked upstream, not against `${DEFAULT_BRANCH}`, so a stale or skipped sync never blocks the delete. Since the merge did **not** pass `--delete-branch`, this trailing delete is the real remote deletion, and a failure must be **distinguished, not swallowed**: a blanket `|| true` would report a clean sweep while the claim branch survives on the remote, where Phase 1's in-flight scan reads the item as claimed on every machine, forever. The `git ls-remote` fallback treats an already-gone branch (GitLab's `--remove-source-branch`, or auto-deleted merged heads) as success and anything else as a failure of the chain.)

**Abandoned a claim (Phase 2 abort/yield, Phase 3 skip, or Phase 3.5 reject — no PR, work discarded)?** The branch is unmerged, so `git branch -d` won't remove it. Retract the claim explicitly (force-delete local, delete remote) and **verify the remote retract landed** — Phase 2 published this branch, and a silently failed delete leaves a phantom claim that Phase 1's in-flight scan honours forever, with no local artifact to hint at it. From the main repo:

```bash
git worktree remove --force "${WORKTREE}"
git branch -D "next/${SLUG}"
if ! git push origin --delete "next/${SLUG}"; then
  git ls-remote --exit-code --heads origin "next/${SLUG}" >/dev/null 2>&1; RC=$?
  [ "$RC" -eq 2 ] || echo "ERROR: claim NOT retracted — delete next/${SLUG} manually (ls-remote rc=$RC)"
fi
```

(Phase 2's abort/yield branches — the claim-failed hard stop and the race-lost yield — retract the remote branch inline as soon as they detect the problem; they leave the local worktree and branch for this same teardown, run from the main repo.)

**Issues mode — confirm closed, then clear the marker — but only for a PR that actually merged.** Anything other than `MERGED`/`merged` on the read-back means nothing shipped — leave the issue open with its `in-progress` label and assignee, and report the PR as queued/left-open. For a merged PR, `Closes #<num>` auto-closes the issue on merge to the **default branch**. Verify (GitHub: `gh issue view <num> --json state -q .state`, expect `CLOSED`; GitLab: `glab issue view <num> --output json --jq .state`, expect `closed`); if still open, close explicitly (GitHub: `gh issue close <num> --comment "Shipped in PR #<PR_NUM>."`; GitLab: `glab issue note <num> -m "Shipped in PR #<PR_NUM>." && glab issue close <num>`). Then drop the stale label (GitHub: `gh issue edit "$ISSUE_NUM" --remove-label in-progress 2>/dev/null || true`; GitLab: `glab issue update "$ISSUE_NUM" --unlabel in-progress 2>/dev/null || true`). Leave the assignee — it records who shipped it.

**Issues mode — re-evaluate the parent epic (the shipped issue may have been an epic's last child).** Once the issue is confirmed closed, resolve its parent epic with the shared epic logic ("Resolving a child's parent epic" in [lib/epic-children.md](../../lib/epic-children.md)) — read that file now if this run never loaded it (Phase 1 step 3 only reads it on-demand, when a candidate is itself an epic, which a non-epic claim never triggers). If a parent epic `#P` exists, re-classify it:
- `epic-done` (this was the last open child and `#P` has no remaining wrap-up tasks) → **close the epic** with an evidence comment (GitHub: `gh issue close "$P" --comment "All children closed (incl. #<num>) — closing epic. (slashdo)"`; GitLab: `glab issue note "$P" -m "All children closed (incl. #<num>) — closing epic. (slashdo)" && glab issue close "$P"`).
- `epic-wrapup` (children all closed but wrap-up tasks remain) → **don't close**; comment so a later `/do:next` surfaces it (GitHub: `gh issue comment "$P" --body "All child issues are now closed — only the epic's own wrap-up tasks remain."`; GitLab: `glab issue note "$P" -m "All child issues are now closed — only the epic's own wrap-up tasks remain."`).
- `epic-open` (other children still open) → leave it untouched.

Skip this step when the shipped issue was *itself* an epic (its `Closes #<N>` already closed it).

Print a one-line summary:

```
# PLAN.md mode:
Shipped [<slug>] <Title>. PR #<num>. Worktree + branch cleaned.

# Issues mode:
Shipped issue #<num> "<Title>". PR #<PR_NUM>. Issue closed. Worktree + branch cleaned.
```
