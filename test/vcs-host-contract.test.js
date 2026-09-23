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

const REFERENCES_PARTIAL =
  /!read lib\/vcs-host\.md|!`cat ~\/\.claude\/lib\/vcs-host\.md`|\(\.\.\/\.\.\/lib\/vcs-host\.md\)/;

const markdownFiles = () =>
  [['commands', 'do'], ['lib']].flatMap((segments) =>
    fs
      .readdirSync(path.join(root, ...segments))
      .filter((entry) => entry.endsWith('.md'))
      .map((entry) => [...segments, entry].join('/')));

// The auth-first ban sweeps every file that probes credentials at all, whatever it
// calls its variables — a re-typed detection that never says "VCS_HOST" is exactly
// the drift this is meant to catch.
const authProbingFiles = () => markdownFiles().filter((rel) => /(?:gh|glab) auth status/.test(read(rel)));

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

  it('builds every prefixed-label matcher from LABEL_SEP, never a hardcoded colon', () => {
    // The separator is only useful if the matchers actually interpolate it. A jq
    // clause that hardcodes `:` keeps working on GitHub and silently matches NOTHING
    // on GitLab, where the label is `priority::3` / `model::light` — no error, just a
    // queue that quietly loses its priority ordering and a --model filter that
    // excludes every issue. Sweep the shapes that read a prefixed label back.
    const HARDCODED = [
      /test\("\^priority:\[0-9\]/,
      /ltrimstr\("priority:"\)/,
      /startswith\("(?:model|effort|severity|area):"\)/,
      /== "(?:model|effort|severity):[a-z]/,
    ];
    for (const rel of ['commands/do/next.md', 'lib/next-gitlab.md', 'lib/next-swarm.md', 'lib/plan-issue-setup.md', 'commands/do/plan-task.md']) {
      const body = read(rel);
      for (const shape of HARDCODED) {
        assert.ok(
          !shape.test(body),
          `${rel} matches a prefixed label with a hardcoded ":" (${shape}) — build it from $LABEL_SEP`,
        );
      }
      assert.ok(body.includes('LABEL_SEP'), `${rel} reads prefixed labels but never mentions LABEL_SEP`);
    }
    // ...and the one place it is derived stays inside the select block, so a command
    // that runs the partial has it without a second step.
    const [select] = bashBlocks();
    assert.match(select, /LABEL_SEP="::"/);
    assert.match(select, /LABEL_SEP=":"/);
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
      projectConfig: '{"defaults":{"tracker":"jira"}}',
    });
    // Resolution itself never aborts on the tracker: /do:pr has no use for it. The
    // tracker gate is TRACKER_CLI, which only tracker-using commands consult.
    assert.equal(run.status, 0, run.stdout);
    assert.equal(run.codeHost, 'github');
    assert.equal(run.tracker, 'jira', 'project tracker wins over global');
    assert.equal(run.trackerCli, '', 'a tracker with no backend must not borrow the code host CLI');
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

describe('code host and tracker overrides are wired end to end', () => {
  const config = read('commands', 'do', 'config.md');

  it('lets /do:config set, show, and unset code-host and tracker', () => {
    assert.match(config, /`--code-host <github\|gitlab>` → key `code-host`/);
    assert.match(config, /`--tracker <github\|gitlab>` → key `tracker`/);
    assert.match(config, /Supported: [^`]*--code-host, --tracker, --unset <key>/);
    assert.match(config, /Valid keys: [^`]*code-host, tracker\./);
    assert.match(config, /^ {2}code-host {10}= /m);
    assert.match(config, /^ {2}tracker {12}= /m);
  });

  it('keeps /do:config and the partial on one supported value set', () => {
    // A new backend (e.g. #372's jira tracker) must extend both places together.
    const [select] = bashBlocks();
    assert.match(select, /\n {2}github\) CLI_TOOL=gh;[^\n]*\n {2}gitlab\) CLI_TOOL=glab;[^\n]*\n {2}\*\) echo[^\n]*supported: github, gitlab/);
    assert.match(config, /--code-host must be one of github, gitlab/);
    assert.match(config, /--tracker must be one of github, gitlab/);
  });

  it('runs the tracker gate in every command that reads or files tracker issues', () => {
    for (const rel of ['lib/plan-issue-setup.md', 'commands/do/plan-task.md', 'commands/do/replan.md', 'commands/do/next.md', 'commands/do/goals.md']) {
      assert.match(read(rel), /TRACKER_CLI/, `${rel} must honor lib/vcs-host.md's tracker gate (TRACKER_CLI)`);
    }
  });
});

describe('VCS host selection stays in one partial', () => {
  it('keeps host verbs downstream of forge selection', () => {
    const next = read('commands', 'do', 'next.md');
    const gitlab = read('lib', 'next-gitlab.md');
    const verbs = next.indexOf('**Host verbs.**');
    const selection = next.indexOf('!read lib/vcs-host.md');
    assert.ok(verbs > -1 && verbs < selection, 'host verbs must follow the shared forge selection');
    assert.match(gitlab, /## Host verbs — GitLab forms/);
    assert.match(gitlab, /glab issue update <N> --assignee "\+\$ME"/);
  });

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
    const [select] = bashBlocks();
    assert.match(select, /\*gitlab\*\) CODE_HOST=gitlab/);
  });

  it('preserves a GH_HOST seeded by the VCS preflight before applying fallbacks', () => {
    const ghHost = read('lib', 'gh-host.md');
    const origin = ghHost.indexOf('[ -n "$GH_HOST" ] || GH_HOST=$(git remote get-url origin');
    const fallback = ghHost.indexOf('[ -n "$GH_HOST" ] || GH_HOST=$(gh repo view');
    assert.ok(origin > -1, 'lib/gh-host.md must accept the checkout-derived GH_HOST seed');
    assert.ok(fallback > origin, 'lib/gh-host.md must apply repository and default fallbacks after origin');
  });

  it('loads each /do:pr host partial only on the path that needs it', () => {
    const command = read('commands', 'do', 'pr.md');
    const detect = command.indexOf('!read lib/vcs-host.md');
    const side = command.indexOf('## Run the PR-side Reviews');
    const apiHost = command.indexOf('!read lib/gh-host.md');
    const handoff = command.indexOf('When no cross-phase skip applies', side);
    assert.ok(detect > -1 && detect < side, '/do:pr must read the VCS preflight on every run');
    assert.ok(apiHost > side && apiHost < handoff, '/do:pr must defer gh-host until PR-side dispatch');
    assert.doesNotMatch(command.slice(0, side), /!read lib\/gh-host\.md/);
    assert.match(
      command.slice(Math.max(0, apiHost - 300), apiHost),
      /On GitHub, when `PR_SIDE_AGENTS` is non-empty/,
    );
  });

  it('never mutates anything on the way to a stop', () => {
    for (const mutation of ['gh issue create', 'gh pr create', 'glab mr create', 'git worktree add', 'git checkout -b']) {
      assert.ok(!partial.includes(mutation), `lib/vcs-host.md must stay non-mutating; found ${mutation}`);
    }
    assert.match(partial, /credentials never select or switch the forge/i);
  });

  it('never lets a gh auth failure stand in for a GitLab remote, anywhere in the tree', () => {
    // The exact drifted paragraph: probe gh, and on failure declare GitLab.
    const AUTH_FIRST = /`?gh auth status[^\n]*\n?[^\n]*If it\s*\n?[^\n]*fails, run `glab auth status`/;
    // The floor is on the files that decide a host AT ALL, not on the shrinking
    // subset that still probes credentials inline — every migration to the partial
    // moves a file from the second set to the first, and must not weaken the guard.
    const deciding = new Set([...authProbingFiles(), ...selectionFiles()]);
    assert.ok(deciding.size >= 6, `expected the host-deciding file set to stay broad, got ${[...deciding].join(', ')}`);
    for (const rel of authProbingFiles()) {
      assert.doesNotMatch(read(rel), AUTH_FIRST, `${rel} still selects the host from a gh auth failure`);
    }
  });

  it("delegates lib/plan-issue-setup.md's missing host state to the shared partial", () => {
    const issueMode = read('lib', 'plan-issue-setup.md');
    assert.match(issueMode, /requires `CLI_TOOL` and `LABEL_SEP`/);
    assert.match(issueMode, /\[vcs-host\.md\]\(\.\/vcs-host\.md\)/);
    assert.doesNotMatch(issueMode, /git remote get-url origin|(?:gh|glab) auth status/);

    for (const command of ['rpr.md', 'review.md']) {
      const body = read('commands', 'do', command);
      const branch = body.slice(
        body.indexOf('Only when a finding is being deferred'),
        body.indexOf('!read lib/plan-issue-filing.md'),
      );
      assert.match(branch, /!read lib\/vcs-host\.md/);
    }
  });

  it('delegates every VCS host selection to the shared partial', () => {
    for (const rel of selectionFiles()) {
      if (rel === 'lib/vcs-host.md') continue;
      assert.ok(
        REFERENCES_PARTIAL.test(read(rel)),
        `${rel} selects a VCS host without reading lib/vcs-host.md — include the partial instead of re-typing it`,
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
    const depfree = read('commands', 'do', 'depfree.md');
    const depfreeAt = depfree.indexOf('!read lib/vcs-host.md');
    assert.ok(depfreeAt > -1, 'commands/do/depfree.md must include lib/vcs-host.md');
    assert.ok(
      depfreeAt < depfree.indexOf('Record `DEFAULT_BRANCH` via'),
      'commands/do/depfree.md must select the host before the default-branch lookup',
    );

    const swift = read('commands', 'do', 'better-swift.md');
    assert.match(swift, /!read lib\/better-discovery\.md/);
  });
});
