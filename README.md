<p align="center">

```
    ██╗██████╗  ██████╗
   ██╔╝██╔══██╗██╔═══██╗
  ██╔╝ ██║  ██║██║   ██║
 ██╔╝  ██║  ██║██║   ██║
██╔╝   ██████╔╝╚██████╔╝
╚═╝    ╚═════╝  ╚═════╝
```

</p>

<h3 align="center">Curated slash commands for AI coding assistants</h3>
<p align="center">One install. Multiple environments. All the workflows.</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> &bull;
  <a href="#commands">Commands</a> &bull;
  <a href="#supported-environments">Environments</a> &bull;
  <a href="#how-it-works">How It Works</a>
</p>

<p align="center">
  <img src="https://img.shields.io/npm/v/slashdo?style=flat-square&color=blue" alt="npm version" />
  <img src="https://img.shields.io/badge/environments-4-green?style=flat-square" alt="environments" />
  <img src="https://img.shields.io/badge/commands-12-orange?style=flat-square" alt="commands" />
  <img src="https://img.shields.io/badge/license-MIT-lightgrey?style=flat-square" alt="license" />
</p>

---

## Quick Start

**With npm/npx:**
```bash
npx slashdo@latest
```

**Without npm** (curl):
```bash
curl -fsSL https://raw.githubusercontent.com/atomantic/slashdo/main/install.sh | bash
```

That's it. slashdo detects your installed AI coding environments and installs commands to each one.

## Commands

All commands live under the `do:` namespace:

| Command | What it does |
|:---|:---|
| `/do:cam` | Commit and push all work with changelog |
| `/do:pr` | Open a PR with self-review and Copilot review loop |
| `/do:fpr` | Fork PR -- push to fork, PR against upstream |
| `/do:rpr` | Resolve PR review feedback with parallel agents |
| `/do:release` | Create a release PR with version bump and changelog |
| `/do:review` | Deep code review against best practices |
| `/do:makegood` | Full DevSecOps audit with 7-agent scan and remediation |
| `/do:makegoals` | Generate GOALS.md from codebase analysis |
| `/do:replan` | Review and clean up PLAN.md |
| `/do:optimize-md` | Audit and optimize CLAUDE.md files |
| `/do:update` | Update slashdo to latest version |
| `/do:help` | List all available commands |

## Supported Environments

```
  Claude Code   ~/.claude/commands/do/        YAML frontmatter + subdirectories
  OpenCode      ~/.config/opencode/commands/  YAML frontmatter + flat naming
  Gemini CLI    ~/.gemini/commands/do/         TOML headers + subdirectories
  Codex         ~/.codex/skills/              SKILL.md per-command directories
```

slashdo auto-detects which environments you have installed. Or specify manually:

```bash
npx slashdo@latest --env claude             # just Claude Code
npx slashdo@latest --env opencode,gemini    # multiple environments
```

## Install Options

```bash
npx slashdo@latest                          # auto-detect + install all
npx slashdo@latest --env claude             # target specific environment
npx slashdo@latest --list                   # show commands and install status
npx slashdo@latest --dry-run                # preview changes
npx slashdo@latest --uninstall              # remove installed commands
npx slashdo@latest cam pr release           # install specific commands only
```

## How It Works

```
  Source (commands/do/*.md)
       |
       v
  +------------------+
  |   Transformer    |  Converts format per environment:
  |                  |  - YAML frontmatter (Claude, OpenCode)
  +------------------+  - TOML headers (Gemini)
       |                - SKILL.md with inlined libs (Codex)
       v
  +------------------+
  |    Installer     |  Diff-based: only writes changed files
  |                  |  Tracks version for update notifications
  +------------------+
       |
       v
  ~/.claude/commands/do/cam.md
  ~/.config/opencode/commands/do-cam.md
  ~/.gemini/commands/do/cam.md
  ~/.codex/skills/do-cam/SKILL.md
```

## Updating

```bash
npx slashdo@latest        # from your terminal
```

```
/do:update                # from inside your AI coding assistant
```

## Contributing

1. Commands live in `commands/do/` as Claude Code format `.md` files (source of truth)
2. Lib files (shared partials) live in `lib/`
3. The transformer handles format conversion for each environment
4. Test with `node bin/cli.js --list` and `node bin/cli.js --dry-run`

## License

MIT
