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
const [readNote, recordNote] = blocks;

it('executes the lifecycle note across a creation retry, a new commit and a new branch', t => {
  assert.equal(blocks.length, 2, 'the partial carries one read block and one record block');
  assert.doesNotMatch(blocks.join('\n'), /\bnode\b/, 'the lifecycle blocks must not need node in the target repo');
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'slashdo-lifecycle-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => {
    const run = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    return run.stdout.trim();
  };
  const bash = script => {
    const run = spawnSync('bash', ['-eu', '-c', script], { cwd, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    return run.stdout.trim();
  };
  const read = () => bash(readNote);
  const record = status => bash(recordNote.replace('{LOCAL_OVERALL_STATUS}', () => status));
  const commit = () => git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-qm', 'change');

  git('init', '-q', '-b', 'feat/delivery.v1');
  commit();
  assert.equal(read(), 'no local review recorded for HEAD');

  record('inconclusive');
  assert.equal(read(), 'local review recorded for HEAD: inconclusive');
  record('clean');
  assert.equal(read(), 'local review recorded for HEAD: clean'); // PR creation retry reuses it
  assert.equal(read(), 'local review recorded for HEAD: clean'); // and stays readable

  commit(); // a rebase or new commit moves HEAD: the changed work is reviewed again
  assert.equal(read(), 'no local review recorded for HEAD');
  assert.match(git('config', '--get', 'branch.feat/delivery.v1.slashdo-local-review'), /^[a-f0-9]{40} clean$/);

  git('checkout', '-qb', 'new-task'); // same HEAD, different delivery
  assert.equal(read(), 'no local review recorded for HEAD');
  record('partial');
  assert.equal(read(), 'local review recorded for HEAD: partial');

  git('checkout', '-q', 'feat/delivery.v1');
  git('branch', '-qD', 'new-task'); // git drops the note with the branch
  assert.equal(spawnSync('git', ['config', '--get', 'branch.new-task.slashdo-local-review'], { cwd }).status, 1);
});
