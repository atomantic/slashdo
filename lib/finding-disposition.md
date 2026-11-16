# Finding Disposition

When a review surfaces a finding (from `/do:rpr`, `/do:review`, a Copilot round, or a self-review pass), the default is to fix it now, in the current PR/branch. A review exists to make the diff land clean, and fixing while the context is fresh is far cheaper than retrofitting from a backlog.

Every finding gets exactly one of three dispositions:

1. **Fix it now (default).** The finding is real and lives in a file touched by the current PR/branch, or in a direct caller/callee whose contract this PR changed. This covers the overwhelming majority of findings: bugs, missing guards, contract mismatches, misleading names, dead code, DRY violations, and missing tests for changed paths. A medium-effort but self-contained fix still belongs here; "more than a one-liner" is not a reason to defer.
2. **Reply, don't fix — only when it isn't a real issue.** Explain concretely why (the code already handles it, the reviewer misread the flow, it conflicts with an explicit project convention). Evaluate every finding on its merits; never ignore one silently.
3. **Defer to the tracker — when the fix is outside the PR's blast radius or genuinely can't land here.** A finding qualifies when it is a pre-existing issue in an untouched, unrelated file/subsystem, when it is large or architectural (touches many subsystems, needs a design decision), or when it carries real risk of breaking unrelated behavior or causing sibling-branch merge conflicts. File it as a labeled tracker issue with a one-line rationale for why it was deferred — see `~/.claude/lib/plan-issue-setup.md` for host/label setup (and the no-tracker rule) and `~/.claude/lib/plan-issue-filing.md` for the create/dedup rules.
