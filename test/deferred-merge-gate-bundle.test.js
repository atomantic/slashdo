'use strict';

// #510: a deferred release bundle must carry the shared merge gate whenever a
// reachable host reviewer loop's merge verb requires it, and every emitted
// `./name.md` reference must resolve to a file in the bundle.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildPromptBundle, parseFrontmatter } = require('../src/transformer');

const libDir = path.join(__dirname, '..', 'lib');
const releaseBody = parseFrontmatter(
  fs.readFileSync(path.join(__dirname, '..', 'commands', 'do', 'release.md'), 'utf8'),
).body;
const deferred = buildPromptBundle(releaseBody, libDir, { teams: false, defer: true });

describe('deferred release bundle carries the merge gate (#510)', () => {
  it('bundles merge-gate.md as a transitive dependency of the host verb files', () => {
    assert.ok(deferred.files['merge-gate.md'], 'merge-gate.md must be in the bundle');
    assert.ok(deferred.files['host-github.md'], 'host-github.md must be in the bundle');
    assert.ok(deferred.files['host-gitlab.md'], 'host-gitlab.md must be in the bundle');
  });

  it('emits a phase-scoped read for the merge gate from both merge verbs', () => {
    for (const name of ['host-github.md', 'host-gitlab.md']) {
      assert.match(
        deferred.files[name],
        /Read `\.\/merge-gate\.md` before performing this step; required when this step applies\./,
        `${name} must carry a required read of the merge gate at its merge verb`,
      );
    }
  });

  it('keeps the merge procedure deferred rather than inlined into the verb files', () => {
    const gateHeading = fs.readFileSync(path.join(libDir, 'merge-gate.md'), 'utf8')
      .split('\n').find(line => /^#{1,6} /.test(line));
    assert.ok(gateHeading, 'merge-gate.md must have a heading to probe');
    for (const name of ['host-github.md', 'host-gitlab.md']) {
      assert.ok(!deferred.files[name].includes(gateHeading), `${name} must not inline ${gateHeading}`);
    }
    assert.ok(!deferred.body.includes(gateHeading), 'the command body must not inline the merge gate');
  });

  it('resolves every emitted relative reference to a bundled file', () => {
    const emitted = [deferred.body, ...Object.values(deferred.files)].join('\n');
    const refs = [...emitted.matchAll(/`\.\/([A-Za-z0-9._-]+\.md)`/g)].map(m => m[1]);
    assert.ok(refs.includes('merge-gate.md'), 'the merge-gate reference must be emitted');
    for (const ref of new Set(refs)) {
      assert.ok(deferred.files[ref], `emitted ./${ref} must resolve to a bundled file`);
    }
  });
});
