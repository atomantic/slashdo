## Local-agent recipe: `claude`

Prompt-driven reviewer; always review-only. Binary `claude`. Effort: `--effort <level>` on the subprocess path<!-- if:teams -->, prompt-advisory only on the in-process path (below)<!-- /if:teams -->.

<!-- if:teams -->
### Step 2 under Claude Code: in-process sub-agent

**Dispatch an in-process sub-agent — do NOT run Step 2's Bash launch.** A headless `claude -p` bills against the Anthropic API even when the host session is on a plan; an in-process sub-agent runs under this session's plan. Dispatch via the `Agent` tool, then resume the loop at Step 3. The loop's Step 1 snapshot and Step 3 restore are the enforcement for the general-purpose agent; do not switch to `claude -p` or broaden permissions because of its agent type. It inherits the host session's tool-approval settings.
- **Agent type**: `subagent_type: "general-purpose"` (the catch-all type — on some hosts named `claude`). Do **not** look for a specialized `code-reviewer` / `code-review` / `reviewer` type — none exists, and probing for one wastes a turn on an "agent type not found" error. The review behavior comes entirely from `$LOCAL_PROMPT`.
- **Model**: when `{REVIEW_MODEL}` is set, pass it as the `Agent` tool's `model` parameter; when empty, omit `model` and the sub-agent inherits the host session's model.
- **Effort**: there is no in-process analog of `--effort`. The `Agent` tool exposes a `model` parameter but **no reasoning-effort parameter**, so `{REVIEW_EFFORT}` reaches this path **only** as the advisory `Target reasoning effort level: <level>.` sentence `$LOCAL_PROMPT` already carries, and that is sufficient. Do not invent an `effort`/`reasoning_effort` argument for the `Agent` tool, do not shell out to `claude -p --effort <level>` (the API-billed path this branch exists to avoid), and do not reach for a host command that takes an effort argument — see the next bullet. A pinned effort is never a reason to leave this dispatch.
- **Never substitute the host's own review command for `$LOCAL_PROMPT`** — Claude Code's built-in `/code-review` skill (in any form: `/code-review xhigh`, `/code-review --effort xhigh <PR>`) is NOT this pass: it runs its own multi-agent fan-out and reports in its own format, so Step 3 has no `FINDING <N>:` / `NO FINDINGS` block to parse and the reviewer's merge-gate slot is filled by a verdict this loop never read.
- **Sub-agent prompt**: pass `$LOCAL_PROMPT` (with the diff payload appended) as the prompt. `REVIEWER_APPLIES=false` always holds here; the sub-agent returns the `FINDING <N>:` blocks (or `NO FINDINGS`) as its final message, and the orchestrator applies and verifies any fixes. No stdin file or argv-size check is needed; the enforced read-only tool requirement still applies.
- **Capture the result into the log** so Step 3 and the final report's `Log:` line work unchanged: `LOG_FILE="$(mktemp -t local-review-claude.XXXXXX.log)"`, write the sub-agent's returned message to `$LOG_FILE`, and set `EXIT_CODE=0` (non-zero only if the sub-agent reports it could not complete the review).

The subprocess path below applies only if this loop somehow runs outside Claude Code.
<!-- /if:teams -->

### Isolation profile

Expose only `Read,Glob,Grep`, auto-allow those same tools, disable MCP, hooks and Chrome, and supply the complete orchestrator-computed diff through the stdin transport below. No shell tool: even an apparently read-only `git diff` can execute a configured external diff helper. `--tools` restricts availability; an allowlist alone does not remove other tools. For the tool-free fallback set both tool lists to `""` and include the needed source context in the same stdin payload.

**Subprocess invocation** (`{INVOCATION}`; reviewer-applies is never selected — the orchestrator applies findings):

```bash
claude -p --input-format text ${MODEL_FLAG[@]+"${MODEL_FLAG[@]}"} ${EFFORT_FLAG[@]+"${EFFORT_FLAG[@]}"} --permission-mode plan --tools "Read,Glob,Grep" --allowedTools "Read,Glob,Grep" --strict-mcp-config --mcp-config '{"mcpServers":{}}' --settings '{"disableAllHooks":true}' --no-chrome --no-session-persistence < "$CLAUDE_REVIEW_INPUT"
```

#### Claude stdin transport

The no-shell profile cannot reconstruct a Git patch itself. Use Claude's documented [piped input](https://code.claude.com/docs/en/cli-reference): the CLI receives the complete `LOCAL_PROMPT` (instructions, verdict contract, base/head IDs, changed-file scope, diff, and any needed context) through a private temporary file on stdin. No patch, file list, or source text goes in argv, and no shell tool is added. Never replace the patch with a summary or truncate it to fit.

Before **each subprocess invocation**, after constructing the full payload, run this block in the invocation's shell. It accepts at most **8 MiB (8,388,608 bytes)** — a transport safety bound, not a promise about model context. A missing/empty payload, failed write/count, or larger input is `STATUS=no-verdict`; return to the caller without launching. Required reviewers remain unsatisfied; `~opt` only excuses inconclusive results, never turns them into clean reviews. If a verified CLI/provider has a smaller input limit, enforce that too; never silently accept incomplete coverage.

```bash
prepare_claude_review_input() {
  CLAUDE_REVIEW_INPUT="$(mktemp -t slashdo-claude-review.XXXXXX)" || return 1
  if ! printf '%s' "${LOCAL_PROMPT:-}" > "$CLAUDE_REVIEW_INPUT" ||
     ! CLAUDE_REVIEW_BYTES="$(LC_ALL=C wc -c < "$CLAUDE_REVIEW_INPUT")" ||
     [ "$CLAUDE_REVIEW_BYTES" -eq 0 ] ||
     [ "$CLAUDE_REVIEW_BYTES" -gt 8388608 ]; then
    rm "$CLAUDE_REVIEW_INPUT"
    CLAUDE_REVIEW_INPUT=""
    return 1
  fi
}
if [ "$REVIEW_AGENT" = claude ] && ! prepare_claude_review_input; then
  STATUS=no-verdict
  REVIEW_DIAGNOSTIC="Claude review input could not be prepared completely within the 8 MiB transport limit."
fi
```

`mktemp` creates the input with owner-only permissions. Keep the file until the reviewer exits, including in the background. Do not read the payload back into an argv string or `eval` it. The invocation redirects the file itself, so it uses Step 2's ordinary (non-`cmd`) timed branch.

**Claude input cleanup** — after Step 2's foreground exit-code capture or background done-marker read, before handling any success, timeout, CLI-error, or verdict-parser result, run:

```bash
if [ "$REVIEW_AGENT" = claude ] && [ -n "${CLAUDE_REVIEW_INPUT:-}" ]; then
  rm "$CLAUDE_REVIEW_INPUT"
  CLAUDE_REVIEW_INPUT=""
fi
```

Preserve `EXIT_CODE`; cleanup success is not reviewer success. Use this same cleanup if launch is abandoned after preparation, and only after terminating/reaping the reviewer if the host cancels the pass.
