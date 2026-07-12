## Ollama Code Review Loop (for `--review-with ollama[<model>]`)

Run a **local Ollama model** to review the PR branch, then read its findings back into the orchestrating thread, which applies the fixes and verifies before pushing. Selected via `--review-with ollama` (auto-select the most capable installed coding model) or `--review-with ollama[<model>]` (pin a specific installed model, e.g. `ollama[qwen2.5-coder:32b]`).

Unlike the `codex` / `agy` / `claude` / `grok` reviewers, **Ollama is not an agentic CLI** — `ollama run` takes a single prompt and returns text. It cannot read the working tree, run git, or edit files. So this loop differs from the local-agent loop in two ways:

1. **The diff is embedded in the prompt.** The orchestrator feeds the model the actual `git diff` (chunked per file to stay within local-model context limits) instead of pointing a tool-using agent at the repo.
2. **It is always review-only.** The model emits findings; the *orchestrator* applies the fixes (the same flow as the local-agent loop's `REVIEWER_APPLIES=false` path). `--reviewer-applies` is a no-op here — there is no reviewer-side edit path to enable. If the calling command saw `--reviewer-applies` alongside an `ollama` reviewer, it should have already printed a warning and continued; this loop forces review-only regardless.

When to use this:
- You want a fully local, offline review with no API/cloud cost and no data leaving the machine
- You have a capable coding model installed in Ollama (e.g. `qwen2.5-coder`, `deepseek-coder-v2`, `codestral`)

**Logic-only focus (why the prompt is so emphatic).** A small local model reviewing one file's diff in isolation produces a flood of low-value findings if asked to "review against best practices" — style preferences, "extract a helper", eslint-disable nitpicks, and (worst) confident "you deleted X, this breaks Y" claims about code it cannot see was simply moved to another file. Meanwhile syntax, lint, formatting, type, and build errors are already caught by the project's own tooling, so any model effort spent re-finding them is pure waste. The per-file prompt below therefore tells the model, in strong terms, to report ONLY logic bugs it can tie to a concrete wrong runtime behavior and to treat zero findings as the normal outcome. This is the single biggest signal-to-noise lever for the local pass — keep it strong.

### Pre-flight

1. Confirm the Ollama CLI is installed: `command -v ollama`. If missing:
   - **Default mode**: print a warning (`ollama CLI not installed — recording as skipped`), set `STATUS=skipped`, and return to the caller **without falling back to another reviewer**. A missing reviewer must never be silently replaced. The caller's aggregate treats `skipped` as `inconclusive` (not eligible to merge). In the multi-reviewer-loop wrapper path this is normally pre-empted (the wrapper probes the binary in its own pre-flight).
   - **Interactive mode (`--interactive`)**: ask the user whether to install Ollama or skip. If skip, record `STATUS=skipped` per the default-mode rule.
2. Confirm the Ollama server is reachable: `ollama list` must succeed (it errors if the daemon isn't running). If it fails, in **default mode** set `STATUS=skipped` and print `ollama server not reachable — start it with \`ollama serve\` (recording as skipped)`; in **interactive mode** offer to start it.
3. **Resolve `{OLLAMA_MODEL}`** (see "Model resolution" below). If resolution yields no usable model, set `STATUS=skipped` and return.
4. Force review-only: set `REVIEWER_APPLIES=false` regardless of what the caller passed. If the caller passed `--reviewer-applies`, print: `--reviewer-applies has no effect on the ollama pass; Ollama is non-agentic, so the orchestrator always applies the fixes.`
5. Record `{REPO_DIR}` (`git rev-parse --show-toplevel`), `{BRANCH_NAME}` (`git branch --show-current`), `{BASE_BRANCH}`, `{BUILD_CMD}`, and `{TEST_CMD}`.
6. **Resolve the timeout wrapper.** macOS ships no `timeout(1)` unless coreutils is installed, so probing is required; empty = no wrapper (rely on Ollama's own limits). Settled logic — run it verbatim, do NOT narrate the probe or the fallback:
   ```bash
   TIMEOUT_CMD="$(command -v timeout >/dev/null 2>&1 && echo 'timeout 600' \
     || { command -v gtimeout >/dev/null 2>&1 && echo 'gtimeout 600' || echo ''; })"
   ```
7. **Select the structured-output format.** The review asks the model for JSON so the orchestrator parses a data structure instead of scraping a free-text format. Define the schema once and pick the strongest mode the installed Ollama supports — schema-constrained outputs require Ollama ≥ 0.5.0:
   ```bash
   FINDINGS_SCHEMA='{"type":"object","properties":{"findings":{"type":"array","items":{"type":"object","properties":{"file":{"type":"string"},"line":{"type":"integer"},"severity":{"type":"string","enum":["CRITICAL","IMPROVEMENT","NIT"]},"description":{"type":"string"},"fix":{"type":"string"}},"required":["file","line","severity","description","fix"]}}},"required":["findings"]}'
   # Parse "ollama version is X.Y.Z"; use the full schema when >= 0.5.0, else fall back to bare json.
   OLLAMA_VER=$(ollama --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
   VER_MAJOR=${OLLAMA_VER%%.*}; VER_REST=${OLLAMA_VER#*.}; VER_MINOR=${VER_REST%%.*}
   if [ "${VER_MAJOR:-0}" -gt 0 ] || [ "${VER_MINOR:-0}" -ge 5 ]; then
     OLLAMA_FORMAT="$FINDINGS_SCHEMA"   # schema-constrained: enforces field names, the severity enum, AND JSON validity
   else
     OLLAMA_FORMAT="json"               # legacy: valid JSON only; field shape comes from the prompt, parse leniently
   fi
   # Probe ALL optional flags from the help text and add only the supported ones — including
   # `--format`. Passing a flag an older `ollama run` doesn't recognize makes it exit non-zero,
   # which would error every per-file invocation and report cli-error, so detect support rather
   # than assume it. `--format` itself is absent on very old clients (< ~0.1.17); when it's missing
   # we drop it and rely on prompt-only JSON (the prompt already asks for a JSON object), parsing
   # leniently. The version check above only chooses the `--format` VALUE (schema vs bare `json`);
   # this probe decides whether the flag is passed at all. `--hidethinking` was added mid-0.x
   # (absent on ~0.5–0.8); `--nowordwrap` is older.
   # Use a shell ARRAY, not a string: zsh (a common host shell) does not word-split an unquoted
   # `$OLLAMA_FLAGS`, so a multi-flag string would be passed as one bogus flag. An array expands to
   # separate words in bash and zsh alike, and to zero words when empty (legacy ollama, no flags).
   OLLAMA_FLAGS=()
   OLLAMA_RUN_HELP=$(ollama run --help 2>&1)
   printf '%s' "$OLLAMA_RUN_HELP" | grep -q -- '--format'       && OLLAMA_FLAGS+=(--format "$OLLAMA_FORMAT")
   printf '%s' "$OLLAMA_RUN_HELP" | grep -q -- '--hidethinking' && OLLAMA_FLAGS+=(--hidethinking)
   printf '%s' "$OLLAMA_RUN_HELP" | grep -q -- '--nowordwrap'   && OLLAMA_FLAGS+=(--nowordwrap)
   ```

### Model resolution

The caller passes `{OLLAMA_MODEL}` derived from the `--review-with` token: the bracket form `ollama[<model>]` sets it to `<model>`; the bare form `ollama` leaves it empty, which triggers auto-selection.

**Explicit model (`{OLLAMA_MODEL}` is set)** — verify it is installed:
- Run `ollama list` and match `{OLLAMA_MODEL}` against the `NAME` column. Accept an exact match, or a match when the user omitted the `:latest` tag (so `ollama[llama3.1]` matches an installed `llama3.1:latest`).
- If installed: use it as-is.
- If **not** installed:
  - **Default mode**: do NOT auto-pull (a model pull is a multi-GB download). Set `STATUS=skipped` and print: `ollama: model '{OLLAMA_MODEL}' not installed — run \`ollama pull {OLLAMA_MODEL}\` (recording as skipped).` Return to the caller.
  - **Interactive mode (`--interactive`)**: ask whether to `ollama pull {OLLAMA_MODEL}` (then proceed) or skip (record `STATUS=skipped`).

**Auto-select (`{OLLAMA_MODEL}` is empty)** — pick the most capable installed coding model:
1. Parse `ollama list` into a list of `{name, size}` rows (the `NAME` and `SIZE` columns). If the list is empty, set `STATUS=skipped` and print: `ollama: no models installed — run \`ollama pull qwen2.5-coder\` (recording as skipped).` Return.
2. **Classify** each model as *coding-specialized* if its name (case-insensitive, ignoring the `:tag`) contains `coder`, `code`, or matches a known coding family: `qwen2.5-coder` / `qwen3-coder` / `codeqwen`, `deepseek-coder` / `deepseek-coder-v2`, `codestral`, `codellama` / `phind-codellama`, `codegemma`, `starcoder` / `starcoder2`, `granite-code`, `stable-code`, `wizardcoder`, `magicoder`, `opencoder`.
3. **Rank within a tier by parameter size**, parsed from the model tag (`:32b` → 32, `:14b`, `:8b`, `:7b`, `:3b`, `:1.5b`; treat `b`=billions, `m`=millions of params). If a model has no parsable param tag, fall back to its `SIZE` column (on-disk GB) as a size proxy. Larger = more capable.
4. **Prefer coding-specialized over general.** Choose the highest-ranked coding-specialized model. Break exact size ties by this family preference order: `qwen2.5-coder`/`qwen3-coder` > `deepseek-coder-v2`/`deepseek-coder` > `codestral` > `codellama` > `codegemma` > `starcoder2` > anything else.
5. **Fallback**: if NO coding-specialized model is installed, pick the largest general-purpose instruct model (families `qwen`, `llama`, `deepseek`, `mistral`/`mixtral`, `gemma`, `phi`) by the same size ranking. Print a note that no dedicated coding model was found.
6. Print the choice and the reason: `ollama: auto-selected {OLLAMA_MODEL} ({reason — e.g. "largest installed coding model"}).`

### Invocation (per-file chunked review)

Local models have bounded context windows, so review the diff **one changed file at a time** and aggregate the findings into a single log the orchestrator parses.

```bash
LOG_FILE="$(mktemp -t ollama-review.XXXXXX.log)"   # findings only (stdout)
ERR_FILE="$(mktemp -t ollama-review.XXXXXX.err)"   # ollama writes its TUI spinner + ANSI cursor codes to stderr; keep them OUT of the findings log
: > "$LOG_FILE"; : > "$ERR_FILE"
CHANGED=$(git diff --name-only "$BASE_BRANCH...HEAD")
TOTAL_FILES=$(printf '%s\n' "$CHANGED" | grep -c .)
REVIEW_ERRORS=0   # files whose review invocation failed entirely (zero coverage)
TRUNCATED=0       # files reviewed only partially (diff exceeded the per-file cap)
SKIPPED_EMPTY=0   # files in TOTAL_FILES with no reviewable hunks (pure rename/mode) — never sent to the model
REVIEWABLE=$((TOTAL_FILES - SKIPPED_EMPTY))   # recompute after the loop; this is the denominator for the verdict checks below
# Either REVIEW_ERRORS or TRUNCATED > 0 is a coverage gap that blocks a `clean` verdict (see step 4).
PER_FILE_CAP=24000   # max chars of diff sent per file; larger diffs are truncated with a note
```

For each file `F` in `$CHANGED`:
1. Extract the file's diff: `FILE_DIFF=$(git diff "$BASE_BRANCH...HEAD" -- "$F")`. Skip files with an empty diff (pure renames/mode changes with no hunks), incrementing `SKIPPED_EMPTY` for each — they are counted in `TOTAL_FILES` but were never sent to the model, so they must not inflate the reviewed-coverage denominator.
2. If `${#FILE_DIFF}` exceeds `$PER_FILE_CAP`, truncate to the cap and append a line `[diff truncated — file exceeds per-file review budget]` so the model knows it saw a partial diff. A truncated file was **not** fully reviewed (its tail never reached the model), so increment `TRUNCATED` and note the file in the final report. This is a coverage gap that blocks a `clean` verdict (step 4) — but, unlike an invocation error, the file *was* partially reviewed, so it does not count toward the "every file errored" → `cli-error` check.
3. Build the prompt and run the model via **stdin** (never as a positional arg — embedded diffs can exceed `ARG_MAX`). Wrap each file's JSON response with a delimiter line so the orchestrator can attribute and parse each section independently (back-to-back JSON objects are not themselves a single valid document):
   ```bash
   PROMPT="You are a senior code reviewer. A linter, type-checker, compiler, and test suite ALREADY run on this code separately — so syntax errors, lint violations, formatting, import order, unused vars, and build breakage are NOT your job and must NOT be reported. Review the unified diff for '$F' ONLY for logic issues a human finds by reasoning about behavior: correctness bugs, security / data-exposure holes, missing or wrong error handling, broken producer/consumer contracts, race conditions, and missing test coverage of real logic.

Do NOT report any of these — they are noise that wastes the review: pure style or formatting; renaming or extracting to a helper/constant; 'this could be cleaner / more readable'; eslint-disable or other tooling comments; naming preferences; or a deletion whose replacement you cannot see — you are shown ONE file's diff in isolation, so code that looks removed was very likely moved elsewhere. Never flag a removal as breaking unless THIS diff itself proves the breakage.

Raise a finding only when you can name the concrete wrong runtime behavior it causes, and say what that behavior is. When in doubt, omit it. Returning zero findings for a file is the correct, expected outcome for most files — do not invent issues to fill the list.

Return a JSON object with a single key \"findings\": an array of finding objects. Each finding has:
- file: the path under review ('$F')
- line: integer line number in the NEW version of the file
- severity: one of \"CRITICAL\", \"IMPROVEMENT\", \"NIT\"
- description: one-sentence statement of the WRONG BEHAVIOR (not a style opinion)
- fix: concrete code change

If the diff has no logic issues worth raising, return {\"findings\": []}.

--- DIFF ---
$FILE_DIFF"
   RESP=$(printf '%s' "$PROMPT" | $TIMEOUT_CMD ollama run "${OLLAMA_FLAGS[@]}" "$OLLAMA_MODEL" 2>> "$ERR_FILE")
   RC=$?
   printf '\n===== FILE: %s =====\n%s\n' "$F" "$RESP" >> "$LOG_FILE"
   ```
   Three things keep the captured findings a clean, parseable data structure rather than buried in terminal noise:
   - **`--format "$OLLAMA_FORMAT"` (probed into `$OLLAMA_FLAGS`).** When supported, grammar-constrains the output to JSON (and, in schema mode, to the exact field names and the `severity` enum). This is the single biggest reliability win: the orchestrator parses a structure instead of scraping a free-text format that local models adhere to unreliably. On a client too old to support `--format` the flag is dropped (see the pre-flight probe) and the loop falls back to prompt-only JSON, parsed leniently. The delimiter lines (`===== FILE: <path> =====`, the path embedded per file) let you split `$LOG_FILE` into one JSON object per reviewed file — split on the regex `^===== FILE: (.+) =====$`, capturing the path.
   - **`2>> "$ERR_FILE"` (not `2>&1`).** `ollama run` writes the actual model response to **stdout** but renders its progress spinner — braille frames (`⠙ ⠹ ⠼`) wrapped in ANSI cursor codes (`\e[?25l`, `\e[1G`, `\e[K`) — to **stderr**. Merging the two with `2>&1` is what fills the log with spinner garbage. Send stderr to a separate file so `$LOG_FILE` holds only model JSON; no ANSI stripping pass is then needed.
   - **`"${OLLAMA_FLAGS[@]}"` (`--format`, `--hidethinking`, `--nowordwrap`).** Probed for support in pre-flight and included only when present (as a shell array, so it expands to separate words under both bash and zsh, and to nothing when empty) — passing a flag an older `ollama run` doesn't recognize makes it exit non-zero and error the whole pass. `--hidethinking` suppresses reasoning models' (e.g. `qwen3`, `deepseek-r1`) chain-of-thought, which can otherwise precede the constrained JSON even under `--format`; it is a no-op on non-thinking *models* but is absent on older ollama *versions* (~0.5–0.8), hence the probe. `--nowordwrap` stops Ollama hard-wrapping long lines to the terminal width, which would otherwise inject newlines into a long `fix` string.
4. Treat a file as a failed (zero-coverage) review when **either** `RC != 0` **or** `$RESP` is empty/whitespace-only (`[ -z "$(printf '%s' "$RESP" | tr -d '[:space:]')" ]`). The empty-but-exit-0 case is real and silent: a reasoning model can spend its whole token budget on hidden thinking (`--hidethinking`) and emit no JSON, yet `ollama run` still exits 0 — observed with `qwen3.6:35b`. Without this guard the empty section parses as "no findings" and the file is miscounted as cleanly reviewed. On either condition, append a `[ollama error reviewing $F — RC=$RC, empty=$([ -z "$(printf '%s' "$RESP" | tr -d '[:space:]')" ] && echo yes || echo no); see $ERR_FILE]` marker to the log, **increment `REVIEW_ERRORS`**, and continue to the next file (one file's failure should not abort the whole review). Coverage accounting after the loop — first recompute `REVIEWABLE=$((TOTAL_FILES - SKIPPED_EMPTY))` (the files actually sent to the model; empty-diff skips never reached it), then define a coverage gap as any reviewable file that errored or was truncated (`REVIEW_ERRORS + TRUNCATED > 0`):
   - If *every reviewable* file errored (`REVIEWABLE > 0` and `REVIEW_ERRORS == REVIEWABLE`), set `STATUS=cli-error`, print the last 80 lines of `$ERR_FILE` (genuine ollama errors live there, not in `$LOG_FILE`; but in the exit-0 empty-response failure mode `$ERR_FILE` may hold only spinner noise, so also surface the per-file `[ollama error reviewing …]` markers from `$LOG_FILE`), and exit — nothing was reviewed. (Use `REVIEWABLE`, not `TOTAL_FILES`: an empty-diff skip would otherwise make `REVIEW_ERRORS == TOTAL_FILES` unreachable and misclassify a total failure as merely `incomplete`.)
   - If there is any coverage gap but not a total failure (`REVIEW_ERRORS + TRUNCATED > 0` and `REVIEW_ERRORS < REVIEWABLE`), the diff was only **partially** reviewed. Still process the findings from the parts that were reviewed (apply their fixes in step 3), but the pass **must not report `clean`** — at the point step 3 would set `STATUS=clean`, set `STATUS=incomplete` instead (see step 3). `incomplete` is treated as inconclusive by the multi-reviewer aggregate (not eligible to merge), because part of the change was never reviewed.

> `--format` makes the output grammar-constrained JSON, so parsing is reliable — but still parse **defensively**, since local models are weaker than agentic CLIs. Split `$LOG_FILE` on the delimiter regex `^===== FILE: (.+) =====$` (the captured group is the file path); for each resulting section, JSON-parse the block and read its `findings` array. An empty array means the file is clean. Treat a section that fails to parse (rare; possible on the legacy `json` fallback, or if a reasoning model leaked text despite `--hidethinking`) as no findings for that file — do not let a parse failure abort the pass. Before acting on a finding, validate it carries the required fields and a `line` that exists in the file (drop hallucinated lines, as step 3 already directs).

### Loop

Initialize `ITERATION=0`, `MAX_ITERATIONS=3`, `STATUS=""`.

1. **Capture baseline**: `LOOP_START_SHA=$(git rev-parse HEAD)`.
2. **Run the per-file chunked review** (above), aggregating findings into `$LOG_FILE`. Re-run the Invocation block *in full* on every iteration — re-derive `CHANGED`/`TOTAL_FILES` for the current HEAD and re-initialize `REVIEW_ERRORS=0`, `TRUNCATED=0`, `SKIPPED_EMPTY=0`, and fresh `$LOG_FILE`/`$ERR_FILE` (both truncated — `$ERR_FILE` is append-written with `2>>`, so a stale spinner/error tail from an earlier iteration would otherwise dominate the "last 80 lines of `$ERR_FILE`" printed on a later-iteration `cli-error`) — so a coverage gap from an earlier iteration cannot pin `STATUS=incomplete` after a clean re-review of the new commits.
3. **Parse findings and apply fixes** (orchestrator-applies — the same flow as the local-agent loop's review-only path):
   - Split `$LOG_FILE` on the delimiter regex `^===== FILE: (.+) =====$` and JSON-parse each section, collecting every entry across the `findings` arrays (see the defensive-parsing note above). If there are no findings (every section's array was empty or unparseable), set `STATUS=clean` — **but if there was any coverage gap (`REVIEW_ERRORS + TRUNCATED > 0`), set `STATUS=incomplete` instead** (the diff was only partially reviewed, so "no findings" is not a clean verdict) — and exit the loop.
   - For each finding, read the cited `file` at the cited `line` and apply the fix. The model's `fix` field is a *starting point* — local models hallucinate more than cloud agents, so your judgment overrides: drop any finding that is wrong, out of scope, or references a line that doesn't exist.
   - After each cohesive set of fixes, run `{BUILD_CMD}` (skip when empty) and `{TEST_CMD}`. If either fails, fix forward; if the failure stems from a bad finding, drop that finding.
   - Commit each fix (or coherent group) as `address review (ollama): <summary>`. The parenthesized agent name records which reviewer surfaced the finding. No co-author or "Generated with" lines.
   - Recompute the change counts after applying:
     ```bash
     NEW_COMMITS=$(git rev-list "$LOOP_START_SHA..HEAD" --count)
     UNCOMMITTED=$(git status --porcelain | wc -l)
     ```
   - **Commit leftover edits first.** If `UNCOMMITTED > 0`, the orchestrator applied fixes it has not committed yet — stage the explicitly listed files and commit as `address review (ollama): orchestrator-applied — remaining changes`, then **recompute `NEW_COMMITS`**. This MUST run before the zero-commit check below: otherwise a dirty working tree (`NEW_COMMITS == 0` but `UNCOMMITTED > 0`) would exit `clean` without verification or push, leaking unverified edits.
   - If `NEW_COMMITS == 0` **and** `UNCOMMITTED == 0` (you rejected every finding as wrong/out-of-scope, leaving a clean tree), set `STATUS=clean` (or `STATUS=incomplete` if there was any coverage gap, `REVIEW_ERRORS + TRUNCATED > 0`) and exit.
4. **Verify in the main thread** (mandatory, non-skippable — this is the only line of defense between the model's output and the remote branch):
   - Read the diff `git diff "$LOOP_START_SHA..HEAD"` and inspect each new commit for out-of-scope refactors, reverted behavior to pass tests, disabled tests/assertions, `// TODO` placeholders, or secrets.
   - **Run the fix regression guard** on the same `$LOOP_START_SHA..HEAD` fix diff: scan the fix for unscoped state-clearing/restoring writes and for side effects added to a hot path, and add a focused regression test when the fix touches scoping or timestamp/side-effect logic — re-scope any failing fix in place before building. See `~/.claude/lib/fix-regression-guard.md`. (Local models over-broaden fixes more than cloud agents, so this guard earns its keep most here.)
   - Run `{BUILD_CMD}` (skip when empty). On failure: **default mode** revert with `git reset --hard $LOOP_START_SHA`, set `STATUS=broken-build`, exit; **interactive mode** ask retry/revert/accept-and-fix.
   - Run `{TEST_CMD}` (skip when empty). Same handling on failure (`STATUS=test-failed`).
   - If any inspection red flag triggered: revert with `git reset --hard $LOOP_START_SHA`, set `STATUS=rejected`, exit.
5. **Push verified changes**:
   ```bash
   git push origin {BRANCH_NAME}
   ```
   If the push fails (non-fast-forward), run `git pull --rebase --autostash && git push origin {BRANCH_NAME}` once before reporting failure.
6. **Re-loop or stop**:
   - `ITERATION=$((ITERATION + 1))`
   - **Apply the convergence gate** (`~/.claude/lib/review-convergence-gate.md`) before another round: if the round just completed made zero commits or landed only *marginal* findings (edge-case guards, hypotheticals with no concrete wrong outcome), **converge — set `STATUS=clean` (or `STATUS=incomplete` if the round had any coverage gap, `REVIEW_ERRORS + TRUNCATED > 0`) and exit**, noting the diminishing-returns convergence in the report. The coverage-gap exception is the same invariant step 3 enforces: a partially-reviewed diff is never `clean`, even when the gate converges. Only a round with at least one *substantive* finding earns another pass.
   - If the gate says continue AND `ITERATION < MAX_ITERATIONS`: go back to step 1 to re-review the latest commits (catches recursive findings introduced by a fix).
   - Otherwise (gate converged, or `ITERATION >= MAX_ITERATIONS`): exit the loop. `MAX_ITERATIONS` is the mechanical backstop; the gate should normally stop first. Set `STATUS=guardrail` only when the mechanical cap stopped a still-productive loop; a gate-driven convergence sets `STATUS=clean` (or `STATUS=incomplete` when a coverage gap remains, per the exception above).

### Final report

Print:

```
## Ollama Review Summary

Model: {OLLAMA_MODEL}
Branch: {BRANCH_NAME}
Status: {STATUS}    # clean / incomplete / guardrail / cli-error / broken-build / test-failed / rejected / skipped
Coverage: {REVIEWABLE - REVIEW_ERRORS - TRUNCATED}/{REVIEWABLE} reviewable files fully reviewed ({REVIEW_ERRORS} errored, {TRUNCATED} truncated, {SKIPPED_EMPTY} skipped as empty-diff)    # any coverage gap → status `incomplete` (not eligible to merge)
Iterations: {ITERATION}
Commits added: {N}
Files modified: {file list}
Truncated files: {any files whose diff exceeded the per-file budget, or "none"}
Log: {LOG_FILE path}    # findings (stdout); spinner/error output is in {ERR_FILE path}
```

If `STATUS=clean` after the first iteration, the PR is ready for the merge gate (release flow) or hand-off back to the user (PR flow). For any other status (including `skipped`), the calling command must decide whether to proceed, re-run, or stop — never auto-merge on a non-clean ollama status, and never silently substitute another reviewer for one the user requested.
