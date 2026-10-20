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

function run(mutate, setup = '') {
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
});
