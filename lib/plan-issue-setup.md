# Tracker Issue Setup

Shared setup for any command that reads or files GitHub/GitLab tracker issues:
consuming the VCS host and `LABEL_SEP`, creating labels lazily, and the
`model:`/`effort:` dispatch-hint vocabulary. **This file assumes the caller's own
argument parsing already resolved `PLAN_LABEL`** (`--issues-label`, saved
`issues-label`, default `plan`), so this file does not redefine it.

Dedup, `--scan-only` recording, severity/category labels, and bulk spool filing are
**not** here — see [plan-issue-filing.md](./plan-issue-filing.md), which any command
that actually files a finding as an issue should also read.

## Setup

1. **Host state.** This partial requires `CLI_TOOL` and `LABEL_SEP` from the caller.
   If either is unset, read and run [vcs-host.md](./vcs-host.md) before continuing;
   do not infer either value from ambient credentials or re-derive them here. If the
   confirmed `CLI_TOOL` cannot reach this repo's issues (not authenticated, or the
   issues feature is disabled), there is no tracker. Never fall back to a local
   backlog file.

   **No tracker:** a backlog command (`/do:replan`, `/do:next`, `/do:plan-task`)
   aborts in pre-flight. A command that only defers findings continues, files
   nothing, and lists each deferral (title, one-line rationale, file:line) in its
   final report under "Deferred (not filed — no issue tracker available)".
2. **Label creation — lazy, not upfront.** Do **not** create `PLAN_LABEL` (or any
   other label) here as a preamble step — a pure consume run (e.g. `/do:next`
   picking work to claim) that files nothing this run never needs to write to the
   tracker at all. Create each label **immediately before the first issue that
   applies it**, the same idempotent pattern
   [plan-issue-filing.md](./plan-issue-filing.md) "Labels, not title brackets" uses
   for category/severity/dispatch-hint labels:
   ```bash
   # gh — description optional, color optional
   gh label create <name> --color <hex> 2>/dev/null || true
   # glab — color required
   glab label create --name <name> --color "#<hex>" 2>/dev/null || true
   ```
   For the scoping label itself, right before its first `--label "$PLAN_LABEL"` use:
   `gh label create "$PLAN_LABEL" --description "Tracked by slashdo" 2>/dev/null || true`
   (glab: `glab label create --name "$PLAN_LABEL" --color "#428BCA" 2>/dev/null || true`
   — glab requires a color).

## The dispatch hint (`model:` + `effort:`)

Two optional labels that record **how to run the work**, not how big it is. They are
a recommendation to whoever claims the issue — not a size estimate, not a priority,
and never a gate. (As throughout this file, `:` below stands for the resolved
`LABEL_SEP` — `::` on GitLab, `:` on GitHub; see "Setup" above.)

- **`model:light` / `model:medium` / `model:heavy`** — the **capability tier**.
  `light` is mechanical (rename, config bump, doc fix, established pattern). `heavy`
  is hard reasoning (concurrency bug, API redesign, first plausible answer is usually wrong).
- **`effort:low` / `effort:medium` / `effort:high` / `effort:xhigh` / `effort:max`** —
  the **reasoning budget** per step. High when the work is wide, fiddly, or easy to
  get subtly wrong, independent of how hard the thinking is.

**The two axes are independent.** `model:light` + `effort:max` is a mechanical change
across forty call sites; `model:heavy` + `effort:low` is a two-line change that hinges
on one good idea. Moving both axes together is a size estimate, not a hint.

**Tier names, not model names — the label is host-neutral.** A slug like `opus` or
`gpt-5` ages out and is meaningless to other CLIs on the same tracker. Record **only
the tier**; the consumer resolves it against its own host at dispatch time per
[model-tiers.md](./model-tiers.md) — the same vocabulary `/do:better`, `/do:depfree`,
`/do:review`, and `/do:rpr` use. `heavy` means "inherit the session's model" rather
than a pinned slug; a coarser effort scale clamps.

**Applying one is optional; an unlabeled issue is normal** and stays fully claimable.
Only apply a hint you can justify from the work you investigated. Prefer leaving an
axis off to guessing it. A reflexive `model:medium` + `effort:medium` on everything
is noise.

**Not `/do:config --review-models`**, which pins each *reviewer*. The dispatch hint
is about the *implementer*.

**Consumer:** `/do:next` reads both — `--model` / `--effort` filter the queue, and
`--swarm` sets each worker's model from the claimed issue's tier.

**Filtering is the primary use** and works on every host (label matching). Dispatch
is a bonus where the host supports it: the model tier maps to a real parameter on
most hosts; `effort:` is advisory and an agent **may** pass it to a sub-agent where
such a control exists. A host that can't spawn sub-agents, or can't set their model,
reports the labels.

## Label colors

Use these severity colors so the tags read at a glance; category labels share one
neutral color, and each dispatch-hint axis gets its own ramp so the two never read
as one scale. (Names shown with `:` — build the real name as `<key>${LABEL_SEP}<value>`.)

| Label             | Color hex |
|-------------------|-----------|
| `severity:critical` | `B60205` |
| `severity:high`     | `D93F0B` |
| `severity:medium`   | `FBCA04` |
| `severity:low`      | `0E8A16` |
| any category label  | `0366D6` |
| `model:light`       | `D4C5F9` |
| `model:medium`      | `A371F7` |
| `model:heavy`       | `6F42C1` |
| `effort:low`        | `BFE5E5` |
| `effort:medium`     | `76C7C7` |
| `effort:high`       | `1D7874` |
| `effort:xhigh`      | `0E4F4C` |
| `effort:max`        | `05403D` |

On GitLab the color is largely cosmetic anyway — the scope portion (`severity`,
`model`, `effort`, `priority`, `area`) renders in its own tone regardless of the
value's hex, so pick one representative color per **scope** if a repo's `glab
label create` calls are hand-maintained rather than generated from this table.
