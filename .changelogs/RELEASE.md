# Release v4.3.7

Released: 2026-11-15

## Highlights

- **Effort hints reflect reasoning per step.** Planning guidance now recommends effort based on how hard each step is to reason through, with broad mechanical changes covered by explicit checklists and verification.
- **Remove an unused project command.** Drop the project-local `/improve:review` command, whose description had drifted from the current review workflow; installed slashdo commands are unaffected.

## Changed

- Align planning instructions, dispatch guidance, and work-tracking documentation around independent model-capability and per-step effort recommendations.
- Use a mechanical forty-call-site change as an example of low effort with an enumerated checklist, reserving higher effort for difficult reasoning.

## Internal

- Remove the unused project review command and its entry in the removed-checklist reference test.

## Full Changelog

**Full Diff**: https://github.com/atomantic/slashdo/compare/v4.3.6...v4.3.7
