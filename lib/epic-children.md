# Epic Children & Lifecycle (issue mode)

Shared logic for resolving an **epic** (umbrella issue) to its child issues,
deciding when the epic is complete, and closing it. Consumed by `/do:next`
(claim/skip an epic, close a parent after its last child ships) and
`/do:replan` (triage an epic by its children, not by code evidence).

**GitHub only.** The native path uses GitHub's sub-issues API; the convention
fallback is host-agnostic but the commands that inline this file already gate
on `gh`. Set `OWNER`/`REPO` once per run:
`OWNER_REPO="$(gh repo view --json owner,name -q '.owner.login + "/" + .name')"`
then `OWNER="${OWNER_REPO%/*}"; REPO="${OWNER_REPO#*/}"`.
Also set `GH_HOST` once — `gh api` (used below) defaults to github.com and does **not**
read the repo remote, so on a GitHub Enterprise repo it must be told the host
explicitly (see `~/.claude/lib/gh-host.md`):
`GH_HOST="$(git remote get-url origin 2>/dev/null | sed -E 's#^[a-z]+://##; s#^[^@/]+@##; s#[:/].*$##')"; [ -n "$GH_HOST" ] || GH_HOST=github.com`
Pass `--hostname "$GH_HOST"` on every `gh api` call below (the `gh issue`/`gh pr`
calls resolve the host from the remote on their own and need no flag).

## When does an issue count as an epic?

Treat issue `#N` as an epic (umbrella) if **any** hold:
- it carries the `epic` label (or a repo-specific umbrella label), **or**
- GitHub reports it has native sub-issues, **or**
- its body contains a task-list that references other issues (`- [ ] #123`).

An issue that matches none of these is an ordinary issue — handle it normally.

## Resolving the children of epic #N — native first, convention fallback

1. **Native sub-issues (preferred).**
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
   children."

2. **Convention fallback** (only when native returned nothing):
   - **Body task-list issue refs.** Read the epic body (`gh issue view "$N" --json body -q .body`);
     collect every `- [ ] #M` / `- [x] #M` line — each `#M` is a child (record whether the box is checked).
   - **Back-references.** Issues that name this epic as parent:
     ```bash
     gh issue list --state all --search "in:body \"Part of #$N\"" --limit 200 --json number,state
     ```
     Also accept `Parent: #$N` and `Epic: #$N`. Exclude `#N` itself.
   - **Union** both sets, dedupe by number; fetch state for any unknown
     (`gh issue view <m> --json state -q .state`).

A child's state is `OPEN` or `CLOSED` — **compare case-insensitively**, since the
sources disagree on casing: REST `sub_issues` returns lowercase `open`/`closed`,
GraphQL returns uppercase (downcased above), and `gh issue view --json state`
returns uppercase. **All children closed** ⇔ at least one child was resolved
**and** every resolved child is closed.

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
```bash
gh issue close "$N" --comment "All children closed (#a, #b, …) and wrap-up complete — closing epic. (slashdo)"
```
Never close an `epic-open` epic even if its title reads as done. In
`--interactive` flows, surface the candidate and ask before closing.

## Resolving a child's parent epic (for the post-ship hook)

After a child issue closes, find its parent so the epic can be re-evaluated:

1. **Native:**
   ```bash
   gh api --hostname "$GH_HOST" graphql -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){issue(number:$n){parent{number}}}}' \
     -F o="$OWNER" -F r="$REPO" -F n="$CHILD" --jq '.data.repository.issue.parent.number' 2>/dev/null
   ```
2. **Convention fallback — child back-reference:** parse the just-closed child's
   body (`gh issue view "$CHILD" --json body -q .body`) for `Part of #P` /
   `Parent: #P` / `Epic: #P`.
3. **Convention fallback — parent checklist back-search.** A parent may link the
   child *only* through its own body task-list (`- [ ] #$CHILD`) while the child
   carries no back-reference — the forward resolver above accepts that format, so
   the reverse path must too, or such an epic is never re-checked after its last
   child ships. Search open issue bodies that mention the child, then keep only one
   whose body actually task-lists it:
   ```bash
   for P in $(gh issue list --state open --search "in:body \"#$CHILD\"" --limit 100 --json number -q '.[].number'); do
     [ "$P" = "$CHILD" ] && continue
     gh issue view "$P" --json body -q .body | grep -Eq -- "- \[[ xX]\] #$CHILD\b" && { echo "$P"; break; }
   done
   ```
   (The `in:body "#$CHILD"` search narrows the scan; the `grep` confirms it is a
   real checklist entry, not an incidental mention.)

If a parent epic `#P` is found, run the completeness check on `#P`: close it when
`epic-done`; when `epic-wrapup`, comment that the children are complete and the
wrap-up tasks remain (so a later `/do:next` surfaces it). Leave it untouched when
`epic-open`.
