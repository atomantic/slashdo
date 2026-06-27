# Fix Regression Guard

A review loop catches bugs in the *original* diff. This guard catches bugs in the **fixes you just applied** — *before* you re-review or push them. The recurring failure it prevents: a fix for one finding silently breaks something adjacent, the next review round catches *that*, its fix breaks something else, and the loop spirals into five, six, seven rounds. The fix is the new diff; review it like one.

Run this guard once per iteration, **after applying a round's fixes and before re-review / push** (the inner loops' verify step is the natural home — see `local-agent-review-loop.md` step 4 and `ollama-review-loop.md`). It is cheap: it reads only the fix diff, not the whole change.

## Inputs

- `FIX_DIFF` — the diff introduced by *this round's fixes only* (e.g. `git diff "$LOOP_START_SHA..HEAD"`), not the whole PR.

## The guard

For each hunk in `FIX_DIFF`, ask the two questions that produce almost all self-inflicted review regressions:

1. **Did this fix narrow or clear shared state without scoping it to the thing being fixed?**
   The canonical break: a fix "restores" or "resets" a value (a status, a severity, a selection, a pin, a flag, a cache entry) and the restore is written against the *whole collection* instead of the *one record the finding was about* — so it silently clears state on unrelated records. Trace every state-clearing / state-restoring write the fix added: confirm its target is keyed to the specific id/scope the finding named. A `delete map[k]`, `arr.filter(...)`, a bulk `UPDATE ... SET`, a "reset to default" branch, or a broadened conditional are the usual suspects.

2. **Did this fix add or move a side effect onto a path that runs more often than the bug did?**
   The canonical break: a fix folds a write into a hot path — bumping an `updatedAt` / version / timestamp on *every* heartbeat, poll, or read instead of only on genuine content changes; emitting an event, invalidating a cache, or firing a network call from inside a loop or a read handler. Confirm the side effect the fix introduced fires only on the event class that warranted it (content change, real mutation), not on every tick.

If either answer is "yes — and it isn't scoped," the fix is itself a finding. Re-scope it (key the write to the specific id; gate the side effect on the real-change condition) before continuing. Do **not** push it and let the next reviewer find it — that *is* the round-N+1 spiral.

## Pin it with a test

When a fix touches state-clearing/scoping logic or a timestamp/side-effect path (the two classes above), add **one focused regression test** that pins the scope: it must *fail* against the unscoped version of the fix and pass against the scoped one — e.g. "restoring check A's severity leaves check B's pin intact," or "a heartbeat with no content change does not bump `updatedAt`." This is the same disposition as a `Missing test` root cause in `per-finding-root-cause.md`, applied to the fix rather than the original bug. Skip only when the area has no test culture or the fix is a pure typo/string change with no behavioral surface.

## What this is NOT

- **Not a full re-review of the PR.** The inner loop's own re-review iteration already does that. This guard is scoped to the *fix diff* and to the two high-frequency regression classes above — keep it fast so it runs every round.
- **Not license to expand scope.** If the guard reveals the fix needs to grow large to be correct, that is a real finding to disposition per `finding-disposition.md` (fix-now if it fits, defer with a rationale if it genuinely can't), not a reason to push the unscoped version.
