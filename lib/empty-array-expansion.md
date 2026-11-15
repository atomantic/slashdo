## Expanding a possibly-empty shell array (`${ARR[@]+"${ARR[@]}"}`)

Any array that can legitimately be empty (`TIMEOUT_CMD`, `MODEL_FLAG`, `OLLAMA_FLAGS`, or any other optional-argument array) is expanded as:

```bash
${ARR[@]+"${ARR[@]}"}      # correct
"${ARR[@]}"                # aborts when ARR is empty under bash 3.2 with set -u
```

Under bash 3.2, still `/bin/bash` on macOS, a bare `"${ARR[@]}"` on an empty array is an unset expansion, so with `set -u` the shell aborts with `ARR[@]: unbound variable` before the command runs. The guarded form expands to nothing when the array is empty and is identical to `"${ARR[@]}"` otherwise, on bash 3.2+, bash 4/5 and zsh.

This matters because stock macOS ships neither `timeout` nor `gtimeout`, so `TIMEOUT_CMD=()` is the common case there. Running without a timeout wrapper is a supported configuration, not a reviewer failure. If every invocation errors with an empty response and the captured stderr holds only `unbound variable`, an expansion is unguarded: fix it and re-run the pass rather than recording `cli-error`.
