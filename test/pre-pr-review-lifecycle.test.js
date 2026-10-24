'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const guide = fs.readFileSync(path.join(root, 'lib/pre-pr-review-lifecycle.md'), 'utf8');
const blocks = [...guide.matchAll(/```bash\n([\s\S]*?)```/g)].map(m => m[1]);

it('executes the installed lifecycle recipe across retries, feedback pushes and new deliveries', t => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'slashdo-lifecycle-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => {
    const run = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    return run.stdout.trim();
  };
  const run = (n, overrides = {}) => spawnSync('bash', ['-eu', '-c', blocks[n]], {
    cwd, encoding: 'utf8', env: { ...process.env, DEFAULT_BRANCH: 'main', PR_URL: '', ...overrides },
  });
  const check = overrides => {
    const result = run(0, overrides);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const commit = () => git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-qm', 'change');
  git('init', '-q', '-b', 'delivery');
  git('remote', 'add', 'origin', 'https://github.com/example/repo.git');
  commit();
  const head = git('rev-parse', 'HEAD');
  assert.equal(check().reuseLocalPhase, false);
  const completed = { LOCAL_OVERALL_STATUS: 'clean', LOCAL_PHASE_START_SHA: head, LOCAL_PHASE_COMMITS: '0' };
  assert.notEqual(run(1, { ...completed, LOCAL_OVERALL_STATUS: 'pending' }).status, 0);
  assert.equal(check().reuseLocalPhase, false);
  assert.equal(run(1, { ...completed, LOCAL_OVERALL_STATUS: 'inconclusive' }).status, 0);
  assert.equal(check().reuseLocalPhase, false);
  assert.equal(check().retryIncompleteLocalPhase, true);
  assert.equal(run(1, completed).status, 0);
  assert.equal(check().reuseLocalPhase, true); // PR creation retries
  const PR_URL = 'https://github.com/example/repo/pull/1';
  assert.equal(run(2, { PR_URL }).status, 0);
  assert.equal(run(2, { PR_URL }).status, 0); // crash/restart binding retry
  for (let n = 0; n < 2; n++) {
    commit();
    const resumed = check({ PR_URL });
    assert.equal(resumed.reuseLocalPhase, true);
    assert.equal(resumed.receipt.reviewedHead, head);
    assert.notEqual(resumed.receipt.reviewedHead, git('rev-parse', 'HEAD'));
  }
  assert.notEqual(run(0, { PR_URL: PR_URL.replace('/1', '/2') }).status, 0);
  assert.notEqual(run(0, { PR_URL, DEFAULT_BRANCH: 'other' }).status, 0);
  git('checkout', '-qb', 'new-task');
  assert.equal(check().reuseLocalPhase, false);
  assert.notEqual(run(0, { PR_URL }).status, 0);
});

it('keeps host CI/review current while preserving pre-PR completion and explicit re-review', () => {
  const pr = fs.readFileSync(path.join(root, 'commands/do/pr.md'), 'utf8');
  assert.ok(pr.indexOf('!read lib/pre-pr-review-lifecycle.md') < pr.indexOf('## Local Code Review'));
  assert.match(pr, /Bind publication once/);
  assert.match(pr, /required hosted reviews and checks on the new HEAD/);
  const review = fs.readFileSync(path.join(root, 'commands/do/review.md'), 'utf8');
  assert.match(review, /explicit invocation.*requests a fresh review/);
});
