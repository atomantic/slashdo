---
description: Plan a task by investigating the codebase, then file a robust, decision-complete issue in the repo's tracker — GitHub (gh) or GitLab (glab), auto-detected from the git remote (custom/Enterprise hosts included). Drafts the issue and shows it for approval before creating; pass --yes to skip the gate.
argument-hint: "[<task description>] [--yes|-y] [--label <name>] [--no-dedup] [--dry-run]"
---

# Plan Task — investigate, draft a robust issue, and file it in the tracker

Turn a rough idea into a **well-formed, claimable tracker issue**. `/do:plan-task`
investigates the codebase to ground the task in reality (affected files, current
behavior, constraints), drafts an issue with a clean title and a structured body
(problem, context, approach, acceptance criteria), shows it to you for approval,
then creates it in the repo's issue tracker — **GitHub via `gh` or GitLab via
`glab`**, auto-detected from the git remote exactly the way `/do:next --issues` and
`/do:replan --issues` detect it. A **custom GitHub Enterprise or self-managed GitLab
host works with no extra configuration**: this command only uses `gh issue` /
`glab issue` subcommands, which resolve the host from the `origin` remote (see the
note in [lib/gh-host.md](../../lib/gh-host.md) — only raw `gh api` calls need an
explicit host, and this command makes none).

This is the **single-issue authoring** counterpart to `/do:replan` (which triages a
whole backlog) — you have one specific piece of work in mind and want it captured as
a first-class issue the rest of the slashdo ecosystem can consume: on a GitHub repo,
`/do:next --issues` can then claim and ship it (that consumer is GitHub-only — see
Phase 6).

**The bar: decision-complete.** The issue this command files must be a *fully
specified task, not an open question* — the same **actionable-issues invariant**
`/do:replan` holds itself to. If planning surfaces a decision only the user can make
(which of two approaches, an ambiguous requirement, an unknown constraint), resolve
it in the interactive gate and fold the answer into the body; don't file an issue
whose body is a list of unanswered questions. Under `--yes` (no gate), if a
blocking question remains unresolved, **stop and ask it** rather than filing a vague
issue.

## Parse Arguments

Split `$ARGUMENTS` on whitespace. Tokens starting with `--` (and the short `-y`) are
flags; **everything else, joined, is the free-text task description** — the seed idea
for the issue. Value flags accept either `--flag=value` or `--flag value`. Order is
free.

- **`<task description>`** — the idea to plan, in your own words (e.g. `add a
  --dry-run flag to /do:pr that prints the PR body without pushing`). This is the
  starting point, not the final title — planning refines it. **If no description is
  given**, ask the user what the task is before doing anything else (do not invent
  one or infer it from recent git activity).
- **`--yes` / `-y`** — **skip the interactive approval gate** and file the issue as
  soon as the draft is ready. Use when you trust the draft or are scripting. Even
  under `--yes`, a *blocking* open question (one that would make the issue
  under-specified) stops to ask rather than filing a vague issue — see the invariant
  above.
- **`--label <name>`** — add a label to the issue. Repeatable, and a single value may
  be a comma-list (`--label bug,area:cli`). These are **added to** any label the
  planning step infers (see Phase 4), deduped. Labels are created if missing
  (idempotent) exactly as in [lib/plan-issue-mode.md](../../lib/plan-issue-mode.md).
- **`--no-dedup`** — skip the Phase 2 duplicate check against existing open issues and
  file unconditionally. By default plan-task refuses to create a near-duplicate of an
  already-open issue and points you at it instead.
- **`--dry-run`** — do everything up to and including the draft (and the dedup check),
  print the exact issue that *would* be filed (title, body, labels, target tracker),
  but **do not create it**. Implies no gate is needed. Useful to preview or to paste
  the body elsewhere.

## Phase 0 — Detect the tracker

Resolve the issue host **exactly as [lib/plan-issue-mode.md](../../lib/plan-issue-mode.md)
"Setup" does** — this is the same detection `/do:next --issues` and `/do:replan
--issues` use, so a repo that works with those works here identically:

1. **VCS host / `CLI_TOOL`.** Run `gh auth status --active` (the `--active` flag
   scopes the check to the active account so a stale token on another account doesn't
   falsely pass), else `glab auth status`, and set `CLI_TOOL` to `gh` or `glab`
   accordingly. Both tools resolve the target host from the `origin` remote, so a
   **GitHub Enterprise** or **self-managed GitLab** instance is handled with no extra
   flags. If **neither** is authenticated, abort with:

   > `/do:plan-task files a tracker issue and needs an authenticated `gh` or `glab`.
   > Run `gh auth login` (or `glab auth login`) for this repo's host first.`

   Do not fall back to writing PLAN.md — this command's whole job is to file an issue.
2. **Fetch existing open issues** for the dedup check (Phase 2) and keep them in
   context: `gh issue list --state open --limit 500 --json number,title,labels,body
   --jq '.'` (glab: `glab issue list --state opened --per-page 100 -F json`). Record
   as `EXISTING_ISSUES`. Skip this step under `--no-dedup`.

(Label creation is done lazily in Phase 5, immediately before each label is applied —
no upfront label list is needed.)

## Phase 1 — Understand the task

Investigate the codebase so the issue is **grounded in the actual code**, not a
paraphrase of the request. Proportional to the task's size:

- **Read the request literally**, then find the code it touches: grep/glob for the
  relevant modules, entry points, config, tests, and docs. Read the specific files so
  you can name real paths, functions, and current behavior in the issue.
- **Establish the current state** — what exists today, how it behaves, what's
  missing or wrong. An issue that says "current: `commands/do/pr.md` has no `--dry-run`
  handling in Parse Arguments" is worth ten that say "we should add a dry-run flag."
- **Identify constraints and prior art** — related patterns already in the repo the
  task should follow (e.g. "mirror the `--yes` flag grammar used in every other
  command"), CI/build implications, and anything that scopes the work.
- **Surface open questions** — genuine decisions the task can't proceed without.
  These are resolved in the approval gate (Phase 5) or, under `--yes`, asked before
  filing.
- **For a large or cross-cutting task**, spawn a read-only investigation subagent
  (the `Explore` or `general-purpose` agent) to sweep the affected area in parallel
  and report the map back, rather than reading dozens of files inline. Keep it
  proportional — a one-file tweak doesn't need a subagent.

## Phase 2 — Dedup against existing issues

Unless `--no-dedup` is set, compare the planned task against `EXISTING_ISSUES`
(Phase 0). Match on the **same file path / symbol / feature or a clearly equivalent
intent**, not just an exact title string. If an open issue already covers this work,
**do not create a duplicate**: report the existing `#<number>` and its title, note
what (if anything) your planning adds, and stop — offer to add a clarifying comment
to that issue instead of filing a new one. `--no-dedup` bypasses this entirely.

## Phase 3 — Draft the issue

Produce a **clean, human-readable title** and a **structured body**.

**Title** — a self-contained, claimable task in plain language. **No `[category]` /
`[SEVERITY]` brackets** — that metadata goes in labels (Phase 5), per
[lib/plan-issue-mode.md](../../lib/plan-issue-mode.md) "Labels, not title brackets".
Good: `Add a --dry-run flag to /do:pr that prints the PR body without pushing`. Bad:
`[feature] dry-run` or `update pr.md`.

**Body** — use this structure; **omit a section only when it genuinely has no
content** (don't pad, but don't drop Acceptance criteria — a decision-complete task
always has them):

```markdown
## Problem / Goal
<the outcome we want and why — the user-visible or developer-facing motivation>

## Context
<current behavior grounded in real code: file paths, functions, how it works today,
relevant constraints, prior art to follow, links to related issues/PRs>

## Proposed approach
<a concrete plan — the steps a implementer would take. Prescriptive enough to be
actionable, not so prescriptive it forecloses a better idea found during the work.>

## Acceptance criteria
- [ ] <observable, checkable condition that means "done">
- [ ] <include tests / docs updates when the change warrants them>

## Out of scope
<what this task explicitly does NOT include — prevents scope creep on the claim>

## Open questions
<only if any remain after the gate — ideally empty by the time the issue is filed>
```

Ground every claim in what you actually found in Phase 1. Reference files as
`path:line` where it helps a future implementer land on the spot.

## Phase 4 — Infer labels

Suggest labels so the issue is filterable in the tracker (labels, not title
brackets). Keep it light — a **type/category label** the repo already uses when one
obviously fits (`bug`, `enhancement`/`feature`, `docs`, `chore`, `area:<x>`), plus
any the user passed via `--label`. Prefer labels that **already exist** in
`EXISTING_ISSUES`' label set over inventing new taxonomy. Merge the inferred label(s)
with `--label` values, dedupe. Don't force a severity label onto a plain feature
task — severity is for audit findings, not planned work.

## Phase 5 — Confirm, then create

**Interactive gate (default, unless `--yes` or `--dry-run`).** Present the full draft
— **target tracker/host, title, body, and labels** — and ask the user to **approve,
edit, or cancel**. Fold any requested edits (including answers to open questions) back
into the draft and re-show if the change is substantial. Only proceed on explicit
approval. `--yes` skips straight to creation (but still stops on a *blocking* open
question). `--dry-run` prints the draft and stops here without creating anything.

**Create the issue** via the resolved `CLI_TOOL`, applying labels as **repeated
`--label` flags**, creating each label lazily if missing (idempotent — the `|| true`
swallows "already exists"), per [lib/plan-issue-mode.md](../../lib/plan-issue-mode.md):

```bash
# Ensure each label exists first (gh — color optional; glab — color required):
gh label create <name> 2>/dev/null || true
# glab: glab label create --name <name> --color "#0366D6" 2>/dev/null || true

# GitHub:
gh issue create --title "<Title>" --body "<structured body>" --label <a> --label <b>
# GitLab:
glab issue create --title "<Title>" --description "<structured body>" --label <a> --label <b>
```

Write the body to a temp file and pass `--body-file` (gh) / `--description` from a
file when it's long or contains characters that would fight shell quoting, rather than
inlining a large multi-line string on the command line.

## Phase 6 — Report

Print the outcome plainly:
- **Created:** the new issue's `#<number>` and URL (`gh`/`glab` print it on create —
  surface it), its title, and the labels applied.
- **Deduped:** the existing `#<number>` you pointed at instead (Phase 2).
- **Dry run:** a note that nothing was filed, plus the draft that *would* have been.

Then, when it fits the work, suggest the natural next step. **On GitHub**, that's
`/do:next --issues #<number>` to claim and ship it immediately. **On GitLab**, `/do:next`
is not available (it is GitHub-only in every mode — it ships through `gh pr merge` and
its issue-claim relies on the GitHub assignee model), so leave the issue in the backlog
for a human or a GitLab-native flow to pick up. Either way, leaving it in the backlog
is always a valid stopping point.

## Notes

- **Issue-only, by design.** Unlike `/do:replan`, this command has no PLAN.md mode —
  its purpose is to file a tracker issue. If you want a PLAN.md checkbox instead, add
  the line directly or use `/do:replan`.
- **Custom / Enterprise hosts** need no configuration: `gh issue` / `glab issue`
  infer the host from the `origin` remote. This command never calls raw `gh api`, so
  the `GH_HOST` derivation in [lib/gh-host.md](../../lib/gh-host.md) is not needed.
- **No AI-attribution noise** in the issue body — write it as a human engineer would
  (the same rule slashdo applies to commits and PRs).
