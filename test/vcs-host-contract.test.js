'use strict';

// The forge a repo lives on is decided by its `origin` remote, never by which CLI
// happens to be logged in. `gh auth status` succeeding says only that `gh` is
// usable — on a machine authenticated to both services it succeeds inside a GitLab
// checkout too. Several Phase 0 blocks used to probe `gh` first and fall through to
// `glab` only on failure, so a GitLab repo was routed to `gh` for default-branch
// lookup, issue filing, and PR/MR operations, and could enter a GitHub-only reviewer
// path. lib/vcs-host.md is the single selection rule; this file keeps it honest and
// keeps the auth-first shortcut from growing back anywhere in the tree.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), 'utf8');
const partial = read('lib', 'vcs-host.md');

// A file participates in host selection when it both names the variable and probes
// credentials. Derived from the tree so a new command cannot opt itself out.
const selectionFiles = () => {
  const dirs = [['commands', 'do'], ['lib']];
  return dirs.flatMap((segments) =>
    fs
      .readdirSync(path.join(root, ...segments))
      .filter((entry) => entry.endsWith('.md'))
      .map((entry) => [...segments, entry].join('/'))
  ).filter((rel) => {
    const body = read(rel);
    return body.includes('VCS_HOST') && body.includes('auth status');
  });
};

describe('VCS host selection derives from the remote', () => {
  it('picks the host from origin before any credential probe', () => {
    // Order is asserted inside the selection block itself: the prose above it names
    // both `auth status` commands while explaining why they cannot come first.
    const selection = (partial.match(/```bash\n([\s\S]*?)```/) || [])[1];
    assert.ok(selection, 'lib/vcs-host.md must carry a bash selection block');
    const origin = selection.indexOf('ORIGIN_HOST="$(git remote get-url origin');
    assert.ok(origin > -1, 'the selection block must derive ORIGIN_HOST from the origin remote');
    const firstAuth = selection.indexOf('auth status');
    assert.ok(firstAuth > -1, 'the selection block must still verify the selected CLI');
    assert.ok(
      origin < firstAuth,
      'lib/vcs-host.md probes credentials before reading the remote — that is the bug it exists to prevent',
    );
  });

  it('matches GitLab by hostname substring so self-managed instances work', () => {
    assert.match(partial, /grep -qi gitlab/);
    assert.match(partial, /VCS_HOST=gitlab; CLI_TOOL=glab/);
    assert.match(partial, /VCS_HOST=github; CLI_TOOL=gh/);
  });

  it('reaches the auth-based fallback only when there is no origin remote', () => {
    // The `gh`-first probe is legitimate in exactly one place: a checkout with no
    // origin at all, where there is nothing to derive from. Anywhere earlier and a
    // GitLab repo is decided by a GitHub login again.
    const remoteBranch = partial.indexOf('elif [ -n "$ORIGIN_HOST" ]; then');
    const authFallback = partial.indexOf('if gh auth status --active >/dev/null 2>&1; then VCS_HOST=github');
    assert.ok(remoteBranch > -1, 'lib/vcs-host.md must keep the non-GitLab remote branch');
    assert.ok(authFallback > -1, 'lib/vcs-host.md must keep the no-remote fallback');
    assert.ok(
      remoteBranch < authFallback,
      'the auth-based fallback must sit in the empty-ORIGIN_HOST branch, not ahead of the remote check',
    );
  });

  it('stops explicitly, and without mutating anything, on the failure paths', () => {
    // Both services abort with an actionable message, and neither aborts by guessing
    // the other CLI. An unsupported/ambiguous remote lands on the GitHub branch and is
    // caught by its `gh repo view` precheck.
    assert.match(partial, /gh repo view >\/dev\/null 2>&1 \|\| \{/);
    assert.match(partial, /glab auth status >\/dev\/null 2>&1 \|\| \{/);
    assert.match(partial, /gh auth login --hostname \$ORIGIN_HOST/);
    assert.match(partial, /glab auth login/);
    assert.match(partial, /does not support this forge/);
    assert.equal(
      (partial.match(/exit 1/g) || []).length,
      3,
      'lib/vcs-host.md should stop on exactly its three failure paths',
    );
    for (const mutation of ['gh issue create', 'gh pr create', 'glab mr create', 'git worktree add', 'git checkout -b']) {
      assert.ok(
        !partial.includes(mutation),
        `lib/vcs-host.md must stay non-mutating; found ${mutation}`,
      );
    }
    assert.match(partial, /Credentials for the wrong service are not a fallback/);
  });

  it('never lets a gh auth failure stand in for a GitLab remote, anywhere in the tree', () => {
    // The exact drifted paragraph: probe gh, and on failure declare GitLab.
    const AUTH_FIRST = /`?gh auth status[^\n]*\n?[^\n]*If it\s*\n?[^\n]*fails, run `glab auth status`/;
    const files = selectionFiles();
    assert.ok(files.length >= 6, `expected the host-selecting file set to stay broad, got ${files.join(', ')}`);
    for (const rel of files) {
      assert.doesNotMatch(read(rel), AUTH_FIRST, `${rel} still selects the host from a gh auth failure`);
    }
  });

  it('makes every host-selecting file derive from the remote or defer to the partial', () => {
    const REFERENCES_PARTIAL = /!read lib\/vcs-host\.md|!`cat ~\/\.claude\/lib\/vcs-host\.md`|\(\.\.\/\.\.\/lib\/vcs-host\.md\)/;
    for (const rel of selectionFiles()) {
      if (rel === 'lib/vcs-host.md') continue;
      const body = read(rel);
      assert.ok(
        REFERENCES_PARTIAL.test(body) || body.includes('git remote get-url origin'),
        `${rel} names VCS_HOST and probes credentials but never reads the origin remote — include lib/vcs-host.md`,
      );
    }
  });

  it('selects the host before do-better routes anything through the CLI', () => {
    // Phase 0d asks the forge for the default branch. Selecting after that call would
    // reintroduce the wrong-host routing this partial exists to stop.
    const discovery = read('lib', 'better-discovery.md');
    const include = discovery.indexOf('!read lib/vcs-host.md');
    assert.ok(include > -1, 'lib/better-discovery.md must include lib/vcs-host.md');
    assert.ok(
      include < discovery.indexOf('Record `DEFAULT_BRANCH` via'),
      'lib/better-discovery.md must select the host before the default-branch lookup',
    );
    for (const command of ['better-swift.md', 'depfree.md']) {
      const body = read('commands', 'do', command);
      const at = body.indexOf('!read lib/vcs-host.md');
      assert.ok(at > -1, `commands/do/${command} must include lib/vcs-host.md`);
      assert.ok(
        at < body.indexOf('Record `DEFAULT_BRANCH` via'),
        `commands/do/${command} must select the host before the default-branch lookup`,
      );
    }
  });
});
