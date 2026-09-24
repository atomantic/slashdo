## GitHub Host Verbs

The code-host verb contract for `CODE_HOST=github`. `host-gitlab.md` defines
the same verbs, with the same inputs and outputs, for GitLab. A caller (the
shared `host-reviewer-loop.md`, or a command step) names a verb and runs the
selected host's form. It never re-inlines a `gh`/`glab` branch. A failed verb
stays a failure: never substitute the other host or read empty output as
success.

Inputs: `{PR_NUMBER}` (the PR number), `{OWNER}`/`{REPO}`, and `{GH_HOST}`.
Pass `--hostname {GH_HOST}` on every `gh api` call and omit the flag when it is
empty (see `gh-host.md`). Keep query text static. Pass dynamic GraphQL values as
variables; put free-form text into a JSON payload with `jq --arg`, then pass that
file with `--input`. Never interpolate review text into shell source or a query.

### `cr-state` — head, reviews, and threads

```bash
QUERY='query($owner:String!, $repo:String!, $number:Int!, $reviewCursor:String, $threadCursor:String) { repository(owner:$owner, name:$repo) { pullRequest(number:$number) { headRefOid reviews(first:100, after:$reviewCursor) { nodes { state body author { login } submittedAt commit { oid } } pageInfo { hasNextPage endCursor } } reviewThreads(first:100, after:$threadCursor) { nodes { id isResolved comments(first:100) { nodes { body path line author { login } } pageInfo { hasNextPage } } } pageInfo { hasNextPage endCursor } } } } }'
REVIEW_CURSOR=""; THREAD_CURSOR=""; THREADS='[]'; HEAD_SHA=""; REVIEWS='[]'
while :; do
  GRAPHQL_ARGS=(-f query="$QUERY" -f owner="{OWNER}" -f repo="{REPO}" -F number="{PR_NUMBER}")
  [ -z "$REVIEW_CURSOR" ] || GRAPHQL_ARGS+=(-f reviewCursor="$REVIEW_CURSOR")
  [ -z "$THREAD_CURSOR" ] || GRAPHQL_ARGS+=(-f threadCursor="$THREAD_CURSOR")
  RESPONSE="$(gh api --hostname {GH_HOST} graphql "${GRAPHQL_ARGS[@]}")" || { echo "cr-state: GitHub query failed"; exit 1; }
  printf '%s' "$RESPONSE" | jq -e '((.errors // []) | length == 0) and (.data.repository.pullRequest != null) and (.data.repository.pullRequest.reviews.pageInfo.hasNextPage | type == "boolean") and (.data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage | type == "boolean") and all(.data.repository.pullRequest.reviewThreads.nodes[]; .comments.pageInfo.hasNextPage != true)' >/dev/null || { echo "cr-state: GraphQL response was incomplete"; exit 1; }
  if [ -z "$HEAD_SHA" ]; then
    HEAD_SHA="$(printf '%s' "$RESPONSE" | jq -er '.data.repository.pullRequest.headRefOid')" || exit 1
  fi
  REVIEW_PAGE="$(printf '%s' "$RESPONSE" | jq -c '.data.repository.pullRequest.reviews.nodes')" || exit 1
  REVIEWS="$(jq -cn --argjson all "$REVIEWS" --argjson page "$REVIEW_PAGE" '$all + $page')" || exit 1
  PAGE="$(printf '%s' "$RESPONSE" | jq -c '.data.repository.pullRequest.reviewThreads.nodes')" || exit 1
  THREADS="$(jq -cn --argjson all "$THREADS" --argjson page "$PAGE" '$all + $page')" || exit 1
  REVIEW_MORE="$(printf '%s' "$RESPONSE" | jq -r '.data.repository.pullRequest.reviews.pageInfo.hasNextPage')"
  THREAD_MORE="$(printf '%s' "$RESPONSE" | jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage')"
  REVIEW_CURSOR="$(printf '%s' "$RESPONSE" | jq -r '.data.repository.pullRequest.reviews.pageInfo.endCursor // ""')" || exit 1
  THREAD_CURSOR="$(printf '%s' "$RESPONSE" | jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.endCursor // ""')" || exit 1
  if [ "$REVIEW_MORE" != true ] && [ "$THREAD_MORE" != true ]; then break; fi
done
jq -n --arg head "$HEAD_SHA" --argjson reviews "$REVIEWS" --argjson threads "$THREADS" \
  '{head:$head, reviews:$reviews, threads:$threads}'
```

- Head SHA: `.head`.
- Reviews: `.reviews[]`. The verb paginates every review, not just the latest 100.
  The reviewed commit is `.commit.oid`, and `state` is one of APPROVED, COMMENTED,
  CHANGES_REQUESTED, DISMISSED.
- Threads: `.threads[]`. The thread ID is `id`, the resolved flag is
  `isResolved`, and the author is the first comment's `author.login`.
  `comments.nodes` is the thread's conversation in order (`body`, `path`,
  `line`, `author.login`). The loop fetches every thread page and fails closed
  if any thread's comment page exceeds the 100 comments requested.

### `request-review` — ask `{REVIEWER_LOGIN}` to review

```bash
gh api --hostname {GH_HOST} repos/{OWNER}/{REPO}/pulls/{PR_NUMBER}/requested_reviewers \
  -f 'reviewers[]={REVIEWER_LOGIN}'
```

Requesting again re-requests a reviewer who already reviewed. App logins keep
their `[bot]` suffix.

### `reply-thread` — reply in thread `{THREAD_ID}`

```bash
PAYLOAD_FILE="$(mktemp)" || exit 1
jq -n --arg threadId "{THREAD_ID}" --arg body "$BODY" \
  '{query:"mutation($threadId:ID!, $body:String!) { addPullRequestReviewThreadReply(input: {pullRequestReviewThreadId:$threadId, body:$body}) { comment { id } } }", variables:{threadId:$threadId, body:$body}}' > "$PAYLOAD_FILE" || { rm -f "$PAYLOAD_FILE"; exit 1; }
gh api --hostname {GH_HOST} graphql --input "$PAYLOAD_FILE"
RESULT=$?; rm -f "$PAYLOAD_FILE"; [ "$RESULT" -eq 0 ]
```

Set `BODY` from the comment text through a single-quoted heredoc with a unique
delimiter. `jq --arg` handles its JSON encoding; do not place it in shell source.

### `resolve-thread` — resolve thread `{THREAD_ID}`

```bash
PAYLOAD_FILE="$(mktemp)" || exit 1
jq -n --arg threadId "{THREAD_ID}" \
  '{query:"mutation($threadId:ID!) { resolveReviewThread(input: {threadId:$threadId}) { thread { id isResolved } } }", variables:{threadId:$threadId}}' > "$PAYLOAD_FILE" || { rm -f "$PAYLOAD_FILE"; exit 1; }
gh api --hostname {GH_HOST} graphql --input "$PAYLOAD_FILE"
RESULT=$?; rm -f "$PAYLOAD_FILE"; [ "$RESULT" -eq 0 ]
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
