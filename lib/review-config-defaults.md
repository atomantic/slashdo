### Saved defaults (set via `/do:config`)

Saved defaults let you omit a shared review flag and have it filled in from config. Apply them **before** deciding a flag was "omitted". Precedence, highest first — the first source that provides a value wins:

1. **Explicit flag in `$ARGUMENTS`** — always wins. The literal `--review-with none` explicitly means "no external reviewer this run": set `REVIEW_AGENTS=[]` and ignore any saved `review-with` default.
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
4. For each shared flag **this command supports** that was **not** present in `$ARGUMENTS`, take its value from `EFFECTIVE` using these keys, then feed that value through this command's normal parsing and validation exactly as if the user had typed it (so `ollama[...]` brackets, slug validation, dedupe, integer checks, and mutual-exclusion rules all still apply — a malformed saved default is rejected with the same error a typed one would get). **"Not present in `$ARGUMENTS`" is decided purely by the flag's absence from the user's command line — NOT by whether a variable already holds a value.** The earlier per-flag parse bullets may have eagerly named a built-in default (e.g. "set `REVIEW_STOP_MODE=all`", `REVIEWER_APPLIES=false`, `REVIEW_ITERATIONS=1`); treat any such value as *provisional, not yet resolved* at this point. A saved default still applies to every key the user did not type — not just `review-with` — and the built-in default is only the final fallback in step 5. The keys:
   - `review-with` → the `--review-with` list (string). **Tombstone:** if the effective `review-with` value is the literal `none` (case-insensitive) — which a user saves, typically with `--project`, to opt one repo out of an inherited global reviewer — set `REVIEW_AGENTS=[]` and do **not** fall back to any lower-precedence source or built-in default. A saved `none` is an explicit opt-out, exactly like passing `--review-with none` on the command line; it is not a reviewer slug and is not validated as one.
   - `review-iterations` → `--review-iterations` (integer)
   - `reviewer-applies` → `--reviewer-applies` (boolean; `true` means the flag is set)
   - `review-stop-mode` → the stop-mode flags: `"on-findings"` ≡ `--review-stop-on-findings`, `"on-clean"` ≡ `--review-stop-on-clean`, `"all"` (or absent) ≡ neither
   - `issues` → the `--issues` / `--no-issues` flags (boolean; `true` ≡ `--issues` = issue mode, `false` or absent ≡ PLAN.md mode). The per-run override is a typed flag in **either** direction — `--issues` forces issue mode and `--no-issues` forces PLAN.md mode — exactly like `--reviewer-applies`/`--no-reviewer-applies`: whichever the user typed wins over the saved default. A stored `false` is an explicit opt-out a project uses (typically with `--project`) to mask an inherited global `issues=true`; `--unset issues` instead removes the key and falls back to the lower-precedence value.
   - `issues-label` → `--issues-label <name>` (string; the label that scopes plan-tracking issues, built-in default `plan`). Only meaningful once issue mode is on (via flag or the `issues` default).
5. After applying defaults, fall back to the command's built-in default for anything still unset (for `review-with` that is `REVIEW_AGENTS=[]`, except `/do:rpr` whose built-in default is the conditional `copilot`). A resolved `none` tombstone (above) counts as *set* — it does not fall through to rpr's conditional `copilot`.
6. If any default was applied (i.e. not overridden by an explicit flag), print one line so the choice is visible, naming the source:
   `Using saved defaults: --review-with={value}{, --review-iterations=…}{ — project|global}`.

Only the flags a given command actually documents are eligible — e.g. `/do:rpr` reads `review-with` and `reviewer-applies` but ignores `review-iterations` / `review-stop-mode`, matching its own flag set. The `issues` / `issues-label` keys are read by every command that accepts `--issues`: the review commands (`/do:better`, `/do:better-swift`, `/do:depfree`, `/do:review`, `/do:rpr`) consume them through this inlined procedure, while `/do:next` and `/do:replan` — which don't inline this file — resolve the same two keys inline under the same precedence. Commands without an `--issues` flag ignore both keys.
