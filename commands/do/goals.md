---
description: Scan codebase to infer project goals and generate GOALS.md, or a detailed PRD.md with --prd (default: fully autonomous; use --interactive to review with user)
argument-hint: "[--prd] [--interactive] [--refresh] [focus hint, e.g. 'just the CLI']"
---

# Goals — Generate a GOALS.md or PRD.md from Codebase Analysis

Scan the codebase to infer the project's goals, purpose, and direction, then generate a comprehensive `GOALS.md` at the repo root — or, with `--prd`, a detailed `PRD.md` (Product Requirements Document) with functional and non-functional requirements, explicit exclusions, and acceptance criteria.

**Default mode: fully autonomous.** Scans, synthesizes, and writes the document without prompting. HIGH and MEDIUM confidence items are included; LOW confidence items are included but marked as inferred.

**`--prd` mode:** generate `PRD.md` instead of `GOALS.md`. Same discovery pipeline and autonomous default, but the synthesis and output are requirements-level rather than strategic — see [PRD.md Structure](#prdmd-structure---prd) below. `/do:prd` is shorthand for `/do:goals --prd`.

**`--interactive` mode:** pauses after synthesis to validate purpose, prioritize goals (or requirements), confirm non-goals, and refine wording with the user.

Parse `$ARGUMENTS` for:
- **`--prd`**: generate `PRD.md` instead of `GOALS.md`
- **`--interactive`**: pause after synthesis for user validation and refinement
- **`--refresh`**: re-scan and update the existing target document (`GOALS.md`, or `PRD.md` with `--prd`) rather than creating from scratch
- **Focus hints**: e.g., "focus on API goals", "just the CLI"

`--prd --refresh` re-scans and updates an existing `PRD.md`.

## Boundary Rule: GOALS.md vs PRD.md vs Issue Tracker

**GOALS.md is strategic. PRD.md is the requirements spec. The issue tracker (the project's tracker; GitHub/GitLab issues by default) is tactical.**

- GOALS.md answers: *Why does this project exist? What does success look like? What will we never do?*
- PRD.md answers: *What exactly must the product do, and not do? Who is it for? What counts as "it works"?*
- The issue tracker answers: *What are we building next? What's the backlog? What's done?*

**GOALS.md must NEVER contain:**
- Checkbox task lists (`- [ ] Add feature X`)
- Implementation details or subtasks
- Specific file paths, function names, or technical steps
- "Current State" progress tables (that's the issue tracker's job)
- Prioritized next-action lists

The [GOALS.md Structure](#goalsmd-structure-default) template below is the full spec for what it should contain.

Milestones describe what "done" looks like in outcome-oriented prose:
- GOOD: "v1.0 means daily entry takes under 30 seconds and APY calculations are auditable across all edge cases"
- BAD: "- [ ] Add date range buttons above charts / - [ ] Filter chart data to selected range"

**PRD.md must NEVER contain:**
- Checkbox task lists or sprint/iteration planning — that's the issue tracker's job
- Specific file paths, function names, or line-level implementation detail
- Vague, untestable statements ("the system should be fast") without a concrete acceptance criterion
- Fabricated numeric targets the codebase doesn't evidence — an unverifiable KPI belongs in Open Questions

The [PRD.md Structure](#prdmd-structure---prd) template below is the full spec for what it should contain.

Requirement statements use RFC-2119-style keywords — **MUST/SHALL** (mandatory), **SHOULD** (recommended), **MAY** (optional) — e.g. "The system MUST reject uploads over 25MB" rather than "uploads should be limited."

## Phase 1: Discovery

Gather signals about the project's purpose and intent. Launch these as parallel Explore agents:

### Agent 1: Identity & Purpose
Scan README, package manifest (`package.json`/`Cargo.toml`/`pyproject.toml`/`go.mod`), `CLAUDE.md`, `LICENSE`, and community files (`CONTRIBUTING.md`, `.github/FUNDING.yml`, `CODE_OF_CONDUCT.md`) for stated purpose, audience, and licensing/community intent — a capable model already knows to check these; nothing here changes what to extract.

Extract: project name, stated purpose, target audience, licensing model, community intent.

### Agent 2: Architecture & Capabilities
Scan entry points, exported APIs/CLI commands, config schemas, data models, and infra files (`Dockerfile`, CI/CD configs) for what the project actually does.

Extract: list of capabilities, deployment model, key domain concepts. **In `--prd` mode**, also enumerate each discrete feature/command/endpoint with its observed inputs, outputs, and error-handling behavior — this seeds functional requirements directly.

### Agent 3: Evolution & Direction
Scan recent git log, merged PR/MR history, open issues and PRs/MRs, `CHANGELOG.md`, `TODO`/`FIXME` comments, and feature branch names for trajectory signals.

Sample history broadly rather than just the last few commits: aim for 30-100 merged PR/MR titles and read 8-15 full bodies spread across the range (GitHub: `gh pr list --state merged --limit 100` and `gh pr view`; GitLab: `glab mr list --state merged` and `glab mr view`). Do not filter by the repository owner — organization accounts usually do not author their repositories' pull/merge requests. If that history is unavailable or empty, fall back to the default branch's commit history, filtering by the relevant maintainer when that identity is known.

Extract: recent themes, planned direction, known gaps, active work areas, and repeated decisions about what the project accepts or refuses. Do not infer a product requirement from a generic engineering practice or an isolated historical change.

### Agent 4 (`--prd` mode only): Requirements Mining
Scan test suites, input validation/error handling/guard clauses, auth/authz and rate-limiting logic, and config limits (timeouts, size caps, pagination) for behavior that's already been specified but never written down as a requirement. Reuse an existing `GOALS.md`'s Mission and Core Tenets as the PRD's Goals & Objectives rather than re-deriving them.

Extract: candidate functional, non-functional, and negative requirements (with source evidence), and contradictions between documented intent and observed behavior. Maintain a private evidence ledger mapping each candidate to one or more concrete signals (documentation, a passing test, an observed interface contract, validation/error path, or merged change) and its confidence — every requirement must carry evidence or be flagged an inference before it reaches the document.

Wait for all agents to complete (3 in default mode, 4 in `--prd` mode).

## Phase 2: Synthesis

Consolidate the Phase 1 findings into a draft matching the [GOALS.md Structure](#goalsmd-structure-default) (default) or [PRD.md Structure](#prdmd-structure---prd) (`--prd`) template below — those templates are the section-by-section spec; this phase doesn't restate their shape.

For each item, assign a confidence level:
- **HIGH** — directly stated in docs or clearly evidenced by code (or, in `--prd` mode, by a passing test)
- **MEDIUM** — strongly implied by patterns, architecture, or recent work
- **LOW** — inferred/speculative, needs user confirmation

In `--prd` mode, keep the evidence ledger until the document is written: every requirement MUST carry at least one evidence note or be explicitly labeled as an open question/inference. When evidence conflicts, record the conflict in Risks & Open Questions and prefer the most recent verified behavior for acceptance criteria.

## Phase 3: Validation

### Default Mode (autonomous)

Skip user clarification — every `3a`-`3j` subsection below is interactive-only and does not run. Include all HIGH and MEDIUM confidence items directly; include LOW confidence items marked `(inferred)`. In `--prd` mode, still run 3k's edge-case check silently (its own text covers the autonomous behavior: record each case as a risk/open question rather than asking). Proceed directly to Phase 4.

### Interactive Mode (`--interactive`)

Present the draft to the user and ask targeted questions to resolve uncertainty. Use `AskUserQuestion` for each area that needs input.

#### 3a: Purpose Validation
Show the inferred one-paragraph purpose statement. Ask if it's accurate or needs refinement.

#### 3b: Goal Prioritization
Present the inferred goals list. For each LOW or MEDIUM confidence goal, ask the user:
- Is this actually a goal?
- How would you rephrase it?
- What priority is it (primary, secondary, stretch)?

#### 3c: Missing Goals
Ask: "Are there any goals I missed that aren't yet reflected in the codebase?" If suggesting possibilities, ground them in a specific signal Discovery found (an unexercised code path, a README claim with no matching implementation) — never a generic pattern for this project's category.

#### 3d: Non-Goals Validation
Present the inferred non-goals. Ask: "Are these accurate? Anything to add or remove?"

#### 3e: Target Users
Present the inferred target user description. Ask if it's accurate.

#### 3f: Success Criteria (optional, GOALS.md mode)
Ask: "Would you like to define measurable success criteria for any of these goals?" Offer examples relevant to the project type (e.g., "support N concurrent users", "< Xms response time") — the user supplies the number, never a fabricated target.

#### 3g (`--prd` mode): Requirements Walkthrough
Present the grouped functional requirements. For each LOW or MEDIUM confidence requirement, confirm it's accurately scoped and correctly prioritized (Must/Should/May); ask if any requirements are missing from a feature area.

#### 3h (`--prd` mode): Negative Requirements & Guardrails
Present the inferred negative requirements. Ask: "Are these accurate? Is there any safety or security boundary the product must enforce that I missed?"

#### 3i (`--prd` mode): Success Metrics
For every KPI Discovery could not evidence with a concrete number, ask the user to supply a target rather than leaving it fabricated or blank.

#### 3j (`--prd` mode): Risks & Open Questions
Walk the user through every item in Risks & Open Questions and try to close it out:
- **Judgment calls and missing information** (scope, risk tolerance, product direction — anything only the user can decide) — ask with `AskUserQuestion`. A resolving answer is folded into the relevant PRD section (a KPI target into Success Metrics, a scope call into Out of Scope or Assumptions & Constraints, etc.) and dropped from Risks & Open Questions; otherwise keep it there, refined with whatever context they gave.
- **Purely factual items** verifiable from `gh`/`glab`, git history, or the filesystem (e.g. "is issue #N still open?") — check directly; ask only if the check is inconclusive.

#### 3k (`--prd` mode): Boundary Walkthrough
Test the draft against 3-5 concrete edge cases drawn from validation failures, explicit refusals, or ambiguous scope. For each, identify the requirement, negative requirement, or out-of-scope boundary it exercises, and ask the user about it only in `--interactive` mode. In autonomous mode, keep the case as a risk or open question unless the codebase provides decisive evidence. Do not invent KPI targets or turn these cases into implementation tasks.

## Phase 4: Document Generation

Generate the target document at the repo root.

### GOALS.md Structure (default)

```markdown
# GOALS.md

{Optional: tagline or one-sentence purpose}

---

## Mission

{One-paragraph expanded purpose statement explaining what the project is, why it exists, and the problem it solves.}

---

## Core Tenets

{Non-negotiable principles that guide every decision. Numbered list.}

1. **{Tenet}** - {Why it matters}
2. ...

---

## Milestones

### v1.0 - {Milestone Name}

{Outcome-oriented prose describing what this milestone means. What does "done" look like?
Write 3-5 bullet points as outcome descriptions, NOT checkbox task lists.
Example: "Engine correctness — every fund type produces accurate calculations across all edge cases."}

- **{Outcome area}** - {What success looks like in this area}
- ...

### v2.0 - {Milestone Name}

{Same format — outcomes, not tasks.}

---

## Long-Term Vision

{Aspirational direction in prose. What does the ultimate success state look like?}

---

## Non-Goals

{Explicit boundaries — things this project intentionally does NOT do.}

- **{Non-goal}** - {Why this is out of scope}
- ...

---

For the tactical backlog and current work items, see the repository's open issues.
```

The template intentionally omits "Current State" tables and "Direction" sections — those belong in the issue tracker. If the user asks for them, add a brief (1-2 sentence) summary that points to the tracker rather than duplicating the detail.

### PRD.md Structure (`--prd`)

```markdown
# PRD.md — {Project Name}

{Optional: one-sentence tagline}

---

## Overview

{One-paragraph problem statement: what the product is, the problem it solves, and for whom.}

---

## Goals & Objectives

{3-7 objectives. If GOALS.md exists, align these with its Core Tenets rather than restating them differently.}

1. **{Objective}** - {measurable or observable definition of success}
2. ...

---

## Target Users / Personas

### {Persona name/role}
- **Needs:** {what they're trying to accomplish}
- **Context:** {when/how they use the product}

{Repeat per primary user type.}

---

## Functional Requirements

### {Feature Area}

| ID | Requirement | Priority | Confidence | Evidence | Acceptance Criteria |
|---|---|---|---|---|---|
| FR-1 | The system MUST {behavior} | Must | High | {passing test, documented contract, or observed behavior} | {testable condition} |
| FR-2 | The system SHOULD {behavior} | Should | Medium | {source signal or "inferred"} | {testable condition} |

{Repeat per feature area. IDs are sequential and never reused across the whole document.}

---

## Non-Functional Requirements

| ID | Category | Requirement | Confidence | Evidence |
|---|---|---|---|---|
| NFR-1 | Performance | {requirement} | High | {source signal or open question} |
| NFR-2 | Security | {requirement} | Medium | {source signal or open question} |

---

## Negative Requirements

{Explicit things the system MUST NOT do.}

| ID | Requirement | Confidence | Evidence / Why |
|---|---|---|---|
| NR-1 | The system MUST NOT {behavior} | High | {source signal and rationale - safety, security, or deliberate scope boundary} |

---

## Out of Scope

{Capabilities intentionally excluded from this version.}

| Excluded capability | Reason | Evidence / Signal |
|---|---|---|
| {Excluded capability} | {why it's excluded or deferred} | {supporting signal, or "inferred" when no direct evidence exists} |

---

## Assumptions & Constraints

- {Assumption or constraint}

---

## Success Metrics

- {Metric} - {target, if evidenced; otherwise "open question — no target set yet"}

---

## Risks & Open Questions

- {Risk or open question}

---

{Footer: link to [GOALS.md](./GOALS.md) if it exists, and the repository's open issues for the tactical backlog.}
```

Requirement IDs (`FR-`, `NFR-`, `NR-`) are assigned sequentially at generation time and are **stable across `--refresh` runs** — an existing ID must never be reassigned to a different requirement. New requirements append the next unused number per prefix; a requirement that no longer holds retires its number rather than having it reused.

### Refresh Mode (`--refresh`)

If `--refresh` was passed and the target document already exists:
1. Read the existing document
2. Treat it as the approved baseline: compare its content and evidence notes against the current codebase and history
3. Identify items whose status has changed (new progress, completed, abandoned — or, in `--prd` mode, requirements that no longer hold, or new behavior not yet captured)
4. **Default mode**: update in-place, preserving user-written content and stable requirement IDs where possible; print a summary of what changed and which evidence caused each change.
   **Interactive mode (`--interactive`)**: present changes for confirmation before updating.
5. **GOALS.md mode**: remove any checkbox task lists found in the existing GOALS.md and file each item as a tracker issue automatically (default) or after confirmation (interactive): detect the host from the `origin` remote per [lib/vcs-host.md](../../lib/vcs-host.md), skip items that duplicate an open issue title, and label each with the saved `issues-label` default (or `plan`) — `gh issue create --title "<item>" --body "<context>" --label <label>` (glab: `glab issue create --title "<item>" --description "<context>" --label <label>`). If no authenticated `gh`/`glab` can reach the repo, list the items in the Phase 5 summary under "Tactical items (not filed — no issue tracker available)" instead. Never write them to PLAN.md.
6. **PRD.md mode**: preserve existing `FR-`/`NFR-`/`NR-` IDs for requirements that still hold; assign the next unused ID (per prefix) to new ones. If a requirement no longer appears to hold, mark it `(status: removed — verify)` in place rather than deleting it, and call it out in the change summary.
7. **PRD.md mode**: do not replace a user-authored requirement with a semantically different inference merely because current code is incomplete. Mark the conflict in the evidence notes and Risks & Open Questions, retaining the baseline wording until resolved.

## Phase 5: Finalize

1. Write the target document (`GOALS.md`, or `PRD.md` in `--prd` mode) to the repo root
2. **GOALS.md mode**: if checkbox task lists were moved out of GOALS.md during `--refresh`, list the issues filed for them (or the unfiled items) in the summary
3. Print a summary — checkbox migration under `--refresh` already happened per Refresh Mode step 5, so this just reports the result:

   GOALS.md mode:
   ```
   GOALS.md {created|updated} with:
   - {N} core tenets
   - {M} milestones (outcome-oriented)
   - {K} non-goals
   ```

   PRD.md mode:
   ```
   PRD.md {created|updated} with:
   - {N} functional requirements
   - {M} non-functional requirements
   - {K} negative requirements
   - {J} open questions
   ```
4. Do NOT commit — let the user review and commit when ready (suggest `/do:push`)

## Notes

- Project-agnostic — reads whatever project signals exist
- `/do:prd` is shorthand for `/do:goals --prd`
- Preserve the user's voice — if they provide rephrased goals or requirements, use their wording verbatim
- If the project is brand new with minimal code, lean more heavily on user input and less on codebase inference
- If `gh`/`glab` is not authenticated, skip issue/PR scanning gracefully — don't halt
- **Never put checkbox task lists in GOALS.md or PRD.md** — tactical items belong in the issue tracker; never create or write PLAN.md
- **In `--prd` mode, never present an unsupported inference as an observed requirement** — include the evidence note and confidence, or place it in Risks & Open Questions
