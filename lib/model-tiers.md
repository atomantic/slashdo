# Agent dispatch tiers — model capability and reasoning effort

Commands name a sub-agent's model and reasoning effort as **tiers**, never as model
names; the running CLI resolves each tier against its own lineup at dispatch time. A
vendor slug ages out and means nothing on another host, so **this file is the only
tier → model mapping**. A command that hardcodes a slug is a bug; fix it here.

## Model tier

| Tier | Resolve to | Use for |
|---|---|---|
| `light` | the host's **cheapest capable coding model** | mechanical work: pattern-matching, inventory sweeps, well-specified edits |
| `medium` | the host's **routine workhorse** | the default for real work — audits, remediation, review |
| `heavy` | the host's **strongest available coding model** | hard reasoning where a weaker model gives confident wrong answers |

- **Name the tier's alias, never a pinned version ID.** An alias (Claude Code:
  `haiku` / `sonnet` / `opus`) follows whatever version the org configured; a
  fully-qualified ID such as `claude-opus-4-8` in a command is a bug.
- **`heavy` must reach up**, not merely avoid reaching down.
- **Inherit (omit the model parameter) only when** the host has no alias for that
  tier, or the dispatch is rejected because the account lacks the tier — then retry
  once with it omitted and say so.

## Reasoning effort

Five advisory levels: `low`, `medium`, `high`, `xhigh`, `max`. The level mainly
*describes the work* (for filtering and for how carefully to approach it), so it works
on every host as metadata. Setting it on a dispatch is optional: do so only where the
dispatch API actually has an effort control, **clamped to the nearest level the host
has** (a three-level host runs `xhigh`/`max` at its highest). Never report its absence
as a degraded run, and never trade one axis for the other.

## Degrade, never abort

When the host cannot set a sub-agent's model or effort (or cannot spawn sub-agents),
run at the session default, report the tier you would have used, and continue. A
command never refuses to run, or does less work, because a tier could not be applied.

## Claude Code

`light` → `model: "haiku"`, `medium` → `model: "sonnet"`, `heavy` → `model: "opus"`.
The `Agent` tool has **no `effort` parameter** — never pass one (an unknown key fails
input validation and takes the dispatch down); carry the level in the brief instead.
Other dispatch APIs (e.g. slashdo `Workflow` scripts) may accept one; check first.

The `model:` / `effort:` tracker labels in [plan-issue-setup.md](./plan-issue-setup.md)
use this vocabulary. `/do:config --review-models` is unrelated: it pins each external
*reviewer*'s model by explicit choice and is not tiered.
