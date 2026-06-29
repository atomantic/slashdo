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
| `/do:pr` | Open a PR (GitHub `gh`) or merge request (GitLab `glab`) with self-review; runs an external review loop only when you pass `--review-with` (no default reviewer; see [Review loop flags](#review-loop-flags-dopr-dorelease-dopr-better-doreview-dobetter-dobetter-swift-dodepfree-dorpr)). Pass `--merge` to auto-merge once reviews and CI pass (see [Auto-merge](#auto-merge-dopr---merge)) |
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
| `/do:replan` | Review and clean up PLAN.md — or, with `--issues`, your GitHub/GitLab issue tracker (see [Issue mode](#replan-issue-mode-doreplan---issues)) |
| `/do:next` | Claim the next unclaimed PLAN.md item (or tracker issue with `--issues`), implement it in an isolated worktree, ship a reviewed PR, and clean up — the consumer counterpart to `/do:replan`. Add `--swarm[=N]` (issues mode) to claim and ship several independent issues in parallel |
| `/do:omd` | Audit and optimize markdown files |
| `/do:config` | View or set saved defaults (e.g. `--review-with`) so future commands can omit the flag (see [Saved defaults](#saved-defaults-doconfig)) |
| `/do:update` | Update slashdo to latest version |
| `/do:help` | List all available commands |

### Review loop flags (`/do:pr`, `/do:release`, `/do:pr-better`, `/do:review`, `/do:better`, `/do:better-swift`, `/do:depfree`, `/do:rpr`)

These commands accept a shared set of flags that control which reviewer(s) run and how the multi-reviewer loop is gated. **No reviewer is ever hardcoded — `copilot` runs only when you list it** (the one exception is `/do:rpr`, whose conditional default is documented below):

| Flag | Default | What it does |
|:---|:---|:---|
| `--review-with <agent>[,<agent>...]` | empty — **no default reviewer** (except `/do:rpr`, see below) | Pick one or more reviewers, run in the order given. Omit the flag and no external review runs (each command still runs its own unconditional self-review gate). Accepted slugs: `copilot` (GitHub cloud review), `codex`, `agy` (aliases `gemini` / `antigravity` — all run the Antigravity CLI's `agy` binary), `claude` (each non-copilot slug spawns that local CLI in headless mode), and `ollama` (review with a local Ollama model — bare `ollama` auto-selects the most capable installed coding model; `ollama[<model>]` pins a specific installed model, e.g. `--review-with=ollama[qwen2.5-coder:32b]`). Whatever you list is exactly what runs — `--review-with codex` runs codex only; copilot is never added implicitly. Example: `--review-with codex,agy,copilot` runs codex first, then Antigravity, then copilot, each reviewing the branch as the previous pass left it. On `/do:better`, `/do:better-swift`, and `/do:depfree`, omitting the flag means the review loop **and the auto-merge** are skipped — PRs are left open for manual review. |
| `--review-iterations <n>` | `1` | Cap how many review-and-fix cycles a **Copilot** pass runs. Default `1`: request one review, apply every fix it surfaces, then stop (exiting early if the review returns 0 comments). `0` restores the legacy "loop until 0 comments" behavior, bounded by a 10-iteration safety guardrail. No effect on `codex`/`agy`/`claude` passes (fixed 3-iteration cap), and no effect when copilot isn't in the list. Accepted by `/do:better`, `/do:better-swift`, and `/do:depfree` too. |
| `--review-mode <series\|parallel>` | `series` | How a multi-reviewer list is dispatched. `series` (default) runs each reviewer to completion before the next starts, so a later reviewer reviews against the earlier ones' committed fixes — which is why the list order matters. `parallel` runs every reviewer's review concurrently against one frozen baseline and then applies the deduped union of findings in a single pass: faster, but no reviewer sees another's fixes, and `--reviewer-applies` and the stop-mode flags are ignored (concurrent reviewers can't share a working tree, and there's no first-finisher to stop on). `/do:rpr` ignores this flag. |
| `--review-stop-on-findings` | off | Stop the multi-reviewer loop after the first reviewer that fixes at least one finding (subsequent reviewers in the list are skipped). Mutually exclusive with `--review-stop-on-clean`. |
| `--review-stop-on-clean` | off | Stop after the first reviewer that reports zero findings (clean). Mutually exclusive with `--review-stop-on-findings`. |
| `--reviewer-applies` | off | Edit the working tree directly from the reviewing CLI instead of routing findings back through the orchestrating thread. No effect on copilot passes (Copilot reviews are read-only) or ollama passes (Ollama is non-agentic — always review-only); takes effect on each codex / agy / claude pass in the list. |

By default (`--review-mode series`) every listed reviewer runs in order, one fully finishing before the next starts so each reviews against the prior's committed fixes, and the orchestrator that opened the PR also applies the fixes — it reads each reviewer's findings and edits the working tree itself. (`--review-mode parallel` instead collects all reviews concurrently and applies the union once — see the flag table above.) Pass `--reviewer-applies` when you want the reviewing agent's *judgment* in the final patch (e.g. asking Antigravity (`agy`) to both find and patch its own concerns). For `/do:release`, the merge gate requires the multi-reviewer aggregate status to be `clean` (or `partial`, if you explicitly opted into a stop-mode short-circuit) — a `dirty` aggregate (build/test broken on some pass) or an `inconclusive` aggregate (any executed pass timed out, errored, hit its guardrail, was skipped, or — for ollama — only partially reviewed the diff, even if other passes returned clean) blocks the merge.

For `/do:review`, the listed agents run **after** the host CLI's own self-review (the multi-agent review built into `do:review`). The list names *additional* reviewers; whichever CLI is hosting `/do:review` does its own pass first regardless.

### Auto-merge (`/do:pr --merge`)

By default `/do:pr` opens the PR and hands it back for manual merge. Pass `--merge` to merge it automatically once **both** gates are green: the review loop returns a mergeable status **and** required CI checks pass. It's opt-in per run, or save it once with `/do:config --merge` (see [Saved defaults](#saved-defaults-doconfig)).

| Flag | Default | What it does |
|:---|:---|:---|
| `--merge` | off — PR left open | After review **and** CI pass, merge the PR. Eligible only when the multi-reviewer aggregate is `clean` (or `partial` if you explicitly set a stop-mode); a `dirty` or `inconclusive` aggregate leaves the PR open. With no `--review-with`, the bar is the unconditional self-review gate plus passing CI. |
| `--merge=<method>` | — | `--merge` plus pin the method in one token: `squash`, `rebase`, or `merge`. |
| `--merge-method <method>` | repo's allowed method | Pin the merge method without restating `--merge` (useful when `--merge` comes from a saved default). When unset, slashdo uses the repo's allowed method — if several are allowed it prefers `squash`, then `merge`, then `rebase`. |
| `--no-merge` | — | Leave the PR open for this run, overriding a saved `merge` default. |

**How CI is awaited:** slashdo first enables GitHub-native auto-merge (`gh pr merge --auto`), so the merge lands when required checks pass even if your session ends. If the repo hasn't enabled auto-merge, it falls back to watching checks in-session (`gh pr checks --watch`) and merging once they're green — leaving the PR open if a required check fails. On GitLab it uses `glab mr merge --auto-merge` (merge-when-pipeline-succeeds). It never merges on a non-clean review aggregate, before checks pass, or over branch protection.

Only `/do:pr` reads the `merge` / `merge-method` saved defaults — `/do:better`, `/do:better-swift`, `/do:depfree`, and `/do:release` keep their own merge behavior (each auto-merges after its own review loop / merge gate, as documented for that command).

### Replan issue mode (`/do:replan --issues`)

By default `/do:replan` tracks the plan in `PLAN.md`. Pass `--issues` to track it in your GitHub/GitLab issue tracker instead — the same audit/triage/prune lifecycle runs against issues rather than checklist lines.

| Flag | Default | What it does |
|:---|:---|:---|
| `--issues` | off — plan lives in `PLAN.md` | Track plan items as issues. Replan reads the open labeled issues, closes the ones it finds done or stale (with an evidence comment), files new issues for the opportunities it surfaces, and comments + `drift`-labels any item that would now remove a newer feature. It **always reads `PLAN.md` if one exists**: every open item is migrated into the tracker (one labeled issue each) and `PLAN.md` is emptied to a short note that the roadmap now lives on the Issues page. `PLAN.md` never records issue numbers — the point of this mode is to keep it from churning and causing merge conflicts while the team works on issues. Requires an authenticated `gh` (GitHub) or `glab` (GitLab); replan aborts if neither is available rather than silently falling back. |
| `--issues-label <name>` | `plan` | The label that scopes which issues are plan items (so bug reports and questions in the same tracker aren't mistaken for the plan). Only issues carrying this label are triaged, and new issues replan files get it. |

The stable item ID in issue mode is the **issue number** (e.g. `#42`), so concurrent agents claim work via `cos/<task>/issue-42/<agent>` branches — the kebab-slug IDs used in PLAN.md mode don't apply. Compose with `--interactive` to approve closes/creates before they happen. Before migrating an item, replan surfaces any **open question or decision** it finds and asks you to resolve it (folding the answer into the issue body), so every issue it files is actionable and immediately claimable — a migration normally leaves `PLAN.md` empty; the only thing that may remain is an item whose decision you explicitly defer.

**`--issues` works across every command that records plan items**, so adopting issue-tracking is consistent: `/do:better`, `/do:better-swift`, and `/do:depfree` file their **deferred** findings/removals as labeled issues instead of writing a PLAN.md audit section, and `/do:review` / `/do:rpr` file a deferred finding as an issue instead of a PLAN.md line. All of them take the same `--issues` / `--issues-label <name>` flags and the same issue-number-as-ID model. (`/do:push` still only marks/commits whatever is already in PLAN.md — in a fully issue-tracked repo that's just the empty stub.) To avoid repeating `--issues` on every command, save it once with `/do:config --issues` (globally or per-repo with `--project`) — see [Saved defaults](#saved-defaults-doconfig); `--no-issues` on a single run overrides a saved default.

**One asymmetry worth knowing:** `--issues-label` *scopes* the commands that **file or triage** plan items (replan triages only labeled issues; better/depfree/review file under the label), but `/do:next` — which **consumes** the queue — is **label-agnostic by default**. A bare `/do:next --issues` claims the oldest open issue regardless of label (skipping only parking labels like `future`/`blocked`, open or wrap-up-pending epics, and anything already in flight or assigned), so a repo that files ordinary `enhancement`/`bug`/`area:*` issues works without first stamping a `plan` label on everything. Pass `/do:next --issues --issues-label <name>` (or save the default) to restrict its auto-pick to a curated label.

**Claim only your own issues — `/do:next --issues --self`.** By default `/do:next` claims any open issue regardless of who filed it, which on a shared tracker means it can act on a work item (and the instructions in its body) opened by anyone. `--self` restricts every claim — auto-pick, `--swarm` batch, and an explicit `#<num>` — to issues whose author is the running `gh` account (`@me`); issues filed by anyone else are filtered out at the API, and an explicit number for someone else's issue is **refused, not overridden** (it's a security boundary, the one skip a deliberate cherry-pick can't cross). Save it once with `/do:config --self` (globally, or per-repo with `--project`) so a multi-contributor tracker never auto-feeds third-party issues into your agent; pass `--no-self` on a run to fall back to any-author. Issues mode only (PLAN.md items have no author).

**Epics are child-aware.** An `epic` (umbrella) issue — identified by the `epic` label, native GitHub sub-issues, or a body that task-lists other issues — is judged by its **children**, not by code evidence. slashdo resolves children natively first (GitHub sub-issues), falling back to the `- [ ] #123` body checklist and `Part of #N` back-references. `/do:next --issues` skips an epic while any child is open; once every child is closed it claims the epic's own remaining **wrap-up tasks** as the next work item (and merging that PR closes the epic), or — if there's nothing left to do — closes the epic outright. After shipping an ordinary child issue, `/do:next` re-checks the parent epic and closes it when that child was the last one. `/do:replan --issues` applies the same rule during triage: it closes a fully-complete epic with a child-evidence comment and never closes one with open children or pending wrap-up.

**Drain the backlog in parallel — `/do:next --issues --swarm`.** By default `/do:next` ships one item per run; `--swarm` (issues mode) claims and ships **several independent open issues at once**, each in its own worktree subagent running the normal single-issue flow, then **serializes only the merge**. It picks the first N independent issues off the same priority/oldest queue (skipping any that depend on or obviously overlap another in the batch), fans out one agent per issue to implement and open a reviewed PR, then merges them one at a time — re-syncing each onto the advancing default branch (deletions-win on changelog/PLAN conflicts) and routing flaky-CI failures through the merge gate's one-re-run guard. `--swarm` runs 3 agents by default; `--swarm=N` sets the count (clamped `1..6`, since N agents cost ≈N× the tokens). A PR that isn't cleanly mergeable is left open rather than force-merged, and a died agent's claim is released back to the queue.

`/do:better`, `/do:better-swift`, and `/do:depfree` run the chosen reviewer(s) as their post-PR review loop (per PR, in parallel for the multi-PR `better` commands). With no `--review-with`, they skip the review loop and auto-merge and leave PRs open. `/do:rpr` is special: it **resolves review threads from any author** (Copilot, human, or other bot), and its `--review-with` default is a *conditional* `copilot` — it requests a Copilot review only when the PR has no review yet, or when Copilot is already the reviewer in play; pass `--review-with codex|agy|claude` to run a local review loop instead. From this table `/do:rpr` accepts **only** `--review-with` and `--reviewer-applies` — not `--review-iterations` or the stop-mode flags (it drives a single reviewer to clean, not the multi-reviewer stop-mode loop).

### Saved defaults (`/do:config`)

Rather than passing the review flags every time, save them once with `/do:config` and let future commands pick them up automatically:

```
/do:config --review-with=claude,codex,ollama[qwen2.5-coder:32b]
```

After that, `/do:pr`, `/do:release`, `/do:review`, `/do:better`, `/do:better-swift`, `/do:depfree`, and `/do:rpr` behave as if you'd passed that `--review-with` value — until you override it on a run.

You can also save the **issue-mode** default the same way: `/do:config --issues` makes every command that accepts `--issues` (`/do:next`, `/do:replan`, `/do:better`, `/do:better-swift`, `/do:depfree`, `/do:review`, `/do:rpr`) default to filing/working tracker issues instead of `PLAN.md`. Pass `--no-issues` on a run to fall back to PLAN.md mode for that run, or `--issues-label <name>` to save the scoping label. A per-project `.slashdo.json` is a clean way to mark one repo issue-tracked: `/do:config --project --issues`.

And you can save **`/do:pr`'s auto-merge** default so a bare `/do:pr` merges once reviews and CI are solid: `/do:config --merge` (optionally `--merge-method squash|rebase|merge`, or the shorthand `--merge=squash`). Pass `--no-merge` on a run to leave that PR open. See [Auto-merge](#auto-merge-dopr---merge) for the full gate and merge-method rules; only `/do:pr` reads this default.

| Flag | What it does |
|:---|:---|
| `/do:config` (or `--show`) | Print the current global + per-project defaults and the effective merged values |
| `/do:config --review-with=… [--review-iterations=N] [--reviewer-applies] [--review-stop-on-findings\|--review-stop-on-clean]` | Save defaults for those flags (validated with the same rules the review commands use) |
| `/do:config --issues\|--no-issues [--issues-label=<name>]` | Save the issue-mode default (and its scoping label) for every command that accepts `--issues` |
| `/do:config --self\|--no-self` | Save the self-only issue gate for `/do:next` — claim only issues you filed (`@me`) |
| `/do:config --merge\|--no-merge [--merge-method=squash\|rebase\|merge]` | Save `/do:pr`'s auto-merge default (and the merge method it uses) |
| `--project` | Read/write a per-repo `.slashdo.json` at the repo root instead of the global config; per-project values override the global ones |
| `--unset <key>` | Clear one saved default (`review-with`, `review-iterations`, `reviewer-applies`, `review-stop-mode`, `issues`, `issues-label`, `self`, `merge`, `merge-method`) |
| `--reset` | Clear all saved defaults in the chosen scope |

**Precedence (highest first):** an explicit flag on the command line (or `--review-with none`, which skips reviewers for that run) → per-project `.slashdo.json` → global `.slashdo-config.json` → the command's built-in default. Defaults are stored per host CLI (the one you run `/do:config` in) under a `defaults` key, alongside settings like `autoUpdate`.

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
