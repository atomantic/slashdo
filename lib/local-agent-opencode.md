## Local-agent recipe: `opencode`

Prompt-driven reviewer (the OpenCode CLI; aliases `zen`, `opencode-zen`); always review-only. Binary `opencode`. Effort: `--variant <level>`.

**Model** — run right after the shared-inputs block, in the same shell. OpenCode expects `provider/model`. Precedence: `{REVIEW_MODEL}` > `OPENCODE_REVIEW_MODEL` env > no slashdo override. There is no bundled model fallback: headless provider admission is not verified for the formerly documented free-tier model, so the operator selects a supported model/provider explicitly or configures one in OpenCode. Friendly aliases still normalize when explicitly selected:

```bash
OPENCODE_RAW_MODEL="${REVIEW_MODEL:-${OPENCODE_REVIEW_MODEL:-}}"
OPENCODE_REVIEW_MODEL=""
MODEL_FLAG=()
if [ -n "$OPENCODE_RAW_MODEL" ]; then
  case "$OPENCODE_RAW_MODEL" in
    muse-1.3|zen/muse-1.3|opencode/muse-1.3|muse-spark-1.3|zen)
      OPENCODE_REVIEW_MODEL="opencode/muse-spark-1.3-contributor-free" ;;
    muse-1.2|zen/muse-1.2|opencode/muse-1.2|muse-spark-1.2)
      OPENCODE_REVIEW_MODEL="opencode/muse-spark-1.2-contributor-free" ;;
    zen/*) OPENCODE_REVIEW_MODEL="opencode/${OPENCODE_RAW_MODEL#zen/}" ;;
    */*)   OPENCODE_REVIEW_MODEL="$OPENCODE_RAW_MODEL" ;;
    *)     OPENCODE_REVIEW_MODEL="opencode/$OPENCODE_RAW_MODEL" ;;
  esac
  MODEL_FLAG=(--model "$OPENCODE_REVIEW_MODEL")
fi
```

**Isolation.** Run headless via `opencode run --pure` (disables external plugins) with stdin from `/dev/null`. Use the tool-free fallback unless a verified, invocation-local tool allowlist disables shell, write, web and MCP tools.

`{INVOCATION}`:

```bash
opencode run --pure ${MODEL_FLAG[@]+"${MODEL_FLAG[@]}"} ${EFFORT_FLAG[@]+"${EFFORT_FLAG[@]}"} "$LOCAL_PROMPT" < /dev/null
```

**Step 2 — classify provider-admission failures before the generic non-zero branch.** A synthetic provider response such as `HTTP 403 / FreeTierError` is an unavailable reviewer, never a clean verdict and never a hard error that suppresses the next configured reviewer. Inspect only for these known markers; do not print, parse into diagnostics, or otherwise expose the provider's raw stderr/stdout, response headers, tokens, or local paths. Set a flag here, but defer the status until Step 3's review-only restoration check so a provider failure cannot bypass cleanup:

```bash
OPENCODE_ADMISSION_DENIED=false
if [ "$EXIT_CODE" -ne 0 ] && [ "$REVIEW_AGENT" = opencode ] && grep -Eiq 'FreeTierError|HTTP[[:space:]]*403|403[[:space:]]+Forbidden|free tier.{0,80}(admission|used|OpenCode)|provider.{0,40}(admission|denied)' "$ERR_FILE" "$LOG_FILE" 2>/dev/null; then
  OPENCODE_ADMISSION_DENIED=true
fi
```

Never retry by changing the pinned model, removing `--pure`, granting tools, or spoofing a client identity.

**Step 3 — if `OPENCODE_ADMISSION_DENIED=true` after the restoration check**, emit only the fixed, sanitized diagnostic and return `STATUS=no-verdict`; never print the raw provider output or its path:

```bash
REVIEW_DIAGNOSTIC="OpenCode reviewer unavailable: provider admission denied (HTTP 403 / FreeTierError)."
REVIEW_REMEDY="Select a supported reviewer/model/provider explicitly; keep --pure and tool isolation unchanged."
REPORT_LOG_FILE="(suppressed: raw provider output is not user-facing)"
printf '%s\n' "$REVIEW_DIAGNOSTIC" >&2
printf 'Remedy: %s\n' "$REVIEW_REMEDY" >&2
STATUS=no-verdict
exit 0
```

A required entry remains unsatisfied, an optional `~opt` entry is explicitly inconclusive-but-non-blocking, and series dispatch continues to the next reviewer. This path is never `clean`.
