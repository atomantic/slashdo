# Review Convergence Gate

A review loop should stop when continuing stops being worth it — **not** when it hits a round counter. This gate is the judgment call every review round makes *before* spending another review request: given what the last round actually turned up, is another pass likely to find something that matters, or would it just mine ever-more-marginal edge cases?

The failure mode this prevents: a reviewer (especially a capable local CLI like `codex`) that, round after round, invents a slightly-more-exotic input shape the code doesn't perfectly handle — an unusual file layout, a rare platform+flag combination, a theoretical race no real caller hits — and the loop keeps applying fixes for each because "the reviewer found something." Real signal decays fast across rounds; past the first round or two, a genuinely-clean diff produces a long tail of *hypotheticals dressed as findings*. Ten rounds of that is churn, not quality — and it burns a review request (and a model's time) on each.

This is the review-request analogue of `fix-regression-guard.md`: that guard stops the fixes from spiraling; **this gate stops the *rounds* from spiraling.** There is deliberately **no hard round cap here** — the inner loops keep their own mechanical safety ceiling (e.g. `MAX_ITERATIONS`, the copilot 10-iteration guardrail) as a backstop against a runaway, but this gate is meant to converge *well before* that ceiling in the common case. A tighter hard limit would wrongly cut off the rare diff that legitimately needs five rounds; a judgment gate converges on edge cases while still letting real findings run.

## When to run it

Run this gate at the **top of each re-loop decision** — after a round's findings are applied, verified, and pushed, and *before* requesting the next review:

- `local-agent-review-loop.md` step 6 (Re-loop or stop)
- `ollama-review-loop.md` step 6 (Re-loop or stop)
- `copilot-review-loop.md` — before re-requesting a review in the fix-and-loop cycle
- `github-reviewer-loop.md` — before re-requesting from `@<login>`
- `multi-reviewer-loop.md` — as an input to the per-reviewer re-review recursion (it does **not** override the cross-reviewer stop-mode, which is the user's explicit choice; it only governs whether *one* reviewer keeps re-reviewing its own fixes)

The gate never fires on **round 1**: the first review of a diff is always worth running in full. It governs only whether to start round N+1 (N ≥ 1).

## The judgment

Before starting the next round, look back at the round that just completed and answer honestly:

1. **What did the last round actually change?** If it made **zero commits** (the reviewer reported clean, or every finding was rejected as wrong/out-of-scope), the diff has converged — **stop now** with the loop's clean/verdict status. Re-reviewing an unchanged tree only invites the reviewer to reach for something new to say.

2. **If it did make changes, what *class* were they?** Sort the round's landed findings:
   - **Substantive** — a real bug, a security hole, a broken producer/consumer contract, a data-loss or wedged-state path, a missing test for a real behavior, a crash on a *plausible* input. These justify another round: a substantive fix can introduce an adjacent substantive problem, which the next round should catch.
   - **Marginal** — a guard for an input no real caller produces, a refinement of an already-correct refusal, a "could also handle X" for an exotic file/platform/flag combination, a stylistic or defensive tweak with no concrete wrong-outcome behind it. These do **not** justify another round on their own.

3. **Decide:**
   - If the last round landed **only marginal findings** (or none), **converge — stop the loop.** Report the loop's normal clean/verdict status; note in the summary that the loop converged on diminishing returns rather than a hard cap.
   - If the last round landed **at least one substantive finding**, run another round — a substantive change earns re-review. Then re-apply this gate after it.

When you are genuinely unsure whether a round was substantive or marginal, prefer **one** more round — but apply the gate more strictly next time: two consecutive rounds of only-marginal findings is a definitive converge signal, no matter the round number.

## What this is NOT

- **Not a hard round cap.** It's a per-round judgment. A diff that keeps producing substantive findings keeps earning rounds (up to the inner loop's mechanical backstop). A diff that's down to hypotheticals stops after the round that revealed that — whether that's round 2 or round 4.
- **Not a reason to dismiss a real finding.** Convergence is about *whether to request another review*, never about skipping a finding the current round already surfaced. Every surfaced finding still gets its `finding-disposition.md` treatment (fix-now / reply / defer). The gate only decides whether to go *looking* for more.
- **Not an override of the user's stop-mode.** In the multi-reviewer wrapper, `--review-stop-on-*` and the ordered reviewer list are the user's explicit choices about *which reviewers* run. This gate governs only how long a *single* reviewer keeps re-reviewing its own fixes; it never skips a different reviewer the user asked for.
- **Not a substitute for the mechanical backstop.** Keep `MAX_ITERATIONS` / the 10-iteration guardrail as the runaway ceiling. This gate should almost always fire first; the ceiling is the safety net for when judgment somehow doesn't converge.
