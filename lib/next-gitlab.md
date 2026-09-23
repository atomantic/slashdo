# GitLab specifics for `/do:next`

GitLab-only behavior for `/do:next`, read once — in the Pre-flight, before the first
plain `glab api` call — so every later phase can just point back here by heading
instead of re-explaining `glab`/`jq` quirks inline. **A GitHub run never reads this
file.** The Phase 6 merge (for GitHub and GitLab) is in
[merge-gate.md](./merge-gate.md).

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

## Host verbs — GitLab forms

The host verbs defined in [next.md](../commands/do/next.md)'s Conventions resolve to these forms. Keep the same arguments, output, and failure behavior; do not replace a failed verb with a successful no-op.

- `open_refs` — `glab mr list --per-page 100 --output json --jq '.[].source_branch'`
- `collaborators` — capture `MEMBERS_JSON="$(glab api --paginate "projects/:id/members/all")"`, then `printf '%s' "$MEMBERS_JSON" | jq -r '.[] | select(.access_level >= 30) | .username'`; a failed API call or parse is fatal.
- `issue_body <N>` — `glab issue view <N> --output json --jq .description`
- `issue_body --comments <N>` — `glab issue view <N> --comments`
- `issue_body --set <N> <text>` — `glab issue update <N> --description <text>`
- `issue_state <N>` — `glab issue view <N> --output json --jq .state`
- `issue_author <N>` — `glab issue view <N> --output json --jq .author.username`
- `issue_assignees <N>` — `glab issue view <N> --output json --jq '[.assignees[].username] | join(",")'`
- `issue_labels <N>` — `glab issue view <N> --output json --jq '.labels'`
- `issue_comment <N> <text>` — `glab issue note <N> -m <text>`
- `issue_close_note <N> <text>` — `glab issue note <N> -m <text> && glab issue close <N>`
- `assign_me <N>` — capture the login separately, guard it non-empty, then add one assignee:
  ```bash
  ME_JSON="$(glab api user)" && ME="$(printf '%s' "$ME_JSON" | jq -er .username)" && [ -n "$ME" ] && glab issue update <N> --assignee "+$ME"
  ```
- `unassign_me <N>` — resolve and guard the login separately, then remove one assignee:
  ```bash
  ME_JSON="$(glab api user)" && ME="$(printf '%s' "$ME_JSON" | jq -er .username)" && [ -n "$ME" ] && glab issue update <N> --assignee "-$ME"
  ```
- `label_ensure <label> <color> <description>` — `glab label create --name <label> --color "#<color>" --description <description> 2>/dev/null || true`
- `label_add <N> <label>` — `glab issue update <N> --label <label>`
- `label_rm <N> <label>` — `glab issue update <N> --unlabel <label>`
- `issue_create <title> <body> <label>...` — `glab issue create --title <title> --description <body> --label <label>...`
- `pr_title <PR> <title>` — `glab mr update <PR> --title <title>`
- `ci_wait_merge <PR> <method>` — `git push "$UP_REMOTE" "HEAD:$UP_REF" && glab ci status --wait --branch "${UP_REF#refs/heads/}" && glab mr merge <PR> --yes --remove-source-branch`

`ci_wait_merge` intentionally keeps `--remove-source-branch` on GitLab: the shared gate owns server-side head cleanup there, and Phase 7's remote delete is an already-gone-safe check.

## The `glab api` capture rule

`glab api` has no built-in `--jq` flag (only `glab issue`/`glab mr` do), so every plain `glab api` call below pipes to the standalone jq binary in a **separately-checked, two-step capture** — never one `glab api ... | jq ...` pipeline. A pipeline reports only **jq's** exit status, and jq exits 0 on empty input, so a failed `glab api` call piped straight into jq looks like "succeeded, returned nothing." When the parsed value is an identity you're about to act on (a username), **guard it non-empty too**: `jq -e` fails only on `null`/`false`, and an empty string (`{"username":""}`) is truthy to jq, so `jq -er '.field'` alone still exits 0 with no value. The shape every call site below follows:
```bash
RESULT_JSON="$(glab api <endpoint>)" || { <fail-closed handler>; }
VALUE="$(printf '%s' "$RESULT_JSON" | jq -er '.field')" || { <fail-closed handler>; }
[ -n "$VALUE" ] || { <fail-closed handler>; }
```

## Pre-flight — jq probe

`glab api` — unlike the `glab issue`/`glab mr` subcommands — has no built-in `--jq`
flag, so Phase 1 and Phase 2 pipe it to the **standalone** jq binary instead. Probe
once, in the Pre-flight, before any claim:

```bash
command -v jq >/dev/null 2>&1 || {
  echo "/do:next on GitLab pipes 'glab api' output through jq, which is not installed. Install it (e.g. 'brew install jq' or 'apt-get install jq') and re-run."; exit 1; }
```

## Phase 1 — native blocked-by lookup

For an issue candidate, capture the GitLab links response before parsing it. A failed lookup is **UNRESOLVED**, not unblocked; the caller then falls back to the body convention and reports the fallback.

```bash
LINKS_JSON="$(glab api "projects/:id/issues/<N>/links")" || {
  echo "#<N>: native blocked-by lookup failed — using the body convention only"; false; }
printf '%s' "$LINKS_JSON" | jq -r '.[] | select(.link_type == "is_blocked_by")'
```

## Phase 1 — candidate list

`glab issue list` in place of `gh issue list` for the priority/oldest walk — same
sort key (`PRIORITY_SORT`, Conventions, in its GitLab form), different field
names/shapes (see the mapping table above):

```bash
LIST_ARGS=(--output json)
[ -n "$LABEL_FILTER" ] && LIST_ARGS+=(--label "$LABEL_FILTER")
# glab's --author takes a username. Unlike `gh`, it does not resolve the
# GitHub-CLI token `@me` — pass the authenticated login so --self actually
# filters (the explicit-#num path in next.md already compares against this same
# `glab api user` value). Two-step capture per the glab api capture rule above:
# an unguarded pipeline here would silently drop the --self filter (empty ME
# means `--author ""`, which glab reads as no filter at all, and the security
# gate would enumerate and claim other people's issues).
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
  --jq "PRIORITY_SORT | .[] | {iid,title,labels,assignees,author,created_at}"
```

GitLab's `--per-page` maxes out at 100 with no "give me everything" pagination for a
plain open-issue list — same "note the cap" guidance `next.md` gives `gh issue list`,
at a lower threshold; `--issues-label` keeps a busy GitLab tracker under it.

**Dispatch-hint filter worked example** (`--model light,none --effort max`,
`$LABEL_SEP` is `::`) — the GitLab twin of `next.md`'s GitHub worked example, same two
clauses without `.name`:

```bash
glab issue list "${LIST_ARGS[@]}" --per-page 100 \
  --jq "map(select(any(.labels[]; . == \"model${LABEL_SEP}light\")
                or ([.labels[] | select(startswith(\"model${LABEL_SEP}\"))] | length == 0)))
      | map(select(any(.labels[]; . == \"effort${LABEL_SEP}max\")))
      | PRIORITY_SORT | .[] | {iid,title,labels,assignees,author,created_at}"
```
`PRIORITY_SORT` (Conventions, in next.md) with the two filter clauses above prepended.
