---
description: List all available slashdo commands
---

# slashdo Commands

List all available `/do:*` commands with their descriptions.

## Steps

1. **List commands**: Print a table of all available slashdo commands:

| Command | Description |
|---|---|
| `/do:better` | Unified DevSecOps audit, remediation, per-category PRs, CI verification, and Copilot review loop |
| `/do:fpr` | Commit, push to fork, and open a PR against the upstream repo |
| `/do:goals` | Scan codebase to infer project goals, clarify with user, and generate GOALS.md |
| `/do:help` | List all available slashdo commands |
| `/do:omd` | Audit and optimize markdown files (CLAUDE.md, README.md, etc.) against best practices |
| `/do:pr` | Commit, push, and open a PR against the repo's default branch |
| `/do:push` | Commit and push all work with changelog |
| `/do:release` | Create a release PR using the project's documented release workflow |
| `/do:replan` | Review and clean up PLAN.md, extract docs from completed work |
| `/do:review` | Deep code review of changed files against best practices |
| `/do:rpr` | Resolve PR review feedback with parallel agents |
| `/do:update` | Update slashdo commands to the latest version |
| `/improve:review` | Learn from PR review feedback to improve the self-review checklist |

2. **Check for updates**: Run `npm view slash-do version` and compare to the installed version in `~/.claude/.slashdo-version`. If an update is available, mention it.

## Notes

- Commands are installed via `npx slash-do@latest`
- For more info, see https://github.com/atomantic/slashdo
