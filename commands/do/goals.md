---
description: Scan codebase to infer project goals and generate GOALS.md, or a detailed PRD.md with --prd (default: fully autonomous; use --interactive to review with user)
argument-hint: "[--prd] [--interactive] [--refresh] [focus hint, e.g. 'just the CLI']"
---

# Goals — Generate a GOALS.md or PRD.md from Codebase Analysis

Scan the codebase to infer the project's goals, purpose, and direction, then generate a comprehensive `GOALS.md` at the repo root — or, with `--prd`, a detailed `PRD.md` (Product Requirements Document) with functional and non-functional requirements, explicit exclusions, and acceptance criteria.

**Default mode: fully autonomous.** Scans the codebase, synthesizes goals (or requirements, in `--prd` mode), and writes the document without prompting. HIGH and MEDIUM confidence items are included; LOW confidence items are included but marked as inferred.

**`--prd` mode:** generate `PRD.md` instead of `GOALS.md`. Same discovery pipeline, same autonomous-by-default behavior, but the synthesis and output are requirements-level rather than strategic — see [PRD.md Structure](#prdmd-structure---prd) below. `/do:prd` is shorthand for `/do:goals --prd`.

**`--interactive` mode:** Pauses after synthesis to validate purpose, prioritize goals (or requirements), confirm non-goals, and refine wording with the user.

Parse `$ARGUMENTS` for:
- **`--prd`**: generate `PRD.md` (a detailed product requirements document) instead of `GOALS.md`
- **`--interactive`**: pause after synthesis for user validation and refinement
- **`--refresh`**: re-scan and update the existing target document (`GOALS.md`, or `PRD.md` when combined with `--prd`) rather than creating from scratch
- **Focus hints**: e.g., "focus on API goals", "just the CLI"

`--prd` and `--refresh` combine normally: `--prd --refresh` re-scans and updates an existing `PRD.md`.

## Boundary Rule: GOALS.md vs PRD.md vs PLAN.md

**GOALS.md is strategic. PRD.md is the requirements spec. PLAN.md is tactical.**

- GOALS.md answers: *Why does this project exist? What does success look like? What will we never do?*
- PRD.md answers: *What exactly must the product do, and not do? Who is it for? What counts as "it works"?*
- PLAN.md answers: *What are we building next? What's the backlog? What's done?*

**GOALS.md must NEVER contain:**
- Checkbox task lists (`- [ ] Add feature X`)
- Implementation details or subtasks
- Specific file paths, function names, or technical steps
- "Current State" progress tables (that's PLAN.md's job)
- Prioritized next-action lists

**GOALS.md SHOULD contain:**
- Mission and purpose (why this exists)
- Core principles/tenets (non-negotiable design constraints)
- Milestone definitions as **outcome descriptions** (what success looks like in prose, not task lists)
- Non-goals (explicit boundaries)
- Long-term vision (aspirational direction)
- A footer link to PLAN.md for tactical details

When milestones describe what "done" looks like, write outcome-oriented prose:
- GOOD: "v1.0 means daily entry takes under 30 seconds and APY calculations are auditable across all edge cases"
- BAD: "- [ ] Add date range buttons above charts / - [ ] Filter chart data to selected range"

**PRD.md must NEVER contain:**
- Checkbox task lists or sprint/iteration planning — that's PLAN.md's job
- Specific file paths, function names, or line-level implementation detail
- Vague, untestable statements ("the system should be fast") without a concrete acceptance criterion
- Fabricated numeric targets the codebase doesn't evidence — an unverifiable KPI belongs in Open Questions, not stated as fact

**PRD.md SHOULD contain:**
- Overview & problem statement
- Goals & objectives (aligned with GOALS.md's Core Tenets when a GOALS.md exists)
- Target users / personas
- Functional requirements — discrete, testable statements grouped by feature area, each with a stable ID, a MUST/SHOULD/MAY priority, and acceptance criteria
- Non-functional requirements — performance, security, reliability, usability, compatibility/scalability
- Negative requirements — explicit things the system MUST NOT do (safety/security guardrails, deliberately unsupported behavior)
- Out of scope — capabilities intentionally excluded from this version
- Assumptions & constraints
- Success metrics / KPIs
- Risks & open questions
- A footer link to GOALS.md (if present) and PLAN.md

Requirement statements use RFC-2119-style keywords — **MUST/SHALL** (mandatory), **SHOULD** (recommended), **MAY** (optional) — e.g. "The system MUST reject uploads over 25MB" rather than "uploads should be limited."

## Phase 1: Discovery

Gather signals about the project's purpose and intent from multiple sources. Launch these as parallel Explore agents:

### Agent 1: Identity & Purpose
Scan for project identity signals:
- `README.md`, `README.*` — project description, tagline, stated purpose
- `package.json` / `Cargo.toml` / `pyproject.toml` / `go.mod` — name, description, keywords, repository URL
- `CLAUDE.md` — design principles, conventions, stated goals
- `PLAN.md` — planned work, roadmap items, in-progress features
- `LICENSE` — licensing intent (open source, proprietary, etc.)
- `.github/FUNDING.yml`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` — community/ecosystem intent
- Marketing or landing page content if present

Extract: project name, stated purpose, target audience, licensing model, community intent.

### Agent 2: Architecture & Capabilities
Scan for what the project actually does:
- Entry points (`main.*`, `index.*`, `app.*`, `cli.*`, `server.*`, binary targets)
- Exported public APIs, routes, endpoints, CLI commands
- Configuration schemas and environment variables
- Database schemas/migrations — what data is modeled
- Key domain types/interfaces — what concepts exist
- Infrastructure files (`Dockerfile`, `docker-compose.*`, CI/CD configs, deploy scripts)

Extract: list of capabilities, deployment model, key domain concepts. **In `--prd` mode**, also enumerate each discrete feature/command/endpoint with its observed inputs, outputs, and error-handling behavior — this seeds functional requirements directly.

### Agent 3: Evolution & Direction
Scan for trajectory signals:
- Recent git log (last 30 commits): `git log --oneline -30`
- Open issues (if available): `gh issue list --limit 20 --state open 2>/dev/null`
- Open PRs: `gh pr list --limit 10 --state open 2>/dev/null`
- `CHANGELOG.md` or `.changelog/` — recent changes and themes
- `TODO` / `FIXME` / `HACK` comments in source
- `PLAN.md` — incomplete items represent intended direction
- Branch names: `git branch -a --list '*feature*' --list '*feat*' 2>/dev/null`

Extract: recent themes, planned direction, known gaps, active work areas.

### Agent 4 (`--prd` mode only): Requirements Mining
Scan for behavior that's already been specified, even if never written down as a requirement:
- Test suites / spec files — encode expected behavior (positive cases) and expected rejections (negative cases) with high confidence, since they're executable
- Input validation, error handling, and guard clauses — encode implicit requirements ("must reject X")
- Auth/authz, rate limiting, and other security-relevant logic — seeds non-functional and negative requirements
- Config schemas, env vars, and documented limits (timeouts, size caps, pagination) — seeds non-functional requirements
- An existing `GOALS.md`, if present — reuse its Mission and Core Tenets as the PRD's Goals & Objectives rather than re-deriving them from scratch

Extract: candidate functional requirements (with source evidence), candidate non-functional requirements, candidate negative requirements.

Wait for all agents to complete (3 in default mode, 4 in `--prd` mode).

## Phase 2: Synthesis

### GOALS.md Mode (default)

Consolidate the findings into a draft goals structure:

1. **Project Purpose** — one-paragraph summary of what this project is and why it exists
2. **Core Goals / Tenets** — the 3-7 primary objectives or non-negotiable principles
3. **Milestones** — outcome-oriented descriptions of what each version milestone means (NOT checkbox task lists — those go in PLAN.md)
4. **Non-Goals** — things the project explicitly does NOT aim to do (inferred from architectural boundaries, missing features that seem intentional, stated constraints)
5. **Target Users** — who this is for (inferred from README, API design, CLI UX, documentation tone)
6. **Long-Term Vision** — aspirational direction in prose

### PRD.md Mode (`--prd`)

Consolidate the findings into a draft requirements structure:

1. **Overview & Problem Statement** — one paragraph: what the product is, the problem it solves, and for whom
2. **Goals & Objectives** — 3-7 objectives; reuse GOALS.md's Core Tenets verbatim where a GOALS.md exists rather than re-deriving them
3. **Target Users / Personas** — one short persona per primary user type (role, need, context of use)
4. **Functional Requirements** — grouped by feature area; each requirement gets a stable ID (`FR-1`, `FR-2`, ...), a MUST/SHOULD/MAY keyword, a one-sentence statement, and testable acceptance criteria
5. **Non-Functional Requirements** — same ID scheme (`NFR-1`, ...), covering performance, security, reliability, usability, and compatibility/scalability as applicable to the project
6. **Negative Requirements** — explicit "MUST NOT" statements (`NR-1`, ...) for safety/security guardrails and deliberately unsupported behavior
7. **Out of Scope** — capabilities intentionally excluded from this version, with a one-line reason each
8. **Assumptions & Constraints** — technical, business, or resourcing constraints taken as given
9. **Success Metrics / KPIs** — measurable criteria for "this product is working"; only state a concrete number where Discovery found evidence for one, otherwise list it under Open Questions rather than inventing a target
10. **Risks & Open Questions** — known unknowns and decisions still needed

Both modes: for each item, assign a confidence level:
- **HIGH** — directly stated in docs or clearly evidenced by code (or, in `--prd` mode, by a passing test)
- **MEDIUM** — strongly implied by patterns, architecture, or recent work
- **LOW** — inferred/speculative, needs user confirmation

## Phase 3: Validation

### Default Mode (autonomous)

Skip user clarification. Include all HIGH and MEDIUM confidence items directly. Include LOW confidence items but mark them with `(inferred)` so the user can review after generation. Proceed directly to Phase 4.

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
Ask: "Are there any goals I missed that aren't yet reflected in the codebase?" Present 2-3 suggested possibilities based on common patterns for this type of project, to prompt the user's thinking.

#### 3d: Non-Goals Validation
Present the inferred non-goals. Ask: "Are these accurate? Anything to add or remove?"

#### 3e: Target Users
Present the inferred target user description. Ask if it's accurate.

#### 3f: Success Criteria (optional, GOALS.md mode)
Ask: "Would you like to define measurable success criteria for any of these goals?" Offer examples relevant to the project type (e.g., "support N concurrent users", "< Xms response time", "100% test coverage on core module").

#### 3g (`--prd` mode): Requirements Walkthrough
Present the grouped functional requirements. For each LOW or MEDIUM confidence requirement, confirm it's accurately scoped and correctly prioritized (Must/Should/May); ask if any requirements are missing from a feature area.

#### 3h (`--prd` mode): Negative Requirements & Guardrails
Present the inferred negative requirements. Ask: "Are these accurate? Is there any safety or security boundary the product must enforce that I missed?"

#### 3i (`--prd` mode): Success Metrics
For every KPI Discovery could not evidence with a concrete number, ask the user to supply a target rather than leaving it fabricated or blank.

#### 3j (`--prd` mode): Risks & Open Questions
Before writing the document, walk the user through every item synthesized into Risks & Open Questions and try to close it out rather than shipping it open by default:
- **Judgment calls and missing information** (scope decisions, risk tolerance, product direction, anything only the user can decide) — ask with `AskUserQuestion`. If the user's answer resolves the question, fold it directly into the relevant PRD section (a resolved KPI target goes into Success Metrics, a scope call updates Out of Scope or Assumptions & Constraints, etc.) and drop it from Risks & Open Questions. If the user has no answer or wants it left open, keep it in Risks & Open Questions, refined with whatever context they gave.
- **Purely factual items** verifiable from `gh`/`glab`, git history, or the filesystem (e.g. "is issue #N still open?") — check directly instead of asking the user; only fall back to asking if the check is inconclusive (tool unavailable, ambiguous result).

## Phase 4: Document Generation

Using the validated and refined information, generate the target document at the repo root.

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

For the tactical backlog and current work items, see [PLAN.md](./PLAN.md).
```

**Important:** The template above intentionally omits "Current State" tables and "Direction" sections — those are tactical concerns that belong in PLAN.md. If the user asks for them, add a brief (1-2 sentence) summary that points to PLAN.md rather than duplicating the detail.

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

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---|---|
| FR-1 | The system MUST {behavior} | Must | {testable condition} |
| FR-2 | The system SHOULD {behavior} | Should | {testable condition} |

{Repeat per feature area. IDs are sequential and never reused across the whole document.}

---

## Non-Functional Requirements

| ID | Category | Requirement |
|---|---|---|
| NFR-1 | Performance | {requirement} |
| NFR-2 | Security | {requirement} |

---

## Negative Requirements

{Explicit things the system MUST NOT do.}

| ID | Requirement | Why |
|---|---|---|
| NR-1 | The system MUST NOT {behavior} | {rationale - safety, security, or deliberate scope boundary} |

---

## Out of Scope

{Capabilities intentionally excluded from this version.}

- **{Excluded capability}** - {why it's excluded or deferred}

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

{Footer: link to [GOALS.md](./GOALS.md) if it exists, and [PLAN.md](./PLAN.md) for the tactical backlog.}
```

Requirement IDs (`FR-`, `NFR-`, `NR-`) are assigned sequentially at generation time and are **stable across `--refresh` runs** — an existing ID must never be reassigned to a different requirement. New requirements append the next unused number per prefix; a requirement that no longer holds retires its number rather than having it reused.

### Refresh Mode (`--refresh`)

If `--refresh` was passed and the target document already exists:
1. Read the existing document
2. Compare its content against the current codebase state
3. Identify items whose status has changed (new progress, completed, abandoned — or, in `--prd` mode, requirements that no longer hold, or new behavior that isn't yet captured as a requirement)
4. **Default mode**: Update the document in-place automatically, preserving user-written content where possible. Print a summary of what changed.
   **Interactive mode (`--interactive`)**: Present changes to the user for confirmation before updating.
5. **GOALS.md mode**: If any checkbox task lists are found in the existing GOALS.md, move them to PLAN.md automatically (default) or offer to move them (interactive). When inserting each item into PLAN.md, **assign it a unique `[<slug>]` ID** per [lib/plan-id-format.md](../../lib/plan-id-format.md): kebab-case slug derived from the item title, ≤50 chars, unique against every existing `[slug]` in PLAN.md.
6. **PRD.md mode**: Preserve existing `FR-`/`NFR-`/`NR-` IDs for requirements that still hold. Assign the next unused ID (per prefix) to newly discovered requirements. If a requirement no longer appears to hold, mark it `(status: removed — verify)` in place rather than silently deleting it, and call it out in the change summary for the user to confirm.

## Phase 5: Finalize

1. Write the target document (`GOALS.md`, or `PRD.md` in `--prd` mode) to the repo root
2. If `PLAN.md` exists, ensure it has a reference link to the generated document (only if not already present)
3. **GOALS.md mode**: if checkbox task lists were found in an existing GOALS.md during `--refresh`, offer to migrate them to PLAN.md
4. Print a summary:

   GOALS.md mode:
   ```
   GOALS.md created with:
   - {N} core tenets
   - {M} milestones (outcome-oriented)
   - {K} non-goals
   ```

   PRD.md mode:
   ```
   PRD.md created with:
   - {N} functional requirements
   - {M} non-functional requirements
   - {K} negative requirements
   - {J} open questions
   ```
5. Do NOT commit — let the user review and commit when ready (suggest using `/do:push` to commit)

## Notes

- This command is project-agnostic — it reads whatever project signals exist
- `/do:prd` is shorthand for `/do:goals --prd`
- In default mode, scan and generate autonomously; in interactive mode, collaborate with the user
- LOW confidence inferences are included as `(inferred)` in default mode; validated with the user in interactive mode
- Preserve the user's voice — if they provide rephrased goals or requirements, use their wording verbatim
- If the project is brand new with minimal code, lean more heavily on user input and less on codebase inference
- If `gh` CLI is not authenticated, skip issue/PR scanning gracefully — don't halt
- **Never put checkbox task lists in GOALS.md or PRD.md** — if you discover tactical items during scanning, note them for PLAN.md but keep them out of both
- **In `--prd` mode, never fabricate numeric success metrics or KPIs** the codebase doesn't evidence — leave them as open questions, even in autonomous mode
