### Saved defaults (set via `/do:config`)

Saved defaults let you omit a shared review flag and have it filled in from config. Apply them **before** deciding a flag was "omitted". Precedence, highest first — the first source that provides a value wins:

1. **Explicit flag in `$ARGUMENTS`** — always wins. The literal `--review-with none` (or `--no-review`) explicitly means "no external reviewer this run": set `REVIEW_AGENTS=[]` and ignore any saved `review-with` default.
2. **Per-project defaults** — a `.slashdo.json` file at the repo root, in its `defaults` object.
3. **Global defaults** — the host CLI's slashdo config at `~/.claude/.slashdo-config.json` (this path is rewritten per host CLI at install time), in its `defaults` object.
4. **Built-in default** — this command's own documented default (e.g. no reviewer; `--review-iterations` = 1).

Procedure (run once, during argument parsing):

1. Load the global config:
   ```bash
   cat ~/.claude/.slashdo-config.json 2>/dev/null
   ```
   Parse it as JSON; `GLOBAL_DEFAULTS = .defaults` (treat a missing file, parse error, or missing key as `{}`).
2. Load the per-project config (skip silently if not in a git repo):
   ```bash
   ROOT=$(git rev-parse --show-toplevel 2>/dev/null) && cat "$ROOT/.slashdo.json" 2>/dev/null
   ```
   Parse it as JSON; `PROJECT_DEFAULTS = .defaults` (missing/invalid → `{}`).
3. Merge: `EFFECTIVE = { ...GLOBAL_DEFAULTS, ...PROJECT_DEFAULTS }` — a per-project value overrides the global one key-by-key.
4. For each shared flag **this command supports** that was **not** present in `$ARGUMENTS`, take its value from `EFFECTIVE` using these keys, then feed that value through this command's normal parsing and validation exactly as if the user had typed it (so `ollama[...]` brackets, slug validation, dedupe, integer checks, and mutual-exclusion rules all still apply — a malformed saved default is rejected with the same error a typed one would get):
   - `review-with` → the `--review-with` list (string)
   - `review-iterations` → `--review-iterations` (integer)
   - `reviewer-applies` → `--reviewer-applies` (boolean; `true` means the flag is set)
   - `review-stop-mode` → the stop-mode flags: `"on-findings"` ≡ `--review-stop-on-findings`, `"on-clean"` ≡ `--review-stop-on-clean`, `"all"` (or absent) ≡ neither
5. After applying defaults, fall back to the command's built-in default for anything still unset (for `review-with` that is `REVIEW_AGENTS=[]`, except `/do:rpr` whose built-in default is the conditional `copilot`).
6. If any default was applied (i.e. not overridden by an explicit flag), print one line so the choice is visible, naming the source:
   `Using saved defaults: --review-with={value}{, --review-iterations=…}{ — project|global}`.

Only the flags a given command actually documents are eligible — e.g. `/do:rpr` reads `review-with` and `reviewer-applies` but ignores `review-iterations` / `review-stop-mode`, matching its own flag set.
