# GitLab specifics for `/do:next`

GitLab-only behavior for `/do:next`, read once — near the top of Phase 1 issues mode
setup, before the first plain `glab api` call — so every later phase can just point
back here by heading instead of re-explaining `glab`/`jq` quirks inline. **A GitHub
run never reads this file.** If a run reaches Phase 6 without having read it yet (a
PLAN.md-mode GitLab run never enters issues mode), `next.md` reads it again there —
this is the same file, so nothing here is missed.

Field names and shapes differ from GitHub's REST/GraphQL payloads, not just the
binary — every jq expression in `next.md` and this file is built from this mapping:

| GitHub | GitLab | Notes |
|---|---|---|
| `number` | `iid` | issue/PR vs MR identifier |
| `.labels[].name` | `.labels[]` | `glab issue list --output json` returns labels as a flat string array, not `{name: "..."}` objects |
| `login` / `.author.login` | `username` / `.author.username` | |
| `createdAt` | `created_at` | |
| `body` | `description` | |
| `OPEN` / `CLOSED` | `opened` / `closed` | issue/MR state strings |

## Phase 1 — issues mode: jq probe

`glab api` — unlike the `glab issue`/`glab mr` subcommands — has no built-in `--jq`
flag, so this phase and Phase 2 pipe it to the **standalone** jq binary instead.
Probe **here** (once you're in issues mode), not in the shared Pre-flight: PLAN.md
mode never calls plain `glab api`, so probing in the shared Pre-flight would abort a
GitLab + PLAN.md repo that has always worked without jq.

```bash
command -v jq >/dev/null 2>&1 || {
  echo "/do:next's GitLab issue mode pipes 'glab api' output through jq, which is not installed. Install it (e.g. 'brew install jq' or 'apt-get install jq') and re-run."; exit 1; }
```

## Phase 1 — issues mode: collaborator fetch

The `--collaborators` gate's live member fetch stays inline in `next.md`'s
"Collaborator set" step (its `if [ "$CLI_TOOL" = gh ]; then … else … fi` sets
`COLLAB_LOGINS` inside a shared `$OWNER_REPO`/`TRUSTED_CLAIM_POOL` wrapper both
hosts need, so splitting the branch out would duplicate that wrapper). The GitLab
branch (`MEMBERS_JSON="$(glab api --paginate "projects/:id/members/all")"`, then
`COLLAB_LOGINS="$(printf '%s' "$MEMBERS_JSON" | jq -r '.[] | select(.access_level
>= 30) | .username')"`) is a **two-step capture** — never pipeline-fail-open. A
failed `glab api` piped straight to jq would report jq's status, and jq exits 0 on
empty input, which would look like "no collaborators" instead of "could not list
them." GitLab collaborators are project members who can push (`access_level >= 30`
Developer, including inherited members via `members/all`).

## Phase 1 — issues mode: candidate list

`glab issue list` in place of `gh issue list` for the priority/oldest walk — same
sort key, different field names/shapes (see the mapping table above):

```bash
LIST_ARGS=(--output json)
[ -n "$LABEL_FILTER" ] && LIST_ARGS+=(--label "$LABEL_FILTER")
# glab's --author takes a username. Unlike `gh`, it does not resolve the
# GitHub-CLI token `@me` — pass the authenticated login so --self actually
# filters (the explicit-#num path in next.md already compares against this same
# `glab api user` value).
# Resolve the login in TWO steps, never one `glab api user | jq -r .username`
# pipeline: the pipeline's exit status is jq's, and `jq -r .username` exits 0 on
# empty input, so a failed `glab api user` would leave ME empty. Then GUARD ON
# NON-EMPTY separately: `jq -e` only fails on `null`/`false`, and an empty-string
# username ({"username":""}) is truthy to jq, so it exits 0 with no login. Either
# way an empty ME means `--author ""`, which glab reads as NO author filter — the
# --self security gate would silently enumerate and claim other people's issues.
# All three checks must pass before the filter is added.
if [ "$SELF_MODE" = "true" ]; then
  ME_JSON="$(glab api user)" || {
    echo "Could not read the authenticated GitLab user — --self cannot be enforced. Aborting."; exit 1; }
  ME="$(printf '%s' "$ME_JSON" | jq -er .username)" || {
    echo "Could not read the authenticated GitLab user — --self cannot be enforced. Aborting."; exit 1; }
  [ -n "$ME" ] || {
    echo "GitLab returned an empty username — --self cannot be enforced. Aborting."; exit 1; }
  LIST_ARGS+=(--author "$ME")
fi
# Project away `description` (GitLab's body) — next.md's steps 3–4 fetch it per candidate.
glab issue list "${LIST_ARGS[@]}" --per-page 100 \
  --jq "sort_by([ (([.labels[] | select(test(\"^priority${LABEL_SEP}[0-9]+\$\")) | ltrimstr(\"priority${LABEL_SEP}\") | tonumber] | min) // infinite), .created_at ]) | .[] | {iid,title,labels,assignees,author,created_at}"
```

GitLab's `--per-page` maxes out at 100 with no "give me everything" pagination for a
plain open-issue list — same "note the cap" guidance `next.md` gives `gh issue list`,
at a lower threshold; `--issues-label` keeps a busy GitLab tracker under it.

**Dispatch-hint filter worked example** (`--model light,none --effort max`,
`$LABEL_SEP` is `::`) — the GitLab twin of `next.md`'s GitHub worked example, same two
clauses without `.name`:

```bash
glab issue list "${LIST_ARGS[@]}" --output json --per-page 100 \
  --jq "map(select(any(.labels[]; . == \"model${LABEL_SEP}light\")
                or ([.labels[] | select(startswith(\"model${LABEL_SEP}\"))] | length == 0)))
      | map(select(any(.labels[]; . == \"effort${LABEL_SEP}max\")))
      | sort_by([ (([.labels[] | select(test(\"^priority${LABEL_SEP}[0-9]+\$\")) | ltrimstr(\"priority${LABEL_SEP}\") | tonumber] | min) // infinite), .created_at ]) | .[] | {iid,title,labels,assignees,author,created_at}"
```

## Phase 2 — claim

The GitLab branches of `next.md`'s "mark the issue in progress" step stay inline
there (its `if [ "$CLI_TOOL" = gh ]; then … else … fi` blocks are one continuous
script with a shared fail-closed `|| { … }` wrapper and exclusivity re-read, so
splitting the GitLab half out would either duplicate that wrapper or leave an
`else` branch with no command to fail) — this section is the "why", not a second
copy of the "what":

- **The claim marker** (capture the authenticated user, resolve its username, guard
  it non-empty, then `glab issue update "$ISSUE_NUM" --assignee "+$ME"`) resolves
  the login in **two separately-checked steps**, never one `glab api user | jq -r
  .username` pipeline: a pipeline's exit status is jq's, and a bare `jq -r` exits 0
  on empty input, so a failed capture would leave `ME` empty and `--assignee "+"`
  would claim nothing while still looking like a successful claim. The non-empty
  guard is not redundant with `jq`'s own `-e` flag: `-e` only fails on
  `null`/`false`, and an empty-string username is truthy to jq. The `+` prefix
  **adds** one assignee without touching whatever's already there — a bare
  `--assignee "$ME"` would **replace** the whole list and defeat the read-back that
  follows.
- **The yield/release path** uses the `-` prefix (`--assignee "-$ME"`) for the same
  reason in reverse: it removes exactly your one assignee without touching a
  sibling's.
- **The read-back** (`glab issue view "$ISSUE_NUM" --output json --jq
  '[.assignees[].username] | join(",")'`) is why the assignee marker is close to,
  but not, a compare-and-swap — both hosts allow multiple assignees.

## Phase 6 — merge

```bash
git push && glab ci status --wait && glab mr merge <num> --yes --remove-source-branch
```

**Why `glab ci status --wait` and not `--auto-merge`:** `--auto-merge` sets
merge-when-pipeline-succeeds server-side and returns while the MR is still
`opened`, so Phase 7's state read-back would never see `merged` and the worktree,
claim branch, issue, and `in-progress` label would be stranded on every run. Waiting
first makes one read authoritative. `glab mr merge` takes no method flag (unlike
`gh pr merge`) — it uses the project's default merge method, so `next.md`'s "Resolve
the merge method" step is GitHub-only.
