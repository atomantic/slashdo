# Plan-Item Disposition: PLAN.md vs. Issue Tracker

Several commands record deferred work as **plan items**. By default each item is
appended to `PLAN.md` as a `- [ ]` checkbox with a unique kebab-slug `[<id>]` (per
[plan-id-format.md](./plan-id-format.md)). When the command is invoked with the
**`--issues`** flag, file the item as a labeled issue in the GitHub/GitLab tracker
**instead of** writing to `PLAN.md` — the same model `/do:replan --issues` uses, so
the two stay consistent and `PLAN.md` doesn't churn while work happens on issues.

## Flags

- **`--issues`**: file plan items as tracker issues instead of `PLAN.md` lines.
  Record `ISSUE_MODE=true` (default `false`).
- **`--issues-label <name>`**: the label that scopes plan-tracking issues. Record
  `PLAN_LABEL` (default `plan`). Only meaningful with `--issues`.

## Setup — only when `ISSUE_MODE` is true

1. **VCS host.** Reuse `CLI_TOOL` (`gh`/`glab`) if the command already detected it
   in its own discovery phase. Otherwise run `gh auth status`, else
   `glab auth status`, and set `CLI_TOOL` accordingly. If neither is authenticated,
   **abort** with: "`--issues` needs an authenticated `gh` or `glab`. Run
   `gh auth login` (or `glab auth login`), or drop `--issues` to record items in
   PLAN.md." Never silently fall back to writing PLAN.md.
2. **Label.** Ensure the scoping label exists:
   `gh label create <PLAN_LABEL> --description "Tracked by slashdo" 2>/dev/null || true`
   (glab: `glab label create --name <PLAN_LABEL> --color "#428BCA" 2>/dev/null || true` — glab requires a color).
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
  `gh issue create --title "<Title>" --body "<rationale + context: file paths, category, why it was deferred>" --label <PLAN_LABEL>`
  (glab: `glab issue create --title "<Title>" --description "<body>" --label <PLAN_LABEL>`).
  The **issue number is the ID** — assign **no** slug, and write **nothing** to
  `PLAN.md`. Make the title a self-contained, claimable task and put enough context
  in the body that someone can pick it up cold. Capture the issue numbers (created
  **and** reused) for the command's final summary (report `#<number>` where it would
  have reported a `[slug]`), and note which were skipped as duplicates.

Everything else about the command is unchanged: in issue mode it simply files
labeled issues wherever it would have written `PLAN.md` lines.
