# Tracker Issue Setup

Shared setup for any command that reads or files tracker issues; the caller already
resolved `PLAN_LABEL` (`--issues-label`, saved `issues-label`, default `plan`).
Dedup, `--scan-only` recording, severity/category labels, and bulk filing live in [plan-issue-filing.md](./plan-issue-filing.md).

## Setup

1. **Host state.** This partial requires `CLI_TOOL` and `LABEL_SEP` from the caller;
   if either is unset, run [vcs-host.md](./vcs-host.md) first — never infer them from
   ambient credentials. An empty `TRACKER_CLI` (its tracker gate), or one that
   cannot reach this repo's issues (not authenticated, or issues disabled), means
   no tracker; never fall back to a local backlog file. **No tracker:** a backlog command (`/do:replan`, `/do:next`,
   `/do:plan-task`) aborts in pre-flight; a command that only defers findings
   continues, files nothing, and lists each deferral (title, one-line rationale,
   file:line) in its final report under "Deferred (not filed — no issue tracker
   available)".
2. **Label creation — lazy.** A run that files nothing must not write to the
   tracker: create each label **immediately before the first issue that applies
   it**, idempotently:
   ```bash
   gh label create <name> --color <hex> 2>/dev/null || true               # gh
   glab label create --name <name> --color "#<hex>" 2>/dev/null || true   # glab: color required
   ```

Only on a Jira tracker (`TRACKER=jira`), if not yet read (it replaces the tracker gate, these calls, `#<n>`):

!read lib/tracker-jira.md

## The dispatch hint (`model:` + `effort:`)

Two optional labels (`:` here means `LABEL_SEP`) recommending **how to run the work**
— not a size, priority, or gate:

- **`model:light` / `model:medium` / `model:heavy`** — capability tier: `light` is
  mechanical (rename, config bump, established pattern); `heavy` is hard reasoning
  where the first plausible answer is usually wrong.
- **`effort:low` / `medium` / `high` / `xhigh` / `max`** — reasoning budget per step:
  high when the work is wide, fiddly, or easy to get subtly wrong.

The axes are independent (`model:light` + `effort:max` is a mechanical change across
forty call sites). Record **tier names only**, never model slugs — consumers resolve
them per [model-tiers.md](./model-tiers.md). **An unlabeled issue is normal**: apply an axis
only when the investigated work justifies it; a reflexive `medium`/`medium` is noise.
`/do:next --model` / `--effort` filter its queue by these labels, and `--swarm` sets
each worker's model from the tier.

## Label colors

Create each label immediately before applying it, passing the name and `--color` as separate arguments (glab requires `--name <name>` and `--color "#<hex>"`):

- **`PLAN_LABEL`:** `gh label create <PLAN_LABEL> --color 428BCA 2>/dev/null || true` (glab: `glab label create --name <PLAN_LABEL> --color "#428BCA" 2>/dev/null || true`)
- **Every category:** `gh label create <category> --color 0366D6 2>/dev/null || true` (glab: `glab label create --name <category> --color "#0366D6" 2>/dev/null || true`)
- **`severity`:** `gh label create severity${LABEL_SEP}critical --color B60205 2>/dev/null || true`, `gh label create severity${LABEL_SEP}high --color D93F0B 2>/dev/null || true`, `gh label create severity${LABEL_SEP}medium --color FBCA04 2>/dev/null || true`, `gh label create severity${LABEL_SEP}low --color 0E8A16 2>/dev/null || true`
- **`model`:** `gh label create model${LABEL_SEP}light --color D4C5F9 2>/dev/null || true`, `gh label create model${LABEL_SEP}medium --color A371F7 2>/dev/null || true`, `gh label create model${LABEL_SEP}heavy --color 6F42C1 2>/dev/null || true`
- **`effort`:** `gh label create effort${LABEL_SEP}low --color BFE5E5 2>/dev/null || true`, `gh label create effort${LABEL_SEP}medium --color 76C7C7 2>/dev/null || true`, `gh label create effort${LABEL_SEP}high --color 1D7874 2>/dev/null || true`, `gh label create effort${LABEL_SEP}xhigh --color 0E4F4C 2>/dev/null || true`, `gh label create effort${LABEL_SEP}max --color 05403D 2>/dev/null || true`

