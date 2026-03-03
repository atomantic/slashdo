---
description: List all available slashdo commands
---

# slashdo Commands

List all available `/do:*` commands with their descriptions.

## Steps

1. **List commands**: Print a table of all available slashdo commands:

| Command | Description |
|---|---|
| `/do:cam` | Commit and push all work with changelog |
| `/do:fpr` | Commit, push to fork, and open a PR against the upstream repo |
| `/do:help` | List all available slashdo commands |
| `/do:makegoals` | Scan codebase to infer project goals, clarify with user, and generate GOALS.md |
| `/do:makegood` | Unified DevSecOps audit, remediation, per-category PRs, CI verification, and Copilot review loop |
| `/do:optimize-md` | Audit and optimize CLAUDE.md files against best practices |
| `/do:pr` | Commit, push, and open a PR against the repo's default branch |
| `/do:release` | Create a release PR using the project's documented release workflow |
| `/do:replan` | Review and clean up PLAN.md, extract docs from completed work |
| `/do:review` | Deep code review of changed files against best practices |
| `/do:rpr` | Resolve PR review feedback with parallel agents |
| `/do:update` | Update slashdo commands to the latest version |

2. **Check for updates**: Run `npm view slashdo version` and compare to the installed version in `~/.claude/.slashdo-version`. If an update is available, mention it.

## Notes

- Commands are installed via `npx slashdo@latest`
- For more info, see https://github.com/atomantic/slashdo
