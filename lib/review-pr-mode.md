# GitHub PR mode body (`/do:review`)

Loaded only when `PR_MODE=true` — none of this applies to a local branch review, and it
stays out of context on every run that reviews the working tree instead of a published PR.

## Fetch the PR

1. **Fetch PR metadata**:
   ```bash
   gh pr view {PR_NUM} --repo {GH_HOST}/{OWNER}/{REPO} --json number,title,author,baseRefName,headRefName,headRefOid,baseRefOid,url,isCrossRepository,headRepositoryOwner,headRepository
   ```
   Capture `HEAD_SHA` (`headRefOid`), `BASE_SHA` (`baseRefOid`), `HEAD_REF`, `BASE_REF`, `AUTHOR_LOGIN`, and `IS_FORK` (`isCrossRepository`).
2. **Fetch the changed-files list**:
   ```bash
   gh pr diff {PR_NUM} --repo {GH_HOST}/{OWNER}/{REPO} --name-only
   ```
3. **Fetch the full unified diff**:
   ```bash
   gh pr diff {PR_NUM} --repo {GH_HOST}/{OWNER}/{REPO} > /tmp/do-review-pr-{PR_NUM}.diff
   ```
4. **Parse the diff to build a "commentable lines" map** — `{file_path: set of line numbers on the RIGHT (new) side of the diff}`; GitHub's review API rejects inline comments on lines outside the patch. Walk the unified diff line by line:
   - Track the current file from `diff --git a/<path> b/<path>` headers, not `+++ b/<path>` (deletions emit `+++ /dev/null`; renames may not round-trip through `+++`). Skip deleted files entirely.
   - Parse each `@@ -a,b +c,d @@` hunk header to seed the right-side line counter at `c`, then iterate hunk body lines: increment the counter on `+` (added) and ` ` (context) lines and include both in the map; skip `-` (removed) lines without incrementing.
   - **Ignore the `\ No newline at end of file` marker line** — it must NOT advance the right-side counter.
   - (Do NOT use `git apply --numstat` — it reports per-file totals, not hunk line ranges.) Save to `/tmp/do-review-pr-{PR_NUM}-lines.json`.
5. **Fetch each changed file at HEAD_SHA** so agents can read full file content. Skip deleted files — `repos/{OWNER}/{REPO}/contents/{path}?ref={HEAD_SHA}` returns 404 for any path removed in the PR:
   ```bash
   case "$FILE_PATH" in
     /*|../*|*/../*|*/..) printf 'INCOMPLETE — unsafe repository path %s.\n' "$FILE_PATH"; exit 1 ;;
   esac
   DEST_PATH="/tmp/do-review-pr-${PR_NUM}/${FILE_PATH}"
   mkdir -p "$(dirname "$DEST_PATH")" || { printf 'INCOMPLETE — could not create the source directory for %s.\n' "$FILE_PATH"; exit 1; }
   TEMP_PATH="${DEST_PATH}.tmp"
   CONTENT_API_PATH="repos/${OWNER}/${REPO}/contents/${URL_ENCODED_PATH}?ref=${HEAD_SHA}"
   if ! gh api --hostname "$GH_HOST" -H "Accept: application/vnd.github.raw+json" "$CONTENT_API_PATH" > "$TEMP_PATH"; then
     rm -f "$TEMP_PATH"
     printf 'INCOMPLETE — could not fetch the complete raw source for %s at HEAD_SHA; do not review without its source.\n' "$FILE_PATH"; exit 1
   fi
   mv "$TEMP_PATH" "$DEST_PATH" || { printf 'INCOMPLETE — could not save changed file %s.\n' "$FILE_PATH"; exit 1; }
   ```
   (Set `FILE_PATH` from the parsed `diff --git` header and `URL_ENCODED_PATH` by URL-encoding each path component; keep both in quoted shell variables. The raw media type avoids depending on external `jq` and handles GitHub's `encoding: none` response for larger files. Create parent dirs as needed and use step 4's headers to skip deletions up front. A failed fetch is an incomplete review, never a silently skipped source file.)
6. Print: `Reviewing PR #{PR_NUM}: {title} — {N} files changed{strict_suffix}` plus a one-line note: `Author: {AUTHOR_LOGIN}{fork_suffix}` where `{fork_suffix}` is ` (cross-repo fork)` when `IS_FORK=true`.

If the PR has no changed files, inform the user and stop.

## Determine write access (`{CAN_PUSH_HEAD}`)

Probe whether the PR's head branch accepts our push:

!`cat ~/.claude/lib/pr-write-access.md`

The disposition table in `review.md` resolves `PR_DISPOSITION` from `PR_APPLY` and this
probe's `CAN_PUSH_HEAD`.

## Fix Issues — PR-branch checkout (`PR_DISPOSITION=apply`)

When `PR_DISPOSITION=apply`, run "Fix Issues" against the PR's branch instead of the local
one, then continue to "Push fixes to the PR branch" below:

1. **Refuse to start on a dirty tree.** Before checking anything out, if `git status --porcelain` is non-empty, do not check out over the user's uncommitted work — fall back to `PR_DISPOSITION=inline`, say why, and continue.
2. `gh pr checkout {PR_NUM} --repo "{GH_HOST}/{OWNER}/{REPO}"` (per `~/.claude/lib/pr-write-access.md`) so the tracking ref points at the PR head, not the base repo.
3. Fix only what this review found. Do not rebase the PR, reformat untouched files, or fold in unrelated cleanups — the author owns this branch.
4. Attribute the commits to the review, exactly as local mode does (`address review (self): …`).

## Push fixes to the PR branch (`PR_DISPOSITION=apply`)

Skip this section in every other mode. This is the **primary output** when the head branch is writable.

1. **Gate on the tests.** The build/test run from "Fix Issues" must have passed. If it failed and you cannot fix it inside the scope of this review, push nothing: fall back to `PR_DISPOSITION=inline` and post the findings as comments, saying the fixes were prepared but did not pass the project's checks.
2. **Push with a bare `git push`** — no remote, no refspec — so it follows the tracking ref `gh pr checkout` set up. `git push origin {branch}` is wrong here: on a cross-repo PR it invents a branch on the wrong repository while the real PR head stays stale.
3. **A rejected push is a downgrade, not an abort** (see `~/.claude/lib/pr-write-access.md`). On a non-fast-forward, run `git pull --rebase` once and retry; if it still fails, or fails with a permission error, keep the commits locally and switch to `PR_DISPOSITION=inline`.
4. **Post a short PR comment describing what was pushed** (`gh pr comment`), not a `REQUEST_CHANGES` review. List the commits and the findings they address, plus any finding you did **not** fix (out-of-scope, architectural, `UNCERTAIN`).
5. Print the pushed SHAs and the PR URL.

## Post Review to GitHub PR (`PR_DISPOSITION=inline`)

Skip this section when `PR_DISPOSITION=apply` succeeded in pushing. Package the verified findings as a single GitHub PR review with inline comments and code suggestions.

### Classify findings for posting

For each verified finding:
1. **Severity**: CRITICAL (runtime crash, data leak, security, contract break) vs IMPROVEMENT (consistency, robustness, conventions).
2. **Postability**: Check the cited `file:line` against the commentable-lines map (`/tmp/do-review-pr-{PR_NUM}-lines.json`):
   - **In-diff** → eligible for an inline comment
   - **Out-of-diff** → cannot be inline; include in the review summary body instead
3. **Has suggestion**: True if the finding contains a concrete replacement for the cited line(s).

### Build the inline comments array

For each in-diff finding, build a comment object:

```json
{
  "path": "<repo-relative path>",
  "line": <end line on the RIGHT side of the diff>,
  "side": "RIGHT",
  "body": "<severity tag> <one-line gist>\n\n<explanation tied to specific code>\n\n```suggestion\n<exact replacement text for the line range>\n```"
}
```

Rules:
- For multi-line suggestions, add `"start_line": <first line>` and `"start_side": "RIGHT"`. `line` is the LAST line of the range, `start_line` is the FIRST. Both must be in the commentable-lines map.
- The `suggestion` block is literal replacement text for the cited lines, not diff format (no `-`/`+` prefixes).
- Severity tag: prefix the body with `**[CRITICAL]**`, `**[IMPROVEMENT]**`, or `**[NIT]**`.
- Findings without a concrete suggestion still get inline comments, without the ```` ```suggestion ```` block.
- Skip `UNCERTAIN` findings — don't post speculation.

### Build the review summary body

Assemble a top-level review body (markdown) with:
- One-line verdict (e.g., `Reviewed by /do:review — N critical, M improvements, K nits.`)
- A short "Highlights" section listing the most important CRITICAL findings by `file:line`
- An "Out-of-diff observations" section for findings on lines that aren't part of the patch
- A "Coherence check" section if the PR description/commits claim something the code doesn't deliver
- A footer: `_Generated by /do:review_`

### Pick the review event

- **`REQUEST_CHANGES`** if any finding is CRITICAL **and** the current user is not the PR author. If the current user IS the PR author (`gh api --hostname {GH_HOST} user -q '.login'` vs `AUTHOR_LOGIN`), downgrade to `COMMENT` — GitHub forbids requesting changes on your own PR.
- **`COMMENT`** otherwise (improvements/nits only, or self-PR).
- Clean reviews publish the findings summary as `COMMENT` here, then record `APPROVE` through "Approve the reviewed head" after the complete review (including any delegated passes). This also covers successful `apply` mode, which skips this inline section.

### Submit the review

Write the payload to `/tmp/do-review-pr-{PR_NUM}-payload.json`:

```json
{
  "commit_id": "<HEAD_SHA>",
  "event": "COMMENT | REQUEST_CHANGES",
  "body": "<review summary markdown>",
  "comments": [ ...inline comment objects... ]
}
```

Post it:
```bash
gh api --hostname {GH_HOST} repos/{OWNER}/{REPO}/pulls/{PR_NUM}/reviews \
  --method POST \
  --input /tmp/do-review-pr-{PR_NUM}-payload.json
```

On `422 Unprocessable Entity`, the most common causes are:
1. A comment's `line` is not in the diff — re-validate against the lines map and drop offending comments.
2. `commit_id` is stale (the PR head moved while you were reviewing) — fetch and review the new head before rebuilding the payload. Never just replace the SHA and retry an approval.
3. `start_line >= line` for a multi-line comment — fix the ordering.

Print the review URL returned by the API (`html_url`) so the user can open it.

### Drafts mode (optional)

With `--draft`: instead of `POST .../reviews`, write the payload to `/tmp/do-review-pr-{PR_NUM}-payload.json` and print the path plus the `gh api` command needed to publish it manually — include the `--hostname {GH_HOST}` flag in that printed command so it targets the right host on GitHub Enterprise. (Default behavior remains: publish immediately.)

## Approve the reviewed head (all dispositions)

Run after the final review, whether findings were delivered inline or fixes were
pushed in `apply` mode, and **before** the merge-gate re-read. The existing
summary/comments remain the findings record; this separate approval records the
final clean verdict without re-posting inline findings. Use `APPROVE_ENABLED`,
`REVIEW_DRAFT`, `REVIEW_COMPLETE`, `CRITICAL_REMAINING`, and the final reviewed
`HEAD_SHA` from review.md. Missing/incomplete state never permits approval.

```bash
APPROVAL_STATUS=skipped
if [ "${REVIEW_DRAFT:-false}" != true ] && [ "${APPROVE_ENABLED:-false}" = true ] \
   && [ "${REVIEW_COMPLETE:-false}" = true ] && [ "${CRITICAL_REMAINING:-unknown}" = 0 ]; then
  APPROVAL_DIR=$(mktemp -d) || exit 1
  if gh api --hostname {GH_HOST} user > "$APPROVAL_DIR/user.json" \
     && gh api --hostname {GH_HOST} "repos/{OWNER}/{REPO}/pulls/{PR_NUM}" > "$APPROVAL_DIR/pr.json"; then
    if ! jq -e --arg sha "{HEAD_SHA}" '.head.sha == $sha' "$APPROVAL_DIR/pr.json" >/dev/null; then
      printf 'Approval skipped: PR head changed or could not be verified; review the new head before approving or merging.\n'
      exit 1
    fi
    if jq -e --slurpfile user "$APPROVAL_DIR/user.json" \
       '($user[0].login | strings | select(length > 0) | ascii_downcase) as $me
        | (.user.login | strings | select(length > 0) | ascii_downcase) != $me' "$APPROVAL_DIR/pr.json" >/dev/null; then
      jq -n --arg sha "{HEAD_SHA}" \
        '{commit_id: $sha, event: "APPROVE", body: "Reviewed by /do:review — no unresolved CRITICAL findings."}' > "$APPROVAL_DIR/payload.json" || exit 1
      if gh api --hostname {GH_HOST} "repos/{OWNER}/{REPO}/pulls/{PR_NUM}/reviews" \
         --method POST --input "$APPROVAL_DIR/payload.json" > "$APPROVAL_DIR/response.json"; then
        if jq -e --arg sha "{HEAD_SHA}" '.state == "APPROVED" and .commit_id == $sha' "$APPROVAL_DIR/response.json" >/dev/null; then
          APPROVAL_STATUS=recorded
        else
          APPROVAL_STATUS=unverified
        fi
      else
        APPROVAL_STATUS=refused
      fi
    fi
  else
    APPROVAL_STATUS=unavailable
  fi
fi
printf 'Approval: %s\n' "$APPROVAL_STATUS"
```

The REST `APPROVE` event is the equivalent of `gh pr review --approve`, with
`commit_id` explicitly pinning the reviewed head. A self-authored PR stays
comment-only. Missing approval permission or a rejected/unverified response is
not an approval: preserve the review, report the status, and let the fresh merge
gates determine whether another approver is still required. Never retry against
a different SHA, change approval rules, or dismiss someone else's review.

## Merge the PR (`--merge` only)

Only when `MERGE_ENABLED=true` and without `--draft`, after the approval attempt. **Merge only when the PR is actually good** — the flag asks for a merge, every gate below has to agree to one. Skip the merge and print the failing gate by name whenever any of these does not hold:

1. **No unresolved blocker from this run.** `REVIEW_COMPLETE=true` and zero CRITICAL findings remain (none found, or every one fixed and pushed in `PR_DISPOSITION=apply`). A commented-only CRITICAL is unresolved, so `PR_DISPOSITION=inline` can never merge while a CRITICAL remains; `--strict`-promoted structural findings count here too. `UNCERTAIN` findings do not block, but name them in the merge report.
2. **We can merge it.** `BASE_PUSH=true` (from `~/.claude/lib/pr-write-access.md`) and the PR is not a draft.
3. **GitHub says it is mergeable.** `gh pr view {PR_NUM} --repo "{GH_HOST}/{OWNER}/{REPO}" --json mergeable,mergeStateStatus,reviewDecision,isDraft` reports `mergeable=MERGEABLE` and `reviewDecision` is not `CHANGES_REQUESTED`. A `mergeStateStatus` of `BLOCKED` or `DIRTY` stops the merge — report it and leave the PR open.
4. **Required CI is green.** `gh pr checks {PR_NUM} --repo "{GH_HOST}/{OWNER}/{REPO}" --required --watch --fail-fast`. On a failure, apply the one-conservative-re-run routine in `~/.claude/lib/ci-flake-handling.md`; if it fails again, do not merge — report which check failed.
5. **The head is what we reviewed.** Re-read `headRefOid` and compare it to the `HEAD_SHA` the final review ran against (including inspected, tested, and pushed fixes). If the author pushed something else meanwhile, do not merge; say the head moved and stop.

When every gate passes:

```bash
gh pr merge {PR_NUM} --repo "{GH_HOST}/{OWNER}/{REPO}" --{MERGE_METHOD} --match-head-commit {HEAD_SHA}
```

`{MERGE_METHOD}` defaults to `squash` when `--merge` carried no method. **Never pass `--delete-branch` here** — on a cross-repo PR the head branch belongs to the contributor's fork, and in a linked worktree `gh`'s implicit default-branch checkout fails and reports a successful merge as an error. Read the PR's state back and confirm it is `MERGED` before saying so: `gh pr merge` exits zero on a repo with a merge queue while the PR is only *queued*.

## Report additions

In the "## Report" section, open with the disposition line (`apply` or `inline`, and the reason), then:

- **`PR_DISPOSITION=inline`** — replace "Issues Fixed" with **Inline Suggestions Posted** (count and list with `file:line` + one-line gist) and **Out-of-diff Findings** (list — these went into the summary body), and add a final line with the posted review URL.
- **`PR_DISPOSITION=apply`** — keep "Issues Fixed", list the pushed commit SHAs, and add **Left for the author** for anything not fixed. If the push was refused and the run fell back to comments, say so explicitly and report as `inline`.

When `MERGE_ENABLED=true`, close with the merge outcome: `Merged #{PR_NUM} ({MERGE_METHOD})`, or the name of the gate that stopped it.
