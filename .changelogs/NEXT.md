# Unreleased Changes

## PR review loop
- `do:pr` (and `do:pr-better`) now rebase your branch onto the latest default branch before reviewers run, so reviews focus on your branch's own changes instead of flagging unrelated work that landed on the default branch since you started. Rebase conflicts stop the run and surface the conflicting files for you to resolve.
