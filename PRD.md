# PRD.md — slashdo

Curated slash commands for AI coding assistants — one install, multiple environments, one source of truth.

---

## Overview

slashdo (npm package `slash-do`) is a curated library of slash commands that automates the software development lifecycle for AI coding assistants. Developers using Claude Code, OpenCode, Antigravity CLI, Codex, or Grok Build each need consistent DevSecOps, code-review, planning, and release-management workflows — but hand-authoring bespoke prompt files per assistant duplicates effort and drifts out of sync across environments and across projects. slashdo solves this with a single source-of-truth command library, transformed automatically into each environment's native format and installed with one command (`npx slash-do@latest`), so a project gets the same audited, production-grade workflows regardless of which assistant a given contributor uses.

---

## Goals & Objectives

Aligned with [GOALS.md](./GOALS.md)'s Core Goals:

1. **Multi-environment support** — a single source of truth for commands that works across Claude Code, OpenCode, Antigravity CLI, Codex, and Grok Build, each in its native format with zero manual conversion.
2. **Automate DevSecOps workflows** — one-command security auditing, code-quality analysis, and automated remediation via isolated worktrees and per-category PRs.
3. **Standardize development rituals** — consistent commit practices, SemVer versioning, and changelog management across projects.
4. **Orchestrate AI-powered code review** — multi-reviewer review loops with automated thread resolution folded into the PR workflow.
5. **Maintain project governance documentation** — keep GOALS.md, PRD.md, and PLAN.md current and well-structured via dedicated commands.
6. **Be project-agnostic** — auto-detect tech stacks and adapt build/test/versioning/audit strategies without manual configuration.
7. **Frictionless distribution** — npm-based install with semver versioning and self-update notifications; no git cloning required.

---

## Target Users / Personas

### Individual developer using an AI coding assistant
- **Needs:** wants DevSecOps audits, PR creation, and review-loop orchestration automated inside their daily assistant workflow instead of hand-rolled scripts or manual review.
- **Context:** works primarily in one assistant (most often Claude Code) on one or a few repos; installs via `npx slash-do@latest` and drives everything through `/do:*` commands.

### Engineering lead standardizing practices across a team
- **Needs:** wants every repo and every contributor to follow the same commit, review, and release rituals regardless of which AI assistant an individual prefers.
- **Context:** cares about `/do:config` saved defaults, consistent SemVer/changelog discipline, and governance docs (GOALS.md/PRD.md/PLAN.md) staying current without manual upkeep.

### Multi-assistant / tool-agnostic user
- **Needs:** switches between Claude Code, OpenCode, Antigravity CLI, Codex, and Grok Build across projects or teammates, and needs commands to behave identically everywhere.
- **Context:** relies on slashdo's per-environment transformation (subdirectory / flat / Agent-Skills-directory layouts) rather than maintaining separate prompt libraries per tool.

---

## Functional Requirements

### Installation & Environment Support

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---|---|
| FR-1 | The system MUST detect which supported environments (Claude Code, OpenCode, Antigravity CLI, Codex, Grok Build) are already configured on the host and install into all detected environments when `--env` is omitted. | Must | Running `npx slash-do@latest` with no flags on a host with only `~/.claude` present installs only into `~/.claude/commands/`. |
| FR-2 | The system MUST support installing into an explicit subset of environments via `--env <envs>` (comma-separated, case-insensitive, trimmed), including the aliases `gemini`/`agy` → `antigravity`. | Must | `--env CLAUDE,agy` installs into the claude and antigravity targets only. |
| FR-3 | The system MUST support installing/uninstalling a filtered subset of commands by name, accepting both bare (`push`) and `do:`-prefixed (`do:push`) forms. | Must | `npx slash-do@latest push pr` installs only the push and pr commands. |
| FR-4 | The system MUST transform each source command file into the native format of its target environment — subdirectory layout for Claude Code, flat `do-<name>.md` for OpenCode, directory-per-skill (`SKILL.md`) for Antigravity/Codex/Grok — without per-environment hand-authoring. | Must | A single source file in `commands/do/` produces a correctly formatted, working command/skill file in every installed environment. |
| FR-5 | For environments without `!cat` file-inclusion support, the system MUST make every referenced `lib/*.md` reachable — inlining content into the transformed command file (recursively, with cycle termination), or, for a mutually-exclusive lib the run selects at most one of, writing it into the skill's own `lib/` directory and citing it by a relative path the agent reads on demand. Neither may leave a broken path reference. | Must | No dangling `~/.claude/lib/<name>.md` references appear in Agent Skills output, even when the referenced file is missing; every `lib/<name>.md` cited in a SKILL.md resolves to a file installed beside it. |
| FR-6 | Re-running install MUST be idempotent — unchanged files report up to date, changed files are updated in place, and hooks/config are not duplicated. | Must | Two consecutive installs with no source changes report 0 updates on the second run. |
| FR-7 | `--dry-run` MUST preview changes without writing, creating, or deleting any file, directory, hook registration, or config entry. | Must | A dry-run install on a clean host leaves the filesystem byte-for-byte unchanged. |
| FR-8 | `--list` MUST show all commands and their install status per environment without making changes. | Must | Output lists every command with an installed/not-installed/outdated status per detected environment. |
| FR-9 | `--uninstall` MUST remove installed commands, lib files, the version file, and the update-check cache for the targeted environment(s), and MUST clean up legacy/renamed command files (e.g. `cam.md`, `good.md`) left by older installs. | Must | After uninstall, none of the removed files remain in the target commands directory. |
| FR-10 | On Claude Code, install MUST register a SessionStart hook and status-line entry in `settings.json`, preserving any pre-existing user status-line configuration, and MUST reverse that registration cleanly on uninstall. | Must | Uninstall restores `settings.json` to its pre-install statusLine state. |

### Configuration (`/do:config`)

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---|---|
| FR-11 | The system MUST persist user-set defaults (e.g. `review-with`, `merge`, `autoUpdate`) to a per-environment config file and make them available to commands without the flag being re-specified each time. | Must | Setting `review-with` once via `/do:config` causes `/do:pr` to use it on a later run with no flag passed. |
| FR-12 | Saved config MUST survive a filtered (single-command) uninstall — only a full uninstall or explicit reset clears it. | Must | Uninstalling just `push` leaves `.slashdo-config.json` intact. |
| FR-13 | Config values MUST round-trip complex reviewer syntax verbatim (bracket groups, `~opt`, `~max=<n>`, `~effort=<level>`, `@login[bot]`). | Should | A saved `review-with` value with brackets, `~max=3`, and `~effort=max` reads back identical to what was written. |

### Self-Update

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---|---|
| FR-14 | The system MUST check the installed version against the latest published npm version and notify the user when an update is available, without blocking normal operation past a bounded timeout. | Must | The CLI completes normally even if the version-check network call stalls (see NFR-3). |
| FR-15 | Version comparison MUST correctly classify major/minor/patch bumps and accept `v`-prefixed version strings. | Must | `v3.27.0` → `3.28.0` classifies as a minor bump. |

### Command Library (`do:*` commands)

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---|---|
| FR-16 | The system MUST provide `/do:goals`, which scans the codebase and generates a strategic `GOALS.md`, and, via `--prd` (or the `/do:prd` shorthand), a detailed requirements-level `PRD.md`. | Must | Running `/do:prd` on a repo with no existing PRD.md produces one with functional/non-functional/negative requirement sections. |
| FR-17 | The system MUST provide `/do:pr`, which commits, pushes, and opens a PR/MR against the repo's default branch, deriving the push destination from the branch's configured upstream (`branch.<name>.remote`/`.merge`) rather than assuming `origin`/`HEAD`. | Must | On a branch tracking a fork remote, `/do:pr` pushes to that fork, not `origin`. |
| FR-18 | The system MUST provide a multi-reviewer review loop (`--review-with`) that classifies each reviewer's output into a fixed status vocabulary (clean/capped/no-verdict/guardrail/cli-error/push-failed/...) and blocks merge on any non-clean status not explicitly exempted. | Must | A reviewer returning an unparseable verdict blocks merge rather than being treated as clean. |
| FR-19 | The system MUST provide `/do:better` (and the structurally narrowed `/do:simplify`) for multi-agent DevSecOps/refactor auditing, remediation in an isolated worktree, and per-category PR creation. | Must | `/do:simplify` produces refactor-only PRs with the existing test suite passing unmodified. |
| FR-20 | The system MUST provide `/do:next` (including `--swarm`) to claim and ship PLAN.md items or tracker issues via isolated worktrees. | Must | `/do:next --swarm` ships more than one independent issue in a single run without branch collisions. |
| FR-21 | The system MUST provide `/do:replan` and `/do:plan-task` to keep the tactical backlog (PLAN.md or the issue tracker) current. | Should | `/do:replan --issues` prunes closed items from the tracked `plan`-labeled issue set. |
| FR-22 | The system MUST provide `/do:help`, listing every installed command with a one-line description and a check for available updates. | Must | `/do:help` output includes every file present in `commands/do/`. |

### CLI Interface

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---|---|
| FR-23 | `bin/cli.js` MUST support `--help`/`-h`, `--list`, `--dry-run`, `--uninstall`, `--env`, `--auto-update`/`--no-auto-update`, and positional command-name filters, usable in any combination. | Must | `--env claude --dry-run push` runs a scoped, non-mutating preview. |

---

## Non-Functional Requirements

| ID | Category | Requirement |
|---|---|---|
| NFR-1 | Reliability | Config and settings reads/writes MUST tolerate corrupted or malformed JSON without throwing — install/uninstall skip registration and leave the file untouched rather than crashing. |
| NFR-2 | Reliability | Hook registration MUST tolerate malformed existing `SessionStart` entries (null, string, number, non-array) without throwing. |
| NFR-3 | Performance | The update-check network call MUST be bounded by a timeout (3000ms default) so a slow or unreachable registry never blocks the CLI. |
| NFR-4 | Reliability | `--dry-run` MUST be a strict no-op, verified by tests asserting zero filesystem/config mutation. |
| NFR-5 | Portability | `install.sh`/`uninstall.sh` MUST remain compatible with bash 3.2 (stock macOS) under `set -u`, using guarded array expansions. |
| NFR-6 | Reliability | Long-running reviewer invocations MUST run in the background/poll rather than block the foreground past the host's execution cap (~10 minutes). |
| NFR-7 | Compatibility | The CLI MUST run on Node.js >=18 and is verified in CI across Node 18/20/22. |
| NFR-8 | Security / Supply chain | The curl-based install path (`install.sh`/`uninstall.sh`) MUST stay structurally in sync with the npm-distributed command/lib set — CI fails if the hard-coded `COMMANDS`/`LIBS` arrays drift from the actual `commands/do/*.md` / `lib/*.md` contents, so remote-install users never silently receive a broken or missing command. |

---

## Negative Requirements

| ID | Requirement | Why |
|---|---|---|
| NR-1 | The system MUST NOT write `autoUpdate` config for environments that don't support hooks (Codex, Antigravity, OpenCode, Grok). | That setting only has meaning where a hook can act on it; writing it elsewhere is dead state. |
| NR-2 | The system MUST NOT overwrite or mutate `settings.json` when its existing content is invalid JSON. | Silently rewriting a file the installer can't parse risks discarding user configuration it doesn't understand. |
| NR-3 | A filtered/single-command uninstall MUST NOT delete the user's saved `/do:config` defaults. | Defaults are shared across commands; removing one command shouldn't reset preferences for the rest. |
| NR-4 | `/do:pr` and the review loop MUST NOT push via a bare `git push` or `git push origin HEAD`/`<current-branch>`, and MUST NOT push when the upstream remote is local (`.`). | Prevents pushing to the wrong remote/ref or silently no-op'ing against a local-only upstream. |
| NR-5 | The review loop MUST NOT classify an unparseable or no-verdict reviewer output as either a hard error or as clean. | Treating "inconclusive" as either extreme either blocks merges that should proceed or lets unreviewed changes through. |
| NR-6 | The review loop MUST NOT merge a reviewer's stderr into the log file the strict verdict parser validates. | Interleaved stderr can corrupt the parser's ability to find a clean verdict marker. |
| NR-7 | An `~opt` (optional) reviewer exemption MUST NOT excuse a `push-failed` status. | A reviewer being optional doesn't make its unpushed fixes safe to merge over. |
| NR-8 | `/do:goals --prd` (and `/do:prd`) MUST NOT fabricate numeric success metrics or KPIs the codebase doesn't evidence. | An invented target reads as fact in a document meant to be authoritative; an unverifiable number belongs in Open Questions instead (see this document's own Success Metrics section). |

---

## Out of Scope

- **CI/CD pipeline replacement** — commands complement GitHub Actions/GitLab CI by handling code-level workflows; infrastructure automation and deployment pipelines are out of scope.
- **A GUI or dashboard** — everything runs in the CLI via AI coding assistants; no web interface or visual tooling is planned.
- **Install integrity verification (checksums/signing)** — the curl-installer allowlist test (NFR-8) is a drift guard between the repo's source files and the hard-coded shell arrays, not a supply-chain signing or checksum system. This is an accepted risk for the standard curl-pipe-bash distribution pattern; the npm install path is the primary, recommended route and isn't subject to it.

---

## Assumptions & Constraints

- Single independent maintainer, no funding/sponsorship infrastructure — README and LICENSE attribute the project to Adam Eivy.
- Distribution depends on the npm registry (primary path) and GitHub raw-content availability (curl fallback) being reachable.
- Issue-tracker features (`--issues` modes) assume `gh` (or `glab`) is installed and authenticated; commands degrade gracefully (skip, don't halt) when it isn't.
- Node.js >=18 is assumed present in the host environment.
- Environment auto-detection assumes each assistant's config-directory convention (`~/.claude`, `~/.config/opencode`, etc.) is stable and not user-relocated.
- Contributions are actively solicited via the public GitHub issue tracker (MIT license, no CLA); the process is formalized in [CONTRIBUTING.md](./CONTRIBUTING.md). No `CODE_OF_CONDUCT.md` exists yet.

---

## Success Metrics

- Success is defined by correctness, not adoption: every functional and non-functional requirement in this document behaving per its stated acceptance criteria is the bar, not download counts or usage volume.
- The one concrete, codebase-evidenced operational target found is the update-check network call, bounded to 3000ms (NFR-3).

---

## Risks & Open Questions

None open as of this writing — every item discovery raised was resolved during generation:

- Curl-installer integrity verification → accepted risk (see Out of Scope).
- Contribution model → contributions are actively solicited, formalized in `CONTRIBUTING.md` (see Assumptions & Constraints).
- Success metrics definition → correctness against this document's FR/NFR acceptance criteria is the bar (see Success Metrics).
- Possible stale `/do:fpr` upstream-detection issue → confirmed closed (GitHub issue #36, closed 2026-05-16).

---

For strategic context (mission, tenets, long-term vision), see [GOALS.md](./GOALS.md). For the tactical backlog, see [PLAN.md](./PLAN.md).
