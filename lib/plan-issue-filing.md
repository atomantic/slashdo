# Tracker Issue Filing

How commands file deferred/discovered work as tracker issues. **Requires
[plan-issue-setup.md](./plan-issue-setup.md)** (`CLI_TOOL`, `LABEL_SEP`, `PLAN_LABEL`);
with no tracker, file nothing.

## Fetch existing open issues

Record `EXISTING_ISSUES` up front for dedup — **all** open issues, so duplicates
under another label are caught:
`gh issue list --state open --limit 500 --json number,title,labels,body`
(glab: `glab issue list --state opened --per-page 100 -F json`). A command that files
only a handful of items and never otherwise needs the backlog may instead dedup each
candidate with `gh`/`glab issue list --search "<keywords>"` (e.g. `/do:plan-task`).

## Recording every finding under `--scan-only`

Items are filed when a command **defers** them. A `--scan-only` run acts on nothing,
so **every surviving finding is deferred and must be filed** under the rules below;
those issues are the run's entire output (no worktree, code changes, or PRs), and the
summary reports the created and reused `#<number>`s.

## Recording a plan item

**First dedup against `EXISTING_ISSUES`**, matching on file path / symbol or an
equivalent title, not an exact string. A match **skips creation** and reuses that
`#<number>` (optionally commenting new detail). Otherwise create one with a
self-contained, claimable title and a body with enough context (file paths, category,
why it was deferred) to pick up cold. **The issue number is the ID.** Report created
**and** reused numbers, noting which were skipped as duplicates.

**Capture `NUM` from the printed URL**; issue create has no `--json`/`-q`. Keep
generated text out of shell source: set `TITLE` with a unique, single-quoted
heredoc delimiter; `BODY` is the body-file path.

```bash
TITLE="$(cat <<'SLASHDO_TITLE_EOF'
<Title>
SLASHDO_TITLE_EOF
)"
if [ "$CLI_TOOL" = gh ]; then URL="$(gh issue create --title "$TITLE" --body-file "$BODY" <label flags>)"
else URL="$(glab issue create --title "$TITLE" --description "$(cat "$BODY")" <label flags>)"; fi
NUM="${URL##*/}"
```

## Labels, not title brackets

The title is a clean, human-readable task: no `[category]` / `[SEVERITY]` brackets,
and never with an id or slug (❌ `[dry][LOW] …`, ❌ `[security-01] …`). The issue
number is the ID; metadata goes in labels, each passed as a repeated `--label <name>`:

- **Scope:** always `PLAN_LABEL`.
- **Category** (audit findings always carry one): the lowercased category slug, e.g.
  `security`, `dry`, `bugs-perf`, `cognitive-load`.
- **Severity** (when present): `severity${LABEL_SEP}<critical|high|medium|low>`.
- **Dispatch hint** (optional): per [plan-issue-setup.md](./plan-issue-setup.md) "The dispatch hint".

Create each label immediately before applying it, with that file's idempotent
"Label creation" commands and colors. A reused issue keeps its labels unless the new
finding genuinely changes its category or severity.

## Bulk filing — spool the bodies, dedup on an index

**Only when a run expects to file more than ~20 issues at once**; below that, file
inline. At that scale the orchestrator must not hold and re-emit bodies (it truncates,
paraphrases, and drops findings), so each finding splits into an index **key** and an
on-disk **body**.

### 1. Producing agents spool bodies to disk

Before dispatch:

```bash
SPOOL_DIR="$(mktemp -d "${TMPDIR:-/tmp}/slashdo-issues-XXXXXX")"; echo "$SPOOL_DIR"
```

**Record the printed path in run state** and pass that literal path to every agent; a
shell variable does not survive between tool calls. Each finding goes to
`$SPOOL_DIR/<category>.md` for **that finding's own category** — one file per
category, owned by one agent. Append after the first write (`cat >` once, `cat >>` thereafter);
a second `cat >` truncates. Each block must go straight to `--body-file` without
rewriting a word. No line inside a body may
begin with `<!-- finding ` at column 0 (indent quoted ones by a space):

```markdown
<!-- finding 1 -->
title: <a self-contained, claimable task in plain language>
severity: high
category: security
labels: model${LABEL_SEP}light, effort${LABEL_SEP}medium
files: src/routes/pr.js:142

<what is wrong, quoted evidence, why it matters, the fix, context to pick it up cold>
```

The marker number is a counter unique within its file; with the index line's category
it is the finding's **id**. **Never
invent a slug, a `[category-NN]` tag, or any other bracketed id.** The id never reaches the tracker:
the title is exactly the `title:` value and the body is everything below that line.

### 2. Agents return an index, not bodies

One line per finding and nothing else (empty, with no file, when nothing is found):

```
<N> | <SEVERITY-or-UNCERTAIN> | <category> | <file:line> | <one-line title>
```

Keep `UNCERTAIN` in index and body; never coerce it into a severity. An unresolved
uncertain finding stays an unconfirmed follow-up: no confirmed severity label and no
automatic remediation.

### 3. The orchestrator consolidates on the index

Dedup across agents (the same `file:line` collapses to one, keeping the more specific
title) and against `EXISTING_ISSUES`, then apply the command's severity, ownership, and
ordering rules, leaving surviving ids grouped by category. **The orchestrator never *rewrites* a spooled
body**: it opens blocks only for targeted validation or command-specific evidence, and
both filing paths lift each block verbatim into a `--body-file`.

### 4. Filer agents file, in parallel, one per category

Give each filer its category's surviving ids and spool file, `CLI_TOOL`, `PLAN_LABEL`,
the label rules, and the `${URL##*/}` capture. A **block** runs from a line matching
`^<!-- finding <N> -->$` to the next `^<!-- finding ` (or EOF) — **not a bare `^## `**,
which quoted evidence may contain. The filer takes the `--title` from the block's `title:` line, verbatim,
writes the rest of the block to a `--body-file`, creates missing labels and the issue,
and returns only `<id> -> #<number>` lines. **A filer never rewrites a
body**; a malformed or missing block returns `<id> -> ERROR: <reason>`.

**Rate limits.** Give every filer this rule verbatim: on a `403` mentioning a secondary rate limit, or a `429`, sleep
60s and retry that one issue, up to 3 attempts; then report `ERROR: rate-limited` and
continue. One filer per category is the bound — never shard a single category across agents.

### 5. The orchestrator reports

Merge the maps and report created, reused, and errored counts with numbers. **Any id
that came back `ERROR` was not filed** — list each with the spool path for hand filing. Leave
`SPOOL_DIR` on disk when any error occurred; otherwise remove it only once nothing
downstream still needs the bodies (a remediating run reads them again later), while
a `--scan-only` run may remove it as soon as the report
is printed.
