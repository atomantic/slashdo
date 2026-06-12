# Unreleased Changes

## Added

- `/do:next`: new command that **consumes** the plan queue — the counterpart to `/do:replan`, `/do:better`, and `/do:depfree`, which populate it. It claims the next unclaimed `- [ ]` PLAN.md item by its slug ID (or, with `--issues`, the next open tracker issue filed by the repo creator), works it in an isolated sibling worktree (`../next-<slug>` on branch `next/<slug>`), records completion + changelog, ships a reviewed PR via `/do:pr`, merges, and cleans up. Picks the first item not "in flight" (no matching branch/PR segment); issues mode adds a cross-machine claim by assigning the issue to `@me`. When there's no PLAN.md — or PLAN.md is the "roadmap lives in the tracker" stub that `/do:replan --issues` leaves behind — a bare `/do:next` auto-detects that the repo is issue-tracked and continues in issue mode without needing the flag. Supports `<slug>`/`#<issue>` for out-of-order cherry-picking, `--plan` for an interactive plan-mode session before implementing, `--issues`/`--issues-label`, and passes the `--review-with`/`--no-review` review flags straight through to `/do:pr`. Reuses the existing `lib/plan-id-format.md` and `lib/plan-issue-mode.md` rather than adding new machinery.

## Changed

## Fixed

## Removed
