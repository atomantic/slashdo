# Tracker Issue Setup

Shared setup for commands reading or filing tracker issues; caller resolved `PLAN_LABEL`.
Dedup, `--scan-only`, severity/category labels, and bulk filing live in [plan-issue-filing.md](./plan-issue-filing.md).

## Setup

1. **Host state.** This partial requires `CLI_TOOL` and `LABEL_SEP` from the caller;
   if either is unset, run [vcs-host.md](./vcs-host.md) first — never infer them from
   ambient credentials. An empty `TRACKER_CLI` (its tracker gate) or unreachable issues
   means no tracker. **No tracker:** backlog commands abort; deferred findings are reported
   unfiled under "Deferred (not filed — no issue tracker available)".
2. **Label creation — lazy.** Create each label **immediately before the first issue that applies it**, per **Label colors** below.

Only on a Jira tracker (`TRACKER=jira`), if not yet read (it replaces the tracker gate, these calls, `#<n>`):

!read lib/tracker-jira.md

## The dispatch hint (`model:` + `effort:`)

Two optional labels (`:` here means `LABEL_SEP`) recommending **how to run the work**:
- **`model:light` / `model:medium` / `model:heavy`** — capability tier: `light` is mechanical; `heavy` is hard reasoning.
- **`effort:low` / `medium` / `high` / `xhigh` / `max`** — reasoning budget per step: high when wide or subtle.

Axes are independent. Record **tier names only**, never slugs — resolve per [model-tiers.md](./model-tiers.md). Apply an axis only when justified; reflexive `medium`/`medium` is noise.

## Label colors

Create each label immediately before applying it, passing name and `--color` separately (`glab label create --name <name> --color "#<hex>" 2>/dev/null || true`):
- `gh label create <PLAN_LABEL> --color 428BCA 2>/dev/null || true`
- `gh label create <category> --color 0366D6 2>/dev/null || true`
- `gh label create severity${LABEL_SEP}critical --color B60205 2>/dev/null || true`, `gh label create severity${LABEL_SEP}high --color D93F0B 2>/dev/null || true`, `gh label create severity${LABEL_SEP}medium --color FBCA04 2>/dev/null || true`, `gh label create severity${LABEL_SEP}low --color 0E8A16 2>/dev/null || true`
- `gh label create model${LABEL_SEP}light --color D4C5F9 2>/dev/null || true`, `gh label create model${LABEL_SEP}medium --color A371F7 2>/dev/null || true`, `gh label create model${LABEL_SEP}heavy --color 6F42C1 2>/dev/null || true`
- `gh label create effort${LABEL_SEP}low --color BFE5E5 2>/dev/null || true`, `gh label create effort${LABEL_SEP}medium --color 76C7C7 2>/dev/null || true`, `gh label create effort${LABEL_SEP}high --color 1D7874 2>/dev/null || true`, `gh label create effort${LABEL_SEP}xhigh --color 0E4F4C 2>/dev/null || true`, `gh label create effort${LABEL_SEP}max --color 05403D 2>/dev/null || true`
