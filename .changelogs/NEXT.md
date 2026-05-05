# Unreleased Changes

## Added

## Changed

- **`do:rpr`: stop review loop when findings are only nitpicks.** Step 8 now evaluates whether another Copilot review round is worth requesting before looping. If all findings from the last round were trivial (style preferences, naming suggestions, "consider..." language, or repeats of already-dismissed feedback) with no correctness/security/logic issues and fewer than 3 actual code changes made, the loop exits with a message and proceeds to merge. Substantive findings (logic bugs, security issues, missing guards, contract violations) still trigger another round.
- **`do:fpr`: don't block PR on pure style nitpicks.** The local code review gate now includes a worthiness check — findings that touch correctness, security, or logic require fixes before opening the PR, but if ALL findings are style/naming nitpicks, proceed without blocking and note them briefly in the PR description.

## Fixed

## Removed
