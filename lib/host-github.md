## GitHub Host Verbs

The code-host verb contract for `CODE_HOST=github`. `host-gitlab.md` defines
the same verbs, with the same inputs and outputs, for GitLab. A caller (the
shared `host-reviewer-loop.md`, or a command step) names a verb and runs the
selected host's form. It never re-inlines a `gh`/`glab` branch. A failed verb
stays a failure: never substitute the other host or read empty output as
success.

Inputs: `{PR_NUMBER}` (the PR number), `{OWNER}`/`{REPO}`, and `{GH_HOST}`.
Pass `--hostname {GH_HOST}` on every `gh api` call and omit the flag when it is
empty (see `gh-host.md`). GraphQL calls inline literal values in JSON on stdin
and pass `--input -`; never put shell-expandable `$variables` in a query string.

### `cr-state` — head, reviews, and threads

```bash
echo '{"query":"{ repository(owner: \"{OWNER}\", name: \"{REPO}\") { pullRequest(number: {PR_NUMBER}) { headRefOid reviews(last: 20) { totalCount nodes { state body author { login } submittedAt commit { oid } } } reviewThreads(first: 100) { nodes { id isResolved comments(first: 10) { nodes { body path line author { login } } } } } } } }"}' | gh api --hostname {GH_HOST} graphql --input -
```

- Head SHA: `headRefOid`.
- Reviews: each node is one review. Its reviewed commit is `commit.oid`, and
  `state` is already one of APPROVED, COMMENTED, CHANGES_REQUESTED, DISMISSED.
- Threads: `reviewThreads.nodes`. The thread ID is `id`, the resolved flag is
  `isResolved`, and the author is the first comment's `author.login`.
  `comments.nodes` is the thread's conversation in order (`body`, `path`,
  `line`, `author.login`).

### `request-review` — ask `{REVIEWER_LOGIN}` to review

```bash
gh api --hostname {GH_HOST} repos/{OWNER}/{REPO}/pulls/{PR_NUMBER}/requested_reviewers \
  -f 'reviewers[]={REVIEWER_LOGIN}'
```

Requesting again re-requests a reviewer who already reviewed. App logins keep
their `[bot]` suffix.

### `reply-thread` — reply in thread `{THREAD_ID}`

```bash
echo '{"query":"mutation { addPullRequestReviewThreadReply(input: {pullRequestReviewThreadId: \"{THREAD_ID}\", body: \"{BODY}\"}) { comment { id } } }"}' | gh api --hostname {GH_HOST} graphql --input -
```

`{BODY}` must be JSON-escaped, because it is inlined into the query string.

### `resolve-thread` — resolve thread `{THREAD_ID}`

```bash
echo '{"query":"mutation { resolveReviewThread(input: {threadId: \"{THREAD_ID}\"}) { thread { id isResolved } } }"}' | gh api --hostname {GH_HOST} graphql --input -
```

### `post-review` — summary plus inline comments on the head commit

Write `{"commit_id": "<head SHA>", "event": "COMMENT" | "REQUEST_CHANGES", "body": "<summary>", "comments": [{"path", "line", "side": "RIGHT", "body"}]}`
to `{PAYLOAD_FILE}`, then run:

```bash
gh api --hostname {GH_HOST} repos/{OWNER}/{REPO}/pulls/{PR_NUMBER}/reviews --method POST --input {PAYLOAD_FILE}
```

A `422` usually means a comment's line is outside the diff or the head moved.
Re-read `cr-state` and retry.

### `ci-status` — required checks on the head

`gh pr checks {PR_NUMBER} --required --watch --fail-fast` blocks until the
checks pass (exit 0) or one fails. When no required checks are reported, it also
exits non-zero. Treat that case as vacuously green, as `merge-gate.md` does.

### `merge`

Merge only through `merge-gate.md` (its GitHub section). It owns method
resolution, queueing, and the merged read-back.

### Login grammar

`^[A-Za-z0-9][A-Za-z0-9-]*(\[bot\])?$`: letters, digits, and `-`, plus the
optional `[bot]` suffix for an App. Logins are case-insensitive.
