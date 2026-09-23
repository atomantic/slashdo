# Finding Disposition

When a review surfaces a finding (from `/do:rpr`, `/do:review`, a Copilot round, or a self-review pass), the **default disposition is to fix it now, in the current PR/branch.** A review exists to make the diff land clean — punting fixable findings defeats that. Catching it now, while the context is fresh, is far cheaper than retrofitting it later from a backlog.

Every finding gets exactly one of three dispositions:

1. **Fix it now (default).** The finding is real and the fix fits the current change's blast radius — apply it in this branch. This covers the overwhelming majority of findings: bugs, missing guards, contract mismatches, misleading names, dead code, DRY violations, and missing tests for changed paths.
2. **Reply, don't fix — only when it isn't a real issue.** Explain concretely why (the code already handles it, the reviewer misread the flow, it conflicts with an explicit project convention). Never dismiss with "out of scope" or "not modified in this PR" — evaluate every finding on its merits.
3. **Defer to the tracker — only when the fix genuinely can't land here.** A finding qualifies for deferral ONLY when it is large or architectural (touches many subsystems, needs a design decision) OR carries real risk of breaking unrelated behavior if rushed into this change. When you defer, file it as a labeled tracker issue with a one-line rationale for *why* it couldn't be fixed now — see `~/.claude/lib/plan-issue-setup.md` for host/label setup (and the no-tracker rule) and `~/.claude/lib/plan-issue-filing.md` for the create/dedup rules.

## Don't use the backlog as a dumping ground

The failure mode this guards against: judging a finding "bigger than a one-liner" and filing it instead of fixing it. **If you *could* fix it now within the current change, you must** — the tracker is for work that genuinely cannot land in this PR.

Before deferring, ask: **"Is this actually large or risky — or just more than a trivial edit?"** Only the former defers. A medium-effort but self-contained fix is still a fix-now. When in doubt, fix it now; deferral is the exception you justify, not the default you reach for.
