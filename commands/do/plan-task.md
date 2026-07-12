---
description: Plan a task by investigating the codebase, then file a robust, decision-complete issue in the repo's tracker — GitHub (gh) or GitLab (glab), auto-detected from the git remote (custom/Enterprise hosts included). Drafts the issue and shows it for approval before creating; pass --yes to skip the gate.
argument-hint: "[<task description>] [--yes|-y] [--label <name>] [--enhance-with <list>] [--no-dedup] [--dry-run]"
---

# Plan Task — investigate, draft a robust issue, and file it in the tracker

Turn a rough idea into a **well-formed, claimable tracker issue**. `/do:plan-task`
investigates the codebase to ground the task in reality (affected files, current
behavior, constraints), drafts an issue with a clean title and a structured body
(problem, context, approach, acceptance criteria), shows it to you for approval,
then creates it in the repo's issue tracker — **GitHub via `gh` or GitLab via
`glab`**, auto-detected from the `origin` remote the same way `/do:pr` detects its
host (the remote decides where the repo lives; auth only confirms the CLI is usable).
A **custom GitHub Enterprise or self-managed GitLab host works with no extra
configuration**: this command only uses `gh issue` / `glab issue` subcommands, which
resolve the host from the `origin` remote (see the note in
[lib/gh-host.md](../../lib/gh-host.md) — only raw `gh api` calls need an explicit
host, and this command makes none).

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
- **`--enhance-with <list>`** — after the draft is written, route it through an
  **ordered pipeline of enhancement agents** that sharpen it before the approval gate
  (Phase 3.5), each refining the previous agent's output. A cheap second (and third)
  opinion folded into the draft. Uses the **same `agent[model]` list grammar** as
  `--review-with` (see `/do:pr`): a comma-separated, order-preserving list, each entry
  a slug with an optional `[<model>]` bracket. **Accepted slugs: `codex`, `claude`,
  `agy` (aliases `gemini`/`antigravity`), and `grok`** — the agentic CLIs that take a
  free-form enhancement prompt; `ollama` and `copilot` are review-oriented (findings
  emitters, not draft rewriters) and are rejected here. Examples: `--enhance-with=grok`
  (hand the draft to Grok for a second pass); `--enhance-with=codex[o3],grok` (Codex on
  model `o3` enhances first, then Grok enhances Codex's result — sequential, left to
  right). Parse it exactly as `--review-with`: split on `,`, trim, strip each
  `[<model>]` bracket into a per-entry `{ENH_MODEL}`, normalize `gemini`/`antigravity`
  → `agy`, dedupe preserving first-occurrence order (the `[<model>]` bracket is part of
  the identity, so `codex[o3]` and `codex[o4]` are distinct). Reject an unknown slug
  with `Unknown --enhance-with value: {value}. Use one of: codex, claude, agy, grok.`
  **`--enhance-with=none`** (case-insensitive) explicitly skips the pipeline (mirrors
  `--review-with none`). Absent → no enhancement pass runs.
- **`--no-dedup`** — skip the Phase 2 duplicate check against existing open issues and
  file unconditionally. By default plan-task refuses to create a near-duplicate of an
  already-open issue and points you at it instead.
- **`--dry-run`** — do everything up to and including the draft (and the dedup check),
  print the exact issue that *would* be filed (title, body, labels, target tracker),
  but **do not create it**. Implies no gate is needed. Useful to preview or to paste
  the body elsewhere.

## Phase 0 — Detect the tracker

1. **VCS host / `CLI_TOOL` — detect from the `origin` remote first, then confirm the
   matching CLI is authenticated** (the same order `/do:pr`'s "Detect VCS Host" uses,
   and for the same reason). **The `origin` remote is the authoritative signal of where
   the repo lives** — `auth status` only tells you which CLI is *usable*, not where the
   repo is, so a developer with **both** `gh` and `glab` authenticated must not have the
   host decided by whichever `auth status` happens to pass first. Detecting from auth
   alone would file a GitLab repo's issue through `gh` (wrong host) whenever `gh` is also
   logged in. So:
   - Read the remote host: `git remote get-url origin`. If the host is a GitLab instance
     (`gitlab.com` or a self-hosted GitLab), set `VCS_HOST=gitlab` and `CLI_TOOL=glab`;
     otherwise (GitHub, GitHub Enterprise, or ambiguous) set `VCS_HOST=github` and
     `CLI_TOOL=gh`. Both `gh` and `glab` resolve the concrete host from that remote, so a
     **GitHub Enterprise** or **self-managed GitLab** instance is handled with no extra
     flags — this command only ever uses `gh issue` / `glab issue` subcommands, which
     infer the host from the remote (it never calls raw `gh api`, so no `GH_HOST`
     derivation is needed — see [lib/gh-host.md](../../lib/gh-host.md)).
   - Confirm the matching CLI is authenticated: `gh auth status --active` for GitHub (the
     `--active` flag scopes the check to the active account so a stale token on another
     account doesn't falsely fail it), `glab auth status` for GitLab. If it is **not**,
     abort — do not silently fall back to the other CLI (that would target the wrong
     host) or to PLAN.md (this command's whole job is to file a tracker issue):

     > `/do:plan-task detected a {VCS_HOST} repo but `{CLI_TOOL}` is not authenticated.
     > Run `{CLI_TOOL} auth login` for this repo's host first.`

   - If there is **no `origin` remote at all**, fall back to whichever CLI is
     authenticated (`gh` first, then `glab`); if neither is, abort with:
     `/do:plan-task needs an authenticated `gh` (GitHub) or `glab` (GitLab). Run `gh auth login` or `glab auth login`.`

   Print: `Tracker: {VCS_HOST} (via {CLI_TOOL})`.
2. **Fetch existing open issues** for the dedup check (Phase 2), unless `--no-dedup` is
   set. Use the **same fetch [lib/plan-issue-mode.md](../../lib/plan-issue-mode.md)
   "Setup" step 3 defines** (rather than re-inlining the `gh`/`glab` flags here, so the
   two never drift) — it lists all open issues for the resolved `CLI_TOOL` and records
   them as `EXISTING_ISSUES`, which is exactly what Phase 2 dedups against.

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

## Phase 3.5 — Enhance the draft (only when `--enhance-with` was passed)

Skip this phase entirely when `--enhance-with` is absent or resolved to `none` — the
Phase 3 draft goes straight to labeling and the gate. When an agent list was parsed,
route the draft through the **sequential enhancement pipeline** before labels are
inferred (so labels reflect the *enhanced* body) and before the gate (so the human
approves the sharpened draft). The shared loop is inlined here at install time so it's
available in every environment — not a dead link:

!`cat ~/.claude/lib/enhance-loop.md`

Drive that loop with `{ENHANCE_AGENTS}` = the parsed list, `{DRAFT_TITLE}` /
`{DRAFT_BODY}` = the Phase 3 draft, and `{REPO_CONTEXT}` = the task description and
target repo. It returns an enhanced `{DRAFT_TITLE}`/`{DRAFT_BODY}` — **replace the
Phase 3 draft with the returned values** for everything downstream (Phase 4 labels,
the Phase 5 gate, and the Phase 6 report). Print the loop's compact per-agent status
line so it's clear which agents ran, skipped (missing binary), or no-op'd (errored /
timed out / off-contract) — a degraded pass falls back to the last good draft and
never blocks filing.

The pipeline runs in **all** modes: under `--yes` it still enhances, then files;
under `--dry-run` it enhances, then prints the enhanced draft without filing.
Enhancement never bypasses the approval gate — a human still approves the final text
(Phase 5).

**The decision-complete invariant re-applies to the enhanced draft.** An enhancer may
*surface* a blocking open question the original draft didn't (that is part of its job —
"flag under-specification"). So after the pipeline, re-check the enhanced draft's
`Open questions` exactly as Phase 1/Phase 5 would the original: under the interactive
gate, resolve them with the user and fold the answers in; **under `--yes`, a blocking
open question the enhancement surfaced still stops to ask rather than filing a vague
issue** — the same invariant stated at the top of this command, applied to the
enhanced text, not just the Phase 3 draft. Enhancement can only raise the
specification bar, never lower it below that gate.

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
