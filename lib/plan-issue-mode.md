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
  **This flag selects a destination, not a run mode.** It changes *where* items are
  recorded and nothing else — a command that remediates, opens PRs, or merges still
  does all of that. In a command that also offers `--scan-only`, that is the flag
  which stops the pipeline; see "Recording every finding under `--scan-only`" below.
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

## Recording every finding under `--scan-only`

The rules below record an item when a command **defers** it — decides not to act on
it this run. A `--scan-only` run acts on *nothing*, so under `--scan-only` +
`ISSUE_MODE` **every surviving finding is deferred and must be filed**, not just the
subset a full run would have skipped. The filed issues are the entire output of that
run: no worktree, no code changes, no PRs. Apply the same dedup, labels, and
title/body rules below to all of them, and report the created and reused `#<number>`s
in the command's summary.

This is the combination to reach for when the intent is "audit and file the work,
don't touch my code" — `--issues` alone does not do it.

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
- **Severity** — when the finding carries one: `severity:critical`, `severity:high`,
  `severity:medium`, or `severity:low`. This replaces the `[LOW]`-style title prefix.
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
as one scale:

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

Reused (deduped) issues keep whatever labels they already have — don't re-label an
existing issue unless the new finding genuinely changes its category or severity.

Everything else about the command is unchanged: in issue mode it simply files
labeled issues wherever it would have written `PLAN.md` lines.

## The dispatch hint (`model:` + `effort:`)

Two optional labels that record **how to run the work**, not how big it is. They are
a recommendation to whoever (or whatever) claims the issue — not a size estimate, not
a priority, and never a gate.

- **`model:light` / `model:medium` / `model:heavy`** — the **capability tier** the
  task needs. `light` is mechanical: a rename, a config bump, a doc fix, a port of an
  established pattern. `heavy` is genuinely hard reasoning: a concurrency bug, an API
  redesign, anything where the first plausible answer is usually wrong.
- **`effort:low` / `effort:medium` / `effort:high` / `effort:xhigh` / `effort:max`** —
  the **reasoning budget** per step. High when the work is wide, fiddly, or easy to
  get subtly wrong, independent of how hard the underlying thinking is.

**The two axes are independent, and the off-diagonal combinations are the point.**
`model:light` + `effort:max` is the right hint for a mechanical change across forty
call sites — no insight required, plenty of chances to miss one. `model:heavy` +
`effort:low` fits a two-line change that hinges on one good idea. A hint that always
moves both axes together is a size estimate wearing a costume.

**Tier names, not model names — the label is host-neutral.** A concrete slug like
`opus` or `gpt-5` is wrong on two independent time scales: it ages out while the
issues outlive it, and it is meaningless to the *other* CLIs that read the same
tracker. slashdo runs under Claude Code, OpenCode, Antigravity, Codex, and Grok
Build, against local Ollama models too — an issue filed from one is routinely claimed
from another, and none of them share a model namespace. So the label records **only
the tier**, and the consumer resolves it against its own host's lineup at dispatch
time, per [model-tiers.md](./model-tiers.md) — the same tier vocabulary `/do:better`,
`/do:depfree`, `/do:review`, and `/do:rpr` use for their own agents. Read that file
for the resolution rules, including why `heavy` means "inherit the session's model"
rather than a pinned slug, and how a host with a coarser effort scale clamps.

**Applying one is optional; an unlabeled issue is normal** and stays fully claimable.
Only apply a hint you can justify from the work you actually investigated — a
reflexive `model:medium` + `effort:medium` on everything is noise that makes the real
signals unreadable. Prefer leaving an axis off to guessing it.

**Not to be confused with `/do:config --review-models`**, which pins the model each
*reviewer* runs on. The dispatch hint is about the *implementer*.

**Consumer:** `/do:next` reads both — its `--model` / `--effort` flags filter the
queue by them, and in `--swarm` mode it sets each worker agent's model from the
claimed issue's tier.

**Filtering is the primary use of both labels**, and it works on every host: it is
label matching, nothing more. Choosing *which* issue to pick up — "give me something
cheap", "give me the careful work" — is what these labels are for. Dispatch is a
bonus applied where the host supports it: the model tier maps to a real parameter on
most hosts, while `effort:` is advisory and an agent **may** pass it to a sub-agent
where such a control exists. A host that can't spawn sub-agents, or can't set their
model, simply reports the labels — which costs nothing, since they stay accurate for
whoever reads the issue next.
