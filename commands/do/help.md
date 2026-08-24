---
description: List all available slashdo commands
---

# slashdo Commands

List all available `/do:*` commands with their descriptions.

## Steps

1. **List commands**: Print a table of all available slashdo commands:

| Command | Description |
|---|---|
| `/do:better` | Unified DevSecOps audit, remediation, per-category PRs, CI verification, and an optional multi-reviewer review loop (`--review-with`) |
| `/do:better-swift` | SwiftUI-optimized DevSecOps audit with multi-platform coverage (iOS, macOS, watchOS, tvOS, visionOS) |
| `/do:config` | View or set saved slashdo defaults (e.g. `--review-with`) so future commands can omit the flag — global or per-project (`--project`) |
| `/do:depfree` | Audit third-party dependencies and remove unnecessary ones by writing replacement code. Use `--heavy` for aggressive mode that targets all non-foundational libraries for replacement where feasible |
| `/do:fpr` | Commit, push to fork, and open a PR against the upstream repo |
| `/do:goals` | Scan codebase to infer project goals and generate GOALS.md — `--prd` generates a detailed PRD.md instead (autonomous by default; `--interactive` to review with you) |
| `/do:help` | List all available slashdo commands |
| `/do:next` | Claim the next unclaimed PLAN.md item (or tracker issue with `--issues`), implement it in an isolated worktree, ship a reviewed PR, and clean up — `--swarm[=N]` ships several independent issues in parallel, auto-picked or named (`--swarm #12 #14`) |
| `/do:omd` | Audit and optimize markdown files (CLAUDE.md, README.md, etc.) against best practices |
| `/do:plan-task` | Plan a task by investigating the codebase, then file a robust, decision-complete issue in the repo's tracker (GitHub `gh` / GitLab `glab`, auto-detected) — with an approval gate you can skip with `--yes` |
| `/do:pr` | Commit, push, and open a PR (GitHub) or merge request (GitLab) against the repo's default branch — `--merge` auto-merges once reviews and CI pass |
| `/do:pr-better` | Run a full do:better audit on the current branch, commit fixes directly, then open a single PR |
| `/do:prd` | Scan codebase to infer product requirements and generate a detailed PRD.md (`/do:goals --prd`) |
| `/do:push` | Commit and push all work, logging it per the project's own changelog convention |
| `/do:release` | Create a release PR using the project's documented release workflow |
| `/do:replan` | Automated audit/triage of PLAN.md (or the issue tracker with `--issues`) — prune completed items, suggest new work, keep the plan lean |
| `/do:review` | Deep code review of changed files against best practices |
| `/do:rpr` | Resolve PR review feedback with parallel agents |
| `/do:scan` | Read-only safety audit of an unfamiliar directory — flags malware patterns, network calls, and vulnerable deps without executing code |
| `/do:simplify` | Refactor-only audit — architecture, DRY, simplification, and cognitive load — shipped as per-category PRs that must not change behavior (`/do:better --simplify-only`) |
| `/do:update` | Update slashdo commands to the latest version |

2. **Check for updates**: If `command -v npm` finds npm, run `npm view slash-do version` and compare to the installed version in `~/.claude/.slashdo-version`; mention it if an update is available. If npm is missing (the curl installer does not require it), say so instead of reporting "up to date" — the update check and the `⬆ /do:update` statusline hint cannot work without npm, so point the user at `curl -fsSL https://raw.githubusercontent.com/atomantic/slashdo/main/install.sh | bash` to update in place.

## Notes

- Commands are installed via `npx slash-do@latest`
- For more info, see https://github.com/atomantic/slashdo
