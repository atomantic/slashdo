## Ollama Code Review Loop (for `--review-with ollama[ model]`)

Run a **local Ollama model** to review the PR branch, then read its findings back into the orchestrating thread, which applies the fixes and verifies before pushing. Selected via `--review-with ollama` (auto-select the most capable installed coding model) or `--review-with ollama[<model>]` (pin a specific installed model, e.g. `ollama[qwen2.5-coder:32b]`).

Unlike the `codex` / `agy` / `claude` reviewers, **Ollama is not an agentic CLI** — `ollama run` takes a single prompt and returns text. It cannot read the working tree, run git, or edit files. So this loop differs from the local-agent loop in two ways:

1. **The diff is embedded in the prompt.** The orchestrator feeds the model the actual `git diff` (chunked per file to stay within local-model context limits) instead of pointing a tool-using agent at the repo.
2. **It is always review-only.** The model emits findings; the *orchestrator* applies the fixes (the same flow as the local-agent loop's `REVIEWER_APPLIES=false` path). `--reviewer-applies` is a no-op here — there is no reviewer-side edit path to enable. If the calling command saw `--reviewer-applies` alongside an `ollama` reviewer, it should have already printed a warning and continued; this loop forces review-only regardless.

When to use this:
- You want a fully local, offline review with no API/cloud cost and no data leaving the machine
- You have a capable coding model installed in Ollama (e.g. `qwen2.5-coder`, `deepseek-coder-v2`, `codestral`)

### Pre-flight

1. Confirm the Ollama CLI is installed: `command -v ollama`. If missing:
   - **Default mode**: print a warning (`ollama CLI not installed — recording as skipped`), set `STATUS=skipped`, and return to the caller **without falling back to another reviewer**. A missing reviewer must never be silently replaced. The caller's aggregate treats `skipped` as `inconclusive` (not eligible to merge). In the multi-reviewer-loop wrapper path this is normally pre-empted (the wrapper probes the binary in its own pre-flight).
   - **Interactive mode (`--interactive`)**: ask the user whether to install Ollama or skip. If skip, record `STATUS=skipped` per the default-mode rule.
2. Confirm the Ollama server is reachable: `ollama list` must succeed (it errors if the daemon isn't running). If it fails, in **default mode** set `STATUS=skipped` and print `ollama server not reachable — start it with \`ollama serve\` (recording as skipped)`; in **interactive mode** offer to start it.
3. **Resolve `{OLLAMA_MODEL}`** (see "Model resolution" below). If resolution yields no usable model, set `STATUS=skipped` and return.
4. Force review-only: set `REVIEWER_APPLIES=false` regardless of what the caller passed. If the caller passed `--reviewer-applies`, print: `--reviewer-applies has no effect on the ollama pass; Ollama is non-agentic, so the orchestrator always applies the fixes.`
5. Record `{REPO_DIR}` (`git rev-parse --show-toplevel`), `{BRANCH_NAME}` (`git branch --show-current`), `{BASE_BRANCH}`, `{BUILD_CMD}`, and `{TEST_CMD}`.
6. Pick a timeout wrapper (per-invocation; on stock macOS without coreutils, plain `timeout(1)` is absent):
   ```bash
   if command -v timeout >/dev/null 2>&1; then
     TIMEOUT_CMD="timeout 600"
   elif command -v gtimeout >/dev/null 2>&1; then
     TIMEOUT_CMD="gtimeout 600"
   else
     TIMEOUT_CMD=""   # rely on Ollama's own internal limits
   fi
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
LOG_FILE="$(mktemp -t ollama-review.XXXXXX.log)"
: > "$LOG_FILE"
CHANGED=$(git diff --name-only "$BASE_BRANCH...HEAD")
PER_FILE_CAP=24000   # max chars of diff sent per file; larger diffs are truncated with a note
```

For each file `F` in `$CHANGED`:
1. Extract the file's diff: `FILE_DIFF=$(git diff "$BASE_BRANCH...HEAD" -- "$F")`. Skip files with an empty diff (pure renames/mode changes with no hunks).
2. If `${#FILE_DIFF}` exceeds `$PER_FILE_CAP`, truncate to the cap and append a line `[diff truncated — file exceeds per-file review budget]` so the model knows it saw a partial diff; note the truncation in the final report.
3. Build the prompt and run the model via **stdin** (never as a positional arg — embedded diffs can exceed `ARG_MAX`):
   ```bash
   PROMPT="You are a senior code reviewer. Review the following unified diff for the file '$F' against software-engineering best practices: correctness bugs, security issues, missing/incorrect error handling, broken contracts, and missing test coverage. Do not comment on pure style or formatting.

For each issue, output a block in EXACTLY this format (and nothing else between blocks):

FINDING <N>:
file: $F
line: <line number in the new version of the file>
severity: CRITICAL|IMPROVEMENT|NIT
description: <one-sentence problem statement>
fix: <concrete code change — quote the exact replacement when possible>

If the diff has no issues worth raising, output exactly the line 'NO FINDINGS' and nothing else.

--- DIFF ---
$FILE_DIFF"
   printf '%s' "$PROMPT" | $TIMEOUT_CMD ollama run "$OLLAMA_MODEL" >> "$LOG_FILE" 2>&1
   printf '\n' >> "$LOG_FILE"
   ```
4. If the invocation exits non-zero for a file, append a `[ollama error reviewing $F — see above]` marker to the log and continue to the next file (one file's failure should not abort the whole review). If *every* file errored, set `STATUS=cli-error`, print the last 80 lines of the log, and exit.

> Local models are less reliable at format adherence than agentic CLIs. Parse the log **leniently**: extract well-formed `FINDING` blocks, ignore malformed or partial blocks, and treat a file whose section is just `NO FINDINGS` (or contains no parsable findings) as clean for that file.

### Loop

Initialize `ITERATION=0`, `MAX_ITERATIONS=3`, `STATUS=""`.

1. **Capture baseline**: `LOOP_START_SHA=$(git rev-parse HEAD)`.
2. **Run the per-file chunked review** (above), aggregating findings into `$LOG_FILE`.
3. **Parse findings and apply fixes** (orchestrator-applies — the same flow as the local-agent loop's review-only path):
   - Extract the `FINDING <N>:` blocks from `$LOG_FILE`. If there are no parsable findings (every file section was `NO FINDINGS` or empty), set `STATUS=clean` and exit the loop.
   - For each finding, read the cited file at the cited line and apply the fix. The model's `fix:` field is a *starting point* — local models hallucinate more than cloud agents, so your judgment overrides: drop any finding that is wrong, out of scope, or references a line that doesn't exist.
   - After each cohesive set of fixes, run `{BUILD_CMD}` (skip when empty) and `{TEST_CMD}`. If either fails, fix forward; if the failure stems from a bad finding, drop that finding.
   - Commit each fix (or coherent group) as `address review (ollama): <summary>`. The parenthesized agent name records which reviewer surfaced the finding. No co-author or "Generated with" lines.
   - Recompute the change counts after applying:
     ```bash
     NEW_COMMITS=$(git rev-list "$LOOP_START_SHA..HEAD" --count)
     UNCOMMITTED=$(git status --porcelain | wc -l)
     ```
   - If `NEW_COMMITS == 0` (you rejected every finding as wrong/out-of-scope), set `STATUS=clean` and exit.
   - If `UNCOMMITTED > 0`, stage the explicitly listed files and commit as `address review (ollama): orchestrator-applied — remaining changes`, then proceed.
4. **Verify in the main thread** (mandatory, non-skippable — this is the only line of defense between the model's output and the remote branch):
   - Read the diff `git diff "$LOOP_START_SHA..HEAD"` and inspect each new commit for out-of-scope refactors, reverted behavior to pass tests, disabled tests/assertions, `// TODO` placeholders, or secrets.
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
   - If `ITERATION < MAX_ITERATIONS`: go back to step 1 to re-review the latest commits (catches recursive findings introduced by a fix).
   - Otherwise: `STATUS=guardrail`, exit the loop.

### Final report

Print:

```
## Ollama Review Summary

Model: {OLLAMA_MODEL}
Branch: {BRANCH_NAME}
Status: {STATUS}    # clean / guardrail / cli-error / broken-build / test-failed / rejected / skipped
Iterations: {ITERATION}
Commits added: {N}
Files modified: {file list}
Truncated files: {any files whose diff exceeded the per-file budget, or "none"}
Log: {LOG_FILE path}
```

If `STATUS=clean` after the first iteration, the PR is ready for the merge gate (release flow) or hand-off back to the user (PR flow). For any other status (including `skipped`), the calling command must decide whether to proceed, re-run, or stop — never auto-merge on a non-clean ollama status, and never silently substitute another reviewer for one the user requested.
