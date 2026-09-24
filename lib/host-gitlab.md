## GitLab Host Verbs

The code-host verb contract for `CODE_HOST=gitlab`. It uses the same verb names,
inputs, and outputs as `host-github.md`. A caller names a verb and runs this
file's form. A failed verb stays a failure: never substitute the other host or
read empty output as success.

Inputs: `{PR_NUMBER}` is the MR **iid**. Run every call inside the checkout:
`glab` resolves the host and project from `origin`, and `projects/:id` expands
to the current project. `glab api` has no `--jq` flag. Capture each call first
and check its exit status, then parse with the standalone `jq`. Never pipe
`glab api` straight into `jq`: a pipeline reports jq's status, and jq exits 0
on empty input, so a failed call would look like "no reviews". These verbs need
`jq`. If `command -v jq` fails, report `error` and never guess.

### `cr-state` — head, reviews, and threads

GitLab has no review object with a reviewed commit. This verb builds one per
reviewed commit from the reviewer's notes. A diff note reviewed its own
`position.head_sha`. Any other note reviewed the MR version that was current
when the note was written. An approval or request for changes comes from the
matching system note, so it has a timestamp and a commit.

```bash
CR_DIR="$(mktemp -d)" && trap 'rm -rf "$CR_DIR"' EXIT
glab api "projects/:id/merge_requests/{PR_NUMBER}" > "$CR_DIR/mr.json" \
  && glab api "projects/:id/merge_requests/{PR_NUMBER}/versions" > "$CR_DIR/versions.json" \
  && glab api --paginate "projects/:id/merge_requests/{PR_NUMBER}/discussions?per_page=100" > "$CR_DIR/discussions.json" \
  && glab api "projects/:id/merge_requests/{PR_NUMBER}/approvals" > "$CR_DIR/approvals.json" \
  || { echo "cr-state: glab api failed for MR !{PR_NUMBER}"; exit 1; }
CR_STATE_FILTER='
def ver($vs; $t): first(($vs[] | select(.created_at <= $t) | .head_commit_sha), $vs[-1].head_commit_sha);
$mr[0] as $m | $v[0] as $vs | ($d | add // []) as $ds
| ([$a[0].approved_by[]?.user.username | ascii_downcase] | index($login) != null) as $approved
| {
    head: $m.sha,
    reviews: ([ $ds[].notes[]
        | select((.author.username | ascii_downcase) == $login)
        | { at: .created_at,
            commit: (.position.head_sha // ver($vs; .created_at)),
            kind: (if .system != true then "COMMENTED"
                   elif (.body | test("^approved this merge request"; "i")) then "APPROVED"
                   elif (.body | test("^requested changes"; "i")) then "CHANGES_REQUESTED"
                   else null end),
            body: (if .system != true and .position == null then .body else "" end) }
        | select(.kind != null) ]
      | group_by(.commit)
      | map(select($approved or any(.[]; .kind != "APPROVED"))
        | { commit: .[0].commit,
            submittedAt: (map(.at) | max),
            state: (if any(.[]; .kind == "CHANGES_REQUESTED") then "CHANGES_REQUESTED"
                    elif $approved and any(.[]; .kind == "APPROVED") then "APPROVED"
                    else "COMMENTED" end),
            body: ([.[].body | select(. != "")] | join("\n\n")) })),
    threads: [ $ds[] | select(.notes[0].resolvable == true)
      | { id, author: .notes[0].author.username,
          resolved: ([.notes[] | select(.resolvable) | .resolved] | all),
          path: .notes[0].position.new_path, line: .notes[0].position.new_line,
          body: .notes[0].body,
          comments: [.notes[] | select(.system != true) | { body, author: .author.username }] } ],
    pipeline: ($m.head_pipeline | if . == null then null else { id, sha, status } end)
  }'
CR_STATE="$(jq -n --arg login "$(printf '%s' '{REVIEWER_LOGIN}' | tr A-Z a-z)" \
  --slurpfile mr "$CR_DIR/mr.json" --slurpfile v "$CR_DIR/versions.json" \
  --slurpfile d "$CR_DIR/discussions.json" --slurpfile a "$CR_DIR/approvals.json" \
  "$CR_STATE_FILTER")" && printf '%s' "$CR_STATE" | jq -e '.head | strings | length > 0' >/dev/null \
  || { echo "cr-state: could not parse MR !{PR_NUMBER}"; exit 1; }
```

- Head SHA: `.head`.
- Reviews: `.reviews[]`. The reviewed commit is `.commit`, and `.state` is one
  of APPROVED, COMMENTED, CHANGES_REQUESTED. GitLab has no DISMISSED state. A
  later unapproval drops an approval-only review.
- Threads: `.threads[]`, from resolvable discussions. The thread ID is the
  discussion `id`. `.comments[]` is the whole discussion in order (each
  non-system note's `body` and `author`), so a caller also sees the replies.
- Head pipeline: `.pipeline` (`id`, `sha`, `status`), or `null` before the MR
  has one.
- A caller that reads only threads (e.g. `/do:rpr`) passes an empty
  `{REVIEWER_LOGIN}`. `.reviews` is then empty, and `.threads` still lists
  every author's discussions.
- **Settle rule:** GitLab publishes an unbatched comment as soon as it is
  written. A review counts as submitted only after two consecutive polls return
  the same `submittedAt` for it. Until then, keep polling.

### `request-review` — ask `{REVIEWER_LOGIN}` to review

```bash
glab mr update {PR_NUMBER} --reviewer "+{REVIEWER_LOGIN}"
```

The `+` adds the reviewer and keeps the existing ones. When the login is
already in the MR's `.reviewers`, that update changes nothing. Re-request the
review instead, using the literal project path (`glab api "projects/:id"` →
`.path_with_namespace`) and the reviewer's numeric `.id` from `.reviewers`:

```bash
glab api graphql -f query='mutation { mergeRequestReviewerRereview(input: {projectPath: "{PROJECT_PATH}", iid: "{PR_NUMBER}", userId: "gid://gitlab/User/{REVIEWER_ID}"}) { errors } }'
```

A non-empty `errors` means the request failed.

### `reply-thread` — reply in discussion `{THREAD_ID}`

```bash
glab api --method POST "projects/:id/merge_requests/{PR_NUMBER}/discussions/{THREAD_ID}/notes" -f body="{BODY}"
```

### `resolve-thread` — resolve discussion `{THREAD_ID}`

```bash
glab api --method PUT "projects/:id/merge_requests/{PR_NUMBER}/discussions/{THREAD_ID}" -F resolved=true
```

### `post-review` — summary plus inline comments on the head commit

Post the summary with `glab mr note {PR_NUMBER} -m "<summary>"`. Post each
inline comment as a new diff discussion anchored to the MR's `.diff_refs`
(`base_sha`, `start_sha`, `head_sha` from the `cr-state` MR read):

```bash
jq -n --arg body "<comment>" --arg path "<file>" --argjson line <line> \
  --arg base "<base_sha>" --arg start "<start_sha>" --arg head "<head_sha>" \
  '{body: $body, position: {position_type: "text", base_sha: $base, start_sha: $start, head_sha: $head, old_path: $path, new_path: $path, new_line: $line}}' \
  | glab api --method POST "projects/:id/merge_requests/{PR_NUMBER}/discussions" -H "Content-Type: application/json" --input -
```

The REST API has no request-changes event. Say "changes requested" in the
summary instead. A `400` about the position means the line is outside the diff
or the head moved. Re-read `cr-state` and retry.

### `ci-status` — the head pipeline

`glab ci status --wait --branch {BRANCH_NAME}` blocks until the pipeline
finishes. For a single read, use `.pipeline.status` from `cr-state` (`success`,
`failed`, `running`, `pending`, `canceled`, `skipped`, or `manual`), and trust
it only when `.pipeline.sha` is the head you pushed. GitLab has no separate list
of required checks.

### `merge`

Merge only through `merge-gate.md` (its GitLab section). It owns the
merge-when-pipeline-succeeds path and the merged read-back.

### Targeting an MR outside the checkout

A caller that names an MR by URL (`/do:review <MR URL>`) may run outside that
project's checkout, where `:id` and the default host point at the wrong
project. That caller supplies `{GL_HOST}`, `{GL_PROJECT_ENC}` (the URL-encoded
project path, e.g. `group%2Fsub%2Fproject`), and `{GL_REPO_URL}` (the project's
web URL). Run each verb above with two substitutions:

- every `glab api` call gains `--hostname {GL_HOST}`, and `projects/:id`
  becomes `projects/{GL_PROJECT_ENC}`;
- every `glab mr` / `glab ci` call gains `-R "{GL_REPO_URL}"`.

Nothing else changes: the capture rule and the outputs stay the same.

### Login grammar

`^[A-Za-z0-9_]([A-Za-z0-9_.-]*[A-Za-z0-9_-])?$`: letters, digits, `_`, `-`, and
`.`, not starting with `-` or `.`, not ending with `.`, and not ending with
`.git` or `.atom`. There is no `[bot]` suffix, because GitLab bots are ordinary
usernames. Usernames are case-insensitive.
