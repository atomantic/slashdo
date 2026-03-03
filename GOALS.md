# slashdo — Goals

> Automate the software development lifecycle through curated slash commands for AI coding assistants.

---

## Mission

slashdo is a curated library of slash commands that automate the software development lifecycle across AI coding assistants. It packages production-grade DevSecOps, code review, planning, and release management workflows as reusable commands — enabling developers to run security audits, create PRs with automated review loops, manage versioning, and maintain project governance through simple slash commands, regardless of which AI coding tool they use.

---

## Core Goals

### 1. Multi-Environment Support
Provide a single source of truth for commands that works across Claude Code, OpenCode, Gemini CLI, and Codex. Each environment gets commands in its native format with zero manual conversion.

### 2. Automate DevSecOps Workflows
Provide one-command security auditing, code quality analysis, and automated remediation. `/do:makegood` scans across 7 dimensions, remediates findings in an isolated worktree, and delivers clean PRs.

### 3. Standardize Development Rituals
Enforce consistent commit practices, SemVer versioning, and changelog management across projects. `/do:cam` ensures every commit follows conventional commit prefixes and updates changelogs.

### 4. Orchestrate AI-Powered Code Review
Integrate Copilot review loops with automated thread resolution into the PR workflow. `/do:pr` and `/do:rpr` handle the full cycle from PR creation through review iteration.

### 5. Maintain Project Governance Documentation
Keep planning and standards documents current and well-structured. `/do:replan` manages the tactical backlog, `/do:makegoals` generates strategic goal documents, and `/do:optimize-md` audits and optimizes markdown files (CLAUDE.md, README.md, AGENTS.md, etc.).

### 6. Be Project-Agnostic
Auto-detect tech stacks and adapt build commands, test runners, version bumping, and audit strategies accordingly. Commands should work on any codebase without manual configuration.

### 7. Frictionless Distribution
Distribute via npm with semver versioning, self-update notifications, and a single `npx slash-do@latest` install command. No git cloning required.

---

## Non-Goals

- **Replace CI/CD pipelines**: Commands complement GitHub Actions and GitLab CI by handling code-level workflows. Infrastructure automation, deployment pipelines, and environment management remain outside scope.
- **Provide a GUI or dashboard**: Everything runs in the CLI via AI coding assistants. There is no web interface or visual tooling planned.

---

## Target Users

Developers and teams using AI coding assistants who want to automate repetitive development workflows — particularly those practicing DevSecOps, structured planning, and SemVer-based release management.
