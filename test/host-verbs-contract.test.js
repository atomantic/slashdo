'use strict';

// The reviewer loop is host-neutral (lib/host-reviewer-loop.md) and names verbs; each
// code host implements them in its own file (lib/host-github.md, lib/host-gitlab.md).
// These tests run what those files ship: the per-host login grammar regex, and the
// GitLab `cr-state` normalization that turns MR notes and approvals into reviews of a
// specific commit.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), 'utf8');
const readLib = (name) => read('lib', name);

const HOST_FILES = { github: 'host-github.md', gitlab: 'host-gitlab.md' };
const grammarOf = (body) => {
  const section = body.slice(body.indexOf('### Login grammar'));
  const match = section.match(/`(\^[^`]+\$)`/);
  assert.ok(match, 'each verb file states its login grammar as a regex');
  return new RegExp(match[1]);
};

describe('@<login> grammar per host', () => {
  const github = grammarOf(readLib(HOST_FILES.github));
  const gitlab = grammarOf(readLib(HOST_FILES.gitlab));

  it('accepts each host\'s real usernames and rejects the other\'s', () => {
    for (const login of ['octocat', 'org-review-bot', 'some-app[bot]', 'a1']) assert.match(login, github);
    for (const login of ['jane.doe', 'project_42_bot', '_svc', 'a-b.c_d']) {
      assert.match(login, gitlab);
      assert.doesNotMatch(login, github, `${login} is not a valid GitHub login`);
    }
    for (const login of ['-lead', 'trail.', '.dot', 'x[bot]', 'a b']) {
      assert.doesNotMatch(login, gitlab, `${login} is not a valid GitLab username`);
    }
    for (const login of ['-lead', 'jane.doe', '_svc']) assert.doesNotMatch(login, github);
  });
});

// Run the GitLab cr-state jq filter against fixture API responses. jq ships on
// GitHub's runners; skip rather than fail on a machine without it.
const hasJq = spawnSync('jq', ['--version']).status === 0;

describe('GitLab cr-state normalization', { skip: !hasJq && 'jq not installed' }, () => {
  const filter = readLib(HOST_FILES.gitlab).match(/^CR_STATE_FILTER='\n([\s\S]*?)'$/m)[1];

  const run = ({ approvedBy = [], discussions }) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-state-'));
    try {
      const write = (name, value) => fs.writeFileSync(path.join(dir, name), value);
      write('mr.json', JSON.stringify({ sha: 'head3' }));
      write('versions.json', JSON.stringify([
        { head_commit_sha: 'head1', created_at: '2026-01-01T00:00:00.000Z' },
        { head_commit_sha: 'head2', created_at: '2026-01-02T00:00:00.000Z' },
        { head_commit_sha: 'head3', created_at: '2026-01-03T00:00:00.000Z' },
      ]));
      // --paginate emits one array per page; the filter must merge the stream.
      write('discussions.json', discussions.map((page) => JSON.stringify(page)).join('\n'));
      write('approvals.json', JSON.stringify({ approved_by: approvedBy.map((username) => ({ user: { username } })) }));
      const result = spawnSync('jq', ['-n', '--arg', 'login', 'rev.bot',
        '--slurpfile', 'mr', path.join(dir, 'mr.json'), '--slurpfile', 'v', path.join(dir, 'versions.json'),
        '--slurpfile', 'd', path.join(dir, 'discussions.json'), '--slurpfile', 'a', path.join(dir, 'approvals.json'),
        filter], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  const note = (fields) => ({ system: false, resolvable: false, position: null, author: { username: 'Rev.Bot' }, ...fields });
  const discussions = [
    [
      { id: 'old', notes: [note({ body: 'stale remark', created_at: '2026-01-01T01:00:00.000Z' })] },
      { id: 't1', notes: [note({ body: 'fix this', created_at: '2026-01-02T01:00:00.000Z', resolvable: true, resolved: false,
        position: { head_sha: 'head2', new_path: 'a.js', new_line: 3 } })] },
    ],
    [
      { id: 'ap', notes: [note({ system: true, body: 'approved this merge request', created_at: '2026-01-02T02:00:00.000Z' })] },
      { id: 'o1', notes: [note({ author: { username: 'someone-else' }, body: 'x', created_at: '2026-01-02T03:00:00.000Z', resolvable: true, resolved: true })] },
    ],
  ];

  it('maps each note to the commit it reviewed and keeps the head', () => {
    const state = run({ approvedBy: ['rev.bot'], discussions });
    assert.equal(state.head, 'head3');
    const byCommit = Object.fromEntries(state.reviews.map((r) => [r.commit, r]));
    assert.deepEqual(Object.keys(byCommit).sort(), ['head1', 'head2']);
    // A note written before the latest push reviewed the older version, so it can
    // never satisfy the current-head gate.
    assert.equal(byCommit.head1.state, 'COMMENTED');
    assert.equal(byCommit.head1.body, 'stale remark');
    assert.equal(byCommit.head2.state, 'APPROVED');
    assert.equal(byCommit.head2.submittedAt, '2026-01-02T02:00:00.000Z');
    assert.equal(byCommit.head2.body, '', 'a diff note is a thread, not review-body feedback');
    assert.equal(byCommit.head3, undefined, 'the newer MR head has no review until a note covers it');
  });

  it('reports resolvable discussions as threads with their author', () => {
    const { threads } = run({ approvedBy: ['rev.bot'], discussions });
    assert.deepEqual(threads.map((t) => [t.id, t.author, t.resolved, t.path, t.line]), [
      ['t1', 'Rev.Bot', false, 'a.js', 3],
      ['o1', 'someone-else', true, null, null],
    ]);
  });

  it('drops a withdrawn approval and reads requested changes', () => {
    const unapproved = run({ approvedBy: [], discussions });
    assert.equal(unapproved.reviews.find((r) => r.commit === 'head2').state, 'COMMENTED');

    const approvalOnly = run({ approvedBy: [], discussions: [[discussions[1][0]]] });
    assert.deepEqual(approvalOnly.reviews, [], 'an approval-only review that was withdrawn is no review');

    const changes = run({ discussions: [[{ id: 'rc', notes: [note({ system: true, body: 'requested changes', created_at: '2026-01-02T04:00:00.000Z' })] }]] });
    assert.deepEqual(changes.reviews.map((r) => [r.commit, r.state]), [['head2', 'CHANGES_REQUESTED']]);
  });
});
