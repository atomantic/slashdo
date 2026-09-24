# `/do:simplify` internals

Expands on the [Refactor-only](../README.md#refactor-only-dosimplify) section of the README: which audit agents run and the gates that keep a refactor pass honest.

## Audit agents

Five audit agents run instead of the eight-to-ten in a full `/do:better` pass: Code Quality and Architecture & SOLID (each narrowed to its structural focus, dropping the runtime and API-contract halves), DRY & YAGNI, Structural Ambition (`--strict` is implied), and a Cognitive Load & Readability agent that runs only in this mode — mixed abstraction levels in one function, flag arguments, names that lie, comments standing in for a rename, action at a distance, conditional ladders a lookup table would collapse. Size thresholds (god files, over-long functions, nesting depth) stay with the architecture agent, so the two never double-report the same site.

## The four scoping gates

1. **The deletion test** — a proposed abstraction must concentrate complexity behind a smaller interface, not spread it across callers. This is the guard against a DRY pass merging three incidental look-alikes into one abstraction serving three masters.
2. **Depth over size** — judge a module by how much behavior sits behind how small an interface, not by line count.
3. **Churn bias** — findings are ranked against the files people actually edit, and a cleanup in dormant code drops a severity tier. A refactor nobody cashes in isn't worth a PR.
4. **No re-litigating rejections** — reframings earlier runs tried and rejected are recorded in the tracker and fed back in, so each run starts where the last one stopped.

## The behavior-preservation contract

Every fix must be observably behavior-preserving, and the existing test suite must keep passing *unmodified* as the proof. A changed assertion means the refactor moved behavior — it gets reverted, not accommodated. Findings that can only be fixed by changing behavior are deferred to the tracker instead of applied. Test enhancement is the one phase that's skipped; everything else runs as usual.
