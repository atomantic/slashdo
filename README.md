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
  <img src="https://img.shields.io/badge/commands-21-orange?style=flat-square" alt="commands" />
  <img src="https://img.shields.io/badge/license-MIT-lightgrey?style=flat-square" alt="license" />
</p>

---

## Philosophy

slashdo commands emphasize **high-quality software engineering over token conservation** — expect thorough reviews, multi-agent scans, and verification loops rather than shortcuts.

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

> **Command syntax:** examples below use Claude Code's `/do:<command>` (e.g. `/do:pr`). Codex uses `$do-<command>`; Antigravity CLI (`agy`/`gemini`), OpenCode, and Grok Build use `/do-<command>`.

Real end-to-end examples of how the commands compose. Every flag shown here is optional — the bare command always works.

### Ship the work in your working tree

You've been coding with your assistant and want it committed, pushed, and PR'd — `/do:pr` commits, pushes, opens a PR (GitHub `gh` or GitLab `glab`, auto-detected from the remote), and runs an unconditional self-review. Add an external reviewer and merge automatically once green: `/do:pr --review-with codex --merge`. See [Review loop](#review-loop) and [Auto-merge](#auto-merge-dopr---merge).

### Plan a task, then let an agent ship it

`/do:plan-task` investigates the codebase, drafts a decision-complete issue (problem, context, approach, acceptance criteria), shows it to you for approval, and files it in the repo's tracker:

```
/do:plan-task add a --json flag to the export command
/do:plan-task <idea> --yes                      # skip the approval gate (still stops on a blocking open question)
/do:plan-task <idea> --enhance-with codex,grok  # sharpen the draft through a second/third agent before the gate
```

`--enhance-with <list>` (same `agent[model]` grammar as `--review-with`) sharpens the draft through a sequential agent pipeline before the approval gate — you still approve the final text.

Suppose it files issue `#123`. Ship it immediately with `/do:next #123` — claims the issue, implements it in an isolated worktree, opens a reviewed PR that `Closes #123`, merges, and cleans up. Add `--plan` to approve a written implementation plan first.

### Run a whole backlog

`/do:replan` keeps the backlog honest; `/do:next` drains it — both work against your GitHub/GitLab issue tracker:

```
/do:replan                          # triage: close done/stale issues, file new opportunities
/do:next                            # claim + ship the next open item
/do:next --swarm=4                  # or ship up to 4 independent issues in parallel
```

On a shared or public tracker, add `--collaborators` so your agent only claims issues filed by a current repo collaborator (or `--self` for the stricter `@me`-only variant). See [Work tracking](#work-tracking).

### Audit and harden

```
/do:better --review-with claude,codex     # full DevSecOps audit → per-category PRs → review loop → merge
/do:simplify                              # refactor-only pass: architecture, DRY, cognitive load — behavior unchanged
/do:review --strict                       # deep code review of the current branch's changes
/do:review https://git.example.com/o/r/pull/12  # review a PR on any GitHub host — fixes pushed if writable, else inline
/do:review https://gitlab.example.com/g/sub/p/-/merge_requests/7  # same for a GitLab MR (gitlab.com or self-managed)
/do:depfree --heavy                       # remove unnecessary dependencies by writing replacement code
/do:scan ~/Downloads/sketchy-repo         # read-only malware/safety audit of an unfamiliar directory
```

Note: these only run their review loop **and auto-merge** when you pass (or have saved) `--review-with` — without it PRs are left open for manual review.

### Configure once, omit flags forever

```
/do:config --review-with=claude,codex     # every review-capable command now uses these reviewers
/do:config --merge                        # bare /do:pr auto-merges once reviews + CI are green
/do:config --review-models codex=o3       # pin the model a reviewer runs on
/do:config --project --review-with=none   # ...except this repo: no external reviewers here
/do:config                                # show global, per-project, and effective values
```

See [Configuration](#configuration-doconfig).

## Commands

All commands live under the `do:` namespace:

| Command | What it does |
|:---|:---|
| `/do:push` | Commit and push all work, logging it per the project's own changelog convention |
| `/do:pr` | Commit, push, and open a PR/MR with self-review. External reviewers only when listed ([Review loop](#review-loop)); `--merge` auto-merges once green ([Auto-merge](#auto-merge-dopr---merge)) |
| `/do:pr-better` | Run a full do:better audit on the current branch, commit fixes directly, then open a single PR |
| `/do:fpr` | Fork PR — push to fork, PR against upstream |
| `/do:rpr` | Resolve PR review feedback with parallel agents |
| `/do:release` | Create a release PR with version bump and changelog |
| `/do:review` | Deep code review of changed files, a local branch, a PR, or a GitLab MR (`--strict`/`--nuclear` raise the bar) |
| `/do:better` | Full DevSecOps audit with multi-agent scan, remediation, and per-category PRs |
| `/do:better-swift` | SwiftUI DevSecOps audit with multi-platform coverage (iOS, macOS, watchOS, tvOS, visionOS) |
| `/do:simplify` | Refactor-only audit — architecture, DRY, simplification, cognitive load ([details](#refactor-only-dosimplify)) |
| `/do:scan` | Read-only safety audit of an unfamiliar directory — malware patterns, network calls, vulnerable deps |
| `/do:depfree` | Audit dependencies, remove unnecessary ones, write replacement code (`--heavy` for a deeper pass) |
| `/do:goals` | Generate GOALS.md from codebase analysis — `--prd` generates PRD.md instead ([details](#prd-mode-dogoals---prd)) |
| `/do:prd` | Generate a detailed PRD.md from codebase analysis (`/do:goals --prd`) ([details](#prd-mode-dogoals---prd)) |
| `/do:plan-task` | Investigate the codebase, draft a decision-complete issue, get approval, file it in the tracker |
| `/do:replan` | Audit/triage the issue tracker — close completed issues, suggest new work ([Work tracking](#work-tracking)) |
| `/do:next` | Claim the next tracker issue, implement it in an isolated worktree, ship a reviewed PR. `--swarm[=N]` ships several in parallel ([Work tracking](#work-tracking)) |
| `/do:omd` | Audit and optimize markdown files against best practices |
| `/do:config` | View or set saved defaults so future commands can omit their flags ([Configuration](#configuration-doconfig)) |
| `/do:update` | Update slashdo to latest version |
| `/do:help` | List all available commands |

## Refactor-only (`/do:simplify`)

`/do:simplify` is `/do:better --simplify-only`: the same pipeline narrowed to **refactoring, architecture, DRY, simplification, and cognitive load**; security, runtime bugs, performance, and test authoring are out of scope. **Every fix must be observably behavior-preserving** — the existing test suite passes unmodified as the proof. See [docs/simplify.md](docs/simplify.md) for the audit-agent roster and scoping gates.

```
/do:simplify                              # audit → refactor PRs → review loop
/do:simplify --scan-only                  # just show me what's costing me
/do:simplify --review-with claude src/     # scope to a path, run a reviewer, auto-merge on clean
/do:pr-better --simplify-only             # fold a refactor pass into the feature PR you're building
```

Every `/do:better` flag works here — `--interactive`, `--scan-only`, `--no-merge`, and the whole [review loop](#review-loop) set.

## PRD mode (`/do:goals --prd`)

`/do:goals --prd` (shorthand: `/do:prd`) runs the same discovery pipeline as `/do:goals` but writes a requirements-level `PRD.md` instead of a strategic `GOALS.md`, with stable `FR-`/`NFR-`/`NR-` requirement IDs that persist across `--refresh` runs. See [docs/prd-mode.md](docs/prd-mode.md) for what PRD.md contains and how discovery mines tests for implicit requirements.

```
/do:goals --prd                # generate PRD.md autonomously
/do:prd --interactive          # same, with a validation pass on requirements, guardrails, and metrics
/do:prd --refresh              # re-scan and update an existing PRD.md, preserving requirement IDs
```

## Review loop

`/do:pr`, `/do:release`, `/do:pr-better`, `/do:review`, `/do:better`, `/do:better-swift`, `/do:simplify`, `/do:depfree`, and `/do:rpr` share one review system: pick the reviewer(s) with `--review-with`; companion flags control how the loop runs. **No reviewer is ever hardcoded** — omit the flag and no external review runs (self-review still does). Implementation details live in [docs/review-loop.md](docs/review-loop.md).

### Reviewers

| Slug | What runs | Model pinnable? |
|:---|:---|:---|
| `codex` | Codex CLI, headless, local | yes |
| `claude` | Claude Code CLI, headless, local | yes |
| `agy` | Antigravity CLI (`agy` binary; aliases `gemini`, `antigravity`) | yes |
| `grok` | Grok CLI, headless, local | yes |
| `pi` | Pi CLI, tool-free with the complete diff inlined — review-only | yes |
| `cursor` | Cursor Agent CLI, headless (`cursor-agent`, alias `cursor`) | yes |
| `opencode` | OpenCode CLI, headless (aliases `zen`, `opencode-zen`) | yes |
| `ollama` | Local Ollama model, review-only. Bare `ollama` auto-selects your most capable installed model | yes |
| `cmd[<invocation>]` | **Escape hatch** for any other harness — your own shell command, review prompt on stdin. Command line or global config only, never a repo's `.slashdo.json` ([docs/review-loop.md](docs/review-loop.md)) | n/a |
| `@<login>` | Any user or App/bot on the project's code host (e.g. `@octocat` on GitHub, `@jane.doe` on GitLab) — slashdo requests their review on the PR/MR and fixes what it surfaces | no |
| `copilot` | **Legacy.** GitHub's cloud Copilot review (GitHub only); still supported when named, but never auto-selected | no |

Reviewers run **in the order listed** — nothing is ever added implicitly.

```
/do:pr --review-with codex,agy                      # run several — each sees the prior's fixes
/do:pr --review-with cursor[gpt-5]~effort=max       # pinned model + reasoning effort
/do:pr --review-with opencode[provider/model]       # supported provider/model configured in OpenCode
/do:pr --review-with pi~effort=low~max=1            # Pi, reviewed tool-free with a capped budget
/do:pr --review-with codex,ollama~opt               # ollama is optional — can't block the merge
```

- **Model pinning** (`<agent>[<model>]`): pin per run, or save defaults with `/do:config --review-models codex=o3,claude=claude-opus-4-8,cursor=gpt-5,opencode=provider/model`. An explicit bracket always wins.
- **Optional reviewers** (`~opt`): findings still get fixed, but an inconclusive result never blocks `--merge`. A hard error still does.
- **Per-reviewer iteration caps** (`~max=<n>`): caps that reviewer's review→fix→re-review cycles (default 3, `ollama` has its own cap). `0` = loop-until-clean, bounded by a 10-iteration guardrail.
- **Per-reviewer reasoning effort** (`~effort=<level>`, one of `low`/`medium`/`high`/`xhigh`/`max`): e.g. `cursor[gpt-5]~effort=max`, `opencode[provider/model]~effort=high` — a saved `--review-models cursor=…` default pairs with a bare `cursor~effort=…`. Falls back to prompt guidance where a reviewer has no matching control.

All three suffixes chain in any order and are shell-safe. `~max` is ignored (with a warning) in `--review-mode parallel`. None affects reviewer identity, so `ollama~effort=high` and `ollama` dedupe to one pass.

### Loop flags

| Flag | Default | What it does |
|:---|:---|:---|
| `--review-with <list>` | none | Comma-list of reviewers, run in order. Each entry may carry `~opt`, `~max=<n>`, and/or `~effort=<level>` |
| `--review-iterations <n>` | `1` | Cap review-and-fix cycles for a `copilot`/`@<login>` pass. `0` = loop-until-clean (10-iteration guardrail). Local CLIs use `~max=<n>` instead |
| `--review-mode <series\|parallel>` | `series` | `series`: each reviewer sees prior fixes. `parallel`: all run concurrently, deduped union applied once (faster; `~max` and stop-mode ignored) |
| `--review-stop-on-findings` | off | Stop after the first reviewer that fixes ≥1 finding. Exclusive with `--review-stop-on-clean` |
| `--review-stop-on-clean` | off | Stop after the first reviewer that reports zero findings |
| `--reviewer-applies` | off | Let the reviewer edit the tree itself instead of the orchestrator applying its findings. Only `codex` supports this; every other reviewer is forced back to review-only |

**The merge gate.** Commands that merge (e.g. `/do:release`, `/do:pr --merge`) require the multi-reviewer aggregate status to be `clean` — or `partial`, if you explicitly opted into a stop-mode short-circuit. A `dirty` or `inconclusive` aggregate blocks the merge, even if other passes returned clean.

**Command-specific behavior:** `/do:review` runs its own focused self-review lenses first, then any `--review-with` agents as additional reviewers. `/do:better`/`/do:better-swift`/`/do:simplify`/`/do:depfree` run the chosen reviewers as the post-PR loop — **omitting `--review-with` skips the loop and the auto-merge**. `/do:rpr` resolves existing review threads from any author, requesting a new one only if you name a reviewer; it accepts only `--review-with`/`--reviewer-applies` and drops `@<login>` entries with a notice.

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
| `--merge` | off — PR left open | After review **and** CI pass, merge the PR. Eligible only when the review aggregate is `clean` (or `partial` under an explicit stop-mode) |
| `--merge=<method>` | — | `--merge` plus pin the method: `squash`, `rebase`, or `merge` |
| `--merge-method <method>` | repo's allowed method | Pin the method without restating `--merge`. Unset: slashdo prefers `squash`, then `merge`, then `rebase` |
| `--no-merge` | — | Leave the PR open for this run, overriding a saved `merge` default |

It never merges on a non-clean review aggregate, before checks pass, or over branch protection. Save the behavior once with `/do:config --merge` — `/do:pr` defaults to leaving the PR open, `/do:next` defaults to merging its own claim's PR (`--no-merge` opts out). See [docs/auto-merge.md](docs/auto-merge.md) for how CI-awaiting and the saved defaults interact per command.

## Work tracking

slashdo tracks todo items in your project's issue tracker — GitHub or GitLab, auto-detected via an authenticated `gh`/`glab` (Enterprise/self-managed included); other trackers such as Jira are tracked in [#372](https://github.com/atomantic/slashdo/issues/372). `/do:replan` triages issues, `/do:next` claims them, `/do:plan-task` files them, and the audit commands file deferred findings as labeled issues. The stable item ID is the **issue number** (e.g. `#42`). **Legacy `PLAN.md`?** Run `/do:replan` once to migrate its items to labeled issues and retire the file.

```
/do:replan                            # triage the tracker (close done/stale, file new work)
/do:next                              # claim + ship the oldest eligible open issue
/do:next #42                          # cherry-pick a specific issue
/do:next --swarm #12 #14 #15          # swarm exactly the issues you name
/do:next --collaborators --trusted-authors howlingmime,Joebok
/do:next --model light                # only claim work hinted as cheap to run
```

| Flag | Default | What it does |
|:---|:---|:---|
| `--issues-label <name>` | `plan` | The label that scopes which issues are plan items |
| `--model <tier>[,…]` | off — any tier | (`/do:next`) Claim only issues hinted `model:light`/`medium`/`heavy`. `none` matches untiered issues |
| `--effort <level>[,…]` | off — any level | (`/do:next`) Claim only issues hinted `effort:low`/`medium`/`high`/`xhigh`/`max`. `none` matches unlabelled issues |
| `--self` / `--no-self` | off — any author | (`/do:next`) Claim only issues **you** filed (`@me`). Explicit `#<num>` for someone else is refused |
| `--collaborators` / `--no-collaborators` | off — any author | (`/do:next`) Claim only issues filed by a live repo collaborator, union `--trusted-authors`. Fail closed if that list can't be fetched |
| `--trusted-authors <list>` | empty | (`/do:next`) Extra logins unioned into the collaborators gate. No effect when `--collaborators` is off. `none` clears |

**Claim only collaborator-authored issues (`--collaborators`)** checks the **live** collaborator list from the host API, unioned with the **Extra trusted authors** list (`--trusted-authors`, e.g. `howlingmime,Joebok`). `--self` is the stricter `@me`-only variant.

**`/do:next` is label-agnostic by default** — `--issues-label` scopes the commands that *file or triage* plan items, but a bare `/do:next` claims the oldest open issue regardless of label. Pass `--issues-label <name>` (or save it) to restrict auto-pick to a curated queue.

**Dispatch hints (`model:` + `effort:`)** let issues carry a recommendation for how to run the work; `/do:plan-task` infers them, `/do:next --model`/`--effort` filter the queue, and `--swarm[=N]` dispatches each worker at its own issue's tier (default 3 agents, clamped `1..6`) — name the issues yourself with `--swarm #12 #14 #15`. GitLab writes them as scoped labels (`model::light`, double-colon). See [docs/work-tracking.md](docs/work-tracking.md) for the full rationale, the epic-aware claiming rule, and swarm's scheduling/wave behavior.

## Configuration (`/do:config`)

Rather than passing flags every time, save them once and let future commands pick them up automatically.

```
/do:config --review-with=claude,codex,cursor[gpt-5]~effort=max,opencode[provider/model],ollama[qwen2.5-coder:32b]
/do:config --review-models codex=o3,claude=claude-opus-4-8,cursor=gpt-5,opencode=provider/model
/do:config --issues-label plan
/do:config --merge --merge-method squash
/do:config --self
/do:config --collaborators
/do:config --trusted-authors howlingmime,Joebok
/do:config                                # show what's saved and what's effective
```

| Usage | What it does |
|:---|:---|
| `/do:config` (or `--show`) | Print the current global + per-project defaults and the effective merged values |
| `/do:config --review-with=… [--review-iterations=N] [--review-mode=…] […]` | Save review-loop defaults (validated with the same rules the review commands use) |
| `/do:config --review-models <agent>=<model>,…` | Save the default model per reviewer. Merges key-by-key — setting one agent leaves the others intact; an empty value (`codex=`) clears one |
| `/do:config --issues-label=<name>` | Save the label that scopes which issues are plan items (default `plan`) |
| `/do:config --self\|--no-self` | Save the self-only issue gate for `/do:next` |
| `/do:config --collaborators\|--no-collaborators` | Save the collaborators-only issue gate for `/do:next` (union `--trusted-authors`) |
| `/do:config --trusted-authors <list>` | Save extra trusted authors unioned into the collaborators gate; `none` clears |
| `/do:config --merge\|--no-merge [--merge-method=squash\|rebase\|merge]` | Save `/do:pr`'s auto-merge default (and method) |
| `--project` | Read/write a per-repo `.slashdo.json` instead of the global config; per-project values override global ones key by key |
| `--unset <key>` | Clear one saved default |
| `--reset` | Clear all saved defaults in the chosen scope |

**Precedence (highest first):** explicit flag → per-project `.slashdo.json` → global `~/.claude/.slashdo-config.json` → built-in default. `--review-with none` and the `--no-*` forms (`--no-merge`, `--no-self`, `--no-collaborators`) override a saved `true` for one run.

A typical split: personal preferences go global, repo policy goes in a committed `.slashdo.json` — `/do:config --review-with=codex --merge` everywhere, `/do:config --project --collaborators --trusted-authors howlingmime,Joebok` for one repo. See [docs/config.md](docs/config.md) for how a project default masks an inherited global one.

## Supported Environments

Each environment formats commands appropriately for its host assistant:

| Assistant / Environment | Invocation Syntax | Installed Path | Format |
|:---|:---|:---|:---|
| **Claude Code** | `/do:<command>` | `~/.claude/commands/do/` | YAML frontmatter + subdirectories |
| **Codex** | `$do-<command>` | `~/.codex/skills/` | SKILL.md per-command directories |
| **Antigravity CLI** (`agy`/`gemini`) | `/do-<command>` | `~/.gemini/antigravity-cli/skills/` | Agent Skills (SKILL.md) |
| **OpenCode** | `/do-<command>` | `~/.config/opencode/commands/` | YAML frontmatter + flat naming |
| **Grok Build** | `/do-<command>` | `~/.grok/skills/` | SKILL.md per-command directories |

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

A filtered install also pulls in whatever it delegates to (`prd` → `goals`, `pr-better` → `better` + `pr`) so a wrapper never points at a missing command.

## How It Works

```
  Source (commands/do/*.md)
       |
       v
  +------------------+
  |   Transformer    |  Converts format per environment:
  |                  |  - YAML frontmatter (Claude, OpenCode)
  +------------------+  - Agent Skills / SKILL.md + bundled lib/ (Antigravity, Codex, Grok Build)
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

Integrating slashdo's commands into a host that isn't one of the five bundled environments? See [Embedding command prompts](./CONTRIBUTING.md#embedding-command-prompts-integrator-api) in CONTRIBUTING.md for the renderer API.

## Updating

On install, slashdo asks whether to **auto-update** (default: yes, Claude Code only). When enabled, the SessionStart hook checks npm for a newer version and installs that exact version (never the mutable `@latest` tag) with lifecycle scripts disabled. When disabled, or when npm isn't on `PATH` (the npm-free `install.sh` path), the statusline shows an update hint instead:

```bash
npx slash-do@latest        # update from your terminal
npx slash-do@latest --auto-update      # enable auto-update
npx slash-do@latest --no-auto-update   # disable it
```

```
/do:update                # update from inside your AI coding assistant
```

The preference is stored in `~/.claude/.slashdo-config.json` (`{ "autoUpdate": true }`).

## Contributing

Issues and PRs are welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md) for the project structure, local dev/test workflow, and PR conventions.

## License

MIT
