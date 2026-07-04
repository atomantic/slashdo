# Unreleased Changes

## Review loops

- **Subagent-safe reviewer waits — never end-turn waiting for a notification.** The local-agent review loop's background-launch step used to say the host "re-notifies you when the process exits" and to poll in separate short calls — guidance that silently kills the run when the loop executes inside a subagent (a `/do:next --swarm` worker or CoS/background agent): a subagent that ends its turn is stopped, notifications never reach it, and the orchestrator reads its premature last words as the final result while the reviewer is still running. The loop now mandates bounded blocking-chunk foreground waits (repeated ~9-minute `for … sleep 10` checks on the reviewer's `$DONE_FILE`) with an explicit "never end your turn while a reviewer is in flight" rule; the multi-reviewer parallel barrier and the `/do:next --swarm` worker task template carry the same instruction.
