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

**Workspace trust — never auto-granted.** In a directory the Cursor CLI has never been told to trust, print mode does not review: it prints a `Workspace Trust Required` notice to stderr and exits `1` before any model call. **Do not pass `--trust`.** It is not a per-invocation answer: the CLI persists the decision (a `.workspace-trusted` marker under `~/.cursor/projects/`), so it silently changes the user's Cursor state for every later session in that checkout — and this loop must not change the user's settings or relax a permission gate to recover from a denial. Workspace trust is the user's statement that they trust the checkout's contents, which a reviewer reading an attacker-influenced branch cannot make for them. **Never** pass an auto-approve flag either — `-f` or either of its long aliases (help: "Force allow commands"), `--approve-mcps`, `--auto-review`, or a sandbox-disabling override; the trust notice offers `-f` as an alternative, and it would grant the reviewer command execution. `--mode ask` (help: read-only Q&A) is a belt alongside Steps 1/3's snapshot+revert, never the boundary itself.

`{INVOCATION}` (confirm `"$REVIEW_BIN" --help` still exposes `-p`/`--print` and `--mode` before relying on it):

```bash
"$REVIEW_BIN" -p "$LOCAL_PROMPT" --mode ask ${MODEL_FLAG[@]+"${MODEL_FLAG[@]}"}
```

**Step 2 — classify a workspace-trust refusal before the generic non-zero branch.** An untrusted checkout is a reviewer that never launched — the same reasoning as `cmd`'s `126`/`127` exits — so it is `skipped` (inconclusive, `~opt`-excusable), never a hard `cli-error` that trips the wrapper's short-circuit over every remaining reviewer. Match the notice in `$ERR_FILE` only, where the CLI writes it: `$LOG_FILE` carries reviewer output and must not be able to downgrade a real failure. Set a flag here and defer the status until Step 3's restoration check:

```bash
CURSOR_TRUST_REQUIRED=false
if [ "$EXIT_CODE" -ne 0 ] && [ "$REVIEW_AGENT" = cursor ] && grep -q 'Workspace Trust Required' "$ERR_FILE" 2>/dev/null; then
  CURSOR_TRUST_REQUIRED=true
fi
```

Never recover by retrying with `--trust`, `-f`, or any other auto-approve flag, or by trusting the directory on the user's behalf.

**Step 3 — if `CURSOR_TRUST_REQUIRED=true` after the restoration check**, emit only the fixed diagnostic (the raw notice embeds the absolute workspace path) and return `STATUS=skipped`:

```bash
REVIEW_DIAGNOSTIC="Cursor reviewer did not launch: workspace trust required (slashdo never auto-trusts a checkout)."
REVIEW_REMEDY="If you trust this checkout's contents, run the Cursor CLI once interactively in it and accept the trust prompt, then re-run the review."
REPORT_LOG_FILE="(suppressed: raw trust notice embeds a local path)"
printf '%s\n' "$REVIEW_DIAGNOSTIC" >&2
printf 'Remedy: %s\n' "$REVIEW_REMEDY" >&2
STATUS=skipped
exit 0
```
