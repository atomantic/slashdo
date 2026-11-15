---
description: View or set saved slashdo defaults (e.g. --review-with) so future commands can omit the flag
argument-hint: "[--show] [--project] [--review-with <list>] [--review-models <agent=model,...>] [--review-iterations <n>] [--review-mode <series|parallel>] [--reviewer-applies|--no-reviewer-applies] [--review-stop-on-findings|--review-stop-on-clean|--review-stop-all] [--issues-label <name>] [--depfree-allow <patterns>] [--self|--no-self] [--collaborators|--no-collaborators] [--trusted-authors <list>] [--approve|--no-approve] [--merge|--no-merge|--merge=<method>] [--merge-method <method>] [--code-host <github|gitlab>] [--tracker <github|gitlab|jira>] [--jira-project <KEY>] [--unset <key>] [--reset]"
---

## Purpose

`/do:config` reads and writes **saved defaults**, so a flag set once can be omitted on later commands:

```
/do:config --review-with=claude,codex,ollama[qwen2.5-coder:32b]
```

Afterward every command that reads the `review-with` key behaves as if that flag had been passed. An explicit flag on a run always wins over a saved default, and a `--no-<flag>` (or `--review-with none`) overrides it for that run.

The defaults live under a `defaults` object in a JSON file that also holds other top-level keys (such as `autoUpdate`); never clobber those.

## Scope

- **Global (default)** — the host CLI's config file at `~/.claude/.slashdo-config.json`. Applies everywhere on this machine, for the CLI you run the command in; defaults are not mirrored into other installed slashdo environments.
- **Per-project (`--project`)** — `.slashdo.json` at the repository root (`git rev-parse --show-toplevel`). Outside a git repo, abort with: `--project requires a git repository (no repo root found).`

At read time the project value overrides the global one, key by key (see `lib/review-config-defaults.md`). The one exception is `depfree-allow`, where the two lists are unioned: an empty project list cannot clear global policy, so a global allowance is removed in the global scope.

## Keys

This table is the complete list of saved keys. Everything below — the unknown-flag message, `--unset`, and the Show output — refers to it instead of repeating it.

| Flag(s) | Key | Stored value | Built-in default when unset | Read by |
|---|---|---|---|---|
| `--review-with <list>` | `review-with` | normalized string, or `none` | no external reviewer | the review commands: `/do:pr`, `/do:release`, `/do:review`, `/do:better`, `/do:better-swift`, `/do:simplify`, `/do:depfree`, `/do:rpr` |
| `--review-models <agent=model,...>` | `review-models` | object keyed by agent slug | each reviewer's own default model | the review commands |
| `--review-iterations <n>` | `review-iterations` | non-negative integer | `1` | the review commands except `/do:rpr` |
| `--review-mode <series\|parallel>` | `review-mode` | `series` or `parallel` | `series` | the review commands except `/do:rpr` |
| `--reviewer-applies` / `--no-reviewer-applies` | `reviewer-applies` | `true` / `false` | `false` | the review commands |
| `--review-stop-on-findings` / `--review-stop-on-clean` / `--review-stop-all` | `review-stop-mode` | `on-findings` / `on-clean` / `all` | `all` | the review commands except `/do:rpr` |
| `--issues-label <name>` | `issues-label` | string, verbatim | `plan` | every command that files or reads tracker issues |
| `--depfree-allow <patterns>` | `depfree-allow` | array of strings | `[]` | `/do:depfree`, in every mode |
| `--self` / `--no-self` | `self` | `true` / `false` | `false` (any author) | `/do:next` |
| `--collaborators` / `--no-collaborators` | `collaborators` | `true` / `false` | `false` (any author) | `/do:next` |
| `--trusted-authors <list>` | `trusted-authors` | normalized string, or `none` | no extra authors | `/do:next` |
| `--approve` / `--no-approve` | `approve` | `true` / `false` | `true` | `/do:review` in PR/MR mode |
| `--merge` / `--no-merge` / `--merge=<method>` | `merge` | `true` / `false` | `false` for `/do:pr`, `true` for `/do:next` | `/do:pr`, `/do:next` |
| `--merge-method <method>` | `merge-method` | `squash`, `rebase` or `merge` | the repo's allowed method | `/do:pr`, `/do:next` |
| `--code-host <github\|gitlab>` | `code-host` | `github` or `gitlab` | detected from the `origin` remote | every command that selects a host (`lib/vcs-host.md`) |
| `--tracker <github\|gitlab\|jira>` | `tracker` | `github`, `gitlab` or `jira` | same as the code host | every tracker-backed command (`lib/vcs-host.md`) |
| `--jira-project <KEY>` | `jira-project` | uppercase project key | unset; required when `tracker` is `jira` | the Jira backend (`lib/tracker-jira.md`) |

Each boolean flag's `--no-*` form stores an explicit `false`, so a project default can turn off an inherited global `true`; `--unset <key>` instead removes the key and falls back to the lower-precedence value. A flag and its opposite are mutually exclusive.

What each key does at run time is specified where it is consumed — `lib/review-config-defaults.md` for the review keys, `lib/config-defaults-issues-merge.md` for the issue and merge keys, `lib/vcs-host.md` for the host keys, `/do:next` for its claim gates (`self`: only issues the running account filed; `collaborators`: only issues filed by a current repo collaborator or a `trusted-authors` login; both may be stored, and `self` wins when both are on), and `/do:review` for `approve` (approve someone else's change when the review ends with no unresolved CRITICAL finding). The rules below cover only validating and storing a value.

### Validation and storage

**`review-with`.** Parse and validate the list with the grammar every review command uses, owned by this partial:

!read lib/review-flags.md

Saving differs from a single run's parse in three ways:
- When `SCOPE=project`, reject any `cmd[…]` entry with `cmd[<invocation>] cannot be saved in the per-project .slashdo.json — it is repo content and would let the repo choose a shell command; save it globally instead (omit --project).` The project file is committed and shared, so a shell command stored there would run for every maintainer who checks the repo out.
- The literal `none` (case-insensitive) is accepted and stored as `none`. It is a tombstone meaning "no external reviewer": saved with `--project` it masks an inherited global reviewer list for that repo, which `--unset review-with` cannot do.
- Store the normalized, deduped string with each entry's suffixes in canonical order — `~opt`, then `~max=<n>`, then `~effort=<level>` (e.g. `claude~opt~max=2~effort=high,ollama[qwen2.5-coder:32b]~opt~max=1,codex`) — so the stored value is the same whatever order the user typed.

**`review-models`.** Split the value on `,` into entries and each entry on the first `=` into `slug=model`. Normalize `gemini`/`antigravity` → `agy`, `cursor-agent` → `cursor`, `zen`/`opencode-zen` → `opencode`. The slug must be one of `codex`, `claude`, `agy`, `grok`, `pi`, `cursor`, `opencode`, `ollama`; otherwise abort with `--review-models only accepts codex, claude, agy, grok, pi, cursor, opencode, ollama (got: {slug}) — copilot and @<login> reviewers take no model.` Reject an entry with no `=` or an empty slug with `--review-models entries must be <agent>=<model> (got: {entry}).` The model is free-form (trim it; it may contain spaces and parentheses) and is not checked against a list. Merge into the existing object key by key instead of replacing it; an entry with an empty model (`codex=`) removes that agent's key. Two things that look like mistakes and are not: a bare `agy` base name with no level suffix is valid, because the review loop completes it against the `~effort` level at run time; and Cursor effort is not a key here — it is saved on the `--review-with` token (`cursor~effort=max`). This key only pins the model for a reviewer already listed in `review-with`, and an explicit `<agent>[<model>]` bracket overrides it.

**`review-iterations`.** Not a non-negative integer → `--review-iterations must be a non-negative integer (got: {value}).` Store a number.

**`review-mode`.** Not `series` or `parallel` → `--review-mode must be one of series, parallel (got: {value}).`

**`review-stop-mode`.** More than one of the three flags → `--review-stop-on-findings, --review-stop-on-clean, and --review-stop-all are mutually exclusive`.

**`depfree-allow`.** Split the comma-separated list, trim each entry, and reject an empty entry or whitespace inside a pattern with `--depfree-allow requires comma-separated nonblank package-name patterns.` Dedupe case-sensitively in first-occurrence order and store an array, e.g. `--depfree-allow '@aws-sdk/*,pg'` → `["@aws-sdk/*","pg"]` (quote wildcards in a shell). Setting replaces only the chosen scope's list; `--unset depfree-allow` or `--reset` clears only that scope. Entries are plain strings; per-entry reason objects are not supported. Loading, validating and unioning the two scopes follows the shared procedure below. Apply the requested Set/Unset/Reset edit before validating the resulting policy, so a malformed allowance can be repaired with this command:

!read lib/depfree-policy.md

**`trusted-authors`.** Split on `,`, trim, strip a leading `@`, and reject empty entries. Each login must match `^[A-Za-z0-9][A-Za-z0-9-]*(\[bot\])?$`; otherwise abort with `Invalid --trusted-authors login: {value}. Use GitHub/GitLab logins (comma-separated), or none to clear.` Dedupe case-insensitively, keeping the first spelling, and store the comma-separated string. The literal `none` (case-insensitive) or an empty value is stored as `none`, a tombstone that masks an inherited global list.

**`approve`.** `--approve` with `--no-approve` → `--approve and --no-approve cannot be combined`.

**`merge` and `merge-method`.** `--merge=<method>` sets `merge=true` and `merge-method=<method>` together. A method that is not `squash`, `rebase` or `merge`, from either flag → `--merge-method must be one of squash, rebase, merge (got: {value}).` `--merge=<method>` and `--merge-method` naming different methods → `--merge=<method> and --merge-method specify conflicting methods ({first} vs {second})`; the same method twice is fine.

**`code-host`, `tracker`.** Lowercase the value. Outside the allowed set → `--code-host must be one of github, gitlab (got: {value}).` or `--tracker must be one of github, gitlab, jira (got: {value}).` `code-host` is for a self-managed GitLab or GitHub Enterprise host whose hostname does not say which forge it is; `tracker=jira` also needs `jira-project` and an authenticated [jira CLI](https://github.com/ankitpokhrel/jira-cli). Both usually belong in `--project` scope, since they describe one repo.

**`jira-project`.** Uppercase the value; it must match `^[A-Z][A-Z0-9_]+$`, else `--jira-project must be a Jira project key like PROJ (got: {value}).`

## Parse `$ARGUMENTS`

1. `SCOPE` is `project` if `--project` is present, else `global`. `TARGET_FILE` is the corresponding file from Scope.
2. Determine the action:
   - **Show** — no setting, unset or reset flag is present. Go to "Show effective config".
   - **Reset** — `--reset`: replace the `defaults` object in `TARGET_FILE` with `{}`.
   - **Unset** — one or more `--unset <key>`: remove those keys. `<key>` is any key in the table, or `issues` (a removed key, accepted only so a stale value can be cleaned up). Reject anything else with `Unknown --unset key: {key}. Valid keys: {every key in the table, then issues}.` `--unset review-models` clears the whole map.
   - **Set** — one or more flags from the table: validate each and merge it into `defaults`.

   `--unset` and setting flags may be combined; apply unsets first.
3. `--issues` / `--no-issues` were removed with PLAN.md mode; abort with `/do:config --issues/--no-issues was removed: PLAN.md mode no longer exists, issues are always used. Run /do:config --unset issues to clean up a saved value.`
4. Any other flag → `Unknown /do:config option: {flag}. Supported: {every flag in the table}, --unset <key>, --reset, --show, --project.`

## Apply (read → modify → write)

Use file tools; do not assume `jq` is installed.

1. **Read** `TARGET_FILE` and parse it as JSON into `CONFIG`. A missing file is `{}`. On a parse error abort with `{TARGET_FILE} is not valid JSON — fix or remove it before saving defaults.` instead of overwriting a file that may still hold something meaningful. Create `CONFIG.defaults` as `{}` if absent.
2. **Apply** the action to `CONFIG.defaults` and leave every other top-level key untouched.
3. **Write** `CONFIG` back as JSON with 2-space indentation and a trailing newline, creating the parent directory if needed.

## Show effective config

Print three blocks, each listing every key in table order. For `review-models` print `agent=model` pairs; for `depfree-allow` print the JSON array.

```
## slashdo defaults

Global (~/.claude/.slashdo-config.json):
  review-with        = {value or "(unset)"}
  ... one line per key ...

Project ({repo-root}/.slashdo.json):
  {same keys, or "(no .slashdo.json in this repo)"}

Effective (project overrides global; depfree-allow is unioned):
  review-with        = {merged value, or "(none — no external reviewer)"}
  review-iterations  = {merged value, or "1 (built-in default)"}
  ... one line per key ...
```

In the Effective block, a key set in neither scope shows its built-in default from the table, marked as such. `review-models` merges per agent, and `depfree-allow` shows the union of both scopes.

After a Set, Unset or Reset, print a one-line confirmation (e.g. `Saved global default: review-with = claude,codex`) followed by this output.
