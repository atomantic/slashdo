---
description: View or set saved slashdo defaults (e.g. --review-with) so future commands can omit the flag
argument-hint: "[--show] [--project] [--review-with <list>] [--review-models <agent=model,...>] [--review-iterations <n>] [--review-mode <series|parallel>] [--reviewer-applies|--no-reviewer-applies] [--review-stop-on-findings|--review-stop-on-clean|--review-stop-all] [--issues|--no-issues] [--issues-label <name>] [--self|--no-self] [--collaborators|--no-collaborators] [--trusted-authors <list>] [--merge|--no-merge|--merge=<method>] [--merge-method <method>] [--unset <key>] [--reset]"
---

## Purpose

`/do:config` reads and writes **saved defaults** for the shared review-loop flags so you can omit them on future commands. Set them once:

```
/do:config --review-with=claude,codex,ollama[qwen2.5-coder:32b]
```

…and afterward `/do:pr`, `/do:release`, `/do:review`, `/do:better`, `/do:better-swift`, `/do:simplify`, `/do:depfree`, and `/do:rpr` behave as if you had passed `--review-with=claude,codex,ollama[qwen2.5-coder:32b]` — unless you pass an explicit flag on that run (which always wins) or `--review-with none` to skip reviewers for a single run.

The store also holds:

- **Per-agent default models** — `--review-models codex=o3,claude=claude-opus-4-8,cursor=gpt-5,opencode=muse-1.3` pins which model each model-taking reviewer (`codex`, `claude`, `agy`, `grok`, `pi`, `cursor`, `opencode`, `ollama`; `copilot` and `@<login>` take no model) runs on, so future runs can omit the `<agent>[<model>]` bracket. Cursor effort is not a separate key — save it on the `--review-with` token (`--review-with cursor[gpt-5]~effort=max`, or `--review-with cursor~effort=max` plus a `review-models` entry for the loop to fold `[effort=max]` into). An explicit bracket — typed on the run or carried by a saved `review-with` — always wins over `review-models`; a project-scoped entry overrides the global one per agent. For `agy`, saving a **bare base** name (`--review-models agy=gemini-3.8-flash`, no level suffix) is supported, not a stale-name hazard: the review loop completes it against the pinned `~effort` level (or the roster-default level with none given) at run time, since `agy models` only lists leveled entries.
- **Issue-mode default** (`--issues`) — every command that accepts `--issues` (`/do:next`, `/do:replan`, `/do:better`, `/do:better-swift`, `/do:simplify`, `/do:depfree`, `/do:review`, `/do:rpr`) defaults to tracker issues instead of `PLAN.md`. A **destination**, not a run mode: pipeline commands still remediate and PR as normal (pair with `--scan-only` for audit-and-file). `--issues-label <name>` saves the scoping label.
- **`/do:next` claim gates** — `--self` (only issues filed by `@me`), `--collaborators` (only issues filed by a live repo collaborator **or** a `--trusted-authors` login; SELF_MODE wins when both are on), and `--trusted-authors howlingmime,Joebok` (extra authors unioned into the collaborator set when that gate is on; not a replacement for the live fetch, and inert when it is off). Security boundaries for shared/public trackers. Only `/do:next` reads these.
- **Auto-merge default for `/do:pr`** — `--merge` merges automatically once reviews and CI are solid; `--merge-method squash|rebase|merge` (or the shorthand `--merge=squash`) saves the method. Only `/do:pr` reads these.

A `--no-<flag>` on a single run overrides any of these for that run.

The config is a generic JSON store keyed under a `defaults` object, so new keys can be added without changing the file shape. It coexists with other top-level keys (e.g. `autoUpdate`) — never clobber them.

## Scope (where defaults are written)

- **Global (default)** — the host CLI's config file at `~/.claude/.slashdo-config.json` (the path installed for whichever CLI you're running in). Applies everywhere on this machine.
- **Per-project (`--project`)** — a `.slashdo.json` file at the repository root (`git rev-parse --show-toplevel`). Overrides the global defaults for this repo only. If `--project` is passed outside a git repo, abort with: `--project requires a git repository (no repo root found).`

At read time, **per-project overrides global, key by key** (see `lib/review-config-defaults.md`).

## Parse `$ARGUMENTS`

1. Determine `SCOPE`: `project` if `--project` is present, else `global`. Resolve `TARGET_FILE`:
   - global → `~/.claude/.slashdo-config.json`
   - project → `{repo-root}/.slashdo.json`
2. Determine the **action**:
   - **Show** — no setting/unset/reset flags are present (only `--show`, only `--project`, or no args). Go to "Show effective config".
   - **Reset** — `--reset` is present: clear the entire `defaults` object in `TARGET_FILE` (preserve every other top-level key). Then re-show.
   - **Unset** — one or more `--unset <key>`: remove those keys from `defaults` in `TARGET_FILE`.
   - **Set** — one or more recognized setting flags are present: validate and merge them into `defaults`.
   `--unset` and setting flags may be combined in one call; apply unsets first, then sets.
3. **Recognized setting flags** (parse and validate each that is present, with the same rules the review commands use). Every boolean flag's `--no-*` opposite stores an explicit `false` so a **project** default can override an inherited global `true`; `--unset <key>` instead removes the key and falls back to the lower-precedence value. Each flag/opposite pair is mutually exclusive.
   - `--review-with <list>` → key `review-with`. Split on `,`, trim, then for each entry strip **every** trailing `~` suffix — `~opt` into a per-entry optional flag, `~max=<n>` into a per-entry iteration cap, `~effort=<level>` into a per-entry reasoning effort — **before** validating the remaining slug (suffixes may appear in any order). Validate each `~max` value as a non-negative integer and each `~effort` value as one of `low`, `medium`, `high`, `xhigh`, `max`, at most one of each per entry, rejecting anything else with `Invalid --review-with suffix on {entry}: ~max must be a non-negative integer and ~effort must be one of low, medium, high, xhigh, max, each appearing at most once; the only suffixes are ~opt, ~max=<n>, and ~effort=<level>.` Then normalize `gemini`/`antigravity` → `agy`, `cursor-agent` → `cursor`, `zen`/`opencode-zen` → `opencode`, validate each remaining slug ∈ {`copilot`, `codex`, `agy`, `claude`, `grok`, `pi`, `cursor`, `opencode`, `ollama`, `cmd`} with an optional `<agent>[<model>]` bracket on the model-taking reviewers `codex`/`claude`/`agy`/`grok`/`pi`/`cursor`/`opencode`/`ollama` (the bracket value is free-form — model names churn and may contain spaces/parens, e.g. `agy[Gemini 3.8 Flash (High)]`, `opencode[muse-1.3]` — so validate its shape, not against an allowlist; `copilot[…]` and `@login[…]` are invalid) — **`cmd` requires** a non-empty `[<invocation>]` bracket (bare `cmd` is invalid), the entire operator-authored shell command verbatim, an escape hatch for a harness not in this fixed list (see `lib/local-agent-review-loop.md` "The `cmd` reviewer") — or an arbitrary GitHub login `@<login>` (a user or App/bot whose review is requested on the PR; login must match `^[A-Za-z0-9][A-Za-z0-9-]*(\[bot\])?$`) — dedupe preserving first-occurrence order (each model-taking agent's `[<model>]` bracket, `cmd`'s verbatim `[<invocation>]`, and the `@<login>` login, lowercased, are part of the identity; no `~` suffix is — `ollama~opt`, `ollama~max=2`, `ollama~effort=high` and `ollama` all collapse; optional-wins for `~opt`, first-occurrence-wins for `~max` and `~effort`). Abort on an unknown slug with `Unknown --review-with value: {value}. Use one of: codex, agy, claude, grok, pi, cursor, opencode, ollama, copilot, cmd[<invocation>], @<login> (each optionally suffixed ~opt, ~max=<n>, and/or ~effort=<level>).` Store the **normalized, deduped** string with each entry's `~` suffixes **re-appended in canonical order — `~opt` first, then `~max=<n>`, then `~effort=<level>`** (e.g. `claude~opt~max=2~effort=high,ollama[qwen2.5-coder:32b]~opt~max=1,codex`), so the stored value is byte-stable whatever order the user typed. The literal `none` (case-insensitive) is also accepted and stored verbatim as `none` — an explicit "no external reviewer" tombstone, most useful with `--project`: a project-scoped `review-with=none` masks an inherited **global** reviewer default for that one repo, which `--unset review-with` cannot do (unsetting the project key just falls back to the global value). The review commands resolve a saved `none` to `REVIEW_AGENTS=[]`.
   - `--review-models <agent=model,...>` → key `review-models`, a JSON **object** keyed by agent slug (e.g. `{"codex":"o3","claude":"claude-opus-4-8"}`). Split the value on `,` into entries; split each entry on the **first** `=` into `slug=model`. Normalize `gemini`/`antigravity` → `agy`, `cursor-agent` → `cursor`, `zen`/`opencode-zen` → `opencode`. Validate each slug ∈ {`codex`, `claude`, `agy`, `grok`, `pi`, `cursor`, `opencode`, `ollama`}; reject `copilot`, an `@<login>`, or any other slug with `--review-models only accepts codex, claude, agy, grok, pi, cursor, opencode, ollama (got: {slug}) — copilot and @<login> reviewers take no model.` The model is a free-form string (trim surrounding whitespace; it may contain spaces/parens, e.g. `Gemini 3.8 Flash (High)`) — validate its shape, not against an allowlist. **Merge into the existing `review-models` object key-by-key** (do not clobber the whole map). An entry with an **empty** model — `codex=` — **removes** that agent's key (the per-agent analog of `--unset`). Reject a malformed entry (no `=`, or an empty slug) with `--review-models entries must be <agent>=<model> (got: {entry}).` Store the resulting object. `review-models` never selects which reviewers run (that is `--review-with`) — it only pins the model for a reviewer already listed there, and an explicit `<agent>[<model>]` bracket (typed on the run or carried by a saved `review-with` default) overrides it.
   - `--review-iterations <n>` → key `review-iterations`. Must be a non-negative integer; else abort with `--review-iterations must be a non-negative integer (got: {value}).` Store as a number.
   - `--reviewer-applies` → key `reviewer-applies`, value `true`. `--no-reviewer-applies` → value `false`.
   - `--review-stop-on-findings` / `--review-stop-on-clean` → key `review-stop-mode`, value `"on-findings"` / `"on-clean"`. The explicit default `--review-stop-all` → value `"all"` (so a **project** default can override an inherited global stop-mode). The three are mutually exclusive — if more than one is present, abort with `--review-stop-on-findings, --review-stop-on-clean, and --review-stop-all are mutually exclusive`.
   - `--review-mode <series|parallel>` → key `review-mode`. Must be one of `series`/`parallel`; else abort with `--review-mode must be one of series, parallel (got: {value}).` Store the string verbatim. Selects how the multi-reviewer loop dispatches reviewers (`series` — one-at-a-time, each sees the prior's fixes, the built-in default; `parallel` — reviews run concurrently, then the union is applied once). Read by `/do:pr`, `/do:review`, `/do:better`, `/do:better-swift`, `/do:simplify`, `/do:depfree`, and `/do:release` (`/do:rpr` ignores it).
   - `--issues` → key `issues`, value `true`. `--no-issues` → value `false` (back to PLAN.md mode). A saved `issues=true` changes only where deferred findings are recorded, never remediation behavior; an explicit `--issues`/`--no-issues` on a run still wins.
   - `--issues-label <name>` → key `issues-label`. Store the string verbatim — the label that scopes plan-tracking issues (built-in default `plan`). Only meaningful once issue mode is on.
   - `--self` → key `self`, value `true`. `--no-self` → value `false`. A saved `self=true` makes `/do:next --issues` claim only issues filed by the running account (`@me`) — auto-pick filters out others and an explicit `#<num>` for someone else's issue is refused; an explicit `--self`/`--no-self` on a run still wins. Only `/do:next` reads this key, and only in issue mode (PLAN.md items have no author).
   - `--collaborators` → key `collaborators`, value `true`. `--no-collaborators` → value `false`. `--self` and `--collaborators` are **not** mutually exclusive — both may be stored; at runtime SELF_MODE wins when both are on (`@me` is a subset of collaborators). A saved `collaborators=true` makes `/do:next --issues` claim only issues filed by a current repo collaborator (live host-API list) **or** a `--trusted-authors` login — auto-pick filters out others and an explicit `#<num>` for someone in neither set is refused; an explicit `--collaborators`/`--no-collaborators` on a run still wins. Only `/do:next` reads this key, and only in issue mode.
   - `--trusted-authors <list>` → key `trusted-authors`, a comma-separated string of GitHub/GitLab logins (e.g. `howlingmime,Joebok`). Split on `,`, trim, strip a leading `@`, reject empty entries (except a lone `none`). Validate each login against `^[A-Za-z0-9][A-Za-z0-9-]*(\[bot\])?$` (the same shape as `@<login>` reviewers); abort with `Invalid --trusted-authors login: {value}. Use GitHub/GitLab logins (comma-separated), or none to clear.` Dedupe case-insensitively, preserving first-occurrence spelling, and store the **normalized, deduped** comma-separated string. The literal `none` (case-insensitive) or an empty value is a tombstone stored as `none` — no extra authors — so a project-scoped `none` can mask an inherited global list (`--unset trusted-authors` instead removes the key and falls back). This list is extra trusted *authors* only, unioned into `/do:next --collaborators`' live collaborator set; it is not a saved collaborator allowlist, and when collaborators mode is off it does not restrict or widen auto-pick. An explicit `--trusted-authors` on a `/do:next` run still wins. Only `/do:next` reads this key, and only in issue mode.
   - `--merge` → key `merge`, value `true`. `--no-merge` → value `false` (leave-open). The shorthand `--merge=<method>` sets `merge=true` **and** `merge-method=<method>` in one token (`<method>` validated against `squash`/`rebase`/`merge` with the same abort as `--merge-method` below). If both `--merge=<method>` and `--merge-method <method>` are given with **different** methods, abort with `--merge=<method> and --merge-method specify conflicting methods ({first} vs {second})`; identical methods are accepted. A saved `merge=true` makes `/do:pr` auto-merge once reviews and CI are solid; an explicit `--merge`/`--no-merge` on a run still wins. Only `/do:pr` reads this key.
   - `--merge-method <method>` → key `merge-method`. Must be one of `squash`, `rebase`, `merge`; else abort with `--merge-method must be one of squash, rebase, merge (got: {value}).` The method `/do:pr` uses when auto-merging; when unset, `/do:pr` falls back to the repo's allowed method. Only meaningful alongside merge mode.
   - Any other `--flag` that is not one of the above and not `--show`/`--project`/`--reset`/`--unset` → abort with: `Unknown /do:config option: {flag}. Supported: --review-with, --review-models, --review-iterations, --review-mode, --reviewer-applies, --no-reviewer-applies, --review-stop-on-findings, --review-stop-on-clean, --review-stop-all, --issues, --no-issues, --issues-label, --self, --no-self, --collaborators, --no-collaborators, --trusted-authors, --merge, --no-merge, --merge-method, --unset <key>, --reset, --show, --project.`
4. **`--unset <key>`**: `<key>` must be one of `review-with`, `review-models`, `review-iterations`, `review-mode`, `reviewer-applies`, `review-stop-mode`, `issues`, `issues-label`, `self`, `collaborators`, `trusted-authors`, `merge`, `merge-method`. Reject others with `Unknown --unset key: {key}. Valid keys: review-with, review-models, review-iterations, review-mode, reviewer-applies, review-stop-mode, issues, issues-label, self, collaborators, trusted-authors, merge, merge-method.` (`--unset review-models` clears the entire per-agent map; to clear one agent, set an empty model with `--review-models <agent>=`.)

## Apply (read → modify → write)

Do this with your file tools (do not assume `jq` is installed):

1. **Read** `TARGET_FILE` if it exists and parse it as JSON into `CONFIG` (on a missing file use `{}`; on a parse error, abort with `{TARGET_FILE} is not valid JSON — fix or remove it before saving defaults.` rather than overwriting a corrupt-but-meaningful file). Ensure `CONFIG.defaults` is an object (create `{}` if absent).
2. **Apply** the action to `CONFIG.defaults`: delete unset keys, set/overwrite the validated keys, or (for `--reset`) replace `CONFIG.defaults` with `{}`. Leave all other top-level keys (e.g. `autoUpdate`) untouched.
3. **Write** `CONFIG` back to `TARGET_FILE` as pretty JSON (2-space indent) with a trailing newline. Create the parent directory if needed (only relevant for the project file at a fresh repo root). If, after the change, `CONFIG` holds nothing but an empty `defaults` and the file is the per-project one, you may still write it (an explicit empty `.slashdo.json` is harmless), or remove it on `--reset`.

## Show effective config

Print three things so the user understands what will actually apply:

```
## slashdo defaults

Global (~/.claude/.slashdo-config.json):
  review-with        = {value or "(unset)"}
  review-models      = {agent=model pairs joined by ", ", or "(unset)"}
  review-iterations  = {value or "(unset)"}
  review-mode        = {value or "(unset)"}
  reviewer-applies   = {value or "(unset)"}
  review-stop-mode   = {value or "(unset)"}
  issues             = {value or "(unset)"}
  issues-label       = {value or "(unset)"}
  self               = {value or "(unset)"}
  collaborators      = {value or "(unset)"}
  trusted-authors    = {value or "(unset)"}
  merge              = {value or "(unset)"}
  merge-method       = {value or "(unset)"}

Project ({repo-root}/.slashdo.json):
  {same keys, or "(no .slashdo.json in this repo)"}

Effective (project overrides global):
  review-with        = {merged value or "(none — no external reviewer)"}
  review-models      = {per-agent merged pairs (project overrides global per agent), or "(none — each reviewer's built-in default)"}
  review-iterations  = {merged value or "1 (built-in default)"}
  review-mode        = {merged value or "series (built-in default)"}
  reviewer-applies   = {merged value or "false (built-in default)"}
  review-stop-mode   = {merged value or "all (built-in default)"}
  issues             = {merged value or "false (built-in default — PLAN.md mode)"}
  issues-label       = {merged value or "plan (built-in default)"}
  self               = {merged value or "false (built-in default — any author)"}
  collaborators      = {merged value or "false (built-in default — any author)"}
  trusted-authors    = {merged value or "(none — no extra authors)"}
  merge              = {merged value or "false (built-in default — leave PR open)"}
  merge-method       = {merged value or "(repo default)"}
```

After a Set/Unset/Reset action, re-print this block so the result is visible, prefixed with a one-line confirmation, e.g. `Saved global default: review-with = claude,codex,ollama[qwen2.5-coder:32b]`.

## Notes

- This command only ever writes to the config of the **CLI you run it in** (host-CLI only). It does not mirror defaults into other installed slashdo environments.
- The review commands consume these defaults via the shared procedure in `lib/review-config-defaults.md`; the precedence and the `--review-with none` per-run escape hatch are defined there.
