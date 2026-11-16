const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

// The guard block lib/upstream-push.md prescribes, run for real in a disposable repo.
const guard = read('lib/upstream-push.md').match(/```bash\n(BR=[\s\S]*?)```/)[1];
const resolve = (cwd) =>
  execFileSync('bash', ['-c', `${guard}\nprintf '%s|%s' "$PUSH_REMOTE" "$PUSH_BRANCH"`], { cwd, encoding: 'utf8' });

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upstream-guard-'));
  const bare = path.join(dir, 'origin.git');
  const main = path.join(dir, 'main');
  git(dir, 'init', '-q', '--bare', '-b', 'main', bare);
  git(dir, 'clone', '-q', bare, main);
  git(main, 'config', 'user.email', 't@example.com');
  git(main, 'config', 'user.name', 't');
  git(main, 'commit', '-q', '--allow-empty', '-m', 'init');
  git(main, 'push', '-q', 'origin', 'main');
  git(main, 'remote', 'set-head', 'origin', 'main');
  return { dir, bare, main };
}

test('a fresh feature worktree cut from origin/main never resolves a default-branch push target', () => {
  const { dir, main } = fixture();
  try {
    const wt = path.join(dir, 'feature');
    git(main, 'worktree', 'add', '-q', '-b', 'feature', wt, 'origin/main');
    assert.equal(git(wt, 'config', 'branch.feature.merge'), 'refs/heads/main', 'precondition: inherited base tracking');
    assert.match(resolve(wt), /^\|/, 'PUSH_REMOTE must be cleared so the branch is handled as unpublished');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('intentional upstream destinations keep their targets', () => {
  const { dir, main } = fixture();
  try {
    git(main, 'push', '-q', 'origin', 'main:feature');
    git(main, 'push', '-q', 'origin', 'main:pr-123-head');
    git(main, 'fetch', '-q', 'origin');
    git(main, 'checkout', '-q', '-b', 'feature', '--track', 'origin/feature');
    assert.equal(resolve(main), 'origin|refs/heads/feature', 'same-name feature upstream');
    git(main, 'checkout', '-q', '-b', 'local-name', '--track', 'origin/pr-123-head');
    assert.equal(resolve(main), 'origin|refs/heads/pr-123-head', 'differently named PR head');
    git(main, 'checkout', '-q', 'main');
    assert.equal(resolve(main), 'origin|refs/heads/main', 'explicit work on the default branch');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the guard resolves a non-main default branch when origin/HEAD is unset', () => {
  const { dir, bare, main } = fixture();
  try {
    git(main, 'checkout', '-q', '-b', 'trunk');
    git(main, 'push', '-q', 'origin', 'trunk');
    git(dir, '--git-dir', bare, 'symbolic-ref', 'HEAD', 'refs/heads/trunk');
    git(main, 'remote', 'set-head', 'origin', '-d');
    const wt = path.join(dir, 'feature');
    git(main, 'worktree', 'add', '-q', '-b', 'feature', wt, 'origin/trunk');
    assert.match(resolve(wt), /^\|/, 'inherited tracking of a non-main default must be cleared');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an unresolvable remote HEAD ("HEAD branch: (unknown)") still clears inherited default-branch tracking', () => {
  const { dir, bare, main } = fixture();
  try {
    git(bare, 'symbolic-ref', 'HEAD', 'refs/heads/does-not-exist');
    git(main, 'remote', 'set-head', 'origin', '-d');
    assert.match(git(main, 'remote', 'show', 'origin'), /HEAD branch: \(unknown\)/, 'precondition: git prints the placeholder');
    const wt = path.join(dir, 'feature');
    git(main, 'worktree', 'add', '-q', '-b', 'feature', wt, 'origin/main');
    assert.match(resolve(wt), /^\|/, 'PUSH_REMOTE must be cleared, not compared against "(unknown)"');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
