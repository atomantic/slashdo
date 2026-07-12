## Sequential Draft-Enhancement Loop

Route a **drafted tracker issue** (title + body) through an **ordered pipeline of
enhancement agents**, each sharpening the previous agent's output, and return the
enhanced draft. Selected via `--enhance-with <list>` on `/do:plan-task`: a cheap
"second (and third) opinion" folded into the draft *before* it reaches the approval
gate, so the issue that lands is more decision-complete than a single agent produces
alone.

This mirrors [local-agent-review-loop.md](./local-agent-review-loop.md)'s
binary-resolution, unattended-invocation, background-launch, and
**missing-binary → skip, never substitute** conventions — reuse them rather than
reinventing. The essential difference: a review loop *finds and fixes* code; this
loop *transforms a text draft*. There is no build/test/commit/push, no iteration
count, and no merge gate — just a left-to-right chain where each agent's stdout
becomes the next agent's input.

### Inputs

- `{ENHANCE_AGENTS}` — the ordered, deduped agent list the caller parsed from
  `--enhance-with` (see the caller's Parse Arguments). Each entry is a slug —
  `codex`, `claude`, `agy`, or `grok` — optionally carrying a `[<model>]` bracket
  (`codex[o3]`, `grok[grok-code-fast-1]`), stripped by the caller into a per-entry
  `{ENH_MODEL}` (empty → the agent's built-in default). `gemini`/`antigravity`
  normalize to `agy`. `ollama` and `copilot` are **not** valid here — they are
  review-oriented (findings emitters), not free-form draft rewriters; the caller
  rejects them before this loop runs. An empty list (or the literal `none`) means
  the caller skips this loop entirely.
- `{DRAFT_TITLE}` / `{DRAFT_BODY}` — the Phase 3 draft to enhance. These are the
  loop's running state: each successful agent pass overwrites them, and the final
  values are what the loop returns.
- `{REPO_CONTEXT}` — the task description and the repo the draft targets, so an
  enhancer can ground its improvements in the actual code (it runs in the repo's
  working directory and may read files, but must not modify them).

### The enhancement contract

Every agent gets the **same task**: improve the *current* draft — tighten the
problem statement, fill gaps in context / proposed approach / acceptance criteria,
surface under-specification the implementer would trip on — **without inventing new
requirements or changing the task's intent**. It is refinement, not redesign: an
enhancer that bolts on unrequested features has failed the contract. It must **not**
implement anything, modify files, or file the issue — it only returns a better draft.

Build the shared prompt once, re-substituting the running `{DRAFT_TITLE}`/`{DRAFT_BODY}`
for each agent (so agent N sees agent N-1's output, not the original).

**Load the draft through files, never by inlining it into the assignment.** The body
is free-form markdown that routinely contains backticks and `$(...)` inside code
fences; materializing the assignment below with the draft text pasted literally into
the double-quoted string makes the shell execute those substitutions, corrupting the
draft (or running its contents). Write the running draft to temp files via quoted
heredocs and load the variables from them — a value loaded into a variable is never
re-scanned for substitutions when later expanded:

```bash
DRAFT_TITLE_FILE="$(mktemp -t enhance-title.XXXXXX)"
DRAFT_BODY_FILE="$(mktemp -t enhance-body.XXXXXX)"
REPO_CONTEXT_FILE="$(mktemp -t enhance-context.XXXXXX)"
cat > "$DRAFT_TITLE_FILE" <<'DRAFT_EOF'
<the current draft title, pasted verbatim>
DRAFT_EOF
cat > "$DRAFT_BODY_FILE" <<'DRAFT_EOF'
<the current draft body, pasted verbatim>
DRAFT_EOF
cat > "$REPO_CONTEXT_FILE" <<'DRAFT_EOF'
<the task description / repo context, pasted verbatim — free-form user text with the same backtick hazard>
DRAFT_EOF
DRAFT_TITLE=$(cat "$DRAFT_TITLE_FILE")
DRAFT_BODY=$(cat "$DRAFT_BODY_FILE")
REPO_CONTEXT=$(cat "$REPO_CONTEXT_FILE")
```

```bash
# The delimiter markers make the output machine-parseable even though the body is
# free-form markdown full of `##` headings and code fences — parse the title as the
# single line after <<<ENHANCED_TITLE>>> and the body as everything between
# <<<ENHANCED_BODY>>> and end-of-output. They are deliberately unlikely to collide
# with issue prose.
ENHANCE_PROMPT="You are improving a DRAFT GitHub/GitLab issue before it is filed. Do NOT implement the task, do NOT modify any files, do NOT open the issue — your only job is to return a better-specified version of the draft below.

Improve it by: tightening the Problem/Goal into one crisp outcome; grounding the Context in the actual code (you may read files in this repo to verify paths, symbols, and current behavior — but change nothing); making the Proposed approach concretely actionable; and ensuring Acceptance criteria are observable and checkable. Where the draft is under-specified in a way an implementer would trip on, either resolve it from the code or call it out explicitly in an Open questions section. Preserve the task's ORIGINAL intent — do NOT invent new requirements, add unrequested scope, or redesign the feature. Keep the same section structure (Problem / Goal, Context, Proposed approach, Acceptance criteria, Out of scope, Open questions); omit a section only if it genuinely has no content. Write as a human engineer would — no AI-attribution or 'as an AI' phrasing.

Task being planned: ${REPO_CONTEXT}

--- CURRENT DRAFT TITLE ---
${DRAFT_TITLE}

--- CURRENT DRAFT BODY ---
${DRAFT_BODY}
--- END DRAFT ---

Output ONLY the improved issue, in EXACTLY this format and nothing else (no preamble, no commentary, no code fence around the whole thing):
<<<ENHANCED_TITLE>>>
<the improved one-line title, no [category] brackets>
<<<ENHANCED_BODY>>>
<the improved issue body in markdown>"
```

### Pre-flight (shared, run once)

Resolve the timeout wrapper — the only genuinely run-once piece; this is settled
logic; run it, don't narrate it:

```bash
# macOS ships no timeout(1) unless coreutils is installed; probe for it. Empty array =
# no wrapper (rely on each CLI's own limits). An ARRAY, not a string: zsh (a common
# host shell) does not word-split an unquoted expansion, so a two-word string like
# 'timeout 1800' would be executed as one bogus command name; the array expands to
# separate words in bash and zsh alike, and to zero words when empty. Enhancement is
# lighter than a full review (no build/test), but a large draft on a heavy model can
# still exceed the ~10-min host foreground cap, so the same background+poll launch
# below is used.
TIMEOUT_CMD=()
if command -v timeout >/dev/null 2>&1; then TIMEOUT_CMD=(timeout 1800)
elif command -v gtimeout >/dev/null 2>&1; then TIMEOUT_CMD=(gtimeout 1800); fi
```

### Per-entry model flags (recompute for EVERY agent)

`{ENH_MODEL}` is **per-entry** — `--enhance-with codex[o3],grok` gives codex `o3` and
grok an empty model — so these assignments run inside the loop, once per agent, never
shared across entries (a stale `MODEL_FLAG` from a prior entry would pin the next
agent to a model it doesn't have). The flag becomes a shell **array** (never a bare
string — model names may contain spaces/parens and zsh does not word-split an
unquoted expansion, so a string would pass `--model X Y` as one bogus argv word; an
array keeps them separate in bash and zsh and expands to zero words when empty).
`codex`, `claude`, and `grok` all accept the long `--model` form, so one array serves
all three:

```bash
MODEL_FLAG=()
[ -n "$ENH_MODEL" ] && MODEL_FLAG=(--model "$ENH_MODEL")
# agy always pins a model (its default may be a heavy "Thinking" tier that looks hung
# for 20-30 min), so it is handled separately and never left unpinned:
AGY_ENH_MODEL="${ENH_MODEL:-${AGY_REVIEW_MODEL:-Gemini 3.5 Flash (High)}}"
```

### Per-agent invocation

The CLIs run **non-interactively** — unattended, never stopping to ask for
permission — but at the **least privilege the task needs**: enhancement is
contractually read-only, so where a CLI offers a read-only/limited mode, use it
instead of the review loops' full-access flags (a misbehaving or prompt-injected
pass should be *unable* to write, not merely told not to; the step-4 git check is
the backstop for the CLIs that lack such a mode). Each takes the enhancement prompt
as a positional argument (never via stdin) and prints the improved draft to stdout:

| Agent | Invocation |
|-------|------------|
<!-- if:teams -->
| `claude` | Dispatch an in-process sub-agent via the `Agent` tool (`subagent_type: "general-purpose"`, prompt `$ENHANCE_PROMPT`, `model` = `{ENH_MODEL}` when set) — **not** `claude -p`, so it stays on the host session's plan billing instead of hitting the API. Its returned message is the agent's stdout. |
<!-- else -->
| `claude` | `claude -p "$ENHANCE_PROMPT" "${MODEL_FLAG[@]}" --dangerously-skip-permissions` |
<!-- /if:teams -->
| `codex` | `codex "${MODEL_FLAG[@]}" --sandbox read-only -a never exec "$ENHANCE_PROMPT"` — `exec` (free-form prompt) is the right subcommand here, not `codex review`; `-m`/`--model`, `--sandbox`, and `-a` are all top-level flags that MUST precede `exec`. `--sandbox read-only` (NOT the review loop's `danger-full-access`) enforces the read-only contract at the sandbox level while still allowing tree reads and git queries. |
| `agy` | `agy --dangerously-skip-permissions --model "$AGY_ENH_MODEL" --print-timeout 30m -p "$ENHANCE_PROMPT"` |
| `grok` | `grok --permission-mode bypassPermissions "${MODEL_FLAG[@]}" -p "$ENHANCE_PROMPT"` |

**Grok flag rationale.** `grok -p`/`--single <PROMPT>` runs a single-turn headless
prompt, prints the response to stdout, and exits — the grok analog of `claude -p` /
`agy -p`. `--permission-mode bypassPermissions` is what reliably auto-approves grok's
tool executions for an unattended run; the nominally lighter `dontAsk` mode is NOT a
safe substitute here — it does not dependably auto-approve headless tool calls, so a
background pass can sit waiting on an approval that never comes and degrade to a
timeout/no-op. Grok therefore keeps the full-bypass posture even though enhancement
is contractually read-only (unlike codex, it has no read-only sandbox mode); the
step-4 git contract check is the enforcement backstop. `-m`/`--model` pins the model
for the `grok[<model>]` bracket (empty → grok's own default). Output is grok's
default `plain` format — the improved draft on stdout. Like the other `-p` CLIs, grok
takes the prompt as the positional argument, **not** from stdin — do not pipe into it.

### Loop

For each entry in `{ENHANCE_AGENTS}`, **in order** (left to right — the pipeline is
sequential by design; do not parallelize, since each agent enhances the previous
one's output):

1. **Normalize and pre-flight the binary.** Normalize `gemini`/`antigravity` → `agy`.
   Resolve the binary (`claude`/`codex`/`agy`/`grok` — the `[<model>]` bracket never
   changes which binary is required). `command -v {binary}`. **If it is missing:**
   print `{agent} CLI not installed — skipping this enhancement pass`, record the
   agent as `skipped`, leave `{DRAFT_TITLE}`/`{DRAFT_BODY}` **unchanged**, and
   **continue to the next agent** — never substitute a different agent, and never
   abort the pipeline (a missing enhancer just means one fewer opinion, not a failed
   draft).<!-- if:teams --> The `claude` agent is the one exception: under Claude Code
   it runs as an in-process sub-agent (via the `Agent` tool), not a `claude`
   subprocess, so it needs no binary probe.<!-- /if:teams -->

2. **Rebuild `$ENHANCE_PROMPT`** with the *current* `{DRAFT_TITLE}`/`{DRAFT_BODY}` so
   this agent sees the prior agent's improvements, and **recompute `MODEL_FLAG` /
   `AGY_ENH_MODEL` from THIS entry's `{ENH_MODEL}`** (see "Per-entry model flags"
   above — a prior entry's bracket must not leak into this agent's invocation).
   Also snapshot the working-tree baseline for the contract check in step 4:
   ```bash
   TREE_BASELINE=$(git status --porcelain)
   HEAD_BASELINE=$(git rev-parse HEAD)
   INDEX_TREE=$(git write-tree)   # exact snapshot of the caller's index (staged state)
   DIFF_BASELINE=$(git diff HEAD | git hash-object --stdin)   # detects edits to files that were ALREADY dirty
   SNAPSHOT=$(git stash create)   # content snapshot of the dirty TRACKED worktree; empty string on a clean tree
   # Pre-existing UNTRACKED files are invisible to both git diff HEAD and git stash
   # create, so they need their own detection hash AND content snapshot — without
   # these, an enhancer that edits or deletes the caller's untracked work-in-progress
   # file goes undetected (its ?? porcelain line is unchanged) and unrestorable:
   UNTRACKED_TAR="$(mktemp -t enhance-untracked.XXXXXX.tar)"
   git ls-files --others --exclude-standard -z | tar --null -T - -cf "$UNTRACKED_TAR" 2>/dev/null
   UNTRACKED_BASELINE=$(git ls-files --others --exclude-standard -z | sort -z \
     | xargs -0 -I{} sh -c 'printf "%s %s\n" "$(git hash-object "{}")" "{}"' | git hash-object --stdin)
   ```
   Together these four artifacts capture the caller's ENTIRE pre-pass state — HEAD
   (`HEAD_BASELINE`), index (`INDEX_TREE`), tracked worktree content (`SNAPSHOT`),
   and untracked content (`UNTRACKED_TAR`) — which is what lets step 4 restore
   wholesale instead of surgically enumerating what a misbehaving agent touched.

3. **Invoke** per the table above.
<!-- if:teams -->
   - **`claude` (under Claude Code):** dispatch the in-process sub-agent; capture its
     returned message as `$OUTPUT` and set `EXIT_CODE=0` (use a non-zero `EXIT_CODE`
     only if the sub-agent reports it could not complete the enhancement) — without
     this explicit assignment, a stale `EXIT_CODE` from a prior subprocess entry (e.g.
     a timed-out codex pass) would wrongly fail this pass's parse in step 4. Then skip
     the background path below — it is only for the subprocess CLIs, and an in-process
     sub-agent runs on the host session's plan (no API billing) rather than as a
     `claude` subprocess.
<!-- /if:teams -->
   - **`codex` / `agy` / `grok`<!-- if:teams --><!-- else --> / `claude`<!-- /if:teams -->:**
     run in the **background**, not as a blocking foreground call — a large-draft pass
     on a heavy model can exceed the host's ~10-minute foreground cap. **The snippet
     below is not self-detaching — launch it with the host's background mode** (Claude
     Code: `run_in_background: true` on the Bash tool call; hosts without a background
     mechanism: append `&` after the `echo $? > "$DONE_FILE"` and rely on the poll
     loop). Run synchronously in the foreground, it is killed at the host's cap before
     the poll loop ever starts and the pass is wrongly recorded as a no-op. Same
     pattern as the review loop:
     ```bash
     LOG_FILE="$(mktemp -t enhance-${AGENT}.XXXXXX.log)"
     ERR_FILE="${LOG_FILE}.err"
     DONE_FILE="${LOG_FILE}.exit"
     # stderr goes to its own file, NOT 2>&1: step 4 parses the body as "everything
     # after <<<ENHANCED_BODY>>> to end-of-output", so any stderr the CLI emits after
     # the answer (telemetry warnings, timing/shutdown lines, update nags) would be
     # pasted verbatim into the enhanced draft and end up in the filed issue.
     "${TIMEOUT_CMD[@]}" {INVOCATION} > "$LOG_FILE" 2> "$ERR_FILE"; echo $? > "$DONE_FILE"
     ```
     Then wait with **bounded blocking-chunk foreground calls** — do NOT end your turn
     to wait for a notification (a stopped subagent is dead, not waiting):
     ```bash
     for i in $(seq 1 55); do [ -f "$DONE_FILE" ] && break; sleep 10; done; [ -f "$DONE_FILE" ] && cat "$DONE_FILE" || echo "STILL_RUNNING"
     ```
     On `STILL_RUNNING`, immediately reissue the same call until `$DONE_FILE` appears,
     then read `EXIT_CODE=$(cat "$DONE_FILE")` and `$OUTPUT=$(cat "$LOG_FILE")`.

4. **Verify the read-only contract, then parse the output.** Not every CLI can be
   sandboxed read-only (`claude`/`agy` have no such mode), so the "must not modify
   files" contract needs teeth: recompute `git status --porcelain`, `git rev-parse
   HEAD`, `git diff HEAD | git hash-object --stdin`, and the untracked-files hash
   (same pipeline as `UNTRACKED_BASELINE`) and compare all four against the step-2
   baselines (the diff hash catches an edit to a *tracked* file that was already
   dirty at baseline; the untracked hash catches an edit to — or deletion of — a
   pre-existing *untracked* file, which neither of the other checks can see). **If any
   changed**, the enhancer implemented instead of enhancing — restore the ENTIRE
   pre-pass state wholesale from the step-2 artifacts. Do NOT try to surgically
   enumerate what the agent touched (per-path choreography here has repeatedly proven
   to have destructive edge cases: a mixed reset unstages the caller's staged work
   and then porcelain-line comparison misclassifies `M ` as ` M`; `git checkout --`
   no-ops on staged-but-uncommitted content; stash misses untracked files). The
   wholesale sequence, run from the repo root, restores every layer exactly:
   1. **HEAD** — if it moved: `git reset --soft "$HEAD_BASELINE"` (`--soft` touches
      neither index nor worktree; never `--mixed`, which would wipe the caller's
      staged state, and never `--hard`, which would destroy uncommitted work swept
      into the agent's commit).
   2. **Index** — `git read-tree "$INDEX_TREE"` restores the caller's staged state
      exactly, whatever the agent did to it (`git add -A`, partial stages, resets).
   3. **Tracked worktree** — `git restore --source="${SNAPSHOT:-$HEAD_BASELINE}"
      --worktree -- .` rewrites every tracked file to its baseline worktree content
      (`$SNAPSHOT` — the stash commit — records exactly that; when the baseline tree
      was clean, `$SNAPSHOT` is empty and `$HEAD_BASELINE` is the same content).
   4. **Untracked files** — delete every currently-untracked path (`git ls-files
      --others --exclude-standard`) that is NOT listed in `$UNTRACKED_TAR` (files
      the agent created), then `tar -xf "$UNTRACKED_TAR"` to restore baseline
      untracked content (files the agent edited or deleted).
   Re-run the four comparisons afterward to confirm the tree is back at baseline;
   surface a loud warning if not (never silently continue on a still-dirty tree).

   Record the agent as `no-op (modified the working tree — contract violation)`, keep
   the previous draft unchanged, and continue to the next agent. Never let a
   contract-violating pass leave a dirtied tree behind for the caller.

   Then parse: extract the title as the single line after
   `<<<ENHANCED_TITLE>>>` and the body as everything between `<<<ENHANCED_BODY>>>` and
   end-of-output; trim surrounding whitespace.
   - **Well-formed output** (both markers present, non-empty title and body):
     overwrite `{DRAFT_TITLE}`/`{DRAFT_BODY}` with the parsed values and record the
     agent as `enhanced`. This becomes the input to the next agent.
   - **Malformed or empty output** (`EXIT_CODE != 0`, missing markers, or an empty
     body — e.g. the CLI errored, timed out, or emitted commentary instead of the
     contract): **keep the previous `{DRAFT_TITLE}`/`{DRAFT_BODY}` unchanged**, record
     the agent as `no-op` with a one-line reason (surface the log path, and
     `$ERR_FILE` when the failure detail lives on stderr), and continue.
     A broken enhancer must never corrupt or blank the draft — the pipeline degrades
     to the last good version, exactly as a missing binary degrades to a skip.

### Return

Return the final `{DRAFT_TITLE}`/`{DRAFT_BODY}` (the last agent's successful output,
or the original draft if every agent skipped/no-op'd) plus a compact per-agent status
line the caller can show before the approval gate:

```
Enhancement pipeline (codex → grok): codex enhanced · grok enhanced
# or, when an agent degraded:
Enhancement pipeline (codex[o3] → agy → grok): codex enhanced · agy skipped (not installed) · grok no-op (timed out — see /tmp/enhance-grok.….log)
```

The caller presents the **enhanced** draft at its approval gate (and under `--yes`
files it; under `--dry-run` prints it without filing). Enhancement never bypasses the
gate — a human still approves the final text.
