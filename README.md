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
  <a href="#workflows">Workflows</a> &bull;
  <a href="#commands">Commands</a> &bull;
  <a href="#configuration-doconfig">Configuration</a> &bull;
  <a href="#supported-environments">Environments</a> &bull;
  <a href="#how-it-works">How It Works</a>
</p>

<p align="center">
  <img src="https://img.shields.io/npm/v/slash-do?style=flat-square&color=blue" alt="npm version" />
  <img src="https://img.shields.io/badge/environments-5-green?style=flat-square" alt="environments" />
  <img src="https://img.shields.io/badge/commands-19-orange?style=flat-square" alt="commands" />
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

That's it. slashdo detects your installed AI coding environments and installs commands to each one. Then, inside your assistant:

```
/do:help
```

## Workflows

Real end-to-end examples of how the commands compose. Every flag shown here is optional — the bare command always works.

### Ship the work in your working tree

You've been coding with your assistant and want it committed, pushed, and PR'd:

```
/do:pr
```

That commits, pushes, opens a PR (GitHub `gh` or GitLab `glab`, auto-detected from the remote), and runs an unconditional self-review. Add an external reviewer and merge automatically once everything is green:

```
/do:pr --review-with codex --merge
```

`codex` reviews the branch, slashdo applies the fixes, and the PR merges once required CI passes. See [Review loop](#review-loop) for the full reviewer roster and [Auto-merge](#auto-merge-dopr---merge) for the merge gates.

### Plan a task, then let an agent ship it

Turn a rough idea into a well-formed tracker issue, then hand it to an agent:

```
/do:plan-task add a --json flag to the export command
```

`/do:plan-task` investigates the codebase (real file paths, current behavior, constraints), drafts a decision-complete issue — problem, context, approach, acceptance criteria — shows it to you for approval, and files it in the repo's tracker (GitHub or GitLab, including Enterprise/self-managed hosts). Useful variants:

```
/do:plan-task <idea> --yes                    # skip the approval gate (still stops on a blocking open question)
/do:plan-task <idea> --dry-run                # print the issue that would be filed, don't create it
/do:plan-task <idea> --label bug              # add labels on top of what planning infers
/do:plan-task <idea> --enhance-with codex,grok  # sharpen the draft through a second/third agent before the gate
```

`--enhance-with <list>` routes the drafted issue through a sequential pipeline of
enhancement agents (`codex`, `claude`, `agy`, `grok` — same `agent[model]` grammar as
`--review-with`, e.g. `--enhance-with codex[o3],grok`), each refining the previous
one's output, before the approval gate — a cheap second/third opinion folded into the
draft. A missing or misbehaving agent degrades to the last good draft; the human still
approves the final text.

Suppose it files issue `#123`. On GitHub, ship it immediately:

```
/do:next --issues #123
```

`/do:next` claims the issue (assignee + a `next/issue-123` branch as the claim marker), implements it in an isolated git worktree, opens a reviewed PR that `Closes #123`, merges, and cleans up. Add `--plan` to approve a written implementation plan before any code is written.

### Run a whole backlog

`/do:replan` keeps the plan honest; `/do:next` drains it. The plan can live in `PLAN.md` (default) or your issue tracker (`--issues`):

```
/do:config --project --issues       # mark this repo as issue-tracked, once
/do:replan                          # triage: close done/stale items, file new opportunities
/do:next                            # claim + ship the next open item
/do:next --swarm=4                  # or ship up to 4 independent issues in parallel
```

With the saved `--issues` default, every plan-aware command (`/do:next`, `/do:replan`, `/do:better`, `/do:depfree`, `/do:review`, `/do:rpr`) reads and files tracker issues instead of PLAN.md lines. On a shared tracker, add `--self` so your agent only ever claims issues **you** filed — see [Issue mode](#issue-mode---issues).

### Audit and harden

```
/do:better --review-with claude,codex     # full DevSecOps audit → per-category PRs → review loop → merge
/do:review --strict                       # deep code review of the current branch's changes
/do:depfree --heavy                       # remove unnecessary dependencies by writing replacement code
/do:scan ~/Downloads/sketchy-repo         # read-only malware/safety audit of an unfamiliar directory
```

Note: `/do:better`, `/do:better-swift`, and `/do:depfree` only run their review loop **and auto-merge** when you pass (or have saved) `--review-with` — without it they leave their PRs open for manual review.

### Configure once, omit flags forever

```
/do:config --review-with=claude,codex     # every review-capable command now uses these reviewers
/do:config --merge                        # bare /do:pr auto-merges once reviews + CI are green
/do:config --review-models codex=o3       # pin the model a reviewer runs on
/do:config --project --review-with=none   # ...except this repo: no external reviewers here
/do:config                                # show global, per-project, and effective values
```

See [Configuration](#configuration-doconfig) for every key, scoping, and precedence.

## Commands

All commands live under the `do:` namespace:

| Command | What it does |
|:---|:---|
| `/do:push` | Commit and push all work with changelog |
| `/do:pr` | Commit, push, and open a PR (GitHub `gh`) or merge request (GitLab `glab`) with self-review. External reviewers run only when you list them ([Review loop](#review-loop)); `--merge` auto-merges once reviews and CI pass ([Auto-merge](#auto-merge-dopr---merge)) |
| `/do:pr-better` | Run a full do:better audit on the current branch, commit fixes directly, then open a single PR |
| `/do:fpr` | Fork PR — push to fork, PR against upstream |
| `/do:rpr` | Resolve PR review feedback with parallel agents |
| `/do:release` | Create a release PR with version bump and changelog |
| `/do:review` | Deep code review of changed files against best practices (`--strict`/`--nuclear` raise the bar) |
| `/do:better` | Full DevSecOps audit with multi-agent scan, remediation, and per-category PRs |
| `/do:better-swift` | SwiftUI DevSecOps audit with multi-platform coverage (iOS, macOS, watchOS, tvOS, visionOS) |
| `/do:scan` | Read-only safety audit of an unfamiliar directory — flags malware patterns, network calls, and vulnerable deps without executing code |
| `/do:depfree` | Audit dependencies, remove unnecessary ones, write replacement code (`--heavy` targets all non-foundational libraries) |
| `/do:goals` | Generate GOALS.md from codebase analysis (autonomous by default; `--interactive` to review with you) |
| `/do:plan-task` | Investigate the codebase, draft a decision-complete issue, show it for approval, file it in the tracker ([workflow](#plan-a-task-then-let-an-agent-ship-it)) |
| `/do:replan` | Audit/triage the plan — prune completed items, suggest new work — in `PLAN.md` or the issue tracker ([Issue mode](#issue-mode---issues)) |
| `/do:next` | Claim the next unclaimed plan item or issue, implement it in an isolated worktree, ship a reviewed PR, clean up. `--swarm[=N]` ships several independent issues in parallel ([Issue mode](#issue-mode---issues)) |
| `/do:omd` | Audit and optimize markdown files against best practices |
| `/do:config` | View or set saved defaults so future commands can omit their flags ([Configuration](#configuration-doconfig)) |
| `/do:update` | Update slashdo to latest version |
| `/do:help` | List all available commands |

## Review loop

`/do:pr`, `/do:release`, `/do:pr-better`, `/do:review`, `/do:better`, `/do:better-swift`, `/do:depfree`, and `/do:rpr` share one review system: you pick the reviewer(s) with `--review-with`, and a set of companion flags controls how the loop runs. **No reviewer is ever hardcoded** — omit the flag and no external review runs (each command still runs its own unconditional self-review gate). The one exception is `/do:rpr`, whose conditional default is [documented below](#command-specific-behavior).

### Reviewers

| Slug | What runs | Model pinnable? |
|:---|:---|:---|
| `copilot` | GitHub's cloud Copilot review on the PR (GitHub only) | no |
| `codex` | The Codex CLI in headless mode, reviewing locally | yes |
| `claude` | The Claude Code CLI in headless mode | yes |
| `agy` | The Antigravity CLI (`agy` binary; aliases: `gemini`, `antigravity`) | yes |
| `grok` | The Grok CLI in headless mode, reviewing locally | yes |
| `ollama` | A local Ollama model — review-only (non-agentic). Bare `ollama` auto-selects your most capable installed coding model | yes |
| `@<login>` | Any GitHub user or App/bot (e.g. `@octocat`, `@some-app[bot]`): slashdo requests their review on the PR, waits for it, and fixes what it surfaces. GitHub only; slashdo never posts an approval itself | no |

Reviewers run **in the order listed**, and whatever you list is exactly what runs — `--review-with codex` runs codex only; copilot is never added implicitly.

```
/do:pr --review-with codex                          # one local reviewer
/do:pr --review-with codex,agy,copilot              # codex, then Antigravity, then Copilot — each sees the prior's fixes
/do:pr --review-with claude[claude-opus-4-8],codex[o3]   # pin the model per reviewer
/do:pr --review-with ollama[qwen2.5-coder:32b]      # pin a specific installed Ollama model
/do:pr --review-with codex,@org-review-bot          # codex, then request a review from a GitHub bot
/do:pr --review-with codex,ollama~opt               # ollama is optional — it runs, but can't block the merge
/do:pr --review-with none                           # skip external review for this run (overrides a saved default)
```

**Model pinning** (`<agent>[<model>]`) works per run as shown, or save per-reviewer defaults with `/do:config --review-models codex=o3,claude=claude-opus-4-8` so runs can omit the bracket. An explicit bracket always wins over the saved default.

**Optional reviewers** (`~opt` suffix): the reviewer runs and its findings get fixed, but an *inconclusive* result (timeout / skipped / no verdict) is excluded from the merge gate, so it never blocks `--merge`. A hard error from it (broken build / failed tests) still blocks. Use it for a second-opinion reviewer that doesn't reliably return a verdict, such as a local Ollama model.

### Loop flags

| Flag | Default | What it does |
|:---|:---|:---|
| `--review-with <list>` | none — no external reviewer | Comma-list of reviewers, run in order (see above) |
| `--review-iterations <n>` | `1` | Cap review-and-fix cycles for a `copilot` or `@<login>` pass: request one review, apply every fix, stop (exiting early on 0 comments). `0` restores loop-until-clean, bounded by a 10-iteration guardrail. No effect on `codex`/`agy`/`claude`/`grok` (fixed 3-iteration cap) or `ollama` (own fixed cap) |
| `--review-mode <series\|parallel>` | `series` | `series` runs each reviewer to completion before the next starts, so later reviewers see earlier reviewers' committed fixes (list order matters). `parallel` runs every review concurrently against one frozen baseline and applies the deduped union of findings in a single pass — faster, but no reviewer sees another's fixes, and `--reviewer-applies` and the stop-mode flags are ignored. `/do:rpr` ignores this flag |
| `--review-stop-on-findings` | off | Stop the loop after the first reviewer that fixes at least one finding; skip the rest. Mutually exclusive with `--review-stop-on-clean` |
| `--review-stop-on-clean` | off | Stop after the first reviewer that reports zero findings |
| `--reviewer-applies` | off | Let the reviewing CLI edit the working tree directly, instead of the orchestrator applying its findings. Applies to `codex`/`agy`/`claude`/`grok` passes; no effect on `copilot`, `@<login>` (both review read-only cloud-side), or `ollama` (always review-only) |

By default the orchestrator that opened the PR applies every reviewer's fixes itself. Pass `--reviewer-applies` when you want the reviewing agent's *judgment* in the final patch (e.g. asking Antigravity to both find and patch its own concerns).

**The merge gate.** Commands that merge (e.g. `/do:release`, `/do:pr --merge`) require the multi-reviewer aggregate status to be `clean` — or `partial`, if you explicitly opted into a stop-mode short-circuit. A `dirty` aggregate (build/test broken on some pass) or an `inconclusive` one (any executed pass timed out, errored, hit its guardrail, was skipped, or — for ollama — only partially reviewed the diff) blocks the merge, even if other passes returned clean.

### Command-specific behavior

- **`/do:review`** — the listed agents run *after* the host CLI's own multi-agent self-review; the list names *additional* reviewers.
- **`/do:better` / `/do:better-swift` / `/do:depfree`** — the chosen reviewers run as the post-PR review loop (per PR, in parallel for the multi-PR better commands). **Omitting `--review-with` skips the review loop and the auto-merge** — PRs are left open for manual review.
- **`/do:rpr`** — resolves review threads from any author (Copilot, human, or bot). Its `--review-with` default is a *conditional* `copilot`: it requests a Copilot review only when the PR has no review yet, or when Copilot is already the reviewer in play. It accepts only `--review-with` and `--reviewer-applies` (not `--review-iterations`, `--review-mode`, or the stop-mode flags), and it doesn't support `@<login>` entries — it drops them with a notice and falls back to its conditional copilot default.

## Auto-merge (`/do:pr --merge`)

By default `/do:pr` opens the PR and hands it back for manual merge. Pass `--merge` to merge automatically once **both** gates are green: the review loop returns a mergeable status **and** required CI checks pass.

```
/do:pr --merge                        # merge when green, repo's preferred merge method
/do:pr --merge=squash                 # merge + pin the method in one token
/do:pr --review-with codex --merge    # external review first, then merge when green
/do:pr --no-merge                     # leave open, overriding a saved merge default
```

| Flag | Default | What it does |
|:---|:---|:---|
| `--merge` | off — PR left open | After review **and** CI pass, merge the PR. Eligible only when the review aggregate is `clean` (or `partial` under an explicit stop-mode). With no `--review-with`, the bar is the unconditional self-review gate plus passing CI |
| `--merge=<method>` | — | `--merge` plus pin the method: `squash`, `rebase`, or `merge` |
| `--merge-method <method>` | repo's allowed method | Pin the method without restating `--merge` (useful when `--merge` comes from a saved default). When unset, slashdo prefers `squash`, then `merge`, then `rebase` among the repo's allowed methods |
| `--no-merge` | — | Leave the PR open for this run, overriding a saved `merge` default |

**How CI is awaited:** slashdo first enables GitHub-native auto-merge (`gh pr merge --auto`), so the merge lands when required checks pass even if your session ends. If the repo hasn't enabled auto-merge, it falls back to watching checks in-session (`gh pr checks --watch`) and merging once green — leaving the PR open if a required check fails. On GitLab it uses `glab mr merge --auto-merge`. It never merges on a non-clean review aggregate, before checks pass, or over branch protection.

Save the behavior once with `/do:config --merge` (see [Configuration](#configuration-doconfig)). Only `/do:pr` reads the saved `merge`/`merge-method` defaults — `/do:better`, `/do:better-swift`, `/do:depfree`, and `/do:release` keep their own documented merge behavior.

## Issue mode (`--issues`)

By default the plan lives in `PLAN.md`. Pass `--issues` (or save it — `/do:config --issues`) to track it in your GitHub/GitLab issue tracker instead. **Every command that records plan items understands it**: `/do:replan` triages issues; `/do:next` claims them; `/do:better`, `/do:better-swift`, and `/do:depfree` file deferred findings as labeled issues; `/do:review` and `/do:rpr` file deferred findings as issues instead of PLAN.md lines. `--no-issues` on a single run overrides a saved default.

```
/do:replan --issues                       # triage the tracker instead of PLAN.md
/do:replan --issues --interactive         # approve each close/create before it happens
/do:next --issues                         # claim + ship the oldest eligible open issue
/do:next --issues #42                     # cherry-pick a specific issue
/do:next --issues --swarm                 # ship 3 independent issues in parallel
/do:next --issues --self                  # only claim issues YOU filed (security boundary)
```

| Flag | Default | What it does |
|:---|:---|:---|
| `--issues` | off — plan lives in `PLAN.md` | Track plan items as tracker issues. Requires an authenticated `gh` (GitHub) or `glab` (GitLab); commands abort rather than silently falling back |
| `--issues-label <name>` | `plan` | The label that scopes which issues are plan items, so bug reports and questions in the same tracker aren't mistaken for the plan |

**Migration is automatic.** `/do:replan --issues` always reads `PLAN.md` if one exists: every open item is migrated into the tracker (one labeled issue each) and `PLAN.md` is emptied to a short note that the roadmap now lives on the Issues page. Before migrating an item, replan surfaces any open question it finds and asks you to resolve it, so every issue it files is immediately claimable. In issue mode the stable item ID is the **issue number** (e.g. `#42`); concurrent agents claim work via branch names carrying it.

**`/do:next` is label-agnostic by default.** `--issues-label` scopes the commands that *file or triage* plan items, but a bare `/do:next --issues` claims the oldest open issue regardless of label (skipping only parking labels like `future`/`blocked`, epics with open children, and anything already in flight or assigned) — so a repo full of ordinary `bug`/`enhancement` issues works without stamping a `plan` label on everything. Pass `--issues-label <name>` (or save it) to restrict auto-pick to a curated queue.

**Claim only your own issues (`--self`).** By default `/do:next` claims any open issue regardless of author — which on a shared tracker means acting on work items (and the instructions in their bodies) opened by anyone. `--self` restricts every claim — auto-pick, `--swarm` batches, and explicit `#<num>` — to issues authored by the running `gh` account; an explicit number for someone else's issue is **refused, not overridden**. Save it with `/do:config --self` so a multi-contributor tracker never auto-feeds third-party issues into your agent; `--no-self` on a run reverts to any-author. Issues mode only (PLAN.md items have no author).

**Epics are child-aware.** An `epic` (umbrella) issue — identified by the `epic` label, native GitHub sub-issues, or a body that task-lists other issues — is judged by its **children**, not by code evidence. `/do:next --issues` skips an epic while any child is open; once every child closes it claims the epic's remaining wrap-up tasks (or closes the epic outright if nothing remains). After shipping a child, `/do:next` re-checks the parent and closes it when that child was the last. `/do:replan --issues` applies the same rule during triage.

**Swarm mode (`/do:next --issues --swarm[=N]`).** Instead of one item per run, `--swarm` claims and ships **several independent open issues at once** — each in its own worktree subagent running the normal single-issue flow — then serializes only the merge. It picks the first N independent issues off the same priority/oldest queue (skipping ones that depend on or obviously overlap another in the batch), fans out one agent per issue to implement and open a reviewed PR, then merges them one at a time, re-syncing each onto the advancing default branch. Default 3 agents; `--swarm=N` sets the count (clamped `1..6` — N agents cost ≈N× the tokens). A PR that isn't cleanly mergeable is left open rather than force-merged, and a dead agent's claim is released back to the queue.

## Configuration (`/do:config`)

Rather than passing flags every time, save them once and let future commands pick them up automatically.

```
/do:config --review-with=claude,codex,ollama[qwen2.5-coder:32b]
/do:config --review-models codex=o3,claude=claude-opus-4-8
/do:config --issues --issues-label plan
/do:config --merge --merge-method squash
/do:config --self
/do:config                                # show what's saved and what's effective
```

| Usage | What it does |
|:---|:---|
| `/do:config` (or `--show`) | Print the current global + per-project defaults and the effective merged values |
| `/do:config --review-with=… [--review-iterations=N] [--review-mode=series\|parallel] [--reviewer-applies\|--no-reviewer-applies] [--review-stop-on-findings\|--review-stop-on-clean\|--review-stop-all]` | Save review-loop defaults (validated with the same rules the review commands use) |
| `/do:config --review-models <agent>=<model>,…` | Save the default model per reviewer (`codex`/`claude`/`agy`/`grok`/`ollama`). Merges key-by-key — setting one agent leaves the others intact; an empty value (`codex=`) clears one agent |
| `/do:config --issues\|--no-issues [--issues-label=<name>]` | Save the issue-mode default (and its scoping label) for every command that accepts `--issues` |
| `/do:config --self\|--no-self` | Save the self-only issue gate for `/do:next` — claim only issues you filed |
| `/do:config --merge\|--no-merge [--merge-method=squash\|rebase\|merge]` | Save `/do:pr`'s auto-merge default (and method); the shorthand `--merge=squash` sets both |
| `--project` | Read/write a per-repo `.slashdo.json` at the repo root instead of the global config; per-project values override global ones key by key |
| `--unset <key>` | Clear one saved default (`review-with`, `review-models`, `review-iterations`, `review-mode`, `reviewer-applies`, `review-stop-mode`, `issues`, `issues-label`, `self`, `merge`, `merge-method`) |
| `--reset` | Clear all saved defaults in the chosen scope |

**Precedence (highest first):** an explicit flag on the command line → per-project `.slashdo.json` → global `~/.claude/.slashdo-config.json` → the command's built-in default. Two per-run escape hatches: `--review-with none` skips external reviewers for one run, and the `--no-*` flag forms (`--no-issues`, `--no-merge`, `--no-self`) override a saved `true` for one run.

**Masking a global default per repo:** saving `--project --review-with=none` stores an explicit "no external reviewer" tombstone that masks an inherited global reviewer list for that one repo — something `--unset` can't do (unsetting the project key just falls back to the global value). The explicit negative forms (`--no-issues`, `--no-merge`, `--no-self`, `--no-reviewer-applies`, `--review-stop-all`) exist for the same reason: a project default that overrides an inherited global `true` back off.

A typical split: personal preferences go global, repo policy goes in the repo (and `.slashdo.json` can be committed so the whole team shares it):

```
/do:config --review-with=codex --merge          # your defaults, everywhere
/do:config --project --issues --self            # this repo: issue-tracked, self-only claims
```

`/do:config` shows the merged result, e.g.:

```
Effective (project overrides global):
  review-with        = codex
  review-models      = (none — each reviewer's built-in default)
  review-iterations  = 1 (built-in default)
  review-mode        = series (built-in default)
  issues             = true
  self               = true
  merge              = true
  merge-method       = (repo default)
```

Defaults are stored per host CLI (the one you run `/do:config` in) under a `defaults` key, alongside settings like `autoUpdate`. `/do:config` never mirrors defaults into other installed environments.

## Supported Environments

```
  Claude Code      ~/.claude/commands/do/             YAML frontmatter + subdirectories
  OpenCode         ~/.config/opencode/commands/       YAML frontmatter + flat naming
  Antigravity CLI  ~/.gemini/antigravity-cli/skills/  Agent Skills (SKILL.md) — aliases: gemini, agy
  Codex            ~/.codex/skills/                   SKILL.md per-command directories
  Grok Build       ~/.grok/skills/                    SKILL.md per-command directories
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
  +------------------+  - Agent Skills / SKILL.md with inlined libs (Antigravity, Codex, Grok Build)
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
  ~/.grok/skills/do-push/SKILL.md
```

## Updating

On install, slashdo asks whether to **auto-update** (default: yes, Claude Code only). When enabled, the SessionStart hook silently runs `npx slash-do@latest` whenever it detects a newer version — no manual step needed. When disabled, the statusline shows a `⬆ /do:update` hint instead, and you update manually:

```bash
npx slash-do@latest        # from your terminal
```

```
/do:update                # from inside your AI coding assistant
```

The preference lives in `~/.claude/.slashdo-config.json` (`{ "autoUpdate": true }`). Change it any time without the prompt:

```bash
npx slash-do@latest --auto-update      # enable
npx slash-do@latest --no-auto-update   # disable
```

Existing installs from before this feature get asked on their next `npx slash-do@latest` run.

## Contributing

1. Commands live in `commands/do/` as Claude Code format `.md` files (source of truth)
2. Lib files (shared partials) live in `lib/`
3. The transformer handles format conversion for each environment
4. Capability-gated content: wrap environment-specific instructions in `<!-- if:teams -->…<!-- else -->…<!-- /if:teams -->` blocks. The transformer keeps the matching branch per the target environment's capability flag (`supportsTeams` in `src/environments.js`) and strips the markers — e.g. `do:better` uses `TeamCreate` on Claude Code and falls back to parallel sub-agents elsewhere.
5. Test with `node bin/cli.js --list` and `node bin/cli.js --dry-run`

## License

MIT
