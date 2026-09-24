## Ollama Code Review Loop (for `--review-with ollama[<model>]`)

Run a **local Ollama model** to review the PR branch, then read its findings back into the orchestrating thread, which applies the fixes and verifies before pushing. Selected via `--review-with ollama` (auto-select the most capable installed coding model) or `--review-with ollama[<model>]` (pin an installed model, e.g. `ollama[qwen2.5-coder:32b]`).

Unlike the `codex` / `agy` / `claude` / `grok` / `cursor` reviewers, **Ollama is not an agentic CLI** — `ollama run` takes a single prompt and returns text; it cannot read the working tree, run git, or edit files. So this loop differs from the local-agent loop in two ways:

1. **The diff is embedded in the prompt**, chunked per file to stay within local-model context limits.
2. **It is always review-only.** The model emits findings; the *orchestrator* applies the fixes (the local-agent loop's `REVIEWER_APPLIES=false` flow). `--reviewer-applies` is a no-op here — the calling command should already have warned and continued, and this loop forces review-only regardless.

When to use this:
- You want a fully local, offline review with no API/cloud cost and no data leaving the machine
- You have a capable coding model installed in Ollama (e.g. `qwen2.5-coder`, `deepseek-coder-v2`, `codestral`)

**Logic-only focus.** A small local model reviewing one file's diff in isolation floods the review with style nits, "extract a helper", and confident "you deleted X, this breaks Y" claims about code that was merely moved to a file it cannot see — while syntax, lint, formatting, type, and build errors are already caught by the project's own tooling. The per-file prompt below therefore tells the model, in strong terms, to report ONLY logic bugs tied to a concrete wrong runtime behavior and to treat zero findings as the normal outcome. This is the biggest signal-to-noise lever for the local pass — keep it strong.

### Pre-flight

1. Confirm the Ollama CLI is installed: `command -v ollama`. If missing:
   - **Default mode**: print a warning (`ollama CLI not installed — recording as skipped`), set `STATUS=skipped`, and return to the caller **without falling back to another reviewer** — a missing reviewer must never be silently replaced. The caller's aggregate treats `skipped` as `inconclusive` (not eligible to merge). The multi-reviewer-loop wrapper normally pre-empts this by probing the binary in its own pre-flight.
   - **Interactive mode (`--interactive`)**: ask the user whether to install Ollama or skip. If skip, record `STATUS=skipped`.
2. Confirm the Ollama server is reachable: `ollama list` must succeed. If it fails, in **default mode** set `STATUS=skipped` and print `ollama server not reachable — start it with \`ollama serve\` (recording as skipped)`; in **interactive mode** offer to start it.
3. **Resolve `{OLLAMA_MODEL}`** (see "Model resolution" below). If resolution yields no usable model, set `STATUS=skipped` and return.
4. Force review-only: set `REVIEWER_APPLIES=false` regardless of what the caller passed. If the caller passed `--reviewer-applies`, print: `--reviewer-applies has no effect on the ollama pass; Ollama is non-agentic, so the orchestrator always applies the fixes.`
5. Record `{REPO_DIR}` (`git rev-parse --show-toplevel`), `{BRANCH_NAME}` (`git branch --show-current`), `{BASE_BRANCH}`, `{BUILD_CMD}`, and `{TEST_CMD}`. Also record `{MAX_ITERATIONS}` — how many review → fix → re-review cycles this reviewer may run, resolved by the caller (multi-reviewer loop: per-entry `~max=<n>` suffix on the `--review-with` token → this loop's built-in default of `3`). `0` means **unlimited**, bounded by the 10-iteration safety guardrail in the Loop's step 6. Local models are the most common reason to want a small cap — `ollama~max=1` buys one review-and-fix pass without re-review rounds on slow hardware. Record `{MAX_EXPLICIT}` alongside it — `true` only when the cap came from a `~max=<n>` the user typed or saved — which step 6 uses to distinguish `capped` (a user-chosen budget, clean-equivalent for the merge gate) from `guardrail` (a built-in ceiling, inconclusive). The `--review-iterations` flag never reaches this loop; `~max` is the only way to move this cap. Also record `{OLLAMA_EFFORT}` — optional reasoning effort (`low`, `medium`, `high`, `xhigh`, `max`), resolved by the caller (multi-reviewer loop: explicit `~effort=<level>` suffix → empty). Defaults to empty.
6. **Resolve the per-file timeout wrapper.** Run it verbatim, without narrating the probe. Expand it, `OLLAMA_FLAGS`, and every other possibly-empty array only in the guarded form. An empty array (stock macOS) is a supported configuration, never a reviewer failure. See `~/.claude/lib/empty-array-expansion.md`:
   ```bash
   TIMEOUT_CMD=()
   if command -v timeout >/dev/null 2>&1; then TIMEOUT_CMD=(timeout 600)
   elif command -v gtimeout >/dev/null 2>&1; then TIMEOUT_CMD=(gtimeout 600); fi
   ```
7. **Select the structured-output format.** The review asks the model for JSON so the orchestrator parses a data structure instead of scraping free text. Define the schema once and pick the strongest mode the installed Ollama supports — schema-constrained outputs require Ollama ≥ 0.5.0:
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
   # Probe every optional flag from the help text and pass only the supported ones: a flag an
   # older `ollama run` doesn't recognize makes every per-file call exit non-zero (cli-error).
   #   --format        grammar-constrains the output to JSON (schema mode: field names + severity
   #                   enum). Absent on very old clients (< ~0.1.17); then rely on prompt-only JSON
   #                   and parse leniently. The version check above picks only its VALUE.
   #   --hidethinking  suppresses a reasoning model's chain-of-thought, which can precede the JSON
   #                   even under --format; a no-op on other models, absent on ~0.5–0.8.
   #   --nowordwrap    stops hard-wrapping to terminal width, which injects newlines into a long `fix`.
   # An ARRAY, not a string: zsh does not word-split an unquoted expansion.
   OLLAMA_FLAGS=()
   OLLAMA_RUN_HELP=$(ollama run --help 2>&1)
   printf '%s' "$OLLAMA_RUN_HELP" | grep -q -- '--format'       && OLLAMA_FLAGS+=(--format "$OLLAMA_FORMAT")
   printf '%s' "$OLLAMA_RUN_HELP" | grep -q -- '--hidethinking' && OLLAMA_FLAGS+=(--hidethinking)
   printf '%s' "$OLLAMA_RUN_HELP" | grep -q -- '--nowordwrap'   && OLLAMA_FLAGS+=(--nowordwrap)
   ```

### Model resolution

The caller passes `{OLLAMA_MODEL}` from the `--review-with` token: `ollama[<model>]` sets it to `<model>`; bare `ollama` leaves it empty, which triggers auto-selection.

**Explicit model (`{OLLAMA_MODEL}` is set)** — verify it is installed:
- Run `ollama list` and match `{OLLAMA_MODEL}` against the `NAME` column. Accept an exact match, or a match when the user omitted the `:latest` tag (`ollama[llama3.1]` matches an installed `llama3.1:latest`).
- If installed: use it as-is.
- If **not** installed:
  - **Default mode**: do NOT auto-pull (a multi-GB download). Set `STATUS=skipped` and print: `ollama: model '{OLLAMA_MODEL}' not installed — run \`ollama pull {OLLAMA_MODEL}\` (recording as skipped).` Return to the caller.
  - **Interactive mode (`--interactive`)**: ask whether to `ollama pull {OLLAMA_MODEL}` (then proceed) or skip (record `STATUS=skipped`).

**Auto-select (`{OLLAMA_MODEL}` is empty)** — pick the most capable installed coding model:
1. Parse `ollama list` into `{name, size}` rows (the `NAME` and `SIZE` columns). If the list is empty, set `STATUS=skipped` and print: `ollama: no models installed — run \`ollama pull qwen2.5-coder\` (recording as skipped).` Return.
2. **Classify** each model as *coding-specialized* if its name (case-insensitive, ignoring the `:tag`) contains `coder`, `code`, or matches a known coding family: `qwen2.5-coder` / `qwen3-coder` / `codeqwen`, `deepseek-coder` / `deepseek-coder-v2`, `codestral`, `codellama` / `phind-codellama`, `codegemma`, `starcoder` / `starcoder2`, `granite-code`, `stable-code`, `wizardcoder`, `magicoder`, `opencoder`.
3. **Rank within a tier by parameter size**, parsed from the model tag (`:32b` → 32, `:14b`, `:8b`, `:7b`, `:3b`, `:1.5b`; `b`=billions, `m`=millions of params). If a model has no parsable param tag, fall back to its `SIZE` column (on-disk GB) as a size proxy. Larger = more capable.
4. **Prefer coding-specialized over general.** Choose the highest-ranked coding-specialized model. Break exact size ties by this family preference order: `qwen2.5-coder`/`qwen3-coder` > `deepseek-coder-v2`/`deepseek-coder` > `codestral` > `codellama` > `codegemma` > `starcoder2` > anything else.
5. **Fallback**: if NO coding-specialized model is installed, pick the largest general-purpose instruct model (families `qwen`, `llama`, `deepseek`, `mistral`/`mixtral`, `gemma`, `phi`) by the same size ranking. Print a note that no dedicated coding model was found.
6. Print the choice and the reason: `ollama: auto-selected {OLLAMA_MODEL} ({reason — e.g. "largest installed coding model"}).`

### Invocation (per-file chunked review)

Local models have bounded context windows, so review the diff **one changed file at a time** and aggregate the findings into a single log the orchestrator parses.

```bash
LOG_FILE="$(mktemp -t ollama-review.XXXXXX.log)"   # findings only (stdout)
ERR_FILE="$(mktemp -t ollama-review.XXXXXX.err)"   # ollama writes its TUI spinner + ANSI cursor codes to stderr; keep them OUT of the findings log
: > "$LOG_FILE"; : > "$ERR_FILE"
CHANGED_FILE="$(mktemp -t ollama-changed.XXXXXX)"
FILE_MAP="$(mktemp -t ollama-file-map.XXXXXX)"   # NUL-delimited file-id/path pairs for newline-safe log attribution
git diff --name-only -z "$BASE_BRANCH...HEAD" > "$CHANGED_FILE" || { echo "could not list changed paths"; exit 1; }
: > "$FILE_MAP"
TOTAL_FILES=0   # incremented by the NUL-delimited loop below; paths may contain spaces or newlines
REVIEWABLE_FILES=0   # stable numeric IDs for files with non-empty diffs
REVIEW_ERRORS=0   # files whose review invocation failed entirely (zero coverage)
PARSE_ERRORS=0    # model responses that were non-empty but not a valid findings object
TRUNCATED=0       # files reviewed only partially (diff exceeded the per-file cap)
SKIPPED_EMPTY=0   # files in TOTAL_FILES with no reviewable hunks (pure rename/mode) — never sent to the model
# A file is counted in at most ONE of REVIEW_ERRORS / PARSE_ERRORS — an invocation failure leaves nothing to parse.
# All four counters feed "Parsing and coverage" below.
PER_FILE_CAP=24000   # max chars of diff sent per file; larger diffs are truncated with a note
```

Iterate the paths without shell word splitting. Use Bash's NUL-delimited `read` loop
and increment `TOTAL_FILES` once for each path:

```bash
while IFS= read -r -d '' F; do
  TOTAL_FILES=$((TOTAL_FILES + 1))
  # Run the per-file steps below for this exact path in `$F`.
done < "$CHANGED_FILE"
rm -f "$CHANGED_FILE"
```

For each file `F` read by that loop:
1. Extract the file's diff: `FILE_DIFF=$(git diff "$BASE_BRANCH...HEAD" -- "$F")`. Skip files with an empty diff (pure renames/mode changes with no hunks), incrementing `SKIPPED_EMPTY` for each — they count in `TOTAL_FILES` but were never sent to the model, so they must not inflate the coverage denominator. For a reviewable file, increment `REVIEWABLE_FILES`, set `FILE_ID=$REVIEWABLE_FILES`, and append `printf '%s\0%s\0' "$FILE_ID" "$F"` to `FILE_MAP`; the map preserves the exact path without newline splitting.
2. If `${#FILE_DIFF}` exceeds `$PER_FILE_CAP`, truncate to the cap and append a line `[diff truncated — file exceeds per-file review budget]` so the model knows it saw a partial diff. Increment `TRUNCATED` and note the file in the final report. This is a coverage gap. Unlike an invocation error, though, the file *was* partially reviewed, so it does not count toward total failure.
3. Build the prompt and run the model via **stdin** (never as a positional arg — embedded diffs can exceed `ARG_MAX`). Encode the path in the prompt as one JSON string with `FILE_JSON="$(jq -Rn --arg path "$F" '$path')"`; tell the model to use that exact path in each finding. Wrap each file's JSON response with its numeric ID so the orchestrator can attribute and parse each section independently (back-to-back JSON objects are not a single valid document):
   ```bash
   PROMPT="You are a senior code reviewer. A linter, type-checker, compiler, and test suite ALREADY run on this code separately — so syntax errors, lint violations, formatting, import order, unused vars, and build breakage are NOT your job and must NOT be reported. Review the unified diff for file path $FILE_JSON ONLY for logic issues a human finds by reasoning about behavior: correctness bugs, security / data-exposure holes, missing or wrong error handling, broken producer/consumer contracts, race conditions, and missing test coverage of real logic.

Do NOT report any of these — they are noise that wastes the review: pure style or formatting; renaming or extracting to a helper/constant; 'this could be cleaner / more readable'; eslint-disable or other tooling comments; naming preferences; or a deletion whose replacement you cannot see — you are shown ONE file's diff in isolation, so code that looks removed was very likely moved elsewhere. Never flag a removal as breaking unless THIS diff itself proves the breakage.

Raise a finding only when you can name the concrete wrong runtime behavior it causes, and say what that behavior is. When in doubt, omit it. Returning zero findings for a file is the correct, expected outcome for most files — do not invent issues to fill the list.

Return a JSON object with a single key \"findings\": an array of finding objects. Each finding has:
- file: the exact decoded path under review ($FILE_JSON)
- line: integer line number in the NEW version of the file
- severity: one of \"CRITICAL\", \"IMPROVEMENT\", \"NIT\"
- description: one-sentence statement of the WRONG BEHAVIOR (not a style opinion)
- fix: concrete code change

If the diff has no logic issues worth raising, return {\"findings\": []}.

--- DIFF ---
$FILE_DIFF"
   [ -n "$OLLAMA_EFFORT" ] && PROMPT="$PROMPT Target reasoning effort level: $OLLAMA_EFFORT."
   RESP=$(printf '%s' "$PROMPT" | ${TIMEOUT_CMD[@]+"${TIMEOUT_CMD[@]}"} ollama run ${OLLAMA_FLAGS[@]+"${OLLAMA_FLAGS[@]}"} "$OLLAMA_MODEL" 2>> "$ERR_FILE")
   RC=$?
   printf '\n===== FILE_ID: %s =====\n%s\n' "$FILE_ID" "$RESP" >> "$LOG_FILE"
   ```
4. Treat a file as a failed (zero-coverage) review when **either** `RC != 0` **or** `$RESP` is empty or whitespace-only (`[ -z "$(printf '%s' "$RESP" | tr -d '[:space:]')" ]`). The empty-but-exit-0 case really happens: a reasoning model can spend its whole token budget on hidden thinking (`--hidethinking`) and emit no JSON while `ollama run` still exits 0 (observed with `qwen3.6:35b`). Without this guard the empty section parses as "no findings" and the file is miscounted as cleanly reviewed. On either condition, append a `[ollama error reviewing file ID $FILE_ID — RC=$RC, empty=$([ -z "$(printf '%s' "$RESP" | tr -d '[:space:]')" ] && echo yes || echo no); see $ERR_FILE]` marker to the log, **increment `REVIEW_ERRORS`**, and continue to the next file.

### Parsing and coverage

Run this once per pass, after the per-file loop. First recompute `REVIEWABLE=$((TOTAL_FILES - SKIPPED_EMPTY))`, the number of files actually sent to the model. Using `TOTAL_FILES` would let empty-diff skips inflate the denominator and make total failure unreachable.

`--format` constrains the output to JSON, but still parse **defensively**, because local models are weaker than agentic CLIs. Split `$LOG_FILE` on `^===== FILE_ID: ([1-9][0-9]*) =====$`, then resolve each ID through the NUL-delimited `FILE_MAP` using `while IFS= read -r -d '' MAP_ID && IFS= read -r -d '' MAP_PATH`; never parse a path from a line or regex. JSON-parse each response and require `findings` to be an array. An empty array means that ID's file is clean. A section that fails to parse, is not an object, or has no array `findings` value is a **parse error**, not a clean file: record its mapped path in the report, increment `PARSE_ERRORS`, and do not invent findings from it. **Count each ID at most once.** Skip IDs already counted in `REVIEW_ERRORS`, which have an `[ollama error reviewing file ID …]` marker and no response to parse. Before acting on a finding, require its `file` to equal the mapped path, check the required fields, and verify `line` exists in that path. Drop findings with hallucinated paths or lines. Render paths in reports with shell escaping or JSON encoding so newlines stay visible.

Then classify the pass:
- **Total failure**: `REVIEWABLE > 0` and `REVIEW_ERRORS + PARSE_ERRORS >= REVIEWABLE`. No file yielded a usable verdict, so set `STATUS=cli-error` and exit. Print the last 80 lines of `$ERR_FILE`, and also the per-file `[ollama error reviewing …]` markers from `$LOG_FILE`, because in the exit-0 empty-response mode `$ERR_FILE` may hold only spinner noise. The check uses `>=`, not `==`, so it still fires if the counters overlap. The `REVIEWABLE > 0` guard keeps a rename-only diff, which has nothing to review, from reporting a hard error.
- **Coverage gap**: otherwise, set `COVERAGE_GAP=true` when `REVIEW_ERRORS + PARSE_ERRORS + TRUNCATED > 0`, and `COVERAGE_GAP=false` when it is 0. A gap means the diff was only partially reviewed. Still process the findings from the parts that were reviewed.

**Status override.** This is the loop's only coverage rule. Whenever this loop or the shared tail would set `STATUS=clean` or `STATUS=capped` while `COVERAGE_GAP=true`, set `STATUS=incomplete`, never `clean`. `incomplete` is inconclusive for the multi-reviewer aggregate and not eligible to merge, because part of the change was never reviewed. A `~max` budget never turns an unreviewed or unparseable diff into a merge-eligible pass.

### Loop

Initialize `ITERATION=0`, `STATUS=""`, and `MAX_ITERATIONS` / `MAX_EXPLICIT` from Pre-flight step 5 (`MAX_ITERATIONS=3`, `MAX_EXPLICIT=false` when the caller passed nothing). When `MAX_ITERATIONS=0` (unlimited), the effective ceiling is the 10-iteration safety guardrail.

Every pass ends in the shared fix tail, which holds the apply rules and steps 4–6 (verify, push, re-loop) plus the report closing. Read it now:
!read lib/review-fix-tail.md

1. **Capture baseline**: `LOOP_START_SHA=$(git rev-parse HEAD)`.
2. **Run the per-file chunked review** (above), collecting findings into `$LOG_FILE`. Re-run the Invocation block *in full* on every iteration. Re-derive the NUL-delimited `CHANGED_FILE` and `TOTAL_FILES` for the current HEAD, reset `REVIEWABLE_FILES=0`, `REVIEW_ERRORS=0`, `PARSE_ERRORS=0`, `TRUNCATED=0`, and `SKIPPED_EMPTY=0`, truncate `$LOG_FILE`/`$ERR_FILE` and `FILE_MAP`, and rebuild its numeric-ID/path pairs. `$ERR_FILE` is append-written with `2>>`, so a stale tail would otherwise dominate the "last 80 lines" printed on a later `cli-error`. The reset also stops a coverage gap from an earlier iteration from pinning `STATUS=incomplete` after a clean re-review of the new commits.
3. **Parse, classify, and apply.** Run "Parsing and coverage" above; a total failure exits with `cli-error`. If there are no findings, set `STATUS=clean` (the status override applies) and exit the loop. Otherwise apply the findings per the shared tail's **Apply** section, with `{FIX_LABEL}` set to `ollama`. Local models hallucinate more than cloud agents, so be quick to drop a finding that is wrong, out of scope, or cites a line that doesn't exist.
4. **Verify in the main thread**: the shared tail's step 4. Local models over-broaden fixes more than cloud agents, so its fix regression guard matters most here.
5. **Push verified changes**: the shared tail's step 5.
6. **Re-loop or stop**: the shared tail's step 6. The status override applies to every `clean` or `capped` exit, even when the convergence gate converges. A re-loop returns to step 1 above.

### Final report

Print:

```
## Ollama Review Summary

Model: {OLLAMA_MODEL}
Branch: {BRANCH_NAME}
Status: {STATUS}    # clean / capped / incomplete / guardrail / cli-error / broken-build / test-failed / rejected / skipped
Coverage: {max(0, REVIEWABLE - REVIEW_ERRORS - PARSE_ERRORS - TRUNCATED)}/{REVIEWABLE} reviewable files fully reviewed ({REVIEW_ERRORS} invocation errors, {PARSE_ERRORS} parse errors, {TRUNCATED} truncated, {SKIPPED_EMPTY} skipped as empty-diff)    # any coverage gap → status `incomplete` (not eligible to merge); clamp the numerator at 0 — one file can be counted twice (e.g. a truncated diff whose response also fails to parse)
Iterations: {ITERATION}/{MAX_ITERATIONS}    # denominator renders as ∞ when MAX_ITERATIONS=0; `capped` means this budget was spent, `guardrail` means a built-in ceiling cut the loop off
Commits added: {N}
Files modified: {file list}
Truncated files: {any files whose diff exceeded the per-file budget, or "none"}
Log: {LOG_FILE path}    # findings (stdout); spinner/error output is in {ERR_FILE path}
```

Then follow the shared tail's **After the final report**.
