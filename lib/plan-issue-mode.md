# Plan-Item Disposition: PLAN.md vs. Issue Tracker

Several commands record deferred work as **plan items**. By default each item is
appended to `PLAN.md` as a `- [ ]` checkbox with a unique kebab-slug `[<id>]` (per
[plan-id-format.md](./plan-id-format.md)). When the command resolves
**`ISSUE_MODE=true`** — `--issues` **or** a saved `issues=true` default; each
command resolves this in its own argument parsing — file the item as a labeled
issue in the GitHub/GitLab tracker **instead of** writing to `PLAN.md`.

## Flags

- **`--issues`**: file plan items as tracker issues instead of `PLAN.md` lines.
  Record `ISSUE_MODE=true` (default `false`). A saved `issues=true` default resolves
  to the same `ISSUE_MODE=true` when neither `--issues` nor `--no-issues` is typed.
  **This flag selects a destination, not a run mode** — remediation, PRs, and merges
  still run. `--scan-only` is what stops the pipeline; see below.
- **`--issues-label <name>`**: the label that scopes plan-tracking issues. Record
  `PLAN_LABEL` (default `plan`). Only meaningful when `ISSUE_MODE` is true.

## Setup — only when `ISSUE_MODE` is true

1. **VCS host.** Reuse `CLI_TOOL` (`gh`/`glab`) if the command already detected it
   in its own discovery phase. Otherwise **derive it from the `origin` remote first,
   then confirm that host's credentials** — never pick a CLI by probing its
   credentials before looking at the remote, which is how a GitLab repo on a
   machine also authenticated to GitHub ends up misrouted against a repository it
   cannot see (see `~/.claude/lib/vcs-host.md`, which this mirrors):
   ```bash
   ORIGIN_HOST="$(git remote get-url origin 2>/dev/null | sed -E 's#^[a-z]+://##; s#^[^@/]+@##; s#[:/].*$##')"
   if printf '%s' "$ORIGIN_HOST" | grep -qi gitlab; then
     CLI_TOOL=glab
   elif [ -n "$ORIGIN_HOST" ]; then
     CLI_TOOL=gh
   elif gh auth status --active >/dev/null 2>&1; then
     CLI_TOOL=gh
   elif glab auth status >/dev/null 2>&1; then
     CLI_TOOL=glab
   else
     echo "--issues needs an authenticated gh or glab. Run 'gh auth login' or 'glab auth login', or drop --issues to record items in PLAN.md."; exit 1
   fi
   ```
   (`gh auth status --active` scopes to the active account so a stale token on
   another account doesn't falsely fail it — only the no-origin fallback above;
   remote-derived branches confirm credentials next.) Then confirm the selected
   `CLI_TOOL` is authenticated to `$ORIGIN_HOST` (`gh auth status --active` /
   `glab auth status`); if not, **abort** with: "`--issues` needs an authenticated
   `gh` or `glab`. Run `gh auth login` (or `glab auth login`), or drop `--issues`
   to record items in PLAN.md." Never silently fall back to writing PLAN.md.

   **Derive `LABEL_SEP` from `CLI_TOOL` right after it's set:**
   `[ "$CLI_TOOL" = glab ] && LABEL_SEP="::" || LABEL_SEP=":"`. GitLab natively
   treats any `key::value` label as a **scoped label** — the UI renders the two
   halves in two tones and, more importantly, **only one value per key can be
   applied to an issue at a time** (applying a second one silently replaces the
   first). That is exactly the semantics `severity`/`model`/`effort`/`priority`/
   `area` want on a GitLab tracker, and GitHub has no equivalent (no special
   rendering, no exclusivity), so it keeps the plain single colon. Every
   prefixed label name below is built as `<key>${LABEL_SEP}<value>` — the
   examples in this file show `:` for readability; substitute the resolved
   `LABEL_SEP` when actually creating or matching a label.
2. **Label.** Ensure the scoping label exists:
   `gh label create <PLAN_LABEL> --description "Tracked by slashdo" 2>/dev/null || true`
   (glab: `glab label create --name <PLAN_LABEL> --color "#428BCA" 2>/dev/null || true` — glab requires a color).
   Category and severity labels (see "Labels, not title brackets" below) are
   created lazily, immediately before each issue is filed, so no upfront list of
   them is needed here.
3. **Fetch existing open issues.** In issue mode the tracker — not `PLAN.md` — is
   the source of truth for already-known work, so pull the open issues up front and
   keep them in context for dedup:
   `gh issue list --state open --limit 500 --json number,title,labels,body --jq '.'`
   (glab: `glab issue list --state opened --per-page 100 -F json`). Record this as
   `EXISTING_ISSUES`. Listing **all** open issues (not just `--label <PLAN_LABEL>`)
   avoids re-filing a finding someone already opened by hand under a different label.

## Recording every finding under `--scan-only`

The rules below record an item when a command **defers** it — decides not to act on
it this run. A `--scan-only` run acts on *nothing*, so under `--scan-only` +
`ISSUE_MODE` **every surviving finding is deferred and must be filed**, not just the
subset a full run would have skipped. The filed issues are the entire output of that
run: no worktree, no code changes, no PRs. Apply the same dedup, labels, and
title/body rules below to all of them, and report the created and reused `#<number>`s
in the command's summary.

`--issues` alone does not do it.

## Recording a plan item

- **PLAN.md mode (default):** append
  `- [ ] [<slug>] **Title** — rationale` per [plan-id-format.md](./plan-id-format.md).
- **Issue mode (`--issues`):** **first dedup against `EXISTING_ISSUES`.** Before
  filing, check whether the finding already has an open issue — match on the same
  file path / symbol or a clearly equivalent title, not just an exact string match.
  If it does, **skip creation** and reuse that issue's `#<number>` as the ID;
  optionally add a comment if the new finding adds detail. Only when no existing
  issue covers it, create one:
  `gh issue create --title "<Title>" --body "<rationale + context: file paths, category, why it was deferred>" <label flags>`
  (glab: `glab issue create --title "<Title>" --description "<body>" <label flags>`).
  The **issue number is the ID** — assign **no** slug, and write **nothing** to
  `PLAN.md`. Make the title a self-contained, claimable task and put enough context
  in the body that someone can pick it up cold. Capture the issue numbers (created
  **and** reused) for the command's final summary (report `#<number>` where it would
  have reported a `[slug]`), and note which were skipped as duplicates.

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
decoders`). That metadata belongs in GitHub/GitLab **labels**, which both hosts
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
  the work**. See "The dispatch hint" below for what they mean and when to apply one.

**Create each label if missing, immediately before applying it** (idempotent —
the `|| true` swallows "already exists"):

```bash
# gh — description optional, color optional
gh label create <name> --color <hex> 2>/dev/null || true
# glab — color required
glab label create --name <name> --color "#<hex>" 2>/dev/null || true
```

Use these severity colors so the tags read at a glance; category labels share one
neutral color, and each dispatch-hint axis gets its own ramp so the two never read
as one scale. (Names shown with `:` — build the real name as `<key>${LABEL_SEP}<value>`.)

| Label             | Color hex |
|-------------------|-----------|
| `severity:critical` | `B60205` |
| `severity:high`     | `D93F0B` |
| `severity:medium`   | `FBCA04` |
| `severity:low`      | `0E8A16` |
| any category label  | `0366D6` |
| `model:light`       | `D4C5F9` |
| `model:medium`      | `A371F7` |
| `model:heavy`       | `6F42C1` |
| `effort:low`        | `BFE5E5` |
| `effort:medium`     | `76C7C7` |
| `effort:high`       | `1D7874` |
| `effort:xhigh`      | `0E4F4C` |
| `effort:max`        | `05403D` |

On GitLab the color is largely cosmetic anyway — the scope portion (`severity`,
`model`, `effort`, `priority`, `area`) renders in its own tone regardless of the
value's hex, so pick one representative color per **scope** if a repo's `glab
label create` calls are hand-maintained rather than generated from this table.

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

Each agent writes its findings to `$SPOOL_DIR/<agent-slug>.md` — one file per agent,
so no two agents write the same path. An agent that spools across more than one call
**appends** after the first write (`cat >` once, `cat >>` thereafter); a second `cat >`
silently truncates the findings already spooled. Each finding is a **ready-to-file issue body**
under an id heading, not raw notes. **No line inside a body may begin with `## [` at
column 0** — indent any such quoted line by one space, so it cannot be mistaken for the
next block's heading: whoever files it must be able to lift the block
out and hand it straight to `--body-file` without rewriting a word.

```markdown
## [<agent-slug>-01] <Title — a self-contained, claimable task>
severity: high
category: security
labels: model${LABEL_SEP}light, effort${LABEL_SEP}medium
files: src/routes/pr.js:142

<the issue body: what is wrong, the quoted evidence, why it matters, the
suggested fix, and enough context for someone to pick it up cold>

## [<agent-slug>-02] <Title>
...
```

The id only has to be unique within the run — `<agent-slug>-<NN>` is enough. It is a
handle for the orchestrator, not a plan slug (issue mode assigns no slugs, per
[plan-id-format.md](./plan-id-format.md)) and not the final ID (the issue number is).

### 2. Agents return an index, not bodies

Each agent's **return value** is one line per finding and nothing else:

```
<id> | <SEVERITY-or-UNCERTAIN> | <category> | <file:line> | <one-line title>
```

If an audit reports uncertainty, preserve `UNCERTAIN` in both index and body.
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

A **block** runs from a line matching `^## \[<id>\] ` to the next line matching `^## \[`
(or EOF). That bracketed form is the delimiter, **not a bare `^## `**: a body's quoted
evidence may legitimately contain `## ` lines inside a fence, and a filer that split on
those would truncate the body and file a partial issue — the very truncation this path
exists to prevent.

For each id the filer extracts that block from the spool file into its own
`--body-file` temp file, creates any missing labels, creates the issue, and captures
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
that goes on to remediate (`/do:better --issues` without `--scan-only`) reads these same
bodies again in its remediation and test-enhancement phases, so it keeps the directory
until those agents have returned; a `--scan-only` run may remove it as soon as the report
is printed.

## The dispatch hint (`model:` + `effort:`)

Two optional labels that record **how to run the work**, not how big it is. They are
a recommendation to whoever claims the issue — not a size estimate, not a priority,
and never a gate. (As throughout this file, `:` below stands for the resolved
`LABEL_SEP` — `::` on GitLab, `:` on GitHub; see "Setup" above.)

- **`model:light` / `model:medium` / `model:heavy`** — the **capability tier**.
  `light` is mechanical (rename, config bump, doc fix, established pattern). `heavy`
  is hard reasoning (concurrency bug, API redesign, first plausible answer is usually wrong).
- **`effort:low` / `effort:medium` / `effort:high` / `effort:xhigh` / `effort:max`** —
  the **reasoning budget** per step. High when the work is wide, fiddly, or easy to
  get subtly wrong, independent of how hard the thinking is.

**The two axes are independent.** `model:light` + `effort:max` is a mechanical change
across forty call sites; `model:heavy` + `effort:low` is a two-line change that hinges
on one good idea. Moving both axes together is a size estimate, not a hint.

**Tier names, not model names — the label is host-neutral.** A slug like `opus` or
`gpt-5` ages out and is meaningless to other CLIs on the same tracker. Record **only
the tier**; the consumer resolves it against its own host at dispatch time per
[model-tiers.md](./model-tiers.md) — the same vocabulary `/do:better`, `/do:depfree`,
`/do:review`, and `/do:rpr` use. `heavy` means "inherit the session's model" rather
than a pinned slug; a coarser effort scale clamps.

**Applying one is optional; an unlabeled issue is normal** and stays fully claimable.
Only apply a hint you can justify from the work you investigated. Prefer leaving an
axis off to guessing it. A reflexive `model:medium` + `effort:medium` on everything
is noise.

**Not `/do:config --review-models`**, which pins each *reviewer*. The dispatch hint
is about the *implementer*.

**Consumer:** `/do:next` reads both — `--model` / `--effort` filter the queue, and
`--swarm` sets each worker's model from the claimed issue's tier.

**Filtering is the primary use** and works on every host (label matching). Dispatch
is a bonus where the host supports it: the model tier maps to a real parameter on
most hosts; `effort:` is advisory and an agent **may** pass it to a sub-agent where
such a control exists. A host that can't spawn sub-agents, or can't set their model,
reports the labels.
