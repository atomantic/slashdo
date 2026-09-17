---
description: Plan a task by investigating the codebase, then file a robust, decision-complete issue in the repo's tracker — GitHub (gh) or GitLab (glab), auto-detected from the git remote (custom/Enterprise hosts included). Drafts the issue and shows it for approval before creating; pass --yes to skip the gate.
argument-hint: "[<task description>] [--yes|-y] [--label <name>] [--model <tier>] [--effort <level>] [--enhance-with <list>] [--no-dedup] [--dry-run]"
---

# Plan Task — investigate, draft a robust issue, and file it in the tracker

Turn a rough idea into a **well-formed, claimable tracker issue**: investigate the
codebase to ground the task in reality (affected files, current behavior,
constraints), draft an issue with a clean title and a structured body (problem,
context, approach, acceptance criteria), show it for approval, then create it in the
repo's tracker — **GitHub via `gh` or GitLab via `glab`**, auto-detected from the
`origin` remote the same way `/do:pr` detects its host. A custom GitHub Enterprise or
self-managed GitLab host needs no configuration: this command only uses `gh issue` /
`glab issue` subcommands, which resolve the host from the remote (see
[lib/gh-host.md](../../lib/gh-host.md) — only raw `gh api` calls need an explicit
host, and this command makes none).

This is the **single-issue authoring** counterpart to `/do:replan` (which triages a
whole backlog): one specific piece of work, captured as a first-class issue that
`/do:next --issues` can then claim and ship (see Phase 6).

**The bar: decision-complete.** The filed issue must be a *fully specified task, not
an open question* — the same **actionable-issues invariant** `/do:replan` holds itself
to. If planning surfaces a decision only the user can make (which of two approaches,
an ambiguous requirement, an unknown constraint), resolve it in the interactive gate
and fold the answer into the body. Under `--yes` (no gate), if a blocking question
remains unresolved, **stop and ask it** rather than filing a vague issue.

## Parse Arguments

Split `$ARGUMENTS` on whitespace. Tokens starting with `--` (and the short `-y`) are
flags; **everything else, joined, is the free-text task description**. Value flags
accept either `--flag=value` or `--flag value`. Order is free.

- **`<task description>`** — the idea to plan (e.g. `add a --dry-run flag to /do:pr
  that prints the PR body without pushing`). A starting point, not the final title.
  **If no description is given**, ask the user what the task is before doing anything
  else (do not invent one or infer it from recent git activity).
- **`--yes` / `-y`** — **skip the interactive approval gate** and file as soon as the
  draft is ready. A *blocking* open question still stops to ask (see the invariant
  above).
- **`--label <name>`** — add a label to the issue. Repeatable; a single value may be a
  comma-list (`--label bug,area:cli`). **Added to** any label Phase 4 infers, deduped.
  Labels are created if missing (idempotent) exactly as in
  [lib/plan-issue-mode.md](../../lib/plan-issue-mode.md).
- **`--model <tier>`** / **`--effort <level>`** — set the issue's **dispatch hint**
  explicitly instead of letting Phase 4 infer it. `<tier>` ∈ `light` / `medium` /
  `heavy`; `<level>` ∈ `low` / `medium` / `high` / `xhigh` / `max`. Each applies the
  corresponding `model${LABEL_SEP}<tier>` / `effort${LABEL_SEP}<level>` label (see
  [lib/plan-issue-mode.md](../../lib/plan-issue-mode.md) "The dispatch hint"). A typed
  value **wins over inference** for that axis and is not re-litigated at the gate; the
  other axis is still inferred. `--model none` / `--effort none` **suppress** that
  axis entirely — no label, no inference. Reject anything else with
  `--model must be one of light, medium, heavy, none (got: {value}).` /
  `--effort must be one of low, medium, high, xhigh, max, none (got: {value}).`
- **`--enhance-with <list>`** — after the draft is written, route it through an
  **ordered pipeline of enhancement agents** (Phase 3.5), each refining the previous
  agent's output, before the approval gate. Same `agent[model]` list grammar as
  `--review-with` (see `/do:pr`). **Accepted slugs: `codex`, `claude`, `agy` (aliases
  `gemini`/`antigravity`), `grok`, `pi`, and `cursor` (alias `cursor-agent`)** — the
  agentic CLIs that take a free-form prompt; `ollama` and `copilot` are findings
  emitters, not draft rewriters, and are rejected here. Examples: `--enhance-with=grok`;
  `--enhance-with=codex[o3],grok` (Codex on `o3` first, then Grok on Codex's result).
  **Tokenize bracket-aware, never by naive whitespace split**: model selectors may
  contain spaces and parens (e.g. `--enhance-with 'agy[Gemini 3.8 Flash (High)]' fix
  the login bug`) and the rest of `$ARGUMENTS` is free-form task text, so a
  whitespace-first split would leak `3.8 Flash (High)]` into the description. The
  value ends at the first whitespace *outside* any `[...]` bracket (an opened bracket
  runs to its matching `]`, whatever it contains). Then parse it exactly as
  `--review-with`: split on `,` (only commas outside brackets), trim, strip each
  `[<model>]` bracket into a per-entry `{ENH_MODEL}`, normalize `gemini`/`antigravity`
  → `agy`, `cursor-agent` → `cursor`, dedupe preserving first-occurrence order (the
  bracket is part of the identity, so `codex[o3]` and `codex[o4]` are distinct).
  Reject an unknown slug with
  `Unknown --enhance-with value: {value}. Use one of: codex, claude, agy, grok, pi, cursor.`
  **`--enhance-with=none`** (case-insensitive) explicitly skips the pipeline (mirrors
  `--review-with none`). Absent → no enhancement pass runs.
- **`--no-dedup`** — skip the Phase 2 duplicate check against existing open issues and
  file unconditionally.
- **`--dry-run`** — do everything up to and including the draft (and the dedup
  check), print the exact issue that *would* be filed (title, body, labels, target
  tracker), but **do not create it**. No gate is needed.

## Phase 0 — Detect the tracker

1. **VCS host / `CLI_TOOL` — detect from the `origin` remote first, then confirm the
   matching CLI is authenticated** (the same order as `/do:pr`'s "Detect VCS Host").
   `auth status` only says which CLI is *usable*, so with **both** `gh` and `glab`
   authenticated the host must never be decided by whichever probe passes first.
   - Read the remote host: `git remote get-url origin`. If the host is a GitLab
     instance (`gitlab.com` or self-hosted), set `VCS_HOST=gitlab` and
     `CLI_TOOL=glab`; otherwise (GitHub, GitHub Enterprise, or ambiguous) set
     `VCS_HOST=github` and `CLI_TOOL=gh`. Both CLIs resolve the concrete host from
     the remote, so Enterprise / self-managed hosts need no extra flags (no
     `GH_HOST` derivation — see [lib/gh-host.md](../../lib/gh-host.md)).
   - Confirm the matching CLI is authenticated: `gh auth status --active` for GitHub
     (`--active` scopes the check to the active account so a stale token elsewhere
     doesn't falsely fail it), `glab auth status` for GitLab. If it is **not**,
     abort — never fall back to the other CLI (wrong host) or to PLAN.md:

     > `/do:plan-task detected a {VCS_HOST} repo but `{CLI_TOOL}` is not authenticated.
     > Run `{CLI_TOOL} auth login` for this repo's host first.`

   - If there is **no `origin` remote at all**, fall back to whichever CLI is
     authenticated (`gh` first, then `glab`); if neither is, abort with:
     `/do:plan-task needs an authenticated `gh` (GitHub) or `glab` (GitLab). Run `gh auth login` or `glab auth login`.`

   Print: `Tracker: {VCS_HOST} (via {CLI_TOOL})`.
   - **Derive `LABEL_SEP`:** `[ "$CLI_TOOL" = glab ] && LABEL_SEP="::" || LABEL_SEP=":"`.
     GitLab renders any `key::value` label as a two-tone **scoped label** and
     enforces that only one value per key applies to an issue at a time; GitHub has
     no equivalent, so it keeps `:`. Every prefixed label this command builds
     (`model`, `effort`, `area`, …) is `<key>${LABEL_SEP}<value>`, per
     [lib/plan-issue-mode.md](../../lib/plan-issue-mode.md) "Setup".
2. **Fetch existing open issues** for the dedup check (Phase 2), unless `--no-dedup`
   is set, using the **same fetch [lib/plan-issue-mode.md](../../lib/plan-issue-mode.md)
   "Setup" step 3 defines** (so the two never drift) — it lists all open issues for
   the resolved `CLI_TOOL` and records them as `EXISTING_ISSUES`.

(Labels are created lazily in Phase 5, immediately before each is applied.)

## Phase 1 — Understand the task

Investigate the codebase so the issue is **grounded in the actual code**, not a
paraphrase of the request. Proportional to the task's size:

- **Read the request literally**, then find the code it touches: grep/glob for the
  relevant modules, entry points, config, tests, and docs. Read the specific files so
  you can name real paths, functions, and current behavior.
- **Establish the current state** — what exists today, how it behaves, what's missing
  or wrong. "current: `commands/do/pr.md` has no `--dry-run` handling in Parse
  Arguments" is worth ten "we should add a dry-run flag."
- **Identify constraints and prior art** — patterns already in the repo the task
  should follow (e.g. "mirror the `--yes` flag grammar used in every other command"),
  CI/build implications, and anything that scopes the work.
- **Surface open questions** — genuine decisions the task can't proceed without.
  Resolved in the approval gate (Phase 5) or, under `--yes`, asked before filing.
- **For a large or cross-cutting task**, spawn a read-only investigation subagent
  (`Explore` or `general-purpose`) to sweep the affected area and report the map
  back. Keep it proportional — a one-file tweak doesn't need a subagent.

## Phase 2 — Dedup against existing issues

Unless `--no-dedup` is set, compare the planned task against `EXISTING_ISSUES`
(Phase 0). Match on the **same file path / symbol / feature or a clearly equivalent
intent**, not just an exact title string. If an open issue already covers this work,
**do not create a duplicate**: report the existing `#<number>` and its title, note
what (if anything) your planning adds, and stop — offer to add a clarifying comment
to that issue instead.

## Phase 3 — Draft the issue

Produce a **clean, human-readable title** and a **structured body**.

**Title** — a self-contained, claimable task in plain language. **No `[category]` /
`[SEVERITY]` brackets** — that metadata goes in labels (Phase 5), per
[lib/plan-issue-mode.md](../../lib/plan-issue-mode.md) "Labels, not title brackets".
Good: `Add a --dry-run flag to /do:pr that prints the PR body without pushing`. Bad:
`[feature] dry-run` or `update pr.md`.

**Body** — use this structure; **omit a section only when it genuinely has no
content** (never drop Acceptance criteria — a decision-complete task always has them):

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

Ground every claim in what you found in Phase 1. Reference files as `path:line`
where it helps a future implementer land on the spot.

## Phase 3.5 — Enhance the draft (only when `--enhance-with` was passed)

Skip this phase when `--enhance-with` is absent or resolved to `none`. Otherwise route
the draft through the **sequential enhancement pipeline** before labels are inferred
(so labels reflect the *enhanced* body) and before the gate (so the human approves
the sharpened draft). Read the shared loop only when `--enhance-with` produced a non-empty agent list:

!read lib/enhance-loop.md

Drive that loop with `{ENHANCE_AGENTS}` = the parsed list, `{DRAFT_TITLE}` /
`{DRAFT_BODY}` = the Phase 3 draft, and `{REPO_CONTEXT}` = the task description and
target repo. **Replace the Phase 3 draft with the returned `{DRAFT_TITLE}`/`{DRAFT_BODY}`**
for everything downstream. Print the loop's compact per-agent status line (ran /
skipped for a missing binary / no-op'd on error, timeout, or off-contract output) —
a degraded pass falls back to the last good draft and never blocks filing.

The pipeline runs in **all** modes (`--yes` enhances, then files; `--dry-run`
enhances, then prints) and never bypasses the approval gate (Phase 5).

**The decision-complete invariant re-applies to the enhanced draft.** An enhancer may
*surface* a blocking open question the original draft didn't, so re-check the enhanced
draft's `Open questions`: under the interactive gate, resolve them with the user and
fold the answers in; **under `--yes`, a blocking open question the enhancement
surfaced still stops to ask rather than filing a vague issue**.

## Phase 4 — Infer labels

Suggest labels so the issue is filterable (labels, not title brackets). Keep it light —
a **type/category label** the repo already uses when one obviously fits (`bug`,
`enhancement`/`feature`, `docs`, `chore`, `area${LABEL_SEP}<x>`), plus any from
`--label`. Prefer labels that **already exist** in `EXISTING_ISSUES`' label set over
inventing new taxonomy — including matching its separator: if the repo's own `area`
labels already use `:` (or `::`), follow that convention rather than `$LABEL_SEP`
for this one, since a mismatched separator makes it a different, unfilterable label.
Merge with `--label` values, dedupe. Don't force a severity label onto a plain
feature task — severity is for audit findings.

### The dispatch hint

Then recommend **how to run the work** on the two independent axes defined in
[lib/plan-issue-mode.md](../../lib/plan-issue-mode.md) ("The dispatch hint"), using
the code Phase 1 just read:

- **`model${LABEL_SEP}<light|medium|heavy>`** — how much *capability* the task needs.
  Judge it from what Phase 1 found, not the request's wording: an approach you could
  write out line-by-line is `light` however long it is; genuine uncertainty between
  two designs is `heavy`.
- **`effort${LABEL_SEP}<low|medium|high|xhigh|max>`** — how much *reasoning budget*
  per step, driven by **surface area and blast radius**: call-site count, how easy a
  silent miss is, whether a wrong move corrupts data or breaks a public contract.

**Set the axes independently.** The off-diagonal combinations carry the most
information (`model:light` + `effort:max` for a wide mechanical sweep; `model:heavy` +
`effort:low` for a small change hinging on one idea); both landing on the middle
value every time means you're estimating size, not recommending a dispatch.

**Precedence and omission:**
- A typed `--model` / `--effort` **wins outright** for that axis — don't re-raise it
  at the gate.
- `--model none` / `--effort none` suppress that axis: no label, no inference.
- **Leave an axis off when you can't justify a value** — a reflexive guess is worse
  than silence, because `/do:next --model light` will act on it.
- If the repo already uses its **own** sizing/dispatch taxonomy (`size/M`, story
  points, `complexity:*` — visible in `EXISTING_ISSUES`' label set), prefer it and
  skip these. Say which you used.

State the hint with a one-line justification in the Phase 5 gate (e.g. `model:light +
effort:max — mechanical, but it touches 40 call sites and a miss is silent`).

## Phase 5 — Confirm, then create

**Interactive gate (default, unless `--yes` or `--dry-run`).** Present the full draft
— **target tracker/host, title, body, and labels** (call out the **dispatch hint** on
its own line with its one-line justification) — and ask the user to **approve, edit,
or cancel**. Fold requested edits (including answers to open questions) back into the
draft and re-show if the change is substantial. Only proceed on explicit approval.
`--yes` skips straight to creation (but still stops on a *blocking* open question).
`--dry-run` prints the draft and stops here.

**Create the issue** via the resolved `CLI_TOOL`, applying labels as **repeated
`--label` flags**, creating each label lazily if missing (the `|| true` swallows
"already exists"), per [lib/plan-issue-mode.md](../../lib/plan-issue-mode.md):

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
file when it's long or would fight shell quoting.

## Phase 6 — Report

Print the outcome plainly:
- **Created:** the new issue's `#<number>` and URL (`gh`/`glab` print it on create),
  its title, and the labels applied.
- **Deduped:** the existing `#<number>` you pointed at instead (Phase 2).
- **Dry run:** a note that nothing was filed, plus the draft that *would* have been.

Then, when it fits, suggest `/do:next --issues #<number>` to claim and ship it
immediately (GitHub or GitLab — `/do:next` detects the host the same way). Leaving it
in the backlog is always a valid stopping point.

## Notes

- **Issue-only, by design.** Unlike `/do:replan`, this command has no PLAN.md mode.
  For a PLAN.md checkbox, add the line directly or use `/do:replan`.
- **Custom / Enterprise hosts** need no configuration: `gh issue` / `glab issue`
  infer the host from the `origin` remote, and this command never calls raw `gh api`.
- **No AI-attribution noise** in the issue body — write it as a human engineer would
  (the same rule slashdo applies to commits and PRs).
