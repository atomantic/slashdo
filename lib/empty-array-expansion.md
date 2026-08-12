## Expanding a possibly-empty shell array (`${ARR[@]+"${ARR[@]}"}`)

**The rule.** Any array that can legitimately be empty — `TIMEOUT_CMD`, `MODEL_FLAG`,
`OLLAMA_FLAGS`, or any other optional-argument array — must be expanded as:

```bash
${ARR[@]+"${ARR[@]}"}      # correct
"${ARR[@]}"                # WRONG when ARR can be empty
```

**Why the guard is required, not decoration.** Under **bash 3.2** — still `/bin/bash`
on macOS — a bare `"${ARR[@]}"` on an *empty* array is an **unset** expansion, so with
`set -u` the shell aborts with `ARR[@]: unbound variable` **before the command runs**:

```
$ /bin/bash -c 'set -u; A=(); "${A[@]}" echo ok'
/bin/bash: A[@]: unbound variable        # exit 127 — echo never ran

$ /bin/bash -c 'set -u; A=(); ${A[@]+"${A[@]}"} echo ok'
ok                                        # exit 0
```

The `${ARR[@]+…}` form suppresses the expansion entirely when the array is unset or
empty, and is identical to `"${ARR[@]}"` when it is not — quoting and word boundaries
are preserved, so an element containing spaces still arrives as one argument. It is
safe on bash 3.2+, bash 4/5, and zsh alike, so it is the only form to write.

**Why it matters here specifically.** Stock macOS ships **neither** `timeout(1)` (GNU
coreutils) nor `gtimeout` (the Homebrew-prefixed coreutils build), so a probing
`TIMEOUT_CMD=()` stays empty on a typical Mac — the *common* case, not an edge case.
Running without a timeout wrapper is a **supported configuration** (the invocation is
bounded by the CLI's own limits instead) and must never be recorded as a reviewer
failure. But with an unguarded expansion the review loops fail in the worst possible
way: every invocation aborts before the reviewer starts, returning RC=1 with empty
output, so the loop counts each file as a review error and the pass resolves to
`cli-error` — a hard error that `~opt` does **not** excuse — blocking the merge on a
PR no reviewer ever looked at.

**Diagnosing it.** Every file erroring with an empty response, and nothing but
`unbound variable` in the captured stderr, is this bug — an environment condition, not
a reviewer failure. Fix the expansion and re-run the pass; do not record `cli-error`.
