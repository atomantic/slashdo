'use strict';

// The forge a repo lives on is decided by its `origin` remote, never by which CLI
// happens to be logged in. `gh auth status` succeeding says only that `gh` is
// usable — on a machine authenticated to both services it succeeds inside a GitLab
// checkout too. Several Phase 0 blocks used to probe `gh` first and fall through to
// `glab` only on failure, so a GitLab repo was routed to `gh` for default-branch
// lookup, issue filing, and PR/MR operations, and could enter a GitHub-only reviewer
// path. lib/vcs-host.md is the single selection rule.
//
// Two layers here. The first RUNS the partial's shell against stub `gh`/`glab`
// binaries in throwaway git repos, so the selection is checked as behavior rather
// than as prose. The second sweeps the tree so the auth-first shortcut cannot grow
// back in a command that quietly re-types its own detection.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), 'utf8');
const partial = read('lib', 'vcs-host.md');

// Commands that legitimately carry their own copy of the selection. /do:pr and
// /do:next run it as a pre-flight the user sees before any claim, and
// /do:plan-task needs no GH_HOST at all; all three predate the partial. Pinned so a
// NEW command cannot join them by re-typing the logic instead of reading the file.
const INLINE_IMPLEMENTERS = new Set([
  'commands/do/next.md',
  'commands/do/pr.md',
  'commands/do/plan-task.md',
]);

const REFERENCES_PARTIAL =
  /!read lib\/vcs-host\.md|!`cat ~\/\.claude\/lib\/vcs-host\.md`|\(\.\.\/\.\.\/lib\/vcs-host\.md\)/;

// A file participates in host selection when it names the variable and either probes
// credentials itself or defers to the partial. Derived from the tree, so a command
// cannot drop out of the sweep by rewording its prose.
const selectionFiles = () => {
  const dirs = [['commands', 'do'], ['lib']];
  return dirs
    .flatMap((segments) =>
      fs
        .readdirSync(path.join(root, ...segments))
        .filter((entry) => entry.endsWith('.md'))
        .map((entry) => [...segments, entry].join('/')))
    .filter((rel) => {
      const body = read(rel);
      return body.includes('VCS_HOST') && (body.includes('auth status') || REFERENCES_PARTIAL.test(body));
    });
};

// ---------------------------------------------------------------------------
// Executable harness: the partial's bash blocks, run for real.
// ---------------------------------------------------------------------------

const bashBlocks = () => {
  const blocks = [...partial.matchAll(/```bash\n([\s\S]*?)```/g)].map(([, body]) => body);
  assert.equal(blocks.length, 2, 'lib/vcs-host.md must carry exactly the select and confirm blocks');
  return blocks;
};

// `{COMMAND}` is a substitution point the invoking command fills in, the same
// convention lib/gh-host.md uses for `{GH_HOST}`. Fill it the way a run would.
const script = () =>
  `${bashBlocks().join('\n')}\nprintf '%s|%s|%s\\n' "$VCS_HOST" "$CLI_TOOL" "$GH_HOST"\n`
    .replace(/\{COMMAND\}/g, '/do:better');

const STUB = (tool, authedVar, repoVar) => `#!/bin/sh
case "$1" in
  auth) [ "$${authedVar}" = 1 ] || exit 1 ;;
  repo) [ "$${repoVar}" = 1 ] || exit 1 ;;
esac
exit 0
`;

// One throwaway git repo + PATH of stubs per scenario. `remote` of null means a
// checkout with no origin at all.
function runSelection({ remote, ghAuthed = false, ghRepo = false, glabAuthed = false, glabRepo = false }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slashdo-vcs-host-'));
  try {
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'gh'), STUB('gh', 'GH_AUTHED', 'GH_REPO'), { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'glab'), STUB('glab', 'GLAB_AUTHED', 'GLAB_REPO'), { mode: 0o755 });

    const repo = path.join(dir, 'repo');
    fs.mkdirSync(repo);
    execFileSync('git', ['init', '-q'], { cwd: repo });
    if (remote) execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: repo });

    const scriptPath = path.join(dir, 'select.sh');
    fs.writeFileSync(scriptPath, script());
    const result = spawnSync('sh', [scriptPath], {
      cwd: repo,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        GH_AUTHED: ghAuthed ? '1' : '0',
        GH_REPO: ghRepo ? '1' : '0',
        GLAB_AUTHED: glabAuthed ? '1' : '0',
        GLAB_REPO: glabRepo ? '1' : '0',
      },
    });
    const selected = (result.stdout.trim().split('\n').pop() || '').split('|');
    return {
      status: result.status,
      stdout: result.stdout,
      vcsHost: selected[0],
      cliTool: selected[1],
      ghHost: selected[2],
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('VCS host selection, executed', () => {
  it('picks glab on a GitLab checkout even when gh is authenticated too', () => {
    const run = runSelection({
      remote: 'git@gitlab.example.com:team/app.git',
      ghAuthed: true, ghRepo: true, glabAuthed: true, glabRepo: true,
    });
    assert.equal(run.status, 0, run.stdout);
    assert.equal(run.vcsHost, 'gitlab');
    assert.equal(run.cliTool, 'glab');
  });

  it('picks gh on a GitHub Enterprise checkout and seeds that host', () => {
    const run = runSelection({
      remote: 'https://github.acme.com/team/app.git',
      ghAuthed: true, ghRepo: true, glabAuthed: true, glabRepo: true,
    });
    assert.equal(run.status, 0, run.stdout);
    assert.equal(run.vcsHost, 'github');
    assert.equal(run.cliTool, 'gh');
    assert.equal(run.ghHost, 'github.acme.com');
  });

  it('stops on a GitLab checkout when only GitHub credentials exist', () => {
    const run = runSelection({
      remote: 'git@gitlab.com:team/app.git',
      ghAuthed: true, ghRepo: true,
    });
    assert.equal(run.status, 1);
    assert.notEqual(run.vcsHost, 'github', 'a gh login must never decide a GitLab repo');
    assert.match(run.stdout, /glab auth login/);
  });

  it('stops on a GitHub checkout when only GitLab credentials exist', () => {
    const run = runSelection({
      remote: 'https://github.com/team/app.git',
      glabAuthed: true, glabRepo: true,
    });
    assert.equal(run.status, 1);
    assert.match(run.stdout, /gh auth login/);
  });

  it('stops on a remote that is neither GitHub nor GitLab', () => {
    const run = runSelection({
      remote: 'git@bitbucket.org:team/app.git',
      ghAuthed: true, glabAuthed: true,
    });
    assert.equal(run.status, 1);
    assert.match(run.stdout, /does not support this forge/);
  });

  it('stops when the remote resolves but that host has no token', () => {
    // `auth status` passes (the user is logged in to gitlab.com) while the
    // self-managed host is unreachable — exactly the case a bare auth probe misses.
    const run = runSelection({
      remote: 'https://gitlab.internal.example/team/app.git',
      glabAuthed: true, glabRepo: false,
    });
    assert.equal(run.status, 1);
    assert.match(run.stdout, /cannot read this repo/);
  });

  it('falls back to the authenticated CLI only when there is no origin remote', () => {
    const run = runSelection({ remote: null, ghAuthed: true });
    assert.equal(run.status, 0, run.stdout);
    assert.equal(run.vcsHost, 'github');
    assert.equal(run.cliTool, 'gh');
  });

  it('stops when there is no remote and no credentials at all', () => {
    const run = runSelection({ remote: null });
    assert.equal(run.status, 1);
    assert.match(run.stdout, /needs an authenticated gh \(GitHub\) or glab \(GitLab\)/);
  });
});

describe('VCS host selection stays in one partial', () => {
  it('derives from the remote before the first credential probe', () => {
    const [selection] = bashBlocks();
    const origin = selection.indexOf('ORIGIN_HOST="$(git remote get-url origin');
    assert.ok(origin > -1, 'the selection block must derive ORIGIN_HOST from the origin remote');
    const firstAuth = selection.indexOf('auth status');
    assert.ok(firstAuth > -1, 'the selection block must still keep its no-remote fallback');
    assert.ok(
      origin < firstAuth,
      'lib/vcs-host.md probes credentials before reading the remote — that is the bug it exists to prevent',
    );
  });

  it('matches GitLab by hostname substring so self-managed instances work', () => {
    assert.match(partial, /grep -qi gitlab/);
  });

  it('never mutates anything on the way to a stop', () => {
    for (const mutation of ['gh issue create', 'gh pr create', 'glab mr create', 'git worktree add', 'git checkout -b']) {
      assert.ok(!partial.includes(mutation), `lib/vcs-host.md must stay non-mutating; found ${mutation}`);
    }
    assert.match(partial, /Credentials for the wrong service are not a fallback/);
  });

  it('never lets a gh auth failure stand in for a GitLab remote, anywhere in the tree', () => {
    // The exact drifted paragraph: probe gh, and on failure declare GitLab.
    const AUTH_FIRST = /`?gh auth status[^\n]*\n?[^\n]*If it\s*\n?[^\n]*fails, run `glab auth status`/;
    const files = selectionFiles();
    assert.ok(files.length >= 6, `expected the host-selecting file set to stay broad, got ${files.join(', ')}`);
    for (const rel of files) {
      assert.doesNotMatch(read(rel), AUTH_FIRST, `${rel} still selects the host from a gh auth failure`);
    }
  });

  it('lets only the pinned pre-flights carry their own copy of the selection', () => {
    for (const rel of selectionFiles()) {
      if (rel === 'lib/vcs-host.md' || INLINE_IMPLEMENTERS.has(rel)) continue;
      assert.ok(
        REFERENCES_PARTIAL.test(read(rel)),
        `${rel} selects a VCS host without reading lib/vcs-host.md — include the partial instead of re-typing it`,
      );
    }
    for (const rel of INLINE_IMPLEMENTERS) {
      assert.ok(
        read(rel).includes('git remote get-url origin'),
        `${rel} is pinned as an inline implementer but no longer derives the host from the remote`,
      );
    }
  });

  it('selects the host before do-better routes anything through the CLI', () => {
    // Phase 0d asks the forge for the default branch. Selecting after that call would
    // reintroduce the wrong-host routing this partial exists to stop.
    const discovery = read('lib', 'better-discovery.md');
    const include = discovery.indexOf('!read lib/vcs-host.md');
    assert.ok(include > -1, 'lib/better-discovery.md must include lib/vcs-host.md');
    assert.ok(
      include < discovery.indexOf('Record `DEFAULT_BRANCH` via'),
      'lib/better-discovery.md must select the host before the default-branch lookup',
    );
    for (const command of ['better-swift.md', 'depfree.md']) {
      const body = read('commands', 'do', command);
      const at = body.indexOf('!read lib/vcs-host.md');
      assert.ok(at > -1, `commands/do/${command} must include lib/vcs-host.md`);
      assert.ok(
        at < body.indexOf('Record `DEFAULT_BRANCH` via'),
        `commands/do/${command} must select the host before the default-branch lookup`,
      );
    }
  });
});
