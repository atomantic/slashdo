# Unreleased Changes

## PR review loop
- Added a **fix regression guard** to the review loops: after applying a round's fixes and before re-review/push, the loop now scans the *fix diff itself* for the two classes that cause self-inflicted review spirals — unscoped state-clearing/restoring writes (a "restore" keyed to a whole collection instead of the one record the finding named) and side effects folded onto a hot path (an `updatedAt`/event/cache write on every tick) — and adds a focused regression test where the fix touches scoping or timestamp/side-effect logic. Wired into the local-agent, ollama, and multi-reviewer (parallel) loop bodies; it matters most in parallel mode, which does no automatic re-review (`lib/fix-regression-guard.md`).

## PR merge gate
- Added **CI flake handling** to the `/do:pr` and `/do:release` merge gates: when a required check fails during the in-session checks watch, the gate now does one conservative re-run on the *same commit* — pass-on-rerun is treated as a flake (merge proceeds, the flake is logged with its run URL), fail-again is treated as a real failure (PR left open / release merge aborted). One re-run only, required checks only, same SHA only — deliberately mechanism-only with no project-specific signature matching (`lib/ci-flake-handling.md`).
