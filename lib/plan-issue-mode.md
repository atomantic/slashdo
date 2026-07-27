# Plan-Item Disposition: PLAN.md vs. Issue Tracker

Several commands record deferred work as **plan items**. By default each item is
appended to `PLAN.md` as a `- [ ]` checkbox with a unique kebab-slug `[<id>]` (per
[plan-id-format.md](./plan-id-format.md)). When the command resolves
**`ISSUE_MODE=true`** — set by the `--issues` flag **or** a saved `issues=true`
default (each command resolves this in its own argument parsing; the `(--issues)`
labels below are shorthand for "this branch runs when `ISSUE_MODE` is true," whether
the flag was typed or the default supplied it) — file the item as a labeled issue in
the GitHub/GitLab tracker **instead of** writing to `PLAN.md` — the same model
`/do:replan --issues` uses, so the two stay consistent and `PLAN.md` doesn't churn
while work happens on issues.

## Flags

- **`--issues`**: file plan items as tracker issues instead of `PLAN.md` lines.
  Record `ISSUE_MODE=true` (default `false`). A saved `issues=true` default resolves
  to the same `ISSUE_MODE=true` when neither `--issues` nor `--no-issues` is typed.
- **`--issues-label <name>`**: the label that scopes plan-tracking issues. Record
  `PLAN_LABEL` (default `plan`). Only meaningful when `ISSUE_MODE` is true.

## Setup — only when `ISSUE_MODE` is true

1. **VCS host.** Reuse `CLI_TOOL` (`gh`/`glab`) if the command already detected it
   in its own discovery phase. Otherwise run `gh auth status --active` (the `--active`
   flag scopes the check to the active account, so a stale token on another configured
   account doesn't falsely fail it), else
   `glab auth status`, and set `CLI_TOOL` accordingly. If neither is authenticated,
   **abort** with: "`--issues` needs an authenticated `gh` or `glab`. Run
   `gh auth login` (or `glab auth login`), or drop `--issues` to record items in
   PLAN.md." Never silently fall back to writing PLAN.md.
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
  `ux`, `structural`). This replaces the `[dry]`-style title prefix.
- **Severity** — when the finding carries one: `severity:critical`, `severity:high`,
  `severity:medium`, or `severity:low`. This replaces the `[LOW]`-style title prefix.

**Create each label if missing, immediately before applying it** (idempotent —
the `|| true` swallows "already exists"):

```bash
# gh — description optional, color optional
gh label create <name> --color <hex> 2>/dev/null || true
# glab — color required
glab label create --name <name> --color "#<hex>" 2>/dev/null || true
```

Use these severity colors so the tags read at a glance; category labels share one
neutral color:

| Label             | Color hex |
|-------------------|-----------|
| `severity:critical` | `B60205` |
| `severity:high`     | `D93F0B` |
| `severity:medium`   | `FBCA04` |
| `severity:low`      | `0E8A16` |
| any category label  | `0366D6` |

Reused (deduped) issues keep whatever labels they already have — don't re-label an
existing issue unless the new finding genuinely changes its category or severity.

Everything else about the command is unchanged: in issue mode it simply files
labeled issues wherever it would have written `PLAN.md` lines.
