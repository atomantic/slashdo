# Unreleased Changes

## PR review loop
- **[issue-134] Review fixes can no longer be left behind when a PR is opened or merged** — if a reviewer's fixes are committed but never pushed, the review loop now pushes them itself, and `/do:pr` refuses to open a PR or merge while your branch is ahead of the remote, naming the commits that would have been dropped. Previously the fixes stayed on your machine while every reviewer reported clean and CI passed against the older pushed code.
