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
| `heavy` | **inherit the session's model** — do not pin a slug | genuinely hard reasoning where a weaker model produces confident wrong answers |

**`heavy` means inherit, not "pick the biggest".** Pinning an explicit top-tier slug
fights an organization that has standardized on a specific model version, and it is
the slug most likely to be stale. Omitting the parameter lets the agent inherit
whatever the session is running, which is both current and policy-correct.

**The honest consequence: `heavy` cannot *upgrade* a weak session.** If the session is
running a mid-tier model, `heavy` work runs mid-tier. The tier reliably avoids
*downgrading* important work; it cannot promote it. When that gap matters, say so
once and continue — never block on it.

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
model parameter.

## Worked example — Claude Code

`light` → `model: "haiku"`; `medium` → `model: "sonnet"`; `heavy` → **omit** the
`model` parameter so the agent inherits the session. Effort passes through verbatim
(`effort: "<level>"`), since this host's levels are exactly the five above.

This is an example of the resolution, **not** the rule. On another host, resolve
against that host's lineup.

## Related

- [plan-issue-mode.md](./plan-issue-mode.md) — the `model:` / `effort:` tracker
  labels use this same vocabulary, so an issue's dispatch hint resolves through this
  file when a consumer acts on it.
- `/do:config --review-models` is **unrelated**: it pins the model each external
  *reviewer* CLI runs on, by explicit user choice, and is not tiered.
