# Finding Disposition

When a review surfaces a finding (from `/do:rpr`, `/do:review`, a Copilot round, or a self-review pass), the **default disposition is to fix it now, in the current PR/branch.** A review exists to make the diff land clean — punting fixable findings defeats that. Catching it now, while the context is fresh, is far cheaper than retrofitting it later from a backlog.

Every finding gets exactly one of three dispositions:

1. **Fix it now (default).** The finding is real and the fix fits the current change's blast radius — apply it in this branch. This covers the overwhelming majority of findings: bugs, missing guards, contract mismatches, misleading names, dead code, DRY violations, and missing tests for changed paths.
2. **Reply, don't fix — only when it isn't a real issue.** Explain concretely why (the code already handles it, the reviewer misread the flow, it conflicts with an explicit project convention). Never dismiss with "out of scope" or "not modified in this PR" — evaluate every finding on its merits.
3. **Defer to the plan — only when the fix genuinely can't land here.** A finding qualifies for deferral ONLY when it is large or architectural (touches many subsystems, needs a design decision) OR carries real risk of breaking unrelated behavior if rushed into this change. When you defer, record it as a plan item with a one-line rationale for *why* it couldn't be fixed now. By default that means appending a `- [ ]` item to PLAN.md with a unique `[<slug>]` ID (per `~/.claude/lib/plan-id-format.md`). **If `ISSUE_MODE` resolved to true (the `--issues` flag, or a saved `issues=true` default with no `--no-issues` override), file the deferred finding as a labeled tracker issue instead** — see `~/.claude/lib/plan-issue-mode.md`.

## Don't use PLAN.md as a dumping ground

The failure mode this guards against: seeing a finding, judging it "bigger than a one-liner," and parking it in PLAN.md instead of fixing it. **If you *could* fix it now within the current change, you must** — PLAN.md is for work that genuinely cannot land in this PR, not for everything you'd rather not do this session.

Before deferring, ask: **"Is this actually large or risky — or just more than a trivial edit?"** Only the former defers. A medium-effort but self-contained fix is still a fix-now. When in doubt, fix it now; deferral is the exception you justify, not the default you reach for.
