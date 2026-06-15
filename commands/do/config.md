---
description: View or set saved slashdo defaults (e.g. --review-with) so future commands can omit the flag
argument-hint: "[--show] [--project] [--review-with <list>] [--review-iterations <n>] [--reviewer-applies|--no-reviewer-applies] [--review-stop-on-findings|--review-stop-on-clean|--review-stop-all] [--issues|--no-issues] [--issues-label <name>] [--unset <key>] [--reset]"
---

## Purpose

`/do:config` reads and writes **saved defaults** for the shared review-loop flags so you can omit them on future commands. Set them once:

```
/do:config --review-with=claude,codex,ollama[qwen2.5-coder:32b]
```

…and afterward `/do:pr`, `/do:release`, `/do:review`, `/do:better`, `/do:better-swift`, `/do:depfree`, and `/do:rpr` behave as if you had passed `--review-with=claude,codex,ollama[qwen2.5-coder:32b]` — unless you pass an explicit flag on that run (which always wins) or `--review-with none` to skip reviewers for a single run.

The same store also holds an **issue-mode default**: `/do:config --issues` makes every command that accepts `--issues` (`/do:next`, `/do:replan`, `/do:better`, `/do:better-swift`, `/do:depfree`, `/do:review`, `/do:rpr`) default to filing/working tracker issues instead of `PLAN.md`. Pass `--no-issues` on a single run to fall back to PLAN.md mode for that run, and `--issues-label <name>` to save the scoping label.

The config is a generic JSON store keyed under a `defaults` object, so new keys can be added later without changing the file shape. It coexists with other top-level keys (e.g. `autoUpdate`) — never clobber them.

## Scope (where defaults are written)

- **Global (default)** — the host CLI's config file at `~/.claude/.slashdo-config.json` (this path is the one installed for whichever CLI you're running in). Applies everywhere you run slashdo on this machine.
- **Per-project (`--project`)** — a `.slashdo.json` file at the repository root (`git rev-parse --show-toplevel`). Overrides the global defaults for this repo only. If `--project` is passed and the working directory is not inside a git repo, abort with: `--project requires a git repository (no repo root found).`

At read time, **per-project overrides global, key by key** (see `lib/review-config-defaults.md`).

## Parse `$ARGUMENTS`

1. Determine `SCOPE`: `project` if `--project` is present, else `global`. Resolve `TARGET_FILE`:
   - global → `~/.claude/.slashdo-config.json`
   - project → `{repo-root}/.slashdo.json`
2. Determine the **action**:
   - **Show** — no setting/unset/reset flags are present (i.e. only `--show`, only `--project`, or no args at all). Go to "Show effective config".
   - **Reset** — `--reset` is present: clear the entire `defaults` object in `TARGET_FILE` (preserve every other top-level key). Then re-show.
   - **Unset** — one or more `--unset <key>`: remove those keys from `defaults` in `TARGET_FILE`.
   - **Set** — one or more recognized setting flags are present: validate and merge them into `defaults`.
   `--unset` and setting flags may be combined in one call; apply unsets first, then sets.
3. **Recognized setting flags** (parse and validate each that is present — reuse the exact same rules the review commands use):
   - `--review-with <list>` → key `review-with`. Split on `,`, trim, normalize `gemini`/`antigravity` → `agy`, validate each slug ∈ {`copilot`, `codex`, `agy`, `claude`, `ollama`} with an optional `ollama[<model>]` bracket, dedupe preserving first-occurrence order (the `ollama` bracket suffix is part of the identity). Abort on an unknown slug with `Unknown --review-with value: {value}. Use one of: copilot, codex, agy, claude, ollama.` Store the **normalized, deduped** string. The literal `none` (case-insensitive) is also accepted and stored verbatim as `none` — it is an explicit "no external reviewer" tombstone. This is most useful with `--project`: a project-scoped `review-with=none` masks an inherited **global** reviewer default for that one repo (per-project overrides global at read time), which `--unset review-with` cannot do (unsetting the project key just falls back to the global value). The review commands resolve a saved `none` to `REVIEW_AGENTS=[]`. Use `--unset review-with` when you instead want to *remove* the key and fall back to the lower-precedence default.
   - `--review-iterations <n>` → key `review-iterations`. Must be a non-negative integer; else abort with `--review-iterations must be a non-negative integer (got: {value}).` Store as a number.
   - `--reviewer-applies` → key `reviewer-applies`, value `true`. Its explicit opposite `--no-reviewer-applies` → key `reviewer-applies`, value `false` — store this (rather than `--unset`) when a **project** default needs to override an inherited global `reviewer-applies=true` back off. (`--unset reviewer-applies` removes the key entirely and falls back to the lower-precedence value.) `--reviewer-applies` and `--no-reviewer-applies` are mutually exclusive.
   - `--review-stop-on-findings` / `--review-stop-on-clean` → key `review-stop-mode`, value `"on-findings"` / `"on-clean"`. The explicit default `--review-stop-all` → key `review-stop-mode`, value `"all"` — store this when a **project** default needs to override an inherited global stop-mode back to "run every reviewer". These three are mutually exclusive — if more than one is present, abort with `--review-stop-on-findings, --review-stop-on-clean, and --review-stop-all are mutually exclusive`.
   - `--issues` → key `issues`, value `true`. Its explicit opposite `--no-issues` → key `issues`, value `false` — store this (rather than `--unset`) when a **project** default needs to override an inherited global `issues=true` back to PLAN.md mode. (`--unset issues` removes the key entirely and falls back to the lower-precedence value.) `--issues` and `--no-issues` are mutually exclusive. A saved `issues=true` makes every command that accepts `--issues` (`/do:next`, `/do:replan`, `/do:better`, `/do:better-swift`, `/do:depfree`, `/do:review`, `/do:rpr`) default to issue mode; an explicit `--issues`/`--no-issues` on a run still wins.
   - `--issues-label <name>` → key `issues-label`. Store the string verbatim — the label that scopes plan-tracking issues (built-in default `plan`). Only meaningful once issue mode is on.
   - Any other `--flag` that is not one of the above and not `--show`/`--project`/`--reset`/`--unset` → abort with: `Unknown /do:config option: {flag}. Supported: --review-with, --review-iterations, --reviewer-applies, --no-reviewer-applies, --review-stop-on-findings, --review-stop-on-clean, --review-stop-all, --issues, --no-issues, --issues-label, --unset <key>, --reset, --show, --project.`
4. **`--unset <key>`**: `<key>` must be one of `review-with`, `review-iterations`, `reviewer-applies`, `review-stop-mode`, `issues`, `issues-label`. Reject others with `Unknown --unset key: {key}. Valid keys: review-with, review-iterations, reviewer-applies, review-stop-mode, issues, issues-label.`

## Apply (read → modify → write)

Do this with your file tools (do not assume `jq` is installed):

1. **Read** `TARGET_FILE` if it exists and parse it as JSON into `CONFIG` (on a missing file use `{}`; on a parse error, abort with `{TARGET_FILE} is not valid JSON — fix or remove it before saving defaults.` rather than overwriting a corrupt-but-meaningful file). Ensure `CONFIG.defaults` is an object (create `{}` if absent).
2. **Apply** the action to `CONFIG.defaults`: delete unset keys, set/overwrite the validated keys, or (for `--reset`) replace `CONFIG.defaults` with `{}`. Leave all other top-level keys (e.g. `autoUpdate`) untouched.
3. **Write** `CONFIG` back to `TARGET_FILE` as pretty JSON (2-space indent) with a trailing newline. Create the parent directory if needed (only relevant for the project file at a fresh repo root — the global config dir already exists). If, after the change, `CONFIG` has no top-level keys other than an empty `defaults` and the file is the per-project one, you may still write it (an explicit empty `.slashdo.json` is harmless), or remove it on `--reset` if it now holds only an empty `defaults`.

## Show effective config

Print three things so the user understands what will actually apply:

```
## slashdo defaults

Global (~/.claude/.slashdo-config.json):
  review-with        = {value or "(unset)"}
  review-iterations  = {value or "(unset)"}
  reviewer-applies   = {value or "(unset)"}
  review-stop-mode   = {value or "(unset)"}
  issues             = {value or "(unset)"}
  issues-label       = {value or "(unset)"}

Project ({repo-root}/.slashdo.json):
  {same keys, or "(no .slashdo.json in this repo)"}

Effective (project overrides global):
  review-with        = {merged value or "(none — no external reviewer)"}
  review-iterations  = {merged value or "1 (built-in default)"}
  reviewer-applies   = {merged value or "false (built-in default)"}
  review-stop-mode   = {merged value or "all (built-in default)"}
  issues             = {merged value or "false (built-in default — PLAN.md mode)"}
  issues-label       = {merged value or "plan (built-in default)"}
```

After a Set/Unset/Reset action, re-print this block so the result is visible, prefixed with a one-line confirmation, e.g. `Saved global default: review-with = claude,codex,ollama[qwen2.5-coder:32b]`.

## Notes

- This command only ever writes to the config of the **CLI you run it in** (host-CLI only). It does not mirror defaults into other installed slashdo environments.
- The review commands consume these defaults via the shared procedure in `lib/review-config-defaults.md`; the precedence and the `--review-with none` per-run escape hatch are defined there.
