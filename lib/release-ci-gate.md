# Release PR CI gate

Apply this gate to the open release or preparation PR before merging. It answers
two separate questions, because each alone has gone wrong: "no required checks"
does not mean the project has no CI (an unprotected release branch whose CI passed
must be allowed to merge), and "no checks reported" does not mean green (a PR
whose CI has not registered yet must not merge). Repository merge admission and
configured review are additional gates; this procedure never grants admission or
changes branch protection. On any blocker, leave the prepared release as it is.

## GitHub

1. **Bind evidence to the live PR.** Resolve the authenticated host with
   `lib/gh-host.md`. Read `gh pr view <number> --json headRefOid,baseRefName,state`,
   require an open PR, and record the exact head SHA and base branch. Query the
   PR's unfiltered checks (`gh pr checks <number> --json name,state,bucket,workflow,link`)
   separately from `gh pr checks <number> --required`. The required set is empty
   only when that query succeeds and says so; a permission error, rate limit or
   malformed response is INCOMPLETE, not an empty set.
2. **Work out which CI is expected for this PR from configuration**, since a run
   that has not registered yet is invisible in the observed checks. Read the
   project's documented CI contract and the workflow files under
   `.github/workflows/` at the PR base's remote revision (plus any changes the
   head makes to them); do not run repository code to discover checks. A
   workflow is expected when its `pull_request` / `pull_request_target` trigger
   applies to this PR: the activity type, the base-branch filters, and the
   `paths` / `paths-ignore` filters against the PR's full changed-file list. A
   workflow those filters clearly exclude is not expected; note why. When a
   trigger or job condition cannot be resolved with confidence, count the
   workflow as expected and let the wait in step 5 decide. A documented external
   CI service is expected under its own check or status name. Concluding "this
   project has no CI for this PR" is valid only after this reading succeeds with
   a complete workflow and file listing, and never merely because no run shows up.
3. **Require every expected workflow or check to succeed on this exact head.**
   Match Actions runs by workflow path or ID, since names can collide, through
   the paginated runs and jobs APIs (`gh api --hostname "{GH_HOST}"
   repos/{owner}/{repo}/actions/runs`), and external CI through check runs and
   commit statuses. Use the run's recorded PR and head association: a
   `pull_request` run may execute on a synthetic merge commit and is still this
   PR's run, while a `pull_request_target` run on the base proves nothing about
   the head unless its validation covers the PR head. Judge the latest run and
   latest attempt, not an older green one superseded by a queued or red one.
   Only a terminal success counts; missing, pending, failed, cancelled, timed
   out, skipped, neutral, action-required or unreadable does not. Checks outside
   the expected set do not become mandatory because they appear.
4. **Honor the required checks as well.** When any are required, wait with
   `gh pr checks <number> --required --watch --fail-fast` and require a passing
   result; expected-CI success does not excuse a missing, pending or failed
   required check. An empty required set does not block a release branch whose
   expected CI has succeeded.
5. **Bound the wait and discard stale proof.** Poll missing or pending expected
   CI for up to five minutes (or the project's documented bound), then report
   INCOMPLETE naming the missing workflow or check and the head. A failed or
   cancelled expected check is a blocker: fix it, or use the same-head CI flake
   procedure where it applies. Before each poll and immediately before merging,
   re-read the live head and base; if either changed, recompute the expected set
   and validate the new head, including its review obligations. Merge pinned to
   the verified head (`--match-head-commit <sha>`), and report the head, the
   expected workflow run URLs, the required-check result and any blocker.

## GitLab

GitLab has no separate protection-required check list. Watch the current head
pipeline with `glab ci status --wait --branch <head-branch>`, verify its SHA
matches the MR head, and honor the project's pipeline and review requirements.
A missing expected pipeline is polled for up to five minutes, then INCOMPLETE.
Failed, cancelled, pending or unreadable expected pipelines block; a new MR head
invalidates the prior result, and the merge is pinned to the verified head
(`glab mr merge <number> --sha <sha>`). An API failure is never evidence that no
CI is configured.
