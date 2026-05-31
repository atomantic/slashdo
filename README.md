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
| `/do:pr` | Open a PR with self-review; runs an external review loop only when you pass `--review-with` (no default reviewer; see [Review loop flags](#review-loop-flags-dopr-dorelease-dopr-better-doreview-dobetter-dobetter-swift-dodepfree-dorpr)) |
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

### Review loop flags (`/do:pr`, `/do:release`, `/do:pr-better`, `/do:review`, `/do:better`, `/do:better-swift`, `/do:depfree`, `/do:rpr`)

These commands accept a shared set of flags that control which reviewer(s) run and how the multi-reviewer loop is gated. **No reviewer is ever hardcoded — `copilot` runs only when you list it** (the one exception is `/do:rpr`, whose conditional default is documented below):

| Flag | Default | What it does |
|:---|:---|:---|
| `--review-with <agent>[,<agent>...]` | empty — **no default reviewer** (except `/do:rpr`, see below) | Pick one or more reviewers, run in the order given. Omit the flag and no external review runs (each command still runs its own unconditional self-review gate). Accepted slugs: `copilot` (GitHub cloud review), `codex`, `agy` (aliases `gemini` / `antigravity` — all run the Antigravity CLI's `agy` binary), `claude` (each non-copilot slug spawns that local CLI in headless mode). Whatever you list is exactly what runs — `--review-with codex` runs codex only; copilot is never added implicitly. Example: `--review-with codex,agy,copilot` runs codex first, then Antigravity, then copilot, each reviewing the branch as the previous pass left it. On `/do:better`, `/do:better-swift`, and `/do:depfree`, omitting the flag means the review loop **and the auto-merge** are skipped — PRs are left open for manual review. |
| `--review-iterations <n>` | `1` | Cap how many review-and-fix cycles a **Copilot** pass runs. Default `1`: request one review, apply every fix it surfaces, then stop (exiting early if the review returns 0 comments). `0` restores the legacy "loop until 0 comments" behavior, bounded by a 10-iteration safety guardrail. No effect on `codex`/`agy`/`claude` passes (fixed 3-iteration cap), and no effect when copilot isn't in the list. Accepted by `/do:better`, `/do:better-swift`, and `/do:depfree` too. |
| `--review-stop-on-findings` | off | Stop the multi-reviewer loop after the first reviewer that fixes at least one finding (subsequent reviewers in the list are skipped). Mutually exclusive with `--review-stop-on-clean`. |
| `--review-stop-on-clean` | off | Stop after the first reviewer that reports zero findings (clean). Mutually exclusive with `--review-stop-on-findings`. |
| `--reviewer-applies` | off | Edit the working tree directly from the reviewing CLI instead of routing findings back through the orchestrating thread. No effect on copilot passes (Copilot reviews are read-only); takes effect on each codex / agy / claude pass in the list. |

By default every listed reviewer runs in order, and the orchestrator that opened the PR also applies the fixes — it reads each reviewer's findings and edits the working tree itself. Pass `--reviewer-applies` when you want the reviewing agent's *judgment* in the final patch (e.g. asking Antigravity (`agy`) to both find and patch its own concerns). For `/do:release`, the merge gate requires the multi-reviewer aggregate status to be `clean` (or `partial`, if you explicitly opted into a stop-mode short-circuit) — a `dirty` aggregate (build/test broken on some pass) or an `inconclusive` aggregate (any executed pass timed out, errored, hit its guardrail, or was skipped — even if other passes returned clean) blocks the merge.

For `/do:review`, the listed agents run **after** the host CLI's own self-review (the multi-agent review built into `do:review`). The list names *additional* reviewers; whichever CLI is hosting `/do:review` does its own pass first regardless.

`/do:better`, `/do:better-swift`, and `/do:depfree` run the chosen reviewer(s) as their post-PR review loop (per PR, in parallel for the multi-PR `better` commands). With no `--review-with`, they skip the review loop and auto-merge and leave PRs open. `/do:rpr` is special: it **resolves review threads from any author** (Copilot, human, or other bot), and its `--review-with` default is a *conditional* `copilot` — it requests a Copilot review only when the PR has no review yet, or when Copilot is already the reviewer in play; pass `--review-with codex|agy|claude` to run a local review loop instead. From this table `/do:rpr` accepts **only** `--review-with` and `--reviewer-applies` — not `--review-iterations` or the stop-mode flags (it drives a single reviewer to clean, not the multi-reviewer stop-mode loop).

## Supported Environments

```
  Claude Code      ~/.claude/commands/do/             YAML frontmatter + subdirectories
  OpenCode         ~/.config/opencode/commands/       YAML frontmatter + flat naming
  Antigravity CLI  ~/.gemini/antigravity-cli/skills/  Agent Skills (SKILL.md) — aliases: gemini, agy
  Codex            ~/.codex/skills/                   SKILL.md per-command directories
```

slashdo auto-detects which environments you have installed. Or specify manually:

```bash
npx slash-do@latest --env claude             # just Claude Code
npx slash-do@latest --env opencode,antigravity  # multiple environments
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
  +------------------+  - Agent Skills / SKILL.md with inlined libs (Antigravity, Codex)
       |
       v
  +------------------+
  |    Installer     |  Diff-based: only writes changed files
  |                  |  Tracks version for update notifications
  +------------------+
       |
       v
  ~/.claude/commands/do/push.md
  ~/.config/opencode/commands/do-push.md
  ~/.gemini/antigravity-cli/skills/do-push/SKILL.md
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
4. Capability-gated content: wrap environment-specific instructions in `<!-- if:teams -->…<!-- else -->…<!-- /if:teams -->` blocks. The transformer keeps the matching branch per the target environment's capability flag (`supportsTeams` in `src/environments.js`) and strips the markers — e.g. `do:better` uses `TeamCreate` on Claude Code and falls back to parallel sub-agents elsewhere.
5. Test with `node bin/cli.js --list` and `node bin/cli.js --dry-run`

## License

MIT
