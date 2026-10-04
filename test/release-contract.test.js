'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { readCommandDocs } = require('./helpers/command-docs');

const body = fs.readFileSync(path.join(__dirname, '..', 'commands', 'do', 'release.md'), 'utf8');
// The documented-delivery path lives in lib/release-documented.md, loaded on demand
// via `!read` so recovery/generic-promotion runs don't pay for it — resolve it here
// so the contract below still pins its text.
const resolved = readCommandDocs('release.md', { eager: true });

describe('/do:release remote promotion contracts', () => {
  it('requires ordered remote checkpoints before reporting completion', () => {
    const checkpoints = [
      'Checkpoint 1 — source push',
      'Checkpoint 2 — release PR',
      'Checkpoint 3 — merged release PR',
      'Checkpoint 4 — target-branch tree',
      'Checkpoint 5 — version tag',
      'Checkpoint 6 — GitHub Release',
    ];
    let previous = -1;
    for (const checkpoint of checkpoints) {
      const index = body.indexOf(checkpoint);
      assert.ok(index > previous, `${checkpoint} must follow the previous checkpoint`);
      previous = index;
    }
    assert.match(body, /Only after all six checkpoints pass.*report the release as complete/s);
    assert.match(body, /[Ee]mpty,\s+malformed, timed-out, queued, or otherwise inconclusive output is incomplete/);
  });

  it('verifies the source push and avoids duplicate PRs on reruns', () => {
    assert.match(body, /git push -u origin "HEAD:refs\/heads\/\{source\}"/);
    assert.match(body, /REMOTE_SOURCE_SHA="\$\(git ls-remote --heads origin "refs\/heads\/\{source\}"/);
    assert.match(body, /REMOTE_SOURCE_SHA.*\[ "\$REMOTE_SOURCE_SHA" != "\$SOURCE_SHA" \]/s);
    assert.match(body, /gh pr list --state all --base "\{target\}" --head "\{source\}"/);
    assert.match(body, /select\(\.headRefOid == \$sha and \(\.state == "OPEN" or \.state == "MERGED"\)\)/);
    assert.match(body, /never create a\s+duplicate/);
  });

  it('resumes prepared releases before version bumping and merged PRs after review', () => {
    const recovery = body.indexOf('## Recover Prepared Release State');
    const determineVersion = body.indexOf('## Determine Version and Finalize Changelog');
    assert.ok(recovery >= 0 && recovery < determineVersion, 'prepared recovery must precede version determination');
    assert.match(body, /Skip this entire section when `PREPARED_RELEASE` is non-empty/);
    assert.match(body, /PREPARED_RELEASE="\$\(prepared_release_sha "origin\/\{target\}\.\.HEAD"\)"/);
    assert.doesNotMatch(body, /PREVIOUS_TAG=.*git describe/);
    assert.match(body, /PR_STATE="\$\(printf '[^\n]+' \"\$MATCHING_RELEASE_PRS\" \| jq -r '\.\[0\]\.state'/);
    assert.match(body, /If the selected PR already has `PR_STATE=MERGED`, skip this section entirely[\s\S]*?Do not request another review/);
    assert.match(body, /If `PR_STATE=MERGED`, skip the CI gate and merge command below/);
    assert.match(body, /TARGET_RECOVERY=true/);
    assert.match(body, /RELEASE_TARGET_HANDOFF/);
    assert.match(body, /skip Local Code Review, Checkpoints 1–2/);
  });

  it('requires mergedAt and mergeCommit instead of trusting merge exit status', () => {
    assert.match(body, /gh pr view "\$PR_NUMBER" --json state,mergedAt,mergeCommit/);
    assert.match(body, /\.state == "MERGED"/);
    assert.match(body, /\.mergedAt \| type == "string"/);
    assert.match(body, /\.mergeCommit\.oid \| type == "string"/);
    assert.match(body, /MERGE_COMMIT="\$\(.*\.mergeCommit\.oid/s);
  });

  it('verifies target ancestry and makes tag publication idempotent', () => {
    assert.match(body, /git fetch origin "refs\/heads\/\{target\}"/);
    assert.match(body, /git cat-file -e "\$TARGET_SHA\^\{tree\}"/);
    assert.match(body, /git merge-base --is-ancestor "\$MERGE_COMMIT" "\$TARGET_SHA"/);
    assert.match(body, /refs\/tags\/v\{version\}\^\{/);
    assert.match(body, /refusing to overwrite it/);
    assert.match(body, /git push origin "refs\/tags\/v\{version\}" \|\| true/);
    assert.match(body, /git rev-parse --verify --quiet FETCH_HEAD\^\{commit\}/);
    assert.match(body, /git merge-base --is-ancestor "\$PREPARED_RELEASE_SHA" "\$TAG_COMMIT"/);
    assert.match(body, /git merge-base --is-ancestor "\$TAG_COMMIT" "\$TARGET_SHA"/);
    assert.match(body, /git tag "v\{version\}" "\$MERGE_COMMIT"/);
    assert.match(body, /publishes_github_release/);
    assert.match(body, /\[ "\$ATTEMPT" -lt 30 \] && sleep 10/);
    assert.match(body, /TARGET_PREPARED_RELEASE="\$\(prepared_release_sha "origin\/\{target\}"\)"/);
    assert.match(body, /RELEASE_PR_HANDOFF/);
    assert.match(body, /case "\{publishes_github_release\}" in[\s\S]*true\|false/);
    assert.match(body, /TARGET_RELEASE_STATUS=.*gh api --include/);
    assert.match(body, /404\) TARGET_RELEASE_JSON=""/);
    assert.match(body, /SOURCE_SHA="\$PREPARED_RELEASE_SHA"/);
  });

  it('polls for a published GitHub Release and fails closed on timeout', () => {
    assert.match(body, /for ATTEMPT in \$\(seq 1 30\)/);
    assert.match(body, /gh release view "v\{version\}" --json tagName,isDraft,isPrerelease,publishedAt/);
    assert.match(body, /\.tagName == "v\{version\}"/);
    assert.match(body, /\.isDraft == false/);
    assert.match(body, /\.isPrerelease == false/);
    assert.match(body, /incomplete "GitHub Release" "no published release was found after the bounded wait\."/);
    assert.match(body, /incomplete\(\) \{\n {2}echo "INCOMPLETE — \$1 is unverified; \$2 Preserve the prepared release state and retry\."/);
  });

  it('deduplicates repeated checkpoint logic into shared shell helpers', () => {
    assert.match(body, /prepared_release_sha\(\) \{/);
    assert.match(body, /remote_tag_commit\(\) \{/);
    assert.match(body, /release_published_json\(\) \{/);
    assert.match(body, /release_is_published\(\) \{/);
    assert.match(body, /incomplete\(\) \{/);

    const publishesFlagGuards = (body.match(/case "\{publishes_github_release\}" in/g) || []).length;
    assert.equal(publishesFlagGuards, 1, 'the publishes_github_release guard must not be duplicated as a case statement');

    const extendedRegexpUses = (body.match(/--extended-regexp/g) || []).length;
    assert.equal(extendedRegexpUses, 0, 'the no-op --extended-regexp flag must be removed');

    // Checkpoint 3's merge read-back must not be a standalone fenced block anymore —
    // it runs inside the merged Checkpoints 3-6 invocation alongside Checkpoint 4.
    const mergedPrHandoffPrintfs = (body.match(/printf 'RELEASE_PR_HANDOFF\\tPR_NUMBER=%s\\tPR_URL=%s\\tPR_STATE=MERGED\\tMERGE_COMMIT=%s\\n'/g) || []).length;
    assert.equal(mergedPrHandoffPrintfs, 1, 'the merged-PR handoff print must appear exactly once, not once per duplicated checkpoint block');
  });
});


describe('/do:release documented project delivery', () => {
  const selection = resolved.slice(resolved.indexOf('## Select the Project Release Procedure'), resolved.indexOf('## Detect Release Workflow'));

  it('selects the native procedure before any promotion branch mutation', () => {
    assert.match(selection, /docs\/RELEASING\.md/);
    assert.match(selection, /documented project procedure\s+wins/);
    assert.match(selection, /temporary `release\/vX\.Y\.Z` branch into `main`/);
    assert.match(selection, /Do not run the generic branch detection/);
    assert.match(selection, /Do not fall through into the generic promotion workflow/);
    // Preserve the self-PR guard for repositories using generic promotion.
    assert.match(body.slice(body.indexOf('## Detect Release Workflow')), /target == source.*abort/);
  });

  it('carries native release recovery and publication ownership through delivery', () => {
    assert.match(selection, /Resume an existing\s+prepared version or interrupted publication/);
    assert.match(selection, /Keep the running application's checkout, branch, dirty\s+files, and data untouched/);
    assert.match(selection, /run the configured review loops from\s+\*\*Run the Review Loop\*\*\s+below after step 5 creates the PR/);
    assert.match(selection, /run every configured \*\*local-agent and Ollama\*\*\s+reviewer/);
    assert.match(selection, /\*\*before\*\* step 5's submission command/);
    assert.match(selection, /preserv(?:e|ing) their verdict and optionality/);
    assert.match(selection, /report\s+INCOMPLETE naming it rather than publishing ungated/);
    assert.match(selection, /full previous-release\s+commit-to-prepared-head diff/);
    assert.match(selection, /No reported checks is not green when CI/);
    assert.match(selection, /Squash\/rebase merges need verification/);
    assert.match(selection, /When automation creates the tag or release, wait for it; do not pre-create/);
    assert.match(selection, /first\s+unverified checkpoint as INCOMPLETE/);
  });
});

describe('/do:release GitLab paths', () => {
  it('classifies non-conventional commits using the selected forge or a patch fallback', () => {
    const bump = body.slice(body.indexOf('1. **Determine version bump**'), body.indexOf('\n\n2. **Bump version**'));
    assert.match(bump, /using the detected host/);
    assert.match(bump, /On GitHub, use `gh pr list --state merged --search <sha>`/);
    assert.match(bump, /on GitLab, capture `glab api --paginate "projects\/:id\/repository\/commits\/<sha>\/merge_requests"` before parsing/);
    assert.match(bump, /Use the title only when exactly one merged PR\/MR is associated with the commit/);
    assert.match(bump, /lookup fails, is malformed, is ambiguous, or its title has no recognized prefix, default to \*\*patch\*\* bump/);
  });

  it('captures glab api output before parsing the source branch and merged MR URL', () => {
    assert.match(body, /PROJECT_JSON="\$\(glab api "projects\/:id"\)"/);
    assert.match(body, /SOURCE_BRANCH="\$\(printf '%s\\n' "\$PROJECT_JSON" \| jq -er '\.default_branch/);
    assert.doesNotMatch(body, /glab api[^|`\n]*--jq/);
    assert.match(body, /MR_JSON="\$\(glab api "projects\/:id\/merge_requests\/\$PR_NUMBER"\)"/);
    assert.match(body, /MERGE_JSON="\$\(printf '%s\\n' "\$MR_JSON"[\s\\]*\| jq/);
    assert.match(body, /PR_URL="\$\(printf '%s\\n' "\$MR_JSON" \| jq -er '\.web_url \| select\(type == "string" and length > 0\)'/);
  });

  it('checks GitLab MR API calls before parsing them into release candidates', () => {
    assert.match(body, /TARGET_RELEASE_PRS_RESPONSE="\$\(glab api --paginate[\s\S]+?\)"\s+\\\s*\n\s+\|\| incomplete "Merged release MR"/);
    assert.match(body, /TARGET_RELEASE_PRS_JSON="\$\(printf '%s\\n' "\$TARGET_RELEASE_PRS_RESPONSE" \| jq -s 'if length == 0 then error\("expected JSON document"\) elif \(all\(\.\[\]; type == "array"\) \| not\) then error\("expected array pages"\) else add \| if type != "array"/);
    assert.match(body, /RELEASE_PRS_RESPONSE="\$\(glab api --paginate[\s\S]+?\)"\s+\\\s*\n\s+\|\| incomplete "Release MR"/);
    assert.match(body, /RELEASE_PRS_JSON="\$\(printf '%s\\n' "\$RELEASE_PRS_RESPONSE" \| jq -s 'if length == 0 then error\("expected JSON document"\) elif \(all\(\.\[\]; type == "array"\) \| not\) then error\("expected array pages"\) else add \| if type != "array"/);
    assert.doesNotMatch(body, /RELEASE_PRS_JSON[\s\S]{0,300}add \/\/ \[\]/);
    assert.doesNotMatch(body, /TARGET_RELEASE_PRS_JSON[\s\S]{0,300}add \/\/ \[\]/);
    assert.doesNotMatch(body, /glab api --paginate[^\n]*\| *jq/);
  });

  it('detects the code host up front and derives CR_NOUN for messages', () => {
    assert.match(body, /!read lib\/vcs-host\.md/);
    assert.match(body, /\{CR_NOUN\}/);
  });

  it('gives every gh-only checkpoint a glab branch instead of failing on GitLab', () => {
    // Recover Prepared Release State: target-release lookup and merged-PR lookup.
    assert.match(body, /glab release view "v\$\{TARGET_VERSION\}"/);
    assert.match(body, /glab api --paginate "projects\/:id\/merge_requests\?state=merged&target_branch=\{target\}/);

    // Open the Release PR: query + create.
    assert.match(body, /glab api --paginate "projects\/:id\/merge_requests\?source_branch=\{source\}&target_branch=\{target\}/);
    assert.match(body, /glab mr create --source-branch "\{source\}" --target-branch "\{target\}"/);

    // Merging: CI gate + merge command.
    assert.match(body, /glab ci status --wait --branch \{source\}/);
    assert.match(body, /glab mr view "\$PR_NUMBER" --output json --jq \.state/);
    assert.match(body, /glab mr merge "\$PR_NUMBER" --yes/);

    // Post-Merge: merged-MR read-back and release detection (glab release view,
    // for tag/release detection).
    assert.match(body, /glab api "projects\/:id\/merge_requests\/\$PR_NUMBER"/);
    assert.match(body, /glab release view "v\{version\}" -F json/);
  });

  it('never derives a GitLab URL host from GH_HOST, which is only populated on GitHub', () => {
    // Reuses {ORIGIN_HOST} already resolved by lib/vcs-host.md instead of
    // re-typing its origin-parse sed (banned by the GH_HOST-derivation contract).
    assert.doesNotMatch(body, /GL_HOST=/);
    assert.match(body, /https:\/\/\{ORIGIN_HOST\}\/\{owner\}\/\{repo\}\/-\/compare\//);
  });

  it('keeps the GitHub Recover/Post-Merge literals intact for the unchanged GitHub path', () => {
    assert.match(body, /gh api --include --hostname "\{GH_HOST\}" "repos\/\{owner\}\/\{repo\}\/releases\/tags\/v\$\{TARGET_VERSION\}"/);
    assert.match(body, /gh pr list --state merged --base "\{target\}" --limit 100/);
    assert.match(body, /gh pr list --state all --base "\{target\}" --head "\{source\}"/);
    assert.match(body, /gh pr create --title "Release v\{version\}" --base "\{target\}" --head "\{source\}"/);
    assert.match(body, /gh pr view "\$PR_NUMBER" --json state -q \.state/);
    assert.match(body, /gh pr merge "\$PR_NUMBER" --merge/);
  });
});


describe('/do:release source branch admission', () => {
  const { spawnSync } = require('child_process');
  const os = require('os');
  const admission = resolved.slice(
    resolved.indexOf('## Resolve Source Branch Admission'),
    resolved.indexOf('## Open the Release PR'),
  );
  const gate = fs.readFileSync(path.join(__dirname, '..', 'lib', 'release-source-gate.md'), 'utf8');

  // Run the rendered probe block against a stub `gh` that serves canned branch-rules/branch JSON.
  function probe({ rules, branch, fail }) {
    const block = admission.match(/```bash\n([\s\S]*?)\n```/)[1]
      .replace(/\{GH_HOST\}/g, 'github.com').replace(/\{owner\}/g, 'o').replace(/\{repo\}/g, 'r').replace(/\{source\}/g, 'main');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-admission-'));
    try {
      fs.writeFileSync(path.join(dir, 'rules.json'), rules);
      fs.writeFileSync(path.join(dir, 'branch.json'), branch);
      fs.writeFileSync(path.join(dir, 'gh'), [
        '#!/bin/sh',
        `[ -n "${fail || ''}" ] && exit 1`,
        `case "$*" in *rules/branches*) cat "${dir}/rules.json" ;; *) cat "${dir}/branch.json" ;; esac`,
      ].join('\n'), { mode: 0o755 });
      const result = spawnSync('bash', ['-c', block], {
        env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, CLI_TOOL: 'gh' },
        encoding: 'utf8',
      });
      return { status: result.status, out: result.stdout };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  const unprotected = JSON.stringify({ protected: false, protection: { enabled: false, required_status_checks: { enforcement_level: 'off', contexts: [], checks: [] } } });

  it('gates a source whose ruleset requires status checks, even for a bypass-capable actor', () => {
    const r = probe({ rules: JSON.stringify([{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'CI Gate' }] } }]), branch: unprotected });
    assert.equal(r.status, 0);
    assert.match(r.out, /SOURCE_ADMISSION_HANDOFF\tSOURCE_GATED=true/);
  });

  it('gates a source with classic required status checks or a required-PR rule', () => {
    const classic = JSON.stringify({ protected: true, protection: { enabled: true, required_status_checks: { enforcement_level: 'everyone', contexts: ['CI Gate'], checks: [] } } });
    assert.match(probe({ rules: '[]', branch: classic }).out, /SOURCE_GATED=true/);
    assert.match(probe({ rules: JSON.stringify([{ type: 'pull_request' }]), branch: unprotected }).out, /SOURCE_GATED=true/);
  });

  it('gates classic protection that only requires reviews, without waiting for nonexistent checks', () => {
    const reviewsOnly = JSON.stringify({ protected: true, protection: { enabled: true, required_status_checks: { enforcement_level: 'off', contexts: [], checks: [] } } });
    assert.match(probe({ rules: '[]', branch: reviewsOnly }).out, /SOURCE_GATED=true\tSOURCE_CHECKS_REQUIRED=false/);
    assert.match(probe({ rules: JSON.stringify([{ type: 'pull_request' }]), branch: unprotected }).out, /SOURCE_GATED=true\tSOURCE_CHECKS_REQUIRED=false/);
    assert.match(probe({ rules: JSON.stringify([{ type: 'required_status_checks' }]), branch: unprotected }).out, /SOURCE_GATED=true\tSOURCE_CHECKS_REQUIRED=true/);
  });

  it('leaves an unprotected or only force-push-protected source on the direct-push path', () => {
    assert.match(probe({ rules: '[]', branch: unprotected }).out, /SOURCE_GATED=false/);
    const rulesNoGate = JSON.stringify([{ type: 'non_fast_forward' }]);
    assert.match(probe({ rules: rulesNoGate, branch: unprotected }).out, /SOURCE_GATED=false/);
  });

  it('fails closed when the rules cannot be read or parsed', () => {
    const failed = probe({ rules: '[]', branch: unprotected, fail: '1' });
    assert.equal(failed.status, 1);
    assert.match(failed.out, /INCOMPLETE — Source branch admission is unverified/);
    const malformed = probe({ rules: '{"message":"Not Found"}', branch: unprotected });
    assert.equal(malformed.status, 1);
    assert.match(malformed.out, /INCOMPLETE — Source branch admission is unverified/);
  });

  it('runs admission before the release PR, loads the gate only on demand, and never pushes to a gated source', () => {
    assert.ok(body.indexOf('## Resolve Source Branch Admission') > body.indexOf('## Local Code Review'));
    assert.ok(body.indexOf('## Resolve Source Branch Admission') < body.indexOf('## Open the Release PR'));
    assert.match(admission, /^!read lib\/release-source-gate\.md$/m);
    assert.match(body, /\[ "<source-gated>" = "true" \] \|\| git push -u origin "HEAD:refs\/heads\/\{source\}"/);
    assert.match(body, /Do not push yet — publication to `\{source\}` happens only through/);
    assert.doesNotMatch(body, /commit and push\n/);
    assert.match(admission, /Never use bypass permission, force push, or relax the branch protection/);
  });

  it('lands gated work through a temporary branch PR with exact-head verification and CI', () => {
    assert.match(gate, /GATE_BRANCH="release-prep\/v\{version\}"/);
    assert.match(gate, /GATE_TITLE="chore: release v\{version\}"/);
    assert.match(gate, /git push -u origin "HEAD:refs\/heads\/\$GATE_BRANCH"/);
    assert.match(gate, /\[ "\$REMOTE_GATE_SHA" != "\$GATE_SHA" \]/);
    assert.match(gate, /gh pr create --base "\{source\}" --head "\$GATE_BRANCH"/);
    assert.match(gate, /\.headRefOid == \$sha and \(\.state == "OPEN" or \.state == "MERGED"\)/);
    assert.match(gate, /gh pr checks <GATE_PR_NUMBER> --required --watch --fail-fast/);
    assert.match(gate, /none attaching is INCOMPLETE, not green/);
    assert.match(gate, /glab api "projects\/:id\/merge_requests\/<GATE_PR_NUMBER>"/);
    assert.match(gate, /--squash --subject "<GATE_TITLE>"/);
    assert.match(gate, /\.mergedAt \| type == "string"/);
    assert.match(gate, /git merge-base --is-ancestor/);
    assert.match(gate, /never `--admin` or `--auto`/);
    assert.doesNotMatch(gate, /gh pr merge[^\n]*(--admin|--auto)/);
    assert.match(gate, /never force-push, never disable or edit the protection/);
  });

  it('keeps the release PR a source-to-target promotion and routes review fixes through the gate', () => {
    assert.match(admission, /still promotes `\{source\}` into `\{target\}` and shows the full unreleased range/);
    assert.match(gate, /Review fixes under a gated source/);
    assert.match(gate, /release-fix\/v\{version\}-<n>/);
    assert.match(gate, /re-read the release PR's head SHA; it must equal the local `\{source\}` head/);
    assert.match(body, /\*\*Gated source\.\*\* When `SOURCE_GATED=true`, the loops' fix pushes must not land on `\{source\}` directly/);
  });

  it('resumes a pending preparation PR without a second version bump or duplicate PR', () => {
    const recovery = body.slice(body.indexOf('## Recover Prepared Release State'), body.indexOf('## Determine Version and Finalize Changelog'));
    assert.match(recovery, /startswith\("release-prep\/v"\)/);
    assert.match(recovery, /git merge --ff-only FETCH_HEAD/);
    assert.match(recovery, /more than one open release-prep\/v\* PR targets/);
    assert.match(recovery, /the admission procedure then reuses the open PR/);
    assert.match(gate, /resumed run reuses the open or already-merged PR for the same head/);
  });

  it('applies admission to documented project delivery too', () => {
    assert.match(resolved, /Before pushing to any branch — the temporary head or the integration branch — resolve its admission/);
    assert.match(resolved, /INCOMPLETE unless the project documents a PR path for it/);
  });
});
