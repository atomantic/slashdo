## Local-agent recipe: `claude`

Prompt-driven reviewer; always review-only. Binary `claude`. Effort: `--effort <level>` on the subprocess path<!-- if:teams -->, prompt-advisory only on the in-process path (below)<!-- /if:teams -->.

<!-- if:teams -->
### Step 2 under Claude Code: in-process sub-agent

**Use the in-process path only when the Agent API can enforce the isolation profile below.** A headless `claude -p` bills against the Anthropic API even when the host session is on a plan; an in-process sub-agent runs under this session's plan. Dispatch via the `Agent` tool only after verifying that this invocation can expose just `Read,Glob,Grep` and disable MCP, hooks, browser, shell, write, and network tools. A `general-purpose` type or inherited tool-approval settings do not establish that boundary. The loop's Step 1 snapshot and Step 3 restore are defense in depth, not isolation. If the Agent API cannot enforce the profile, use the scoped subprocess invocation below.
- **Agent type**: `subagent_type: "general-purpose"` (the catch-all type — on some hosts named `claude`). Do **not** look for a specialized `code-reviewer` / `code-review` / `reviewer` type — none exists, and probing for one wastes a turn on an "agent type not found" error. The review behavior comes entirely from `$LOCAL_PROMPT`.
- **Model**: when `{REVIEW_MODEL}` is set, pass it as the `Agent` tool's `model` parameter; when empty, omit `model` and the sub-agent inherits the host session's model.
- **Effort**: there is no in-process analog of `--effort`. The `Agent` tool exposes a `model` parameter but **no reasoning-effort parameter**, so `{REVIEW_EFFORT}` reaches this path **only** as the advisory `Target reasoning effort level: <level>.` sentence `$LOCAL_PROMPT` already carries, and that is sufficient. Do not invent an `effort`/`reasoning_effort` argument for the `Agent` tool, do not shell out to `claude -p --effort <level>` (the API-billed path this branch exists to avoid), and do not reach for a host command that takes an effort argument — see the next bullet. A pinned effort is never a reason to leave this dispatch.
- **Never substitute the host's own review command for `$LOCAL_PROMPT`** — Claude Code's built-in `/code-review` skill (in any form: `/code-review xhigh`, `/code-review --effort xhigh <PR>`) is NOT this pass: it runs its own multi-agent fan-out and reports in its own format, so Step 3 has no `FINDING <N>:` / `NO FINDINGS` block to parse and the reviewer's merge-gate slot is filled by a verdict this loop never read.
- **Sub-agent prompt**: pass `$LOCAL_PROMPT` (with the diff payload appended) as the prompt. `REVIEWER_APPLIES=false` always holds here; the sub-agent returns the `FINDING <N>:` blocks (or `NO FINDINGS`) as its final message, and the orchestrator applies and verifies any fixes. No stdin file or argv-size check is needed; the verified invocation-local tool restrictions above still apply.
- **Capture the result into the log** so Step 3 and the final report's `Log:` line work unchanged: `LOG_FILE="$(mktemp -t local-review-claude.XXXXXX.log)"`, write the sub-agent's returned message to `$LOG_FILE`, and set `EXIT_CODE=0` (non-zero only if the sub-agent reports it could not complete the review).

The subprocess path below applies outside Claude Code and whenever the in-process Agent API cannot enforce the isolation profile.
<!-- /if:teams -->

### Isolation profile

Expose only `Read,Glob,Grep`, auto-allow those same tools, disable MCP, hooks and Chrome, and supply the complete orchestrator-computed diff through the stdin transport below. No shell tool: even an apparently read-only `git diff` can execute a configured external diff helper. `--tools` restricts availability; an allowlist alone does not remove other tools. For the tool-free fallback set both tool lists to `""` and include the needed source context in the same stdin payload.

**Structured verdict.** A prompt alone does not stop a long review from ending in a summary that mixes prose with its findings, which the strict parser then (correctly) rejects as `no-verdict`. The subprocess path therefore asks the CLI for schema-validated output: `--output-format json --json-schema "$CLAUDE_VERDICT_SCHEMA"` (the schema is defined in the stdin-transport block below) returns a `structured_output` object with no surrounding prose, and Step 3 converts it to the text verdict contract before the parser runs. Before the first subprocess pass, confirm `claude --help` lists `--json-schema` and `command -v jq` succeeds (the conversion needs it); if either fails, record `STATUS=no-verdict` without launching, with remedy `update the claude CLI` or `install jq`. The in-process path has no schema control and relies on the prompt's closing output-contract reminder.

**Subprocess invocation** (`{INVOCATION}`; reviewer-applies is never selected — the orchestrator applies findings):

```bash
claude -p --input-format text --output-format json --json-schema "$CLAUDE_VERDICT_SCHEMA" ${MODEL_FLAG[@]+"${MODEL_FLAG[@]}"} ${EFFORT_FLAG[@]+"${EFFORT_FLAG[@]}"} --permission-mode plan --tools "Read,Glob,Grep" --allowedTools "Read,Glob,Grep" --strict-mcp-config --mcp-config '{"mcpServers":{}}' --settings '{"disableAllHooks":true}' --no-chrome --no-session-persistence < "$CLAUDE_REVIEW_INPUT"
```

#### Claude stdin transport

The no-shell profile cannot reconstruct a Git patch itself. Use Claude's documented [piped input](https://code.claude.com/docs/en/cli-reference): the CLI receives the complete `LOCAL_PROMPT` (instructions, verdict contract, base/head IDs, changed-file scope, diff, and any needed context) through a private temporary file on stdin. No patch, file list, or source text goes in argv, and no shell tool is added. Never replace the patch with a summary or truncate it to fit.

Before **each subprocess invocation**, after constructing the full payload, run this block in the invocation's shell. It accepts at most **8 MiB (8,388,608 bytes)** — a transport safety bound, not a promise about model context. A missing/empty payload, failed write/count, or larger input is `STATUS=no-verdict`; return to the caller without launching. Required reviewers remain unsatisfied; `~opt` only excuses inconclusive results, never turns them into clean reviews. If a verified CLI/provider has a smaller input limit, enforce that too; never silently accept incomplete coverage.

```bash
# The verdict schema for --json-schema: either a clean verdict with no findings, or one or more complete findings.
CLAUDE_VERDICT_SCHEMA='{"type":"object","additionalProperties":false,"required":["verdict","findings"],"properties":{"verdict":{"type":"string","enum":["NO FINDINGS","FINDINGS"]},"findings":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["file","line","severity","description","fix"],"properties":{"file":{"type":"string","minLength":1},"line":{"type":"integer","minimum":1},"severity":{"type":"string","enum":["CRITICAL","IMPROVEMENT","NIT"]},"description":{"type":"string","minLength":1},"fix":{"type":"string","minLength":1}}}}}}'
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

**Claude structured verdict** — Step 3 recipe rule for the subprocess path, after the runner's Verify and restore and before the strict verdict parser. Only a CLI JSON result (an object with `"type": "result"`) is converted; the in-process path writes the text verdict itself, and anything else that is not CLI JSON is left for the strict parser, which rejects it. Convert its `structured_output` into the text contract (newlines inside a field are collapsed so every block stays complete) and point `LOG_FILE` at that file; an error result, a missing or schema-invalid object, or a contradictory verdict (`NO FINDINGS` with findings, `FINDINGS` with none) is `STATUS=no-verdict`, never `clean`. Keep the raw JSON log for the report:

```bash
claude_structured_verdict() {   # CLAUDE_RESULT_JSON = the CLI's JSON result; prints the text verdict contract, or fails
  jq -er '
    if type == "object" and .is_error == false and (.structured_output | type) == "object"
    then .structured_output else error("no structured output") end
    | if .verdict == "NO FINDINGS" and .findings == [] then "NO FINDINGS"
      elif .verdict == "FINDINGS" and (.findings | type) == "array" and (.findings | length) > 0 then
        [ .findings | to_entries[] | .key as $i | .value
          | if (.file | type) == "string" and (.file | length) > 0
               and (.line | type) == "number" and .line >= 1 and (.line | floor) == .line
               and (.severity | IN("CRITICAL", "IMPROVEMENT", "NIT"))
               and (.description | type) == "string" and (.description | length) > 0
               and (.fix | type) == "string" and (.fix | length) > 0
            then "FINDING \($i + 1):\nfile: \(.file | gsub("[\r\n]+"; " "))\nline: \(.line)\nseverity: \(.severity)\ndescription: \(.description | gsub("[\r\n]+"; " "))\nfix: \(.fix | gsub("[\r\n]+"; " "))"
            else error("malformed finding") end ]
        | join("\n\n")
      else error("contradictory verdict") end' "$CLAUDE_RESULT_JSON"
}
if [ "$REVIEW_AGENT" = claude ] && command -v jq >/dev/null 2>&1 &&
   jq -e 'type == "object" and .type == "result"' "$LOG_FILE" >/dev/null 2>&1; then
  if CLAUDE_VERDICT_TEXT="$(CLAUDE_RESULT_JSON="$LOG_FILE" claude_structured_verdict 2>/dev/null)"; then
    printf '%s\n' "$CLAUDE_VERDICT_TEXT" > "$LOG_FILE.verdict" && LOG_FILE="$LOG_FILE.verdict"
  else
    STATUS=no-verdict
    REVIEW_DIAGNOSTIC="Claude returned no schema-valid structured verdict."
    REVIEW_REMEDY="Re-run the pass; if it repeats, confirm the installed claude CLI supports --json-schema."
  fi
fi
```
