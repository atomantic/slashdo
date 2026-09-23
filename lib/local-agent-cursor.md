## Local-agent recipe: `cursor`

Prompt-driven reviewer (the Cursor Agent CLI; alias `cursor-agent`); always review-only. Effort is folded into `--model`, never `--effort`.

**Cursor binary probe** (pre-flight step 2). The binary is **not** always named `cursor`. Prefer the unambiguous `cursor-agent` name (only Cursor ships it). Fall back to `agent` **only** when that binary identifies as the Cursor CLI — Grok Build also installs an `agent` binary on `$PATH`, and treating it as Cursor would silently review with the wrong CLI:

```bash
REVIEW_BIN=""
if command -v cursor-agent >/dev/null 2>&1; then
  REVIEW_BIN=cursor-agent
elif command -v agent >/dev/null 2>&1; then
  AGENT_ID="$(agent --help 2>&1 | head -20)"
  case "$AGENT_ID" in
    *[Cc]ursor*)
      case "$AGENT_ID" in
        *[Gg]rok*) REVIEW_BIN="" ;;  # Grok's agent, not Cursor
        *) REVIEW_BIN=agent ;;
      esac
      ;;
  esac
fi
```

If `REVIEW_BIN` is still empty, the Cursor CLI is missing — take pre-flight step 3's missing-binary branch. Otherwise store the resolved name as `{REVIEW_BIN}`.

**Effort carrier** — run right after the shared-inputs block, in the same shell. Effort is a model-variant parameter: a model string that already carries `effort=` is left alone, and effort with no model stays prompt-advisory (nothing to attach the variant to):

```bash
if [ -n "$REVIEW_EFFORT" ] && [ -n "$REVIEW_MODEL" ]; then
  case "$REVIEW_MODEL" in
    *effort=*) CURSOR_MODEL="$REVIEW_MODEL" ;;
    *\[*\])    CURSOR_MODEL="${REVIEW_MODEL%]},effort=${REVIEW_EFFORT}]" ;;
    *)         CURSOR_MODEL="${REVIEW_MODEL}[effort=${REVIEW_EFFORT}]" ;;
  esac
  MODEL_FLAG=(--model "$CURSOR_MODEL")
fi
```

**Isolation.** plan/ask by itself does not enforce the required no-network and no-write boundary, and Cursor ships no verified invocation-local tool allowlist. Run the tool-free fallback anyway; Steps 1/3's snapshot+revert is the backstop. Do not infer safety from a successful dry run or from a prompt asking for it.

`{INVOCATION}` (unverified — confirm `"$REVIEW_BIN" --help` still exposes `-p`/`--print` before relying on it):

```bash
"$REVIEW_BIN" -p "$LOCAL_PROMPT" ${MODEL_FLAG[@]+"${MODEL_FLAG[@]}"}
```
