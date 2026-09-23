# Tracker Issue Setup

Shared setup for any command that reads or files tracker issues. The caller's own
argument parsing already resolved `PLAN_LABEL` (`--issues-label`, saved
`issues-label`, default `plan`). Dedup, `--scan-only` recording, severity/category
labels, and bulk filing live in [plan-issue-filing.md](./plan-issue-filing.md).

## Setup

1. **Host state.** This partial requires `CLI_TOOL` and `LABEL_SEP` from the caller;
   if either is unset, run [vcs-host.md](./vcs-host.md) first — never infer them from
   ambient credentials. If `CLI_TOOL` cannot reach this repo's issues (not
   authenticated, or issues disabled), there is no tracker; never fall back to a
   local backlog file. **No tracker:** a backlog command (`/do:replan`, `/do:next`,
   `/do:plan-task`) aborts in pre-flight; a command that only defers findings
   continues, files nothing, and lists each deferral (title, one-line rationale,
   file:line) in its final report under "Deferred (not filed — no issue tracker
   available)".
2. **Label creation — lazy, not upfront.** Never create labels as a preamble: a run
   that files nothing must not write to the tracker. Create each label
   **immediately before the first issue that applies it**, idempotently:
   ```bash
   gh label create <name> --color <hex> 2>/dev/null || true               # gh
   glab label create --name <name> --color "#<hex>" 2>/dev/null || true   # glab: color required
   ```
   The scoping label: `gh label create "$PLAN_LABEL" --description "Tracked by slashdo" 2>/dev/null || true`
   (glab: `glab label create --name "$PLAN_LABEL" --color "#428BCA" 2>/dev/null || true`).

## The dispatch hint (`model:` + `effort:`)

Two optional labels (`:` here means `LABEL_SEP`) recommending **how to run the work**
— not a size, priority, or gate:

- **`model:light` / `model:medium` / `model:heavy`** — capability tier: `light` is
  mechanical (rename, config bump, established pattern); `heavy` is hard reasoning
  where the first plausible answer is usually wrong.
- **`effort:low` / `medium` / `high` / `xhigh` / `max`** — reasoning budget per step:
  high when the work is wide, fiddly, or easy to get subtly wrong.

The axes are independent (`model:light` + `effort:max` is a mechanical change across
forty call sites); moving both together is a size estimate, not a hint. Record **tier
names only**, never model slugs — consumers resolve them per
[model-tiers.md](./model-tiers.md). **An unlabeled issue is normal**: apply an axis
only when the investigated work justifies it; a reflexive `medium`/`medium` is noise.
`/do:next` consumes both: `--model` / `--effort` filter its queue (label matching,
every host), and `--swarm` sets each worker's model from the tier where the host can.

## Label colors

`severity:critical` `B60205`, `severity:high` `D93F0B`, `severity:medium` `FBCA04`,
`severity:low` `0E8A16`; every category label `0366D6`; `model:light` `D4C5F9`,
`model:medium` `A371F7`, `model:heavy` `6F42C1`; `effort:low` `BFE5E5`,
`effort:medium` `76C7C7`, `effort:high` `1D7874`, `effort:xhigh` `0E4F4C`,
`effort:max` `05403D`. Build each real name as `<key>${LABEL_SEP}<value>`.
