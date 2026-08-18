# Epic Children & Lifecycle (issue mode)

Shared logic for resolving an **epic** (umbrella issue) to its child issues,
deciding when the epic is complete, and closing it. Consumed by `/do:next`
(claim/skip an epic, close a parent after its last child ships) and
`/do:replan` (triage an epic by its children, not by code evidence).

**GitHub or GitLab.** Reuse `$CLI_TOOL` (`gh`/`glab`) if the calling command
already detected it in its own discovery phase. GitHub exposes a native,
project-scoped **sub-issues** API that resolves an epic's children directly.
GitLab has no project-scoped equivalent — its closest analog, group-level
Epics, is a different, tier-gated feature with different scope (an epic there
belongs to a *group*, not the project an issue lives in), so this file doesn't
attempt to map it. On GitLab the **convention fallback** below (body
task-lists + back-references) is therefore the *primary* path, not a
last resort — and it's host-agnostic by construction, so every command in it
is given both a `gh` and a `glab` form.

On GitHub, set `OWNER`/`REPO` once per run:
`OWNER_REPO="$(gh repo view --json owner,name -q '.owner.login + "/" + .name')"`
then `OWNER="${OWNER_REPO%/*}"; REPO="${OWNER_REPO#*/}"`.
Also set `GH_HOST` once — `gh api` (used below) defaults to github.com and does **not**
read the repo remote, so on a GitHub Enterprise repo it must be told the host
explicitly (see `~/.claude/lib/gh-host.md`):
`GH_HOST="$(git remote get-url origin 2>/dev/null | sed -E 's#^[a-z]+://##; s#^[^@/]+@##; s#[:/].*$##')"; [ -n "$GH_HOST" ] || GH_HOST=github.com`
Pass `--hostname "$GH_HOST"` on every `gh api` call below (the `gh issue`/`gh pr`
calls resolve the host from the remote on their own and need no flag).

On GitLab, no equivalent setup is needed: `glab issue`/`glab api` already
resolve the host (including a self-managed/Enterprise GitLab instance) from
the repo's `origin` remote on their own.

## When does an issue count as an epic?

Treat issue `#N` as an epic (umbrella) if **any** hold:
- it carries the `epic` label (or a repo-specific umbrella label), **or**
- (GitHub only) the API reports it has native sub-issues, **or**
- its body/description contains a task-list that references other issues (`- [ ] #123`).

An issue that matches none of these is an ordinary issue — handle it normally.

## Resolving the children of epic #N — native first, convention fallback

1. **Native sub-issues (GitHub only, preferred when available).**
   ```bash
   gh api --hostname "$GH_HOST" "repos/$OWNER/$REPO/issues/$N/sub_issues" --paginate \
     --jq '.[] | "\(.number)\t\(.state)"' 2>/dev/null
   ```
   GraphQL equivalent when REST is unavailable:
   ```bash
   gh api --hostname "$GH_HOST" graphql -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){issue(number:$n){subIssues(first:100){nodes{number state}}}}}' \
     -F o="$OWNER" -F r="$REPO" -F n="$N" --jq '.data.repository.issue.subIssues.nodes[] | "\(.number)\t\(.state|ascii_downcase)"' 2>/dev/null
   ```
   If either returns rows, **those are the children** — use them and skip the
   convention scan. An empty result / `404` / `410` means "fall back" (feature
   not enabled, older GHES, or no sub-issues) — it does **not** mean "zero
   children." **On GitLab (`$CLI_TOOL = glab`), skip this step entirely** and go
   straight to the convention fallback — there is no project-scoped equivalent
   to probe.

2. **Convention fallback** (GitHub: only when native returned nothing; GitLab: always):
   - **Body task-list issue refs.** Read the epic body:
     - GitHub: `gh issue view "$N" --json body -q .body`
     - GitLab: `glab issue view "$N" --output json --jq .description`
     collect every `- [ ] #M` / `- [x] #M` line — each `#M` is a child (record whether the box is checked).
   - **Back-references.** Issues that name this epic as parent:
     - GitHub: `gh issue list --state all --search "in:body \"Part of #$N\"" --limit 200 --json number,state`
     - GitLab: `glab issue list --all --search "Part of #$N" --in description --output json --per-page 100 --jq '.[] | {number: .iid, state: .state}'`
       (`--all` includes closed issues, matching `--state all`; `--in description` scopes the search the way GitHub's `in:body` does — GitLab's default `--in` also matches the title, which is broader than needed here.)
     Also accept `Parent: #$N` and `Epic: #$N`. Exclude `#N` itself.
   - **Union** both sets, dedupe by number; fetch state for any unknown:
     - GitHub: `gh issue view <m> --json state -q .state`
     - GitLab: `glab issue view <m> --output json --jq .state`

A child's state means **open or closed** — **test only for "closed"
case-insensitively, never for an exact "open" match**: the two hosts don't even
agree on the open word (GitHub's REST/GraphQL return `OPEN`/`CLOSED`, GitLab
returns `opened`/`closed`), so testing "is it closed" sidesteps the `open` vs
`opened` mismatch entirely. **All children closed** ⇔ at least one child was
resolved **and** every resolved child's state is closed.

## Epic-level wrap-up tasks

Separate from child *issue* refs, an epic body often carries its own plain
task-list items (`- [ ] write release notes`, `- [ ] cut the release`) that are
**not** `#`-issue references. Collect the **unchecked** ones as `WRAPUP_TASKS` —
this is work the epic itself owns once its children land.

## Completeness states

Given the resolved children and `WRAPUP_TASKS`:

| State | Condition | Meaning |
|---|---|---|
| `epic-open` | ≥1 child OPEN | Not done — never close. |
| `epic-wrapup` | all children CLOSED, `WRAPUP_TASKS` non-empty | Children done; the epic still has its own work. |
| `epic-done` | all children CLOSED, `WRAPUP_TASKS` empty | Ready to close. |
| `epic-empty` | no children resolved by either method | Not really an umbrella — treat as an ordinary issue. |

## Closing an epic

Close **only** in the `epic-done` state. By the parent/child convention children
carry `Part of #N` (**not** `Closes #N`), so merging a child never auto-closes
the epic — it must be closed explicitly:
- GitHub: `gh issue close "$N" --comment "All children closed (#a, #b, …) and wrap-up complete — closing epic. (slashdo)"`
- GitLab: `glab issue close` has no `--comment` flag, so post the note first, then close:
  `glab issue note "$N" -m "All children closed (#a, #b, …) and wrap-up complete — closing epic. (slashdo)" && glab issue close "$N"`

Never close an `epic-open` epic even if its title reads as done. In
`--interactive` flows, surface the candidate and ask before closing.

## Resolving a child's parent epic (for the post-ship hook)

After a child issue closes, find its parent so the epic can be re-evaluated:

1. **Native (GitHub only):**
   ```bash
   gh api --hostname "$GH_HOST" graphql -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){issue(number:$n){parent{number}}}}' \
     -F o="$OWNER" -F r="$REPO" -F n="$CHILD" --jq '.data.repository.issue.parent.number' 2>/dev/null
   ```
   On GitLab, skip this step and go straight to the convention fallbacks below.
2. **Convention fallback — child back-reference:** parse the just-closed child's
   body/description for `Part of #P` / `Parent: #P` / `Epic: #P`:
   - GitHub: `gh issue view "$CHILD" --json body -q .body`
   - GitLab: `glab issue view "$CHILD" --output json --jq .description`
3. **Convention fallback — parent checklist back-search.** A parent may link the
   child *only* through its own body task-list (`- [ ] #$CHILD`) while the child
   carries no back-reference — the forward resolver above accepts that format, so
   the reverse path must too, or such an epic is never re-checked after its last
   child ships. Search open issue bodies/descriptions that mention the child, then
   keep only one whose body actually task-lists it:
   - GitHub:
     ```bash
     for P in $(gh issue list --state open --search "in:body \"#$CHILD\"" --limit 100 --json number -q '.[].number'); do
       [ "$P" = "$CHILD" ] && continue
       gh issue view "$P" --json body -q .body | grep -Eq -- "- \[[ xX]\] #$CHILD\b" && { echo "$P"; break; }
     done
     ```
   - GitLab:
     ```bash
     for P in $(glab issue list --search "#$CHILD" --in description --output json --per-page 100 --jq '.[].iid'); do
       [ "$P" = "$CHILD" ] && continue
       glab issue view "$P" --output json --jq .description | grep -Eq -- "- \[[ xX]\] #$CHILD\b" && { echo "$P"; break; }
     done
     ```
   (The search narrows the scan; the `grep` confirms it is a real checklist entry, not an incidental mention.)

If a parent epic `#P` is found, run the completeness check on `#P`: close it when
`epic-done`; when `epic-wrapup`, comment that the children are complete and the
wrap-up tasks remain (so a later `/do:next` surfaces it). Leave it untouched when
`epic-open`.
