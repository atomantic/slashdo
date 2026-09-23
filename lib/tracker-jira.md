# Jira tracker backend

Read only when `vcs-host.md` resolved `TRACKER=jira` (saved
`/do:config --tracker jira`), and only by a command that **serves** Jira. That
partial leaves `TRACKER_CLI` empty for Jira, so a command that never reads this
file treats a Jira tracker as no tracker — it never falls through to `CLI_TOOL`
issue calls on the code host. The code host is unaffected: PRs/MRs still go through
`CLI_TOOL`. Operations run through the
[jira CLI](https://github.com/ankitpokhrel/jira-cli) (`jira`). A host with a Jira MCP
connector and no `jira` CLI may run the same verbs through the connector instead,
with the same semantics, after confirming it can read `JIRA_PROJECT`.

## Pre-flight

Run before any tracker read or write, in place of the tracker gate
(`{COMMAND}` = invoking command). It is the only place `TRACKER_CLI` becomes
`jira`. Every abort is non-mutating: it reads the saved `jira-project`, the CLI
config, and one page of the project.

```bash
JIRA_PROJECT="$(for _f in ~/.claude/.slashdo-config.json "$(git rev-parse --show-toplevel 2>/dev/null)/.slashdo.json"; do [ -f "$_f" ] && { tr -d '\n' < "$_f"; echo; } | sed -n 's/.*"jira-project"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p'; done | tail -1 | tr a-z A-Z)"
JIRA_ISSUE_TYPE="Task"; JIRA_START_STATUS="In Progress"; JIRA_DONE_STATUS="Done"
[ -n "$JIRA_PROJECT" ] || {
  echo "{COMMAND}: the tracker is jira but no Jira project is set. Run: /do:config --project --jira-project <KEY>"; exit 1; }
printf '%s\n' "$JIRA_PROJECT" | grep -Eq '^[A-Z][A-Z0-9_]+$' || {
  echo "{COMMAND}: jira-project '$JIRA_PROJECT' is not a Jira project key (e.g. PROJ). Run: /do:config --project --jira-project <KEY>"; exit 1; }
command -v jira >/dev/null 2>&1 || {
  echo "{COMMAND}: the tracker is jira but the jira CLI is not installed. Install ankitpokhrel/jira-cli, then run: jira init"; exit 1; }
command -v jq >/dev/null 2>&1 || {
  echo "{COMMAND}: the Jira backend needs jq to read jira --raw output. Install jq."; exit 1; }
JIRA_ME="$(jira me 2>/dev/null)"; [ -n "$JIRA_ME" ] || {
  echo "{COMMAND}: the jira CLI is not configured. Run: jira init (with JIRA_API_TOKEN exported)"; exit 1; }
JIRA_ERR="$(jira issue list -p "$JIRA_PROJECT" --paginate 0:1 --plain --no-headers --columns key 2>&1 >/dev/null)" \
  || case "$JIRA_ERR" in *"No result found"*) ;; *)
  echo "{COMMAND}: jira cannot read project $JIRA_PROJECT (not authenticated, or no such project): $(printf '%s' "$JIRA_ERR" | head -1)"; exit 1 ;; esac
TRACKER_CLI=jira; LABEL_SEP=":"
```

`jira me` only proves `jira init` ran (it prints the configured login without an API
call); the one-page project read proves the token works and the project exists. Print
`Tracker: jira (project {JIRA_PROJECT}, as {JIRA_ME})`, and carry `TRACKER_CLI`,
`LABEL_SEP`, `JIRA_PROJECT`, `JIRA_ME`, and the three workflow names through later
phases — shell variables do not survive between tool calls, so re-run this block (it
only reads) wherever a later step needs them.

The workflow names above are the jira-cli defaults. A project whose workflow names
them differently fails the transition verb loudly; never skip or substitute a
transition.

## Keys, fields, and labels

**The issue key is the ID** (`PROJ-123`), wherever GitHub/GitLab use `#<number>`. Never
strip the project prefix; `#123` does not name a Jira issue.

| GitHub | GitLab | Jira (`--raw` JSON) |
|---|---|---|
| `number` | `iid` | `.key` |
| `title` | `title` | `.fields.summary` |
| `.labels[].name` | `.labels[]` | `.fields.labels[]` (plain strings) |
| `.author.login` | `.author.username` | `.fields.reporter.displayName` |
| `.assignees[].login` | `.assignees[].username` | `.fields.assignee.displayName` (one assignee, or `null`) |
| `createdAt` | `created_at` | `.fields.created` |
| `body` | `description` | read with `jira issue view <KEY> --plain` (Cloud stores rich text, not markdown) |
| `OPEN` / `CLOSED` | `opened` / `closed` | `.fields.status.statusCategory.key` ≠ / = `done` |

**Identity checks use JQL, never display-name comparisons** (Jira Cloud may hide
emails): "filed by me" is `reporter = currentUser()`, "assigned to me" is
`assignee = currentUser()`.

**Labels.** Jira creates a label on first use and labels have no color, so
`PLAN_LABEL`, category, `severity:<level>`, and the `model:`/`effort:` dispatch hints
(`plan-issue-setup.md`) are applied as plain labels, with
`LABEL_SEP` = `:`. A Jira label cannot contain whitespace: abort filing with
`Jira labels cannot contain spaces (got: <label>)` rather than rewriting one.

## The empty-result rule

`jira issue list` **exits 1 when nothing matches**, printing `No result found` on
stderr. Capture stderr separately and treat only that message as an empty result;
any other non-zero exit is a failure:

```bash
JIRA_ERR_FILE="$(mktemp)"
if OUT="$(jira issue list -p "$JIRA_PROJECT" -q "<JQL>" <flags> 2>"$JIRA_ERR_FILE")"; then :
elif grep -q 'No result found' "$JIRA_ERR_FILE"; then OUT=""
else cat "$JIRA_ERR_FILE"; <fail-closed handler>; fi
```

Every `jira issue list` verb below follows it (an empty `--raw` result is `[]`). Parse
`--raw` output in a separate step from the call, as `glab api` output is parsed:
`J="$(jira issue view <KEY> --raw)" || <fail>`, then `printf '%s' "$J" | jq …`.

## Tracker verbs — Jira forms

The host-neutral verbs `/do:next` names in its Conventions (GitHub forms there, GitLab
forms in `next-gitlab.md`), plus the tracker operations other
commands still inline per host. Keep the same arguments, output, and failure
behavior; a failed verb is a failure, never a no-op. Every call carries
`-p "$JIRA_PROJECT"` where the subcommand takes it, and `--no-input` on writes that
would otherwise prompt.

- `issue_list <JQL>` — `jira issue list -p "$JIRA_PROJECT" -q "<JQL>" --order-by created --reverse --paginate <from>:100 --raw`
  (oldest first; 100 per page, page with `<from>` = 0, 100, …). Open issues are
  `statusCategory != Done`; narrow with `AND labels = "<label>"`,
  `AND reporter = currentUser()`, `AND parent = <KEY>`. GitHub/GitLab: the
  `gh issue list` / `glab issue list` calls each command already inlines.
- `issue_search <keywords>` — `jira issue list -p "$JIRA_PROJECT" -q 'statusCategory != Done AND text ~ "<keywords>"' --plain --no-headers --columns key,summary`
  (dedup before filing). GitHub/GitLab: `gh issue list --search` / `glab issue list --search`.
- `issue_children <KEY>` — `jira issue list -p "$JIRA_PROJECT" -q "parent = <KEY>" --plain --no-headers --columns key,status`
  (every state; epic children and sub-tasks alike). GitHub/GitLab:
  `epic-children.md`.
- `issue_body <KEY>` — `jira issue view <KEY> --plain --comments 0`
- `issue_body --comments <KEY>` — `jira issue view <KEY> --plain --comments 50`
- `issue_body --set <KEY> <text>` — `jira issue edit <KEY> -b <text> --no-input`
- `issue_state <KEY>` — `J="$(jira issue view <KEY> --raw)" && printf '%s' "$J" | jq -er 'if .fields.status.statusCategory.key == "done" then "CLOSED" else "OPEN" end'`
- `issue_author <KEY>` — `J="$(jira issue view <KEY> --raw)" && printf '%s' "$J" | jq -er '.fields.reporter.displayName'`
- `issue_assignees <KEY>` — `J="$(jira issue view <KEY> --raw)" && printf '%s' "$J" | jq -r '.fields.assignee.displayName // ""'`
- `issue_labels <KEY>` — `J="$(jira issue view <KEY> --raw)" && printf '%s' "$J" | jq -c '.fields.labels'`
- `issue_is_mine <KEY>` — `jira issue list -p "$JIRA_PROJECT" -q "key = <KEY> AND assignee = currentUser()" --plain --no-headers --columns key`
  under the empty-result rule: a line = `yes`, empty = `no`. The lease read-back.
- `issue_comment <KEY> <text>` — `jira issue comment add <KEY> <text> --no-input`
  (a multi-line body: `--template <body-file>` in place of `<text>`)
- `issue_start <KEY>` — `jira issue move <KEY> "$JIRA_START_STATUS"` (the claim's
  in-progress marker; GitHub/GitLab: `label_add <N> in-progress`).
- `issue_close_note <KEY> <text>` — `jira issue move <KEY> "$JIRA_DONE_STATUS" --comment <text>`
  (a `Closes #<num>` trailer does nothing on Jira; the close is this transition).
- `assign_me <KEY>` — `ME="$(jira me)" && [ -n "$ME" ] && jira issue assign <KEY> "$ME"`.
  Jira has **one** assignee, so assigning replaces any other: check `issue_assignees`
  is empty first, and read the lease back with `issue_is_mine`.
- `unassign_me <KEY>` — only when `issue_is_mine <KEY>` says `yes`: `jira issue assign <KEY> x`.
  Never clear another user's assignment.
- `label_ensure <label> <color> <description>` — no-op (`true`): Jira labels need no creation.
- `label_add <KEY> <label>` — `jira issue edit <KEY> -l <label> --no-input`
- `label_rm <KEY> <label>` — `jira issue edit <KEY> -l "-<label>" --no-input`
- `issue_create <title> <body-file> <label>...` — capture the key from `--raw`, never
  from the success banner:
  ```bash
  J="$(jira issue create -p "$JIRA_PROJECT" -t "$JIRA_ISSUE_TYPE" -s <title> --template <body-file> -l <label> --no-input --raw)" \
    && KEY="$(printf '%s' "$J" | jq -er .key)" && [ -n "$KEY" ]
  ```
  One `-l` per label. Add `-P <parent-KEY>` to file an epic child or sub-task.
