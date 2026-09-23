# GitLab MR mode body (`/do:review`)

Loaded only when `PR_MODE=true` and the reference is a GitLab merge request
(Parse Arguments already chose the host). It is the GitLab counterpart of `review-pr-mode.md`: same
phases, same dispositions, same `/tmp/do-review-pr-{PR_NUM}*` scratch paths
(`{PR_NUM}` holds the MR **iid**). Do not use the local working tree as the
source of truth; review the MR as published on GitLab.

**The MR URL picks the target, never `origin`.** The MR can live on another
GitLab host or project than the checkout, so every call below names the host and
project explicitly. `glab api` has no `--jq` flag: capture each call to a file,
check its exit status, then parse with the standalone `jq` (see
`host-gitlab.md`). A failed call is a failure, never an empty MR.

## Parse the MR reference

`{token}` goes inside single quotes, so abort with the parse error below
before substituting it if it contains a `'`, a backslash, or whitespace. No MR
reference contains any of them.

```bash
command -v glab >/dev/null 2>&1 && command -v jq >/dev/null 2>&1 \
  || { echo "/do:review needs glab and jq to review a GitLab merge request."; exit 1; }
MR_REF='{token}'
case "$MR_REF" in
  */-/merge_requests/*) MR_PREFIX="${MR_REF%%/-/merge_requests/*}"; MR_REST="${MR_REF#*/-/merge_requests/}" ;;
  */merge_requests/*)   MR_PREFIX="${MR_REF%%/merge_requests/*}";   MR_REST="${MR_REF#*/merge_requests/}" ;;
esac
GL_SCHEME="${MR_PREFIX%%://*}"; MR_HOSTPATH="${MR_PREFIX#*://}"
GL_HOST="${MR_HOSTPATH%%/*}"; GL_PROJECT="${MR_HOSTPATH#*/}"
PR_NUM="${MR_REST%%[!0-9]*}"
case "$GL_SCHEME" in http|https) ;; *) GL_SCHEME= ;; esac
if [ -z "$GL_SCHEME" ] || [ -z "$GL_HOST" ] || [ -z "$PR_NUM" ] \
   || [ "$GL_PROJECT" = "$MR_HOSTPATH" ] || case "$GL_PROJECT" in */*) false ;; *) true ;; esac; then
  echo "/do:review: could not parse a GitLab merge request from '$MR_REF' (expected https://<host>/<group>/<project>/-/merge_requests/<iid>)."; exit 1
fi
GL_PROJECT="${GL_PROJECT%/}"
GL_PROJECT_ENC="$(printf '%s' "$GL_PROJECT" | jq -sRr @uri)"
GL_REPO_URL="$GL_SCHEME://$GL_HOST/$GL_PROJECT"
glab auth status --hostname "$GL_HOST" >/dev/null 2>&1 \
  || { echo "glab is not authenticated to $GL_HOST. Run: glab auth login --hostname $GL_HOST"; exit 1; }
echo "GL_HOST=$GL_HOST GL_PROJECT=$GL_PROJECT GL_PROJECT_ENC=$GL_PROJECT_ENC GL_REPO_URL=$GL_REPO_URL PR_NUM=$PR_NUM"
```

The project path keeps every subgroup (`group/sub/project`); only the
`/-/merge_requests/{iid}` segment and what follows it (`/diffs`, `/commits`,
`/pipelines`, `?…`, `#note_…`) are dropped. Carry the printed values literally
into every later block — shell variables do not survive between Bash calls.

**Is the MR's project this checkout?** Set `MR_IN_CHECKOUT=true` when `origin`
names the same host and project (compare case-insensitively, after stripping a
trailing `.git` and the scheme/user prefix), otherwise `false`. Only a matching
checkout can run `glab mr checkout`, push fixes, or host an `@<login>` pass,
because those resolve the project from `origin`.

## Fetch the MR

All reads target `projects/{GL_PROJECT_ENC}` on `--hostname {GL_HOST}`:

```bash
MR_DIR=/tmp/do-review-pr-{PR_NUM}-mr && mkdir -p "$MR_DIR"
glab api --hostname {GL_HOST} "projects/{GL_PROJECT_ENC}/merge_requests/{PR_NUM}" > "$MR_DIR/mr.json" \
  && glab api --hostname {GL_HOST} --paginate "projects/{GL_PROJECT_ENC}/merge_requests/{PR_NUM}/diffs?per_page=100" > "$MR_DIR/diffs.pages" \
  || { echo "/do:review: glab api failed reading MR !{PR_NUM} in {GL_PROJECT} on {GL_HOST}"; exit 1; }
jq -s 'add // []' "$MR_DIR/diffs.pages" > "$MR_DIR/diffs.json"
jq -e '{iid, title, state, draft, author: .author.username, source_branch, target_branch,
        sha, diff_refs, source_project_id, target_project_id, allow_collaboration, web_url,
        is_fork: (.source_project_id != .target_project_id)} | select(.sha | strings | length > 0)' \
  "$MR_DIR/mr.json" || { echo "/do:review: could not parse MR !{PR_NUM}"; exit 1; }
```

On a GitLab older than 15.7 the `/diffs` endpoint returns 404; read
`merge_requests/{PR_NUM}/changes` instead and use its `.changes` array (same
per-file fields).

1. Capture `HEAD_SHA` (`.sha`), `DIFF_REFS` (`.diff_refs` — `base_sha`,
   `start_sha`, `head_sha`; `post-review` anchors every inline comment to them),
   `HEAD_REF` (`.source_branch`), `BASE_REF` (`.target_branch`), `AUTHOR_LOGIN`
   (`.author.username`), and `IS_FORK`.
2. **Changed files**: each `diffs.json` entry's `new_path` (`old_path` for a
   deleted file). Skip `deleted_file: true` entries from here on. An entry with
   `too_large`/`collapsed` set and an empty `.diff` has no commentable lines;
   still fetch its content, but its findings go in the summary body.
3. **Unified diff**: write each entry as `diff --git a/{old_path} b/{new_path}`
   followed by its `.diff` into `/tmp/do-review-pr-{PR_NUM}.diff`.
4. **Commentable-lines map** — `{new_path: set of new-side line numbers}`;
   GitLab rejects a diff note whose `new_line` is outside the patch. The walk
   mirrors GitHub PR mode's (keep the two in sync): seed the new-side counter at `c`
   from each `@@ -a,b +c,d @@` header, count and include `+` and ` ` lines, skip
   `-` lines without counting, and **ignore the `\ No newline at end of file`
   marker line**. Save to `/tmp/do-review-pr-{PR_NUM}-lines.json`.
5. **Fetch each changed file at `HEAD_SHA`** so agents read full content. The
   file path is URL-encoded too (`/` → `%2F`, e.g. with `jq -Rr @uri`). The
   target project serves a fork MR's head through its `refs/merge-requests/`
   ref:
   ```bash
   glab api --hostname {GL_HOST} "projects/{GL_PROJECT_ENC}/repository/files/{PATH_ENC}/raw?ref={HEAD_SHA}" > /tmp/do-review-pr-{PR_NUM}/{path} || echo "skipped (unreadable): {path}"
   ```
   (Create parent dirs as needed.)
6. **Project conventions**: fetch the MR project's CLAUDE.md and AGENTS.md the
   same way (`repository/files/CLAUDE.md/raw?ref={HEAD_SHA}` →
   `/tmp/do-review-pr-{PR_NUM}-CLAUDE.md`, likewise AGENTS.md; a failure means
   "absent").
7. Print: `Reviewing MR !{PR_NUM}: {title} — {N} files changed{strict_suffix}`
   plus `Author: {AUTHOR_LOGIN}{fork_suffix}` (` (cross-project fork)` when
   `IS_FORK=true`).

If the MR has no changed files, inform the user and stop.

## Determine write access (`{CAN_PUSH_HEAD}`)

Probe the actual access level, never infer it from a username match. If
`.state` is not `opened`, set `CAN_PUSH_HEAD=false` and `BASE_PUSH=false` and
stop here. Otherwise read both projects (the source project is the fork on a
fork MR, the target project otherwise):

```bash
MR_DIR=/tmp/do-review-pr-{PR_NUM}-mr
# Prints true only for a readable project where we hold Developer (30) or higher.
can_push() {
  glab api --hostname {GL_HOST} "projects/$1" > "$MR_DIR/project-$1.json" 2>/dev/null || { echo false; return; }
  jq -r '([.permissions.project_access.access_level, .permissions.group_access.access_level] | map(select(. != null)) | max // 0) >= 30' "$MR_DIR/project-$1.json" 2>/dev/null | grep -qx true && echo true || echo false
}
HEAD_PUSH=$(can_push {SOURCE_PROJECT_ID}); BASE_PUSH=$(can_push {TARGET_PROJECT_ID})
echo "HEAD_PUSH=$HEAD_PUSH BASE_PUSH=$BASE_PUSH"
```

Access level 30 is Developer, the lowest role that pushes. Set
`CAN_PUSH_HEAD=true` when `MR_IN_CHECKOUT=true` **and** either `HEAD_PUSH=true`,
or `IS_FORK=true` with `allow_collaboration=true` and `BASE_PUSH=true` (the
author let members who can merge push to the fork branch). Otherwise
`CAN_PUSH_HEAD=false`. When `MR_IN_CHECKOUT=false` is the only blocker, give the
reason `this checkout is not {GL_PROJECT}`. As on GitHub, a `false` is a
routing signal, never an error.

## Fix Issues — MR-branch checkout (`PR_DISPOSITION=apply`)

1. **Refuse to start on a dirty tree.** If `git status --porcelain` is non-empty,
   fall back to `PR_DISPOSITION=inline`, say why, and continue.
2. `glab mr checkout {PR_NUM}` (this checkout is the MR's project, so `glab`
   resolves it from `origin`).
3. Fix only what this review found. Do not rebase the MR, reformat untouched
   files, or fold in unrelated cleanups — the author owns this branch.
4. Attribute the commits exactly as local mode does (`address review (self): …`).

## Push fixes to the MR branch (`PR_DISPOSITION=apply`)

1. **Gate on the tests.** The build/test run from "Fix Issues" must have passed.
   Otherwise push nothing and fall back to `PR_DISPOSITION=inline`, saying the
   fixes were prepared but did not pass the project's checks.
2. **Push to the source project and branch by name**, never a bare `git push`
   or `git push origin {branch}`: on a fork MR the branch lives in the fork, and
   `glab mr checkout` does not always set a tracking ref. Use the source
   project's clone URL in the same protocol as `origin` (`ssh_url_to_repo` or
   `http_url_to_repo` from `project-{SOURCE_PROJECT_ID}.json`):
   ```bash
   git push "{SOURCE_CLONE_URL}" "HEAD:refs/heads/{HEAD_REF}"
   ```
3. **A rejected push is a downgrade, not an abort.** On a non-fast-forward, pull
   the source branch with rebase once and retry. If it still fails, or fails on
   permissions, keep the commits locally and switch to `PR_DISPOSITION=inline`.
4. **Post a short MR note describing what was pushed**
   (`glab mr note {PR_NUM} -m "…"`): the commits, the findings they address,
   and every finding you did **not** fix.
5. Print the pushed SHAs and the MR URL.

## Post Review to GitLab MR (`PR_DISPOSITION=inline`)

Skip this section when `PR_DISPOSITION=apply` succeeded in pushing. For each
verified finding:

1. **Severity**: prefix the body with `**[CRITICAL]**`, `**[IMPROVEMENT]**`, or
   `**[NIT]**`. Skip `UNCERTAIN` findings — don't post speculation.
2. **Postability**: a finding whose `file:line` is in the commentable-lines map
   becomes an inline diff discussion; any other finding goes in the summary's
   Out-of-diff section.
3. **Suggestion**: when the finding carries a concrete replacement, append it as
   literal replacement text (no `-`/`+` prefixes). A single-line fix uses a
   plain ```` ```suggestion ```` block. A range uses ```` ```suggestion:-{N}+0 ````
   on a comment anchored to the range's **last** line, where `{N}` is how many
   lines above it the range starts; every line of the range must be in the map.

The summary body carries a one-line verdict (`Reviewed by /do:review — N
critical, M improvements, K nits.`), a Highlights section (the top 1-3 CRITICAL
findings by `file:line`), an Out-of-diff observations section, a Coherence
check section when the MR claims something the code doesn't deliver, and the
footer `_Generated by /do:review_`. GitLab has **no request-changes event**:
when a finding is CRITICAL and the current user (read
`glab api --hostname {GL_HOST} user` to a file, then take `.username` with
`jq -er`) is not `AUTHOR_LOGIN`, open the summary with `**Changes requested**`.
Never approve.

Post through the `post-review` verb of `host-gitlab.md`, retargeted at this MR
as its "Targeting an MR outside the checkout" section says. Post the inline
discussions first, then the summary note. A discussion rejected with `400`
(line outside the diff, or the head moved) moves into the summary's
Out-of-diff section rather than failing the review. If `.sha` changed since
`HEAD_SHA`, re-fetch and rebuild the map before posting. Print the MR URL.

### Drafts mode (optional)

With `--draft`: write `{"diff_refs": …, "summary": "…", "comments": [ … ]}` to
`/tmp/do-review-pr-{PR_NUM}-payload.json`, post nothing, and print the path
plus the retargeted `post-review` commands needed to publish it by hand.

## Merge the MR (`--merge` only)

Only when `MERGE_ENABLED=true`. Every gate must pass, or skip the merge and name
the failing gate:

1. **No unresolved blocker from this run.** Zero CRITICAL findings remain
   (none found, or every one fixed and pushed in `PR_DISPOSITION=apply`). A
   commented-only CRITICAL is unresolved, so `PR_DISPOSITION=inline` can never
   merge.
2. **We can merge it.** `BASE_PUSH=true` and `.draft` is `false`.
3. **GitLab says it is mergeable.** Re-read the MR: `.detailed_merge_status`
   is `mergeable` (older GitLab: `.merge_status` is `can_be_merged` and
   `.has_conflicts` is `false`).
4. **The pipeline is green.** Poll the re-read MR's `.head_pipeline.status`
   until it is terminal. Only `success` passes, and no head pipeline at all is
   vacuously green. On a failure, apply the one-conservative-re-run routine in
   `~/.claude/lib/ci-flake-handling.md` once; if it fails again, do not merge.
5. **The head is what we reviewed.** `.sha` equals `HEAD_SHA` (plus any commits
   we pushed ourselves); `--sha` below makes GitLab enforce it.

When every gate passes (`--squash` for `squash`, `--rebase` for `rebase`, no
flag for `merge`; default `squash`):

```bash
glab mr merge {PR_NUM} -R "{GL_REPO_URL}" --yes --sha {HEAD_SHA} {MERGE_METHOD_FLAG}
```

**Never pass `--remove-source-branch`** — on a fork MR the source branch belongs
to the contributor. Read the MR back and say it merged only when `.state` is
`merged`. An `opened` MR with `merge_when_pipeline_succeeds` set is queued, not
merged — report it that way.

## Report additions

In the "## Report" section, use `MR !{PR_NUM}` and open with
the disposition line; for `inline`, list **Inline Suggestions Posted** and
**Out-of-diff Findings** and end with the MR URL; for `apply`, list the pushed
SHAs and **Left for the author**. With `--merge`, close with
`Merged !{PR_NUM} ({MERGE_METHOD})`, `Queued !{PR_NUM}`, or the failing gate.
