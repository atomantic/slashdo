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

test('every config-derived push or delete site carries the inherited-base guard', () => {
  for (const [file, remote, ref] of [
    ['lib/upstream-push.md', 'PUSH_REMOTE', 'PUSH_BRANCH'],
    ['commands/do/pr.md', 'PUSH_REMOTE', 'PUSH_BRANCH'],
    ['commands/do/push.md', 'PUSH_REMOTE', 'PUSH_BRANCH'],
    ['lib/multi-reviewer-loop.md', 'PUSH_REMOTE', 'PUSH_BRANCH'],
    ['lib/review-fix-tail.md', 'PUSH_REMOTE', 'PUSH_BRANCH'],
    ['lib/merge-gate.md', 'UP_REMOTE', 'UP_REF'],
    ['lib/merge-gate.md', 'DEL_REMOTE', 'DEL_REF'],
  ]) {
    assert.match(
      read(file),
      new RegExp(`\\[ "\\$${ref}" = "refs/heads/\\$\\{BASE_BRANCH:-main\\}" \\][^\\n]*; then ${remote}=""; fi`),
      `${file} must clear ${remote} on inherited base tracking`,
    );
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

test('the merge gate guards both the GitHub and GitLab wait-mode pushes', () => {
  const gate = read('lib/merge-gate.md');
  const guards = gate.match(/then UP_REMOTE=""; fi/g) || [];
  assert.equal(guards.length, 2);
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

test('every inherited-base guard site discards the "(unknown)" placeholder', () => {
  for (const f of ['commands/do/pr.md', 'commands/do/push.md', 'lib/merge-gate.md', 'lib/upstream-push.md', 'lib/multi-reviewer-loop.md', 'lib/review-fix-tail.md']) {
    const lines = read(f).split('\n').filter(l => l.includes('BASE_BRANCH="$(') && l.includes('remote show'));
    assert.ok(lines.length > 0, f);
    for (const l of lines) assert.match(l, /\/HEAD branch: \(unknown\)\$\/d;/, f);
  }
});
