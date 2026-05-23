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
  <img src="https://img.shields.io/npm/v/slash-do?style=flat-square&color=blue" alt="npm version" />
  <img src="https://img.shields.io/badge/environments-4-green?style=flat-square" alt="environments" />
  <img src="https://img.shields.io/badge/commands-15-orange?style=flat-square" alt="commands" />
  <img src="https://img.shields.io/badge/license-MIT-lightgrey?style=flat-square" alt="license" />
</p>

---

## Philosophy

slashdo commands emphasize **high-quality software engineering over token conservation**. While efforts are made to use agents, models, and prompts efficiently, these tools work hard to ensure your software meets high-quality standards — and will use the tokens necessary to meet that end. Expect thorough reviews, multi-agent scans, and verification loops rather than shortcuts.

## Quick Start

**With npm/npx:**
```bash
npx slash-do@latest
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
| `/do:push` | Commit and push all work with changelog |
| `/do:pr` | Open a PR with self-review and a review loop (Copilot by default; see [Review loop flags](#review-loop-flags-dopr-dorelease-dopr-better)) |
| `/do:pr-better` | Run a full do:better audit on the current branch, commit fixes directly, then open a single PR |
| `/do:fpr` | Fork PR -- push to fork, PR against upstream |
| `/do:rpr` | Resolve PR review feedback with parallel agents |
| `/do:release` | Create a release PR with version bump and changelog |
| `/do:review` | Deep code review against best practices |
| `/do:better` | Full DevSecOps audit with 8-agent scan and remediation |
| `/do:better-swift` | SwiftUI DevSecOps audit with multi-platform coverage |
| `/do:scan` | Read-only safety audit of an unfamiliar directory — flags malware patterns, network calls, and vulnerable deps without executing code |
| `/do:depfree` | Audit dependencies, remove unnecessary ones, write replacement code |
| `/do:goals` | Generate GOALS.md from codebase analysis |
| `/do:replan` | Review and clean up PLAN.md |
| `/do:omd` | Audit and optimize markdown files |
| `/do:update` | Update slashdo to latest version |
| `/do:help` | List all available commands |

### Review loop flags (`/do:pr`, `/do:release`, `/do:pr-better`)

These three commands accept two flags that control the post-PR review:

| Flag | Default | What it does |
|:---|:---|:---|
| `--review-with <agent>` | `copilot` | Pick the reviewer: `copilot` (GitHub cloud review), `codex`, `gemini`, or `claude` (a separate local CLI in headless mode). |
| `--reviewer-applies` | off | Edit the working tree directly from the reviewing CLI instead of routing findings back through the orchestrating thread. No effect with `--review-with copilot` (Copilot reviews are read-only). |

By default the orchestrator that opened the PR also applies the fixes — it reads the reviewer's findings and edits the working tree itself. Pass `--reviewer-applies` only when you want the reviewing agent's *judgment* in the final patch (e.g. asking gemini to both find and patch its own concerns).

## Supported Environments

```
  Claude Code   ~/.claude/commands/do/        YAML frontmatter + subdirectories
  OpenCode      ~/.config/opencode/commands/  YAML frontmatter + flat naming
  Gemini CLI    ~/.gemini/commands/do/         TOML headers + subdirectories
  Codex         ~/.codex/skills/              SKILL.md per-command directories
```

slashdo auto-detects which environments you have installed. Or specify manually:

```bash
npx slash-do@latest --env claude             # just Claude Code
npx slash-do@latest --env opencode,gemini    # multiple environments
```

## Install Options

```bash
npx slash-do@latest                          # auto-detect + install all
npx slash-do@latest --env claude             # target specific environment
npx slash-do@latest --list                   # show commands and install status
npx slash-do@latest --dry-run                # preview changes
npx slash-do@latest --uninstall              # remove installed commands
curl -fsSL https://raw.githubusercontent.com/atomantic/slashdo/main/uninstall.sh | bash  # curl uninstall
npx slash-do@latest push pr release           # install specific commands only
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
  ~/.claude/commands/do/push.md
  ~/.config/opencode/commands/do-push.md
  ~/.gemini/commands/do/push.md
  ~/.codex/skills/do-push/SKILL.md
```

## Updating

```bash
npx slash-do@latest        # from your terminal
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
