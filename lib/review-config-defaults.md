### Saved defaults (set via `/do:config`)

Saved defaults fill in a shared review flag the user omitted; apply them **before**
deciding a flag was omitted. The first source that provides a value wins:

1. **Explicit flag in `$ARGUMENTS`.** `--review-with none` means no external reviewer
   this run: `REVIEW_AGENTS=[]`, ignoring any saved `review-with`.
2. **Per-project** — `.slashdo.json` at the repo root, its `defaults` object.
3. **Global** — `~/.claude/.slashdo-config.json`, its `defaults` object.
4. **Built-in default** — the command's own documented default.

Procedure (once, during argument parsing):

1. `GLOBAL_DEFAULTS` = `.defaults` of `cat ~/.claude/.slashdo-config.json 2>/dev/null`.
2. `PROJECT_DEFAULTS` = `.defaults` of `ROOT=$(git rev-parse --show-toplevel 2>/dev/null) && cat "$ROOT/.slashdo.json" 2>/dev/null`.
   A missing file, parse error, or missing key is `{}`.
3. `EFFECTIVE = { ...GLOBAL_DEFAULTS, ...PROJECT_DEFAULTS }` (project wins key by key).
4. For each shared flag **this command supports** that is **not present in
   `$ARGUMENTS`** — decided purely by the flag's absence from the command line, NOT by
   whether a variable holds a provisional built-in value — parse and validate
   `EFFECTIVE`'s value exactly as if typed, so a malformed saved value gets the typed
   error. Keys:
   - `review-with` → `--review-with` (string). Per-entry `~opt`, `~max=<n>`, and
     `~effort=<level>` suffixes ride through verbatim; a per-entry `~max` overrides
     `review-iterations` for that entry. **Tombstone:** an effective value of `none`
     (case-insensitive) means `REVIEW_AGENTS=[]` with no fallback to a lower source —
     an explicit opt-out, not a slug. **`cmd[<invocation>]` is honored only from the
     command line or the global config** ([local-agent-cmd.md](./local-agent-cmd.md)):
     before parsing `PROJECT_DEFAULTS["review-with"]`, drop each `cmd[…]` entry
     (matching `cmd[` outside any other bracket) and print, once per entry,
     `Ignoring cmd[...] from .slashdo.json: project-level config is repo content and cannot supply a shell command — put it in the global config (/do:config --review-with) or type it on the command line.`
     A dropped entry is not a requested reviewer. If no project entries remain, treat
     the project key as absent so the global value applies.
   - `review-models` → `EFFECTIVE_REVIEW_MODELS`, a map of agent slug
     (`codex`/`claude`/`agy`/`grok`/`pi`/`cursor`/`opencode`/`ollama`) to model,
     **deep-merged per agent** (project overrides global for that agent only). It
     fills a model only for an entry with no `[<model>]` bracket, never selects
     reviewers, and is passed to the multi-reviewer loop as `{REVIEW_MODELS}`.
   - `review-iterations` → `--review-iterations` (integer).
   - `reviewer-applies` → `--reviewer-applies` (`true` = set).
   - `review-stop-mode` → `"on-findings"` ≡ `--review-stop-on-findings`,
     `"on-clean"` ≡ `--review-stop-on-clean`, `"all"`/absent ≡ neither.
   - `review-mode` → `--review-mode <series|parallel>` (built-in `series`).
5. Anything still unset takes the built-in default. For `review-with` that is
   `REVIEW_AGENTS=[]` in **every** command: no reviewer, `copilot` least of all, is
   ever added implicitly. A resolved `none` tombstone counts as set.
6. If any saved default applied, print one line naming its source:
   `Using saved defaults: --review-with={value}{, --review-iterations=…}{ — project|global}`.

Only flags the command documents are eligible: `/do:rpr` reads `review-with`,
`reviewer-applies`, and `review-models` and ignores `review-iterations` /
`review-stop-mode` / `review-mode`. Non-review keys (`issues-label`, `merge`, …)
follow this precedence via [lib/config-defaults-issues-merge.md](./config-defaults-issues-merge.md)
or the command's own inline rules.
