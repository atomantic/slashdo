'use strict';

// Execute the actual approval snippets with local forge stubs. No real account,
// network, or repository mutation is involved in these publication checks.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const sha = 'a'.repeat(40);
const hasJq = spawnSync('jq', ['--version']).status === 0;
const hosts = [
  ['github', 'gh', 'lib/review-pr-mode.md'],
  ['gitlab', 'glab', 'lib/review-mr-mode.md'],
];

function run(t, host, cli, file, overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slashdo-approve-'));
  t.after(() => fs.rmSync(dir, { recursive: true }));
  const stub = `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const post = args.includes('POST');
const dismiss = args.includes('PUT');
const call = { args };
if (args.includes('--input')) call.payload = JSON.parse(fs.readFileSync(args[args.indexOf('--input') + 1], 'utf8'));
fs.appendFileSync(process.env.CALLS, JSON.stringify(call) + '\\n');
if (process.env.FAIL_READ === 'true' && !post && !dismiss) process.exit(1);
if (dismiss && process.env.REFUSE_DISMISSAL === 'true') process.exit(1);
if (post && process.env.REFUSE === 'true') process.exit(1);
if (post && process.env.BAD_RESPONSE === 'true') { console.log('{}'); process.exit(0); }
if (process.env.BAD_READ === 'true' && !post) { console.log('bad json'); process.exit(0); }
const login = process.env.LOGIN;
const afterPost = fs.readFileSync(process.env.CALLS, 'utf8').includes('POST');
if (afterPost && !post && !dismiss && process.env.FAIL_AFTER_READ === 'true') process.exit(1);
const head = afterPost && process.env.AFTER_SHA ? process.env.AFTER_SHA : process.env.LIVE_SHA;
const id = process.env.BAD_ID === 'true' ? undefined : 7;
let result;
if (args.includes('user')) result = { login, username: login, id };
else if (dismiss) result = { id: 99, state: 'DISMISSED' };
else if (post) result = { id: 99, user: { login }, state: 'APPROVED', commit_id: process.env.APPROVED_SHA || call.payload?.commit_id || process.env.LIVE_SHA, approved_by: [{ user: { id: 7 } }] };
else result = { head: { sha: head }, sha: head, user: { login: 'author' }, author: { username: 'author' } };
console.log(JSON.stringify(result));
`;
  fs.writeFileSync(path.join(dir, cli), stub, { mode: 0o755 });
  const section = read(file).split('## Approve the reviewed head (all dispositions)')[1];
  assert.ok(section, `${file} must expose approval for both dispositions`);
  const snippet = section.match(/```bash\n([\s\S]*?)```/)[1].replace(/\{(GH_HOST|GL_HOST|OWNER|REPO|GL_PROJECT_ENC|PR_NUM|HEAD_SHA)\}/g,
    (_, key) => ({ GH_HOST: 'github.example.com', GL_HOST: 'gitlab.example.com', OWNER: 'org', REPO: 'repo',
      GL_PROJECT_ENC: 'group%2Fsub%2Frepo', PR_NUM: '42', HEAD_SHA: sha })[key]);
  const result = spawnSync('bash', ['-eu', '-c', snippet], {
    cwd: dir,
    encoding: 'utf8',
    env: { PATH: `${dir}:${process.env.PATH}`, TMPDIR: dir, CALLS: path.join(dir, 'calls'),
      LOGIN: 'reviewer', LIVE_SHA: sha, REVIEW_DRAFT: 'false', APPROVE_ENABLED: 'true',
      REVIEW_COMPLETE: 'true', CRITICAL_REMAINING: '0', ...overrides },
  });
  const callsFile = path.join(dir, 'calls');
  const calls = fs.existsSync(callsFile) ? fs.readFileSync(callsFile, 'utf8').trim().split('\n').map(JSON.parse) : [];
  return { ...result, calls, posts: calls.filter(({ args }) => args.includes('POST')) };
}

for (const [host, cli, file] of hosts) {
  describe(`${host} reviewed-head approval`, { skip: !hasJq && 'jq not installed' }, () => {
    for (const disposition of ['inline', 'apply']) {
      it(`approves a completed ${disposition} review at the reviewed SHA on the target host`, (t) => {
        const result = run(t, host, cli, file, { PR_DISPOSITION: disposition });
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /Approval: recorded/);
        assert.equal(result.posts.length, 1);
        for (const { args } of result.calls) {
          assert.deepEqual(args.slice(0, 3), ['api', '--hostname', `${host}.example.com`]);
        }
        const approval = result.posts[0];
        if (host === 'github') {
          assert.ok(approval.args.includes('repos/org/repo/pulls/42/reviews'));
          assert.equal(approval.payload.event, 'APPROVE');
          assert.equal(approval.payload.commit_id, sha);
        } else {
          assert.ok(approval.args.includes('projects/group%2Fsub%2Frepo/merge_requests/42/approve'));
          assert.ok(approval.args.includes(`sha=${sha}`));
        }
      });
    }

    for (const [name, overrides] of [
      ['draft even with explicit approve and merge', { REVIEW_DRAFT: 'true', MERGE_ENABLED: 'true' }],
      ['opt-out', { APPROVE_ENABLED: 'false' }],
      ['unresolved critical finding', { CRITICAL_REMAINING: '1' }],
      ['unknown finding count', { CRITICAL_REMAINING: '' }],
      ['incomplete review or failed validation', { REVIEW_COMPLETE: 'false' }],
    ]) {
      it(`makes no API calls for ${name}`, (t) => {
        const result = run(t, host, cli, file, overrides);
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(result.calls, []);
        assert.match(result.stdout, /Approval: skipped/);
      });
    }

    it('does not approve its own change, ignoring login case', (t) => {
      const result = run(t, host, cli, file, { LOGIN: 'AUTHOR' });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.posts.length, 0);
      assert.match(result.stdout, /Approval: skipped/);
    });

    it('stops on a changed head without approving or substituting its SHA', (t) => {
      const result = run(t, host, cli, file, { LIVE_SHA: 'b'.repeat(40) });
      assert.equal(result.status, 1);
      assert.equal(result.posts.length, 0);
      assert.match(result.stdout, /head changed/);
    });

    for (const overrides of [{ FAIL_READ: 'true' }, { BAD_READ: 'true' }, { LOGIN: '' }]) {
      it(`never approves unverifiable identity/head: ${JSON.stringify(overrides)}`, (t) => {
        assert.equal(run(t, host, cli, file, overrides).posts.length, 0);
      });
    }

    if (host === 'gitlab') {
      it('requires a verifiable user ID before sending an approval', (t) => {
        const result = run(t, host, cli, file, { BAD_ID: 'true' });
        assert.equal(result.posts.length, 0);
      });
    } else {
      it('withdraws its own approval and stops if the head moves during publication', (t) => {
        const result = run(t, host, cli, file, { AFTER_SHA: 'b'.repeat(40) });
        assert.equal(result.status, 1);
        assert.equal(result.posts.length, 1);
        const dismissals = result.calls.filter(({ args }) => args.includes('PUT'));
        assert.equal(dismissals.length, 1);
        assert.ok(dismissals[0].args.includes('repos/org/repo/pulls/42/reviews/99/dismissals'));
        assert.ok(dismissals[0].args.includes('event=DISMISS'));
        assert.match(result.stdout, /Approval: stale-withdrawn/);
      });

      it('withdraws its approval if the post-publication head cannot be read', (t) => {
        const result = run(t, host, cli, file, { FAIL_AFTER_READ: 'true' });
        assert.equal(result.status, 1);
        assert.equal(result.calls.filter(({ args }) => args.includes('PUT')).length, 1);
        assert.match(result.stdout, /Approval: stale-withdrawn/);
      });

      it('leaves a failed stale-approval withdrawal unresolved and stops before merge', (t) => {
        const result = run(t, host, cli, file, { AFTER_SHA: 'b'.repeat(40), REFUSE_DISMISSAL: 'true' });
        assert.equal(result.status, 1);
        assert.match(result.stdout, /Approval: withdrawal-failed/);
        assert.doesNotMatch(result.stdout, /Approval: recorded/);
      });

      it('does not claim approval of a different response commit', (t) => {
        const result = run(t, host, cli, file, { APPROVED_SHA: 'b'.repeat(40) });
        assert.match(result.stdout, /Approval: unverified/);
      });
    }

    it('preserves a refused approval as refused without retrying', (t) => {
      const result = run(t, host, cli, file, { REFUSE: 'true' });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.posts.length, 1);
      assert.match(result.stdout, /Approval: refused/);
      assert.doesNotMatch(result.stdout, /Approval: recorded/);
    });

    it('does not claim success from an unverified approval response', (t) => {
      const result = run(t, host, cli, file, { BAD_RESPONSE: 'true' });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Approval: unverified/);
    });
  });
}

describe('approval workflow contract', () => {
  it('resolves approval policy independently of merge and preserves the saved false opt-out', () => {
    const review = read('commands/do/review.md');
    const config = read('commands/do/config.md');
    assert.match(review, /--approve and --no-approve cannot be combined/);
    assert.match(review, /explicit flag → project → global → built-in `true`/);
    assert.match(review, /saved `false` is an opt-out, not a missing value/);
    assert.match(review, /approve must be a boolean/);
    assert.match(config, /`--approve` → key `approve`, value `true`\. `--no-approve` → value `false`/);
    assert.match(config, /Valid keys:[^\n]*\bapprove\b/);
    assert.match(config, /approve\s+= \{merged value or "true/);
    assert.match(review, /Local branch mode never approves/);
  });

  it('finishes review and inspects pushed fixes before approval, then re-reads merge gates', () => {
    const review = read('commands/do/review.md');
    assert.ok(review.indexOf('## Final PR/MR approval and merge') > review.indexOf('## Delegated Review Passes'));
    assert.match(review, /inspect the complete final diff after the fixes/);
    assert.match(review, /Only then set `HEAD_SHA` to that final reviewed commit/);
    assert.match(review, /run the partial's merge gates \*\*after\*\* the approval attempt/);
    for (const [, , file] of hosts) {
      const body = read(file);
      assert.doesNotMatch(body, /Never approve\.|Never `APPROVE` automatically/);
      assert.ok(body.indexOf('## Approve the reviewed head') < body.indexOf('## Merge the '));
      assert.match(body, /`REVIEW_COMPLETE=true` and zero CRITICAL findings remain/);
    }
    assert.match(read('lib/review-pr-mode.md'), /--match-head-commit \{HEAD_SHA\}/);
    assert.match(read('lib/review-mr-mode.md'), /`not_approved`/);
  });
});
