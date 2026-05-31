## Local Agent Code Review Loop

Run a local agent to review the PR branch, then either let that agent apply fixes itself (`--reviewer-applies`) or read its findings back into the orchestrating thread which applies the fixes (default). Either way, verify in the main thread before pushing. This is an alternative to the Copilot cloud review loop — selected via `--review-with codex|agy|claude` (the `agy` slug also accepts the aliases `gemini` and `antigravity`).

The reviewer is a headless CLI subprocess (`codex` / `agy`, and `claude` on non-Claude-Code hosts).<!-- if:teams --> The one exception is the `claude` reviewer under Claude Code: it runs as an **in-process sub-agent** (via the `Agent` tool), not a `claude -p` subprocess. A headless `claude -p` invocation bills against the Anthropic API even when the host session is already on a plan; an in-process sub-agent runs under the host session's plan instead, so it incurs no extra API billing. See the invocation table and Step 2.<!-- /if:teams -->

When to use this instead of Copilot:
- The repo isn't connected to GitHub Copilot review (or you don't want to pay for it)
- You want a different reviewer's perspective (Codex, Antigravity, or a separate Claude reviewer — an in-process sub-agent under Claude Code, or a headless `claude -p` session on other hosts)
- You want the review to happen entirely locally, before pushing

### Pre-flight

1. Confirm `{REVIEW_AGENT}` is one of `claude`, `codex`, `agy` — the aliases `gemini` and `antigravity` normalize to `agy` (the Antigravity CLI's binary, successor to the Gemini CLI). Otherwise abort with a usage error. After this check, treat `{REVIEW_AGENT}` as the normalized value (`gemini`/`antigravity` → `agy`).
2. Resolve `{REVIEW_BIN}` (the executable) and, for the slash-command-based agents, `{REVIEW_CMD}` (the installed slash command — these differ because each CLI namespaces slashdo's commands differently):
   - `claude` → bin `claude`, slash command `do:review`
   - `codex` → bin `codex` (uses the built-in `codex review` subcommand — no slashdo slash command)
   - `agy` → bin `agy`, slash command `do-review` (Antigravity installs slashdo as an Agent Skill at `~/.gemini/antigravity-cli/skills/do-review/`, triggered as `/do-review` — *not* `/do:review`, since the Agent Skills standard uses the skill-directory name, not colon namespacing)
3. Confirm the CLI binary is installed: `command -v {REVIEW_BIN}`. If missing:
   - **Default mode**: print a warning (`{REVIEW_AGENT} CLI not installed — recording as skipped`), set `STATUS=skipped` (preconditions not met — binary missing), and return to the caller **without falling back to Copilot**. A missing reviewer must never be silently replaced by `copilot` — the executed reviewer set must only ever contain reviewers the user explicitly requested. The caller's aggregate treats a `skipped` pass as `inconclusive` (not eligible to merge). In the multi-reviewer-loop wrapper path this case is normally pre-empted: the wrapper probes binaries in its own pre-flight and records the skip before dispatching here (see `multi-reviewer-loop.md` Pre-flight, "Probe binary availability"). This branch is the safety net for callers that dispatch this loop directly, e.g. `/do:rpr`.
   - **Interactive mode (`--interactive`)**: ask the user whether to install or skip. If install succeeds, proceed normally; if skip, record `STATUS=skipped` per the default-mode rule. Do not offer a Copilot fallback — substituting a reviewer the user didn't request is exactly what the no-default-reviewer policy forbids.
4. Record `{REPO_DIR}` (`git rev-parse --show-toplevel`), `{BRANCH_NAME}` (`git branch --show-current`), `{BASE_BRANCH}`, `{BUILD_CMD}`, and `{TEST_CMD}`.
5. Record `{REVIEWER_APPLIES}` — boolean, defaults to `false`. Set to `true` when the orchestrating command was invoked with `--reviewer-applies`. This flag selects which side of the loop holds the editor: when `false` (default), the orchestrator applies fixes from the CLI's findings log; when `true`, the headless CLI applies fixes directly in the working tree and the orchestrator only verifies.

### Editing mode

The loop has two editing modes, selected by `{REVIEWER_APPLIES}`:

| Mode | `REVIEWER_APPLIES` | Who applies fixes | Who commits |
|------|--------------------|-------------------|-------------|
| Review-only (default) | `false` | Orchestrator reads the CLI's findings log and applies fixes in this session | Orchestrator |
| Reviewer-applies | `true` | The headless CLI applies fixes in the working tree as it reviews | The CLI (orchestrator commits any leftover uncommitted changes as a safety net) |

Review-only is the default because it keeps the edit author and the verifier in the same session — the agent that ratifies the diff is the one that wrote it, which simplifies attribution and shrinks the risk surface of granting a second autonomous CLI write access to the working tree. Use `--reviewer-applies` when you specifically want the reviewing agent's *judgment* applied to the fix — e.g., asking `agy` to both find and patch its own concerns so the final code reflects Antigravity's style, not the orchestrator's interpretation of its findings.

### Headless invocation per agent

The orchestrating agent runs the chosen CLI directly via Bash and captures output to a log file so it can be summarized without flooding context.<!-- if:teams --> The sole exception is the `claude` reviewer under Claude Code: shelling out to `claude -p` would bill against the API even though the host session already runs on a plan, so the orchestrator instead dispatches an in-process **sub-agent** (via the `Agent` tool) to perform the review — see the invocation table and Step 2.<!-- /if:teams --> Either way, the **verification** step (Step 4) is always performed by the main thread and is never delegated to a sub-agent.

For `claude` and `agy`, this loop assumes slashdo is installed in the target CLI's environment (see `src/environments.js`), so the slashdo review command is available — invoked as `/{REVIEW_CMD}` (`/do:review` under claude, `/do-review` under agy; resolved in pre-flight). For `codex`, we use codex's **built-in `codex review` subcommand** in review-only mode (codex ships a first-class review experience, more authentic than re-prompting through `codex exec`) and switch to `codex exec` only when `REVIEWER_APPLIES=true` (since `codex review` doesn't apply fixes — see notes below).

The CLI invocations run in **reckless / non-interactive mode** — they run unattended and must not stop to ask for permission. The flags below disable each CLI's interactive approval gates.<!-- if:teams --> (The Claude-Code sub-agent path needs no such flag: a spawned `Agent` inherits the host session's tool-approval settings and runs unattended within it.)<!-- /if:teams -->

Before invoking any local agent, compute the shared inputs once. For the slash-command-based invocations (`claude` / `agy`), the slash-command argument MUST be only the base-branch ref — `do:review` treats `$ARGUMENTS` as the base branch and runs `git diff $ARGUMENTS...HEAD`, so any prose appended to the argument (e.g., `main — commit each ...`) becomes a non-existent ref and the diff fails. Convey overrides as separate prompt text *after* the slash command, on a new line:

```bash
REVIEW_TITLE=$(git log -1 --format=%s HEAD)   # subject of HEAD commit; falls back below if empty
[ -z "$REVIEW_TITLE" ] && REVIEW_TITLE="Review of $BRANCH_NAME against $BASE_BRANCH"

# Prompt suffix selects editing mode for claude / agy.
# In both cases the branch is the slash-command arg; the override is a
# separate sentence on a new line, so do:review parses only "$BASE_BRANCH".
if [ "$REVIEWER_APPLIES" = "true" ]; then
  REVIEW_OVERRIDE="When committing fixes, use commit messages of the form 'address review ($REVIEW_AGENT): <summary>' instead of the default — the parenthesized agent name records which reviewer surfaced the finding."
else
  REVIEW_OVERRIDE="REVIEW-ONLY MODE — do NOT modify files, do NOT commit, do NOT post a PR comment. Skip the 'Fix Issues', 'Convention Encoding', and 'PR Comment Policy' phases of do:review entirely. After verifying findings, print them to stdout as a numbered list using this exact format (one block per finding):

FINDING <N>:
file: <repo-relative path>
line: <line number on HEAD>
severity: CRITICAL|IMPROVEMENT|NIT
description: <one-sentence problem statement>
fix: <concrete code change — quote the exact replacement when possible>

If no findings are warranted, print exactly the line 'NO FINDINGS' and exit cleanly. The orchestrator will parse this output and apply any fixes itself."
fi
# $REVIEW_CMD was resolved in pre-flight: 'do:review' under claude, 'do-review' under agy.
LOCAL_PROMPT=$(printf '/%s %s\n\n%s' "$REVIEW_CMD" "$BASE_BRANCH" "$REVIEW_OVERRIDE")

# Codex-only prompt for REVIEWER_APPLIES=true (codex exec invocation —
# codex doesn't have slashdo installed, so describe the task directly).
CODEX_APPLY_PROMPT="Review the diff from $BASE_BRANCH to HEAD in this repo against software-engineering best practices (correctness, security, test coverage, contract drift). For each finding, apply the fix in the working tree, then run \`$BUILD_CMD\` (skip if empty) and \`$TEST_CMD\` to verify, and commit each fix with message 'address review (codex): <summary>'. Do not introduce changes beyond the scope of fixing the findings. Do not skip tests or weaken assertions."
```

Pick a timeout wrapper at this point too. The step-2 invocation below runs `$TIMEOUT_CMD {INVOCATION}`; on stock macOS without `coreutils`, plain `timeout(1)` is absent and `timeout 1800 …` exits 127 before the reviewer ever runs:

```bash
if command -v timeout >/dev/null 2>&1; then
  TIMEOUT_CMD="timeout 1800"
elif command -v gtimeout >/dev/null 2>&1; then
  TIMEOUT_CMD="gtimeout 1800"
else
  TIMEOUT_CMD=""   # rely on the CLI's own internal limits
fi
```

Pick the invocation based on `{REVIEW_AGENT}` and `{REVIEWER_APPLIES}`:

| Agent | Review-only (`REVIEWER_APPLIES=false`, default) | Reviewer-applies (`REVIEWER_APPLIES=true`) |
|-------|-------------------------------------------------|---------------------------------------------|
<!-- if:teams -->
| `claude` | Dispatch an in-process sub-agent via the `Agent` tool with `$LOCAL_PROMPT` (see Step 2) — **not** `claude -p`, so it stays on plan billing | Same sub-agent dispatch; the sub-agent applies and commits fixes directly in the shared working tree |
<!-- else -->
| `claude` | `claude -p "$LOCAL_PROMPT" --dangerously-skip-permissions` | `claude -p "$LOCAL_PROMPT" --dangerously-skip-permissions` |
<!-- /if:teams -->
| `codex` | `codex --sandbox danger-full-access review --base "$BASE_BRANCH" --title "$REVIEW_TITLE"` | `codex --sandbox danger-full-access -a never exec "$CODEX_APPLY_PROMPT"` |
| `agy` | `agy --dangerously-skip-permissions -p "$LOCAL_PROMPT"` | `agy --dangerously-skip-permissions -p "$LOCAL_PROMPT"` |

For `claude` and `agy`, the same `$LOCAL_PROMPT` drives both modes — it already encodes the mode via the suffix override that branches on `$REVIEWER_APPLIES` above. The CLI's behavior changes because do:review's body sees a different override. For `codex`, the invocation itself swaps because `codex review` (review-only) and `codex exec` (apply-fixes) are different subcommands with incompatible flag sets.

Notes on each invocation:
- **claude / agy** call slashdo's installed review command (`/do:review` under claude, `/do-review` under agy — `$REVIEW_CMD` resolved in pre-flight).<!-- if:teams --> Under Claude Code the `claude` reviewer is a sub-agent that invokes the `do:review` skill in-process (the prompt content is identical to `$LOCAL_PROMPT`), rather than a `claude -p` subprocess.<!-- /if:teams --> In `REVIEWER_APPLIES=true` mode, the suffix overrides two of do:review's defaults: switch the commit message to `address review (<agent>): <summary>` where `<agent>` is the reviewing CLI's slug — `claude` or `agy` here (instead of `do:review`'s current default `address review (self): <summary>`) and skip the auto-push (the orchestrating agent will verify and push). The parenthesized agent name records which reviewer surfaced the finding, which is useful when scanning the log of a release that ran multiple reviewers. In `REVIEWER_APPLIES=false` mode, the suffix instead instructs do:review to skip its Fix/Convention/PR-Comment phases and emit findings to stdout in a structured format the orchestrator can parse — the orchestrator then commits the fixes using the same `address review (<agent>): <summary>` form to preserve attribution.
- **codex (review-only)** uses the built-in `codex review` subcommand with the **base-branch review target**, which reviews the full diff from `$BASE_BRANCH` to `HEAD`. The three review targets — `--uncommitted`, `--commit <SHA>`, and `--base <BRANCH>` — are mutually exclusive (per `codex review --help` and confirmed by `error: the argument '--commit <SHA>' cannot be used with: --base <BRANCH>`). The positional `[PROMPT]` is *also* mutually exclusive with `--base` (`error: the argument '--base <BRANCH>' cannot be used with: [PROMPT]`), so per-invocation overrides cannot be passed this way — the orchestrating agent applies the fixes itself per step 3. The top-level `--sandbox danger-full-access` flag (before the `review` subcommand) is required so codex can read the working tree and run git: under codex's default sandbox those operations are blocked and `codex review` produces no usable findings. Like `-a`, `--sandbox` is a top-level option and MUST precede `review`.
- **codex (reviewer-applies)** uses `codex --sandbox danger-full-access -a never exec "$CODEX_APPLY_PROMPT"` because `codex review` is read-only on the current shipped version (produces findings without modifying the working tree). `codex exec` accepts a free-form prompt that asks codex to review *and* apply fixes, with the top-level `-a never` flag selecting the never-ask approval mode so it runs unattended. Both top-level flags MUST precede the `exec` subcommand — `codex exec -a never ...` exits 2 with `error: unexpected argument '-a' found`, because `-a` (like `--sandbox`) is a top-level Codex option that the `exec` subcommand parser does not recognize. The top-level `--sandbox danger-full-access` flag is needed here so codex can write the fixes, run the build/tests, and reach the network unattended.

Flag rationale (reckless / unattended mode):
- `claude --dangerously-skip-permissions` — auto-approves all tool calls in the headless session.<!-- if:teams --> Used **only** when this loop runs outside Claude Code; under Claude Code the `claude` reviewer is an in-process sub-agent (no `claude -p`, no API billing) and this flag does not apply — see Step 2.<!-- /if:teams -->
- `codex review` — already non-interactive by design (per `codex review --help`: "Run a code review non-interactively"). Do NOT pass `-a` / `--approval`; the `codex review` subcommand does not accept it and will reject the flag. Also do NOT combine `--commit <SHA>` with `--base <BRANCH>` or with a positional `[PROMPT]` — codex enforces mutual exclusion across review targets and prompt mode, and the loop would exit with code 2 before any review work runs.
- `codex --sandbox danger-full-access -a never exec` — `-a never` is a top-level Codex flag (never ask for approval; auto-approves all proposed actions). It MUST precede the `exec` subcommand; the `exec` subcommand's own parser does not accept `-a` and `codex exec -a never ...` exits 2 (`error: unexpected argument '-a' found`). Used in the reviewer-applies path alongside the top-level `--sandbox danger-full-access` flag (see below); `codex review` rejects `-a` entirely.
- `codex --sandbox danger-full-access` — top-level sandbox-policy flag, used on BOTH codex invocations (it precedes the `review` / `exec` subcommand). Codex's default sandbox (`workspace-write`) blocks network and restricts command execution, so without this flag `codex review` can't reliably read the tree / run git and the apply path can't run build, tests, or network ops. PortOS-style hosts run on a trusted single-user machine, so full access is the intended posture (mirrors `claude --dangerously-skip-permissions` / `agy --dangerously-skip-permissions`). `--sandbox` and `-a` are independent top-level flags and may be combined (`codex --sandbox danger-full-access -a never exec …`).
- `agy --dangerously-skip-permissions` — auto-approves all tool permission requests so the Antigravity CLI runs unattended (the headless equivalent of confirming every prompt). This is the agy successor to the Gemini CLI's `gemini --yolo` + `env GEMINI_SANDBOX=false`: agy folds both "auto-approve tools" and "no sandbox gate" into the single `--dangerously-skip-permissions` flag, and runs the prompt non-interactively via `-p`. Unlike the old gemini invocation, no `env VAR=…` prefix is needed, so it composes cleanly with the `timeout 1800 {INVOCATION}` wrapper at step 2 of the loop.

Because these flags grant the headless CLI full unattended write access to the working tree — and the Claude-Code sub-agent likewise shares this working tree — the verify step in this loop (build + tests + diff inspection by the main thread) is mandatory and non-skippable — it is the only line of defense between the reviewing agent's output and the remote branch. This applies in *both* editing modes: in review-only mode the orchestrator's own fixes are still verified before push, because the orchestrator may misread the CLI's findings or introduce its own regressions.

### Loop

Initialize `ITERATION=0`, `MAX_ITERATIONS=3`, `STATUS=""`.

1. **Capture baseline**: `LOOP_START_SHA=$(git rev-parse HEAD)`

2. **Invoke the chosen reviewer** (capture output to a log so context stays clean):

<!-- if:teams -->
   **When `REVIEW_AGENT=claude`: dispatch an in-process sub-agent — do NOT run the Bash invocation below.** A headless `claude -p` session bills against the Anthropic API; an in-process sub-agent runs under this session's plan, so it incurs no extra API billing. Dispatch a general-purpose sub-agent via the `Agent` tool, then resume the loop:
   - **Sub-agent prompt**: pass `$LOCAL_PROMPT` (computed above) as the prompt. It already invokes `/do:review $BASE_BRANCH` with the mode-specific suffix override, so the sub-agent behaves identically to the `claude -p` path — in `REVIEWER_APPLIES=true` mode it applies and commits fixes directly in the shared working tree (as `address review (claude): <summary>`); in review-only mode it returns the structured `FINDING <N>:` blocks (or `NO FINDINGS`) as its final message.
   - **Capture the result into the log** so Step 3's parsing and the final report's `Log:` line work unchanged: `LOG_FILE="$(mktemp -t local-review-claude.XXXXXX.log)"`, write the sub-agent's returned message to `$LOG_FILE`, and set `EXIT_CODE=0` (use a non-zero `EXIT_CODE` only if the sub-agent reports it could not complete the review).
   - Skip the Bash invocation below and proceed to Step 3.

   **For `codex` and `gemini`** (and for `claude` only if this loop somehow runs outside Claude Code), use the Bash invocation:
<!-- /if:teams -->

   ```bash
   LOG_FILE="$(mktemp -t local-review-${REVIEW_AGENT}.XXXXXX.log)"
   $TIMEOUT_CMD {INVOCATION} > "$LOG_FILE" 2>&1
   EXIT_CODE=$?
   ```
   - `$TIMEOUT_CMD` was selected during pre-flight (`timeout 1800`, `gtimeout 1800`, or empty when neither is installed). Empty expands to nothing, so the line becomes a direct invocation that relies on the CLI's own internal limits — preferred to exiting 127 before the reviewer runs.
   - If `EXIT_CODE != 0` and the CLI produced no commits, set `STATUS=cli-error`, print the last 80 lines of the log, and exit the loop. Surface the log path so the user can inspect.

3. **Detect changes and apply fixes** (logic depends on `{REVIEWER_APPLIES}`):

   First, snapshot the pre-CLI git state. These values describe what the *CLI* did to the working tree (everything in `REVIEWER_APPLIES=true` is judged from them; in `REVIEWER_APPLIES=false` they should be zero because the CLI was told not to edit):
   ```bash
   NEW_COMMITS=$(git rev-list "$LOOP_START_SHA..HEAD" --count)
   UNCOMMITTED=$(git status --porcelain | wc -l)
   ```

   **When `REVIEWER_APPLIES=false` (default — orchestrator applies)**:
   - The CLI was instructed to report findings to stdout and not touch the working tree. Read `$LOG_FILE` and extract the findings (look for the structured `FINDING <N>:` blocks emitted by claude/agy review-only mode, or codex's native severity-tagged findings list for `codex review`).
   - If the log contains `NO FINDINGS` (or no actionable findings — e.g., only nits the user opted out of, or a codex log that ends with "no issues"): set `STATUS=clean` and exit the loop.
   - Otherwise, the orchestrator applies each fix in this session:
     - For each finding, read the cited file at the cited line, apply the proposed fix (using the structured `fix:` field as a starting point; if the proposal is wrong or imprecise, the orchestrator's judgment overrides — this is *your* commit, not the CLI's).
     - After each cohesive set of fixes, run `{BUILD_CMD}` (skip when empty) and `{TEST_CMD}`. If either fails, fix forward (don't push a broken state) — if the failure stems from a bad finding, drop that finding and continue.
     - Commit each fix (or coherent group of fixes) as `address review (<agent>): <summary>` where `<agent>` is `$REVIEW_AGENT` (the reviewing CLI's slug — `codex` / `agy` / `claude`). The parenthesized agent name records which reviewer surfaced the finding. Do not include co-author or "Generated with" lines.
   - After the apply pass, **recompute** the change counts — the orchestrator's commits since `$LOOP_START_SHA` are what step 4 must verify and step 5 must push. Reusing the pre-apply values here would falsely report `clean` while leaving the orchestrator's fixes unverified and unpushed:
     ```bash
     NEW_COMMITS=$(git rev-list "$LOOP_START_SHA..HEAD" --count)
     UNCOMMITTED=$(git status --porcelain | wc -l)
     ```
   - If recomputed `NEW_COMMITS == 0` (e.g., the orchestrator rejected every finding as wrong/out-of-scope), set `STATUS=clean` and exit.
   - If recomputed `UNCOMMITTED > 0`, you have a bug — the orchestrator should always commit what it stages. Print the uncommitted diff, stage and commit explicitly listed files as `address review ($REVIEW_AGENT): orchestrator-applied — remaining changes`, and proceed.

   **When `REVIEWER_APPLIES=true` (reviewer applies)**:
   - The CLI was expected to apply fixes directly in the working tree and commit them as `address review ($REVIEW_AGENT): <summary>`.
   - If `NEW_COMMITS == 0` and `UNCOMMITTED == 0`: the CLI ran and found nothing to fix. Set `STATUS=clean` and exit the loop.
   - If `UNCOMMITTED > 0` (CLI left changes uncommitted despite the instruction):
     - Print the uncommitted diff
     - **Default mode**: stage all changed files explicitly (not `git add -A` — list them) and commit with `chore: local review changes (uncommitted by {REVIEW_AGENT})`. Then continue to verification.
     - **Interactive mode**: ask the user whether to commit, discard, or abort.
   - Otherwise (`NEW_COMMITS > 0` and clean tree): the CLI committed its fixes; proceed to verification.

4. **Verify in the main thread** (this is the explicit hand-back per design — do NOT delegate this step to a sub-agent):
   - Read the diff: `git diff "$LOOP_START_SHA..HEAD"` and inspect each new commit's message + changes. Look for:
     - Changes that go beyond the stated review scope (out-of-bounds refactors, unrelated files touched)
     - Commits that revert legitimate behavior to make a flaky test pass
     - Disabled tests, skipped assertions, or `// TODO` placeholders introduced by the agent
     - Secrets, hardcoded credentials, or other content that must not land
   - Run `{BUILD_CMD}` (skip when empty — projects without a build step skip this check). If it fails:
     - **Default mode**: revert with `git reset --hard $LOOP_START_SHA`, set `STATUS=broken-build`, exit the loop, and report
     - **Interactive mode**: ask the user whether to retry (re-invoke CLI), revert, or accept-and-fix-manually
   - Run `{TEST_CMD}` (skip when empty). Same handling on failure (`STATUS=test-failed`).
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
Status: {STATUS}    # clean / guardrail / cli-error / broken-build / test-failed / rejected / skipped
Iterations: {ITERATION}
Commits added: {N}
Files modified: {file list}
Log: {LOG_FILE path}
```

If `STATUS=clean` after the first iteration, the PR is ready for the merge gate (release flow) or hand-off back to the user (PR flow). For any other status (including `skipped`), the calling command must decide whether to proceed, re-run the reviewer, or stop — never auto-merge on a non-clean local-agent status, and never silently substitute `copilot` for a reviewer the user requested.
