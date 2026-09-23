# Tracker Issue Filing

Filing rules for a command that records deferred or discovered work as tracker
issues: fetching existing issues to dedup against, the `--scan-only` recording rule,
the create/dedup mechanics, labels, and the bulk spool path for audits that surface
many findings at once. **Assumes [plan-issue-setup.md](./plan-issue-setup.md) already
ran** — `CLI_TOOL`, `LABEL_SEP`, and the caller's `PLAN_LABEL` resolution are in
place; read that file first if it hasn't. If setup found no tracker, file nothing and
list the deferrals in the report as that file's "No tracker" rule says.

## Fetch existing open issues

The tracker is the source of truth for already-known work, so pull the open issues up front and keep them in context for dedup:
`gh issue list --state open --limit 500 --json number,title,labels,body --jq '.'`
(glab: `glab issue list --state opened --per-page 100 -F json`). Record this as
`EXISTING_ISSUES`. Listing **all** open issues (not just `--label <PLAN_LABEL>`)
avoids re-filing a finding someone already opened by hand under a different label.

*A command that files at most a handful of items and never otherwise needs the open-
issue backlog may skip this dump and dedup with a targeted `gh issue list --search
"<keywords>"` / `glab issue list --search "<keywords>"` per candidate instead —
`/do:next` filing a single discovered-work issue is the example; see its own Phase 4
for that tradeoff.*

## Recording every finding under `--scan-only`

The rules below record an item when a command **defers** it — decides not to act on
it this run. A `--scan-only` run acts on *nothing*, so under `--scan-only`
**every surviving finding is deferred and must be filed**, not just the
subset a full run would have skipped. The filed issues are the entire output of that
run: no worktree, no code changes, no PRs. Apply the same dedup, labels, and
title/body rules below to all of them, and report the created and reused `#<number>`s
in the command's summary.

## Recording a plan item

**First dedup against `EXISTING_ISSUES`.** Before filing, check whether the finding
already has an open issue — match on the same file path / symbol or a clearly
equivalent title, not just an exact string match. If it does, **skip creation** and
reuse that issue's `#<number>` as the ID; optionally add a comment if the new finding
adds detail. Only when no existing issue covers it, create one:
`gh issue create --title "<Title>" --body "<rationale + context: file paths, category, why it was deferred>" <label flags>`
(glab: `glab issue create --title "<Title>" --description "<body>" <label flags>`).
The **issue number is the ID**. Make the title a self-contained, claimable task and
put enough context in the body that someone can pick it up cold. Capture the issue
numbers (created **and** reused) for the command's final summary, and note which were
skipped as duplicates.

  **Capturing the created number — parse the printed URL, do NOT use `-q`/`--jq`.**
  `gh issue create` (and `glab issue create`) prints the new issue's **URL** on
  stdout — it is not a `--json` command, so appending `-q .number` / `--jq` errors
  out and, worse, can abort the create in a `$(…)` capture (`gh` exits non-zero,
  taking any `|| fallback` with it). Grab the number by stripping the URL's last
  path segment:
  ```bash
  URL="$(gh issue create --title "<Title>" --body-file "$BODY" <label flags>)"
  NUM="${URL##*/}"   # e.g. https://github.com/o/r/issues/123 -> 123
  ```
  (`glab` prints an MR/issue URL the same way — `${URL##*/}` works for both.) Prefer
  `--body-file "$BODY"` over an inline `--body "…"` when the body is multi-line or
  contains backticks/`$(…)`, so the shell doesn't mangle or execute it.

## Labels, not title brackets

The issue **title is a clean, human-readable task** — do **not** prefix it with
`[category]` / `[SEVERITY]` brackets (e.g. ❌ `[dry][LOW] Consolidate the XML
decoders`), and never with an id or slug (❌ `[security-01] …`,
❌ `[sql-injection-in-pr-route] …`). Issues need no invented slug: the tracker's
**issue number is the ID**. That metadata belongs in GitHub/GitLab **labels**, which both hosts
render as colored tags and let users filter on — the whole point of a tracker.
Carry every label through the `<label flags>` placeholder in the create commands
above as **repeated `--label <name>`** flags (one per label):

- **Scope:** always `--label <PLAN_LABEL>`.
- **Category** — when the finding carries one (audit findings always do): a label
  named for the finding's category slug, lowercased (e.g. `security`, `dry`,
  `architecture`, `deps`, `bugs-perf`, `code-quality`, `stack-specific`, `tests`,
  `ux`, `structural`, `cognitive-load`). This replaces the `[dry]`-style title prefix.
- **Severity** — when the finding carries one: `severity${LABEL_SEP}critical`,
  `severity${LABEL_SEP}high`, `severity${LABEL_SEP}medium`, or
  `severity${LABEL_SEP}low`. This replaces the `[LOW]`-style title prefix.
- **Dispatch hint** — two *optional*, independent labels recommending **how to run
  the work**. See [plan-issue-setup.md](./plan-issue-setup.md) "The dispatch hint"
  for what they mean and when to apply one.

**Create each label if missing, immediately before applying it** (idempotent —
the `|| true` swallows "already exists") — same pattern
[plan-issue-setup.md](./plan-issue-setup.md) "Label creation" uses for `PLAN_LABEL`,
and the same color table lives there:

```bash
# gh — description optional, color optional
gh label create <name> --color <hex> 2>/dev/null || true
# glab — color required
glab label create --name <name> --color "#<hex>" 2>/dev/null || true
```

Reused (deduped) issues keep whatever labels they already have — don't re-label an
existing issue unless the new finding genuinely changes its category or severity.

## Bulk filing — spool the bodies, dedup on an index

Everything above files **one** item. A run that files a handful should do that
inline and stop reading here.

**Apply this section only when a run expects to file more than ~20 issues at once.**
Below that threshold the inline path is simpler.

At that scale, do not hold every finding body in orchestrator context and re-emit
it into `gh issue create` — that truncates bodies, paraphrases evidence, and drops
findings. Split each finding into a **key** and a **body**, and never let the body
reach the orchestrator.

### 1. Producing agents spool bodies to disk

The orchestrator creates a per-run spool directory before dispatch and passes it to
every producing agent:

```bash
SPOOL_DIR="$(mktemp -d "${TMPDIR:-/tmp}/slashdo-issues-XXXXXX")"; echo "$SPOOL_DIR"
```

**Record the printed path in run state and pass that literal path to every agent.**
A shell variable does not survive from one tool call to the next, so re-deriving
`SPOOL_DIR` later gives a different directory and the filer agents find nothing.

Each agent writes its findings to `$SPOOL_DIR/<category>.md` — one file per agent,
so no two agents write the same path. An agent that spools across more than one call
**appends** after the first write (`cat >` once, `cat >>` thereafter); a second `cat >`
silently truncates the findings already spooled. Each finding is a **ready-to-file issue body**
under a finding marker and a `title:` line, not raw notes. **No line inside a body may
begin with `<!-- finding ` at column 0** — indent any such quoted line by one space, so
it cannot be mistaken for the next block's marker: whoever files it must be able to lift
the block out and hand it straight to `--body-file` without rewriting a word.

```markdown
<!-- finding 1 -->
title: <Title — a self-contained, claimable task in plain language>
severity: high
category: security
labels: model${LABEL_SEP}light, effort${LABEL_SEP}medium
files: src/routes/pr.js:142

<the issue body: what is wrong, the quoted evidence, why it matters, the
suggested fix, and enough context for someone to pick it up cold>

<!-- finding 2 -->
title: <Title>
...
```

The marker's number is a plain counter, unique within that spool file; together with
the category on the finding's index line it is the finding's **id** below. **Never
invent a slug, a `[category-NN]` tag, or any other bracketed id.** The id is a
throwaway handle for the orchestrator, not the final ID (the issue number is), and it
**never reaches the tracker**: the issue title is exactly the `title:` value — a
plain, human-readable task — and the body is everything below the `title:` line.

### 2. Agents return an index, not bodies

Each agent's **return value** is one line per finding and nothing else:

```
<N> | <SEVERITY-or-UNCERTAIN> | <category> | <file:line> | <one-line title>
```

`<N>` is the finding's marker number. If an audit reports uncertainty, preserve `UNCERTAIN` in both index and body.
The consolidator may read those specific bodies and cited source to validate them.
Unresolved findings remain explicitly unconfirmed investigation follow-ups: no
confirmed severity label and no automatic remediation. Do not silently coerce
uncertainty into a severity to fit this index.

Dedup, severity ranking, and ownership key off these fields. An agent that finds
nothing returns an empty index and writes no file.

### 3. The orchestrator consolidates on the index

Use the index for these consolidation decisions; targeted uncertainty validation and command-specific evidence reads are exceptions:

- **Cross-agent dedup** — two agents flagging the same `file:line` is normal and
  expected; collapse to one, keeping the more specific title.
- **Dedup against `EXISTING_ISSUES`**, per "Recording a plan item" above.
- Any severity adjustment, ownership mapping, or ordering the command specifies.

Per-agent filing cannot dedup against agents that have not returned yet. The output
here is a surviving id list grouped by category. **The orchestrator never *rewrites* a spooled
body** — targeted validation and command-specific evidence reads may open the
needed blocks, but do not expand every body into context. For filing, both fan-out
and inline paths lift each block verbatim into a `--body-file`; never retype or
summarize evidence from the index line.

### 4. Filer agents file, in parallel, one per category

Dispatch one filer agent per category, in parallel, giving each:

- the surviving ids for its category, and the spool file each id lives in,
- `CLI_TOOL`, `PLAN_LABEL`, and the label rules from "Labels, not title brackets",
- the `URL` / `${URL##*/}` number-capture form from "Recording a plan item".

A **block** runs from a line matching `^<!-- finding <N> -->$` to the next line matching
`^<!-- finding ` (or EOF). That marker is the delimiter, **not a bare `^## `**: a body's quoted
evidence may legitimately contain `## ` lines inside a fence, and a filer that split on
those would truncate the body and file a partial issue — the very truncation this path
exists to prevent.

For each id the filer takes the `--title` from the block's `title:` line, verbatim,
extracts the rest of the block — everything below the `title:` line — into its own `--body-file` temp file, creates any missing labels, creates the issue, and captures
the number. It returns only `<id> -> #<number>` lines. **A filer never rewrites a
body** — it moves bytes from the spool to the tracker. If a block is malformed or its
id is missing from the spool, the filer reports `<id> -> ERROR: <reason>` and moves
on rather than inventing a replacement.

Step 3 already assigned each surviving finding to exactly one category, so no two
filers can race on the same finding.

**Rate limits.** Parallel filers trip GitHub/GitLab secondary rate limits easily.
Give every filer this rule verbatim: on a `403` mentioning a secondary rate limit, or a `429`, sleep
60s and retry that one issue, up to 3 attempts; on the third failure report the id as
`ERROR: rate-limited` and continue with the rest. Keep the fan-out modest — one agent
per category is already bounded, so never shard a single category across agents.

### 5. The orchestrator reports

Merge the filers' `<id> -> #<number>` maps and report created, reused (deduped), and
errored counts with their numbers, exactly as the single-item path would. **Any id
that came back `ERROR` was not filed** — list those explicitly with the spool path so
the user can file them by hand, and never report an errored finding as filed. Leave
`SPOOL_DIR` on disk when any error occurred. Otherwise remove it **only once nothing
downstream still needs the bodies** — filing is not always the end of the run. A command
that goes on to remediate (`/do:better` without `--scan-only`) reads these same
bodies again in its remediation and test-enhancement phases, so it keeps the directory
until those agents have returned; a `--scan-only` run may remove it as soon as the report
is printed.
