## Simplify-Only Mode (`--simplify-only`)

When `SIMPLIFY_ONLY=true`, the pipeline runs end to end exactly as documented (discovery → audit → plan → worktree remediation → verification → per-category PRs → CI → review loop → merge). What narrows is *what the run looks for and touches*: *refactoring, architecture, DRY, simplification, and cognitive load*, and nothing else. Security, runtime bugs, performance, stack-specific gotchas, dependency removal, test authoring, and UX are **out of scope for this run** — do not proactively audit or remediate those areas. A concrete bug encountered incidentally is recorded as deferred work in PLAN.md or the tracker under `--issues`, never fixed in this run. Keep incidental follow-ups separate from the five-category refactor results.

### Audit roster (Phase 1)

Exactly five scopes are eligible, subject to the user's path/focus filter; combine overlapping scopes and dispatch selected workers in **one parallel batch** — the Batch 1 → Batch 2 ordering exists only to feed Batch 1's findings to the Test Quality agent, which does not run here.

| # | Agent | In this mode |
|---|-------|--------------|
| 2 | Code Quality & Style | Runs, narrowed to its structural focus — the split is marked at the agent |
| 3 | DRY & YAGNI | Runs unchanged; its whole remit is in scope |
| 4 | Architecture & SOLID | Runs, narrowed to its structural focus — the split is marked at the agent |
| 10 | Structural Ambition | Always on (`--simplify-only` implies `--strict`), blocker-tier findings promoted to CRITICAL as usual |
| 11 | Cognitive Load & Readability | Runs only in this mode |

Agents **1** (Security & Secrets), **5** (Bugs, Performance & Error Handling), **6** (Stack-Specific), **7** (Dependency Freedom), **8** (Test Quality & Coverage), and **9** (UX Consistency & Responsive Layout) do **not** run. Phase 0b still records `HAS_UI` (it costs nothing and stays in the state snapshot), but it no longer gates anything in this mode.

Agents 10 and 11 overlap by design — structural reframings and reader-cost reductions often land on the same code. Phase 2's dedup resolves it: when both flag the same `file:line`, keep the **structural** finding (the larger reframing subsumes the local cleanup) and drop the cognitive-load duplicate.

### Finding gates

A refactor-only run has no bug to point at, so its findings are only as good as its filters.

Gates **1, 2, and 4** are filters and go in every audit agent's instructions; because they're idempotent, Phase 2 re-applies them during consolidation as a backstop. Gate **3 is a mutation, so it is applied exactly once, by Phase 2 alone** — audit agents report their raw assessed severity and the file and do not adjust for churn themselves. Applying it at both layers would drop a cold-file finding two tiers, silently stranding HIGH findings below the remediation cut.

**1. The deletion test (any finding that proposes a new module, helper, layer, or abstraction).** Ask: *would this concentrate complexity behind a smaller interface, or just spread it across callers?* Only the first qualifies. An extraction that leaves every call site passing the same arguments through one more hop, or that forces callers to learn a new vocabulary to do what they already did inline, fails the test — **drop the finding**. This is the guard against the classic failure mode of a DRY pass: deduplicating three incidental look-alikes into an abstraction that now has to serve three masters.

**2. Depth, not just size.** A deep module puts a lot of behavior behind a small, stable interface; a shallow one leaks its implementation, so its interface costs about as much to learn as the body costs to read. Judge a module by that ratio, not by line count alone — a 400-line module behind three obvious functions is fine, and a 40-line one requiring six parameters and knowledge of call ordering is not. Prefer findings that make an interface smaller over findings that only make a file shorter.

**3. Churn bias — refactor what people actually touch** _(Phase 2 only)_. A simplification in code nobody edits is a payoff that never gets cashed. Rank findings against `HOT_FILES` (Phase 0e): a finding in a hot file keeps its assessed severity, and a finding in a file with no commits in the churn window drops **one tier** (which pushes marginal ones to LOW, i.e. tracked but not auto-remediated). Never promote on churn alone — a hot file does not make a weak finding strong. Exception: a finding that spans many files (a canonical-helper duplication, a boundary leak) is ranked by its hottest file.

**4. Don't re-litigate settled rejections.** Before filing, check `PRIOR_REJECTIONS` (Phase 0e) and do not re-propose a reframing that has already been tried and rejected.

**This is the only place the recording rule is written** — Phases 2, 3c, and 4b point here rather than restating it. When any phase rejects a reframing (infeasible after investigation, or reverted in 4b for changing behavior), record it so the next run inherits the decision:
- **Default**: append to the `### Rejected reframings` subsection of the run's PLAN.md audit section — `- ~~{description}~~ — rejected {YYYY-MM-DD}: {one-line reason}`
- **Under `--issues`** (where PLAN.md is not written at all): file an issue titled with the reframing, labeled `{PLAN_LABEL}` **and `rejected-reframing`**, then immediately close it with the reason as a closing comment. File-then-close is required because a rejection can arise in Phase 3c or 4b from a finding that was remediated rather than deferred, so there is no existing issue to close. The extra label is what keeps Phase 0e's read bounded — without it a rejection is indistinguishable from a completed item.

Findings also inherit the standard evidence bar from the Structural Ambition agent: quoted code, and a named concrete transformation. "This could be cleaner" without a named transformation is not a finding.

### Behavior preservation (hard constraint)

Every fix in this mode must be **observably behavior-preserving**. Give each remediation agent this rule verbatim on top of the standard template:

> This is a refactor-only run. Your changes must not alter observable behavior: same return values, same side effects, same error types and messages, same public API shape. Do not fix bugs you notice, do not add features, do not change validation, do not "improve" an output format — if you find a real bug, leave the code alone and report it as a deferred finding instead. Public exports you move must keep a backward-compatible re-export at the original path.
>
> The existing test suite is the safety net, so it must keep passing **unmodified**. Mechanical updates are allowed (an import path, a renamed symbol, a moved fixture); anything beyond that — changing an assertion, relaxing an expectation, deleting a case — means your refactor changed behavior. Revert it rather than editing the test to match.

A finding whose only available fix would change behavior is **deferred**, not remediated: it goes to PLAN.md (or a tracker issue under `--issues`) per the normal disposition rules, with a one-line note that it was out of scope for a simplify-only run.

### The category set

`SIMPLIFY_CATEGORIES` is the in-scope set for the whole run, in Phase 2's short-label → slug form:

| Short label | Full category | Slug |
|---|---|---|
| Code Quality | Code Quality & Style | `code-quality` |
| DRY & YAGNI | DRY & YAGNI | `dry` |
| Architecture | Architecture & SOLID | `architecture` |
| Structural | Structural Ambition | `structural` |
| Cognitive Load | Cognitive Load & Readability | `cognitive-load` |

Every phase that enumerates categories — Phase 2's plan sections and summary table, Phase 3c's worker spawn, Phase 5's branch slugs, Phase 7's summary rows — is restricted to this set and refers to it by name. **This table is the only place the set is written down**; change it here, not at the individual phases.

Every remaining deviation is written at the phase it applies to, the same way `HAS_UI` and `STRICT_MODE` are — Phase 0e computes this mode's inputs, and Phases 2, 3c, 4, 4b, 4c, 5, and 7 each carry their own `When SIMPLIFY_ONLY=true` clause. `--simplify-only` composes with every other flag: `--scan-only` stops after the narrowed plan, `--interactive` still prompts at each gate, `--issues` still files deferred findings as issues, and the review flags drive Phase 6 as usual.
