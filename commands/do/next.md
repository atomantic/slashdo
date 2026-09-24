---
description: Claim the next unclaimed tracker issue by number, do the work in an isolated worktree, ship a PR, and clean up — or, with --swarm, claim and ship several independent issues in parallel (auto-picked, or the exact issue numbers you name). Works on GitHub (gh) or GitLab (glab), including Enterprise/self-managed hosts — it ships via /do:pr — with issues on that host or in Jira.
argument-hint: "[#<issue>|<JIRA-KEY> …] [--issues-label <name>] [--model <tier>[,…]] [--effort <level>[,…]] [--self|--no-self] [--collaborators|--no-collaborators] [--trusted-authors <list>] [--swarm[=<N>]] [--plan] [--review-with <agent>[,…]] [--review-iterations <n>] [--review-mode <series|parallel>] [--review-stop-on-findings|--review-stop-on-clean] [--reviewer-applies] [--no-review] [--merge|--no-merge|--merge=<method>] [--merge-method <method>]"
---

# Next — Pick the next issue and ship it

Claim the next open tracker issue (any label by default; `--issues-label` narrows to a curated queue) — work it in an **isolated worktree**, run review, open a PR, merge, and clean up. `/do:replan`, `/do:better`, and `/do:depfree` populate the queue; `/do:next` drains it, one issue per run. Worktree `../next-issue-<num>`, branch `next/issue-<num>`, commit/PR-title prefix `[issue-<num>]`; the PR closes the issue via `Closes #<num>`, and genuinely large discovered work becomes a new tracker issue.

**How the claim works.** Issue `N` (a number, or a key like `PROJ-123` on a Jira tracker) is **"in flight"** when `issue-N` appears as a `/`-separated segment in any local or remote branch (`git branch -a`) or any open PR head ref, or when the issue already has an assignee. `/do:next` picks the first eligible open issue that is NOT in flight and creates a `next/issue-<num>` branch — that branch name *is* the claim — then adds a cross-machine marker (the assignee) in Phase 2.

**Drain one item — or several (`--swarm`).** By default `/do:next` ships one item per run. `--swarm` claims and ships several independent open issues in parallel, each in its own worktree subagent, serializing only the merge — auto-picked (`/do:next --swarm`) or exactly the issues you name (`/do:next --swarm #12 #14 #15`). See **Swarm mode**; Phases 1–7 are unchanged without `--swarm`.

## Parse Arguments

Split `$ARGUMENTS` on whitespace — `--` tokens are flags, the rest are **targets**. Value flags accept `--flag=value` or `--flag value` (the next token is the value, not a target). Order is free.

Collect targets into an ordered list `TARGETS`, **in this order**: **(1) expand** any comma-separated run of issue numbers (`12,14,15`, `#12,#14`) into one target each; **(2) normalize** (strip a leading `#`); **(3) de-duplicate**, order preserved — so `#12`/`12`, or `12,14` alongside `14`, never become two batch members racing for one issue. **Every target must be an issue number** (bare or `#`-prefixed); on any other target claim nothing and abort: ``"<target>" is not an issue number — /do:next claims tracker issues only (e.g. `#123`).`` **On a Jira tracker every target must be a key instead** (`PROJ-123`) — the tracker is known only after the Pre-flight, so a Jira run checks target shapes there instead, still before any claim, with [lib/tracker-jira.md](../../lib/tracker-jira.md) "Targets" (it uppercases, strips `#`, rejects bare numbers and other projects); de-duplicate on the key it prints, and "issue number" below means that key. **One target** is the single issue to claim. **Several targets** are an explicit `--swarm` batch. Several targets **without** `--swarm` is ambiguous: claim nothing and say ``You named <n> issues, but /do:next ships one item per run — add --swarm to batch them in parallel, or name a single item.`` (Never silently enable swarm — it's an ≈N× token bill.)

- **`#<issue>`** — claim THAT issue instead of auto-picking: an open issue number, bare (`123`) or `#`-prefixed. An explicit number is a deliberate cherry-pick that **bypasses every auto-pick skip except the `--self` / `--collaborators` security boundaries** — it can claim a parking-labelled issue (`future`/`blocked`/…), an epic (resolved per its children — Phase 1 step 3), or an issue outside an active label filter; state it when you do. Under `--self` an issue **another user filed is refused**; under `--collaborators` an issue filed by a non-collaborator not on `--trusted-authors` is **refused** (Phase 1 step 5).
- **`--issues`** — deprecated no-op (the tracker is the only source). Print once: `--issues is now the default (PLAN.md mode was removed); the flag can be dropped.`
- **`--no-issues`** — abort before any claim: `--no-issues is no longer supported: PLAN.md mode was removed. slashdo records work only in the project's issue tracker.`
- **`--issues-label <name>`** — **restricts auto-pick to issues carrying that label** (a curated queue, e.g. the `plan`-labelled items `/do:replan` produced). Auto-pick is unfiltered by default. Record the label as `PLAN_LABEL` (default `plan`) — the default is still the label applied to issues this command *files* (Phase 4), but it only *filters* auto-pick when the flag (or a saved `issues-label` default) supplied it. Track an active filter as `LABEL_FILTER` (the label when explicitly provided; empty otherwise).
- **`--model <tier>[,…]`** / **`--effort <level>[,…]`** — **restrict auto-pick to issues carrying that dispatch hint** (see [lib/plan-issue-setup.md](../../lib/plan-issue-setup.md) "The dispatch hint"). `<tier>` ∈ `light` / `medium` / `heavy`; `<level>` ∈ `low` / `medium` / `high` / `xhigh` / `max`. Record as `MODEL_FILTER` / `EFFORT_FILTER` (empty when absent). Reject an unknown value with `--model must be one of light, medium, heavy, none (got: {value}).` / `--effort must be one of low, medium, high, xhigh, max, none (got: {value}).`
  - **Comma-list is OR *within* an axis; the two axes AND *across*.** `--model light,medium --effort low` = (light **or** medium) **and** low. Each flag is single-use — a repeated `--model` is an error (`--model given twice — pass one comma-separated list.`), not a union.
  - **The sentinel `none`** matches an issue with **no** label on that axis: `--model light,none` = "light, or untiered". Bare `--model light` **excludes untiered issues** (as `--issues-label` excludes unlabelled ones), so an all-untiered tracker comes back empty — say so in the "no eligible issue" message.
  - **Filtering is not dispatching.** These flags choose which issues are eligible; a swarm worker runs on the claimed issue's own `model:`/`effort:` labels (Swarm Phase B). `--model heavy` never *upgrades* an issue, and neither flag changes the current session's model.
  - Advisory like `--issues-label`, not a security boundary: an explicit `#<num>` overrides both filters (Phase 1 step 5).
- **`--self`** / **`--no-self`** — **security gate: restrict issue work to issues YOU filed.** `--self` sets `SELF_MODE=true`; `--no-self` sets `SELF_MODE=false`. When on, `/do:next` only claims an open issue whose **author is the authenticated user** (`@me`): auto-pick filters everyone else out and an explicit `#<num>` for someone else's issue is **refused, not overridden** (Phase 1), so instructions embedded in a third party's issue are never acted on. Resolve from the flag, else the saved `self` default (per-project `.slashdo.json` over global `~/.claude/.slashdo-config.json`), else `false`.
- **`--collaborators`** / **`--no-collaborators`** — **security gate: restrict issue work to issues filed by a current repo collaborator (union `--trusted-authors`).** Sets `COLLAB_MODE=true`/`false`. When on, `/do:next` only claims an issue whose **author is in the trusted claim pool**: the **live collaborator set** from the host API (GitHub: `repos/:owner/:repo/collaborators`; GitLab: project members with `access_level >= 30` Developer) **UNION** the `--trusted-authors` list. Collaborators always come live from the API, never from a saved allowlist; `--trusted-authors` adds extra trusted *authors* only. An issue filed by someone in neither set is skipped by auto-pick and **refused, not overridden** on an explicit `#<num>` (Phase 1). **`--self` is stricter and wins:** when `SELF_MODE` is on, skip the collaborator/trusted-authors filter. `--no-self` does NOT disable `COLLAB_MODE`; `--no-collaborators` is the escape hatch to any-author. **When `COLLAB_MODE` is off, `--trusted-authors` does not restrict or widen auto-pick.** Resolve from the flag, else the saved `collaborators` default (same precedence as `self`), else `false`. **A Jira tracker cannot enforce it** (its reporters are not code-host collaborators): with `COLLAB_MODE` on and `SELF_MODE` off, a Jira run aborts in the Pre-flight per [lib/tracker-jira.md](../../lib/tracker-jira.md) "Claim gates" — never any-author.
- **`--trusted-authors <list>`** — extra GitHub/GitLab logins unioned into the trusted claim pool **when `COLLAB_MODE` is on**. Comma-separated logins (e.g. `howlingmime,Joebok`); a leading `@` is stripped; compare **case-insensitively**. This is **not** a saved collaborator allowlist — collaborators stay live from the API. Empty / the sentinel `none` (case-insensitive) means no extra authors for this run (overrides a saved default). Repeated `--trusted-authors` is an error (`--trusted-authors given twice — pass one comma-separated list.`). Validate each login against `^[A-Za-z0-9][A-Za-z0-9-]*(\[bot\])?$` (the same shape as `/do:config`'s `@<login>` reviewer); abort with `Invalid --trusted-authors login: {value}. Use GitHub/GitLab logins (comma-separated), or none to clear.` Dedupe case-insensitively, preserving first-occurrence spelling. Carry the normalized comma-separated string as `TRUSTED_AUTHORS` (empty when none). Resolve from the flag, else the saved `trusted-authors` default (per-project over global); a saved `none` (case-insensitive) is a tombstone meaning no extra authors (masks an inherited global list, like `review-with=none`); else empty. **`--self` still wins over both.**
- **Saved defaults.** Read both config files — `cat ~/.claude/.slashdo-config.json` (global) and `cat "$(git rev-parse --show-toplevel)/.slashdo.json"` (per-project; skip a missing file silently) — and merge their `.defaults` objects **project over global**; a typed flag always wins over its saved default. A saved `issues` key is ignored (true or false). Resolve `PLAN_LABEL` from the saved `issues-label` default — a saved `issues-label` counts as an explicit choice and sets `LABEL_FILTER` exactly as the flag would; with neither, `LABEL_FILTER` stays empty. Likewise `SELF_MODE` from `self`, `COLLAB_MODE` from `collaborators`, `TRUSTED_AUTHORS` from `trusted-authors` (a saved `none` resolves to empty), and `MERGE_ENABLED` / `MERGE_METHOD` from `merge` / `merge-method` (see `--merge` above). Resolve only these keys here — the review flags pass through to `/do:pr`, which resolves its own defaults. **`--model` / `--effort` have no saved default by design** — a forgotten saved narrowing is indistinguishable from an empty backlog; they apply only when typed.
- **`--swarm` / `--swarm=<N>`** — drain **several independent issues in parallel**, auto-picked or exactly the issue numbers you name. Records `SWARM=true`. Short-circuits Phases 1–7 into the **Swarm mode** flow below. Ignored (with a note) when only one issue is eligible / named. Review flags pass through to each swarm agent's `/do:pr` as in the single-issue flow.
  - **Batch membership.** **No target** → swarm auto-picks the first `SWARM_N` independent eligible issues (Phase A). **Two or more targets** (`--swarm #12 #14 #15`, `--swarm 12,14,15`) → that list **is** the batch, in the order given — a deliberate cherry-pick that bypasses the auto-pick skips exactly as a single explicit `#<num>` does (Phase A). **One target** (`--swarm #12`) → run the single-issue flow and say so.
  - **Concurrency (`SWARM_N`).** Bare `--swarm` resolves `SWARM_N=3` in **both** cases (a bare flag never raises concurrency because you named more issues); `--swarm=<N>` sets it, **clamped to `1..6`** (state the clamp). A batch bigger than `SWARM_N` runs in **waves** of `SWARM_N` (Phase B).
  - **Count vs. target disambiguation.** `--swarm=<N>` (attached) is always the count. Space-separated `--swarm <N>` consumes the next token as the count **only when** it is a bare integer **in `1..6`** with no `#` or comma **and** it is the *only* target token — so `--swarm 3` is three agents, while `--swarm #12 #14`, `--swarm 12,14`, and `--swarm 12 14` are two-issue batches, and `--swarm 12` is **issue 12** (a lone integer above 6 is far likelier an issue number). Say which reading you took, and note that `--swarm=12` is how to ask for a count that gets clamped.
- **`--plan`** — before writing code, enter an **interactive plan-mode session** (Phase 3.5): present a written plan, surface open questions, get explicit approval. Runs *after* the worktree is claimed. Rejection routes to Phase 7 cleanup like a Phase 3 skip. **Ignored in `--swarm` mode when more than one issue actually runs** (state the skip); honored when swarm degenerates to the single-issue flow.
- **`--review-with` / `--review-iterations` / `--review-mode` / `--review-stop-on-findings` / `--review-stop-on-clean` / `--reviewer-applies`** — **passed through to `/do:pr`** in Phase 6, which owns the review/ship machinery. (`--review-mode series|parallel` selects how `/do:pr`'s multi-reviewer loop dispatches reviewers; series is the default.) Same grammar as every other slashdo command (see `/do:pr`). With neither `--review-with` nor `--no-review`, Phase 6 still decides whether the diff warrants a quality pass (`/simplify` or equivalent) — it never decides the external reviewer: `/do:pr` applies its own saved `--review-with` default, if any, and no reviewer is invented here.
- **`--no-review`** opts out of both the quality pass and the external pass. `/do:pr` has no `--no-review` flag of its own, so Phase 6 **translates it** rather than forwarding it verbatim: `--no-review` becomes `/do:pr --no-merge --review-with none`, which forces `REVIEW_AGENTS=[]` and skips any saved `review-with` default.
The **`--merge`** / **`--no-merge`** / **`--merge=<method>`** / **`--merge-method <method>`** flags control **`/do:next`'s own merge**, not `/do:pr`'s. Phase 6 always ships through `/do:pr --no-merge`, then `/do:next` applies its own merge gate.
- **Enable:** `--merge` (the default) resolves `MERGE_ENABLED=true`. If both `--merge` and `--no-merge` appear, directly or through `--merge=<method>`, abort with `--merge and --no-merge cannot be combined`.
- **Disable:** `--no-merge` resolves `MERGE_ENABLED=false`: stop right after Phase 6 opens the PR, leave the worktree and the assignee + `in-progress` claim in place, skip Phase 7, and reuse the `dirty`/`inconclusive` stop path. With neither flag typed, resolve `MERGE_ENABLED` from the saved `merge` default, else the **built-in `true`**.
- **Method:** `--merge=<method>` also enables merging and sets `MERGE_METHOD=<method>`; `--merge-method <method>` sets only `MERGE_METHOD`. `<method>` ∈ `squash`/`rebase`/`merge` (GitHub only — GitLab merges with the project's default method); reject other values with `--merge=<method> must be one of squash, rebase, merge (got: {value}).` / `--merge-method must be one of squash, rebase, merge (got: {value}).`, and conflicting pairs with `--merge=<method> and --merge-method specify conflicting methods ({first} vs {second})` (identical methods are fine). `MERGE_METHOD` resolves the same way regardless of origin through [lib/merge-gate.md](../../lib/merge-gate.md) step 1.
- **Swarm:** ignore enable/disable; the orchestrator always attempts its own serialized merge in Phase C for every eligible result. `--merge=<method>` / `--merge-method` still resolve `MERGE_METHOD` for that Phase C merge.
- **Any other `--flag`** not defined above aborts immediately, before any claim is made: `Unknown /do:next option: {flag}. Supported: --issues-label, --model, --effort, --self, --no-self, --collaborators, --no-collaborators, --trusted-authors, --swarm, --plan, --review-with, --review-iterations, --review-mode, --review-stop-on-findings, --review-stop-on-clean, --reviewer-applies, --no-review, --merge, --no-merge, --merge-method.`

## Conventions

Three shapes recur below and are defined once here, then invoked by name (a fourth — the GitLab-only `glab api` capture rule, a two-step capture never piped straight to jq — is defined in [lib/next-gitlab.md](../../lib/next-gitlab.md)).

**Host verbs.** These names are the host-neutral operations used by the issue and PR phases below. A verb in a snippet is a dispatch instruction, not a literal shell function: run the selected host's form instead of re-inlining a `gh`/`glab` branch at a call site. The GitHub forms are canonical here; the GitLab forms and the two-step `glab api` rule live in [lib/next-gitlab.md](../../lib/next-gitlab.md). A failed verb remains a failure — do not substitute a host or turn an empty result into success. `assign_me` also leaves the authenticated login in `ME` for the assignee read-back. **The issue and label verbs follow the tracker, the rest the code host:** on a Jira tracker (`TRACKER_CLI` is `jira`) every `issue_*`, `label_*`, `assign_me`, and `unassign_me` runs its form in [lib/tracker-jira.md](../../lib/tracker-jira.md), while `open_refs`, `collaborators`, `pr_title`, and `ci_wait_merge` stay on `CLI_TOOL`.

- `open_refs` — `gh pr list --state open --limit 500 --json headRefName -q '.[].headRefName'`
- `collaborators` — `gh api --hostname "$GH_HOST" repos/:owner/:repo/collaborators --paginate -q '.[].login'`
- `issue_body <N>` — `gh issue view <N> --json body -q .body`
- `issue_body --comments <N>` — `gh issue view <N> --comments`
- `issue_body --set <N> <text>` — `gh issue edit <N> --body <text>`
- `issue_state <N>` — `gh issue view <N> --json state -q .state`
- `issue_author <N>` — `gh issue view <N> --json author -q .author.login`
- `issue_assignees <N>` — `gh issue view <N> --json assignees -q '[.assignees[].login] | join(",")'`
- `issue_labels <N>` — `gh issue view <N> --json labels -q '[.labels[].name]'`
- `issue_comment <N> <text>` — `gh issue comment <N> --body <text>`
- `issue_close_note <N> <text>` — `gh issue close <N> --comment <text>`
- `assign_me <N>` — `ME="$(gh api --hostname "$GH_HOST" user -q .login)" && [ -n "$ME" ] && gh issue edit <N> --add-assignee @me`
- `unassign_me <N>` — `gh issue edit <N> --remove-assignee @me`
- `label_ensure <label> <color> <description>` — `gh label create <label> --color <color> --description <description> 2>/dev/null || true`
- `label_add <N> <label>` — `gh issue edit <N> --add-label <label>`
- `label_rm <N> <label>` — `gh issue edit <N> --remove-label <label>`
- `issue_create <title> <body> <label>...` — `gh issue create --title <title> --body <body> --label <label>...`
- `pr_title <PR> <title>` — `gh pr edit <PR> --title <title>`
- `ci_wait_merge <PR> <method>` — `gh pr checks <PR> --required --watch --fail-fast && gh pr merge <PR> --<method>`

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

**`release_marker` — retracting a claim without shipping it:** run `unassign_me "$ISSUE_NUM" 2>/dev/null || true`, then `label_rm "$ISSUE_NUM" in-progress 2>/dev/null || true`. Both verbs are best-effort so one failed release cannot suppress the other. On a Jira tracker, run [lib/tracker-jira.md](../../lib/tracker-jira.md)'s `release_marker` block instead (the transition back, then the unassign).

## Swarm mode (`--swarm`)

**When `--swarm` is absent — the default — skip this section entirely and run Phases 1–7 below.**

When `SWARM` is true the swarm flow **replaces Phases 1–7**: it claims and ships up to `SWARM_N` independent open issues at once, each in its own worktree subagent running the normal single-issue flow, and serializes only the merge. Preconditions, the four swarm phases (A triage/partition, B fan-out, C merge queue, D reconcile), and the batch-abort rules all live in one file — read it only when `SWARM` is true:

!read lib/next-swarm.md

## Phase 1: Pick

**Pre-flight — `/do:next` requires GitHub (`gh`) or GitLab (`glab`).** It claims tracker issues and ships via `/do:pr`, which supports both hosts (including GitHub Enterprise and self-managed GitLab — both CLIs resolve a custom host from the `origin` remote). **Detect the host up front and abort if the matching CLI isn't authenticated — before claiming or implementing anything.** Same rule as `/do:pr`'s "Detect VCS Host" step and every other command that resolves `VCS_HOST`/`CLI_TOOL` (the `origin` remote is authoritative for the host; `auth status` only says which CLI is *usable*):

!read lib/vcs-host.md

**Jira tracker (`TRACKER=jira`) only — read the Jira backend now** and run its Pre-flight (`{COMMAND}` = `/do:next`) in place of the tracker gate. It alone sets `TRACKER_CLI` to `jira`, plus `JIRA_PROJECT` and `LABEL_SEP=:`; its "Serving `/do:next`" section then supplies every issue step below — target keys, claim gates, the walk, the claim, `release_marker`, and the close. Any other tracker skips this read.

!read lib/tracker-jira.md

Otherwise, if the partial's tracker gate leaves `TRACKER_CLI` empty, abort naming the tracker — before claiming anything.

Carry `CLI_TOOL`/`VCS_HOST`/`TRACKER` (and `GH_HOST` on GitHub) and `LABEL_SEP` through every later phase — [lib/plan-issue-setup.md](../../lib/plan-issue-setup.md)'s own setup step reuses `CLI_TOOL` rather than re-detecting it, and every prefixed-label match below (the priority sort key, the dispatch-hint filter) is built from `LABEL_SEP`, not a hardcoded `:` — a hardcoded colon would silently stop matching `priority::5` / `model::light` on a GitLab tracker.

**GitLab only — read `lib/next-gitlab.md` now, before the first plain `glab api` call.**
It carries every GitLab-specific step the rest of `/do:next` needs — the host-verb
forms, the `jq` probe (`glab api` has no built-in `--jq` flag, only `glab issue`/`glab mr`
do, so Phase 1 and Phase 2 pipe it to the standalone binary), the native blocked-by
lookup, and the candidate-list walk — keyed by heading, plus the GitHub↔GitLab
field-mapping table the jq expressions below build on. Run its jq probe now. A GitHub
run never reads this file.

!read lib/next-gitlab.md

Build the in-flight set:

```bash
git fetch --prune 2>/dev/null
IN_FLIGHT_REFS="$(git branch -a --no-color --format='%(refname:short)'; open_refs 2>/dev/null || true)"
# in_flight <ID>: some ref has a `/`-segment that is exactly `issue-<ID>` (ID = issue number or Jira key)
in_flight() { printf '%s\n' "$IN_FLIGHT_REFS" | tr '/' '\n' | awk -v id="$1" 'substr($0, 1, 6) == "issue-" && toupper(substr($0, 7)) == toupper(id) { hit = 1 } END { exit !hit }'; }
```

Every ref's `/`-segments are the raw in-flight set, and `in_flight <ID>` is an exact segment match (a Jira project compares case-insensitively): `issue-12` never matches `feature/12` or `issue-123`, and `issue-PROJ-12` never matches `PROJ-123`. Shell state does not persist, so call it in the same Bash call that built `IN_FLIGHT_REFS`.

### Phase 1 — issue queue

Run the shared issue setup — it reuses the `CLI_TOOL` the Pre-flight detected and aborts if neither host is authenticated (`PLAN_LABEL` is created lazily, in Phase 4, only if this run actually files a discovered-work issue):

!read lib/plan-issue-setup.md

> **`/do:next` reads only the setup partial, not [lib/plan-issue-filing.md](../../lib/plan-issue-filing.md).** That file's dedup fetch, `--scan-only` recording, and bulk-spool path exist for commands that file and dedup *findings* in bulk; `/do:next` files at most one discovered-work issue (Phase 4), so dumping every open issue's body into context buys nothing. The step-1 walk below is the only open-issue listing this phase needs. If Phase 4 does file a discovered-work issue, check for a duplicate with a targeted issue search instead.

> **Works on GitHub or GitLab.** The claim (Phase 2) uses the tracker's **assignee** field as the cross-machine marker on either host. `assign_me` and `unassign_me` add/remove exactly one assignee without clobbering others, which the race read-back depends on; the selected host form is in the GitLab column. Epic/child resolution (step 3) also differs by host — see [lib/epic-children.md](../../lib/epic-children.md) for GitHub's native sub-issues API vs. GitLab's convention fallback.

**Collaborator set — fetch once when `COLLAB_MODE` is on and `SELF_MODE` is not.** If `SELF_MODE` is on, skip this fetch (self is a subset). If `COLLAB_MODE` is off, skip it and do **not** apply `--trusted-authors` as a standalone gate. **Fail closed:** a failed call or an empty login set (the owner should always be present) aborts — never treat "couldn't list them" as any-author, and never fall open to `--trusted-authors` alone. Compare issue authors to the **trusted claim pool** (collaborators UNION `--trusted-authors`) **case-insensitively**. (A Jira run never gets here with the gate on — its Pre-flight refused it.)

**GitHub only — the VCS preflight has already seeded `GH_HOST` from the checkout origin. Read the shared snippet below before the `collaborators` verb runs: it preserves that value, continues from the fallbacks when needed, and runs the per-host auth precheck.** (GitLab: skip — the GitLab form resolves the host from the remote itself.)

!`cat ~/.claude/lib/gh-host.md`

```bash
ORIGIN_URL="$(git remote get-url origin 2>/dev/null || true)"
OWNER_REPO="$(printf '%s' "$ORIGIN_URL" | sed -E 's#^[a-z]+://[^/]+/##; s#^[^@]+@[^:]+:##; s#\.git$##' | sed 's#^/##')"

if [ "$COLLAB_MODE" = "true" ] && [ "$SELF_MODE" != "true" ]; then
  [ -n "$OWNER_REPO" ] || {
    echo "Could not list collaborators for <owner/repo> — /do:next --collaborators cannot be enforced. Aborting."; exit 1; }
  COLLAB_LOGINS="$(collaborators)" || {
    echo "Could not list collaborators for $OWNER_REPO — /do:next --collaborators cannot be enforced. Aborting."; exit 1; }
  [ -n "$COLLAB_LOGINS" ] || {
    echo "Could not list collaborators for $OWNER_REPO — /do:next --collaborators cannot be enforced. Aborting."; exit 1; }
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
   The `--limit 500` avoids truncating the queue before the client-side sort (`gh issue list` defaults to 30). A repo with >500 open candidates is pathologically large (`/do:replan` to prune, or `--issues-label` to scope); note the cap rather than silently dropping the overflow. **Priority is advisory ordering, not a gate** — an unprioritized issue is still claimable.

   **On GitLab, the same walk uses `glab issue list` — field names and shapes differ, not just the binary** (see the mapping table in [lib/next-gitlab.md](../../lib/next-gitlab.md), read above). **See that file's "Phase 1 — candidate list"** for the equivalent `glab issue list` call — the two-step `ME` resolution (a `--self` run needs the authenticated username, since `glab` doesn't resolve `@me`), the `--per-page 100` cap (lower than `gh`'s 500, same "note the cap" guidance), and the `description`-projected walk.

   **On a Jira tracker, the walk is [lib/tracker-jira.md](../../lib/tracker-jira.md) "Queue walk"** — JQL in place of `--label`/`--author`, the same `PRIORITY_SORT` and dispatch-hint clauses over `.fields.labels[]`, and the assignee, epic, and blocked-by fields the steps below read.

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
   **GitLab ($LABEL_SEP is `::`)** — the same worked example against `glab issue list`, same two clauses without `.name`: see [lib/next-gitlab.md](../../lib/next-gitlab.md) "Phase 1 — candidate list".
   Omit the `map` for an inactive axis entirely rather than emitting `select(true)`. **This filter runs before every other skip**, so an excluded issue is never considered for the parking-label / dependency / epic checks — and exclusion here means "not what you asked for," not "not workable." Report it that way in step 7: if the filter emptied a queue that had eligible work, say which filter did it, **writing the flags space-separated, exactly as they'd be typed** (`no eligible issue matching --model light --effort max — 14 open issues carry no dispatch hint; add `none` to include them`) — comma-joined they'd read as one axis's OR-list.
2. **Determine in-flight issues.** Issue `N` is in flight if EITHER `in_flight N` succeeds, OR the issue **already has an assignee** (the Phase 2 marker — a local-only branch on a sibling machine is invisible here, but its assignee is not).
3. **Resolve epics before picking (child-aware).** An epic (umbrella issue) is **not** a single claimable unit — its done-ness depends on its children. For any candidate that is an epic (carries `epic`/a repo umbrella label, has native sub-issues, or whose body — fetched per candidate, see step 4 — task-lists other issues), classify it with the shared epic logic (a Jira epic: `Epic` type or sub-tasks, per its "Jira" section) — read it only when a candidate is an epic:

!read lib/epic-children.md

   Act on the resulting state:
   - `epic-open` (≥1 child still OPEN) → **skip** as not-yet-workable; note `epic #N: X/Y children open`.
   - `epic-done` (all children CLOSED, no wrap-up tasks) → nothing to implement; **close it inline** using [lib/epic-children.md](../../lib/epic-children.md)'s "Closing an epic" step, note it, and keep scanning.
   - `epic-wrapup` (all children CLOSED, wrap-up tasks remain) → **this IS claimable work**: "complete epic #N's remaining wrap-up tasks." Claim it like any issue — Phase 4 does the wrap-up (and ticks the wrap-up checkboxes in the epic body), and the Phase 6 PR carries `Closes #<N>`.
   - `epic-empty` (no children resolvable either way) → treat as an ordinary issue.
4. **Resolve declared dependencies before picking (blocked-by).** A candidate may declare a hard dependency in its **body**: a line matching `Depends on #<N>` or `Blocked by #<N>` (case-insensitive; one line may list several, e.g. `Depends on #12, #15`). Collect every `#<N>` on those lines. The step-1 walk omits bodies, so **fetch the body for this candidate only** with `issue_body <N>` — the same fetch serves step 3's task-list check. A candidate is **blocked** when ANY referenced issue is still open — check the freshest state with `issue_state <N>` and test for "closed" rather than an exact "open" match (`OPEN`/`CLOSED` vs `opened`/`closed`); a referenced number that is closed, or doesn't exist, does not block. Resolve **lazily** as you walk (only for the candidate you're about to pick).
   - `blocked` (≥1 referenced issue still open) → **skip** in auto-pick; note `#N blocked by #M (open)`. Self-clearing: when #M closes, #N becomes eligible.
   - Also honor each host's **native** blocked-by relationship when the API surfaces it — GitHub's GraphQL `blockedBy` connection, GitLab's Issue Links API filtered to `link_type: "is_blocked_by"`, or Jira's `issuelinks`. Use the GitLab procedure in [lib/next-gitlab.md](../../lib/next-gitlab.md) and Jira procedure in [lib/tracker-jira.md](../../lib/tracker-jira.md); each treats a failed or malformed native lookup as **UNRESOLVED**, not unblocked. An unresolved native lookup skips the candidate during auto-pick and says so (`#N: native blocked-by lookup unresolved — skipping auto-pick`); it must never fall back to body dependencies alone. An explicitly named issue may proceed only as an explicit override, with a warning that native blocker state could not be verified. The body and native sources are OR'd (blocked by *either* ⇒ skip).
   - **Cycle / unresolvable chain** (A depends on B, B depends on A) → both stay skipped; note the cycle so a human can break it. Never loop trying to resolve one.
5. **Pick the target issue:**
   - **With argument** — the issue number (strip `#`); **set `ISSUE_NUM` to that stripped number now** so the checks below can reference `$ISSUE_NUM`. Verify open and NOT in flight. **`--self` first, as a hard gate:** when `SELF_MODE` is on, confirm the issue's author is the running account — use `issue_author "$ISSUE_NUM"` and compare it with the authenticated login; on GitLab, resolve that login with the two-step capture in [lib/next-gitlab.md](../../lib/next-gitlab.md), exactly as the Phase 2 claim verb does; on Jira, use the JQL check in [lib/tracker-jira.md](../../lib/tracker-jira.md) "Claim gates", never a display-name comparison; if it does not, **refuse and stop** with `Issue #<num> was filed by <author>, not you — /do:next --self only works on issues you filed. Drop --self to claim it.` **`--collaborators` next, as a sibling hard gate:** when `COLLAB_MODE` is on and `SELF_MODE` is not, confirm the author from `issue_author "$ISSUE_NUM"` is in `TRUSTED_CLAIM_POOL`, compared **case-insensitively**; if not, **refuse and stop** with `Issue #<num> was filed by <author>, who is not a collaborator on <owner/repo> (and not on --trusted-authors) — /do:next --collaborators only claims collaborator-authored issues. Drop --collaborators to claim it.` These are the **skips an explicit number does NOT override** — `--self` and `--collaborators` are security boundaries, not curation preferences. If it's an epic, resolve its state (step 3) first — claim an `epic-wrapup`, close an `epic-done`, or warn that children are still open on an `epic-open` (the explicit request still overrides — say so). Otherwise a named number is an **explicit override**: it claims even an issue auto-pick would skip — a parking-labelled one, one with an **open declared blocker** (step 4), one outside an active `LABEL_FILTER`, or one outside an active `MODEL_FILTER`/`EFFORT_FILTER`. State plainly when you're overriding a skip (e.g. "claiming `future`-labelled #123 by explicit request", "claiming #123 despite open blocker #120 by explicit request", "claiming `model:heavy` #123 despite --model light by explicit request"). If any other check fails (closed, in flight), print why and stop.
   - **Without argument** — pick the FIRST candidate in the priority/oldest walk (step 1) that is NOT in flight, NOT already assigned, NOT carrying a parking label (`blocked`, `needs-input`, `wontfix`, `discussion`, `future`, or any repo-specific parking label — skip and note it), NOT blocked by an open declared dependency (step 4 — skip and note it), NOT an `epic-open`/`epic-done` epic per step 3 (an `epic-wrapup` epic **is** eligible), and — **when `COLLAB_MODE` is on and `SELF_MODE` is not** — NOT authored by someone outside the trusted claim pool (skip and note `#N filed by <author> — not a collaborator (and not on --trusted-authors)`; GitHub author is `.author.login` from the list payload, GitLab is `.author.username`; compare case-insensitively). An explicit `#num` can still claim a skipped issue; auto-pick never surfaces one.
6. **Set `ISSUE_NUM=<num>` and `SLUG="issue-${ISSUE_NUM}"`** (on Jira `<num>` is the key: `ISSUE_NUM=PROJ-123`, `SLUG=issue-PROJ-123`) — later phases use `SLUG` for worktree/branch/commit/PR and `ISSUE_NUM` for the host verbs.
   - **Surface the claimed issue's dispatch hint, if it carries one** (`model:<tier>` / `effort:<level>`): `#42 hints model:heavy + effort:high`. In the **single-issue** flow this is a *report, not a dispatch* — a session cannot switch its own model or effort mid-run. On a real mismatch say so (`this session is on <current model> and #42 hints model:heavy — consider restarting on a stronger model, or continue as-is`), naming this CLI's model-switch mechanism if it has one, then continue; never stall over an advisory label. Swarm is where the hint is *applied* (Phase B).
7. **If no eligible issue exists**, print why and stop — and **name the filter that emptied the queue** when one did (`LABEL_FILTER`, `MODEL_FILTER`/`EFFORT_FILTER`, `SELF_MODE`, or `COLLAB_MODE`), since an opt-in narrowing that hides workable issues looks identical to having none. Do NOT open new issues here — that only happens for work *discovered while implementing* (Phase 4/6).

## Phase 2: Claim (worktree) — REQUIRED, NOT OPTIONAL

> `/do:next` always uses a worktree so a *second* `/do:next` in another tab doesn't fight over the main repo's working tree. **A `/do:next` without a worktree is a broken claim — it blocks every subsequent claim until cleaned up.**
>
> - ❌ NEVER `git checkout -b next/issue-<num>` or `git switch -c next/issue-<num>` in the main repo.
> - ✅ ALWAYS use `git worktree add` with an explicit path, then `cd` in and verify with `pwd`. (The bash-tool "avoid `cd`" guidance does not apply — invoking `/do:next` is a request for a working-directory change.)

The worktree is a **sibling directory** (`../next-issue-<num>`) on branch `next/issue-<num>`. Run as a **single Bash invocation** so the shell vars stay in scope, substituting the real issue number:

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)" && \
SLUG="issue-<num>" && \
# Abort if origin already has the claim branch.
if git ls-remote --exit-code --heads origin "next/${SLUG}" >/dev/null 2>&1; then
  echo "next/${SLUG} already on origin — another machine claimed it; re-run /do:next to pick the next item."; exit 1
fi && \
# The default-branch one-liner (Conventions):
DEFAULT_BRANCH="$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@' || true)" && \
DEFAULT_BRANCH="${DEFAULT_BRANCH:-$(git remote show origin | sed -n 's/.*HEAD branch: //p')}" && \
WORKTREE="$(dirname "$REPO_ROOT")/next-${SLUG}" && \
git fetch origin "${DEFAULT_BRANCH}" && \
git worktree add -b "next/${SLUG}" "${WORKTREE}" "origin/${DEFAULT_BRANCH}" && \
cd "${WORKTREE}" && \
pwd && \
# Atomically publish the claim only if the remote ref is still absent.
if ! git push --force-with-lease="refs/heads/next/${SLUG}:" -u origin "next/${SLUG}:refs/heads/next/${SLUG}"; then
  CLAIM_LOCAL_SHA="$(git rev-parse HEAD)" || { echo "Could not identify the local claim commit; preserving $WORKTREE for recovery."; exit 1; }
  CLAIM_REMOTE_OUTPUT="$(git ls-remote --heads origin "refs/heads/next/${SLUG}" 2>&1)"
  CLAIM_LOOKUP_STATUS=$?
  if [ "$CLAIM_LOOKUP_STATUS" -ne 0 ]; then
    echo "Claim push failed and remote ownership could not be checked; preserving $WORKTREE for recovery."
    printf '%s\n' "$CLAIM_REMOTE_OUTPUT"
    exit 1
  fi
  CLAIM_REMOTE_COUNT="$(printf '%s\n' "$CLAIM_REMOTE_OUTPUT" | awk 'NF { count++ } END { print count+0 }')"
  if [ "$CLAIM_REMOTE_COUNT" -gt 1 ]; then
    echo "Claim push failed and remote returned multiple refs; preserving $WORKTREE for recovery."
    exit 1
  elif [ "$CLAIM_REMOTE_COUNT" -eq 0 ]; then
    echo "Claim push failed and no remote ref was published; preserving $WORKTREE for recovery."
    exit 1
  elif [ "$CLAIM_REMOTE_COUNT" -eq 1 ]; then
    CLAIM_REMOTE_SHA="$(printf '%s\n' "$CLAIM_REMOTE_OUTPUT" | awk 'NF { print $1; exit }')"
    CLAIM_REMOTE_REF="$(printf '%s\n' "$CLAIM_REMOTE_OUTPUT" | awk 'NF { print $2; exit }')"
    if ! printf '%s\n' "$CLAIM_REMOTE_SHA" | grep -Eq '^[0-9a-f]{40}$' || [ "$CLAIM_REMOTE_REF" != "refs/heads/next/${SLUG}" ]; then
      echo "Claim push failed and remote returned an invalid ref; preserving $WORKTREE for recovery."
      exit 1
    elif [ "$CLAIM_REMOTE_SHA" = "$CLAIM_LOCAL_SHA" ]; then
      echo "Claim ref exists at the local commit, but push ownership is ambiguous; preserving $WORKTREE and stopping for recovery."
      exit 1
    fi
  fi
  echo "Could not atomically publish next/${SLUG}; another run claimed it. Cleaning up this unclaimed worktree."
  git -C "$REPO_ROOT" worktree remove --force "$WORKTREE" >/dev/null 2>&1 || echo "WARN: remove the created worktree $WORKTREE manually."
  git -C "$REPO_ROOT" branch -D "next/${SLUG}" >/dev/null 2>&1 || echo "WARN: remove the created local branch next/${SLUG} manually."
  exit 1
fi
```

**Verify `pwd` is the worktree path**, not the main repo. If it printed the main repo path, the worktree creation or `cd` failed — STOP, report the error, do not proceed. **Re-anchor every later Bash call** with `cd "${WORKTREE}"` or absolute paths. **Re-export `WORKTREE` and `DEFAULT_BRANCH` at the top of each subsequent Bash snippet**, per the default-branch one-liner's rule (Conventions) — otherwise they'd expand empty in Phases 5/6/7.

### Phase 2 — mark the issue in progress

Immediately after the worktree is verified, claim the issue **on the host** so a `/do:next` on any other machine sees it as taken (Phase 1's assignee check is the reader). Do this before writing code. **On a Jira tracker, run [lib/tracker-jira.md](../../lib/tracker-jira.md) "Claim" in place of this block** — Jira's single assignee needs its own read-back, and the lease adds the In Progress transition:

```bash
ISSUE_NUM="<picked-issue-number>"; SLUG="issue-${ISSUE_NUM}"; WORKTREE="../next-${SLUG}"

assign_me "$ISSUE_NUM" || {
  echo "Could not claim issue #$ISSUE_NUM (missing write access?) — aborting."
  git push origin --delete "next/${SLUG}" 2>/dev/null || true
  exit 1
}

ASSIGNEES="$(issue_assignees "$ISSUE_NUM")" || {
  echo "Could not read assignees for issue #$ISSUE_NUM — aborting."
  git push origin --delete "next/${SLUG}" 2>/dev/null || true
  exit 1
}
if printf '%s' "$ASSIGNEES" | tr ',' '\n' | grep -qvxF "$ME" || ! printf '%s' "$ASSIGNEES" | tr ',' '\n' | grep -qxF "$ME" ; then
  echo "Issue #$ISSUE_NUM assignee read-back: $ASSIGNEES — yielding."
  unassign_me "$ISSUE_NUM" 2>/dev/null || true
  git push origin --delete "next/${SLUG}" 2>/dev/null || true
  exit 1
else
  label_ensure in-progress FFA500 "Claimed and being worked" 2>/dev/null || true
  label_add "$ISSUE_NUM" in-progress 2>/dev/null || true
fi
```

## Phase 3: Verify still valid

Before writing code, sanity-check that executing the item as worded won't regress newer work. **Ask the user before proceeding if ANY hold:**

- The full issue body/comments from `issue_body --comments <num>` supersede the title, the issue is already resolved, it's a pure discussion/question with no actionable change, or it awaits an unanswered clarification.
- The item references a function/file/component that no longer exists or was heavily rewritten — `grep -rn` the named identifiers; if absent, it's stale and needs a human re-spec. OR it depends on an unshipped predecessor. OR the work would touch >5 unrelated files (bigger than estimated).

On "skip", run Phase 7 cleanup and re-run Phase 1 for the next item. **Also run `release_marker`** (Conventions) — the same release Phase 2 uses to yield.

## Phase 3.5: Plan (interactive) — only when `--plan` was passed

Skip unless `--plan` is set. When present, don't touch code yet:

1. **Gather just enough context to plan** — read the files the item names, grep its identifiers, confirm integration points.
2. **Enter plan mode** (via the harness's plan-mode entry, e.g. `EnterPlanMode` under Claude Code) and present: the item (`issue-<num>`), approach, files to add/change, tests, and any migration/compat/changelog obligations the repo's CLAUDE.md triggers.
3. **Clarify interactively** — ask only the questions whose answers change the implementation; pick obvious defaults and state them.
4. **Get explicit approval** (via the harness's plan-approval exit, e.g. `ExitPlanMode`) before Phase 4. Don't implement on an unapproved plan.
5. **On rejection/stop** — treat exactly like a Phase 3 skip: Phase 7 cleanup, and release the marker.

## Phase 4: Implement

Write the code, tests, and docs the item requires, following the **target repo's** `CLAUDE.md` conventions. Run the relevant test suite as you go.

**Claimed an `epic-wrapup` epic** (Phase 1 step 3)? The work unit is the epic's own remaining wrap-up tasks. Do them, then **tick the corresponding `- [ ]` boxes in the epic body** with `issue_body --set "$ISSUE_NUM" <updated-body>`. The Phase 6 PR's `Closes #<epic>` closes it on merge.

**Roll discovered backbone work INTO this PR — don't defer it.** A helper to extract, a shared abstraction, a small refactor that makes the fix cleaner — fold it in, test it, mention it in the PR body. Only defer work that is **genuinely large** (its own multi-file feature, a migration, a cross-cutting redesign). The bar is "this needs its own PR," not "slightly outside the line-item's wording."

- **Deferred work** → file a NEW tracker issue, with enough context to pick up cold (file paths, why split out, which issue surfaced it), tagged `PLAN_LABEL` so `/do:next` and `/do:replan` treat it as queued. **Add a dispatch hint (`model${LABEL_SEP}<tier>` / `effort${LABEL_SEP}<level>`) when you can justify one**; leave the axis off rather than guessing, per [lib/plan-issue-setup.md](../../lib/plan-issue-setup.md) "The dispatch hint". Create `PLAN_LABEL` and every justified hint label with `label_ensure` immediately before `issue_create`; then pass each label as a separate argument:
  ```bash
  label_ensure "$PLAN_LABEL" "0366D6" "Tracked by slashdo"
  issue_create "<concise actionable title>" "$(printf 'Discovered while working issue #%s.\n\n<what, where (file:line), why it needs its own PR>\n' "$ISSUE_NUM")" "$PLAN_LABEL" <hint label — omit when unjustified>
  ```
  The hint argument is a **placeholder like every other `<…>` in that command, not a default** — never copy a literal `model:light` / `effort:high` through, and always build the separator from `$LABEL_SEP`, not a hardcoded `:` — a stamped pair on every discovered issue poisons `/do:next --model`, and a hardcoded `:` silently fails to apply GitLab's scoped-label exclusivity. On Jira the body is a file and names the key (`Discovered while working PROJ-123.`).

**Commit messages.** Reference the issue in the subject so the work is grep-able across changelog, branches, and PR titles: `feat([issue-<num>]): <one-line description>` (use `fix:`/`refactor:`/`chore:` per conventional prefixes). On Jira the tag is the key itself: `feat([PROJ-123]): …`, and the same goes for the changelog bullet and PR title below.

## Phase 5: Record completion + changelog

> **Re-sync with the default branch BEFORE editing tracked files.** Every claim touches the same changelog; editing the stale claim-start snapshot silently *re-adds* lines sibling claims removed. From inside the worktree:
> ```bash
> # Re-declare (Conventions; `-C` since we haven't cd'd yet):
> SLUG="issue-<num>"; WORKTREE="../next-${SLUG}"
> DEFAULT_BRANCH="$(git -C "${WORKTREE}" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@' || true)"
> [ -n "$DEFAULT_BRANCH" ] || DEFAULT_BRANCH="$(git -C "${WORKTREE}" remote show origin | sed -n 's/.*HEAD branch: //p')"
> cd "${WORKTREE}" && git fetch origin "${DEFAULT_BRANCH}" && git merge --no-edit "origin/${DEFAULT_BRANCH}"
> ```
> **Conflict rule — deletions win.** Resolve any changelog conflict so a line removed on *either* side stays removed; keep additions from both. Then `git add` the **specific resolved files** and `git commit --no-edit`. **Do NOT `git add -A`/`git add .` while paths are still unmerged** — that stages raw conflict markers. A clean merge needs no commit. Phase 6 re-syncs under this same rule.

**Mark the work item done** by closing the issue via `Closes #<num>` in the PR body (Phase 6) — on Jira, by the post-merge transition in Phase 7 instead.

**Changelog.** Log the shipped work **the way this project already logs changes**. Resolve the convention the same way `/do:push` does (stated convention in `CLAUDE.md` / `AGENT.md` / `AGENTS.md` / `CONTRIBUTING.md` first; otherwise imitate existing changelog artifacts — a rolling `CHANGELOG.md`, a per-release directory with an unreleased staging file, a fragment tool like `.changeset/` or `changelog.d/`; otherwise nothing). If the project has **no** file-based changelog (release notes derived from commit messages), skip this step — the PR title and commits carry the entry. Never invent a changelog file.

Whatever the format: **lead the bullet with `[issue-<num>]`**, and write for a *user* of the app, not a coder inside it (no file paths, module/function names, test counts) — purely internal work may be described in code terms. Match the existing entries' grouping; with no established shape, prefer a `##` heading named for the feature or capability touched (e.g. `## PR review loop`) over generic `Added`/`Changed`/`Fixed` buckets.

```markdown
## <Feature or capability name>
- **[issue-<num>] <Short, user-facing title>** — <one sentence on the user-visible effect>
```

Stage and commit. `{CHANGELOG_FILE}` below is whatever file you actually wrote above — there may be none:

```bash
# Commit ONLY if something was actually staged. A repo whose release notes come
# from commit messages stages nothing here — so an unconditional `git commit` would
# exit non-zero ("nothing to commit") and abort an otherwise-valid run. Guard on staged:
git add {CHANGELOG_FILE}   # omit entirely if there is none
git diff --cached --quiet || git commit -m "docs([issue-<num>]): log issue #<num>"
```

## Phase 6: Review and ship — delegate to `/do:pr`

> **Link the PR to the issue.** The PR body MUST contain `Closes #<num>` (or `Fixes #<num>`) so merging auto-closes the claimed issue. Reference any discovered follow-up issues you filed with plain `#<n>` (NOT `Closes` — they're not resolved by this PR). **On a Jira tracker** the body says `Jira: <KEY>` (follow-ups by key) and carries **no** `Closes #…` — on the code host that would close an unrelated issue.
>
> **Major review findings become tracker issues.** A substantial finding you decide *not* to fix here gets filed as a NEW issue with `issue_create` and the same `label_ensure`/`label` arguments as Phase 4. Nit/style findings just get parked verbally.

`/do:pr` owns the entire review/ship pipeline — the required Local Code Review gate, `--review-with` multi-reviewer loop, `--review-iterations`, stop-modes, and `--reviewer-applies`. **Do not re-implement any of it here.** From inside the worktree, decide the review intensity, then invoke the workflow defined in `~/.claude/commands/do/pr.md` (`/do:pr`), forwarding **only the review flags listed in Parse Arguments** (`--review-with` / `--review-iterations` / `--review-mode` / `--review-stop-on-findings` / `--review-stop-on-clean` / `--reviewer-applies`) — translating `--no-review` to `--review-with none` rather than forwarding it verbatim (`/do:pr` has no `--no-review` flag of its own) — never this command's own `--merge` / `--no-merge` / `--merge=<method>` / `--merge-method`, which `/do:next` resolves for itself (below) and never relays to `/do:pr`. **Always pass `--no-merge` to `/do:pr`** — `/do:next` owns the merge decision (the gate below, additionally gated on this run's `MERGE_ENABLED`), the post-merge cleanup, and `Closes #<num>` handling, even when a global `/do:config --merge` default would otherwise make `/do:pr` auto-merge:

> **A note on `/simplify`.** `/simplify` is the harness's built-in quality pass (Claude Code ships one); if absent, do the pass by hand. It is **not** `/do:simplify` (slashdo's own refactor-audit workflow, which opens per-category PRs — do not reach for it mid-run).

| The user passed… | Run |
|---|---|
| `--review-with=<agents>` | `/simplify` if available (skip when the diff is genuinely trivial), then `/do:pr --no-merge --review-with=<agents>` (pass through `--review-iterations` / `--review-mode` / stop-mode / `--reviewer-applies` verbatim) |
| `--no-review` | `/do:pr --no-merge --review-with none` — its Local Code Review gate still fires; no external pass, no `/simplify` |
| neither | Judge the diff for the quality pass only (`/simplify` if available for new code paths / abstractions / multi-file work; skip for a value swap / typo / single-line fix). Then run `/do:pr --no-merge` with **no review flags at all** — `/do:pr` resolves its own saved `--review-with` default, if any. **Never pick or pass a reviewer here.** If the diff is non-trivial and `/do:pr` reports no reviewer ran, say so in the summary and suggest `--review-with` / `/do:config --review-with`. State the call before acting. |

State any skip/trim and why ("Diff is 3 lines in one file; skipping the quality pass and external review — matches existing pattern"). `/do:pr` pushes `next/issue-<num>`, opens the PR (include `Closes #<num>`), runs the chosen review loop, and reports the aggregate status.

**Gate the merge on the review result — do NOT merge unconditionally.**

- **`MERGE_ENABLED` must be `true`** (Parse Arguments' `--merge`/`--no-merge` resolution). `--no-merge` (or a saved `merge=false` default) stops here unconditionally, whatever the review status.
- **`/do:pr` always reports an aggregate `OVERALL_STATUS`** — `clean` when `REVIEW_AGENTS` resolved empty (no external reviewer ran: `--no-review`, `--review-with none`, or no flag and no saved default), otherwise the aggregate of whichever reviewers actually ran. **Gate on that report, not on which review flags this run typed** — an external review can run even when `/do:next` passed no `--review-with`, because `/do:pr` may have applied its own saved `--review-with` default (Parse Arguments, above). Read `/do:pr`'s report, not the flags you sent it.
- **Never merge on `dirty`** (build/test broken, or a hard-error short-circuit) **or `inconclusive`** (a requested reviewer was missing / timed out / errored / was skipped). **Merge only on `clean`** (or `partial` *and* you explicitly passed a `--review-stop-on-*` flag).

On `dirty`/`inconclusive`, or when `MERGE_ENABLED=false` (`--no-merge`), **stop and leave the PR open**: report the status (or, for `--no-merge`, that merging was skipped by request) and the PR URL, do NOT merge, and do NOT run Phase 7 cleanup (the worktree/branch and the assignee + `in-progress` claim must stay so the work can be finished — by a human, on `--no-merge`, or by fixing the review/CI on `dirty`/`inconclusive`).

**Encode `[issue-<num>]` in the PR title** if `/do:pr` didn't — call `pr_title <num> "feat([issue-<num>]): <description>"`.

**Re-sync, then merge (only when the gate above passed).** A long review loop can let sibling claims merge after your Phase-5 sync — re-sync once more so a stale changelog can't resurrect lines they removed:

```bash
# Re-declare (Conventions; `-C` since we're not cd'd here):
SLUG="issue-<num>"; WORKTREE="../next-${SLUG}"
DEFAULT_BRANCH="$(git -C "${WORKTREE}" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@' || true)"
[ -n "$DEFAULT_BRANCH" ] || DEFAULT_BRANCH="$(git -C "${WORKTREE}" remote show origin | sed -n 's/.*HEAD branch: //p')"
cd "${WORKTREE}" && git fetch origin "${DEFAULT_BRANCH}" && git merge --no-edit "origin/${DEFAULT_BRANCH}"
```

**If that merge reports a conflict**, **STOP and resolve it by hand** under Phase 5's **deletions win** rule (and its ban on `git add -A` while paths are unmerged). Only once `git status` shows no unmerged paths is it safe to push and merge.

**Merge through the shared merge gate.** Reach this step only when the review gate above passed and the tree has no conflicts. `/do:pr` ran with `--no-merge`, so its CI gate never fired, and the gate's push publishes a **new SHA** whose checks have not run yet. The gate's wait path is the `ci_wait_merge` host verb: it waits on the required checks before it merges, while retaining the gate's no-checks and flake handling. The GitLab form intentionally keeps `--remove-source-branch`: that shared gate path owns server-side head cleanup, and Phase 7 treats the already-gone remote ref as success. Run it from inside `${WORKTREE}` with these inputs: `{PR}` is the PR/MR number, `{GIT}` is `git`, `{MODE}` is `wait`, `{LINKED_WORKTREE}` is `1`, and `{MERGE_METHOD}` is the `MERGE_METHOD` from Parse Arguments (it may be unset). **Skip the remote delete in the gate's step 5; Phase 7 owns it.** Phase 7 deletes the local branch first, because `git branch -d` checks the branch against its remote-tracking ref, and deletes the remote branch after that:

!read lib/merge-gate.md

## Phase 7: Clean up

**If this run opened and merged a PR, confirm it actually merged before touching
anything.** (A run that never opened one — a Phase 2 race hard-stop, a Phase 3 skip, or a
Phase 3.5 reject — has no PR to read back: skip this gate entirely and go straight to the
**Abandoned a claim** teardown below.) This phase removes the worktree first, so it relies on the merge gate's step 5 read-back. If that read-back returned anything other than **merged** (for example, a merge queue accepted the PR while it is still open), **run none of this phase** — leave the worktree, branch, issue, and `in-progress` marker exactly as they are, and report the PR as queued/left-open.

From the **main repo** (not the worktree), as a single Bash invocation, re-substituting the issue number and worktree path stashed in Phase 2:

```bash
SLUG="issue-<num>" && \
WORKTREE="../next-${SLUG}" && \
# Sync the default branch ref without switching the main repo's checkout.
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
  # An already-gone branch is success; every other failure blocks cleanup.
  git ls-remote --exit-code --heads origin "next/${SLUG}" >/dev/null 2>&1; RC=$?
  if [ "$RC" -eq 2 ]; then
    echo "note: remote branch next/${SLUG} was already gone"
  else
    echo "ERROR: could not confirm next/${SLUG} is gone (ls-remote rc=$RC) — delete it manually"; false
  fi
fi
```

Each step is `&&`-gated and the remote delete runs last.

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

**Confirm closed, then clear the marker — but only for a PR that actually merged.** Anything other than `MERGED`/`merged` on the read-back means nothing shipped — leave the issue open with its `in-progress` label and assignee, and report the PR as queued/left-open. For a merged PR, `Closes #<num>` auto-closes the issue on merge to the **default branch**. Verify with `issue_state <num>`; if the result is not closed, run `issue_close_note <num> "Shipped in PR #<PR_NUM>."`. Then run `label_rm "$ISSUE_NUM" in-progress 2>/dev/null || true`. Leave the assignee — it records who shipped it. **On a Jira tracker, a merged PR runs [lib/tracker-jira.md](../../lib/tracker-jira.md) "Close after merge" in place of that verify-close-unlabel sequence** — the transition to Done with the PR URL; there is no label to remove, and a failed transition is reported, not retried.

**Re-evaluate the parent epic (the shipped issue may have been an epic's last child).** Once the issue is confirmed closed, resolve its parent epic with the shared epic logic ("Resolving a child's parent epic" in [lib/epic-children.md](../../lib/epic-children.md)) — read that file now if this run never loaded it (Phase 1 step 3 only reads it on-demand, when a candidate is itself an epic, which a non-epic claim never triggers). If a parent epic `#P` exists, re-classify it:
- `epic-done` (this was the last open child and `#P` has no remaining wrap-up tasks) → **close it** using [lib/epic-children.md](../../lib/epic-children.md)'s "Closing an epic" step, noting the just-closed child (`incl. #<num>`) in the evidence comment.
- `epic-wrapup` (children all closed but wrap-up tasks remain) → **don't close**; call `issue_comment "$P" "The children are complete and the wrap-up tasks remain, so a later `/do:next` can surface it."`.
- `epic-open` (other children still open) → leave it untouched.

Skip this step when the shipped issue was *itself* an epic (its `Closes #<N>` already closed it).

Print a one-line summary:

```
Shipped issue #<num> "<Title>". PR #<PR_NUM>. Issue closed. Worktree + branch cleaned.
```
