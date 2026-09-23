## Local-agent recipe: `agy`

Prompt-driven reviewer (the Antigravity CLI, successor to the Gemini CLI); always review-only. Binary `agy`. Effort is a model **variant**, never `--effort`.

### Model pin (pre-flight)

agy always pins a model, resolved against the **live** roster, never a remembered literal: its own default can be a heavy *Thinking* tier that emits nothing for 20–30 minutes and looks exactly like a hang, and its roster churns between releases, so a stale name is a launch failure (`model ... is not recognized`), not a verdict. `--model` takes one **leveled** entry exactly as `agy models` prints it — an id (`gemini-3.8-flash-high`) or a display name (`Gemini 3.8 Flash (High)`); a bare base (`Gemini 3.8 Flash`) is not a model. Precedence: `{REVIEW_MODEL}` (bracket or saved `review-models`) > `AGY_REVIEW_MODEL` env > roster default. Run right after the shared-inputs block, in the orchestrator's shell (never ask agy itself to run `agy models` — a nested agy inside a print session can stall):

```bash
if [ "$REVIEW_AGENT" = agy ] && [ -z "$AGY_MODEL_RESOLVED" ]; then
  AGY_WANT_MODEL="${REVIEW_MODEL:-${AGY_REVIEW_MODEL:-}}"
  printf 'requested agy model: %s\n--- agy models ---\n' "${AGY_WANT_MODEL:-(none — pick the roster default)}"
  agy models 2>/dev/null
fi
```

**Selecting agy's model, and its effort variant.** Every entry `agy models` prints is already a fixed level, so the pinned model *is* the effort setting. Choose from **that listing** (one entry per line, id then display name), not from a remembered table:

- **Validate the requested model first, exact match.** If it appears as an id or a display name, that entry's base is the **family** for the effort step below.
- **Otherwise, try completing it as a base.** agy itself rejects the bare base (`Gemini 3.8 Flash` / `gemini-3.8-flash`) if passed straight through, but a bare base is not automatically unrecognized: look for leveled entries that share it (`<base>-low|medium|high`, or `Base (Low|Medium|High)`). If any exist, that base is the **family**.
- **Roster default** (the request matched neither an exact entry nor a same-base leveled sibling, or no model was requested): the newest `* Flash` family (e.g. `Gemini 3.8 Flash`) — never a `Thinking`/`Pro` tier. When a non-empty request landed here (stale `AGY_REVIEW_MODEL`, stale saved `review-models.agy`, typo'd `agy[...]` bracket), say in the run summary which model you substituted and why.
- **Apply `{REVIEW_EFFORT}` within whichever family was picked above.** This step always runs — on an exact match and on the roster default, not only on a base completion — because agy's model *is* its effort setting: pick the family's entry at the requested level (agy offers only `low`/`medium`/`high`, so `~effort=xhigh`/`max` take High and you say so). With no effort requested, keep an exact match's own level; for a base-completion or roster-default family, use High. Report the resolution whenever the final pick differs from the literal request, e.g. `resolved agy[gemini-3.8-flash]~effort=low -> gemini-3.8-flash-low`.
- If the family has no variants (e.g. a Claude *Thinking* entry) or `agy models` printed nothing (offline, not signed in), keep the resolved model as-is; effort stays prompt-advisory. Never invent a variant that wasn't listed.
- **Never pass `--effort` alongside `--model`.** agy accepts the pair only when the level agrees with the pinned variant (`--model gemini-3.8-flash-high --effort low` is a hard `conflicts with --effort=low` exit) and a variant-less model rejects `--effort` outright; since this loop always pins a model, the flag is only ever redundant or fatal.
- **Record the choice.** Set `AGY_REVIEW_MODEL` to the chosen entry, reuse it in every Step 2 invocation of this loop, and set `AGY_MODEL_RESOLVED=1` so later iterations do not re-fetch the roster.

### Isolation and invocation

Capability references (recheck installed CLI help before use): [Antigravity permissions](https://www.antigravity.google/docs/cli/permissions/) and [terminal sandbox](https://www.antigravity.google/docs/cli/sandbox/). Rechecked against agy 1.2.2 and 1.2.5: no per-invocation settings-file selector and no tool-allowlist flag (the print-mode surface is `--print`/`--print-timeout`/`--model`/`--effort`/`--agent`/`--mode`/`--sandbox`/`--disable-slash-commands`/`--output-format`/`--json-schema` plus one blanket approve-everything switch this loop never uses). Do not invent `--settings`, rewrite global settings, or assume `--sandbox` is read-only (its workspace mount permits writes). Run the tool-free fallback (prompt-only) rather than returning `no-verdict`; Steps 1/3's snapshot+revert is the backstop. Always pass `--disable-slash-commands`: without it a `/`-prefixed line in the reviewed diff can expand as a slash command in the reviewer session — prompt injection through review data.

`{INVOCATION}`:

```bash
agy -p "$LOCAL_PROMPT" --model "$AGY_REVIEW_MODEL" --print-timeout 30m --disable-slash-commands
```

`--print-timeout 30m` is required — agy's own default is `5m0s` and a review routinely runs longer; omitting it produces an empty log and a false `no-verdict`.
