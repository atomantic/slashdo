'use strict';
// lib/local-cli-runner.sh, executed directly in throwaway repositories under the
// OS temp directory (never this checkout). Covers the git-metadata verify/restore
// (#447, #507), the fresh-shell state handoff (#530), the tamper refusals, and
// the launch/wait pair (#532).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const RUNNER = path.join(__dirname, '..', 'lib', 'local-cli-runner.sh');
const q = (value) => `'${value.replace(/'/g, `'\\''`)}'`;

// Each fixture gets its own TMPDIR beside (never inside) the repository, so the
// runner's state directory and logs are removed with the fixture.
function sandbox(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const tmp = path.join(dir, 'tmp');
  fs.mkdirSync(tmp);
  const sh = (script, cwd = dir, extraEnv = {}) => new Promise((resolve, reject) => {
    const child = spawn('bash', ['-c', script], { cwd, env: { ...process.env, TMPDIR: tmp, ...extraEnv } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
  return { dir, tmp, sh };
}

const snapshotThenVerify = [
  'out=$(bash "$RUNNER" snapshot) || exit 1',
  'eval "$out"',   // test paths hold no spaces
];

async function run(t, mutate, setup = '', after = '') {
  const { dir, sh } = sandbox(t);
  await sh('git init -q r && cd r && git -c user.email=a@b -c user.name=n commit -q --allow-empty -m i && git remote add origin https://example.com/x.git && git worktree add -q ../w -b b');
  const script = [
    `RUNNER=${q(RUNNER)}`,
    'GIT_COMMON="$(cd "$(git rev-parse --git-common-dir)" && pwd -P)"',
    setup,
    ...snapshotThenVerify,
    mutate,
    'bash "$RUNNER" verify --state-dir "$RUN_STATE_DIR" --sum "$RUN_STATE_SUM" || exit 1',
    after,
    'echo RESTORE_OK',
    'cat "$GIT_COMMON/config"',
    'echo HOOKS:; ls "$GIT_COMMON/hooks" 2>/dev/null',
  ].join('\n');
  return sh(script, path.join(dir, 'w'));
}

const cfg = (args) => `git config --file "$GIT_COMMON/config" ${args}`;

describe('local-cli-runner git metadata verify/restore (#447)', { concurrency: true }, () => {
  it('neither fails on nor removes a [branch] section added by a concurrent worktree', async (t) => {
    const r = await run(t, cfg('branch.other.remote origin') + '; ' + cfg('branch.other.merge refs/heads/other'));
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
    it(`still detects and reverts a planted ${name} while keeping concurrent branch config`, async (t) => {
      const r = await run(t, cfg('branch.other.remote origin') + '; ' + mutate);
      assert.match(r.stdout, /RESTORE_OK/, r.stderr);
      assert.doesNotMatch(r.stdout.split('HOOKS:')[0], /evil|alias|fsmonitor|hookspath|\[include\]/i);
      assert.match(r.stdout, /url = https:\/\/example\.com\/x\.git/);
      assert.match(r.stdout, /\[branch "other"\]/);
    });
  }

  it('detects and restores a reordering of credential.helper entries', async (t) => {
    const setup = cfg('--add credential.helper first') + '; ' + cfg('--add credential.helper second');
    const mutate = cfg('--unset-all credential.helper') + '; ' + cfg('--add credential.helper second') + '; ' + cfg('--add credential.helper first');
    const r = await run(t, mutate, setup);
    assert.match(r.stdout, /RESTORE_OK/, r.stderr);
    assert.match(r.stdout, /helper = first\s+helper = second/);
  });

  it('still detects and removes a planted hook', async (t) => {
    const r = await run(t, 'mkdir -p "$GIT_COMMON/hooks" && echo x > "$GIT_COMMON/hooks/planted-hook"');
    assert.match(r.stdout, /RESTORE_OK/, r.stderr);
    assert.doesNotMatch(r.stdout, /planted-hook/);
  });

  // #507: the hooks fingerprint is path/type/exec-bit/content, not tar metadata.
  const seed = 'mkdir -p "$GIT_COMMON/hooks/sub" && printf "#!/bin/sh\\n" > "$GIT_COMMON/hooks/pre-commit" && chmod 755 "$GIT_COMMON/hooks/pre-commit" && echo d > "$GIT_COMMON/hooks/sub/f" && ln -s pre-commit "$GIT_COMMON/hooks/link"';
  const hookBody = '[ -f "$GIT_COMMON/hooks/pre-commit" ] && echo HOOK_PRESENT || echo HOOK_MISSING; echo HOOK_BODY=$(tail -n +1 "$GIT_COMMON/hooks/pre-commit" 2>/dev/null | tr "\\n" "|")';

  it('restores a hook whose content was modified', async (t) => {
    const r = await run(t, 'echo evil >> "$GIT_COMMON/hooks/pre-commit"', seed, hookBody);
    assert.match(r.stdout, /RESTORE_OK/, r.stderr);
    assert.match(r.stdout, /HOOK_BODY=#!\/bin\/sh\|/);
    assert.doesNotMatch(r.stdout, /HOOK_BODY=.*evil/);
  });

  it('restores a removed hook', async (t) => {
    const r = await run(t, 'rm "$GIT_COMMON/hooks/pre-commit"', seed, hookBody);
    assert.match(r.stdout, /RESTORE_OK/, r.stderr);
    assert.match(r.stdout, /HOOK_PRESENT/);
    assert.doesNotMatch(r.stdout, /HOOK_MISSING/);
  });

  it('detects and restores an executable-bit change', async (t) => {
    const r = await run(t, 'chmod 644 "$GIT_COMMON/hooks/pre-commit"', seed, '[ -x "$GIT_COMMON/hooks/pre-commit" ] && echo EXEC_RESTORED');
    assert.match(r.stdout, /RESTORE_OK/, r.stderr);
    assert.match(r.stdout, /EXEC_RESTORED/, 'mode change must be reverted to executable');
  });

  it('detects and restores a changed symlink target', async (t) => {
    const r = await run(t, 'ln -sfn /bin/evil "$GIT_COMMON/hooks/link"', seed, 'echo TARGET=$(readlink "$GIT_COMMON/hooks/link")');
    assert.match(r.stdout, /RESTORE_OK/, r.stderr);
    assert.match(r.stdout, /TARGET=pre-commit/);
  });

  it('verifies clean when only mtimes change (no restore is triggered)', async (t) => {
    // The hooks backup is checksummed, so it cannot be poisoned to observe a restore;
    // the restore's own note on stderr is the signal instead.
    const r = await run(t, 'touch -t 200001010000 "$GIT_COMMON/hooks" "$GIT_COMMON/hooks/pre-commit" "$GIT_COMMON/hooks/sub"', seed, hookBody);
    assert.match(r.stdout, /RESTORE_OK/, r.stderr);
    assert.match(r.stdout, /HOOK_PRESENT/);
    assert.doesNotMatch(r.stderr, /restored git hooks/);
    assert.match(r.stdout, /TREE_STATE=clean/);
  });
});

// Snapshot and Verify run as separate tool calls in a harness that starts a fresh shell for each,
// so nothing may depend on shell variables surviving: Verify gets only the two printed values.
describe('local-cli-runner snapshot state survives a fresh shell', { concurrency: true }, () => {
  async function fixture(t) {
    const { dir, sh } = sandbox(t);
    const setup = await sh([
      'git init -q r && cd r && git config user.email a@b && git config user.name n',
      'mkdir sub && echo tracked > sub/tracked.txt && echo other > other.txt && echo ignored.log > .gitignore',
      'git add . && git commit -q -m i',
      'echo dirty >> other.txt',                                  // pre-existing unstaged edit
      'echo staged > staged.txt && git add staged.txt',           // pre-existing staged file
      "printf 'mine\\n' > 'un tracked.txt'",                        // pre-existing untracked file
    ].join(' && '));
    assert.equal(setup.status, 0, setup.stderr);
    const repo = path.join(dir, 'r');
    // Snapshot from a subdirectory: the artifacts must still cover the whole repository.
    const snap = await sh(`bash ${q(RUNNER)} snapshot`, path.join(repo, 'sub'));
    assert.equal(snap.status, 0, snap.stderr);
    const [, stateDir, sum] = snap.stdout.match(/^RUN_STATE_DIR=(\S+) RUN_STATE_SUM=([0-9a-f]{64}) RUNNER_SUM=[0-9a-f]{40,64}\n$/);
    const verify = (overrides = {}) => sh(
      `bash ${q(RUNNER)} verify --state-dir ${q(overrides.stateDir ?? stateDir)} --sum ${q(overrides.sum ?? sum)} && echo VERIFY_DONE`,
      repo,
    );
    return { repo, stateDir, sum, verify, sh: (script, env) => sh(script, repo, env) };
  }

  it('reports a clean tree from a new shell given only the printed values', async (t) => {
    const { verify } = await fixture(t);
    const r = await verify();
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /TREE_STATE=clean\nVERIFY_DONE/);
  });

  it('takes the two values from the environment as well as from options', async (t) => {
    const { stateDir, sum, sh } = await fixture(t);
    const r = await sh(`bash ${q(RUNNER)} verify`, { RUN_STATE_DIR: stateDir, RUN_STATE_SUM: sum });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /TREE_STATE=clean/);
  });

  it('restores HEAD, index, tracked, and untracked state wholesale and keeps the caller\'s own dirty work', async (t) => {
    const { repo, verify, sh: inRepo } = await fixture(t);
    const mutate = await inRepo([
      'echo hacked > sub/tracked.txt',
      'echo more >> other.txt',
      "echo theirs > 'un tracked.txt'",
      'echo new > planted.txt',
      'git rm -q --cached staged.txt',
      'git add sub/tracked.txt && git commit -q -m "reviewer commit"',
      'git config alias.x "!sh"',
    ].join(' && '));
    assert.equal(mutate.status, 0, mutate.stderr);
    const r = await verify();
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /TREE_STATE=restored\nVERIFY_DONE/);
    const read = (name) => fs.readFileSync(path.join(repo, name), 'utf8');
    assert.equal(read('sub/tracked.txt'), 'tracked\n');
    assert.equal(read('other.txt'), 'other\ndirty\n');
    assert.equal(read('un tracked.txt'), 'mine\n');
    assert.equal(fs.existsSync(path.join(repo, 'planted.txt')), false);
    assert.equal((await inRepo('git log --format=%s')).stdout.trim(), 'i');
    assert.equal((await inRepo('git diff --cached --name-only')).stdout.trim(), 'staged.txt');
    assert.equal((await inRepo('git config --get alias.x')).status, 1);
    assert.match((await verify()).stdout, /TREE_STATE=clean/, 'a second verify sees the restored baseline');
  });

  it('names a gitignored file modified during the pass without touching it', async (t) => {
    const { repo, verify } = await fixture(t);
    const later = new Date(Date.now() + 5000);
    fs.writeFileSync(path.join(repo, 'ignored.log'), 'secret');
    fs.utimesSync(path.join(repo, 'ignored.log'), later, later);
    const r = await verify();
    assert.match(r.stdout, /modified gitignored file[^\n]*ignored\.log/);
    assert.match(r.stdout, /TREE_STATE=clean/);
    assert.equal(fs.readFileSync(path.join(repo, 'ignored.log'), 'utf8'), 'secret');
  });

  it('refuses a state file altered after the snapshot, and missing state, without sourcing it', async (t) => {
    const { repo, stateDir, verify } = await fixture(t);
    fs.appendFileSync(path.join(stateDir, 'state.sh'), '\ntouch "$REPO_ROOT/STATE_SOURCED"\n');
    for (const r of [await verify(), await verify({ sum: '' }), await verify({ stateDir: path.join(stateDir, 'absent') })]) {
      assert.equal(r.status, 1);
      assert.match(r.stderr, /snapshot state is missing or was altered/);
      assert.doesNotMatch(r.stdout, /VERIFY_DONE|TREE_STATE/);
    }
    assert.equal(fs.existsSync(path.join(repo, 'STATE_SOURCED')), false);
  });

  for (const backup of ['untracked.tar', 'gitmeta/config', 'gitmeta/hooks.tar']) {
    it(`refuses to restore from a rewritten ${backup} backup`, async (t) => {
      const { repo, stateDir, verify } = await fixture(t);
      fs.writeFileSync(path.join(repo, 'sub', 'tracked.txt'), 'hacked\n');
      fs.appendFileSync(path.join(stateDir, ...backup.split('/')), 'x');
      const r = await verify();
      assert.equal(r.status, 1);
      assert.match(r.stderr, /snapshot state is missing or was altered/);
      assert.doesNotMatch(r.stdout, /TREE_STATE/);
      assert.equal(fs.readFileSync(path.join(repo, 'sub', 'tracked.txt'), 'utf8'), 'hacked\n', 'nothing was restored');
    });
  }

  it('reports restore-failed and exits non-zero when the tree cannot be put back', async (t) => {
    const { repo, sh } = await fixture(t);
    // A fake git that lets every inspection through but turns read-tree into a no-op,
    // so the restored index never matches the baseline.
    const bin = path.join(repo, '..', 'bin');
    fs.mkdirSync(bin);
    const realGit = spawnSync('bash', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
    fs.writeFileSync(path.join(bin, 'git'),
      `#!/bin/sh\nfor a in "$@"; do [ "$a" = read-tree ] && exit 0; done\nexec ${q(realGit)} "$@"\n`, { mode: 0o755 });
    const snap = await sh(`bash ${q(RUNNER)} snapshot`);
    const [, stateDir, sum] = snap.stdout.match(/RUN_STATE_DIR=(\S+) RUN_STATE_SUM=(\S+) /);
    assert.equal((await sh('git rm -q --cached staged.txt')).status, 0);
    const r = await sh(`bash ${q(RUNNER)} verify --state-dir ${q(stateDir)} --sum ${q(sum)}`, { PATH: `${bin}:${process.env.PATH}` });
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stdout, /TREE_STATE=restore-failed/);
  });
});

describe('local-cli-runner refuses to protect a tree it lives in', { concurrency: true }, () => {
  async function repo(t) {
    const { dir, sh } = sandbox(t);
    assert.equal((await sh('git init -q r && cd r && git -c user.email=a@b -c user.name=n commit -q --allow-empty -m i')).status, 0);
    return { dir, sh, root: path.join(dir, 'r') };
  }

  it('when the runner script is inside the working tree', async (t) => {
    const { sh, root } = await repo(t);
    fs.copyFileSync(RUNNER, path.join(root, 'runner.sh'));
    const r = await sh('bash runner.sh snapshot', root);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /runner is installed inside the working tree/);
    assert.doesNotMatch(r.stdout, /RUN_STATE_DIR/);
  });

  it('when TMPDIR would put the state directory inside the working tree', async (t) => {
    const { sh, root } = await repo(t);
    fs.mkdirSync(path.join(root, 'tmp'));
    const r = await sh(`bash ${q(RUNNER)} snapshot`, root, { TMPDIR: path.join(root, 'tmp') });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /temp directory is inside the working tree/);
  });

  it('outside a git repository', async (t) => {
    const { dir, sh } = await repo(t);
    const r = await sh(`bash ${q(RUNNER)} snapshot`, dir, { GIT_CEILING_DIRECTORIES: dir });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /^cannot snapshot/);
  });
});

// The contract's Verify block, as the installer renders it for an installed copy:
// its hash check is prompt-level code that must refuse a rewritten script before
// running any of it (a CLI that can write outside the repo can reach the install).
describe('local-cli-runner contract refuses a runner rewritten during the pass', { concurrency: true }, () => {
  const contract = fs.readFileSync(path.join(__dirname, '..', 'lib', 'local-cli-runner.md'), 'utf8');
  const afterVerify = contract.slice(contract.indexOf('**Verify and restore**'));
  const verifyBlock = afterVerify.slice(afterVerify.indexOf('```bash\n') + 8, afterVerify.indexOf('\n```', afterVerify.indexOf('```bash\n')));

  async function installed(t) {
    const { dir, sh } = sandbox(t);
    assert.equal((await sh('git init -q r && cd r && git -c user.email=a@b -c user.name=n commit -q --allow-empty -m i')).status, 0);
    const root = path.join(dir, 'r');
    const copy = path.join(dir, 'installed', 'local-cli-runner.sh');   // outside the repo, like every install
    fs.mkdirSync(path.dirname(copy));
    fs.copyFileSync(RUNNER, copy);
    const snap = await sh(`bash ${q(copy)} snapshot`, root);
    assert.equal(snap.status, 0, snap.stderr);
    const values = Object.fromEntries(snap.stdout.trim().split(' ').map((pair) => pair.split('=')));
    const block = verifyBlock.split('~/.claude/lib/local-cli-runner.sh').join(q(copy));
    assert.notEqual(block, verifyBlock, 'the block names the installed runner');
    const verify = () => sh(block, root, values);
    return { dir, root, copy, values, verify, sh };
  }

  it('prints RUNNER_SUM, and runs verify when the script is unchanged', async (t) => {
    const { copy, values, verify, sh } = await installed(t);
    assert.equal(values.RUNNER_SUM, (await sh(`git hash-object --no-filters -- ${q(copy)}`)).stdout.trim());
    const r = await verify();
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /TREE_STATE=clean/);
  });

  it('refuses to run a script modified after the snapshot', async (t) => {
    const { dir, root, copy, verify } = await installed(t);
    fs.writeFileSync(path.join(root, 'planted.txt'), 'x\n');
    // A rewritten runner that would report a clean tree and run planted code.
    fs.writeFileSync(copy, `touch ${q(path.join(dir, 'PWNED'))}\necho TREE_STATE=clean\n`);
    const r = await verify();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /runner script changed during the pass; do not trust this tree/);
    assert.doesNotMatch(r.stdout, /TREE_STATE/);
    assert.equal(fs.existsSync(path.join(dir, 'PWNED')), false, 'no code from the rewritten script ran');
  });

  it('refuses when RUNNER_SUM was not carried over', async (t) => {
    const { values, root, sh } = await installed(t);
    const r = await sh(verifyBlock.split('~/.claude/lib/local-cli-runner.sh').join(q(RUNNER)), root, { ...values, RUNNER_SUM: '' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /runner script changed/);
  });

  it('runs no filter or hook the CLI planted in repo config while hashing', async (t) => {
    const { dir, root, verify, sh } = await installed(t);
    const marker = path.join(dir, 'FILTER_RAN');
    assert.equal((await sh(`git config filter.evil.clean ${q(`touch ${marker}; cat`)} && echo '* filter=evil' > .gitattributes && git config core.fsmonitor ${q(`touch ${marker}`)}`, root)).status, 0);
    const r = await verify();
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.existsSync(marker), false, 'the hash check consulted planted config');
  });
});

describe('local-cli-runner launch and wait', { concurrency: true }, () => {
  it('prints LOG_FILE, pipes stdin through, keeps stderr out of the log, and records the exit code', async (t) => {
    const { tmp, sh } = sandbox(t);
    const r = await sh(`printf 'the prompt' | bash ${q(RUNNER)} launch --tag local-review-cmd -- bash -c 'cat; echo; echo noise >&2; exit 3'`);
    assert.equal(r.status, 3, r.stderr);
    const [, log] = r.stdout.match(/^LOG_FILE=(\S+)\n$/);
    assert.equal(path.dirname(log), tmp, 'the log lands in TMPDIR');
    assert.match(path.basename(log), /^local-review-cmd\.[A-Za-z0-9]+$/);
    assert.equal(fs.readFileSync(log, 'utf8'), 'the prompt\n');
    assert.equal(fs.readFileSync(`${log}.err`, 'utf8'), 'noise\n');
    assert.equal(fs.readFileSync(`${log}.exit`, 'utf8'), '3\n');
    const w = await sh(`bash ${q(RUNNER)} wait --log ${q(log)}`);
    assert.equal(w.stdout, '3\n');
  });

  it('passes arguments through verbatim, with no shell re-evaluation', async (t) => {
    const { dir, sh } = sandbox(t);
    const r = await sh(`bash ${q(RUNNER)} launch --tag enhance-x -- printf '%s|' 'a b' '$(touch PWNED)' "*"`);
    assert.equal(r.status, 0, r.stderr);
    const [, log] = r.stdout.match(/LOG_FILE=(\S+)/);
    assert.equal(fs.readFileSync(log, 'utf8'), 'a b|$(touch PWNED)|*|');
    assert.equal(fs.existsSync(path.join(dir, 'PWNED')), false);
  });

  it('wait reports STILL_RUNNING when the run has not finished', async (t) => {
    const { tmp, sh } = sandbox(t);
    const w = await sh(`bash ${q(RUNNER)} wait --log ${q(path.join(tmp, 'never.log'))} --seconds 0`);
    assert.equal(w.status, 0, w.stderr);
    assert.equal(w.stdout, 'STILL_RUNNING\n');
  });

  it('rejects a malformed launch or wait without running anything', async (t) => {
    const { sh } = sandbox(t);
    for (const args of ['launch --tag "a/b" -- true', 'launch --tag t', 'launch -- true', 'wait', 'wait --log x --seconds soon', 'bogus']) {
      const r = await sh(`bash ${q(RUNNER)} ${args}`);
      assert.equal(r.status, 1, args);
      assert.doesNotMatch(r.stdout, /LOG_FILE/, args);
    }
  });
});
