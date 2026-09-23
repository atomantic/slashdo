# Review Convergence Gate

A review loop should stop when continuing stops being worth it — not when it hits a round counter. Apply this gate at the top of each re-loop decision, after a round's findings are applied/verified/pushed and before requesting the next review. It never fires on round 1 (the first review is always run in full); it governs only whether to start round N+1 (N ≥ 1).

## The judgment

Before starting the next round, look back at the round that just completed and answer honestly:

1. **What did the last round actually change?** If it made **zero commits** (the reviewer reported clean, or every finding was rejected as wrong/out-of-scope), the diff has converged — **stop now** with the loop's clean/verdict status.

2. **If it did make changes, what *class* were they?** Sort the round's landed findings:
   - **Substantive** — a real bug, a security hole, a broken producer/consumer contract, a data-loss or wedged-state path, a missing test for a real behavior, a crash on a *plausible* input. These justify another round.
   - **Marginal** — a guard for an input no real caller produces, a refinement of an already-correct refusal, a "could also handle X" for an exotic combination, a stylistic/defensive tweak with no concrete wrong-outcome behind it. These do **not** justify another round on their own.

3. **Decide:** only marginal findings (or none) → **converge, stop the loop**, and note in the report that it converged on diminishing returns rather than a hard cap. At least one substantive finding → run another round, then re-apply this gate after it.

When genuinely unsure whether a round was substantive or marginal, prefer **one** more round — but two consecutive only-marginal rounds is a definitive converge signal, no matter the round number.

This gate governs only whether to request another review — it never skips a finding the current round already surfaced (still gets its `finding-disposition.md` treatment), and it never overrides the user's explicit stop-mode (`--review-stop-on-*` and the ordered reviewer list in the multi-reviewer wrapper): it only decides how long a *single* reviewer keeps re-reviewing its own fixes, never whether a different reviewer the user asked for still runs. It also isn't a substitute for the loop's mechanical backstop (`MAX_ITERATIONS` / the 10-iteration guardrail) — keep that as the runaway ceiling; this gate should almost always fire first.
