const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), 'utf8');

// PLAN.md mode was retired: the issue tracker is the only backlog.
describe('PLAN.md mode is retired', () => {
  it('folds the former issue-mode lib back in and retires it from installers', () => {
    assert.equal(fs.existsSync(path.join(root, 'lib', 'replan-issues.md')), false);
    for (const script of ['install.sh', 'uninstall.sh']) {
      const libs = read(script).match(/^LIBS=\(([\s\S]*?)\)/m)[1];
      assert.doesNotMatch(libs, /\breplan-issues\b/, script);
    }
    assert.match(read('uninstall.sh').match(/^OLD_LIBS=\(([\s\S]*?)\)/m)[1], /\breplan-issues\b/);
  });

  it('the repo itself is tracker-only', () => {
    assert.equal(fs.existsSync(path.join(root, 'PLAN.md')), false);
  });
});
