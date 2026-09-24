'use strict';

// /do:rpr used to call `gh` directly for every thread operation, so on a GitLab
// MR it could not list, reply to, or resolve a single discussion. It now selects
// the code host with lib/vcs-host.md and runs the per-host verbs (cr-state,
// reply-thread, resolve-thread, ci-status) from lib/host-github.md or
// lib/host-gitlab.md. These contracts pin that routing, the GitLab verb shapes
// rpr reaches, the precise naming of what GitLab cannot do, and — by running
// it — the GitLab cr-state fields rpr reads (whole discussions, head pipeline).

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { readCommandDocs } = require('./helpers/command-docs');

const root = path.join(__dirname, '..');
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), 'utf8');
const rpr = read('commands', 'do', 'rpr.md');
const gitlab = read('lib', 'host-gitlab.md');
const github = read('lib', 'host-github.md');

describe('/do:rpr host routing', () => {
  it('selects the host first and gate-reads one verb file per host', () => {
    const detect = rpr.indexOf('!read lib/vcs-host.md');
    const steps = rpr.indexOf('## Steps');
    assert.ok(detect > -1 && detect < steps, 'rpr must select the code host before step 1');
    const ghVerbs = rpr.indexOf('!read lib/host-github.md');
    const glVerbs = rpr.indexOf('!read lib/host-gitlab.md');
    assert.ok(detect < ghVerbs && ghVerbs < glVerbs && glVerbs < steps);
    assert.match(rpr.slice(detect, ghVerbs), /Only when `CODE_HOST=github`[^\n]*\n\n!read lib\/gh-host\.md\n$/);
    assert.match(rpr.slice(ghVerbs, glVerbs), /Only when `CODE_HOST=gitlab`[^\n]*\n\n$/);
    // gh-host.md aborts when gh is not authenticated, so it must never run eagerly.
    assert.doesNotMatch(rpr, /!`cat ~\/\.claude\/lib\/gh-host\.md`/);
  });

  it('runs thread reads, replies, and resolves through the verbs, never inline gh', () => {
    for (const verb of ['cr-state', 'reply-thread', 'resolve-thread', 'ci-status']) {
      assert.match(rpr, new RegExp('`' + verb + '`'), `rpr must run the ${verb} verb`);
    }
    assert.doesNotMatch(rpr, /resolveReviewThread|reviewThreads\(|addPullRequestReviewThreadReply/,
      'thread GraphQL belongs to lib/host-github.md, not rpr');
    // GitHub reads every thread page and fails closed when one has over 100 comments.
    assert.match(github, /reviews\(first:100, after:\$reviewCursor\)/);
    assert.match(github, /reviewThreads\(first:100, after:\$threadCursor\)/);
    assert.match(github, /comments\(first:100\)/);
  });

  it('reaches the GitLab discussion verbs on a GitLab MR', () => {
    const docs = readCommandDocs('rpr.md', { eager: true });
    assert.ok(docs.includes('glab api --paginate "projects/:id/merge_requests/{PR_NUMBER}/discussions?per_page=100"'),
      'cr-state must list MR discussions');
    assert.ok(docs.includes('glab api --method POST "projects/:id/merge_requests/{PR_NUMBER}/discussions/{THREAD_ID}/notes" --input "$PAYLOAD_FILE"'),
      'reply-thread must post a note in the discussion');
    assert.ok(docs.includes('glab api --method PUT "projects/:id/merge_requests/{PR_NUMBER}/discussions/{THREAD_ID}" -F resolved=true'),
      'resolve-thread must resolve the discussion');
    assert.match(rpr, /Keep `\.threads\[\]` with `resolved == false`/);
    assert.match(rpr, /`\{REVIEWER_LOGIN\}` is empty because rpr reads only threads/);
    assert.match(rpr, /glab mr view --output json/);
  });

  it('follows the glab api capture rule in its own GitLab forms', () => {
    for (const line of rpr.split('\n')) {
      assert.doesNotMatch(line, /glab api[^|`\n]*--jq/, `glab api has no --jq flag: ${line}`);
      assert.doesNotMatch(line, /glab api [^|\n]*\| *jq/, `never pipe glab api straight into jq: ${line}`);
    }
    assert.match(rpr, /glab ci trace "\$JOB_ID"/);
  });

  it('names what GitLab cannot do precisely, never "GitHub only"', () => {
    assert.doesNotMatch(rpr, /GitHub[- ]only/i);
    assert.match(rpr, /copilot is GitHub's reviewer and is unavailable on this gitlab MR — skipped\./);
    assert.match(rpr, /belongs to project <target_project_id>, but the GitLab verbs address this checkout's project <id> \(projects\/:id\)/);
  });

  it('keeps the GitHub path unchanged', () => {
    assert.match(rpr, /gh pr view --json number,url,reviewDecision,reviews,headRefName,baseRefName/);
    assert.match(rpr, /requested_reviewers -f 'reviewers\[\]=copilot-pull-request-reviewer\[bot\]'/);
    assert.match(rpr, /GitHub: `gh pr diff --name-only`/);
    assert.match(rpr, /gh run view "\$RUN_ID" --log-failed/);
  });
});

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
