# Agent dispatch tiers — model capability and reasoning effort

Several commands spawn sub-agents and need to say **how strong a model** and **how
much reasoning effort** each one should get. They say it in **tiers**, never in
concrete model names, and the running CLI resolves a tier against its own lineup at
dispatch time.

## Why tiers, not model names

A hardcoded slug like `opus`, `gpt-5`, or `qwen2.5-coder:32b` is wrong on two
independent axes:

- **It ages out.** Model lineups churn every few months; the instruction outlives the
  slug, and a command that names a retired model degrades silently.
- **It is host-specific.** slashdo installs into Claude Code, OpenCode, Antigravity,
  Codex, and Grok Build, and drives local Ollama models — none of which share a model
  namespace. A slug from one host's lineup is meaningless on the others.

So commands carry a tier, and **this file is the only place the tier → model question
is answered**. A command that hardcodes a vendor slug is a bug; fix it here instead.

## The tiers

| Tier | Resolve to | Use for |
|---|---|---|
| `light` | the **cheapest capable coding model** this host offers | mechanical work: pattern-matching, inventory sweeps, well-specified edits |
| `medium` | this host's **routine workhorse** | the default for real work — audits, remediation, review |
| `heavy` | this host's **strongest available coding model** | genuinely hard reasoning where a weaker model produces confident wrong answers |

**Name the tier with an alias, never a pinned version.** Most hosts expose
tier-style model aliases (Claude Code's `model` parameter takes `opus` / `sonnet` /
`haiku`) alongside fully-qualified version IDs (`claude-opus-4-8`). **Always use the
alias.** An alias resolves to whatever version the organization has configured, so it
neither goes stale as lineups churn nor overrides a pinned deployment — it gets you
the tier while leaving the version choice where it belongs. A fully-qualified version
ID in a slashdo command is a bug.

**`heavy` should actually upgrade.** Naming the strongest alias is the whole point of
the tier: work marked `heavy` is work where a weaker model produces confident wrong
answers, so a `heavy` dispatch from a mid-tier session must reach *up*, not merely
avoid reaching down.

**Fallback — inherit — applies in exactly two cases**, and both are narrower than
they look:

1. **The host exposes no alias for its top tier** (only pinned version IDs, or no
   model parameter at all). Omit the parameter and let the agent inherit the session.
2. **The strongest alias is unavailable to this account** (no entitlement for that
   tier — the dispatch errors on the model name). Retry once with the parameter
   omitted so the agent inherits, and say so.

In both fallback cases `heavy` degrades to "inherit," which prevents *downgrading*
important work but cannot promote it. Note that plainly when it happens; never block
on it.

## Reasoning effort

Where a command also specifies effort, it uses five levels — `low`, `medium`, `high`,
`xhigh`, `max` — which are **a deliberately fine-grained scale that no host is
expected to match exactly**. Hosts differ in both directions: some expose three
levels, some add one below `low`, some have no effort control at all.

- **Clamp to the nearest level this host actually has.** A host with three levels runs
  `xhigh`/`max` at its highest. That is the correct reading of the request, not a
  failure.
- **A host with no effort control ignores the axis** entirely.
- **Never trade one axis for the other** — don't substitute a stronger model to
  compensate for missing effort control, or vice versa. They are independent.

## Degrade, never abort

The per-agent `model` / `effort` knobs are a property of the host's sub-agent
mechanism, and not every supported host exposes them (some cannot spawn sub-agents at
all). When you cannot set them:

**Run the agent at the session default and report the tier you would have used.** The
tiering is an optimization; the command's actual work is the feature. A command must
never refuse to run, or fall back to doing less work, because it could not set a
model parameter — including when a `heavy` dispatch is rejected because the account
lacks that tier. Retry once with the parameter omitted, note the degrade, and carry
on.

## Worked example — Claude Code

**Model:** `light` → `model: "haiku"`; `medium` → `model: "sonnet"`; `heavy` →
`model: "opus"`. All three are **aliases**, not pinned version IDs — `opus` resolves
to whatever Opus version this account/org is configured for, which is why naming it
is safe here and a literal `claude-opus-4-8` would not be. If an `opus` dispatch is
rejected for lack of entitlement, retry once with `model` omitted (inherit) and say
so.

**Effort: not settable per call on this host.** Claude Code's `Agent` tool takes
`description` / `prompt` / `subagent_type` / `model` / `isolation` — there is **no
`effort` parameter**. Reasoning effort comes from the agent *definition*, not the
dispatch call. So under Claude Code the `effort:` axis falls under "a host with no
effort control ignores the axis": **report the level the work asked for and run at
the session's effort.** Do **not** pass an `effort` key on an `Agent` call — an
unknown parameter fails input validation and takes the whole dispatch down with it,
which is exactly the abort "Degrade, never abort" forbids.

(A host whose dispatch API *does* expose a reasoning-effort control — some
orchestration APIs accept one alongside the model — passes the level through to that
control, clamped per the rule above. Check the API you are actually calling before
assuming either way.)

This is an example of the resolution, **not** the rule. On another host, resolve
against that host's lineup and its dispatch API's actual parameters.

## Related

- [plan-issue-mode.md](./plan-issue-mode.md) — the `model:` / `effort:` tracker
  labels use this same vocabulary, so an issue's dispatch hint resolves through this
  file when a consumer acts on it.
- `/do:config --review-models` is **unrelated**: it pins the model each external
  *reviewer* CLI runs on, by explicit user choice, and is not tiered.
