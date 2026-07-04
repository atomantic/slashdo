## Local Agent Code Review Loop

Run a local agent to review the PR branch, then either let that agent apply fixes itself (`--reviewer-applies`) or read its findings back into the orchestrating thread which applies the fixes (default). Either way, verify in the main thread before pushing. This is an alternative to the Copilot cloud review loop — selected via `--review-with codex|agy|claude` (the `agy` slug also accepts the aliases `gemini` and `antigravity`).

The reviewer is a headless CLI subprocess (`codex` / `agy`, and `claude` on non-Claude-Code hosts).<!-- if:teams --> The one exception is the `claude` reviewer under Claude Code: it runs as an **in-process sub-agent** (via the `Agent` tool), not a `claude -p` subprocess. A headless `claude -p` invocation bills against the Anthropic API even when the host session is already on a plan; an in-process sub-agent runs under the host session's plan instead, so it incurs no extra API billing. See the invocation table and Step 2.<!-- /if:teams -->

When to use this instead of Copilot:
- The repo isn't connected to GitHub Copilot review (or you don't want to pay for it)
- You want a different reviewer's perspective (Codex, Antigravity, or a separate Claude reviewer — an in-process sub-agent under Claude Code, or a headless `claude -p` session on other hosts)
- You want the review to happen entirely locally, before pushing

### Pre-flight

1. Confirm `{REVIEW_AGENT}` is one of `claude`, `codex`, `agy` — the aliases `gemini` and `antigravity` normalize to `agy` (the Antigravity CLI's binary, successor to the Gemini CLI). Otherwise abort with a usage error. After this check, treat `{REVIEW_AGENT}` as the normalized value (`gemini`/`antigravity` → `agy`).
2. Resolve `{REVIEW_BIN}` (the executable):
   - `claude` → bin `claude`
   - `codex` → bin `codex` (uses the built-in `codex review` subcommand)
   - `agy` → bin `agy`
   This loop drives `claude`/`agy` with a self-contained inline-review prompt (`$LOCAL_PROMPT`), so it does **not** depend on slashdo's `/do-review` review skill being installed — only on the binary. (The skill is deliberately avoided: its multi-sub-agent fan-out never resolves under a headless/print-mode invocation — see the `$LOCAL_PROMPT` rationale below.)
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

For `claude` and `agy`, this loop drives the CLI with a **self-contained review prompt** (`$LOCAL_PROMPT`, built below) rather than triggering slashdo's `/do-review` (`/do:review`) skill. The skill is a multi-sub-agent fan-out that a headless print-mode CLI cannot wait on (see the `$LOCAL_PROMPT` rationale below); the self-contained prompt asks the CLI to review inline as a single agent, which is what works under `agy -p` and the in-process Claude sub-agent. (slashdo still needs to be installed in the environment for the *other* `/do:*` commands, but this loop no longer depends on the review skill being present.) For `codex`, we use codex's **built-in `codex review` subcommand** in review-only mode (codex ships a first-class review experience, more authentic than re-prompting through `codex exec`) and switch to `codex exec` only when `REVIEWER_APPLIES=true` (since `codex review` doesn't apply fixes — see notes below).

The CLI invocations run in **reckless / non-interactive mode** — they run unattended and must not stop to ask for permission. The flags below disable each CLI's interactive approval gates.<!-- if:teams --> (The Claude-Code sub-agent path needs no such flag: a spawned `Agent` inherits the host session's tool-approval settings and runs unattended within it.)<!-- /if:teams -->

Before invoking any local agent, compute the shared inputs once. `$LOCAL_PROMPT` is a **self-contained, single-agent review prompt** — it does NOT trigger slashdo's `/do-review` (`/do:review`) *skill*. That skill fans out to 5–6 parallel sub-agents, and a headless print-mode CLI cannot wait for them: agy's `-p` mode (and an in-process Claude sub-agent) returns the orchestrator's interim "I dispatched the sub-agents" message and then times out without ever printing their aggregated findings — the sub-agents complete asynchronously and never re-sync into the print-mode response (confirmed in agy's internal log: `Print mode: timed out after 498 polls`, zero findings emitted). So the prompt instead asks the CLI to review **inline, in this one session, with no sub-agent dispatch**, which streams a verdict synchronously. The prompt itself carries the `git diff` instruction (no slash-command argument-parsing to get wrong) and the mode-specific output contract:

```bash
REVIEW_TITLE=$(git log -1 --format=%s HEAD)   # subject of HEAD commit; falls back below if empty
[ -z "$REVIEW_TITLE" ] && REVIEW_TITLE="Review of $BRANCH_NAME against $BASE_BRANCH"

# Shared review task. The "do NOT dispatch/spawn sub-agents" clause is load-bearing:
# it is what keeps the review a single synchronous agent the print-mode CLI can wait on.
REVIEW_TASK="Review the code changes on the current branch against the base branch '$BASE_BRANCH'. Do the review YOURSELF in this single session — do NOT dispatch, spawn, or delegate to sub-agents or background tasks (a fanned-out review never re-syncs into print/headless output and the run will time out with no findings). Run \`git diff $BASE_BRANCH...HEAD --stat\` then \`git diff $BASE_BRANCH...HEAD\`, read each changed file in full for context, and review for correctness bugs, security issues, broken producer/consumer contracts, resource leaks, and missing test coverage. The project's linter, type-checker, and test suite already run separately — do NOT spend effort on syntax, lint, formatting, import order, or build errors; they are covered. Report only logic issues found by reasoning about behavior, each tied to a concrete wrong outcome — not style preferences, renames, or 'extract a helper' suggestions."

if [ "$REVIEWER_APPLIES" = "true" ]; then
  LOCAL_PROMPT="$REVIEW_TASK

For each real finding, apply the fix in the working tree, then run \`$BUILD_CMD\` (skip if empty) and \`$TEST_CMD\` to verify, and commit each fix with a message of the form 'address review ($REVIEW_AGENT): <summary>' — the parenthesized agent name records which reviewer surfaced the finding. Do NOT push (the orchestrator verifies and pushes). Do not make changes beyond fixing the findings, and do not weaken tests or assertions."
else
  LOCAL_PROMPT="$REVIEW_TASK

REVIEW-ONLY MODE — do NOT modify files, do NOT commit, do NOT push. After reviewing, print findings to stdout as a numbered list using this exact format (one block per finding):

FINDING <N>:
file: <repo-relative path>
line: <line number on HEAD>
severity: CRITICAL|IMPROVEMENT|NIT
description: <one-sentence problem statement>
fix: <concrete code change — quote the exact replacement when possible>

If no findings are warranted, print exactly the line 'NO FINDINGS' and exit cleanly. The orchestrator will parse this output and apply any fixes itself."
fi

# Codex-only prompt for REVIEWER_APPLIES=true (codex exec invocation —
# codex doesn't have slashdo installed, so describe the task directly).
CODEX_APPLY_PROMPT="Review the diff from $BASE_BRANCH to HEAD in this repo for logic issues (correctness, security, test coverage, contract drift). The linter, type-checker, and test suite already run separately — do NOT spend effort on syntax, lint, formatting, or build errors, and do NOT raise style/rename/extract-a-helper suggestions; report only behavior bugs you can tie to a concrete wrong outcome. For each finding, apply the fix in the working tree, then run \`$BUILD_CMD\` (skip if empty) and \`$TEST_CMD\` to verify, and commit each fix with message 'address review (codex): <summary>'. Do not introduce changes beyond the scope of fixing the findings. Do not skip tests or weaken assertions."

# Resolve the timeout wrapper used by the step-2 invocation (`$TIMEOUT_CMD {INVOCATION}`).
# macOS ships no `timeout(1)` unless coreutils is installed, so probing is required:
# bare `timeout 1800 …` would exit 127 before the reviewer runs. Empty = no wrapper
# (rely on the CLI's own internal limits). This is settled logic — run it, don't narrate it.
TIMEOUT_CMD="$(command -v timeout >/dev/null 2>&1 && echo 'timeout 1800' \
  || { command -v gtimeout >/dev/null 2>&1 && echo 'gtimeout 1800' || echo ''; })"

# agy only: pin the review model. agy's DEFAULT can be a heavy "Thinking" model
# (e.g. a Claude/Gemini *Thinking* tier) that spends many minutes in hidden
# reasoning plus multi-round tool calls. How much progress is VISIBLE meanwhile
# is model-dependent: lighter models (e.g. "Gemini 3.5 Flash (High)") narrate
# their actions as they go, while heavy thinking tiers can emit nothing until the
# final answer — so a slow-model review can sit at ~0% CPU with an empty log for
# 20-30 min and look exactly like a hang (measured: a one-file review that
# finishes in ~40s on Flash sat at 0% CPU with zero output for 24 min on the
# heavy default). Pin a fast, capable model by default so reviews return
# promptly; override via the AGY_REVIEW_MODEL env var to trade speed for depth
# (the background launch + 30-minute print-timeout in Step 2 mean a heavier model
# is safe, just slower). Confirm the name against `agy models` if you change it —
# an unknown model name makes agy exit non-zero. Empty = agy's own default (not
# recommended). NOTE: avoid prompts that make agy shell out to `agy` itself
# (e.g. `agy models`) — a nested agy invocation inside a print session can stall.
AGY_REVIEW_MODEL="${AGY_REVIEW_MODEL:-Gemini 3.5 Flash (High)}"
```

Run the pre-flight block above verbatim. The `TIMEOUT_CMD` resolution is deterministic — do NOT think out loud about whether `timeout`/`gtimeout` is installed or about falling back; just execute it and move on.

Pick the invocation based on `{REVIEW_AGENT}` and `{REVIEWER_APPLIES}`:

| Agent | Review-only (`REVIEWER_APPLIES=false`, default) | Reviewer-applies (`REVIEWER_APPLIES=true`) |
|-------|-------------------------------------------------|---------------------------------------------|
<!-- if:teams -->
| `claude` | Dispatch an in-process sub-agent via the `Agent` tool with `subagent_type: "general-purpose"` and `$LOCAL_PROMPT` (see Step 2) — **not** `claude -p`, so it stays on plan billing | Same sub-agent dispatch; the sub-agent applies and commits fixes directly in the shared working tree |
<!-- else -->
| `claude` | `claude -p "$LOCAL_PROMPT" --dangerously-skip-permissions` | `claude -p "$LOCAL_PROMPT" --dangerously-skip-permissions` |
<!-- /if:teams -->
| `codex` | `codex --sandbox danger-full-access review --base "$BASE_BRANCH" --title "$REVIEW_TITLE"` | `codex --sandbox danger-full-access -a never exec "$CODEX_APPLY_PROMPT"` |
| `agy` | `agy --dangerously-skip-permissions --model "$AGY_REVIEW_MODEL" --print-timeout 30m -p "$LOCAL_PROMPT"` | `agy --dangerously-skip-permissions --model "$AGY_REVIEW_MODEL" --print-timeout 30m -p "$LOCAL_PROMPT"` |

For `claude` and `agy`, the same `$LOCAL_PROMPT` drives both modes — it already encodes the mode (review-only vs reviewer-applies) directly, branching on `$REVIEWER_APPLIES` above. For `codex`, the invocation itself swaps because `codex review` (review-only) and `codex exec` (apply-fixes) are different subcommands with incompatible flag sets. `--print-timeout 30m` raises agy's print-mode wait above its 5-minute default so a real review of a multi-file diff isn't cut off mid-stream; on stock macOS (no `timeout`/`gtimeout`, so `$TIMEOUT_CMD` is empty) it is also the only *shell-level* bound on the invocation. **But these bounds only take effect when the invocation runs in the background (Step 2).** Run as a blocking foreground Bash call, the run is killed first by the host tool's ~10-minute foreground cap — earlier than either `timeout 1800` or `--print-timeout 30m` — which is the timeout consumers were hitting. `--print-timeout 30m` does NOT cut off an actively-streaming agent — it bounds the wait for the *next* response chunk — which is why it's safe to set generously, and why it never masked the old skill hang (that hang was the orchestrator sitting idle waiting on background sub-agents, not a slow stream). `--model "$AGY_REVIEW_MODEL"` pins the reviewing model (resolved in pre-flight): agy's *default* may be a heavy "Thinking" tier that spends many minutes in hidden reasoning plus multi-round tool calls. How much output is visible meanwhile is **model-dependent** — lighter models narrate their actions incrementally, heavy thinking tiers can emit nothing until the final answer — so on a slow model a routine review shows little or no output for 20-30 minutes and is easily mistaken for a hang. A quiet log during Step 2's poll is therefore NOT evidence the reviewer is stuck; only a `$DONE_FILE` with a non-zero code, or a 30-minute overrun, is. Pinning a fast-but-capable model keeps reviews prompt; bump `AGY_REVIEW_MODEL` to a heavier tier when you want more depth and accept the longer wait (the background launch + 30-minute bound cover it).

> **Pass the prompt as a positional argument — never via stdin.** Both `claude -p` and `agy -p` (`--print`) take the prompt as the argument directly after the flag: `agy --dangerously-skip-permissions -p "$LOCAL_PROMPT"`. They do **not** read the prompt from stdin. Do NOT write `echo "$LOCAL_PROMPT" | agy --dangerously-skip-permissions -p`, `agy -p < prompt.txt`, or `printf … | agy -p` — agy ignores piped stdin and exits with `agy --print takes the prompt as an argument, not stdin`, forcing a wasted second invocation. The `> "$LOG_FILE" 2>&1` redirect in Step 2 captures the reviewer's *output*; it is unrelated to how the prompt goes in. Keep `"$LOCAL_PROMPT"` as the quoted argument to `-p` exactly as shown in the invocation table.

Notes on each invocation:
- **claude / agy** run the self-contained `$LOCAL_PROMPT` (a single-agent inline review), **not** slashdo's `/do-review` skill — the skill's sub-agent fan-out never re-syncs into a print-mode/headless response, so it would hang and emit zero findings (see the `$LOCAL_PROMPT` rationale above).<!-- if:teams --> Under Claude Code the `claude` reviewer is an in-process sub-agent (via the `Agent` tool) that runs `$LOCAL_PROMPT` directly, rather than a `claude -p` subprocess — and because the prompt is a single-agent inline review, it does not recursively spawn the skill's own sub-agents.<!-- /if:teams --> In `REVIEWER_APPLIES=true` mode, `$LOCAL_PROMPT` tells the CLI to apply each fix, verify with build+tests, commit as `address review (<agent>): <summary>` (`<agent>` = the reviewing CLI's slug, `claude` or `agy`), and NOT push (the orchestrating agent verifies and pushes). The parenthesized agent name records which reviewer surfaced the finding, useful when scanning the log of a release that ran multiple reviewers. In `REVIEWER_APPLIES=false` mode, `$LOCAL_PROMPT` tells the CLI to emit `FINDING <N>:` blocks (or `NO FINDINGS`) to stdout for the orchestrator to parse — the orchestrator then commits the fixes using the same `address review (<agent>): <summary>` form to preserve attribution.
- **codex (review-only)** uses the built-in `codex review` subcommand with the **base-branch review target**, which reviews the full diff from `$BASE_BRANCH` to `HEAD`. The three review targets — `--uncommitted`, `--commit <SHA>`, and `--base <BRANCH>` — are mutually exclusive (per `codex review --help` and confirmed by `error: the argument '--commit <SHA>' cannot be used with: --base <BRANCH>`). The positional `[PROMPT]` is *also* mutually exclusive with `--base` (`error: the argument '--base <BRANCH>' cannot be used with: [PROMPT]`), so per-invocation overrides cannot be passed this way — the orchestrating agent applies the fixes itself per step 3. The top-level `--sandbox danger-full-access` flag (before the `review` subcommand) is required so codex can read the working tree and run git: under codex's default sandbox those operations are blocked and `codex review` produces no usable findings. Like `-a`, `--sandbox` is a top-level option and MUST precede `review`.
- **codex (reviewer-applies)** uses `codex --sandbox danger-full-access -a never exec "$CODEX_APPLY_PROMPT"` because `codex review` is read-only on the current shipped version (produces findings without modifying the working tree). `codex exec` accepts a free-form prompt that asks codex to review *and* apply fixes, with the top-level `-a never` flag selecting the never-ask approval mode so it runs unattended. Both top-level flags MUST precede the `exec` subcommand — `codex exec -a never ...` exits 2 with `error: unexpected argument '-a' found`, because `-a` (like `--sandbox`) is a top-level Codex option that the `exec` subcommand parser does not recognize. The top-level `--sandbox danger-full-access` flag is needed here so codex can write the fixes, run the build/tests, and reach the network unattended.

Flag rationale (reckless / unattended mode):
- `claude --dangerously-skip-permissions` — auto-approves all tool calls in the headless session.<!-- if:teams --> Used **only** when this loop runs outside Claude Code; under Claude Code the `claude` reviewer is an in-process sub-agent (no `claude -p`, no API billing) and this flag does not apply — see Step 2.<!-- /if:teams -->
- `codex review` — already non-interactive by design (per `codex review --help`: "Run a code review non-interactively"). Do NOT pass `-a` / `--approval`; the `codex review` subcommand does not accept it and will reject the flag. Also do NOT combine `--commit <SHA>` with `--base <BRANCH>` or with a positional `[PROMPT]` — codex enforces mutual exclusion across review targets and prompt mode, and the loop would exit with code 2 before any review work runs.
- `codex --sandbox danger-full-access -a never exec` — `-a never` is a top-level Codex flag (never ask for approval; auto-approves all proposed actions). It MUST precede the `exec` subcommand; the `exec` subcommand's own parser does not accept `-a` and `codex exec -a never ...` exits 2 (`error: unexpected argument '-a' found`). Used in the reviewer-applies path alongside the top-level `--sandbox danger-full-access` flag (see below); `codex review` rejects `-a` entirely.
- `codex --sandbox danger-full-access` — top-level sandbox-policy flag, used on BOTH codex invocations (it precedes the `review` / `exec` subcommand). Codex's default sandbox (`workspace-write`) blocks network and restricts command execution, so without this flag `codex review` can't reliably read the tree / run git and the apply path can't run build, tests, or network ops. PortOS-style hosts run on a trusted single-user machine, so full access is the intended posture (mirrors `claude --dangerously-skip-permissions` / `agy --dangerously-skip-permissions`). `--sandbox` and `-a` are independent top-level flags and may be combined (`codex --sandbox danger-full-access -a never exec …`).
- `agy --dangerously-skip-permissions --model "$AGY_REVIEW_MODEL" --print-timeout 30m` — `--dangerously-skip-permissions` auto-approves all tool permission requests so the Antigravity CLI runs unattended (the headless equivalent of confirming every prompt). `--model "$AGY_REVIEW_MODEL"` pins the reviewing model (resolved in pre-flight, default `Gemini 3.5 Flash (High)`, override via `AGY_REVIEW_MODEL`): without it agy picks its own default, which may be a heavy "Thinking" tier that spends many minutes in hidden reasoning and — depending on the model, emits little or no visible output meanwhile — makes a review look hung for 20-30 minutes; a fast capable model returns in well under a minute on a small diff. This is the agy successor to the Gemini CLI's `gemini --yolo` + `env GEMINI_SANDBOX=false`: agy folds both "auto-approve tools" and "no sandbox gate" into the single flag, and runs the prompt non-interactively via `-p` — which takes the prompt as its positional argument (`agy … -p "$LOCAL_PROMPT"`), **not** from stdin. Piping into `agy -p` (e.g. `echo … | agy -p`) fails with `agy --print takes the prompt as an argument, not stdin` and wastes an invocation; always pass the quoted prompt as the argument. `--print-timeout 30m` raises the print-mode wait above agy's 5-minute default so a real multi-file review isn't cut off, and — since stock macOS has no `timeout`/`gtimeout` and `$TIMEOUT_CMD` is empty — is the effective bound on the invocation; it bounds the wait for the next response chunk, not the total runtime, so an actively-streaming review is never truncated. Unlike the old gemini invocation, no `env VAR=…` prefix is needed, so it composes cleanly with the `$TIMEOUT_CMD {INVOCATION}` wrapper at step 2 of the loop when one is present.

Because these flags grant the headless CLI full unattended write access to the working tree — and the Claude-Code sub-agent likewise shares this working tree — the verify step in this loop (build + tests + diff inspection by the main thread) is mandatory and non-skippable — it is the only line of defense between the reviewing agent's output and the remote branch. This applies in *both* editing modes: in review-only mode the orchestrator's own fixes are still verified before push, because the orchestrator may misread the CLI's findings or introduce its own regressions.

### Loop

Initialize `ITERATION=0`, `MAX_ITERATIONS=3`, `STATUS=""`.

1. **Capture baseline**: `LOOP_START_SHA=$(git rev-parse HEAD)`

2. **Invoke the chosen reviewer** (capture output to a log so context stays clean):

<!-- if:teams -->
   **When `REVIEW_AGENT=claude`: dispatch an in-process sub-agent — do NOT run the Bash invocation below.** A headless `claude -p` session bills against the Anthropic API; an in-process sub-agent runs under this session's plan, so it incurs no extra API billing. Dispatch the sub-agent via the `Agent` tool with `subagent_type: "general-purpose"`, then resume the loop:
   - **Agent type**: use `subagent_type: "general-purpose"` (the catch-all agent type — on some hosts it is named `claude`). Do **not** invent or look for a specialized `code-reviewer` / `code-review` / `reviewer` agent type — no such type exists in this harness, and probing for one just wastes a turn on an "agent type not found" error before falling back. The review behavior comes entirely from `$LOCAL_PROMPT`, not from a specialized agent type.
   - **Sub-agent prompt**: pass `$LOCAL_PROMPT` (computed above) as the prompt. It is a self-contained single-agent review that carries the `git diff` instruction and the mode-specific output contract directly (it does **not** invoke the `/do:review` skill — a nested skill fan-out would not re-sync into this sub-agent's final message any more than it does under `agy -p`). So the sub-agent behaves identically to the `claude -p` path — in `REVIEWER_APPLIES=true` mode it applies and commits fixes directly in the shared working tree (as `address review (claude): <summary>`); in review-only mode it returns the structured `FINDING <N>:` blocks (or `NO FINDINGS`) as its final message.
   - **Capture the result into the log** so Step 3's parsing and the final report's `Log:` line work unchanged: `LOG_FILE="$(mktemp -t local-review-claude.XXXXXX.log)"`, write the sub-agent's returned message to `$LOG_FILE`, and set `EXIT_CODE=0` (use a non-zero `EXIT_CODE` only if the sub-agent reports it could not complete the review).
   - Skip the Bash invocation below and proceed to Step 3.

   **For `codex` and `gemini`** (and for `claude` only if this loop somehow runs outside Claude Code), use the Bash invocation:
<!-- /if:teams -->

   **Run the invocation in the BACKGROUND, not as a blocking foreground Bash call.** This is the single most important detail in this step. A real multi-file review by `agy`/`codex`/`claude -p` routinely runs longer than ten minutes, and **the host CLI's Bash tool caps a single foreground command at ~10 minutes** (Claude Code's Bash tool `timeout` parameter maxes out at 600000 ms; other hosts impose a similar foreground ceiling). A blocking foreground call is therefore killed at the 10-minute mark *by the host*, before the reviewer prints its findings — regardless of `$TIMEOUT_CMD` (`timeout 1800`) or agy's `--print-timeout 30m`, which are both 30-minute bounds the host never lets the foreground call reach. The 10-minute cap is **not** in this loop's shell logic; it is the host tool ceiling, so the only way around it is to not block on a foreground call. Launch the reviewer detached and poll its log instead:

   - **Claude Code / hosts with a backgroundable Bash tool**: invoke the command below with the host's background mode (Claude Code: set `run_in_background: true` on the Bash tool call). The host returns immediately with a task/shell id — there is no foreground timeout to hit. Capture the command to the log exactly as shown; the trailing `; echo $? > "$DONE_FILE"` records the real exit code where the wait loop can read it:

     ```bash
     LOG_FILE="$(mktemp -t local-review-${REVIEW_AGENT}.XXXXXX.log)"
     DONE_FILE="${LOG_FILE}.exit"
     $TIMEOUT_CMD {INVOCATION} > "$LOG_FILE" 2>&1; echo $? > "$DONE_FILE"
     ```

     Then wait for the reviewer with **bounded blocking-chunk foreground calls** — do NOT end your turn and wait to be notified. Repeat this foreground call (each iteration blocks ~9 minutes, safely under the host's ~10-minute foreground cap) until `$DONE_FILE` exists, then read `EXIT_CODE=$(cat "$DONE_FILE")`:

     ```bash
     for i in $(seq 1 55); do [ -f "$DONE_FILE" ] && break; sleep 10; done; [ -f "$DONE_FILE" ] && cat "$DONE_FILE" || echo "STILL_RUNNING"
     ```

     On `STILL_RUNNING`, immediately issue the same call again (tail the last few lines of `$LOG_FILE` between chunks only if you need a progress signal — never re-block on the reviewer process itself). Keep chaining chunks until `$DONE_FILE` appears (the run is bounded by `$TIMEOUT_CMD`/`--print-timeout 30m`, which now actually govern it because nothing is foreground-capping it first).

     **NEVER end your turn while a reviewer is in flight.** "The host will re-notify me when the background task exits" is only true for a top-level interactive session. When this loop runs inside a **subagent** (a `/do:next --swarm` worker, a CoS/background agent, anything spawned via an Agent/Task tool), ending the turn *terminates the run* — completion notifications are not guaranteed to reach a stopped subagent, and there is no wake-up mechanism it can schedule. A stopped subagent is dead, not waiting: the orchestrator sees a premature "final" result while the reviewer is still running, and the review's findings are lost. The blocking-chunk loop above is the correct wait in BOTH contexts (it costs nothing in a top-level session), so use it unconditionally rather than deciding whether you are a subagent.

   - **Hosts with no background Bash mechanism** (the loop is running under a CLI whose shell tool cannot detach): fall back to the foreground call below, but set the host tool's timeout parameter to its maximum and be aware the run will still be cut at that maximum (~10 min on Claude Code). On such a host a long review is expected to be reported as `cli-error` (timed out) rather than silently truncated to zero findings:

     ```bash
     LOG_FILE="$(mktemp -t local-review-${REVIEW_AGENT}.XXXXXX.log)"
     $TIMEOUT_CMD {INVOCATION} > "$LOG_FILE" 2>&1
     EXIT_CODE=$?
     ```

   - `$TIMEOUT_CMD` was already resolved during pre-flight (`timeout 1800`, `gtimeout 1800`, or empty). Just expand it here — empty becomes a direct invocation. No re-checking or commentary needed.
   - If `EXIT_CODE != 0` and the CLI produced no commits, set `STATUS=cli-error`, print the last 80 lines of the log, and exit the loop. Surface the log path so the user can inspect. A `124` exit (from `timeout`/`gtimeout`) or an empty log after the poll loop gave up means the review genuinely ran past 30 minutes — report it as `cli-error` with the log path, do not record `clean`.

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
   - **Run the fix regression guard** on the same `$LOOP_START_SHA..HEAD` fix diff before building: scan the fix for unscoped state-clearing/restoring writes (a "restore"/"reset" keyed to a whole collection instead of the one record the finding named) and for side effects folded onto a hot path (an `updatedAt`/event/cache write on every tick), and add a focused regression test when the fix touches scoping or timestamp/side-effect logic. See `~/.claude/lib/fix-regression-guard.md`. A fix that fails the guard is itself a finding — re-scope it now rather than pushing it for the next round to catch (that is the round-N+1 spiral this guard exists to stop).
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
