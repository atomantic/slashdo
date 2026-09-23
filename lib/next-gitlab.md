# GitLab specifics for `/do:next`

GitLab-only behavior for `/do:next`, read once — near the top of Phase 1 issues mode
setup, before the first plain `glab api` call — so every later phase can just point
back here by heading instead of re-explaining `glab`/`jq` quirks inline. **A GitHub
run never reads this file.** The Phase 6 merge (for GitHub and GitLab) is in
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

## The `glab api` capture rule

`glab api` has no built-in `--jq` flag (only `glab issue`/`glab mr` do), so every plain `glab api` call below pipes to the standalone jq binary in a **separately-checked, two-step capture** — never one `glab api ... | jq ...` pipeline. A pipeline reports only **jq's** exit status, and jq exits 0 on empty input, so a failed `glab api` call piped straight into jq looks like "succeeded, returned nothing." When the parsed value is an identity you're about to act on (a username), **guard it non-empty too**: `jq -e` fails only on `null`/`false`, and an empty string (`{"username":""}`) is truthy to jq, so `jq -er '.field'` alone still exits 0 with no value. The shape every call site below follows:
```bash
RESULT_JSON="$(glab api <endpoint>)" || { <fail-closed handler>; }
VALUE="$(printf '%s' "$RESULT_JSON" | jq -er '.field')" || { <fail-closed handler>; }
[ -n "$VALUE" ] || { <fail-closed handler>; }
```

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

## Phase 1 — issues mode: candidate list

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
