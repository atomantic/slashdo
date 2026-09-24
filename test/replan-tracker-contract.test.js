const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), 'utf8');

// PLAN.md mode was retired: the issue tracker is the only backlog. /do:replan
// triages it and is the one place a legacy PLAN.md is migrated.
describe('/do:replan is tracker-only', () => {
  const replan = read('commands', 'do', 'replan.md');

  it('stages only exact changed paths during the commit phase', () => {
    const commit = replan.slice(replan.indexOf('## Phase 6: Commit'), replan.indexOf('\n## Notes'));
    assert.match(commit, /Stage those paths by name — never stage an entire directory/);
    assert.match(commit, /git add -- PLAN\.md GOALS\.md docs\/path-you-edited\.md/);
    assert.doesNotMatch(commit, /git add -A -- docs/);
    assert.match(commit, /Omit any example path that this run did not change/);
  });

  it('drops the PLAN.md mode machinery', () => {
    assert.doesNotMatch(replan, /ISSUE_MODE/);
    assert.doesNotMatch(replan, /plan-id-format/);
    assert.doesNotMatch(replan, /Issue mode/i);
    assert.doesNotMatch(replan, /cos\//);
    assert.doesNotMatch(replan, /tracks its roadmap as issues/);
  });

  it('keeps --issues as a deprecated no-op and rejects --no-issues', () => {
    assert.doesNotMatch(replan.split('---')[1], /--issues\|/);
    assert.match(replan, /--issues is now the default \(PLAN\.md mode was removed\); the flag can be dropped\./);
    assert.match(replan, /--no-issues is no longer supported: PLAN\.md mode was removed\. slashdo records work only in the project's issue tracker\./);
  });

  it('loads the epic/GH_HOST partials with a deferred read at the triage step', () => {
    assert.match(replan, /^!read lib\/gh-host\.md$/m);
    assert.match(replan, /^!read lib\/epic-children\.md$/m);
    assert.doesNotMatch(replan, /!`cat ~\/\.claude\/lib\/(gh-host|epic-children)\.md`/);
  });

  it('keeps the #353 fixes: next/issue claim, paginated lists, full-tracker dedup, inline precedence', () => {
    assert.match(replan, /`next\/issue-<n>`/);
    assert.match(replan, /^!read lib\/vcs-host\.md$/m);
    assert.match(replan, /--state open --limit 1000/);
    assert.match(replan, /Dedup before every create/);
    assert.match(replan, /EXISTING_ISSUES/);
    assert.match(replan, /--add-label <PLAN_LABEL>/);
    assert.match(replan, /overrides the global `~\/\.claude\/\.slashdo-config\.json`, key by key/);
    assert.doesNotMatch(replan, /review-config-defaults|replan-issues/);
  });

  it('keeps GitLab native blockers out of stale auto-closure', () => {
    assert.match(replan, /GitLab's Issue Links API filtered to `link_type == "is_blocked_by"`/);
    assert.match(replan, /treat any linked issue whose `\.state` is not `closed` as open/);
    assert.match(replan, /A failed `glab api` call, non-array response, or matching link without a string `\.state` is `UNRESOLVED`, not unblocked/);
    assert.match(replan, /protect that issue from automatic stale closure for this run/);
    assert.match(replan, /command -v jq/);
    assert.match(replan, /Blocked or unresolved issues are not stale/);
  });

  it('folds the former issue-mode lib back in and retires it from installers', () => {
    assert.equal(fs.existsSync(path.join(root, 'lib', 'replan-issues.md')), false);
    for (const script of ['install.sh', 'uninstall.sh']) {
      const libs = read(script).match(/^LIBS=\(([\s\S]*?)\)/m)[1];
      assert.doesNotMatch(libs, /\breplan-issues\b/, script);
    }
    assert.match(read('uninstall.sh').match(/^OLD_LIBS=\(([\s\S]*?)\)/m)[1], /\breplan-issues\b/);
  });

  it('migrates a legacy PLAN.md once, deduped, then removes it', () => {
    assert.match(replan, /## Phase 4: Retire the Legacy PLAN\.md/);
    assert.match(replan, /\*\*Delete `PLAN\.md`\*\*/);
    assert.match(replan, /`## Open question`[\s\S]{0,80}`needs-decision`/);
  });
});

describe('docs and sibling commands no longer describe a PLAN.md mode', () => {
  it('help and README describe tracker-based work tracking', () => {
    const help = read('commands', 'do', 'help.md');
    const readme = read('README.md');
    assert.doesNotMatch(help, /with `--issues`/);
    assert.doesNotMatch(readme, /## Issue mode/);
    assert.match(readme, /## Work tracking/);
    assert.doesNotMatch(readme, /\/do:config --issues\\\|--no-issues/);
  });

  it('goals and plan-task never write PLAN.md', () => {
    assert.doesNotMatch(read('commands', 'do', 'goals.md'), /plan-id-format|to PLAN\.md automatically/);
    assert.doesNotMatch(read('commands', 'do', 'plan-task.md'), /PLAN\.md/);
  });

  it('the repo itself is tracker-only', () => {
    assert.equal(fs.existsSync(path.join(root, 'PLAN.md')), false);
  });
});
