Read only when `SOURCE_GATED=true`. Every commit that must reach `{source}` — the
`chore: release v{version}` preparation commit and any later review fix — lands
through a temporary branch and a PR into `{source}` that must pass its required
checks on the exact pushed head. Never push to `{source}` directly, never use
`--admin`/`--auto`/bypass, never force-push, never disable or edit the protection.
An ungated `{source}` never reads this file.

### Land a commit through the gate

Inputs, set per landing: `GATE_BRANCH` — `release-prep/v{version}` for the preparation,
`release-fix/v{version}-<n>` for review-fix pass `<n>`; `GATE_TITLE` — `chore: release v{version}`
for the preparation (the exact subject, so the prepared-release detection in
**Recover Prepared Release State** still matches after the merge), `fix: address release review findings (v{version})`
for fixes. Run as **one** shell invocation from the checkout whose `HEAD` holds the unlanded commits:

```bash
# INCOMPLETE_WHAT names the step; INCOMPLETE_DETAIL is the reason.
incomplete() {
  echo "INCOMPLETE — $INCOMPLETE_WHAT is unverified; $INCOMPLETE_DETAIL Preserve the prepared release state and retry."
  exit 1
}
GATE_BRANCH="release-prep/v{version}"
GATE_TITLE="chore: release v{version}"
GATE_SHA="$(git rev-parse HEAD)"
git push -u origin "HEAD:refs/heads/$GATE_BRANCH"
REMOTE_GATE_SHA="$(git ls-remote --heads origin "refs/heads/$GATE_BRANCH" | grep . | head -n1 | cut -f1)"
if ! printf '%s\n' "$REMOTE_GATE_SHA" | grep -Eq '^[0-9a-f]{40}$' || [ "$REMOTE_GATE_SHA" != "$GATE_SHA" ]; then
  INCOMPLETE_WHAT="Source gate push" INCOMPLETE_DETAIL="expected $GATE_SHA, got ${REMOTE_GATE_SHA:-empty}." incomplete
fi
if [ "$CLI_TOOL" = gh ]; then
  GATE_PRS_JSON="$(gh pr list --state all --base "{source}" --head "$GATE_BRANCH" --limit 100 --json number,state,headRefOid,url)" || INCOMPLETE_WHAT="Source gate PR" INCOMPLETE_DETAIL="the forge query failed." incomplete
else
  GATE_PRS_RESPONSE="$(glab api --paginate "projects/:id/merge_requests?source_branch=$GATE_BRANCH&target_branch={source}&state=all&per_page=100")" || INCOMPLETE_WHAT="Source gate MR" INCOMPLETE_DETAIL="the forge query failed." incomplete
  GATE_PRS_JSON="$(printf '%s\n' "$GATE_PRS_RESPONSE" | jq -s 'if length == 0 then error("expected JSON document") elif (all(.[]; type == "array") | not) then error("expected array pages") else add | [.[] | {number: .iid, state: (.state | ascii_upcase | if . == "OPENED" then "OPEN" else . end), headRefOid: .sha, url: .web_url}] end')" || INCOMPLETE_WHAT="Source gate MR" INCOMPLETE_DETAIL="the forge response was malformed." incomplete
fi
if ! printf '%s\n' "$GATE_PRS_JSON" | jq -e 'type == "array"' >/dev/null; then
  INCOMPLETE_WHAT="Source gate {CR_NOUN}" INCOMPLETE_DETAIL="the forge returned empty or malformed data." incomplete
fi
MATCHING_GATE_PRS="$(printf '%s\n' "$GATE_PRS_JSON" | jq -c --arg sha "$GATE_SHA" '[.[] | select(.headRefOid == $sha and (.state == "OPEN" or .state == "MERGED"))]')"
case "$(printf '%s\n' "$MATCHING_GATE_PRS" | jq 'length')" in
  0)
    if [ "$CLI_TOOL" = gh ]; then
      GATE_PR_URL="$(gh pr create --base "{source}" --head "$GATE_BRANCH" --title "$GATE_TITLE" --body "Admission PR so the required checks run on this exact head before it lands on {source}; the {source} → {target} release PR follows.")" || INCOMPLETE_WHAT="Source gate PR" INCOMPLETE_DETAIL="creation failed; retry without creating another PR." incomplete
    else
      GATE_PR_URL="$(glab mr create --source-branch "$GATE_BRANCH" --target-branch "{source}" --title "$GATE_TITLE" --description "Admission MR so the required pipeline runs on this exact head before it lands on {source}." --yes)" || INCOMPLETE_WHAT="Source gate MR" INCOMPLETE_DETAIL="creation failed; retry without creating another MR." incomplete
    fi
    GATE_PR_NUMBER="${GATE_PR_URL##*/}"
    GATE_PR_STATE=OPEN
    ;;
  1)
    GATE_PR_NUMBER="$(printf '%s\n' "$MATCHING_GATE_PRS" | jq -r '.[0].number')"
    GATE_PR_URL="$(printf '%s\n' "$MATCHING_GATE_PRS" | jq -r '.[0].url')"
    GATE_PR_STATE="$(printf '%s\n' "$MATCHING_GATE_PRS" | jq -r '.[0].state')"
    ;;
  *) INCOMPLETE_WHAT="Source gate {CR_NOUN}" INCOMPLETE_DETAIL="more than one open or merged {CR_NOUN} matches $GATE_SHA; investigate the ambiguity." incomplete ;;
esac
if ! printf '%s\n' "$GATE_PR_NUMBER" | grep -Eq '^[0-9]+$'; then
  INCOMPLETE_WHAT="Source gate {CR_NOUN}" INCOMPLETE_DETAIL="creation returned empty or malformed data." incomplete
fi
printf 'SOURCE_GATE_HANDOFF\tGATE_BRANCH=%s\tGATE_SHA=%s\tGATE_PR_NUMBER=%s\tGATE_PR_URL=%s\tGATE_PR_STATE=%s\n' "$GATE_BRANCH" "$GATE_SHA" "$GATE_PR_NUMBER" "$GATE_PR_URL" "$GATE_PR_STATE"
```

A resumed run reuses the open or already-merged PR for the same head instead of
opening a second one, and a merged one skips straight to the sync below — so the
version is never bumped or landed twice.

When `GATE_PR_STATE=OPEN` and `SOURCE_CHECKS_REQUIRED=true`, wait for the required remote checks on that head. GitHub:
`gh pr checks <GATE_PR_NUMBER> --required`; on `no (required )?checks reported`, poll for up to five
minutes for one to attach (the gate requires one, so none attaching is INCOMPLETE, not green), then
`gh pr checks <GATE_PR_NUMBER> --required --watch --fail-fast`. GitLab: `glab ci status --wait --branch "$GATE_BRANCH"`.
When `SOURCE_CHECKS_REQUIRED=false` (a PR-only gate), there is no check to wait for: attempt the merge directly, and if the
gate's review requirement is unmet the merge is refused — leave the PR open and report INCOMPLETE rather than bypassing it.
A red check is fixed on `GATE_BRANCH` and re-pushed through this same procedure — never merged over. Then merge
with a repository-supported method that keeps the subject exact (merge commit first, then squash with
`--subject "$GATE_TITLE"`; never `--admin` or `--auto`):

```bash
gh pr merge "<GATE_PR_NUMBER>" --merge --match-head-commit "<GATE_SHA>" --delete-branch || gh pr merge "<GATE_PR_NUMBER>" --squash --match-head-commit "<GATE_SHA>" --subject "<GATE_TITLE>" --delete-branch
```

(GitLab: `glab mr merge <GATE_PR_NUMBER> --sha "<GATE_SHA>" --yes --remove-source-branch`.) The merge is pinned to the
head whose checks were verified: if `GATE_BRANCH` moved, the merge is refused — restart the procedure from the push so the
new head is verified, never merge an unverified commit. Read the result back — do not infer it
from the exit status — and sync the local `{source}` to the landed commit:

```bash
incomplete() {
  echo "INCOMPLETE — $INCOMPLETE_WHAT is unverified; $INCOMPLETE_DETAIL Preserve the prepared release state and retry."
  exit 1
}
if [ "$CLI_TOOL" = gh ]; then
  GATE_JSON="$(gh pr view "<GATE_PR_NUMBER>" --json state,mergedAt,mergeCommit)" || INCOMPLETE_WHAT="Source gate merge" INCOMPLETE_DETAIL="the forge state query failed." incomplete
  GATE_MERGE_OID="$(printf '%s\n' "$GATE_JSON" | jq -er 'select(.state == "MERGED" and (.mergedAt | type == "string" and length > 0)) | .mergeCommit.oid | select(type == "string" and length > 0)')" \
    || INCOMPLETE_WHAT="Source gate merge" INCOMPLETE_DETAIL="the PR is not merged with a merge commit." incomplete
else
  GATE_JSON="$(glab api "projects/:id/merge_requests/<GATE_PR_NUMBER>")" || INCOMPLETE_WHAT="Source gate merge" INCOMPLETE_DETAIL="the forge state query failed." incomplete
  GATE_MERGE_OID="$(printf '%s\n' "$GATE_JSON" | jq -er 'select(.state == "merged") | (.merge_commit_sha // .squash_commit_sha) | select(type == "string" and length > 0)')" \
    || INCOMPLETE_WHAT="Source gate merge" INCOMPLETE_DETAIL="the MR is not merged with a landed commit." incomplete
fi
git fetch origin "refs/heads/{source}:refs/remotes/origin/{source}" || INCOMPLETE_WHAT="Source gate merge" INCOMPLETE_DETAIL="origin/{source} could not be fetched." incomplete
git merge-base --is-ancestor "$GATE_MERGE_OID" "origin/{source}" || INCOMPLETE_WHAT="Source gate merge" INCOMPLETE_DETAIL="origin/{source} does not contain the merge commit." incomplete
git checkout "{source}" || INCOMPLETE_WHAT="Source gate merge" INCOMPLETE_DETAIL="the local {source} could not be checked out." incomplete
if ! git merge --ff-only "origin/{source}"; then
  # A squash/rebase merge rewrites the commit: accept only when the trees are identical.
  git diff --quiet HEAD "origin/{source}" || INCOMPLETE_WHAT="Source gate merge" INCOMPLETE_DETAIL="the local {source} differs from the landed origin/{source}." incomplete
  git reset --hard "origin/{source}"
fi
git branch --set-upstream-to "origin/{source}"
git rev-parse HEAD
```

Substitute `<GATE_PR_NUMBER>`/`<GATE_TITLE>` from the handoff. The printed SHA is the new `{source}` head that
**Checkpoint 1** verifies and **Checkpoint 2** opens the release PR from; the release PR's required CI then runs on
that exact head, as for any release.

### Review fixes under a gated source

The review loops push each fix to the checked-out branch's upstream, which would be `{source}`. Before dispatching them,
create `release-fix/v{version}-<n>` from the landed `{source}` head with `git checkout -b` and
`git push -u origin HEAD`, so the loops' config-derived push target is that branch. After **each reviewer pass that added
commits** — before the next reviewer starts, and before a host-side reviewer is re-requested, since it reads the release
PR head — land them with the procedure above (`GATE_BRANCH=release-fix/v{version}-<n>`), then return to `{source}`, take
the landed head, and open the next fix branch from it. A required-check failure on a fix PR is a failed pass, not a
gate to bypass. After the last pass, re-read the release PR's head SHA; it must equal the local `{source}` head before
the merge gate runs, and CI is awaited on that head.
