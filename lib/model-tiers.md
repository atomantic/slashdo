# Agent dispatch tiers — model capability and reasoning effort

Commands name a sub-agent's model and reasoning effort as **tiers**, never as model
names; the running harness resolves each tier against the models it offers at dispatch
time. A vendor's model name ages out and means nothing on another harness, so no
command or partial, this one included, names a model.

## Model tier

| Tier | Resolve to | Use for |
|---|---|---|
| `light` | the **fastest, cheapest** model the harness offers that can still do coding work | mechanical work: pattern-matching, inventory sweeps, well-specified edits |
| `medium` | its **balanced** everyday model | the default for real work — audits, remediation, review |
| `heavy` | the **strongest** everyday model it offers this account | hard reasoning where a weaker model gives confident wrong answers |
| `ultra` | the **frontier** model explicitly configured for exceptional reasoning (opt-in; degrades to `heavy` / session model when unavailable) | rare architectural or cross-system reasoning where `heavy` is insufficient |

- Select the model through the harness's own alias or selector for that class where it
  has one. An alias follows whatever version the user or organization configured; a
  pinned version ID in a command is a bug.
- `heavy` reaches up to the strongest model available, rather than merely avoiding the
  weakest.
- When the harness has no selector for a tier, or rejects the dispatch because the
  account lacks that model, omit the model so the sub-agent inherits the session's,
  retry once, and say so.

## Reasoning effort

Five advisory levels: `low`, `medium`, `high`, `xhigh`, `max`. The level mainly
*describes the work*, so it is useful on every harness as metadata. Pass it on a
dispatch when the harness's sub-agent tool accepts an effort (or reasoning) setting,
clamped to the nearest level it has (a three-level harness runs `xhigh`/`max` at its
highest). When the tool has no such setting, omit it — an unknown parameter can fail
the whole dispatch — and state the level in the sub-agent's brief instead. Check what
the tool accepts rather than assuming either way. The absence of an effort control is
not a degraded run, and one axis is never traded for the other.

Effort is thinking per step: match how hard a step is, not how many there are.
`medium` is normal; keep `xhigh`/`max` for reasoning that is the whole difficulty.

## Degrade, never abort

When the harness cannot set a sub-agent's model or effort (or cannot spawn sub-agents),
run at the session default, report the tier you would have used, and continue. A
command never refuses to run, or does less work, because a tier could not be applied.

The tracker's `model:` / `effort:` labels use this vocabulary. `/do:config
--review-models` is unrelated: it pins each external *reviewer*'s model, untiered.
