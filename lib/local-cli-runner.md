## Local CLI runner: timeout, snapshot/restore, background launch

The local-agent review loop, the draft-enhancement loop and the parallel barrier drive a headless CLI against this working tree through one installed script, `~/.claude/lib/local-cli-runner.sh`. Always run it as `bash ~/.claude/lib/local-cli-runner.sh <subcommand>`, exactly as written here. The caller owns the prompt, the `{INVOCATION}`, and what a failure means for its status. The script bounds the run, launches it and waits on it, and keeps the CLI from changing the caller's tree. It refuses to run from inside the working tree it protects.

**Shell state between tool calls.** Many harnesses start a fresh shell for every command, so nothing may depend on a variable from an earlier call. Each subcommand prints what a later call needs as `NAME=value`; start that later call by assigning those values. Run the caller's input and flag blocks, any recipe pre-launch block, and the launch line as one command: wherever a loop or recipe says a block runs "in the launch command", it means that one.

**Snapshot**, before the CLI runs: `bash ~/.claude/lib/local-cli-runner.sh snapshot`. It saves HEAD, the index, tracked and untracked content, and the security-relevant git config and hooks into a private state directory, and prints `RUN_STATE_DIR=… RUN_STATE_SUM=… RUNNER_SUM=…`. Keep all three: they are all Verify needs. `RUNNER_SUM` is the script's own hash, because a CLI that can write outside the repository could rewrite the script during the pass. A non-zero exit means no snapshot was taken, so do not launch.

**Launch**: the last line of the launch command, with the caller's `RUN_TAG`:

```bash
bash ~/.claude/lib/local-cli-runner.sh launch --tag "$RUN_TAG" -- {INVOCATION}
printf '%s' "$PROMPT_ON_STDIN" | bash ~/.claude/lib/local-cli-runner.sh launch --tag "$RUN_TAG" -- {INVOCATION}
```

Use the second form only when the caller set a non-empty `PROMPT_ON_STDIN` (the invocation reads its prompt on stdin). Put the pipe in front of the script, never inside `{INVOCATION}`. The script prints `LOG_FILE=…`, then runs the invocation under `timeout 1800` (or `gtimeout`; stock macOS has neither, and running unbounded there is supported, never a failure). Stdout goes to `$LOG_FILE`, stderr to `$LOG_FILE.err` (`ERR_FILE`), and the exit code to `$LOG_FILE.exit`. Callers parse `$LOG_FILE` strictly, and the CLIs' banners and progress stay out of it.

A real review routinely runs past ten minutes, and most harnesses cap a foreground command at about that long. Run the launch command in the background when your harness can. Otherwise run it in the foreground with the command timeout at its maximum, and treat a run cut off there as timed out. A foreground launch exits with the CLI's exit code, which is `EXIT_CODE`. After a background launch, repeat the first two lines of the Verify block below followed by `bash "$R" wait --log "$LOG_FILE"` until it prints an exit code, which is `EXIT_CODE`. Each call blocks up to 540 seconds; pass `--seconds <n>` if your harness caps a foreground command sooner. On `STILL_RUNNING`, call again straight away. Never end your turn while a CLI is in flight. Inside a sub-agent (a `/do:next --swarm` worker, any background agent), ending the turn ends the run and loses the result. A `124` exit, or an empty log after the run, means it passed 30 minutes. That is a failed pass, never a clean one.

**Verify and restore**, after the CLI exits and before reading its result, as one command. Its first two lines check the script against `RUNNER_SUM` without running any of its code; begin every call made after the launch with them:

```bash
R=~/.claude/lib/local-cli-runner.sh
[ "$(cd / && GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null git hash-object --no-filters -- "$R")" = "$RUNNER_SUM" ] || { echo "runner script changed during the pass; do not trust this tree" >&2; exit 1; }
bash "$R" verify --state-dir "$RUN_STATE_DIR" --sum "$RUN_STATE_SUM"
```

It refuses a state directory whose checksum does not match. It restores git config and hooks with shell tools before running any Git command, then compares the tree and, if the CLI moved it, restores the whole pre-pass state. It prints one of:

- `TREE_STATE=clean`: the CLI left the tree alone.
- `TREE_STATE=restored`: the CLI wrote to the tree and the snapshot was put back. The caller decides what that means for its status.
- `TREE_STATE=restore-failed`, or a non-zero exit with a `runner script changed`, `cannot …` or `… failed` message and no `TREE_STATE`: the tree is not at baseline. The caller stops with a warning naming the log and never continues on top of that tree.

A `local CLI modified gitignored file` line names a file (`.env`, a local generated config) the runner cannot put back. Surface it in the caller's report. Delete `RUN_STATE_DIR` once the pass's result has been read.
