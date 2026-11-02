# Epic Children & Lifecycle

Shared logic for resolving an **epic** (umbrella issue) to its child issues,
deciding when the epic is complete, and closing it. Consumed by `/do:next`
(claim/skip an epic, close a parent after its last child ships),
`/do:replan` (triage an epic by its children, not by code evidence), and any
command that files a child under an epic.

**GitHub or GitLab.** Reuse `$CLI_TOOL` (`gh`/`glab`) if the calling command
already detected it in its own discovery phase. GitHub exposes a native,
project-scoped **sub-issues** API that resolves an epic's children directly.
GitLab has no project-scoped equivalent — its closest analog, group-level
Epics, is a different, tier-gated feature with different scope (an epic there
belongs to a *group*, not the project an issue lives in), so this file doesn't
attempt to map it. The **convention links** below (body task-lists +
back-references) are therefore GitLab's only path and GitHub's complement to
native links — and they're host-agnostic by construction, so every command in
them is given both a `gh` and a `glab` form. A Jira tracker skips all of that and uses
the last section, **Jira**.

On GitHub, set `OWNER`/`REPO` once per run:
`OWNER_REPO="$(gh repo view --json owner,name -q '.owner.login + "/" + .name')"`
then `OWNER="${OWNER_REPO%/*}"; REPO="${OWNER_REPO#*/}"`.
Also set `GH_HOST` once — `gh api` (used below) defaults to github.com and does **not**
read the repo remote, so on a GitHub Enterprise repo it must be told the host
explicitly. Derive it with the canonical chain in `~/.claude/lib/gh-host.md`, or reuse
the value the including command already derived from that same snippet.
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

## Resolving the children of epic #N — native and convention, unioned

An epic's children can be linked two ways: GitHub's native sub-issues, and the
text convention (an epic-body task-list plus `Part of #N` back-references). A
single epic often mixes them — a human links one child in the GitHub UI while an
agent files the rest with `Part of #N`, or an older epic predates native links —
so **resolve both and union them**. Trusting whichever source answers first
would hide the other set, and the epic would look `epic-done` when its last
*visible* child closed.

1. **Native sub-issues (GitHub only).** Distinguish "no native links" from "the
   lookup failed":
   ```bash
   ERR="$(mktemp)"
   if NATIVE="$(gh api --hostname "$GH_HOST" "repos/$OWNER/$REPO/issues/$N/sub_issues" --paginate \
       --jq '.[] | "\(.number)\t\(.state)"' 2>"$ERR")"; then :
   elif grep -Eq 'HTTP (404|410)' "$ERR"; then NATIVE=""
   else NATIVE="__UNRESOLVED__"; fi
   rm -f "$ERR"
   ```
   GraphQL equivalent when REST is unavailable:
   ```bash
   gh api --hostname "$GH_HOST" graphql -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){issue(number:$n){subIssues(first:100){nodes{number state} pageInfo{hasNextPage}}}}}' \
     -F o="$OWNER" -F r="$REPO" -F n="$N" --jq '.data.repository.issue.subIssues | if (.nodes|type) != "array" or (.pageInfo.hasNextPage|type) != "boolean" then error("incomplete sub-issue response") elif .pageInfo.hasNextPage then "__INCOMPLETE_PAGINATION__" else (.nodes[] | "\(.number)\t\(.state|ascii_downcase)") end' 2>/dev/null
   ```
   The rows are the **native set**. A valid empty result / `404` / `410`
   (feature not enabled, older GHES, or no sub-issues) is an empty native set,
   **not** "zero children" — the convention scan still runs. If the lookup
   fails any other way, the GraphQL query prints `__INCOMPLETE_PAGINATION__`
   (it requests only 100 children), or the response is malformed, mark child
   resolution **unresolved** and do not close the epic on the convention set
   alone: a natively-linked child may be missing from it. **On GitLab
   (`$CLI_TOOL = glab`), skip this step entirely** — there is no
   project-scoped equivalent to probe.

2. **Convention links** (GitHub and GitLab, always):
   - **Body task-list issue refs.** Read the epic body:
     - GitHub: `gh issue view "$N" --json body -q .body`
     - GitLab: `glab issue view "$N" --output json --jq .description`
     collect every `- [ ] #M` / `- [x] #M` line — each `#M` is a child (record whether the box is checked).
   - **Back-references.** Issues that name this epic as parent:
     - GitHub: `gh issue list --state all --search "in:body \"Part of #$N\"" --limit 200 --json number,state`
     - GitLab: `glab issue list --all --search "Part of #$N" --in description --output json --per-page 100 --jq '.[] | {number: .iid, state: .state}'`
       (`--all` includes closed issues, matching `--state all`; `--in description` scopes the search the way GitHub's `in:body` does — GitLab's default `--in` also matches the title, which is broader than needed here.)
     Also accept `Parent: #$N` and `Epic: #$N`. Exclude `#N` itself.
   - **Union** the task-list refs, the back-references, and the native set, dedupe
     by number (a child in several sets is one child); fetch state for any unknown:
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
| `epic-empty` | no children resolved by any method | Not really an umbrella — treat as an ordinary issue. |

## Filing a child of epic #N

Any command (or caller) that files a new issue as a child of epic `#N` writes
**both** link forms, so every resolver above — native, convention, GitHub,
GitLab — finds it:

1. **Convention (always).** End the child's body with `Part of #N` — **never**
   `Closes #N`, which would close the whole epic when the first child merges —
   and add `- [ ] #M — <title>` for it to the epic's own body checklist.
2. **Native sub-issue (GitHub only, best effort).** Capture `M` from the URL
   `gh issue create` prints, then link it. The API takes the child's REST `id`,
   not its number:
   ```bash
   CHILD_ID="$(gh api --hostname "$GH_HOST" "repos/$OWNER/$REPO/issues/$M" --jq .id)" &&
     gh api --hostname "$GH_HOST" -X POST "repos/$OWNER/$REPO/issues/$N/sub_issues" \
       -F sub_issue_id="$CHILD_ID" >/dev/null
   ```
   A failure (`404`/`410` where sub-issues are unavailable, `422` when the child
   already has a parent or the epic is at GitHub's sub-issue limit) is reported
   in the run summary and does not undo the filing — the convention links from
   step 1 still resolve the child. Never pass `replace_parent`: it would silently
   move a child out of another epic. Skip this step on GitLab and Jira (Jira
   links children with `parent`; see **Jira**).

## Closing an epic

Close **only** in the `epic-done` state. By the parent/child convention children
carry `Part of #N` (**not** `Closes #N`), so merging a child never auto-closes
the epic — it must be closed explicitly:
- GitHub: `gh issue close "$N" --comment "All children closed (#a, #b, …) and wrap-up complete — closing epic. (slashdo)"`
- GitLab: `glab issue close` has no `--comment` flag, so post the note first, then close:
  `glab issue note "$N" -m "All children closed (#a, #b, …) and wrap-up complete — closing epic. (slashdo)" && glab issue close "$N"`

Never close an `epic-open` epic even if its title reads as done. When the
caller supports interactive mode (e.g., `/do:replan --interactive`), surface
the candidate and ask before closing.

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

## Jira

When the caller ran [tracker-jira.md](./tracker-jira.md)'s Pre-flight (`TRACKER=jira`),
none of the `gh`/`glab` calls above apply: Jira links children natively with
`parent`, for epics and sub-tasks alike, so that link is the only source — the body
task-list and back-reference scans are skipped (`issue_body` renders rich text as
plain text, which is lossy). Keys stand in for `#N` throughout.

- **Epic?** Its `issuetype.name` is `Epic`, it carries the `epic` label, or its
  `subtasks` array is non-empty (all in `jira issue view <KEY> --raw`).
- **Children** — `issue_children <KEY>` rows are already `OPEN`/`CLOSED` by status
  category; the states above apply unchanged, and no rows is `epic-empty`.
- **Wrap-up tasks** — unchecked `- [ ]` lines in `issue_body <KEY>` that name no key;
  none is an empty `WRAPUP_TASKS`.
- **Closing** — `issue_close_note <KEY> "All children closed (PROJ-a, PROJ-b, …) and wrap-up complete — closing epic. (slashdo)"`;
  a failed transition leaves the epic open and is reported, never retried under
  another status name.
- **A child's parent** — `J="$(jira issue view <CHILD> --raw)" && printf '%s' "$J" | jq -r '.fields.parent.key // empty'`;
  empty means no parent. An `epic-wrapup` parent gets `issue_comment` as above.
