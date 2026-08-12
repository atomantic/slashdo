# Unreleased Changes

## PR review loop
- **[issue-134] Review fixes can no longer be left behind when a PR is opened or merged** — if a reviewer's fixes are committed but never pushed, the review loop now pushes them itself, `/do:pr` pushes anything still outstanding before opening the PR, and it refuses to merge while your branch is ahead of the remote, naming the commits that would have been dropped. Previously the fixes stayed on your machine while every reviewer reported clean and CI passed against the older pushed code.

## Docs
- **[issue-135] `--issues` no longer reads like it stops the run** — `/do:simplify`'s flag list and `/do:config`'s issue-mode default now say outright that `--issues` selects where findings are *recorded* and does not suppress remediation, and point at `--scan-only --issues` for the audit-and-file run people actually reach for. Previously the name suggested a run mode, and users were surprised when `/do:simplify --issues` went on to remediate, PR, and merge.
