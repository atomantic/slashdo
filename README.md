# slashdo

Curated slash commands for AI coding assistants. One install, multiple environments.

## Quick Start

```bash
npx slashdo@latest
```

That's it. slashdo detects your installed AI coding environments and installs commands to each one.

## Commands

All commands live under the `do:` namespace:

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

## Supported Environments

| Environment | Status | Commands Dir |
|---|---|---|
| Claude Code | Full support | `~/.claude/commands/do/` |
| OpenCode | Full support | `~/.config/opencode/commands/` |
| Gemini CLI | Full support | `~/.gemini/commands/do/` |
| Codex | Full support | `~/.codex/skills/` |

## Install Options

```bash
npx slashdo@latest                          # auto-detect environments, install all
npx slashdo@latest --env claude             # install for Claude Code only
npx slashdo@latest --env opencode,gemini    # install for specific environments
npx slashdo@latest --list                   # show commands and install status
npx slashdo@latest --dry-run                # preview changes without applying
npx slashdo@latest --uninstall              # remove installed commands
npx slashdo@latest cam pr                   # install specific commands only
```

## How It Works

1. **Detects** which AI coding environments are installed on your system
2. **Transforms** commands to each environment's format:
   - **Claude Code**: YAML frontmatter `.md` files in subdirectories
   - **OpenCode**: YAML frontmatter `.md` files, flat naming (`do-cam.md`)
   - **Gemini CLI**: TOML header format in subdirectories
   - **Codex**: `SKILL.md` files in per-command directories
3. **Installs** commands with diff-based updates (only writes changed files)
4. **Tracks** installed version for update notifications

## Updating

```bash
npx slashdo@latest
```

Or from within your AI coding assistant:

```
/do:update
```

## Contributing

1. Commands live in `commands/do/` as Claude Code format `.md` files (source of truth)
2. Lib files (shared partials) live in `lib/`
3. The transformer handles format conversion for each environment
4. Test with `node bin/cli.js --list` and `node bin/cli.js --dry-run`

## License

MIT
