'use strict';
// #447: the runner's git-metadata verify/restore must be per-key. A concurrent worktree's
// [branch "x"] write must neither fail verification nor be reverted, while a planted
// security-relevant key or hook is still detected and reverted.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const runner = fs.readFileSync(path.join(__dirname, '..', 'lib', 'local-cli-runner.md'), 'utf8');

function bashBlock(heading) {
  const rest = runner.slice(runner.indexOf(heading));
  const start = rest.indexOf('```bash') + '```bash'.length;
  return rest.slice(start, rest.indexOf('\n```', start));
}

function run(mutate, setup = '', after = '') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-meta-'));
  try {
    const sh = (cmd, cwd) => spawnSync('bash', ['-c', cmd], { cwd, encoding: 'utf8' });
    sh('git init -q r && cd r && git -c user.email=a@b -c user.name=n commit -q --allow-empty -m i && git remote add origin https://example.com/x.git && git worktree add -q ../w -b b', dir);
    const wt = path.join(dir, 'w');
    const script = [
      'GIT_COMMON="$(cd "$(git rev-parse --git-common-dir)" && pwd -P)"',
      setup,
      bashBlock('### Snapshot'),
      mutate,
      bashBlock('### Verify and restore'),
      after,
      'echo RESTORE_OK',
      'cat "$GIT_COMMON/config"',
      'echo HOOKS:; ls "$GIT_COMMON/hooks" 2>/dev/null',
    ].join('\n');
    return spawnSync('bash', ['-c', script], { cwd: wt, encoding: 'utf8' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const cfg = (args) => `git config --file "$GIT_COMMON/config" ${args}`;

describe('local-cli-runner git metadata verify/restore (#447)', () => {
  it('neither fails on nor removes a [branch] section added by a concurrent worktree', () => {
    const r = run(cfg('branch.other.remote origin') + '; ' + cfg('branch.other.merge refs/heads/other'));
    assert.match(r.stdout, /RESTORE_OK/, r.stderr);
    assert.match(r.stdout, /\[branch "other"\]/);
    assert.match(r.stderr, /non-security git config changed/);
  });

  for (const [name, mutate] of [
    ['core.hooksPath', cfg('core.hooksPath /evil')],
    ['alias.*', cfg("alias.x '!sh'")],
    ['core.fsmonitor', cfg('core.fsmonitor /evil')],
    ['include.path', cfg('include.path /evil')],
    ['remote.origin.url', cfg('remote.origin.url http://evil')],
    ['diff.external', cfg('diff.external /evil')],
    ['diff.<driver>.command', cfg('diff.x.command /evil')],
    ['interactive.diffFilter', cfg('interactive.diffFilter /evil')],
    ['trailer.<tok>.command', cfg('trailer.x.command /evil')],
    ['core.alternateRefsCommand', cfg('core.alternateRefsCommand /evil')],
    ['uploadpack.packObjectsHook', cfg('uploadpack.packObjectsHook /evil')],
    ['submodule.<n>.update', cfg("submodule.x.update '!/evil'")],
    ['browser.<tool>.cmd', cfg('browser.x.cmd /evil')],
    ['web.browser', cfg('web.browser evil')],
    ['remote.<name>.uploadpack', cfg("remote.origin.uploadpack '/evil'")],
    ['core.attributesFile', cfg('core.attributesFile /evil')],
  ]) {
    it(`still detects and reverts a planted ${name} while keeping concurrent branch config`, () => {
      const r = run(cfg('branch.other.remote origin') + '; ' + mutate);
      assert.match(r.stdout, /RESTORE_OK/, r.stderr);
      assert.doesNotMatch(r.stdout.split('HOOKS:')[0], /evil|alias|fsmonitor|hookspath|\[include\]/i);
      assert.match(r.stdout, /url = https:\/\/example\.com\/x\.git/);
      assert.match(r.stdout, /\[branch "other"\]/);
    });
  }

  it('detects and restores a reordering of credential.helper entries', () => {
    const setup = cfg('--add credential.helper first') + '; ' + cfg('--add credential.helper second');
    const mutate = cfg('--unset-all credential.helper') + '; ' + cfg('--add credential.helper second') + '; ' + cfg('--add credential.helper first');
    const r = run(mutate, setup);
    assert.match(r.stdout, /RESTORE_OK/, r.stderr);
    assert.match(r.stdout, /helper = first\s+helper = second/);
  });

  it('still detects and removes a planted hook', () => {
    const r = run('mkdir -p "$GIT_COMMON/hooks" && echo x > "$GIT_COMMON/hooks/planted-hook"');
    assert.match(r.stdout, /RESTORE_OK/, r.stderr);
    assert.doesNotMatch(r.stdout, /planted-hook/);
  });

  // #507: the hooks fingerprint is path/type/exec-bit/content, not tar metadata.
  const seed = 'mkdir -p "$GIT_COMMON/hooks/sub" && printf "#!/bin/sh\\n" > "$GIT_COMMON/hooks/pre-commit" && chmod 755 "$GIT_COMMON/hooks/pre-commit" && echo d > "$GIT_COMMON/hooks/sub/f" && ln -s pre-commit "$GIT_COMMON/hooks/link"';

  it('restores a hook whose content was modified', () => {
    const r = run('echo evil >> "$GIT_COMMON/hooks/pre-commit"', seed, '[ -f "$GIT_COMMON/hooks/pre-commit" ] && echo HOOK_PRESENT || echo HOOK_MISSING; echo HOOK_BODY=$(tail -n +1 "$GIT_COMMON/hooks/pre-commit" 2>/dev/null | tr "\\n" "|")');
    assert.match(r.stdout, /RESTORE_OK/, r.stderr);
    assert.match(r.stdout, /HOOK_BODY=#!\/bin\/sh\|/);
    assert.doesNotMatch(r.stdout, /HOOK_BODY=.*evil/);
  });

  it('restores a removed hook', () => {
    const r = run('rm "$GIT_COMMON/hooks/pre-commit"', seed, '[ -f "$GIT_COMMON/hooks/pre-commit" ] && echo HOOK_PRESENT || echo HOOK_MISSING; echo HOOK_BODY=$(tail -n +1 "$GIT_COMMON/hooks/pre-commit" 2>/dev/null | tr "\\n" "|")');
    assert.match(r.stdout, /RESTORE_OK/, r.stderr);
    assert.match(r.stdout, /HOOK_PRESENT/);
    assert.doesNotMatch(r.stdout, /HOOK_MISSING/);
  });

  it('detects and restores an executable-bit change', () => {
    const r = run('chmod 644 "$GIT_COMMON/hooks/pre-commit"', seed, '[ -x "$GIT_COMMON/hooks/pre-commit" ] && echo EXEC_RESTORED');
    assert.match(r.stdout, /RESTORE_OK/, r.stderr);
    assert.match(r.stdout, /EXEC_RESTORED/, 'mode change must be reverted to executable');
  });

  it('detects and restores a changed symlink target', () => {
    const r = run('ln -sfn /bin/evil "$GIT_COMMON/hooks/link"', seed, 'echo TARGET=$(readlink "$GIT_COMMON/hooks/link")');
    assert.match(r.stdout, /RESTORE_OK/, r.stderr);
    assert.match(r.stdout, /TARGET=pre-commit/);
  });

  it('verifies clean when only mtimes change (no restore is triggered)', () => {
    // Poison the backup: if the fingerprint reacted to the timestamp change it would restore this
    // tar over hooks/, so a surviving seeded hook and no "poison" file prove no restore ran.
    const poison = 'echo poisoned > "$GIT_META_BAK/poison" && rm -f "$GIT_META_BAK/hooks.tar" && tar -cf "$GIT_META_BAK/hooks.tar" -C "$GIT_META_BAK" poison';
    const r = run(poison + '; touch -t 200001010000 "$GIT_COMMON/hooks" "$GIT_COMMON/hooks/pre-commit" "$GIT_COMMON/hooks/sub"', seed, '[ -f "$GIT_COMMON/hooks/pre-commit" ] && echo HOOK_PRESENT || echo HOOK_MISSING; echo HOOK_BODY=$(tail -n +1 "$GIT_COMMON/hooks/pre-commit" 2>/dev/null | tr "\\n" "|")' + '; [ -e "$GIT_COMMON/hooks/poison" ] && echo POISON_RESTORED');
    assert.match(r.stdout, /RESTORE_OK/, r.stderr);
    assert.match(r.stdout, /HOOK_PRESENT/);
    assert.doesNotMatch(r.stdout, /POISON_RESTORED/);
  });
});

// Snapshot and Verify run as separate tool calls in a harness that starts a fresh shell for each,
// so nothing may depend on shell variables surviving: Verify gets only the two printed values.
describe('local-cli-runner snapshot state survives a fresh shell', () => {
  const sh = (script, cwd) => spawnSync('bash', ['-c', script], { cwd, encoding: 'utf8' });

  function fixture(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-state-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const setup = sh([
      'git init -q r && cd r && git config user.email a@b && git config user.name n',
      'mkdir sub && echo tracked > sub/tracked.txt && echo other > other.txt && echo ignored.log > .gitignore',
      'git add . && git commit -q -m i',
      'echo dirty >> other.txt',                                  // pre-existing unstaged edit
      'echo staged > staged.txt && git add staged.txt',           // pre-existing staged file
      "printf 'mine\\n' > 'un tracked.txt'",                        // pre-existing untracked file
    ].join(' && '), dir);
    assert.equal(setup.status, 0, setup.stderr);
    const repo = path.join(dir, 'r');
    // Snapshot from a subdirectory: the artifacts must still cover the whole repository.
    const snap = sh(bashBlock('### Snapshot'), path.join(repo, 'sub'));
    assert.equal(snap.status, 0, snap.stderr);
    const [, stateDir, sum] = snap.stdout.match(/RUN_STATE_DIR=(\S+) RUN_STATE_SUM=([0-9a-f]{64})/);
    t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
    const verify = (overrides = {}) => sh(
      `RUN_STATE_DIR='${overrides.stateDir ?? stateDir}'\nRUN_STATE_SUM='${overrides.sum ?? sum}'\n${bashBlock('### Verify and restore')}\necho VERIFY_DONE`,
      repo,
    );
    return { repo, stateDir, verify, sh: (script) => sh(script, repo) };
  }

  it('reports a clean tree from a new shell given only the printed values', (t) => {
    const { verify } = fixture(t);
    const r = verify();
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /TREE_STATE=clean\nVERIFY_DONE/);
  });

  it('restores HEAD, index, tracked, and untracked state wholesale and keeps the caller\'s own dirty work', (t) => {
    const { repo, verify, sh: inRepo } = fixture(t);
    const mutate = inRepo([
      'echo hacked > sub/tracked.txt',
      'echo more >> other.txt',
      "echo theirs > 'un tracked.txt'",
      'echo new > planted.txt',
      'git rm -q --cached staged.txt',
      'git add sub/tracked.txt && git commit -q -m "reviewer commit"',
      'git config alias.x "!sh"',
    ].join(' && '));
    assert.equal(mutate.status, 0, mutate.stderr);
    const r = verify();
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /TREE_STATE=restored\nVERIFY_DONE/);
    const read = (name) => fs.readFileSync(path.join(repo, name), 'utf8');
    assert.equal(read('sub/tracked.txt'), 'tracked\n');
    assert.equal(read('other.txt'), 'other\ndirty\n');
    assert.equal(read('un tracked.txt'), 'mine\n');
    assert.equal(fs.existsSync(path.join(repo, 'planted.txt')), false);
    assert.equal(inRepo('git log --format=%s').stdout.trim(), 'i');
    assert.equal(inRepo('git diff --cached --name-only').stdout.trim(), 'staged.txt');
    assert.equal(inRepo('git config --get alias.x').status, 1);
    assert.match(verify().stdout, /TREE_STATE=clean/, 'a second verify sees the restored baseline');
  });

  it('names a gitignored file modified during the pass without touching it', (t) => {
    const { repo, verify } = fixture(t);
    const later = new Date(Date.now() + 5000);
    fs.writeFileSync(path.join(repo, 'ignored.log'), 'secret');
    fs.utimesSync(path.join(repo, 'ignored.log'), later, later);
    const r = verify();
    assert.match(r.stdout, /modified gitignored file[^\n]*ignored\.log/);
    assert.match(r.stdout, /TREE_STATE=clean/);
    assert.equal(fs.readFileSync(path.join(repo, 'ignored.log'), 'utf8'), 'secret');
  });

  it('refuses a state file altered after the snapshot, and missing state, without sourcing it', (t) => {
    const { repo, stateDir, verify } = fixture(t);
    fs.appendFileSync(path.join(stateDir, 'state.sh'), '\ntouch "$REPO_ROOT/STATE_SOURCED"\n');
    for (const r of [verify(), verify({ sum: '' }), verify({ stateDir: path.join(stateDir, 'absent') })]) {
      assert.equal(r.status, 1);
      assert.match(r.stderr, /snapshot state is missing or was altered/);
      assert.doesNotMatch(r.stdout, /VERIFY_DONE/);
    }
    assert.equal(fs.existsSync(path.join(repo, 'STATE_SOURCED')), false);
  });
});
