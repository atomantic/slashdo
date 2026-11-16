const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseManifest } = require('../scripts/build-install-manifest');

const root = path.join(__dirname, '..');
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), 'utf8');

// PLAN.md mode was retired: the issue tracker is the only backlog.
describe('PLAN.md mode is retired', () => {
  it('folds the former issue-mode lib back in and retires it from installers', () => {
    assert.equal(fs.existsSync(path.join(root, 'lib', 'replan-issues.md')), false);
    // The curl installer's manifest no longer ships it, but still retires it.
    const manifest = parseManifest(read('install-manifest.txt'));
    assert.ok(!manifest.libs.includes('replan-issues.md'));
    assert.ok(manifest['retired-libs'].includes('replan-issues.md'));
  });

  it('the repo itself is tracker-only', () => {
    assert.equal(fs.existsSync(path.join(root, 'PLAN.md')), false);
  });
});
