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
- `issue_children <KEY>` — `J="$(jira issue list -p "$JIRA_PROJECT" -q "parent = <KEY>" --paginate 0:100 --raw)" && printf '%s' "$J" | jq -r '.[] | "\(.key)\t\(if .fields.status.statusCategory.key == "done" then "CLOSED" else "OPEN" end)"'`
  under the empty-result rule (no children is `[]`, not a failure): one `KEY<TAB>OPEN|CLOSED`
  row per child in every state, epic children and sub-tasks alike — the status
  *category*, since a status name (`Resolved`, `Shipped`) is per-workflow. GitHub/GitLab:
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

## Serving `/do:next`

`/do:next` reads this file in its Pre-flight when `TRACKER=jira`, runs the Pre-flight
above (`{COMMAND}` = `/do:next`) in place of the tracker gate, and takes every issue
step from this section. The code-host verbs (`open_refs`, `collaborators`, `pr_title`,
`ci_wait_merge`), the worktree, `/do:pr`, and the merge gate are unchanged.

**The key replaces the number.** `ISSUE_NUM` holds the key (`PROJ-123`), so
`SLUG="issue-${ISSUE_NUM}"` and every `next.md` snippet name the branch
`next/issue-PROJ-123` and the worktree `../next-issue-PROJ-123` unchanged. Never a bare
`next/PROJ-123`: the in-flight scan matches only an `issue-<ID>` segment, so it would
not register as a claim.

| `next.md` says | On Jira |
|---|---|
| target `#123` | a key: `PROJ-123`, `#PROJ-123`, or `proj-123`; a bare number is rejected |
| prefix `[issue-<num>]` (commits, PR title, changelog) | `[PROJ-123]` — Jira links development work by key |
| PR body `Closes #<num>` | `Jira: PROJ-123` and **no** `Closes #…` line (on the code host it would close an unrelated `#123`) |
| `in-progress` label | the `issue_start` transition (claim below); nothing to remove at close |
| auto-close on merge | the close step below, only after the merge gate reads back **merged** |
| `Shipped in PR #<PR_NUM>.` | `Shipped in <PR URL>.` — `#<n>` names nothing in Jira |
| discovered work | `issue_create` in `JIRA_PROJECT` with a body file (`Discovered while working PROJ-123. …`); `label_ensure` is a no-op |

### Targets

Validate every target before any claim, then de-duplicate on the printed key:

```bash
KEY="$(printf '%s' "$T" | sed 's/^#//' | tr a-z A-Z)"   # T = one target, after comma expansion
printf '%s\n' "$KEY" | grep -Eq '^[A-Z][A-Z0-9_]+-[1-9][0-9]*$' || {
  echo "\"$T\" is not a Jira issue key — the tracker is Jira, so /do:next claims keys (e.g. $JIRA_PROJECT-123)."; exit 1; }
[ "${KEY%-*}" = "$JIRA_PROJECT" ] || {
  echo "$KEY is not in Jira project $JIRA_PROJECT — /do:next claims only the configured project's issues."; exit 1; }
echo "TARGET=$KEY"
```

### Claim gates

- **`--self`** — auto-pick adds `AND reporter = currentUser()` to the walk's JQL. An
  explicit key passes only when
  `jira issue list -p "$JIRA_PROJECT" -q "key = <KEY> AND reporter = currentUser()" --plain --no-headers --columns key`
  prints a line under the empty-result rule; empty refuses with `next.md`'s `--self`
  message, naming `issue_author`; any other error aborts.
- **`--collaborators`** — Jira reporters are Jira accounts, not code-host logins, so no
  live collaborator set can vouch for them and `--trusted-authors` has nothing to
  widen. When `COLLAB_MODE` is on and `SELF_MODE` is not, abort before listing
  anything — never fall open to any-author: ``/do:next --collaborators cannot be enforced on a Jira tracker (its reporters are not code-host collaborators). Use --self, or --no-collaborators.``

### Queue walk

The Phase 1 step-1 walk: every open issue, oldest first, 100 per page, capped at 500
like `gh` (note the cap). `LABEL_FILTER` must be a Jira label (no whitespace or `"`):

```bash
JQL="statusCategory != Done"
[ -n "$LABEL_FILTER" ] && JQL="$JQL AND labels = \"$LABEL_FILTER\""
[ "$SELF_MODE" = "true" ] && JQL="$JQL AND reporter = currentUser()"
ALL="[]"; FROM=0; JIRA_ERR_FILE="$(mktemp)"
while [ "$FROM" -lt 500 ]; do
  if PAGE="$(jira issue list -p "$JIRA_PROJECT" -q "$JQL" --order-by created --reverse --paginate "$FROM:100" --raw 2>"$JIRA_ERR_FILE")"; then :
  elif grep -q 'No result found' "$JIRA_ERR_FILE"; then PAGE="[]"
  else cat "$JIRA_ERR_FILE"; echo "Could not list $JIRA_PROJECT issues — aborting."; exit 1; fi
  ALL="$(printf '%s\n%s\n' "$ALL" "$PAGE" | jq -cs 'add')" || { echo "Could not parse jira --raw output — aborting."; exit 1; }
  [ "$(printf '%s' "$PAGE" | jq length)" -eq 100 ] || break
  FROM=$((FROM + 100))
done
printf '%s' "$ALL" | jq -c "PRIORITY_SORT | .[] | {key, summary: .fields.summary, type: .fields.issuetype.name, subtasks: (.fields.subtasks | length), labels: .fields.labels, assignee: .fields.assignee.displayName, reporter: .fields.reporter.displayName, created: .fields.created}"
```

`PRIORITY_SORT` takes `<labels>` = `.fields.labels[]` and `<created>` = `.fields.created`;
the dispatch-hint clauses are GitLab's plain-string form over `.fields.labels[]`,
prepended the same way. A candidate is **assigned** when `assignee` is non-null, and
an **epic** when its `type` is `Epic`, it carries `epic`, or `subtasks` is non-zero
(resolve it with `epic-children.md` "Jira"). **Declared dependencies** are body lines
`Depends on PROJ-12` / `Blocked by PROJ-12` (a key where the hosts write `#<N>`), OR'd
with Jira's native "is blocked by" links; an unreadable issue is **UNRESOLVED** — fall
back to the body convention and say so:

```bash
J="$(jira issue view <KEY> --raw)" || { echo "<KEY>: native blocked-by lookup failed — using the body convention only"; false; } && \
printf '%s' "$J" | jq -r '.fields.issuelinks[]? | select(.inwardIssue and (.type.name == "Blocks" or .type.inward == "is blocked by")) | .inwardIssue | select(.fields.status.statusCategory.key != "done") | .key'
```

### Lease helper

Jira has **one** assignee, and assigning replaces it, so the GitHub/GitLab read-back (am
I the only assignee?) cannot see a rival. Identity is JQL, never a display-name
comparison. Define this before every block below that calls it:

```bash
jira_lease() {  # prints yes / no / error: is $ISSUE_NUM assigned to me?
  _err="$(mktemp)"
  if _out="$(jira issue list -p "$JIRA_PROJECT" -q "key = $ISSUE_NUM AND assignee = currentUser()" --plain --no-headers --columns key 2>"$_err")"; then
    if [ -n "$(printf '%s' "$_out" | tr -d '[:space:]')" ]; then echo yes; else echo no; fi
  elif grep -q 'No result found' "$_err"; then echo no
  else sed 's/^/jira: /' "$_err" >&2; echo error; fi
  rm -f "$_err"
}
```

### Claim (Phase 2, in place of its marker block)

Refuse an assigned issue, take the assignee, read it back, transition to
`$JIRA_START_STATUS`, then read it back once more — a rival who assigned in between
replaced this run, and the later read-back sees it. Print `PRE_CLAIM_STATUS` and carry
it for `release_marker`:

```bash
ISSUE_NUM="<KEY>"; SLUG="issue-${ISSUE_NUM}"
retract() { git push origin --delete "next/${SLUG}" 2>/dev/null || true; }
J="$(jira issue view "$ISSUE_NUM" --raw)" && PRE_CLAIM_STATUS="$(printf '%s' "$J" | jq -er '.fields.status.name')" \
  || { echo "Could not read $ISSUE_NUM — aborting."; retract; exit 1; }
HOLDER="$(printf '%s' "$J" | jq -r '.fields.assignee.displayName // ""')"
[ -z "$HOLDER" ] || { echo "$ISSUE_NUM is already assigned to $HOLDER — yielding."; retract; exit 1; }
ME="$(jira me)" && [ -n "$ME" ] && jira issue assign "$ISSUE_NUM" "$ME" \
  || { echo "Could not claim $ISSUE_NUM (missing permission?) — aborting."; retract; exit 1; }
LEASE="$(jira_lease)"
[ "$LEASE" = yes ] || {
  echo "$ISSUE_NUM lease read-back: $LEASE — yielding."
  [ "$LEASE" = error ] && echo "WARN: $ISSUE_NUM may still be assigned to you — clear it by hand if so."
  retract; exit 1; }
if [ "$PRE_CLAIM_STATUS" != "$JIRA_START_STATUS" ]; then
  jira issue move "$ISSUE_NUM" "$JIRA_START_STATUS" || {
    echo "Could not move $ISSUE_NUM to \"$JIRA_START_STATUS\" — releasing the claim."
    [ "$(jira_lease)" = yes ] && { jira issue assign "$ISSUE_NUM" x || echo "WARN: could not unassign $ISSUE_NUM — clear it by hand."; }
    retract; exit 1; }
fi
[ "$(jira_lease)" = yes ] || { echo "$ISSUE_NUM changed hands during the claim — yielding."; retract; exit 1; }
echo "PRE_CLAIM_STATUS=$PRE_CLAIM_STATUS"
```

A failed transition fails the claim rather than leaving a lease with no status: the
workflow names are fixed (Pre-flight), so fix the project's workflow, never substitute
a transition.

### `release_marker`

Best-effort, and only for a lease this run holds — each failure is a warning, never an
exit, so the failure that triggered the release is still the one reported. Move back
to `PRE_CLAIM_STATUS` only while the issue still sits in `$JIRA_START_STATUS` (an
unknown `PRE_CLAIM_STATUS` skips the move), then unassign:

```bash
ISSUE_NUM="<KEY>"; PRE_CLAIM_STATUS="<printed by the claim>"
if [ "$(jira_lease)" = yes ]; then
  J="$(jira issue view "$ISSUE_NUM" --raw)" && NOW="$(printf '%s' "$J" | jq -er '.fields.status.name')" || NOW=""
  case "$PRE_CLAIM_STATUS" in ''|"<"*) ;; *)
    if [ "$NOW" = "$JIRA_START_STATUS" ] && [ "$PRE_CLAIM_STATUS" != "$JIRA_START_STATUS" ]; then
      jira issue move "$ISSUE_NUM" "$PRE_CLAIM_STATUS" || echo "WARN: the workflow would not move $ISSUE_NUM back to \"$PRE_CLAIM_STATUS\" — left in \"$NOW\"."
    fi ;; esac
  jira issue assign "$ISSUE_NUM" x || echo "WARN: could not unassign $ISSUE_NUM — clear it by hand."
else
  echo "note: $ISSUE_NUM is not leased to you — leaving its assignee and status alone."
fi
```

### Close after merge

Run only after the merge gate reads back **merged** — single-issue Phase 7's closure
step, and swarm Phase C step 4. `--no-merge`, `dirty`/`inconclusive`, queued, and
left-open all skip it, leaving the issue in `$JIRA_START_STATUS` with its assignee. A
Jira automation may already have closed it; a failed transition is an error to report,
never a silent success:

```bash
ISSUE_NUM="<KEY>"; PR_URL="<merged PR/MR URL>"
J="$(jira issue view "$ISSUE_NUM" --raw)" && CATEGORY="$(printf '%s' "$J" | jq -er '.fields.status.statusCategory.key')" || {
  echo "ERROR: $PR_URL merged, but $ISSUE_NUM could not be read — move it to \"$JIRA_DONE_STATUS\" by hand."; exit 1; }
if [ "$CATEGORY" = done ]; then echo "note: $ISSUE_NUM is already done"
else
  jira issue move "$ISSUE_NUM" "$JIRA_DONE_STATUS" --comment "Shipped in $PR_URL." || {
    echo "ERROR: $PR_URL merged, but $ISSUE_NUM could not move to \"$JIRA_DONE_STATUS\" — transition it by hand."; exit 1; }
fi
```

Then re-evaluate its parent with `epic-children.md` "Jira", as Phase 7 does.
