## Copilot Reviewer Delta

Use this only with `github-reviewer-loop.md`, which owns the sub-agent template,
request/wait/check/fix flow, and current-`headRefOid` review gate. This file is
not a standalone loop.

Apply these values to the shared template:

- `REVIEWER_LOGIN=copilot-pull-request-reviewer[bot]`. The `[bot]` suffix is
  required by GitHub's requested-reviewers endpoint.
- `WAIT_SCHEDULE` is the schedule selected by the calling command for this Copilot
  entry. Do not infer, combine, or duplicate schedules here.

Copilot-specific rules:

- In the shared wait/check flow, a review body containing "exceeds the maximum
  number of lines" is terminal: report `too-large` and stop without re-requesting
  or retrying.
- A review body containing "Copilot encountered an error" or "unable to review
  this pull request" is not a verdict. For each retry, do not reuse that error
  review: record its submittedAt as the baseline, request again, then wait only
  for a later current-head review. Allow at most 3 error retries, then report
  `error`.
- If the request itself fails and no qualifying current-head review appears,
  report `error`, not the shared template's `not-requestable` status.
- Commit fixes as `address review (copilot): <summary>`.

Return one of `clean`, `capped`, `timeout`, `error`, `guardrail`, or
`too-large`. Definitions come from the shared template except `too-large`, which
means the PR exceeded Copilot's 20,000-line limit and is clean-equivalent for the
caller's merge gate. This sub-agent never merges the PR.
