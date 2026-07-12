# Release vNEXT

## Highlights
- **Optional (non-blocking) reviewers via a `~opt` suffix.** Suffix any `--review-with` slot with `~opt` — `--review-with=claude,ollama~opt,codex`, `--review-with=codex,@flaky-bot~opt`, `ollama[qwen2.5-coder:32b]~opt` — to keep that reviewer running and fixing findings while excluding its *inconclusive* result (timeout / skipped / incomplete / no-verdict) from the merge gate. It no longer flips `{OVERALL_STATUS}` to `inconclusive`, so it never blocks `--merge`. A hard-error from it (broken build / failed tests / rejected) still blocks — optionality never merges a broken tree. This is the answer to "I want a second opinion from a local Ollama model, but its frequent no-verdict runs shouldn't strand my PR."

## Per-agent reviewer model selection
- **[issue-112] Pin which model each reviewer runs on.** The `<agent>[<model>]` bracket now works for `codex`, `claude`, and `agy` too — not just `ollama` — so `--review-with=claude[claude-opus-4-8],codex[o3]` reviews with the models you name. Save per-reviewer defaults with `/do:config --review-models codex=o3,claude=claude-opus-4-8` (global or per-project, project overrides global per agent, shown in `/do:config --show`) so runs can omit the bracket. Precedence per reviewer: an explicit bracket → project default → global default → the reviewer's built-in default. Honored by every command that runs a reviewer (`/do:pr`, `/do:release`, `/do:review`, `/do:better`, `/do:better-swift`, `/do:depfree`, `/do:rpr`). The GitHub-side `copilot` and `@<login>` reviewers take no model.

## Added
- **`~opt` optional-reviewer marker** parsed by the multi-reviewer loop and every command that accepts `--review-with` (`/do:pr`, `/do:release`, `/do:review`, `/do:better`, `/do:better-swift`, `/do:depfree`, `/do:rpr`, and `/do:next` via pass-through to `/do:pr`). The suffix is stripped into a per-entry `{OPTIONAL}` flag **before** slug/`[model]`/`@login` parsing and is **not** part of the dedup identity (`ollama~opt` and `ollama` collapse, optional-wins on collapse). `~opt` is deliberately free of shell metacharacters, so a `--review-with` value stays inert wherever it lands in a command string.
- **Saved-default support.** `/do:config --review-with=claude,ollama~opt,codex` stores the marker verbatim (it strips `~opt` before slug validation, then re-appends it), so a saved default can pin a non-blocking reviewer without a separate key. The marker rides through `.slashdo.json` / `.slashdo-config.json` untouched.
- **Aggregate report `Optional` column** in the Multi-Reviewer Summary, so a merge that proceeded despite a no-verdict reviewer shows why (that row was non-blocking).

## Changed
- **`{OVERALL_STATUS}` computation** now excludes optional passes from the `inconclusive` determination: a `clean` aggregate requires every *non-optional* pass to be clean, while an optional pass may be clean or an excluded-inconclusive. The `dirty` (hard-error) rule is unchanged and applies regardless of optionality.
- The `Unknown --review-with value` abort message now notes each slug may be suffixed `~opt`.

## Agent Skills installs (Codex, Antigravity, Grok)
- **[issue-109] No more dangling `~/.claude/lib/…` pointers in installed skills.** On CLIs that get self-contained skill files instead of a shared library folder (Codex, Antigravity, Grok), slashdo now resolves every cross-reference between library docs when it builds each skill: a referenced doc's content is inlined into the skill, and any leftover citation is rewritten to a plain name rather than a file path the user has no way to open. A Grok-only or Codex-only install therefore no longer references guidance it can't reach. Claude Code and OpenCode installs are unchanged (they still load the library at runtime).

## Auto-update
- **[autoupdate-concurrency] One self-update at a time across concurrent sessions** — when several Claude sessions start at once with auto-update enabled, only one runs the slashdo installer; the others detect an in-progress update and defer, so concurrent sessions can no longer race the same install. A crashed update leaves a stale lock that the next session automatically reclaims.
