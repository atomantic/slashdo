Read only when `{SOURCE_GATED}=true`; an ungated `{source}` never needs this file.
Every commit that must reach `{source}` — the preparation commit (subject
`{release_subject}`, `chore: release v{version}` unless the project's history shows
another pattern) and any later review fix — lands through a temporary branch and a
{CR_NOUN} into `{source}` that passes its required checks on the exact pushed head.
Do not push to `{source}` directly, use `--admin`, `--auto` or any other bypass,
force-push, or disable or edit the protection: each of those lands a commit the gate
never evaluated.

### Land a commit through the gate

Per landing, from the checkout whose `HEAD` holds the unlanded commits:

- `{GATE_BRANCH}` — `release-prep/v{version}` for the preparation, `release-fix/v{version}-<n>` for review-fix pass `<n>`.
- `{GATE_TITLE}` — `{release_subject}` for the preparation (the exact subject, so that **Recover Prepared Release State** still finds the commit after the merge); `fix: address release review findings (v{version})` for fixes.

1. **Open the admission {CR_NOUN}** with "Push, read back, reuse or create" (under **Open the Release PR**): head `{GATE_BRANCH}`, base `{source}`, title `{GATE_TITLE}`, and a body saying it exists so the required checks run on this exact head before it lands on `{source}`. Record `{GATE_SHA}` (the pushed head), `{GATE_PR_NUMBER}` and its state. A resumed run reuses the open or already-merged {CR_NOUN} for the same head, and a merged one skips to step 4, so the version is never bumped or landed twice.
2. **Wait for the required checks on that head** when `{SOURCE_CHECKS_REQUIRED}=true`. GitHub: `gh pr checks {GATE_PR_NUMBER} --required`; when it reports no required checks yet, poll for up to five minutes for one to attach — the gate requires one, so none attaching is INCOMPLETE, not green — then `gh pr checks {GATE_PR_NUMBER} --required --watch --fail-fast`. GitLab: `glab ci status --wait --branch "{GATE_BRANCH}"`. A red check is fixed on `{GATE_BRANCH}` and pushed through this procedure again; it is not merged over. When `{SOURCE_CHECKS_REQUIRED}=false` (a {CR_NOUN}-only gate) there is no check to wait for: attempt the merge, and if the gate's review requirement refuses it, leave the {CR_NOUN} open and report INCOMPLETE.
3. **Merge, pinned to the verified head**, with a method the repository allows that keeps the subject exact — a merge commit first, then a squash with the subject set:
   `gh pr merge "{GATE_PR_NUMBER}" --merge --match-head-commit "{GATE_SHA}" --delete-branch || gh pr merge "{GATE_PR_NUMBER}" --squash --match-head-commit "{GATE_SHA}" --subject "{GATE_TITLE}" --delete-branch`.
   GitLab: `glab mr merge {GATE_PR_NUMBER} --sha "{GATE_SHA}" --yes --remove-source-branch`. If `{GATE_BRANCH}` moved, the forge refuses the pinned merge; restart from step 1 so the new head is verified.
4. **Read the result back** rather than trusting the exit status, and sync the local `{source}` to the landed commit:

```bash
incomplete() {
  echo "INCOMPLETE — Source gate merge is unverified; $WHY Preserve the prepared release state and retry."
  exit 1
}
case "{CLI_TOOL}" in
gh)
  GATE_JSON="$(gh pr view "{GATE_PR_NUMBER}" --json state,mergedAt,mergeCommit)" || WHY="the forge state query failed." incomplete
  GATE_MERGE_OID="$(printf '%s\n' "$GATE_JSON" | jq -er 'select(.state == "MERGED" and (.mergedAt | type == "string" and length > 0)) | .mergeCommit.oid | select(type == "string" and length > 0)')" \
    || WHY="the PR is not merged with a merge commit." incomplete
  ;;
glab)
  GATE_JSON="$(glab api "projects/:id/merge_requests/{GATE_PR_NUMBER}")" || WHY="the forge state query failed." incomplete
  GATE_MERGE_OID="$(printf '%s\n' "$GATE_JSON" | jq -er 'select(.state == "merged") | (.merge_commit_sha // .squash_commit_sha) | select(type == "string" and length > 0)')" \
    || WHY="the MR is not merged with a landed commit." incomplete
  ;;
*) WHY="the code host CLI was not resolved." incomplete ;;
esac
git fetch origin "refs/heads/{source}:refs/remotes/origin/{source}" || WHY="origin/{source} could not be fetched." incomplete
git merge-base --is-ancestor "$GATE_MERGE_OID" "origin/{source}" || WHY="origin/{source} does not contain the merge commit." incomplete
git checkout "{source}" || WHY="the local {source} could not be checked out." incomplete
if ! git merge --ff-only "origin/{source}"; then
  # A squash/rebase merge rewrites the commit: accept only when the trees are identical.
  git diff --quiet HEAD "origin/{source}" || WHY="the local {source} differs from the landed origin/{source}." incomplete
  git reset --hard "origin/{source}"
fi
git branch --set-upstream-to "origin/{source}"
git rev-parse HEAD
```

The printed SHA is the new `{source}` head that **Checkpoint 1** reads back and **Checkpoint 2** opens the release
{CR_NOUN} from; the release {CR_NOUN}'s CI then runs on that exact head, as for any release.

### Review fixes under a gated source

The review loops push each fix to the checked-out branch's upstream, which would be `{source}`. Before dispatching them,
create `release-fix/v{version}-<n>` from the landed `{source}` head with `git checkout -b` and
`git push -u origin HEAD`, so the loops' config-derived push target is that branch. After each reviewer pass that added
commits — before the next reviewer starts, and before a host-side reviewer is re-requested, since it reads the release
{CR_NOUN} head — land them with the procedure above (`{GATE_BRANCH}` = `release-fix/v{version}-<n>`), then return to `{source}`, take
the landed head, and open the next fix branch from it. A required-check failure on a fix {CR_NOUN} is a failed pass, not a
gate to bypass. After the last pass, re-read the release {CR_NOUN}'s head SHA; it must equal the local `{source}` head before
the merge gate runs, and CI is awaited on that head.
