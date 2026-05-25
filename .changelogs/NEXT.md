# Unreleased Changes

## Added

- `lib/finding-disposition.md`: shared guidance for PR-fixing review flows. Defines three dispositions for any review finding (fix-now / reply / defer), makes **fix-in-this-PR the default**, and restricts PLAN.md deferral to findings that are genuinely large/architectural or too risky to land in the current change — explicitly guarding against using PLAN.md as a dumping ground for fixable work. Loaded by `/do:rpr` and `/do:review`.

## Changed

- `/do:rpr`: added a Notes bullet directing the agent to fix findings in the current PR and defer to PLAN.md only when a fix is genuinely large/risky.
- `/do:review`: load the finding-disposition guidance in the local-mode "Fix Issues" phase and tie the IMPROVEMENT-fix step to it.

## Fixed

## Removed
