---
description: Claim the next unclaimed tracker issue by number, do the work in an isolated worktree, ship a PR, and clean up — or, with --swarm, claim and ship several independent issues in parallel (auto-picked, or the exact issue numbers you name). Works on GitHub (gh) or GitLab (glab), including Enterprise/self-managed hosts — it ships via /do:pr — with issues on that host or in Jira.
argument-hint: "[#<issue>|<JIRA-KEY> …] [--issues-label <name>] [--model <tier>[,…]] [--effort <level>[,…]] [--self|--no-self] [--collaborators|--no-collaborators] [--trusted-authors <list>] [--swarm[=<N>]] [--plan] [--review-with <agent>[,…]] [--review-iterations <n>] [--review-mode <series|parallel>] [--review-stop-on-findings|--review-stop-on-clean] [--reviewer-applies] [--no-review] [--merge|--no-merge|--merge=<method>] [--merge-method <method>]"
---

# Next — Pick the next issue and ship it

Claim the next open tracker issue (any label by default; `--issues-label` narrows to a curated queue), work it in an isolated worktree, run review, open a PR, merge, and clean up. `/do:replan`, `/do:better`, and `/do:depfree` populate the queue; `/do:next` drains it, one issue per run. Worktree `../next-issue-<num>`, branch `next/issue-<num>`; the PR closes the issue via `Closes #<num>`, and genuinely large discovered work becomes a new tracker issue. Commit subjects, PR titles and changelog entries follow the target project's own conventions; the `[issue-<num>]` forms below are fallbacks for a project that states none.

**How the claim works.** Issue `N` (a number, or a key like `PROJ-123` on a Jira tracker) is **"in flight"** when `issue-N` appears as a `/`-separated segment in any local or remote branch (`git branch -a`) or any open PR head ref, or when the issue already has **any assignee** or an `in-progress` marker. On GitHub, an open PR linked as closing `N`, or whose title, body or a head commit message contains `Closes #N`, `Fixes #N`, `Fixes: #N`, `Resolves #N`, `[issue-N]` or `(#N)`, also makes it in flight regardless of branch name. That evidence is read per candidate, and [lib/next-github.md](../../lib/next-github.md) lists the fork cases it cannot see. `/do:next` picks the first eligible open issue that is not in flight and creates a `next/issue-<num>` branch — that branch name *is* the claim — then adds a cross-machine marker (the assignee) in Phase 2.

**Resuming your own stopped run.** A `--no-merge`, `dirty` or `inconclusive` stop leaves the claim in place so the work can be finished, and an in-flight issue is otherwise never claimed again: a fresh run does not adopt an existing branch or PR, and assignment to your own login is still a claim. The one exception is a single issue you name explicitly (never auto-pick, never a swarm member) whose claim is visibly this checkout's own: the sibling worktree `../next-issue-<num>` exists locally on branch `next/issue-<num>`, and the issue's only assignee is the authenticated account (Jira: `jira_lease` prints `yes`). In that case say that you are resuming, skip the Phase 2 claim, keep the existing worktree and branch, and continue from the first unfinished phase: uncommitted or unpushed work goes to Phase 4, and a branch that already has an open PR goes to Phase 6, where `/do:pr` finds that PR, pushes any new commits, skips its local review phase and continues with the PR-side reviews. The `--self` / `--collaborators` gates still apply. A matching login or branch name without that local worktree is not enough, because the work may live on another machine.

**Drain one item — or several (`--swarm`).** By default `/do:next` ships one item per run. `--swarm` claims and ships several independent open issues in parallel, each in its own worktree subagent, serializing only the merge — auto-picked (`/do:next --swarm`) or exactly the issues you name (`/do:next --swarm #12 #14 #15`). See **Swarm mode**; Phases 1–7 are unchanged without `--swarm`.

## Parse Arguments

Split `$ARGUMENTS` on whitespace — `--` tokens are flags, the rest are **targets**. Value flags accept `--flag=value` or `--flag value` (the next token is the value, not a target). Order is free.

Collect targets into an ordered list `TARGETS`, **in this order**: **(1) expand** any comma-separated run of issue numbers (`12,14,15`, `#12,#14`) into one target each; **(2) normalize** (strip a leading `#`); **(3) de-duplicate**, order preserved — so `#12`/`12`, or `12,14` alongside `14`, never become two batch members racing for one issue. **Every target must be an issue number** (bare or `#`-prefixed); on any other target claim nothing and abort: ``"<target>" is not an issue number — /do:next claims tracker issues only (e.g. `#123`).`` **On a Jira tracker every target must be a key instead** (`PROJ-123`) — the tracker is known only after the Pre-flight, so a Jira run checks target shapes there instead, still before any claim, with [lib/tracker-jira.md](../../lib/tracker-jira.md) "Targets" (it uppercases, strips `#`, rejects bare numbers and other projects); de-duplicate on the key it prints, and "issue number" below means that key. **One target** is the single issue to claim. **Several targets** are an explicit `--swarm` batch. Several targets **without** `--swarm` is ambiguous: claim nothing and say ``You named <n> issues, but /do:next ships one item per run — add --swarm to batch them in parallel, or name a single item.`` (Never silently enable swarm — it's an ≈N× token bill.)

- **`#<issue>`** — claim that issue instead of auto-picking: an open issue number, bare (`123`) or `#`-prefixed. Naming an issue is a deliberate choice, so it overrides the auto-pick skips (a parking label such as `future`/`blocked`, an open declared blocker, an active label or dispatch-hint filter), and an epic is resolved per its children (Phase 1 step 3); say which skip you overrode. It does not override `--self` or `--collaborators` (Phase 1 step 5).
- **`--issues`** — deprecated no-op (the tracker is the only source). Print once: `--issues is now the default (PLAN.md mode was removed); the flag can be dropped.`
- **`--no-issues`** — abort before any claim: `--no-issues is no longer supported: PLAN.md mode was removed. slashdo records work only in the project's issue tracker.`
- **`--issues-label <name>`** — **restricts auto-pick to issues carrying that label** (a curated queue, e.g. the `plan`-labelled items `/do:replan` produced). Auto-pick is unfiltered by default. Record the label as `PLAN_LABEL` (default `plan`) — the default is still the label applied to issues this command *files* (Phase 4), but it only *filters* auto-pick when the flag (or a saved `issues-label` default) supplied it. Track an active filter as `LABEL_FILTER` (the label when explicitly provided; empty otherwise).
- **`--model <tier>[,…]`** / **`--effort <level>[,…]`** — restrict auto-pick to issues carrying a matching dispatch-hint label (see [lib/plan-issue-setup.md](../../lib/plan-issue-setup.md) "The dispatch hint"). `<tier>` is `light`, `medium` or `heavy`; `<level>` is `low`, `medium`, `high`, `xhigh` or `max`. Record them as `MODEL_FILTER` / `EFFORT_FILTER` (empty when absent). The values in one flag are alternatives and the two flags must both match: `--model light,medium --effort low` means (light or medium) and low. The extra value `none` matches an issue with no label on that axis (`--model light,none` is "light, or untiered"); without it untiered issues are excluded, so say so when the filter empties the queue. Give each flag once (`--model given twice — pass one comma-separated list.`), and reject an unknown value with `--model must be one of light, medium, heavy, none (got: {value}).` / `--effort must be one of low, medium, high, xhigh, max, none (got: {value}).` These flags only choose which issues are eligible: they never change this session's model, a swarm worker runs on its own issue's labels (Swarm Phase B), and an explicit `#<num>` ignores them. They have no saved default, because a forgotten saved narrowing looks the same as an empty backlog.
- **`--self`** / **`--no-self`** and **`--collaborators`** / **`--no-collaborators`** — security gates on the issue's author. An issue's text becomes instructions to this run, so these gates decide whose instructions it will act on. Unlike every other filter, an explicit `#<num>` cannot override them: auto-pick leaves such issues out and a named one is refused (Phase 1 step 5).
  - `--self` sets `SELF_MODE=true` (`--no-self`: `false`): claim only issues the authenticated user filed.
  - `--collaborators` sets `COLLAB_MODE=true` (`--no-collaborators`: `false`): claim only issues whose author is in the **trusted claim pool** — the live collaborator set from the host API (GitHub: `repos/:owner/:repo/collaborators`; GitLab: project members with `access_level >= 30`, Developer) plus the `--trusted-authors` list. Collaborators are always read live, never from a saved list.
  - `--self` is the stricter gate and wins when both are on. `--no-self` does not turn `COLLAB_MODE` off; `--no-collaborators` does. Each resolves from its flag, else its saved default (`self` / `collaborators`), else `false`.
  - A Jira tracker cannot enforce `--collaborators` (its reporters are not code-host collaborators): with `COLLAB_MODE` on and `SELF_MODE` off, a Jira run aborts in the Pre-flight per [lib/tracker-jira.md](../../lib/tracker-jira.md) "Claim gates".
- **`--trusted-authors <list>`** — extra GitHub/GitLab logins added to the trusted claim pool. It has no effect unless `COLLAB_MODE` is on, and it is not a saved collaborator list. Comma-separated (e.g. `howlingmime,Joebok`); strip a leading `@`, compare case-insensitively, and dedupe keeping the first spelling. Validate each login against `^[A-Za-z0-9][A-Za-z0-9-]*(\[bot\])?$` (the same shape as `/do:config`'s `@<login>` reviewer); abort with `Invalid --trusted-authors login: {value}. Use GitHub/GitLab logins (comma-separated), or none to clear.` A repeated flag is an error (`--trusted-authors given twice — pass one comma-separated list.`). An empty value or `none` (case-insensitive) means no extra authors for this run, and a saved `none` masks an inherited global list the way `review-with=none` does. Carry the normalized comma-separated string as `TRUSTED_AUTHORS`. Resolve from the flag, else the saved `trusted-authors` default, else empty.
- **Saved defaults.** Read both config files — `cat ~/.claude/.slashdo-config.json` (global) and `cat "$(git rev-parse --show-toplevel)/.slashdo.json"` (per-project; skip a missing file silently) — and merge their `.defaults` objects project over global; a typed flag always wins over its saved default. A saved `issues` key is ignored. A saved `issues-label` counts as an explicit choice: it sets `PLAN_LABEL` and `LABEL_FILTER` exactly as the flag would, and with neither, `LABEL_FILTER` stays empty. Likewise `SELF_MODE` from `self`, `COLLAB_MODE` from `collaborators`, `TRUSTED_AUTHORS` from `trusted-authors`, and `MERGE_ENABLED` / `MERGE_METHOD` from `merge` / `merge-method` (see `--merge` below). Resolve only these keys here; the review flags pass through to `/do:pr`, which resolves its own defaults.
- **`--swarm` / `--swarm=<N>`** — drain **several independent issues in parallel**, auto-picked or exactly the issue numbers you name. Records `SWARM=true`. Short-circuits Phases 1–7 into the **Swarm mode** flow below. Ignored (with a note) when only one issue is eligible / named. Review flags pass through to each swarm agent's `/do:pr` as in the single-issue flow.
  - **Batch membership.** **No target** → swarm auto-picks the first `SWARM_N` independent eligible issues (Phase A). **Two or more targets** (`--swarm #12 #14 #15`, `--swarm 12,14,15`) → that list **is** the batch, in the order given — a deliberate cherry-pick that bypasses the auto-pick skips exactly as a single explicit `#<num>` does (Phase A). **One target** (`--swarm #12`) → run the single-issue flow and say so.
  - **Concurrency (`SWARM_N`).** Bare `--swarm` resolves `SWARM_N=3` in **both** cases (a bare flag never raises concurrency because you named more issues); `--swarm=<N>` sets it, **clamped to `1..6`** (state the clamp). A batch bigger than `SWARM_N` runs in **waves** of `SWARM_N` (Phase B).
  - **Count vs. target disambiguation.** `--swarm=<N>` (attached) is always the count. Space-separated `--swarm <N>` consumes the next token as the count **only when** it is a bare integer **in `1..6`** with no `#` or comma **and** it is the *only* target token — so `--swarm 3` is three agents, while `--swarm #12 #14`, `--swarm 12,14`, and `--swarm 12 14` are two-issue batches, and `--swarm 12` is **issue 12** (a lone integer above 6 is far likelier an issue number). Say which reading you took, and note that `--swarm=12` is how to ask for a count that gets clamped.
- **`--plan`** — before writing code, enter an **interactive plan-mode session** (Phase 3.5): present a written plan, surface open questions, get explicit approval. Runs *after* the worktree is claimed. Rejection routes to Phase 7 cleanup like a Phase 3 skip. **Ignored in `--swarm` mode when more than one issue actually runs** (state the skip); honored when swarm degenerates to the single-issue flow.
- **`--review-with` / `--review-iterations` / `--review-mode` / `--review-stop-on-findings` / `--review-stop-on-clean` / `--reviewer-applies`** — passed through unchanged to `/do:pr` in Phase 6, which owns the review and ship machinery and their grammar. With neither `--review-with` nor `--no-review`, Phase 6 decides only whether the diff warrants a quality pass (`/simplify` or equivalent); it never picks an external reviewer, because `/do:pr` applies its own saved `--review-with` default, if any.
- **`--no-review`** opts out of both the quality pass and the external pass. `/do:pr` has no such flag, so Phase 6 sends it `--review-with none` instead, which empties the reviewer list and skips any saved `review-with` default.

The **`--merge`** / **`--no-merge`** / **`--merge=<method>`** / **`--merge-method <method>`** flags control **`/do:next`'s own merge**, not `/do:pr`'s. Phase 6 always ships through `/do:pr --no-merge`, then `/do:next` applies its own merge gate.
- **Enable:** `--merge` (the default) resolves `MERGE_ENABLED=true`. If both `--merge` and `--no-merge` appear, directly or through `--merge=<method>`, abort with `--merge and --no-merge cannot be combined`.
- **Disable:** `--no-merge` resolves `MERGE_ENABLED=false`: stop right after Phase 6 opens the PR, leave the worktree and the assignee + `in-progress` claim in place, skip Phase 7, and reuse the `dirty`/`inconclusive` stop path. With neither flag typed, resolve `MERGE_ENABLED` from the saved `merge` default, else the **built-in `true`**.
- **Method:** `--merge=<method>` also enables merging and sets `MERGE_METHOD=<method>`; `--merge-method <method>` sets only `MERGE_METHOD`. `<method>` ∈ `squash`/`rebase`/`merge` (GitHub only — GitLab merges with the project's default method); reject other values with `--merge=<method> must be one of squash, rebase, merge (got: {value}).` / `--merge-method must be one of squash, rebase, merge (got: {value}).`, and conflicting pairs with `--merge=<method> and --merge-method specify conflicting methods ({first} vs {second})` (identical methods are fine). `MERGE_METHOD` resolves the same way regardless of origin through [lib/merge-gate.md](../../lib/merge-gate.md) step 1.
- **Swarm:** ignore enable/disable; the orchestrator always attempts its own serialized merge in Phase C for every eligible result. `--merge=<method>` / `--merge-method` still resolve `MERGE_METHOD` for that Phase C merge.
- **Any other `--flag`** not defined above aborts immediately, before any claim is made: `Unknown /do:next option: {flag}. Supported: --issues-label, --model, --effort, --self, --no-self, --collaborators, --no-collaborators, --trusted-authors, --swarm, --plan, --review-with, --review-iterations, --review-mode, --review-stop-on-findings, --review-stop-on-clean, --reviewer-applies, --no-review, --merge, --no-merge, --merge-method.`

## Conventions

Three shapes recur below and are defined once here, then invoked by name (a fourth — the GitLab-only `glab api` capture rule, a two-step capture never piped straight to jq — is defined in [lib/next-gitlab.md](../../lib/next-gitlab.md)).

**Host verbs.** These names are the host-neutral operations used by the issue and PR phases below. A verb in a snippet is a dispatch instruction, not a literal shell function: run the selected host's form instead of re-inlining a `gh`/`glab` branch at a call site. The GitHub forms are canonical here; the GitLab forms and the two-step `glab api` rule live in [lib/next-gitlab.md](../../lib/next-gitlab.md). A failed verb remains a failure — do not substitute a host or turn an empty result into success. `assign_me` also leaves the authenticated login in `ME` for the assignee read-back. **The issue and label verbs follow the tracker, the rest the code host:** on a Jira tracker (`TRACKER_CLI` is `jira`) every `issue_*`, `label_*`, `assign_me`, and `unassign_me` runs its form in [lib/tracker-jira.md](../../lib/tracker-jira.md), while `open_refs`, `pr_claim_refs`, `collaborators`, `pr_title`, and `ci_wait_merge` stay on `CLI_TOOL`.

- `open_refs` — GitHub: `open_refs() { :; }` from [lib/next-github.md](../../lib/next-github.md), because GitHub has no repo-wide PR sweep.
- `pr_claim_refs` — run as `CLAIM_ID=<N> pr_claim_refs`. GitHub: the per-issue PR evidence collector in [lib/next-github.md](../../lib/next-github.md); it emits the head refs of the open PRs it surfaced plus a synthetic `issue-N` segment, and fails closed on incomplete evidence. GitLab: `pr_claim_refs() { :; }`, because its `open_refs` already lists every open MR source branch.
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
- `ci_wait_merge` — the merge gate's wait-mode command (push, wait on the required checks, merge). It is written out for each host in [lib/merge-gate.md](../../lib/merge-gate.md); run it from there.

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
Git-native rather than `gh repo view`/`glab repo view`: one less API round-trip, and it still works during an auth hiccup (local `origin/HEAD` first, remote query as fallback).

**Shell state does not carry between tool calls.** Some harnesses keep variables and the working directory from one shell call to the next and others reset both, so every snippet after Phase 2 re-declares `DEFAULT_BRANCH`, `SLUG` and `WORKTREE` itself and either starts with `cd "$WORKTREE"` or uses `git -C "$WORKTREE"`. Give file-reading and editing tools absolute `$WORKTREE/...` paths.

**`release_marker` — retracting a claim without shipping it:** run `unassign_me "$ISSUE_NUM" 2>/dev/null || true`, then `label_rm "$ISSUE_NUM" in-progress 2>/dev/null || true`. Both verbs are best-effort so one failed release cannot suppress the other. On a Jira tracker, run [lib/tracker-jira.md](../../lib/tracker-jira.md)'s `release_marker` block instead (the transition back, then the unassign).

## Swarm mode (`--swarm`)

Skip this section unless `SWARM` is true. When it is, the swarm flow replaces Phases 1–7: it claims and ships up to `SWARM_N` independent open issues at once, each in its own worktree subagent running the single-issue flow, and serializes only the merge. Read its file only then:

!read lib/next-swarm.md

## Phase 1: Pick

**Pre-flight — `/do:next` requires GitHub (`gh`) or GitLab (`glab`).** Detect the host and confirm its CLI is authenticated before claiming or implementing anything. The `origin` remote decides the host, including GitHub Enterprise and self-managed GitLab; `auth status` only says which CLI is usable:

!read lib/vcs-host.md

**Jira tracker (`TRACKER=jira`) only — read the Jira backend now** and run its Pre-flight (`{COMMAND}` = `/do:next`) in place of the tracker gate. It alone sets `TRACKER_CLI` to `jira`, plus `JIRA_PROJECT` and `LABEL_SEP=:`; its "Serving `/do:next`" section then supplies every issue step below — target keys, claim gates, the walk, the claim, `release_marker`, and the close. Any other tracker skips this read.

!read lib/tracker-jira.md

Otherwise, if the partial's tracker gate leaves `TRACKER_CLI` empty, abort naming the tracker — before claiming anything.

Carry `CLI_TOOL`/`VCS_HOST`/`TRACKER` (and `GH_HOST` on GitHub) and `LABEL_SEP` through every later phase — [lib/plan-issue-setup.md](../../lib/plan-issue-setup.md)'s own setup step reuses `CLI_TOOL` rather than re-detecting it, and every prefixed-label match below (the priority sort key, the dispatch-hint filter) is built from `LABEL_SEP`, not a hardcoded `:` — a hardcoded colon would silently stop matching `priority::5` / `model::light` on a GitLab tracker.

**GitLab only — read `lib/next-gitlab.md` now, before the first plain `glab api` call.** It holds the GitLab forms of the host verbs, the `glab api` capture rule, the native blocked-by lookup, the candidate-list walk, and the field-mapping table the jq expressions below build on. Run its jq probe now. A GitHub run never reads this file.

!read lib/next-gitlab.md

**GitHub only — define `open_refs` and `pr_claim_refs` from the shared `gh` collector now.** This follows
the code host, including a Jira tracker on GitHub; GitLab keeps its own `open_refs` and defines `pr_claim_refs() { :; }`.

!read lib/next-github.md

Build the in-flight set in Bash. Fetch and capture each source separately; a
failure aborts before claiming rather than hiding it behind `|| true`:

```bash
refresh_in_flight() {
  git fetch --prune || return 1
  LOCAL_REFS="$(git branch -a --no-color --format='%(refname:short)')" || return 1
  OPEN_REFS="$(open_refs)" || return 1
  IN_FLIGHT_REFS="$(printf '%s\n%s' "$LOCAL_REFS" "$OPEN_REFS")"
}
refresh_in_flight || { echo "Could not verify complete claim evidence — aborting."; exit 1; }
# in_flight: some ref has a `/`-segment that is exactly `issue-$CLAIM_ID` (CLAIM_ID = issue number or Jira key).
# The ID travels in the named variable CLAIM_ID, never a positional parameter, because skill hosts expand positional parameters in this text.
in_flight() { printf '%s\n' "$IN_FLIGHT_REFS" | tr '/' '\n' | grep -qixF -- "issue-${CLAIM_ID}"; }

# fresh_claim_check: run as `CLAIM_ID=<ID> fresh_claim_check`.
fresh_claim_check() {
  in_flight && return 1
  CLAIM_STATE="$(issue_state "$CLAIM_ID")" || return 1
  case "$CLAIM_STATE" in OPEN|open|opened) ;; *) return 1 ;; esac
  CLAIM_ASSIGNEES="$(issue_assignees "$CLAIM_ID")" || return 1
  [ -z "$CLAIM_ASSIGNEES" ] || return 1
  CLAIM_LABELS="$(issue_labels "$CLAIM_ID")" || return 1
  # CLAIM_RESERVED=1: this swarm run's own batch reservation put `in-progress` there (Swarm A2e), so only that label is expected.
  printf '%s' "$CLAIM_LABELS" | jq -e --arg reserved "${CLAIM_RESERVED:-}" '
    type == "array" and all(.[]; type == "string")
    and ($reserved == "1" or index("in-progress") == null)' >/dev/null || return 1
  # PR evidence scoped to this candidate, read last so a skipped candidate costs no PR lookup.
  CLAIM_PR_REFS="$(pr_claim_refs)" || return 1
  ! printf '%s\n' "$CLAIM_PR_REFS" | tr '/' '\n' | grep -qixF -- "issue-${CLAIM_ID}"
}
```

Every ref's `/`-segments and GitHub's synthetic segments form the in-flight set, and `CLAIM_ID=<ID> in_flight` is an exact segment match (a Jira project compares case-insensitively): `issue-12` never matches `feature/12` or `issue-123`, and `issue-PROJ-12` never matches `PROJ-123`. `CLAIM_ID=<ID> fresh_claim_check` adds live assignee and `in-progress` checks, including same-login assignment, then the candidate's PR evidence from `pr_claim_refs` (the same exact segment match), and refuses metadata or evidence errors. Its API cost is per candidate checked, not per open PR. On Jira retain its native In Progress transition/status gate as well (see its Claim procedure). Use this same gate for explicit targets, auto-pick, epic children and both swarm paths. The one variant is `CLAIM_RESERVED=1 CLAIM_ID=<ID> fresh_claim_check`, which a swarm worker runs only for an issue its orchestrator reserved (Swarm A2e): it accepts the `in-progress` label that reservation applied and still refuses an assignee, a branch, a PR or a failed read. Shell state does not persist: redefine the collector and these functions, and refresh evidence, in each Bash call that checks ownership.

### Phase 1 — issue queue

Run the shared issue setup — it reuses the `CLI_TOOL` the Pre-flight detected and aborts if neither host is authenticated (`PLAN_LABEL` is created lazily, in Phase 4, only if this run actually files a discovered-work issue):

!read lib/plan-issue-setup.md

> `/do:next` reads only the setup partial, not [lib/plan-issue-filing.md](../../lib/plan-issue-filing.md): it files at most one discovered-work issue (Phase 4), so it never needs every open issue's body in context. If Phase 4 does file one, check for a duplicate with a targeted issue search.

> The claim (Phase 2) uses the tracker's assignee field as the cross-machine marker. `assign_me` and `unassign_me` add or remove exactly one assignee without touching the others, which the race read-back depends on. Epic resolution (step 3) differs by host; see [lib/epic-children.md](../../lib/epic-children.md).

**Collaborator set — fetch once, only when `COLLAB_MODE` is on and `SELF_MODE` is not** (self is the stricter gate, and with `COLLAB_MODE` off `--trusted-authors` is not a gate of its own). The fetch fails closed: a failed call or an empty login set (the owner is always a collaborator) aborts the run, because "could not list them" must never become any-author or `--trusted-authors` alone. Compare issue authors with the trusted claim pool case-insensitively. A Jira run never gets here with the gate on; its Pre-flight refused it.

**GitHub only:** the VCS preflight has seeded `GH_HOST` from the checkout origin. Read the shared snippet below before the `collaborators` verb runs; it keeps that value, continues from the fallbacks when needed, and runs the per-host auth precheck. GitLab skips it (its form resolves the host from the remote).

!`cat ~/.claude/lib/gh-host.md 2>/dev/null || cat "$(dirname "$(readlink -f .claude/commands/do/next.md)")/../../lib/gh-host.md"`

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

1. **List candidates** — open issues, by priority then oldest first, across all labels and authors by default (`gh issue list`/`glab issue list` never return pull/merge requests). The standing guards are the in-flight check (step 2), the epic and declared-dependency skips (steps 3–4) and the parking-label skip (step 5). The opt-in narrowings: `LABEL_FILTER` restricts to one label; `MODEL_FILTER` / `EFFORT_FILTER` restrict by dispatch hint (below); `SELF_MODE` adds `--author "@me"`, which `gh` resolves server-side so other people's issues never load; and `COLLAB_MODE` (with `SELF_MODE` off) has no API-side flag, so read `author` on each issue and skip anyone outside the trusted claim pool during the walk, noting `#N filed by <author> — not a collaborator (and not on --trusted-authors)`.
   ```bash
   # Build the optional flags as a shell array, not via `${VAR:+--flag "$VAR"}`. zsh (a
   # common host shell) does not word-split the result of a parameter expansion, so
   # `${AUTHOR_FILTER:+--author "$AUTHOR_FILTER"}` expands to one argv word `--author @me`
   # and `gh issue list` aborts with `unknown flag: --author @me` (same trap for --label).
   # An array appends each flag and its value as separate words in both bash and zsh, and
   # expands to zero words when the filter is unset.
   # The --jq is PRIORITY_SORT (Conventions) in its GitHub form. `body` is deliberately not
   # listed: steps 3–4 fetch it per candidate.
   LIST_ARGS=(--state open)
   [ -n "$LABEL_FILTER" ] && LIST_ARGS+=(--label "$LABEL_FILTER")
   [ "$SELF_MODE" = "true" ] && LIST_ARGS+=(--author "@me")
   gh issue list "${LIST_ARGS[@]}" --limit 500 \
     --json number,title,assignees,labels,createdAt,author \
     --jq "PRIORITY_SORT | .[]"
   ```
   `--limit 500` keeps `gh issue list` (default 30) from truncating the queue before the client-side sort. If a repo has more than 500 open candidates, say that the cap was hit (`/do:replan` prunes, `--issues-label` scopes). Priority only orders the walk; an unprioritized issue is still claimable.

   **GitLab:** the walk is [lib/next-gitlab.md](../../lib/next-gitlab.md) "Phase 1 — candidate list": `glab issue list` with GitLab's field names, the two-step `ME` resolution a `--self` run needs (`glab` does not resolve `@me`), and a `--per-page 100` cap.

   **On a Jira tracker, the walk is [lib/tracker-jira.md](../../lib/tracker-jira.md) "Queue walk"** — JQL in place of `--label`/`--author`, the same `PRIORITY_SORT` and dispatch-hint clauses over `.fields.labels[]`, and the assignee, epic, and blocked-by fields the steps below read.

   **Dispatch-hint filter.** When `MODEL_FILTER` or `EFFORT_FILTER` is set, filter client-side in the same jq program: one `map(select(…))` per active axis, placed before `PRIORITY_SORT`. It cannot be a `--label` flag, because repeated `--label` flags AND together on both hosts. Build each clause from the validated values only, where `<axis>` is `model` or `effort` and `<SEP>` is `$LABEL_SEP` (a hardcoded `:` never matches GitLab's `model::light`):
   ```
   # an issue passes an axis when it carries one of the requested values …
   any(.labels[].name; . == "<axis><SEP>V1" or . == "<axis><SEP>V2" …)
   # … or, only when `none` was among them, when it has no label on that axis
   ([.labels[].name | select(startswith("<axis><SEP>"))] | length == 0)
   ```
   GitLab and Jira labels are plain strings, so drop the `.name` there (`.labels[]`; Jira `.fields.labels[]`). An axis whose only value is `none` uses the second clause alone, and an inactive axis gets no `map` at all. For `--model light,none --effort max` on GitHub:
   ```bash
   gh issue list "${LIST_ARGS[@]}" --limit 500 \
     --json number,title,assignees,labels,createdAt,author \
     --jq "map(select(any(.labels[].name; . == \"model${LABEL_SEP}light\")
                    or ([.labels[].name | select(startswith(\"model${LABEL_SEP}\"))] | length == 0)))
         | map(select(any(.labels[].name; . == \"effort${LABEL_SEP}max\")))
         | PRIORITY_SORT | .[]"
   ```
   The filter runs before every other skip, and an issue it excludes is "not what you asked for", not "not workable". If it empties a queue that had eligible work, step 7 names it with the flags written as they would be typed (`no eligible issue matching --model light --effort max — 14 open issues carry no dispatch hint; add `none` to include them`).
2. **Determine in-flight issues.** Issue `N` is in flight when `CLAIM_ID=N in_flight` succeeds, when `pr_claim_refs` finds an open PR for it, or when it already has any assignee or carries `in-progress` (the Phase 2 markers — a local-only branch on another machine is invisible here, but its markers are not). Require `CLAIM_ID=N fresh_claim_check` before selecting an issue; assignment to your own login is still in flight. A failed evidence read is unresolved and stops fresh claims.
3. **Resolve epics before picking (child-aware).** An epic (umbrella issue) is **not** a single claimable unit — its done-ness depends on its children. For any candidate that is an epic (carries `epic`/a repo umbrella label, has native sub-issues, or whose body — fetched per candidate, see step 4 — task-lists other issues), classify it with the shared epic logic (a Jira epic: `Epic` type or sub-tasks, per its "Jira" section) — read it only when a candidate is an epic:

!read lib/epic-children.md

   Act on the resulting state:
   - `epic-open` (≥1 child still OPEN) → **skip** as not-yet-workable; note `epic #N: X/Y children open`.
   - `epic-done` (all children CLOSED, no wrap-up tasks) → nothing to implement; **close it inline** using [lib/epic-children.md](../../lib/epic-children.md)'s "Closing an epic" step, note it, and keep scanning.
   - `epic-wrapup` (all children CLOSED, wrap-up tasks remain) → **this is claimable work**: "complete epic #N's remaining wrap-up tasks." Claim it like any issue — Phase 4 does the wrap-up (and ticks the wrap-up checkboxes in the epic body), and the Phase 6 PR carries `Closes #<N>`.
   - `epic-empty` (no children resolvable either way) → treat as an ordinary issue.
4. **Resolve declared dependencies before picking (blocked-by).** A candidate may declare a hard dependency in its **body**: a line matching `Depends on #<N>` or `Blocked by #<N>` (case-insensitive; one line may list several, e.g. `Depends on #12, #15`). Collect every `#<N>` on those lines. The step-1 walk omits bodies, so **fetch the body for this candidate only** with `issue_body <N>` — the same fetch serves step 3's task-list check. A candidate is **blocked** when any referenced issue is still open — check the freshest state with `issue_state <N>` and test for "closed" rather than an exact "open" match (`OPEN`/`CLOSED` vs `opened`/`closed`); a referenced number that is closed, or doesn't exist, does not block. Resolve **lazily** as you walk (only for the candidate you're about to pick).
   - `blocked` (≥1 referenced issue still open) → **skip** in auto-pick; note `#N blocked by #M (open)`. Self-clearing: when #M closes, #N becomes eligible.
   - Also honor each host's **native** blocked-by relationship when the API surfaces it — GitHub's GraphQL `blockedBy` connection, GitLab's Issue Links API filtered to `link_type: "is_blocked_by"`, or Jira's `issuelinks`. Use the GitLab procedure in [lib/next-gitlab.md](../../lib/next-gitlab.md) and Jira procedure in [lib/tracker-jira.md](../../lib/tracker-jira.md); each treats a failed or malformed native lookup as **UNRESOLVED**, not unblocked. An unresolved native lookup skips the candidate during auto-pick and says so (`#N: native blocked-by lookup unresolved — skipping auto-pick`); it must never fall back to body dependencies alone. An explicitly named issue may proceed only as an explicit override, with a warning that native blocker state could not be verified. The body and native sources are OR'd (blocked by *either* ⇒ skip).
   - **Cycle / unresolvable chain** (A depends on B, B depends on A) → both stay skipped; note the cycle so a human can break it. Never loop trying to resolve one.
5. **Pick the target issue:**
   - **With an argument** — set `ISSUE_NUM` to the number (without the `#`) and check, in this order:
     1. **`--self`.** When `SELF_MODE` is on, the author from `issue_author "$ISSUE_NUM"` must be the authenticated login (GitLab: resolve that login with the two-step capture in [lib/next-gitlab.md](../../lib/next-gitlab.md), as the claim verb does; Jira: the JQL check in [lib/tracker-jira.md](../../lib/tracker-jira.md) "Claim gates", never a display-name comparison). Otherwise stop with `Issue #<num> was filed by <author>, not you — /do:next --self only works on issues you filed. Drop --self to claim it.`
     2. **`--collaborators`.** When `COLLAB_MODE` is on and `SELF_MODE` is not, that author must be in `TRUSTED_CLAIM_POOL`, compared case-insensitively. Otherwise stop with `Issue #<num> was filed by <author>, who is not a collaborator on <owner/repo> (and not on --trusted-authors) — /do:next --collaborators only claims collaborator-authored issues. Drop --collaborators to claim it.`
     3. **Open and not in flight** (step 2). An in-flight issue that meets "Resuming your own stopped run" (top of this file) is resumed; any other closed or in-flight issue prints why and stops.
     4. **Epic.** Resolve its state (step 3): claim an `epic-wrapup`, close an `epic-done`, and for an `epic-open` warn that children are still open and proceed.

     Everything else auto-pick would skip — a parking label, an open declared blocker (step 4), an issue outside `LABEL_FILTER` or `MODEL_FILTER`/`EFFORT_FILTER` — the named number overrides. Say so plainly ("claiming `future`-labelled #123 by explicit request", "claiming #123 despite open blocker #120 by explicit request").
   - **Without an argument** — take the first candidate in the step-1 walk that is not in flight or assigned, carries no parking label (`blocked`, `needs-input`, `wontfix`, `discussion`, `future`, or a repo-specific one), has no open declared dependency (step 4), is not an `epic-open`/`epic-done` epic (an `epic-wrapup` is eligible), and passes the `COLLAB_MODE` author check from step 1 (the author is `.author.login` on GitHub and `.author.username` on GitLab). Note each skip.
6. **Set `ISSUE_NUM=<num>` and `SLUG="issue-${ISSUE_NUM}"`** (Jira: the key, so `ISSUE_NUM=PROJ-123` and `SLUG=issue-PROJ-123`). Later phases use `SLUG` for the worktree and branch and `ISSUE_NUM` for the host verbs. If the issue carries a dispatch hint, report it (`#42 hints model:heavy + effort:high`). In the single-issue flow that is information only, since a session cannot change its own model mid-run: on a clear mismatch say so (`this session is on <current model> and #42 hints model:heavy — consider restarting on a stronger model, or continue as-is`) and continue. Swarm is where the hint is applied (Phase B).
7. **If no eligible issue exists**, print why and stop, naming the filter that emptied the queue when one did (`LABEL_FILTER`, `MODEL_FILTER`/`EFFORT_FILTER`, `SELF_MODE` or `COLLAB_MODE`); an opt-in narrowing that hides workable issues otherwise looks the same as having none. Do not open new issues here — that only happens for work discovered while implementing (Phase 4/6).

## Phase 2: Claim (worktree)

`/do:next` always works in a sibling worktree (`../next-issue-<num>`, branch `next/issue-<num>`), so a second `/do:next` in another tab never fights over the main repo's working tree. Create the branch with `git worktree add`, not `git checkout -b` / `git switch -c` in the main repo: a claim branch without its worktree blocks every later claim until someone cleans it up. Run this as one shell invocation, with Phase 1's collector and gate functions defined in it and the real issue number substituted:

```bash
ISSUE_NUM="<picked-issue-number>"
# Recheck live evidence immediately before creating anything (also for epic children and swarm workers).
refresh_in_flight || { echo "Claim evidence unresolved — aborting."; exit 1; }
CLAIM_ID="$ISSUE_NUM" fresh_claim_check || { echo "Issue #$ISSUE_NUM is claimed or ownership is unresolved — stopping."; exit 1; }
REPO_ROOT="$(git rev-parse --show-toplevel)" && \
SLUG="issue-${ISSUE_NUM}" && \
# The default-branch one-liner (Conventions):
DEFAULT_BRANCH="$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@' || true)" && \
DEFAULT_BRANCH="${DEFAULT_BRANCH:-$(git remote show origin | sed -n 's/.*HEAD branch: //p')}" && \
WORKTREE="$(dirname "$REPO_ROOT")/next-${SLUG}" && \
git fetch origin "${DEFAULT_BRANCH}" && \
git worktree add -b "next/${SLUG}" "${WORKTREE}" "origin/${DEFAULT_BRANCH}" && \
cd "${WORKTREE}" && \
pwd && \
# Publish the claim atomically: with an empty lease the push succeeds only while the remote ref does not exist.
if ! git push --force-with-lease="refs/heads/next/${SLUG}:" -u origin "next/${SLUG}:refs/heads/next/${SLUG}"; then
  echo "Could not publish next/${SLUG} (another run claimed it, or the push failed) — removing the local worktree and branch. Re-run /do:next."
  echo "If next/${SLUG} exists on the remote and no other run is working the issue, delete that remote branch before re-running."
  git -C "$REPO_ROOT" worktree remove --force "$WORKTREE" || echo "WARN: remove the worktree $WORKTREE manually."
  git -C "$REPO_ROOT" branch -D "next/${SLUG}" || echo "WARN: remove the local branch next/${SLUG} manually."
  exit 1
fi
```

Check that `pwd` printed the worktree path. If it printed the main repo path, the worktree creation or the `cd` failed: stop and report it. Later snippets re-anchor per Conventions.

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

Before writing code, sanity-check that executing the item as worded won't regress newer work. **Ask the user before proceeding if any hold:**

- The full issue body/comments from `issue_body --comments <num>` supersede the title, the issue is already resolved, it's a pure discussion/question with no actionable change, or it awaits an unanswered clarification.
- The item references a function/file/component that no longer exists or was heavily rewritten — `grep -rn` the named identifiers; if absent, it's stale and needs a human re-spec. OR it depends on an unshipped predecessor. OR the work would touch >5 unrelated files (bigger than estimated).

On "skip", run Phase 7 cleanup and re-run Phase 1 for the next item. **Also run `release_marker`** (Conventions) — the same release Phase 2 uses to yield.

## Phase 3.5: Plan (interactive) — only when `--plan` was passed

Skip unless `--plan` is set. Before touching code:

1. Gather just enough context to plan: read the files the item names, grep its identifiers, confirm integration points.
2. Enter the harness's plan mode if it has one (otherwise present the plan in the conversation and wait), and present the item, the approach, the files to add or change, the tests, and any migration, compatibility or changelog obligations the project's own docs impose.
3. Ask only the questions whose answers change the implementation; pick obvious defaults and state them.
4. Get explicit approval before Phase 4.
5. On rejection, treat it like a Phase 3 skip: Phase 7 cleanup and `release_marker`.

## Phase 4: Implement

Write the code, tests and docs the item requires, following the target repo's own conventions (`CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING`). Run focused tests for the changed behavior as you go. Validation before a push follows `/do:pr`'s "Local validation policy", which Phase 6 applies: the repo's documented pre-push command when it has one, and its broad suites (full, browser, database, boot-smoke) only when that policy asks for them.

**Claimed an `epic-wrapup` epic** (Phase 1 step 3)? The work unit is the epic's own remaining wrap-up tasks. Do them, then **tick the corresponding `- [ ]` boxes in the epic body** with `issue_body --set "$ISSUE_NUM" <updated-body>`. The Phase 6 PR's `Closes #<epic>` closes it on merge.

**Roll discovered backbone work INTO this PR — don't defer it.** A helper to extract, a shared abstraction, a small refactor that makes the fix cleaner — fold it in, test it, mention it in the PR body. Only defer work that is **genuinely large** (its own multi-file feature, a migration, a cross-cutting redesign). The bar is "this needs its own PR," not "slightly outside the line-item's wording."

- **Deferred work** → file a new tracker issue with enough context to pick up cold (file paths, why it was split out, which issue surfaced it), labelled `PLAN_LABEL` so `/do:next` and `/do:replan` treat it as queued. Add a dispatch-hint label only when you can justify one, per [lib/plan-issue-setup.md](../../lib/plan-issue-setup.md) "The dispatch hint": a hint stamped on every discovered issue makes `/do:next --model` meaningless. Build it as `model${LABEL_SEP}<tier>` / `effort${LABEL_SEP}<level>`, never with a hardcoded `:`, which would miss GitLab's scoped labels. Create each label with `label_ensure` just before `issue_create`, and pass each label as its own argument:
  ```bash
  label_ensure "$PLAN_LABEL" "428BCA" "Tracked by slashdo"
  issue_create "<concise actionable title>" "$(printf 'Discovered while working issue #%s.\n\n<what, where (file:line), why it needs its own PR>\n' "$ISSUE_NUM")" "$PLAN_LABEL" <hint label — omit when unjustified>
  ```
  On Jira the body is a file and names the key (`Discovered while working PROJ-123.`).

**Commit messages** follow the project's convention: what its `CLAUDE.md` / `AGENTS.md` / `CONTRIBUTING` states, else the style its `git log` shows. Only when neither gives one, use `feat([issue-<num>]): <one-line description>` (or `fix` / `refactor` / `chore`; on Jira the tag is the key, `feat([PROJ-123]): …`). The branch name and the PR's `Closes #<num>` already tie the work to the issue.

## Phase 5: Record completion + changelog

**Mark the work item done** by closing the issue via `Closes #<num>` in the PR body (Phase 6) — on Jira, by the post-merge transition in Phase 7 instead.

**Changelog.** Log the shipped work the way this project already logs changes, resolved as `/do:push` does: a convention stated in `CLAUDE.md` / `AGENT.md` / `AGENTS.md` / `CONTRIBUTING.md` first; otherwise imitate existing changelog artifacts (a rolling `CHANGELOG.md`, a per-release directory with an unreleased staging file, a fragment tool like `.changeset/` or `changelog.d/`). If the project has no file-based changelog (its release notes come from commit messages), skip the rest of this phase; never invent a changelog file.

Match the existing entries' shape and grouping, and write for a user of the app rather than a coder inside it (no file paths, function names or test counts, unless the work is purely internal). Only when the file has no established shape, use a `##` heading named for the feature or capability and a bullet that leads with the issue:

```markdown
## <Feature or capability name>
- **[issue-<num>] <Short, user-facing title>** — <one sentence on the user-visible effect>
```

**Sync first only when the changelog moved.** A shared changelog is where sibling claims collide, so before editing it, merge the default branch if the base has changed that file since this branch started. Otherwise leave the branch as it is; default-branch movement by itself is not a reason to merge.

```bash
SLUG="issue-<num>"; WORKTREE="../next-${SLUG}"; CHANGELOG_FILE="<the changelog path you are about to edit>"
DEFAULT_BRANCH="$(git -C "${WORKTREE}" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@' || true)"
[ -n "$DEFAULT_BRANCH" ] || DEFAULT_BRANCH="$(git -C "${WORKTREE}" remote show origin | sed -n 's/.*HEAD branch: //p')"
cd "${WORKTREE}" && git fetch origin "${DEFAULT_BRANCH}" && \
  { git diff --quiet "HEAD...origin/${DEFAULT_BRANCH}" -- "$CHANGELOG_FILE" || git merge --no-edit "origin/${DEFAULT_BRANCH}"; }
```

**Conflict rule — deletions win.** Resolve a changelog conflict so that a line removed on either side stays removed, and keep additions from both. Then `git add` the specific resolved files and `git commit --no-edit`; `git add -A` or `git add .` while paths are still unmerged would stage raw conflict markers. Phase 6's re-sync uses the same rule.

Then write the entry and commit it in the project's commit style (fallback subject: `docs([issue-<num>]): log issue #<num>`), or fold it into the implementation commit where the project prefers one commit per change. `{CHANGELOG_FILE}` is the file you wrote:

```bash
git add {CHANGELOG_FILE}
git diff --cached --quiet || git commit -m "<subject>"   # nothing staged means nothing to commit
```

## Phase 6: Review and ship — delegate to `/do:pr`

> **Link the PR to the issue.** The PR body must contain `Closes #<num>` (or `Fixes #<num>`) so merging closes the claimed issue. Reference follow-up issues you filed with a plain `#<n>`, since this PR does not resolve them. **On a Jira tracker** the body says `Jira: <KEY>` (follow-ups by key) and carries **no** `Closes #…` — on the code host that would close an unrelated issue.
>
> **Major review findings become tracker issues.** A substantial finding you decide not to fix here is filed with `issue_create` and the same labels as Phase 4. Nits are just mentioned in the summary.

`/do:pr` (the workflow defined in `~/.claude/commands/do/pr.md`) owns the whole review and ship pipeline: the Local Code Review gate, the `--review-with` loop and its options. Run it from inside the worktree and do not re-implement any of it here. Forward only the review flags listed in Parse Arguments, and **always pass `--no-merge`**: `/do:next` owns the merge decision (the gate below), the post-merge cleanup and the issue close, even when a saved `/do:config --merge` default would make `/do:pr` merge on its own. Never forward this command's own `--merge` / `--no-merge` / `--merge=<method>` / `--merge-method`. When a run returns to a branch whose PR is already open (a resumed run, host feedback, a CI fix), `/do:pr` adopts that PR, skips its local review phase and continues with the PR-side reviews, so later commits are covered by the PR-side reviewers and CI rather than by a new local review after each push. With no PR yet, it repeats the local phase unless its branch note (`branch.<name>.slashdo-local-review`) records a finished review of the current HEAD, in which case only the PR creation is retried.

> **`/simplify`** below means the harness's built-in quality pass where it has one; otherwise do the pass by hand. It is not `/do:simplify`, slashdo's refactor-audit workflow, which opens its own per-category PRs.

| The user passed… | Run |
|---|---|
| `--review-with=<agents>` | `/simplify` (skip it for a trivial diff), then `/do:pr --no-merge --review-with=<agents>` plus any `--review-iterations` / `--review-mode` / stop-mode / `--reviewer-applies` given |
| `--no-review` | `/do:pr --no-merge --review-with none` — its Local Code Review gate still runs; no external pass, no `/simplify` |
| neither | Judge the diff for the quality pass only (`/simplify` for new code paths, abstractions or multi-file work; skip it for a value swap, typo or one-line fix), then `/do:pr --no-merge` with no review flags, so `/do:pr` resolves its own saved `--review-with` default. Do not pick a reviewer here. If the diff is non-trivial and `/do:pr` reports that no reviewer ran, say so in the summary and suggest `--review-with` / `/do:config --review-with`. |

Say what you skipped and why ("Diff is 3 lines in one file; skipping the quality pass"). `/do:pr` pushes `next/issue-<num>`, opens the PR, runs the chosen review loop and reports an aggregate status. The PR title follows the project's convention as `/do:pr` wrote it; only when the project states none and the title does not mention the issue, add the fallback prefix with `pr_title <PR> "feat([issue-<num>]): <description>"`.

**Gate the merge on the review result.**

- **`MERGE_ENABLED` must be `true`.** `--no-merge` (or a saved `merge=false` default) stops here whatever the review status.
- **Gate on the `OVERALL_STATUS` `/do:pr` reports, not on the flags this run typed.** It is `clean` when no external reviewer ran (`--no-review`, `--review-with none`, or no flag and no saved default) and otherwise the aggregate of the reviewers that ran, which may include a saved default this run never named.
- **Merge only on `clean`**, or on `partial` when you explicitly passed a `--review-stop-on-*` flag. Never merge on `dirty` (build or tests broken, or a hard-error short-circuit) or `inconclusive` (a requested reviewer was missing, timed out, errored or was skipped).

On `dirty`/`inconclusive`, or when `MERGE_ENABLED=false`, stop and leave the PR open: report the status (or that merging was skipped by request) and the PR URL, and do not run Phase 7, so the worktree, branch, assignee and `in-progress` marker stay for whoever finishes the work. To finish it later, name the issue: `/do:next #<num>` resumes it (see "Resuming your own stopped run").

**Re-sync only if the base now overlaps this branch, then merge (only when the gate above passed).** Sibling claims can merge during a long review loop. Default-branch movement alone is not a reason to rewrite a ready branch or restart CI and review, but when the base-only commits touch a file this branch also changes (a shared changelog is the usual case; a stale one can resurrect lines siblings removed), merge the base in once more. Skip the merge when the two file lists below do not intersect:

```bash
# Re-declare (Conventions; `-C` since we're not cd'd here):
SLUG="issue-<num>"; WORKTREE="../next-${SLUG}"
DEFAULT_BRANCH="$(git -C "${WORKTREE}" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@' || true)"
[ -n "$DEFAULT_BRANCH" ] || DEFAULT_BRANCH="$(git -C "${WORKTREE}" remote show origin | sed -n 's/.*HEAD branch: //p')"
cd "${WORKTREE}" && git fetch origin "${DEFAULT_BRANCH}" && \
  if [ -n "$(comm -12 <(git diff --name-only "HEAD...origin/${DEFAULT_BRANCH}" | sort) <(git diff --name-only "origin/${DEFAULT_BRANCH}...HEAD" | sort))" ]; then
    git merge --no-edit "origin/${DEFAULT_BRANCH}"   # then rerun validation/required checks on the new HEAD
  else
    echo "base moved without touching this branch's files — keeping the validated HEAD"
  fi
```

**If that merge reports a conflict**, stop and resolve it by hand under Phase 5's deletions-win rule (and its warning about `git add -A` while paths are unmerged). Push and merge only once `git status` shows no unmerged paths.

**Merge through the shared merge gate**, only once the review gate passed and the tree has no conflicts. `/do:pr` ran with `--no-merge`, so no CI gate has run, and the gate's push publishes a new SHA whose checks have not started: its wait mode pushes, waits on the required checks and then merges, with its own no-checks and flake handling. Run it from inside `${WORKTREE}` with these inputs: `{PR}` is the PR/MR number, `{GIT}` is `git`, `{MODE}` is `wait`, `{LINKED_WORKTREE}` is `1`, and `{MERGE_METHOD}` is the `MERGE_METHOD` from Parse Arguments (it may be unset). **Skip the remote delete in the gate's step 5; Phase 7 owns it**, because Phase 7 must delete the local branch first (`git branch -d` checks the branch against its remote-tracking ref). On GitLab the gate's merge already removes the source branch, and Phase 7 treats an already-gone remote ref as success:

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
  [ "$RC" -eq 2 ] || echo "ERROR: claim not retracted — delete next/${SLUG} manually (ls-remote rc=$RC)"
fi
```

(Phase 2's marker-block abort and yield retract the remote branch inline and leave the local worktree and branch for this same teardown, run from the main repo. A failed claim push has already removed them.)

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
