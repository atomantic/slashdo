'use strict';

// /do:rpr runs the per-host verbs (cr-state, reply-thread, resolve-thread,
// ci-status) from lib/host-github.md or lib/host-gitlab.md. This runs the GitLab
// cr-state filter and checks the fields rpr reads (whole discussions, head pipeline).

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), 'utf8');
const gitlab = read('lib', 'host-gitlab.md');

// jq ships on GitHub's runners; skip rather than fail on a machine without it.
const hasJq = spawnSync('jq', ['--version']).status === 0;

describe('GitLab cr-state fields /do:rpr reads', { skip: !hasJq && 'jq not installed' }, () => {
  const filter = gitlab.match(/^CR_STATE_FILTER='\n([\s\S]*?)'$/m)[1];

  const run = (login, mr) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpr-cr-state-'));
    try {
      const write = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value));
      write('mr.json', mr);
      write('versions.json', [{ head_commit_sha: 'h1', created_at: '2026-01-01T00:00:00.000Z' }]);
      write('approvals.json', { approved_by: [] });
      write('discussions.json', [
        { id: 'd1', notes: [
          { system: false, resolvable: true, resolved: false, author: { username: 'Human' }, body: 'rename this',
            created_at: '2026-01-01T01:00:00.000Z', position: { head_sha: 'h1', new_path: 'a.js', new_line: 7 } },
          { system: true, resolvable: true, resolved: false, author: { username: 'Human' }, body: 'changed this line',
            created_at: '2026-01-01T02:00:00.000Z', position: null },
          { system: false, resolvable: true, resolved: false, author: { username: 'bot' }, body: 'why?',
            created_at: '2026-01-01T03:00:00.000Z', position: null },
        ] },
        { id: 'd2', notes: [{ system: false, resolvable: true, resolved: true, author: { username: 'other' }, body: 'ok',
          created_at: '2026-01-01T04:00:00.000Z', position: null }] },
      ]);
      const args = ['-n', '--arg', 'login', login];
      for (const name of ['mr', 'v', 'd', 'a']) {
        const file = { mr: 'mr.json', v: 'versions.json', d: 'discussions.json', a: 'approvals.json' }[name];
        args.push('--slurpfile', name, path.join(dir, file));
      }
      const result = spawnSync('jq', [...args, filter], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  it('lists every author\'s discussions, with the whole conversation, for an empty login', () => {
    const state = run('', { sha: 'h1', head_pipeline: null });
    assert.deepEqual(state.reviews, [], 'rpr passes no reviewer login, so no reviews are built');
    const unresolved = state.threads.filter((t) => t.resolved === false);
    assert.deepEqual(unresolved.map((t) => [t.id, t.author, t.path, t.line]), [['d1', 'Human', 'a.js', 7]]);
    assert.deepEqual(unresolved[0].comments, [
      { body: 'rename this', author: 'Human' },
      { body: 'why?', author: 'bot' },
    ], 'system notes are not conversation');
    assert.equal(state.pipeline, null);
  });

  it('exposes the head pipeline for ci-status', () => {
    const state = run('', { sha: 'h1', head_pipeline: { id: 42, sha: 'h1', status: 'failed', web_url: 'x' } });
    assert.deepEqual(state.pipeline, { id: 42, sha: 'h1', status: 'failed' });
  });
});
