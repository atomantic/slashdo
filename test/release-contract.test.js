'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const body = fs.readFileSync(path.join(__dirname, '..', 'commands', 'do', 'release.md'), 'utf8');

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

  it('requires mergedAt and mergeCommit instead of trusting merge exit status', () => {
    assert.match(body, /gh pr view "\$PR_NUMBER" --json state,mergedAt,mergeCommit/);
    assert.match(body, /\.state == "MERGED"/);
    assert.match(body, /\.mergedAt \| type == "string"/);
    assert.match(body, /\.mergeCommit\.oid \| type == "string"/);
    assert.match(body, /MERGE_COMMIT="\$\(.*\.mergeCommit\.oid/s);
  });

  it('verifies target ancestry and makes tag publication idempotent', () => {
    assert.match(body, /git ls-remote --heads origin "refs\/heads\/\{target\}"/);
    assert.match(body, /git cat-file -e "\$TARGET_SHA\^\{tree\}"/);
    assert.match(body, /git merge-base --is-ancestor "\$MERGE_COMMIT" "\$TARGET_SHA"/);
    assert.match(body, /refs\/tags\/v\{version\}\^\{/);
    assert.match(body, /refusing to overwrite it/);
    assert.match(body, /git push origin "refs\/tags\/v\{version\}" \|\| true/);
    assert.match(body, /expected \$TARGET_SHA, got \$\{TAG_SHA:-empty\}/);
  });

  it('polls for a published GitHub Release and fails closed on timeout', () => {
    assert.match(body, /for ATTEMPT in \$\(seq 1 30\)/);
    assert.match(body, /gh release view "v\{version\}" --json tagName,isDraft,isPrerelease,publishedAt/);
    assert.match(body, /\.tagName == "v\{version\}"/);
    assert.match(body, /\.isDraft == false/);
    assert.match(body, /\.isPrerelease == false/);
    assert.match(body, /GitHub Release is unverified after the bounded wait/);
  });
});
