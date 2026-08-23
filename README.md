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

> **Note on Command Syntax:** In the examples below, Claude Code syntax (`/do:<command>`) is shown. Syntax varies slightly by AI assistant:
> - **Claude Code**: `/do:*` (e.g. `/do:plan-task`, `/do:next`, `/do:pr`)
> - **Codex**: `$do-*` (e.g. `$do-plan-task`, `$do-next`, `$do-pr`)
> - **Antigravity CLI (`agy`/`gemini`), OpenCode, Grok Build**: `/do-*` (e.g. `/do-plan-task`, `/do-next`, `/do-pr`)

Real end-to-end examples of how the commands compose. Every flag shown here is optional — the bare command always works.

### Typical Developer Loop: Plan → Implement → Custom Review PR

A complete end-to-end workflow from idea to reviewed, merged PR:

1. **Plan & file a decision-complete task:**
   ```
   /do:plan-task add a --json flag to the export command
   ```
   *Investigates the codebase, drafts a comprehensive issue with acceptance criteria, and files it in your tracker.*

2. **Claim & implement the task in isolation:**
   ```
   /do:next --issues #123
   ```
   *Claims issue `#123`, implements the solution in an isolated git worktree, verifies tests, and opens a PR.*

3. **Ship with custom multi-agent code reviews:**
   ```
   /do:pr --review-with=ollama[qwen2.5-coder:32b]~opt,codex[gpt-5.6-luna]~effort=max~opt --merge
   ```
   *Runs a local fast Ollama pass (`~opt` non-blocking) followed by a maximum-effort Codex pass (`~effort=max~opt`), automatically applying fixes and merging once CI passes.*

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
enhancement agents (`codex`, `claude`, `agy`, `grok`, `cursor` — same `agent[model]` grammar as
`--review-with`, e.g. `--enhance-with codex[o3],cursor`), each refining the previous
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

With the saved `--issues` default, every plan-aware command (`/do:next`, `/do:replan`, `/do:better`, `/do:simplify`, `/do:depfree`, `/do:review`, `/do:rpr`) reads and files tracker issues instead of PLAN.md lines. On a shared tracker, add `--self` so your agent only ever claims issues **you** filed — see [Issue mode](#issue-mode---issues).

### Audit and harden

```
/do:better --review-with claude,codex     # full DevSecOps audit → per-category PRs → review loop → merge
/do:simplify                              # refactor-only pass: architecture, DRY, cognitive load — behavior unchanged
/do:review --strict                       # deep code review of the current branch's changes
/do:depfree --heavy                       # remove unnecessary dependencies by writing replacement code
/do:scan ~/Downloads/sketchy-repo         # read-only malware/safety audit of an unfamiliar directory
```

Note: `/do:better`, `/do:better-swift`, `/do:simplify`, and `/do:depfree` only run their review loop **and auto-merge** when you pass (or have saved) `--review-with` — without it they leave their PRs open for manual review.

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
| `/do:push` | Commit and push all work, logging it per the project's own changelog convention |
| `/do:pr` | Commit, push, and open a PR (GitHub `gh`) or merge request (GitLab `glab`) with self-review. External reviewers run only when you list them ([Review loop](#review-loop)); `--merge` auto-merges once reviews and CI pass ([Auto-merge](#auto-merge-dopr---merge)) |
| `/do:pr-better` | Run a full do:better audit on the current branch, commit fixes directly, then open a single PR |
| `/do:fpr` | Fork PR — push to fork, PR against upstream |
| `/do:rpr` | Resolve PR review feedback with parallel agents |
| `/do:release` | Create a release PR with version bump and changelog |
| `/do:review` | Deep code review of changed files against best practices (`--strict`/`--nuclear` raise the bar) |
| `/do:better` | Full DevSecOps audit with multi-agent scan, remediation, and per-category PRs |
| `/do:better-swift` | SwiftUI DevSecOps audit with multi-platform coverage (iOS, macOS, watchOS, tvOS, visionOS) |
| `/do:simplify` | Refactor-only audit — architecture, DRY, simplification, cognitive load — as per-category PRs that must not change behavior ([details](#refactor-only-dosimplify)) |
| `/do:scan` | Read-only safety audit of an unfamiliar directory — flags malware patterns, network calls, and vulnerable deps without executing code |
| `/do:depfree` | Audit dependencies, remove unnecessary ones, write replacement code (`--heavy` targets all non-foundational libraries) |
| `/do:goals` | Generate GOALS.md from codebase analysis — `--prd` generates a detailed PRD.md instead ([details](#prd-mode-dogoals---prd)) (autonomous by default; `--interactive` to review with you) |
| `/do:prd` | Generate a detailed PRD.md from codebase analysis (`/do:goals --prd`) ([details](#prd-mode-dogoals---prd)) |
| `/do:plan-task` | Investigate the codebase, draft a decision-complete issue, show it for approval, file it in the tracker ([workflow](#plan-a-task-then-let-an-agent-ship-it)) |
| `/do:replan` | Audit/triage the plan — prune completed items, suggest new work — in `PLAN.md` or the issue tracker ([Issue mode](#issue-mode---issues)) |
| `/do:next` | Claim the next unclaimed plan item or issue, implement it in an isolated worktree, ship a reviewed PR, clean up. `--swarm[=N]` ships several independent issues in parallel — auto-picked, or the exact numbers you name ([Issue mode](#issue-mode---issues)) |
| `/do:omd` | Audit and optimize markdown files against best practices |
| `/do:config` | View or set saved defaults so future commands can omit their flags ([Configuration](#configuration-doconfig)) |
| `/do:update` | Update slashdo to latest version |
| `/do:help` | List all available commands |

## Refactor-only (`/do:simplify`)

`/do:simplify` is `/do:better --simplify-only`: the same pipeline — worktree isolation, per-category PRs, CI, review loop, merge — with the audit narrowed to **refactoring, architecture, DRY, simplification, and cognitive load**. Security, runtime bugs, performance, stack-specific gotchas, dependency removal, test authoring, and UX are out of scope for the run.

Five audit agents run instead of eight-to-ten: Code Quality and Architecture & SOLID (each narrowed to its structural focus, dropping the runtime and API-contract halves), DRY & YAGNI, Structural Ambition (`--strict` is implied), and a Cognitive Load & Readability agent that runs only in this mode — mixed abstraction levels in one function, flag arguments, names that lie, comments standing in for a rename, action at a distance, conditional ladders a lookup table would collapse. Size thresholds (god files, over-long functions, nesting depth) stay with the architecture agent, so the two never double-report the same site.

Four gates keep a refactor pass from inventing work. **The deletion test**: a proposed abstraction must concentrate complexity behind a smaller interface, not spread it across callers — the guard against a DRY pass merging three incidental look-alikes into one abstraction serving three masters. **Depth over size**: judge a module by how much behavior sits behind how small an interface, not by line count. **Churn bias**: findings are ranked against the files people actually edit, and a cleanup in dormant code drops a severity tier — a refactor nobody cashes in isn't worth a PR. **No re-litigating rejections**: reframings earlier runs tried and rejected are recorded in the plan and fed back in, so each run starts where the last one stopped.

The contract that makes it safe to merge: **every fix must be observably behavior-preserving**, and the existing test suite must keep passing *unmodified* as the proof. A changed assertion means the refactor moved behavior — it gets reverted, not accommodated. Findings that can only be fixed by changing behavior are deferred to `PLAN.md` (or the tracker under `--issues`) instead of applied. Test enhancement is the one phase that's skipped; everything else runs as usual.

```
/do:simplify                              # audit → refactor PRs → review loop
/do:simplify --scan-only                  # just show me what's costing me
/do:simplify --review-with claude src/     # scope to a path, run a reviewer, auto-merge on clean
/do:pr-better --simplify-only             # fold a refactor pass into the feature PR you're building
```

Every `/do:better` flag works here — `--interactive`, `--scan-only`, `--no-merge`, `--issues`, and the whole [review loop](#review-loop) set.

## PRD mode (`/do:goals --prd`)

`/do:goals --prd` (shorthand: `/do:prd`) runs the same discovery pipeline as `/do:goals` but writes a `PRD.md` instead of a `GOALS.md` — a detailed, requirements-level document rather than a strategic one. GOALS.md answers *why* the project exists; PRD.md answers *what exactly* the product must (and must not) do.

PRD.md is built from: an overview and problem statement, goals & objectives (aligned with an existing GOALS.md's Core Tenets when one exists), target users/personas, **functional requirements** grouped by feature area (stable `FR-` IDs, MUST/SHOULD/MAY priority, acceptance criteria), **non-functional requirements** (`NFR-` IDs — performance, security, reliability, usability), **negative requirements** (`NR-` IDs — explicit things the system must not do), an out-of-scope list, assumptions & constraints, success metrics, and open questions.

An extra discovery agent mines test suites, validation/guard-clause logic, and auth/rate-limit code for requirements that are already implicitly specified in the codebase, since executable tests are high-confidence evidence of intended behavior. Numeric success metrics are never fabricated — where the codebase doesn't evidence a concrete target, it's left as an open question instead.

```
/do:goals --prd                # generate PRD.md autonomously
/do:prd --interactive          # same, with a validation pass on requirements, guardrails, and metrics
/do:prd --refresh              # re-scan and update an existing PRD.md, preserving requirement IDs
```

Requirement IDs are stable across `--refresh` runs — unchanged requirements keep their ID, new ones get the next unused number, and requirements that no longer hold are marked `(status: removed — verify)` rather than silently deleted.

## Review loop

`/do:pr`, `/do:release`, `/do:pr-better`, `/do:review`, `/do:better`, `/do:better-swift`, `/do:simplify`, `/do:depfree`, and `/do:rpr` share one review system: you pick the reviewer(s) with `--review-with`, and a set of companion flags controls how the loop runs. **No reviewer is ever hardcoded, in any command** — omit the flag and no external review runs (each command still runs its own unconditional self-review gate).

### Reviewers

| Slug | What runs | Model pinnable? |
|:---|:---|:---|
| `codex` | The Codex CLI in headless mode, reviewing locally | yes |
| `claude` | The Claude Code CLI in headless mode | yes |
| `agy` | The Antigravity CLI (`agy` binary; aliases: `gemini`, `antigravity`) | yes |
| `grok` | The Grok CLI in headless mode, reviewing locally | yes |
| `cursor` | The Cursor Agent CLI in headless mode (`cursor-agent`, alias of `cursor`; never a generic `agent` that is actually Grok) | yes |
| `ollama` | A local Ollama model — review-only (non-agentic). Bare `ollama` auto-selects your most capable installed coding model | yes |
| `@<login>` | Any GitHub user or App/bot (e.g. `@octocat`, `@some-app[bot]`): slashdo requests their review on the PR, waits for it, and fixes what it surfaces. GitHub only; slashdo never posts an approval itself | no |
| `copilot` | **Legacy.** GitHub's cloud Copilot review on the PR (GitHub only). Still fully supported when you name it, but no command selects it for you | no |

Reviewers run **in the order listed**, and whatever you list is exactly what runs — `--review-with codex` runs codex only; nothing is ever added implicitly.

```
/do:pr --review-with codex                          # one local reviewer
/do:pr --review-with codex,agy                      # codex, then Antigravity — each sees the prior's fixes
/do:pr --review-with claude[claude-opus-4-8],codex[o3]   # pin the model per reviewer
/do:pr --review-with cursor[gpt-5]~effort=max       # Cursor Agent, pinned model + reasoning effort
/do:pr --review-with ollama[qwen2.5-coder:32b]      # pin a specific installed Ollama model
/do:pr --review-with codex,@org-review-bot          # codex, then request a review from a GitHub bot
/do:pr --review-with codex,ollama~opt               # ollama is optional — it runs, but can't block the merge
/do:pr --review-with claude~max=2,ollama~max=1,codex~max=3   # a different iteration budget per reviewer
/do:pr --review-with none                           # skip external review for this run (overrides a saved default)
```

**Model pinning** (`<agent>[<model>]`) works per run as shown, or save per-reviewer defaults with `/do:config --review-models codex=o3,claude=claude-opus-4-8,cursor=gpt-5` so runs can omit the bracket. An explicit bracket always wins over the saved default. Cursor also accepts a model string that already encodes effort (`cursor[claude-opus-4-7[thinking=true,effort=high]]`) — that is Cursor's native variant syntax and is passed through as `--model` unchanged.

**Optional reviewers** (`~opt` suffix): the reviewer runs and its findings get fixed, but an *inconclusive* result (timeout / skipped / no verdict) is excluded from the merge gate, so it never blocks `--merge`. A hard error from it (broken build / failed tests) still blocks. Use it for a second-opinion reviewer that doesn't reliably return a verdict, such as a local Ollama model.

**Per-reviewer iteration caps** (`~max=<n>` suffix): caps how many **review → fix → re-review cycles** that one reviewer runs. It is the per-entry form of `--review-iterations`, and unlike that flag it reaches every reviewer type — including `codex`/`agy`/`claude`/`grok`/`cursor` and `ollama`, whose caps are otherwise fixed at 3 — so a single run can budget each reviewer separately: `--review-with claude~max=2,ollama~max=1,codex~max=3`. `<n>` is a non-negative integer; `0` means "loop until clean", bounded by a 10-iteration safety guardrail. A reviewer that stops because it spent a cap *you* set reports `capped`, which counts as clean for the merge gate — as opposed to `guardrail`, which is what a *built-in* cap reports when it cuts off a reviewer that was still finding real problems, and which blocks the merge.

**Per-reviewer reasoning effort** (`~effort=<level>` suffix): specifies the reasoning effort level (`low`, `medium`, `high`, `xhigh`, `max`) for that reviewer: `--review-with codex[gpt-5.6-luna]~effort=max~opt`, `--review-with claude~effort=high~max=2`, `--review-with cursor[gpt-5]~effort=max`. For Cursor the suffix is folded into `--model` as `[effort=<level>]` (the CLI has no `--effort` flag); pair it with a `cursor[<model>]` bracket or a saved `--review-models cursor=…` default so there is a model to attach the variant to.

`~max` applies in `series` mode (the default). In `--review-mode parallel` each reviewer runs a single review-only pass and the orchestrator applies the union once, so there are no per-reviewer cycles to cap — `~max` is ignored there with a warning.

All three suffixes chain in any order and are shell-safe: `codex[gpt-5.6-luna]~effort=max~opt~max=1`. None affects reviewer identity, so `ollama~effort=high` and `ollama` still dedupe to one pass. All ride through `/do:config` saved defaults.

### Loop flags

| Flag | Default | What it does |
|:---|:---|:---|
| `--review-with <list>` | none — no external reviewer | Comma-list of reviewers, run in order (see above). Each entry may carry `~opt` and/or `~max=<n>` |
| `--review-iterations <n>` | `1` | Cap review-and-fix cycles for a `copilot` or `@<login>` pass: request one review, apply every fix, stop (exiting early on 0 comments). `0` restores loop-until-clean, bounded by a 10-iteration guardrail. No effect on `codex`/`agy`/`claude`/`grok`/`cursor` (fixed 3-iteration cap) or `ollama` (own fixed cap) — use the per-entry `~max=<n>` suffix to move those, or to budget each reviewer separately |
| `--review-mode <series\|parallel>` | `series` | `series` runs each reviewer to completion before the next starts, so later reviewers see earlier reviewers' committed fixes (list order matters). `parallel` runs every review concurrently against one frozen baseline and applies the deduped union of findings in a single pass — faster, but no reviewer sees another's fixes, and `--reviewer-applies`, the stop-mode flags, and per-entry `~max=<n>` are ignored. `/do:rpr` ignores this flag |
| `--review-stop-on-findings` | off | Stop the loop after the first reviewer that fixes at least one finding; skip the rest. Mutually exclusive with `--review-stop-on-clean` |
| `--review-stop-on-clean` | off | Stop after the first reviewer that reports zero findings |
| `--reviewer-applies` | off | Let the reviewing CLI edit the working tree directly, instead of the orchestrator applying its findings. Applies to `codex`/`agy`/`claude`/`grok`/`cursor` passes; no effect on `copilot`, `@<login>` (both review read-only cloud-side), or `ollama` (always review-only) |

By default the orchestrator that opened the PR applies every reviewer's fixes itself. Pass `--reviewer-applies` when you want the reviewing agent's *judgment* in the final patch (e.g. asking Antigravity to both find and patch its own concerns).

**The merge gate.** Commands that merge (e.g. `/do:release`, `/do:pr --merge`) require the multi-reviewer aggregate status to be `clean` — or `partial`, if you explicitly opted into a stop-mode short-circuit. A `dirty` aggregate (build/test broken on some pass) or an `inconclusive` one (any executed pass timed out, errored, hit its guardrail, was skipped, or — for ollama — only partially reviewed the diff) blocks the merge, even if other passes returned clean.

### Command-specific behavior

- **`/do:review`** — the listed agents run *after* the host CLI's own multi-agent self-review; the list names *additional* reviewers.
- **`/do:better` / `/do:better-swift` / `/do:simplify` / `/do:depfree`** — the chosen reviewers run as the post-PR review loop (per PR, in parallel for the multi-PR better commands). **Omitting `--review-with` skips the review loop and the auto-merge** — PRs are left open for manual review.
- **`/do:rpr`** — resolves review threads from any author (Copilot, human, or bot). Like every other command it has **no default reviewer**: omit `--review-with` (and set no saved default) and rpr requests nothing — it just fetches and resolves the unresolved threads the PR already carries. Name a reviewer and rpr requests it, then loops review → fix → re-review. It accepts only `--review-with` and `--reviewer-applies` (not `--review-iterations`, `--review-mode`, or the stop-mode flags), and it doesn't support `@<login>` entries — it drops them with a notice.

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

Save the behavior once with `/do:config --merge` (see [Configuration](#configuration-doconfig)). Only `/do:pr` reads the saved `merge`/`merge-method` defaults — `/do:better`, `/do:better-swift`, `/do:simplify`, `/do:depfree`, and `/do:release` keep their own documented merge behavior.

## Issue mode (`--issues`)

By default the plan lives in `PLAN.md`. Pass `--issues` (or save it — `/do:config --issues`) to track it in your GitHub/GitLab issue tracker instead. **Every command that records plan items understands it**: `/do:replan` triages issues; `/do:next` claims them; `/do:better`, `/do:better-swift`, `/do:simplify`, and `/do:depfree` file deferred findings as labeled issues; `/do:review` and `/do:rpr` file deferred findings as issues instead of PLAN.md lines. `--no-issues` on a single run overrides a saved default.

```
/do:replan --issues                       # triage the tracker instead of PLAN.md
/do:replan --issues --interactive         # approve each close/create before it happens
/do:next --issues                         # claim + ship the oldest eligible open issue
/do:next --issues #42                     # cherry-pick a specific issue
/do:next --issues --swarm                 # ship 3 independent issues in parallel
/do:next --issues --swarm #12 #14 #15     # or swarm exactly the issues you name
/do:next --issues --swarm=2 12,14,15,19   # named batch, 2 at a time (waves)
/do:next --issues --self                  # only claim issues YOU filed (security boundary)
/do:next --issues --model light           # only claim work hinted as cheap to run
```

| Flag | Default | What it does |
|:---|:---|:---|
| `--issues` | off — plan lives in `PLAN.md` | Track plan items as tracker issues. Requires an authenticated `gh` (GitHub) or `glab` (GitLab); commands abort rather than silently falling back |
| `--issues-label <name>` | `plan` | The label that scopes which issues are plan items, so bug reports and questions in the same tracker aren't mistaken for the plan |
| `--model <tier>[,…]` | off — any tier | (`/do:next`) Claim only issues hinted `model:light`/`medium`/`heavy`. `none` matches untiered issues |
| `--effort <level>[,…]` | off — any level | (`/do:next`) Claim only issues hinted `effort:low`/`medium`/`high`/`xhigh`/`max`. `none` matches unlabelled issues |

**Migration is automatic.** `/do:replan --issues` always reads `PLAN.md` if one exists: every open item is migrated into the tracker (one labeled issue each) and `PLAN.md` is emptied to a short note that the roadmap now lives on the Issues page. Before migrating an item, replan surfaces any open question it finds and asks you to resolve it, so every issue it files is immediately claimable. In issue mode the stable item ID is the **issue number** (e.g. `#42`); concurrent agents claim work via branch names carrying it.

**`/do:next` is label-agnostic by default.** `--issues-label` scopes the commands that *file or triage* plan items, but a bare `/do:next --issues` claims the oldest open issue regardless of label (skipping only parking labels like `future`/`blocked`, epics with open children, and anything already in flight or assigned) — so a repo full of ordinary `bug`/`enhancement` issues works without stamping a `plan` label on everything. Pass `--issues-label <name>` (or save it) to restrict auto-pick to a curated queue.

**Claim only your own issues (`--self`).** By default `/do:next` claims any open issue regardless of author — which on a shared tracker means acting on work items (and the instructions in their bodies) opened by anyone. `--self` restricts every claim — auto-pick, `--swarm` batches, and explicit `#<num>` — to issues authored by the running `gh` account; an explicit number for someone else's issue is **refused, not overridden**. Save it with `/do:config --self` so a multi-contributor tracker never auto-feeds third-party issues into your agent; `--no-self` on a run reverts to any-author. Issues mode only (PLAN.md items have no author).

**Dispatch hints (`model:` + `effort:`).** Issues filed by slashdo can carry a recommendation for *how to run the work*, on two independent axes: **`model:light|medium|heavy`** (how much capability the task needs) and **`effort:low|medium|high|xhigh|max`** (how much reasoning budget per step). They're deliberately not a size estimate, and the off-diagonal combinations are the useful ones — `model:light` + `effort:max` is a mechanical change across forty call sites, where no insight is needed but a silent miss is easy. `/do:plan-task` infers both from what it found in the code and shows them at the approval gate (override with `--model`/`--effort`, or suppress an axis with `none`). The other commands that file issues — `/do:better`, `/do:next`, `/do:replan` — may add a hint when the work they just did justifies one, but never stamp one on speculatively: `/do:replan` in particular is barred from labelling migrated backlog items in bulk, since a hint guessed from a one-line entry is noise that makes the deliberate ones unreadable.

Then `/do:next` reads them back. **`--model`/`--effort` filter the queue** — `/do:next --issues --model light,none --effort low,medium` claims only cheap work (`none` includes issues nobody has tiered yet; without it, untiered issues are filtered out). And in **`--swarm` mode the labels actually dispatch**: each worker agent runs at the tier its own issue asks for, so a mixed batch doesn't pay one flat rate per agent.

**Filtering is the main event; dispatch is the bonus.** Both labels are always written, always filterable, and always reported — picking *which* issue to take ("give me something cheap", "give me the careful work") is what they're for, and that works identically everywhere. On top of that, `model:` maps to a real parameter on most hosts, so swarm workers genuinely run at their issue's tier. **`effort:` is advisory**: it tells whoever takes the issue how careful it needs to be, and an agent may additionally pass it to a sub-agent where the dispatch API exposes an effort control (Claude Code's `Agent` tool doesn't — reasoning effort comes from an agent's definition, not the call).

**The labels name tiers, not models — deliberately.** A concrete slug like `opus` or `gpt-5` is wrong on two axes at once: it ages out while the issue outlives it, and it's meaningless to the other CLIs reading the same tracker. slashdo runs under Claude Code, OpenCode, Antigravity, Codex, and Grok Build (and against local Ollama models), and an issue filed from one is routinely claimed from another, so **each host resolves `light`/`medium`/`heavy` against its own lineup** at dispatch time. `effort:`'s five levels are a fine-grained scale no host matches exactly, so each clamps to its own nearest level (and a host with no effort control ignores the axis). A host that can't set a sub-agent's model at all still filters fine and just reports the hint. Everything here is advisory: an unlabelled issue is always claimable, and an explicit `#<num>` overrides the filters.

**Epics are child-aware.** An `epic` (umbrella) issue — identified by the `epic` label, native GitHub sub-issues, or a body that task-lists other issues — is judged by its **children**, not by code evidence. `/do:next --issues` skips an epic while any child is open; once every child closes it claims the epic's remaining wrap-up tasks (or closes the epic outright if nothing remains). After shipping a child, `/do:next` re-checks the parent and closes it when that child was the last. `/do:replan --issues` applies the same rule during triage.

**Swarm mode (`/do:next --issues --swarm[=N]`).** Instead of one item per run, `--swarm` claims and ships **several independent open issues at once** — each in its own worktree subagent running the normal single-issue flow — then serializes only the merge. It picks the first N independent issues off the same priority/oldest queue (skipping ones that depend on or obviously overlap another in the batch), fans out one agent per issue to implement and open a reviewed PR, then merges them one at a time, re-syncing each onto the advancing default branch. Default 3 agents; `--swarm=N` sets the count (clamped `1..6` — N agents cost ≈N× the tokens). A PR that isn't cleanly mergeable is left open rather than force-merged, and a dead agent's claim is released back to the queue.

**Swarm an explicit list.** Name the issues instead of letting swarm pick them — `/do:next --swarm #12 #14 #15` (or `--swarm 12,14,15`), the natural follow-up to filing a batch with `/do:plan-task`. The named list *is* the batch, in your order, and it's a deliberate cherry-pick: parking labels, an active `--issues-label` filter, and blockers outside the list are overridden (each override is stated), while `--self` still refuses a list containing someone else's issue rather than shrinking the batch silently. Issues that are closed or already claimed are dropped with a reason and never substituted; name more than the concurrency cap and they ship in **waves** of N, each wave merging before the next begins — which is also where an issue that depends on (or obviously collides with) another in the list gets placed. The summary accounts for every number you named. `--swarm=N` still caps concurrency, but the token cost tracks the list length, not N.

## Configuration (`/do:config`)

Rather than passing flags every time, save them once and let future commands pick them up automatically.

```
/do:config --review-with=claude,codex,cursor[gpt-5]~effort=max,ollama[qwen2.5-coder:32b]
/do:config --review-models codex=o3,claude=claude-opus-4-8,cursor=gpt-5
/do:config --issues --issues-label plan
/do:config --merge --merge-method squash
/do:config --self
/do:config                                # show what's saved and what's effective
```

| Usage | What it does |
|:---|:---|
| `/do:config` (or `--show`) | Print the current global + per-project defaults and the effective merged values |
| `/do:config --review-with=… [--review-iterations=N] [--review-mode=series\|parallel] [--reviewer-applies\|--no-reviewer-applies] [--review-stop-on-findings\|--review-stop-on-clean\|--review-stop-all]` | Save review-loop defaults (validated with the same rules the review commands use) |
| `/do:config --review-models <agent>=<model>,…` | Save the default model per reviewer (`codex`/`claude`/`agy`/`grok`/`cursor`/`ollama`). Merges key-by-key — setting one agent leaves the others intact; an empty value (`codex=`) clears one agent |
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

Each environment formats commands appropriately for its host assistant:

| Assistant / Environment | Invocation Syntax | Installed Path | Format |
|:---|:---|:---|:---|
| **Claude Code** | `/do:<command>` (e.g. `/do:plan-task`, `/do:pr`) | `~/.claude/commands/do/` | YAML frontmatter + subdirectories |
| **Codex** | `$do-<command>` (e.g. `$do-plan-task`, `$do-pr`) | `~/.codex/skills/` | SKILL.md per-command directories |
| **Antigravity CLI** (`agy`/`gemini`) | `/do-<command>` (e.g. `/do-plan-task`, `/do-pr`) | `~/.gemini/antigravity-cli/skills/` | Agent Skills (SKILL.md) |
| **OpenCode** | `/do-<command>` (e.g. `/do-plan-task`, `/do-pr`) | `~/.config/opencode/commands/` | YAML frontmatter + flat naming |
| **Grok Build** | `/do-<command>` (e.g. `/do-plan-task`, `/do-pr`) | `~/.grok/skills/` | SKILL.md per-command directories |

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

Both paths need `npm`/`npx` on your `PATH`. If you installed with the npm-free `install.sh` and never installed npm, the statusline says so once (`⚠ slashdo update check needs npm on PATH`) rather than silently implying you are current — re-run the curl installer to update in place.

The preference lives in `~/.claude/.slashdo-config.json` (`{ "autoUpdate": true }`). Change it any time without the prompt:

```bash
npx slash-do@latest --auto-update      # enable
npx slash-do@latest --no-auto-update   # disable
```

Existing installs from before this feature get asked on their next `npx slash-do@latest` run.

## Contributing

Issues and PRs are welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md) for the project structure, local dev/test workflow, and PR conventions.

## License

MIT
