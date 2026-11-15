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
// than as prose. The second checks that every file deciding a host includes the
// partial instead of re-typing its own detection.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), 'utf8');
const partial = read('lib', 'vcs-host.md');

const REFERENCES_PARTIAL =
  /!read lib\/vcs-host\.md|!`cat ~\/\.claude\/lib\/vcs-host\.md`|\(\.\.\/\.\.\/lib\/vcs-host\.md\)/;

const markdownFiles = () =>
  [['commands', 'do'], ['lib']].flatMap((segments) =>
    fs
      .readdirSync(path.join(root, ...segments))
      .filter((entry) => entry.endsWith('.md'))
      .map((entry) => [...segments, entry].join('/')));

// The delegation rule is narrower: a file that actually decides the host (VCS_HOST,
// CODE_HOST, or the TRACKER_CLI gate), either by
// probing itself or by deferring to the partial.
const selectionFiles = () =>
  markdownFiles().filter((rel) => {
    const body = read(rel);
    return /VCS_HOST|CODE_HOST|TRACKER_CLI/.test(body) && (body.includes('auth status') || REFERENCES_PARTIAL.test(body));
  });

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
//
// The state line is printed from an EXIT trap, not appended after the blocks: every
// failure path ends in `exit 1`, so a trailing printf would never run and the
// assertions about what was SELECTED on an abort would pass vacuously against
// whatever the last echo happened to say.
const script = () =>
  [
    `trap 'printf "SELECTED|%s|%s|%s|%s|%s|%s|%s|%s\\n" "$VCS_HOST" "$CLI_TOOL" "$GH_HOST" "$LABEL_SEP" "$CODE_HOST" "$TRACKER" "$CR_NOUN" "$TRACKER_CLI"' EXIT`,
    ...bashBlocks(),
  ].join('\n').replace(/\{COMMAND\}/g, '/do:better');

// Every stub invocation is logged, so a scenario can prove a CLI was never called.
const STUB = (tool, authedVar, repoVar) => `#!/bin/sh
echo "${tool} $*" >> "$CALL_LOG"
case "$1" in
  auth) [ "$${authedVar}" = 1 ] || exit 1 ;;
  repo) [ "$${repoVar}" = 1 ] || exit 1 ;;
esac
exit 0
`;

// One throwaway git repo + PATH of stubs per scenario. `remote` of null means a
// checkout with no origin at all.
// `globalConfig` / `projectConfig` are raw file contents for the saved-defaults
// store (~/.claude/.slashdo-config.json under a throwaway HOME, and .slashdo.json at
// the repo root).
function runSelection({
  remote, ghAuthed = false, ghRepo = false, glabAuthed = false, glabRepo = false,
  globalConfig, projectConfig,
}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slashdo-vcs-host-'));
  try {
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'gh'), STUB('gh', 'GH_AUTHED', 'GH_REPO'), { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'glab'), STUB('glab', 'GLAB_AUTHED', 'GLAB_REPO'), { mode: 0o755 });
    // Logged like the others so a scenario can prove resolution never reaches Jira.
    fs.writeFileSync(path.join(bin, 'jira'), STUB('jira', 'GH_AUTHED', 'GH_REPO'), { mode: 0o755 });

    const repo = path.join(dir, 'repo');
    fs.mkdirSync(repo);
    execFileSync('git', ['init', '-q'], { cwd: repo });
    if (remote) execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: repo });
    if (projectConfig !== undefined) fs.writeFileSync(path.join(repo, '.slashdo.json'), projectConfig);

    const home = path.join(dir, 'home');
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    if (globalConfig !== undefined) fs.writeFileSync(path.join(home, '.claude', '.slashdo-config.json'), globalConfig);
    const callLog = path.join(dir, 'calls.log');
    fs.writeFileSync(callLog, '');

    const scriptPath = path.join(dir, 'select.sh');
    fs.writeFileSync(scriptPath, script());
    const result = spawnSync('sh', [scriptPath], {
      cwd: repo,
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: home,
        CALL_LOG: callLog,
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        GH_AUTHED: ghAuthed ? '1' : '0',
        GH_REPO: ghRepo ? '1' : '0',
        GLAB_AUTHED: glabAuthed ? '1' : '0',
        GLAB_REPO: glabRepo ? '1' : '0',
      },
    });
    const line = result.stdout.split('\n').find((l) => l.startsWith('SELECTED|'));
    assert.ok(line, `the EXIT trap should always report the selection:\n${result.stdout}`);
    const [, vcsHost, cliTool, ghHost, labelSep, codeHost, tracker, crNoun, trackerCli] = line.trim().split('|');
    const calls = fs.readFileSync(callLog, 'utf8').split('\n').filter(Boolean);
    return { status: result.status, stdout: result.stdout, vcsHost, cliTool, ghHost, labelSep, codeHost, tracker, crNoun, trackerCli, calls };
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
    // GitLab reads any `key::value` label as a native scoped label — two-tone, and
    // only one value per key on an issue at a time. Every prefixed label a command
    // builds or matches is `<key>${LABEL_SEP}<value>`, so the separator has to fall
    // out of the same block that picks the CLI, not be re-derived per call site.
    assert.equal(run.labelSep, '::', 'glab must derive the scoped-label separator');
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
    assert.equal(run.labelSep, ':', 'GitHub has no scoped labels — it keeps the single colon');
  });

  it('stops on a GitLab checkout when only GitHub credentials exist', () => {
    const run = runSelection({
      remote: 'git@gitlab.com:team/app.git',
      ghAuthed: true, ghRepo: true,
    });
    assert.equal(run.status, 1);
    // The trap reports what was actually selected, so this is a real check on the
    // decision rather than on whatever text the abort happened to print last.
    assert.equal(run.vcsHost, 'gitlab', 'a gh login must never decide a GitLab repo');
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

  it('picks gh on a plain github.com checkout and seeds github.com', () => {
    const run = runSelection({
      remote: 'git@github.com:team/app.git',
      ghAuthed: true, ghRepo: true, glabAuthed: true, glabRepo: true,
    });
    assert.equal(run.status, 0, run.stdout);
    assert.equal(run.vcsHost, 'github');
    assert.equal(run.ghHost, 'github.com');
  });

  it('stops on a GHES checkout the account has no token for', () => {
    // The mirror of the GitLab case below: `gh auth status` passes on the strength of
    // a github.com login while the Enterprise host stays unreachable.
    const run = runSelection({
      remote: 'https://github.acme.com/team/app.git',
      ghAuthed: true, ghRepo: false,
    });
    assert.equal(run.status, 1);
    assert.match(run.stdout, /gh auth login --hostname github\.acme\.com/);
  });

  it('stops on a known non-GitHub/GitLab forge without ever routing it to gh', () => {
    // These used to fall through to `gh` and fail its reachability probe. A forge we
    // can recognize has no backend, so it stops before any CLI is consulted.
    for (const remote of [
      'git@bitbucket.org:team/app.git',
      'https://codeberg.org/team/app.git',
      'https://gitea.example.com/team/app.git',
      'git@ssh.dev.azure.com:v3/org/proj/app',
      'https://org.visualstudio.com/proj/_git/app',
      'https://git.sr.ht/~team/app',
    ]) {
      const run = runSelection({ remote, ghAuthed: true, ghRepo: true, glabAuthed: true, glabRepo: true });
      assert.equal(run.status, 1, remote);
      assert.match(run.stdout, /unsupported code host/, remote);
      assert.deepEqual(run.calls, [], `${remote} must never reach gh or glab: ${run.calls.join('; ')}`);
      assert.equal(run.cliTool, '', `${remote} must not select a CLI`);
    }
  });

  it('names an unreachable unrecognized host as an unsupported code host and points at the override', () => {
    // An unrecognized hostname may be GHES, so it still gets the gh probe — but when
    // that fails the message must not read as "just log in to GitHub".
    const run = runSelection({
      remote: 'https://git.acme.example/team/app.git',
      ghAuthed: true, ghRepo: false, glabAuthed: true, glabRepo: true,
    });
    assert.equal(run.status, 1);
    assert.match(run.stdout, /unsupported code host/);
    assert.match(run.stdout, /\/do:config --code-host gitlab/);
    assert.match(run.stdout, /gh auth login --hostname git\.acme\.example/);
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

  it('falls back to glab when it is the only CLI authenticated and there is no remote', () => {
    const run = runSelection({ remote: null, glabAuthed: true });
    assert.equal(run.status, 0, run.stdout);
    assert.equal(run.vcsHost, 'gitlab');
    assert.equal(run.cliTool, 'glab');
  });

  it('stops when there is no remote and no credentials at all', () => {
    const run = runSelection({ remote: null });
    assert.equal(run.status, 1);
    assert.match(run.stdout, /needs an authenticated gh \(GitHub\) or glab \(GitLab\)/);
  });
});

describe('code host and tracker resolution, executed', () => {
  it('derives CODE_HOST, TRACKER, and CR_NOUN from the remote by default', () => {
    const gh = runSelection({ remote: 'git@github.com:team/app.git', ghAuthed: true, ghRepo: true });
    assert.equal(gh.status, 0, gh.stdout);
    assert.deepEqual([gh.codeHost, gh.tracker, gh.crNoun, gh.vcsHost], ['github', 'github', 'PR', 'github']);

    const gl = runSelection({ remote: 'git@gitlab.com:team/app.git', glabAuthed: true, glabRepo: true });
    assert.equal(gl.status, 0, gl.stdout);
    assert.deepEqual([gl.codeHost, gl.tracker, gl.crNoun, gl.vcsHost], ['gitlab', 'gitlab', 'MR', 'gitlab']);
  });

  it('routes a self-managed GitLab with an uninformative hostname to glab via a saved code-host', () => {
    const run = runSelection({
      remote: 'https://git.acme.example/team/app.git',
      ghAuthed: true, ghRepo: true, glabAuthed: true, glabRepo: true,
      globalConfig: JSON.stringify({ autoUpdate: true, defaults: { 'code-host': 'gitlab' } }, null, 2),
    });
    assert.equal(run.status, 0, run.stdout);
    assert.deepEqual([run.codeHost, run.cliTool, run.labelSep, run.crNoun], ['gitlab', 'glab', '::', 'MR']);
    assert.ok(!run.calls.some((c) => c.startsWith('gh ')), `gh must not be consulted: ${run.calls.join('; ')}`);
  });

  it('lets the per-project .slashdo.json override the global code-host, in any JSON layout', () => {
    const run = runSelection({
      remote: 'https://git.acme.example/team/app.git',
      ghAuthed: true, ghRepo: true, glabAuthed: true, glabRepo: true,
      globalConfig: '{"defaults":{"code-host":"gitlab"}}',
      projectConfig: '{ "defaults": { "code-host" : "GitHub" } }\n',
    });
    assert.equal(run.status, 0, run.stdout);
    assert.equal(run.codeHost, 'github', 'project wins key by key, and the value is case-insensitive');
    assert.equal(run.cliTool, 'gh');
  });

  it('lets a saved code-host win over a recognizable remote', () => {
    const run = runSelection({
      remote: 'git@gitlab.example.com:team/app.git',
      ghAuthed: true, ghRepo: true,
      projectConfig: '{"defaults":{"code-host":"github"}}',
    });
    assert.equal(run.status, 0, run.stdout);
    assert.equal(run.codeHost, 'github');
  });

  it('aborts on an invalid saved code-host before touching any CLI', () => {
    const run = runSelection({
      remote: 'git@github.com:team/app.git',
      ghAuthed: true, ghRepo: true,
      globalConfig: '{"defaults":{"code-host":"bitbucket"}}',
    });
    assert.equal(run.status, 1);
    assert.match(run.stdout, /unsupported code host 'bitbucket' \(supported: github, gitlab/);
    assert.deepEqual(run.calls, []);
  });

  it('resolves TRACKER independently from its own saved default', () => {
    const run = runSelection({
      remote: 'git@github.com:team/app.git',
      ghAuthed: true, ghRepo: true,
      globalConfig: '{"defaults":{"tracker":"gitlab"}}',
      projectConfig: '{"defaults":{"tracker":"linear"}}',
    });
    // Resolution itself never aborts on the tracker: /do:pr has no use for it. The
    // tracker gate is TRACKER_CLI, which only tracker-using commands consult.
    assert.equal(run.status, 0, run.stdout);
    assert.equal(run.codeHost, 'github');
    assert.equal(run.tracker, 'linear', 'project tracker wins over global');
    assert.equal(run.trackerCli, '', 'a tracker with no backend must not borrow the code host CLI');
  });

  it('resolves a Jira tracker without reaching Jira or lending it the code host CLI', () => {
    // TRACKER_CLI=jira is set only by lib/tracker-jira.md's pre-flight, so a command
    // that never reads that file sees "no tracker" rather than gh/glab issue calls.
    for (const [remote, cli, sep, authed] of [['git@github.com:team/app.git', 'gh', ':', { ghAuthed: true, ghRepo: true }],
      ['git@gitlab.com:team/app.git', 'glab', '::', { glabAuthed: true, glabRepo: true }]]) {
      const run = runSelection({ remote, ...authed, projectConfig: '{"defaults":{"tracker":"Jira","jira-project":"proj"}}' });
      assert.equal(run.status, 0, run.stdout);
      assert.equal(run.cliTool, cli, 'PRs/MRs stay on the code host CLI');
      assert.equal(run.labelSep, sep);
      assert.equal(run.tracker, 'jira');
      assert.equal(run.trackerCli, '');
      assert.ok(!run.calls.some((c) => c.startsWith('jira ')), 'resolution must not reach Jira');
    }
  });

  it('serves the tracker through the code host CLI only when they match', () => {
    const same = runSelection({
      remote: 'git@gitlab.com:team/app.git', glabAuthed: true, glabRepo: true,
      globalConfig: '{"defaults":{"tracker":"gitlab"}}',
    });
    assert.equal(same.status, 0, same.stdout);
    assert.equal(same.trackerCli, 'glab');

    const cross = runSelection({
      remote: 'git@github.com:team/app.git', ghAuthed: true, ghRepo: true,
      globalConfig: '{"defaults":{"tracker":"gitlab"}}',
    });
    assert.equal(cross.status, 0, cross.stdout);
    assert.equal(cross.trackerCli, '', 'a GitLab tracker cannot be reached through gh');
  });
});

describe('VCS host selection stays in one partial', () => {
  it('delegates every VCS host selection to the shared partial', () => {
    for (const rel of selectionFiles()) {
      if (rel === 'lib/vcs-host.md') continue;
      assert.ok(
        REFERENCES_PARTIAL.test(read(rel)),
        `${rel} selects a VCS host without reading lib/vcs-host.md — include the partial instead of re-typing it`,
      );
    }
  });
});
