# Review Convergence Gate

A review loop should stop when another round is no longer worth it, not when it hits a round counter. Apply this gate after a round's findings are applied, verified and pushed, and before requesting the next review. The first review always runs in full; the gate only decides whether to start round N+1.

Look at what the round that just completed landed:

- **Nothing** (the reviewer reported clean, or every finding was rejected as wrong or out of scope): the diff has converged. Stop with the loop's clean status.
- **Only marginal findings**: a guard for an input no real caller produces, a refinement of an already-correct refusal, a "could also handle X" for an exotic combination, a stylistic or defensive tweak with no concrete wrong outcome behind it. Stop, and note in the report that the loop converged on diminishing returns rather than a cap.
- **At least one substantive finding**: a real bug, a security hole, a broken producer/consumer contract, a data-loss or wedged-state path, a missing test for real behavior, a crash on a plausible input. Run another round, then apply the gate again.

When you cannot tell whether a finding was substantive, count it as substantive: one extra round costs less than a missed regression.

The gate only decides whether one reviewer re-reviews its own fixes. It never skips a finding the current round surfaced (each still gets its `finding-disposition.md` treatment), never overrides the user's stop-mode or the ordered reviewer list, and does not replace the loop's iteration ceiling, which stays as the backstop the gate should almost always beat.
