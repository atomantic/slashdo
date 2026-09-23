# Review loop internals

This is the implementation detail behind the [Review loop](../README.md#review-loop) section of the README — the parts a user doesn't need to pick a reviewer, but that matter if you're debugging a review run or extending `lib/local-agent-review-loop.md`.

## Per-CLI reasoning-effort mapping

`~effort=<level>` (`low`/`medium`/`high`/`xhigh`/`max`) is translated to whatever flag each reviewer's own CLI accepts — `--effort` is not a universal flag:

| Reviewer | Flag |
|:---|:---|
| `claude` / `grok` | `--effort <level>` |
| `codex` | `-c model_reasoning_effort=<level>` |
| `opencode` | `--variant <level>` |
| `pi` | `--thinking <level>` |
| `cursor` | folded into `--model` as `[effort=<level>]` — pair with a `cursor[<model>]` bracket, or a saved `--review-models cursor=…` default, since the effort has to live inside the model string |
| `agy` | picks the matching model variant from whatever `agy models` lists |

Where a reviewer offers no such control, or no level matching what was asked, the effort falls back to prompt guidance rather than failing the review.

## Model-alias caveats

- Cursor also accepts a model string that already encodes effort (`cursor[claude-opus-4-7[thinking=true,effort=high]]`) — that's Cursor's own native variant syntax, passed through as `--model` unchanged.
- OpenCode accepts provider/model strings and still normalizes the legacy friendly aliases (`muse-1.3`, `zen/muse-1.3`, bare model names) for explicit compatibility requests, but slashdo no longer supplies or recommends a bundled free-tier model — headless provider admission was never verified for those aliases, so select a supported provider/model explicitly or configure one in OpenCode.

## `capped` vs `guardrail`

A reviewer that stops because it spent a `~max=<n>` cap *you* set reports `capped`, which counts as clean for the merge gate. A reviewer that gets cut off by a *built-in* cap while it was still finding real problems reports `guardrail` instead, which blocks the merge. The distinction exists so an explicit budget you chose doesn't get treated the same as the loop running away.

## `cmd[...]` trust boundary

`cmd[<invocation>]` is the escape hatch for a harness not on the reviewer list. It's accepted from the command line or the global config only — never from a repo's committed `.slashdo.json`. A per-project config file is repo content, so honoring a `cmd[...]` from it would let anyone who can open a PR to the repo pick the shell command slashdo runs. `/do:config --project` refuses to store one, and the saved-defaults loader drops it if it's present in a project file some other way.
