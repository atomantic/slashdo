'use strict';

// #353: /do:replan documented a claim branch pattern (`cos/<task>/<plan-id>/<agent>`)
// that no slashdo command actually uses, put its highest-priority "Next Up" items
// in a section /do:next can never claim (no checkbox, no slug), and loaded ~10.9 KB
// of issue-mode-only libs (gh-host.md + epic-children.md) on every PLAN.md-mode run
// via an unconditional `!`cat`` inside Phase 2. These contracts pin the fix: the
// claim pattern matches /do:next's real convention, "Next Up" is gone in favor of
// an ordered Backlog, and the gh-host/epic-children reads live only in the new
// lib/replan-issues.md, gated behind `!read` + ISSUE_MODE=true.

const fs = require('fs');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { readCommandDocs } = require('./helpers/command-docs');

const REPO_ROOT = path.join(__dirname, '..');
const replan = readCommandDocs('replan.md', { eager: false });
const replanRaw = fs.readFileSync(path.join(REPO_ROOT, 'commands', 'do', 'replan.md'), 'utf8');

describe('/do:replan claim pattern matches /do:next (#353)', () => {
  it('never mentions the nonexistent cos/ branch pattern', () => {
    assert.doesNotMatch(replanRaw, /cos\//);
  });

  it('describes the claim pattern /do:next actually uses', () => {
    assert.match(replan, /`next\/<plan-id>`/);
    assert.match(replan, /`next\/issue-<n>`/);
  });
});

describe('/do:replan Phase 2 no longer eagerly loads issue-mode-only libs (#353)', () => {
  it('the top-level command file does not !cat epic-children.md or gh-host.md', () => {
    assert.doesNotMatch(replanRaw, /!`cat ~\/\.claude\/lib\/epic-children\.md`/);
    assert.doesNotMatch(replanRaw, /!`cat ~\/\.claude\/lib\/gh-host\.md`/);
  });

  it('gates the issue-mode contract behind a single !read, not scattered inline callouts', () => {
    assert.match(replanRaw, /!read lib\/replan-issues\.md/);
    // The gated read is introduced by an explicit ISSUE_MODE=true condition.
    assert.match(replanRaw, /Only when `ISSUE_MODE=true`[\s\S]{0,120}!read lib\/replan-issues\.md/);
  });
});

describe('lib/replan-issues.md carries the moved issue-mode content (#353)', () => {
  const libPath = path.join(REPO_ROOT, 'lib', 'replan-issues.md');

  it('exists', () => {
    assert.ok(fs.existsSync(libPath), 'expected lib/replan-issues.md to exist');
  });

  const content = fs.existsSync(libPath) ? fs.readFileSync(libPath, 'utf8') : '';

  it('carries the epic/gh-host reads previously inlined in replan.md', () => {
    assert.match(content, /!`cat ~\/\.claude\/lib\/gh-host\.md`/);
    assert.match(content, /!`cat ~\/\.claude\/lib\/epic-children\.md`/);
  });

  it('preserves the PLAN.md stub sentinel phrases /do:next detects byte-for-byte', () => {
    assert.match(content, /tracks its roadmap as issues/);
    assert.match(content, /Managed by `\/do:replan --issues`\./);
  });

  it('dedups against existing open issues before filing a create', () => {
    assert.match(content, /Dedup before every create/i);
    assert.match(content, /EXISTING_ISSUES/);
  });

  it('paginates the open-issue listing instead of relying on the unstated 30-item gh default', () => {
    assert.match(content, /--limit 1000/);
  });
});

describe('/do:replan is registered in the curl-installer LIBS allowlist (#353)', () => {
  for (const script of ['install.sh', 'uninstall.sh']) {
    it(`${script} lists replan-issues in LIBS`, () => {
      const body = fs.readFileSync(path.join(REPO_ROOT, script), 'utf8');
      const match = body.match(/^LIBS=\(([\s\S]*?)\)/m);
      assert.ok(match, `${script}: LIBS=( ... ) not found`);
      assert.match(match[1], /\breplan-issues\b/);
    });
  }
});

describe('"Next Up" is claimable — no un-slugged priority section (#353)', () => {
  it('the Phase 4 target structure has no "Next Up" heading', () => {
    assert.doesNotMatch(replanRaw, /## Next Up/);
  });

  it('the Backlog section is documented as the ordered, claimable list', () => {
    assert.match(replanRaw, /"Backlog" is ordered/);
  });

  it('plan-id-format.md no longer singles out "Next Up" as an unslugged convention', () => {
    const planIdFormat = fs.readFileSync(path.join(REPO_ROOT, 'lib', 'plan-id-format.md'), 'utf8');
    assert.doesNotMatch(planIdFormat, /Next Up/);
  });
});

describe('/do:replan Notes no longer contradicts autonomous defaults (#353)', () => {
  it('does not tell the model to ask the user before creating a missing PLAN.md', () => {
    assert.doesNotMatch(replanRaw, /inform the user and offer to create one/);
  });

  it('does not claim reconciling PLAN.md and issues is out of scope', () => {
    assert.doesNotMatch(replanRaw, /reconciling the two is out of scope/);
  });

  it('states the single no-PLAN.md behavior once, in Phase 0', () => {
    assert.match(replanRaw, /autonomous mode creates it from codebase analysis without prompting/);
  });
});

describe('/do:replan Scope no longer lists do:push as an appender (#353)', () => {
  it('do:push is documented as marking items done, not appending them', () => {
    assert.doesNotMatch(replanRaw, /`do:better`, `do:push`, `do:depfree` still append/);
    assert.match(replanRaw, /`do:push` only marks existing items done/);
  });
});

describe('/do:replan Parse Arguments states the precedence rule inline (#353)', () => {
  it('no longer links out to review-config-defaults.md for a one-line rule', () => {
    assert.doesNotMatch(replanRaw, /precedence per \[lib\/review-config-defaults\.md\]/);
    assert.match(replanRaw, /overrides the global `~\/\.claude\/\.slashdo-config\.json`, key by key/);
  });
});
