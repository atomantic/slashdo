# Unreleased Changes

## Added

- **`do:review` accepts a GitHub PR URL and posts inline review comments with code suggestions.** When `$ARGUMENTS` contains a GitHub PR reference (any URL with `github` + `/pull/N`, including GHES hosts, plus `owner/repo#N` shorthand), `do:review` switches to PR mode: fetches the PR diff via `gh pr diff`, downloads each changed file at `headRefOid`, builds a commentable-lines map from the diff hunks, and dispatches the existing review agents against the remote content. Findings get packaged as a single GitHub PR review via `POST /repos/{owner}/{repo}/pulls/{n}/reviews` — in-diff findings become inline comments with ```` ```suggestion ```` blocks (the same format Copilot uses), out-of-diff findings go into the review summary body. Picks `REQUEST_CHANGES` when CRITICAL findings exist on a non-self PR, `COMMENT` otherwise; never auto-`APPROVE`. Local "Fix Issues" / "Convention Encoding" / "PR Comment Policy" phases are skipped in PR mode since the deliverable is the published review, not local edits.
- **`--strict` / `--nuclear` flag for `do:review`, `do:better`, and `do:pr-better`.** Opt-in structural-ambition lens that looks for "code judo" simplifications the existing runtime/security/contract agents miss. Adds a 6th agent to `do:review` and a 9th agent to `do:better` (Test Quality stays at #8 so existing references don't shift). Flags presumptive blockers: file pushed past 1000 lines, new ad-hoc conditional bolted onto an unrelated flow, thin wrappers / identity abstractions, feature logic leaking into shared modules, bespoke duplicates of canonical helpers, and cast-heavy / `any`-heavy boundaries. In `do:better`, blocker-tier findings are promoted to CRITICAL and remediated under a new `structural` PR category. New `lib/review-structural-ambition.md` defines the agent prompt with concrete review phrasing; new "Structural ambition" subsection in `lib/code-review-checklist.md` flows the same lens into `do:better` Phase 4b internal review and `do:pr` review gates.

## Changed

## Fixed

## Removed
