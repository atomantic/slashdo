---
description: Scan codebase to infer project goals, clarify with user, and generate GOALS.md
argument-hint: "[--refresh] [focus hint, e.g. 'just the CLI']"
---

# MakeGoals — Generate a GOALS.md from Codebase Analysis

Scan the codebase to infer the project's goals, purpose, and direction, then collaborate with the user to produce a comprehensive `GOALS.md` at the repo root.

Parse `$ARGUMENTS` for:
- **`--refresh`**: re-scan and update an existing GOALS.md rather than creating from scratch
- **Focus hints**: e.g., "focus on API goals", "just the CLI"

## Boundary Rule: GOALS.md vs PLAN.md

**GOALS.md is strategic. PLAN.md is tactical.**

GOALS.md answers: *Why does this project exist? What does success look like? What will we never do?*
PLAN.md answers: *What are we building next? What's the backlog? What's done?*

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

Extract: list of capabilities, deployment model, key domain concepts.

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

Wait for all agents to complete.

## Phase 2: Synthesis

Consolidate the findings into a draft goals structure:

1. **Project Purpose** — one-paragraph summary of what this project is and why it exists
2. **Core Goals / Tenets** — the 3-7 primary objectives or non-negotiable principles
3. **Milestones** — outcome-oriented descriptions of what each version milestone means (NOT checkbox task lists — those go in PLAN.md)
4. **Non-Goals** — things the project explicitly does NOT aim to do (inferred from architectural boundaries, missing features that seem intentional, stated constraints)
5. **Target Users** — who this is for (inferred from README, API design, CLI UX, documentation tone)
6. **Long-Term Vision** — aspirational direction in prose

For each goal, assign a confidence level:
- **HIGH** — directly stated in docs or clearly evidenced by code
- **MEDIUM** — strongly implied by patterns, architecture, or recent work
- **LOW** — inferred/speculative, needs user confirmation

## Phase 3: User Clarification

Present the draft to the user and ask targeted questions to resolve uncertainty. Use `AskUserQuestion` for each area that needs input.

### 3a: Purpose Validation
Show the inferred one-paragraph purpose statement. Ask if it's accurate or needs refinement.

### 3b: Goal Prioritization
Present the inferred goals list. For each LOW or MEDIUM confidence goal, ask the user:
- Is this actually a goal?
- How would you rephrase it?
- What priority is it (primary, secondary, stretch)?

### 3c: Missing Goals
Ask: "Are there any goals I missed that aren't yet reflected in the codebase?" Present 2-3 suggested possibilities based on common patterns for this type of project, to prompt the user's thinking.

### 3d: Non-Goals Validation
Present the inferred non-goals. Ask: "Are these accurate? Anything to add or remove?"

### 3e: Target Users
Present the inferred target user description. Ask if it's accurate.

### 3f: Success Criteria (optional)
Ask: "Would you like to define measurable success criteria for any of these goals?" Offer examples relevant to the project type (e.g., "support N concurrent users", "< Xms response time", "100% test coverage on core module").

## Phase 4: Document Generation

Using the validated and refined information, generate `GOALS.md` at the repo root.

### Document Structure

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

### Refresh Mode (`--refresh`)

If `--refresh` was passed and `GOALS.md` already exists:
1. Read the existing `GOALS.md`
2. Compare existing goals against current codebase state
3. Identify goals whose status has changed (new progress, completed, abandoned)
4. Present changes to the user for confirmation
5. Update the document in-place, preserving user-written content where possible
6. If any checkbox task lists are found in the existing GOALS.md, flag them and offer to move them to PLAN.md

## Phase 5: Finalize

1. Write the `GOALS.md` file to the repo root
2. If `PLAN.md` exists, ensure it has a reference link to GOALS.md (only if not already present)
3. If checkbox task lists were found in an existing GOALS.md during `--refresh`, offer to migrate them to PLAN.md
4. Print a summary:
   ```
   GOALS.md created with:
   - {N} core tenets
   - {M} milestones (outcome-oriented)
   - {K} non-goals
   ```
5. Do NOT commit — let the user review and commit when ready (suggest using `/cam` to commit)

## Notes

- This command is project-agnostic — it reads whatever project signals exist
- The goal is collaboration: scan first, then refine with the user — never assume
- LOW confidence inferences should always be validated with the user before inclusion
- Preserve the user's voice — if they provide rephrased goals, use their wording verbatim
- If the project is brand new with minimal code, lean more heavily on user input and less on codebase inference
- If `gh` CLI is not authenticated, skip issue/PR scanning gracefully — don't halt
- **Never put checkbox task lists in GOALS.md** — if you discover tactical items during scanning, note them for PLAN.md but keep them out of GOALS.md
