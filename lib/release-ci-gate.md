# Release PR CI gate

Apply this gate to the open release/preparation PR before merging. Repository
merge admission and configured review are additional gates; this procedure never
grants admission or changes branch protection. Preserve the prepared release on
every blocker.

## GitHub

1. **Bind evidence to the live PR.** Resolve the authenticated host with
   `lib/gh-host.md`. Read `gh pr view <number> --json headRefOid,baseRefName,state`
   and record the exact head SHA and base branch. Require an open PR. Query the
   current PR's unfiltered checks (`gh pr checks <number> --json name,state,bucket,workflow,link`)
   separately from `gh pr checks <number> --required`. The required-only view
   describes branch-protection requirements, not whether CI exists. Only a
   successful query explicitly reporting no required checks means that set is
   empty; permission errors, rate limits, malformed data and other API failures
   are INCOMPLETE, never evidence of an empty set.
2. **Determine expected CI from configuration, not observed checks alone.** Read
   the repository's documented CI contract and `.github/workflows/*.yml`/`*.yaml`
   at the relevant remote revision; local dirty files cannot redefine the gate.
   For Actions PR triggers, use the PR base's workflow definitions and inspect
   head changes to those definitions as well. Resolve `pull_request` and
   `pull_request_target` trigger types (including the actual PR activity), base
   `branches`/`branches-ignore`, `paths`/`paths-ignore` against the PR's complete
   changed-path list, and workflow/job conditions using GitHub's semantics.
   Never execute repository code to discover its checks. An explicitly excluded
   workflow is not expected; record why. A documented external CI service uses
   its configured check/status identity instead of an Actions workflow name.
   Unknown conditions, unsupported configuration or an incomplete/paginated
   path/workflow listing must remain INCOMPLETE unless resolved with reliable
   read-only evidence. Do not infer "no expected CI" merely because no run is
   reported. No required checks and no applicable configured CI is a valid
   no-CI case only after this configuration inspection succeeds.
3. **Require expected CI independently of protection.** Match each expected
   workflow by its configured path/ID (names alone can collide) and PR/event
   identity using paginated Actions run/job APIs (`gh api --hostname "{GH_HOST}"
   repos/{owner}/{repo}/actions/runs` and the run's jobs); inspect check runs and
   commit statuses for configured external CI. Require evidence for this PR's
   exact current head. Actions PR runs may test a synthetic merge commit: verify
   their recorded PR/head association rather than accepting any run on the
   source branch or rejecting a legitimate merge-ref run. A
   `pull_request_target` run on the base alone is not head-test proof; require
   evidence that its configured validation actually covers this PR head.
   Inspect the latest applicable run and latest attempt, never an older green
   run superseded by a queued or red one. Every expected workflow/check must
   reach terminal **success**. Missing expected workflow, pending, queued,
   in-progress, failed, cancelled, timed-out, skipped, neutral, action-required
   or unreadable expected evidence is not green. Optional checks outside the
   configured expected set do not become mandatory just because they appear.
4. **Honor all actual required checks too.** When any are required, wait with
   `gh pr checks <number> --required --watch --fail-fast` and require the forge's
   passing result. Expected workflow success cannot excuse a missing, pending
   or failed required check. Conversely, an empty required list does not block
   an unprotected release branch whose expected CI has succeeded.
5. **Bound the wait and invalidate stale proof.** Poll missing/pending expected
   CI for up to five minutes (or the documented project bound), then report
   INCOMPLETE with the missing workflow/check and current head. Failed or
   cancelled expected CI remains a blocker; fix it or use the existing
   same-head CI flake procedure where applicable, never silently bypass it.
   Before each poll and immediately before merge, re-read the live head/base;
   a new head or changed base invalidates this gate's evidence: recompute the
   expected set and validate the new head, including its review obligations.
   Re-read current required and expected results before merging pinned to the
   verified head (`--match-head-commit <sha>`). Report the head, expected
   workflow/run URLs, required-check result and any blocker honestly.

## GitLab

GitLab has no separate protection-required check list. Watch the current head
pipeline with `glab ci status --wait --branch <head-branch>`, verify its SHA
matches the MR head, and honor the project's pipeline and review requirements.
Missing expected pipeline: poll up to five minutes, then INCOMPLETE. Failed,
cancelled, pending or unreadable expected pipelines block; a new MR head
invalidates the prior result. Never treat an API failure as no configured CI.
