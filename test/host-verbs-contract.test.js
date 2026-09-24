'use strict';

// `@<login>` reviewers used to be hard-wired to GitHub: lib/github-reviewer-loop.md
// drove `gh`/GraphQL directly and /do:pr skipped every `@<login>` entry on a GitLab
// MR as "GitHub-only". The loop is now host-neutral (lib/host-reviewer-loop.md) and
// names verbs; each code host implements the same verb set in its own file
// (lib/host-github.md, lib/host-gitlab.md). These contracts pin that shape, the
// per-host login grammar, and — by running it — the GitLab `cr-state` normalization
// that turns MR notes and approvals into reviews of a specific commit.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { readCommandDocs } = require('./helpers/command-docs');

const root = path.join(__dirname, '..');
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), 'utf8');
const readLib = (name) => read('lib', name);

const HOST_FILES = { github: 'host-github.md', gitlab: 'host-gitlab.md' };
const VERBS = ['cr-state', 'request-review', 'reply-thread', 'resolve-thread', 'post-review', 'ci-status', 'merge'];
const verbHeadings = (body) => [...body.matchAll(/^### `([a-z-]+)`/gm)].map(([, verb]) => verb);
const grammarOf = (body) => {
  const section = body.slice(body.indexOf('### Login grammar'));
  const match = section.match(/`(\^[^`]+\$)`/);
  assert.ok(match, 'each verb file states its login grammar as a regex');
  return new RegExp(match[1]);
};

describe('per-host verb contract', () => {
  it('gives every host the same verb set, in the same order', () => {
    for (const [host, file] of Object.entries(HOST_FILES)) {
      const body = readLib(file);
      assert.deepEqual(verbHeadings(body), VERBS, `${file} (${host}) must define exactly the shared verbs`);
      assert.match(body, /### Login grammar/, `${file} must state the ${host} login grammar`);
      assert.match(body, /A failed verb\s+stays a failure/, `${file} must fail closed`);
    }
  });

  it('keeps each backend on its own CLI', () => {
    const github = readLib(HOST_FILES.github);
    const gitlab = readLib(HOST_FILES.gitlab);
    assert.doesNotMatch(github, /\bglab /);
    assert.doesNotMatch(gitlab, /\bgh (?:api|pr) /);
    // Every GitHub API call carries the Enterprise host.
    for (const line of github.split('\n').filter((l) => /\bgh api\b/.test(l) && !/`gh api`/.test(l))) {
      assert.match(line, /gh api --hostname \{GH_HOST\}/, line);
    }
    // Merge is owned by the shared gate on both hosts, never re-inlined here.
    for (const body of [github, gitlab]) {
      assert.match(body.slice(body.indexOf('### `merge`')), /merge-gate\.md/);
    }
  });

  it('follows the glab api capture rule in the GitLab verbs', () => {
    const gitlab = readLib(HOST_FILES.gitlab);
    for (const line of gitlab.split('\n')) {
      assert.doesNotMatch(line, /glab api[^|`\n]*--jq/, `glab api has no --jq flag: ${line}`);
      assert.doesNotMatch(line, /glab api [^|\n]*\| *jq/, `never pipe glab api straight into jq: ${line}`);
    }
    assert.match(gitlab, /glab mr update \{PR_NUMBER\} --reviewer "\+\{REVIEWER_LOGIN\}"/,
      'request-review must add the reviewer, not replace the existing ones');
    assert.match(gitlab, /mergeRequestReviewerRereview/, 'an existing reviewer is re-requested, not silently no-oped');
    assert.match(gitlab, /Settle rule/, 'unbatched GitLab comments must settle before the review counts');
  });

  it('passes reviewer-authored text as JSON data, not shell source', () => {
    const github = readLib(HOST_FILES.github);
    const gitlab = readLib(HOST_FILES.gitlab);
    assert.match(github, /--arg body "\$BODY"[\s\S]*--input "\$PAYLOAD_FILE"/);
    assert.match(gitlab, /--arg body "\$BODY"[\s\S]*--input "\$PAYLOAD_FILE"/);
    assert.match(gitlab, /--arg body "\$COMMENT"[\s\S]*--arg path "\$COMMENT_PATH"/);
    assert.doesNotMatch(github, /body: "\{BODY\}"/);
    assert.doesNotMatch(gitlab, /-f body="\{BODY\}"|-m "<summary>"|--arg body "<comment>"/);
  });
});

describe('host-neutral reviewer loop', () => {
  const core = readLib('host-reviewer-loop.md');

  it('names verbs, never a host CLI', () => {
    const template = core.slice(core.indexOf('### Sub-agent prompt template'));
    // The GH_HOST line may name `gh api` (the flag is GitHub-scoped); no command may.
    assert.doesNotMatch(template, /\bgh (?:api|pr) [^`]|\bglab (?:api|mr) |graphql/i);
    for (const verb of ['cr-state', 'request-review', 'resolve-thread']) {
      assert.match(template, new RegExp('`' + verb + '`'), `the loop must run the ${verb} verb`);
    }
    assert.match(template, /\{HOST_VERBS\}/);
  });

  it('gate-reads exactly one verb file per code host', () => {
    const githubAt = core.indexOf('!read lib/host-github.md');
    const gitlabAt = core.indexOf('!read lib/host-gitlab.md');
    assert.ok(githubAt > 0 && gitlabAt > githubAt);
    assert.match(core.slice(0, githubAt), /Only when `\{CODE_HOST\}=github` \(or unset\):\s*$/);
    assert.match(core.slice(githubAt, gitlabAt), /Only when `\{CODE_HOST\}=gitlab`:\s*$/);
  });

  it('replaced the GitHub-only loop everywhere', () => {
    assert.equal(fs.existsSync(path.join(root, 'lib', 'github-reviewer-loop.md')), false);
    const sources = [
      ...fs.readdirSync(path.join(root, 'commands', 'do')).map((f) => path.join('commands', 'do', f)),
      ...fs.readdirSync(path.join(root, 'lib')).map((f) => path.join('lib', f)),
      'src/transformer.js', 'install.sh', 'README.md',
    ];
    for (const rel of sources) {
      assert.doesNotMatch(read(rel), /github-reviewer-loop/, `${rel} still names the old loop`);
    }
    const install = read('install.sh');
    for (const lib of ['host-reviewer-loop', 'host-github', 'host-gitlab']) {
      assert.match(install, new RegExp(`LIBS=\\([\\s\\S]*\\b${lib}\\b`), `install.sh must ship ${lib}`);
    }
    assert.match(read('uninstall.sh'), /OLD_LIBS=\([\s\S]*github-reviewer-loop[\s\S]*\)/);
  });

  it('runs @<login> on GitLab and keeps copilot GitHub-only', () => {
    const wrapper = readLib('multi-reviewer-loop.md');
    assert.match(wrapper, /`copilot` → \*\*only when `\{CODE_HOST\}=github`\*\*/);
    assert.match(wrapper, /record the pass `skipped` without dispatching/);
    assert.match(wrapper, /`@<login>` → `\{LIB_DIR\}\/host-reviewer-loop\.md` on every supported host/);

    const pr = readCommandDocs('pr.md');
    assert.doesNotMatch(pr, /GitHub-only and were skipped/);
    assert.match(pr, /\*\*On GitLab\*\*, `@<login>` entries run the same request → poll → fix → resolve flow/);
    assert.match(pr, /glab mr update \{PR_NUMBER\} --reviewer/, '/do:pr must reach the GitLab request verb');

    assert.doesNotMatch(readLib('review-flags.md'), /skipped on GitLab/);
  });
});

describe('@<login> grammar per host', () => {
  const github = grammarOf(readLib(HOST_FILES.github));
  const gitlab = grammarOf(readLib(HOST_FILES.gitlab));

  it('accepts each host\'s real usernames and rejects the other\'s', () => {
    for (const login of ['octocat', 'org-review-bot', 'some-app[bot]', 'a1']) assert.match(login, github);
    for (const login of ['jane.doe', 'project_42_bot', '_svc', 'a-b.c_d']) {
      assert.match(login, gitlab);
      assert.doesNotMatch(login, github, `${login} is not a valid GitHub login`);
    }
    for (const login of ['-lead', 'trail.', '.dot', 'x[bot]', 'a b']) {
      assert.doesNotMatch(login, gitlab, `${login} is not a valid GitLab username`);
    }
    for (const login of ['-lead', 'jane.doe', '_svc']) assert.doesNotMatch(login, github);
  });

  it('uses the verb files\' grammars in the parser and the wrapper pre-flight', () => {
    for (const body of [readLib('review-flags.md'), readLib('multi-reviewer-loop.md')]) {
      assert.ok(body.includes('`' + github.source + '`'), 'GitHub grammar must match host-github.md');
      assert.ok(body.includes('`' + gitlab.source + '`'), 'GitLab grammar must match host-gitlab.md');
    }
    assert.match(readLib('multi-reviewer-loop.md'), /validate it against `\{CODE_HOST\}`'s username grammar/);
  });
});

// Run the GitLab cr-state jq filter against fixture API responses. jq ships on
// GitHub's runners; skip rather than fail on a machine without it.
const hasJq = spawnSync('jq', ['--version']).status === 0;

describe('GitLab cr-state normalization', { skip: !hasJq && 'jq not installed' }, () => {
  const filter = readLib(HOST_FILES.gitlab).match(/^CR_STATE_FILTER='\n([\s\S]*?)'$/m)[1];

  const run = ({ approvedBy = [], discussions }) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-state-'));
    try {
      const write = (name, value) => fs.writeFileSync(path.join(dir, name), value);
      write('mr.json', JSON.stringify({ sha: 'head3' }));
      write('versions.json', JSON.stringify([
        { head_commit_sha: 'head1', created_at: '2026-01-01T00:00:00.000Z' },
        { head_commit_sha: 'head2', created_at: '2026-01-02T00:00:00.000Z' },
        { head_commit_sha: 'head3', created_at: '2026-01-03T00:00:00.000Z' },
      ]));
      // --paginate emits one array per page; the filter must merge the stream.
      write('discussions.json', discussions.map((page) => JSON.stringify(page)).join('\n'));
      write('approvals.json', JSON.stringify({ approved_by: approvedBy.map((username) => ({ user: { username } })) }));
      const result = spawnSync('jq', ['-n', '--arg', 'login', 'rev.bot',
        '--slurpfile', 'mr', path.join(dir, 'mr.json'), '--slurpfile', 'v', path.join(dir, 'versions.json'),
        '--slurpfile', 'd', path.join(dir, 'discussions.json'), '--slurpfile', 'a', path.join(dir, 'approvals.json'),
        filter], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  const note = (fields) => ({ system: false, resolvable: false, position: null, author: { username: 'Rev.Bot' }, ...fields });
  const discussions = [
    [
      { id: 'old', notes: [note({ body: 'stale remark', created_at: '2026-01-01T01:00:00.000Z' })] },
      { id: 't1', notes: [note({ body: 'fix this', created_at: '2026-01-02T01:00:00.000Z', resolvable: true, resolved: false,
        position: { head_sha: 'head2', new_path: 'a.js', new_line: 3 } })] },
    ],
    [
      { id: 'ap', notes: [note({ system: true, body: 'approved this merge request', created_at: '2026-01-02T02:00:00.000Z' })] },
      { id: 'o1', notes: [note({ author: { username: 'someone-else' }, body: 'x', created_at: '2026-01-02T03:00:00.000Z', resolvable: true, resolved: true })] },
    ],
  ];

  it('maps each note to the commit it reviewed and keeps the head', () => {
    const state = run({ approvedBy: ['rev.bot'], discussions });
    assert.equal(state.head, 'head3');
    const byCommit = Object.fromEntries(state.reviews.map((r) => [r.commit, r]));
    assert.deepEqual(Object.keys(byCommit).sort(), ['head1', 'head2']);
    // A note written before the latest push reviewed the older version, so it can
    // never satisfy the current-head gate.
    assert.equal(byCommit.head1.state, 'COMMENTED');
    assert.equal(byCommit.head1.body, 'stale remark');
    assert.equal(byCommit.head2.state, 'APPROVED');
    assert.equal(byCommit.head2.submittedAt, '2026-01-02T02:00:00.000Z');
    assert.equal(byCommit.head2.body, '', 'a diff note is a thread, not review-body feedback');
    assert.equal(byCommit.head3, undefined, 'the newer MR head has no review until a note covers it');
  });

  it('reports resolvable discussions as threads with their author', () => {
    const { threads } = run({ approvedBy: ['rev.bot'], discussions });
    assert.deepEqual(threads.map((t) => [t.id, t.author, t.resolved, t.path, t.line]), [
      ['t1', 'Rev.Bot', false, 'a.js', 3],
      ['o1', 'someone-else', true, null, null],
    ]);
  });

  it('drops a withdrawn approval and reads requested changes', () => {
    const unapproved = run({ approvedBy: [], discussions });
    assert.equal(unapproved.reviews.find((r) => r.commit === 'head2').state, 'COMMENTED');

    const approvalOnly = run({ approvedBy: [], discussions: [[discussions[1][0]]] });
    assert.deepEqual(approvalOnly.reviews, [], 'an approval-only review that was withdrawn is no review');

    const changes = run({ discussions: [[{ id: 'rc', notes: [note({ system: true, body: 'requested changes', created_at: '2026-01-02T04:00:00.000Z' })] }]] });
    assert.deepEqual(changes.reviews.map((r) => [r.commit, r.state]), [['head2', 'CHANGES_REQUESTED']]);
  });
});
