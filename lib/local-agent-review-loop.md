## Local Agent Code Review Loop

Run a local CLI agent in headless mode to review the PR branch and apply fixes, then verify in the main thread before pushing. This is an alternative to the Copilot cloud review loop — selected via `--review-with codex|gemini|claude`.

When to use this instead of Copilot:
- The repo isn't connected to GitHub Copilot review (or you don't want to pay for it)
- You want a different reviewer's perspective (Codex, Gemini, or a separate Claude session)
- You want the review to happen entirely locally, before pushing

### Pre-flight

1. Confirm `{REVIEW_AGENT}` is one of `claude`, `codex`, `gemini`. Otherwise abort with a usage error.
2. Confirm the CLI binary is installed: `command -v {REVIEW_AGENT}`. If missing:
   - **Default mode**: print a warning and fall back to the Copilot loop. If Copilot is also unavailable (no `gh` auth or no Copilot reviewer configured), stop and report.
   - **Interactive mode (`--interactive`)**: ask the user whether to install, fall back, or abort.
3. Record `{REPO_DIR}` (`git rev-parse --show-toplevel`), `{BRANCH_NAME}` (`git branch --show-current`), `{BASE_BRANCH}`, `{BUILD_CMD}`, and `{TEST_CMD}`.

### Headless invocation per agent

The orchestrating agent runs the chosen CLI directly via Bash (no sub-agent delegation — the main thread does the verification, per design). Output is captured to a log file so it can be summarized without flooding context.

For `claude` and `gemini`, this loop assumes slashdo is installed in the target CLI's environment (see `src/environments.js`), so the slashdo `do:review` command is available — `/do:review` for both (they use slash-command namespacing). For `codex`, we use codex's **built-in `codex review` subcommand** instead of the slashdo skill — codex ships a first-class review experience, and using it gives a more authentic codex-flavored review than re-prompting through `codex exec`.

All three CLIs are invoked in **reckless / non-interactive mode** — they run unattended and must not stop to ask for permission. The flags below disable each CLI's interactive approval gates:

Before building the codex invocation, compute these once:
```bash
HEAD_SHA=$(git rev-parse HEAD)
REVIEW_TITLE=$(git log -1 --format=%s "$HEAD_SHA")   # subject of HEAD commit; falls back to branch name if empty
[ -z "$REVIEW_TITLE" ] && REVIEW_TITLE="Review of $BRANCH_NAME against $BASE_BRANCH"
REVIEW_PROMPT="Review the diff from $BASE_BRANCH to HEAD, commit each fix batch as 'address review: <summary>', and DO NOT push — the orchestrating agent will verify and push."
```

| Agent | Command |
|-------|---------|
| `claude` | `claude -p "/do:review {BASE_BRANCH} — commit each fix batch as 'address review: <summary>' and DO NOT push" --dangerously-skip-permissions` |
| `codex` | `codex review --commit "$HEAD_SHA" --base "$BASE_BRANCH" --title "$REVIEW_TITLE" "$REVIEW_PROMPT"` |
| `gemini` | `GEMINI_SANDBOX=false gemini --yolo -p "/do:review {BASE_BRANCH} — commit each fix batch as 'address review: <summary>' and DO NOT push"` |

Notes on each invocation:
- **claude / gemini** call slashdo's installed `do:review`, with a suffix appended to the command argument overriding two of `do:review`'s defaults: switch the commit message to `address review: <summary>` (instead of `refactor: address code review findings`) and skip the auto-push (the orchestrating agent will verify and push).
- **codex** uses the built-in `codex review` subcommand. The full, documented invocation is `codex review --commit <SHA> --base <BRANCH> --title <TITLE> [PROMPT]` — pass ALL four arguments. Do NOT use a positional base or omit `--title`; codex will print its help and exit if any required flag is missing, and the loop will burn an iteration on a no-op. The trailing `[PROMPT]` is where this loop injects the commit-style and don't-push override. Behavior of `codex review` may either (a) auto-apply fixes and commit them, or (b) produce a review report without applying fixes — behavior depends on the codex version installed. If codex exits with no new commits but its log contains findings, the orchestrating agent in step 3 below treats the log as the review and applies fixes itself before proceeding.

Flag rationale (reckless / unattended mode):
- `claude --dangerously-skip-permissions` — auto-approves all tool calls in the headless session
- `codex review` — already non-interactive by design (per `codex review --help`: "Run a code review non-interactively"). Do NOT pass `-a` / `--approval`; the `codex review` subcommand does not accept it and will reject the flag. The top-level `codex` and `codex exec` commands accept `-a never`, but this loop deliberately uses `codex review` instead, so no approval flag is needed.
- `gemini --yolo` — auto-approves all tool calls. `GEMINI_SANDBOX=false` disables the sandboxed-shell layer so commands run directly in the working directory (needed because the agent edits files and runs the project build/test commands)

Because these flags grant the headless CLI full unattended write access to the working tree, the verify step in this loop (build + tests + diff inspection by the main thread) is mandatory and non-skippable — it is the only line of defense between the headless agent's output and the remote branch.

### Loop

Initialize `ITERATION=0`, `MAX_ITERATIONS=3`, `STATUS=""`.

1. **Capture baseline**: `LOOP_START_SHA=$(git rev-parse HEAD)`

2. **Invoke the chosen CLI** (foreground, but redirect output to a log so context stays clean):
   ```bash
   LOG_FILE="$(mktemp -t local-review-${REVIEW_AGENT}.XXXXXX.log)"
   timeout 1800 {INVOCATION} > "$LOG_FILE" 2>&1
   EXIT_CODE=$?
   ```
   - 30-minute cap via `timeout(1)`. If `timeout` is unavailable on macOS, install via `coreutils` (`gtimeout`) or skip the wrapper and rely on the CLI's own limits.
   - If `EXIT_CODE != 0` and the CLI produced no commits, set `STATUS=cli-error`, print the last 80 lines of the log, and exit the loop. Surface the log path so the user can inspect.

3. **Detect changes**:
   ```bash
   NEW_COMMITS=$(git rev-list "$LOOP_START_SHA..HEAD" --count)
   UNCOMMITTED=$(git status --porcelain | wc -l)
   ```
   - If `NEW_COMMITS == 0` and `UNCOMMITTED == 0`:
     - For `claude` and `gemini`: the CLI's `do:review` ran and found nothing to fix. Set `STATUS=clean` and exit the loop.
     - For `codex`: `codex review` may have produced a review without applying fixes. Inspect `$LOG_FILE` — if it contains review findings (look for severity markers like `CRITICAL` / `HIGH` / `MEDIUM` / `LOW`, or a numbered findings list), the orchestrating agent must apply the fixes itself: read the log, fix each finding in the working tree, run `{BUILD_CMD}` + `{TEST_CMD}`, and commit as `address review: <summary>`. Then proceed to step 4. If the log shows no actionable findings, set `STATUS=clean` and exit.
   - If `UNCOMMITTED > 0` (CLI left changes uncommitted despite the instruction):
     - Print the uncommitted diff
     - **Default mode**: stage all changed files explicitly (not `git add -A` — list them) and commit with `chore: local review changes (uncommitted by {REVIEW_AGENT})`. Then continue to verification.
     - **Interactive mode**: ask the user whether to commit, discard, or abort.

4. **Verify in the main thread** (this is the explicit hand-back per design — do NOT delegate this step to a sub-agent):
   - Read the diff: `git diff "$LOOP_START_SHA..HEAD"` and inspect each new commit's message + changes. Look for:
     - Changes that go beyond the stated review scope (out-of-bounds refactors, unrelated files touched)
     - Commits that revert legitimate behavior to make a flaky test pass
     - Disabled tests, skipped assertions, or `// TODO` placeholders introduced by the agent
     - Secrets, hardcoded credentials, or other content that must not land
   - Run `{BUILD_CMD}`. If it fails:
     - **Default mode**: revert with `git reset --hard $LOOP_START_SHA`, set `STATUS=broken-build`, exit the loop, and report
     - **Interactive mode**: ask the user whether to retry (re-invoke CLI), revert, or accept-and-fix-manually
   - Run `{TEST_CMD}`. Same handling on failure (`STATUS=test-failed`).
   - If any of the inspection red flags above triggered, treat as a verification failure: revert with `git reset --hard $LOOP_START_SHA`, set `STATUS=rejected`, and exit the loop.

5. **Push verified changes**:
   ```bash
   git push origin {BRANCH_NAME}
   ```
   If the push fails (e.g., non-fast-forward), run `git pull --rebase --autostash && git push origin {BRANCH_NAME}` once before reporting failure.

6. **Re-loop or stop**:
   - `ITERATION=$((ITERATION + 1))`
   - If `ITERATION < MAX_ITERATIONS`: go back to step 1 to confirm the latest commits don't themselves need further review (catches recursive findings — common when a fix introduces a new shape).
   - Otherwise: `STATUS=guardrail`, exit the loop.

### Final report

Print:

```
## Local Agent Review Summary

Agent: {REVIEW_AGENT}
Branch: {BRANCH_NAME}
Status: {STATUS}    # clean / guardrail / cli-error / broken-build / test-failed / rejected
Iterations: {ITERATION}
Commits added: {N}
Files modified: {file list}
Log: {LOG_FILE path}
```

If `STATUS=clean` after the first iteration, the PR is ready for the merge gate (release flow) or hand-off back to the user (PR flow). For any other status, the calling command must decide whether to proceed, fall back to Copilot, or stop — never auto-merge on a non-clean local-agent status.
