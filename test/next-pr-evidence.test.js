'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildPromptBundle } = require('../src/transformer');

const root = path.join(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const next = read('commands/do/next.md');
const github = read('lib/next-github.md');
const collector = github.match(/```bash\n([\s\S]*?)\n```/)[1];
const gates = next.match(/```bash\n(refresh_in_flight\(\)[\s\S]*?)\n```/)[1];
const REPO = 'atomantic/example';

const pr = ({ number = 7, state = 'OPEN', head = `feature/topic-${number}`, title = 'unrelated',
  body = '', commits = ['unrelated change'], total, repo = REPO } = {}) => ({
  __typename: 'PullRequest', number, state, headRefName: head, title, body,
  baseRepository: { nameWithOwner: repo },
  commits: { totalCount: total ?? commits.length, nodes: commits.map((message) => ({ commit: { message } })) },
});
const xref = (source) => ({ source });
const commitRef = (...prs) => ({ commit: { associatedPullRequests: { totalCount: prs.length, nodes: prs } } });

// One GraphQL page per `timeline` entry; search and closing links repeat on every page, as GitHub returns them.
function graph({ search = [], linked = [], timeline = [[]] } = {}) {
  const totalCount = timeline.reduce((sum, page) => sum + page.length, 0);
  return timeline.map((nodes, i) => ({
    data: {
      search: { issueCount: search.length, nodes: search },
      repository: {
        nameWithOwner: REPO, defaultBranchRef: { name: 'main' },
        issue: {
          closedByPullRequestsReferences: { totalCount: linked.length, nodes: linked },
          timelineItems: { totalCount, pageInfo: { hasNextPage: i < timeline.length - 1, endCursor: `c${i}` }, nodes },
        },
      },
    },
  }));
}

function run(t, responses = {}, { tail = 'CLAIM_ID=466 pr_claim_refs', assignees = '', labels = '[]',
  cwd, realGit = false, ...env } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slashdo-claim-evidence-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const files = { 'graphql.json': graph(), ...responses };
  for (const [name, data] of Object.entries(files)) {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data));
  }
  const gitMock = realGit ? '' : `
git() {
  case "$1" in
    fetch) [ "$FETCH_FAIL" != true ] ;;
    branch) [ "$BRANCH_FAIL" != true ] && printf '%s' "$LOCAL_TEST_REFS" ;;
    rev-parse) [ "$DEFAULT_MISSING" != true ] ;;
    log) [ "$LOG_FAIL" != true ] && printf '%s' "$GREP_SHAS" ;;
    for-each-ref) [ "$CONTAINS_FAIL" != true ] && cat "$FIXTURES/contains/$3" ;;
    *) return 99 ;;
  esac
}`;
  const script = `
gh() (
  [ "$1" = api ] || exit 98
  case " $* " in *' --hostname forge.example '*) ;; *) exit 96 ;; esac
  KIND=rest SEARCH='' HEAD=''
  for arg; do
    case "$arg" in graphql) KIND=graphql ;; search=*) SEARCH="\${arg#search=}" ;; head=*) HEAD="\${arg#head=}" ;; esac
  done
  printf '%s %s\\n' "$KIND" "$HEAD" >> "$FIXTURES/calls"
  [ "$KIND" != "$FAIL_CALL" ] || exit 7
  if [ "$KIND" = graphql ]; then
    case " $* " in *' --paginate --slurp '*) ;; *) exit 97 ;; esac
    printf '%s\\n' "$SEARCH" > "$FIXTURES/search"
    cat "$FIXTURES/graphql.json"
  else
    cat "$FIXTURES/pulls/\${HEAD#*:}.json"
  fi
)
${gitMock}
issue_assignees() { [ "$ASSIGNEES_FAIL" != true ] && printf '%s' "$ASSIGNEES"; }
issue_state() { [ "$STATE_FAIL" != true ] && printf '%s' "\${ISSUE_STATE:-OPEN}"; }
issue_labels() { [ "$LABELS_FAIL" != true ] && printf '%s' "$LABELS"; }
${collector}
${gates}
${tail}
`;
  const result = spawnSync('bash', ['-c', script], {
    encoding: 'utf8', timeout: 60000, cwd,
    env: { ...process.env, GH_HOST: 'forge.example', FIXTURES: dir,
      ASSIGNEES: assignees, LABELS: labels, ...env },
  });
  assert.ifError(result.error);
  const calls = path.join(dir, 'calls');
  return { ...result, calls: fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8') : '', dir };
}

// CLAIMED only when the PR evidence itself names the issue, so a lookup error cannot pass as a claim.
const CHECK = `if CLAIM_ID=466 fresh_claim_check; then echo AVAILABLE;
elif printf '%s\\n' "$CLAIM_PR_REFS" | tr / '\\n' | grep -qx issue-466; then echo CLAIMED; else echo ERROR; fi`;
function assertClaimed(result, expected = 'CLAIMED') {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), expected);
}

describe('GitHub per-issue PR claim evidence, executed without network', () => {
  for (const trailer of ['Closes #466', 'Fixes #466', 'Fixes: #466', 'rEsOlVeS #466', 'Closed #466']) {
    it(`blocks an arbitrary cross-referencing PR branch with ${trailer}`, (t) => {
      const result = run(t, { 'graphql.json': graph({ timeline: [[xref(pr({ body: trailer }))]] }) }, { tail: CHECK });
      assertClaimed(result);
      assert.equal(result.calls, 'graphql \n');
    });
  }

  for (const message of ['fix: part one [issue-466]', 'fix: part two (#466)']) {
    it(`blocks a surfaced PR whose head commit says ${message}`, (t) => {
      const p = pr({ body: 'Refs #466', commits: ['unrelated', message] });
      const result = run(t, { 'graphql.json': graph({ timeline: [[xref(p)]] }) }, { tail: CHECK });
      assertClaimed(result);
    });

    it(`blocks a same-repo PR whose only reference is a head commit: ${message}`, (t) => {
      const result = run(t, {
        'contains/abc123': 'feature/interactive\nHEAD\n',
        'pulls/feature/interactive.json': [{ number: 9, head: { ref: 'feature/interactive' } }],
      }, { GREP_SHAS: 'abc123\n', tail: CHECK });
      assertClaimed(result);
      assert.equal(result.calls, 'graphql \nrest atomantic:feature/interactive\n');
    });
  }

  it('blocks an open PR linked as closing the issue even without a textual reference', (t) => {
    assertClaimed(run(t, { 'graphql.json': graph({ linked: [pr()] }) }, { tail: CHECK }));
  });

  it('blocks a search hit whose title carries [issue-N], and searches for that segment', (t) => {
    const result = run(t, { 'graphql.json': graph({ search: [pr({ title: 'fix([issue-466]): thing' })] }) }, { tail: CHECK });
    assertClaimed(result);
    assert.match(fs.readFileSync(path.join(result.dir, 'search'), 'utf8'), /is:pr is:open "issue-466"/);
  });

  it('blocks a PR surfaced by a referencing commit, and a fork PR on an issue-N branch', (t) => {
    const fork = pr({ head: 'contrib/issue-466', body: 'see #466' });
    assertClaimed(run(t, { 'graphql.json': graph({ timeline: [[commitRef(pr({ commits: ['wip (#466)'] }))]] }) }, { tail: CHECK }));
    assertClaimed(run(t, { 'graphql.json': graph({ timeline: [[xref(fork)]] }) }, { tail: CHECK }));
  });

  it('reads every timeline page', (t) => {
    const timeline = [Array.from({ length: 100 }, (_, i) => xref(pr({ number: i + 10 }))), [xref(pr({ body: 'Fixes #466' }))]];
    assertClaimed(run(t, { 'graphql.json': graph({ timeline }) }, { tail: CHECK }));
  });

  it('ignores closed, merged and other-repository PRs, and branches without an open PR', (t) => {
    const timeline = [[xref(pr({ state: 'MERGED', body: 'Closes #466' })), xref(pr({ state: 'CLOSED', body: 'Closes #466' })),
      xref(pr({ repo: 'someone/else', body: 'Closes atomantic/example#466' })), xref({ __typename: 'Issue' }), { commit: null }]];
    const result = run(t, {
      'graphql.json': graph({ timeline, linked: [pr({ state: 'MERGED' })] }),
      'contains/abc123': 'stale/branch\n', 'pulls/stale/branch.json': [],
    }, { GREP_SHAS: 'abc123\n', tail: CHECK });
    assertClaimed(result, 'AVAILABLE');
  });

  it('keeps claim branches and exact issue/Jira segments without numeric false positives', (t) => {
    const p = pr({ body: 'Refs #466; Closes #4660', commits: ['[issue-4660] (#4661)'] });
    const result = run(t, { 'graphql.json': graph({ timeline: [[xref(p)]] }) }, {
      LOCAL_TEST_REFS: 'origin/claim/issue-12\ncos/task/issue-PROJ-42/worker\nfeature/466',
      tail: 'git fetch && refresh_in_flight && CLAIM_ID=12 in_flight && CLAIM_ID=proj-42 in_flight && ! CLAIM_ID=466 in_flight && CLAIM_ID=466 fresh_claim_check && echo AVAILABLE',
    });
    assertClaimed(result, 'AVAILABLE');
  });

  it('treats hostile title/body/commit text as data', (t) => {
    const p = pr({ title: '$(touch "$FIXTURES/injected")', body: '`touch "$FIXTURES/injected"`\nCloses #466',
      commits: ['; touch "$FIXTURES/injected"'] });
    const result = run(t, { 'graphql.json': graph({ timeline: [[xref(p)]] }) });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /issue-466/);
    assert.equal(fs.existsSync(path.join(result.dir, 'injected')), false);
  });

  it('parses large unicode bodies through stdin instead of OS argument limits', (t) => {
    const p = pr({ body: `${'🙂'.repeat(40000)}\nFixes #466` });
    const result = run(t, { 'graphql.json': graph({ timeline: [[xref(p)]] }) });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /issue-466/);
  });

  it('accepts a complete read with no open PR, in one API call', (t) => {
    const result = run(t, {}, { tail: CHECK });
    assertClaimed(result, 'AVAILABLE');
    assert.equal(result.calls, 'graphql \n');
  });

  it('reads no PR evidence for a candidate that is already assigned or a Jira key', (t) => {
    assert.equal(run(t, {}, { assignees: 'volunteer', tail: CHECK }).calls, '');
    const jira = run(t, {}, { tail: 'CLAIM_ID=PROJ-466 fresh_claim_check && echo AVAILABLE' });
    assertClaimed(jira, 'AVAILABLE');
    assert.equal(jira.calls, '');
  });

  const page = () => graph({ timeline: [[xref(pr({ body: 'Refs #466' }))]] });
  for (const [name, mutate, env] of [
    ['GraphQL transport failure', () => {}, { FAIL_CALL: 'graphql' }],
    ['malformed GraphQL JSON', (r) => { r['graphql.json'] = '{'; }],
    ['empty GraphQL output', (r) => { r['graphql.json'] = ''; }],
    ['no GraphQL pages', (r) => { r['graphql.json'] = []; }],
    ['GraphQL errors', (r) => { r['graphql.json'][0].errors = [{ message: 'rate limited' }]; }],
    ['missing issue', (r) => { r['graphql.json'][0].data.repository.issue = null; }],
    ['too many search hits', (r) => { r['graphql.json'][0].data.search.issueCount = 101; }],
    ['short search page', (r) => { r['graphql.json'][0].data.search.issueCount = 1; }],
    ['truncated closing links', (r) => { r['graphql.json'][0].data.repository.issue.closedByPullRequestsReferences.totalCount = 1; }],
    ['unfinished timeline pagination', (r) => { r['graphql.json'][0].data.repository.issue.timelineItems.pageInfo.hasNextPage = true; }],
    ['short timeline', (r) => { r['graphql.json'][0].data.repository.issue.timelineItems.totalCount = 2; }],
    ['open PR with more commits than read', (r) => { r['graphql.json'][0].data.repository.issue.timelineItems.nodes[0].source.commits.totalCount = 101; }],
    ['open PR without a body', (r) => { delete r['graphql.json'][0].data.repository.issue.timelineItems.nodes[0].source.body; }],
    ['truncated commit-associated PRs', (r) => { r['graphql.json'][0].data.repository.issue.timelineItems.nodes.push(commitRef()); r['graphql.json'][0].data.repository.issue.timelineItems.totalCount = 2; r['graphql.json'][0].data.repository.issue.timelineItems.nodes[1].commit.associatedPullRequests.totalCount = 1; }],
    ['missing default branch', (r) => { r['graphql.json'][0].data.repository.defaultBranchRef = null; }],
    ['default branch not fetched', () => {}, { DEFAULT_MISSING: 'true' }],
    ['commit search failure', () => {}, { LOG_FAIL: 'true' }],
    ['branch lookup failure', () => {}, { GREP_SHAS: 'abc123\n', CONTAINS_FAIL: 'true' }],
    ['open PR lookup failure', () => {}, { GREP_SHAS: 'abc123\n', FAIL_CALL: 'rest' }],
    ['malformed open PR lookup', (r) => { r['pulls/feature/x.json'] = '{}'; }, { GREP_SHAS: 'abc123\n' }],
    ['open PR lookup for another branch', (r) => { r['pulls/feature/x.json'] = [{ head: { ref: 'other' } }]; }, { GREP_SHAS: 'abc123\n' }],
    ['malformed claim id', () => {}, { tail: 'CLAIM_ID=46a6 fresh_claim_check && echo CLAIM_MUTATION' }],
  ]) {
    it(`fails closed on ${name}, with no partial evidence or claim`, (t) => {
      const responses = { 'graphql.json': page(), 'contains/abc123': 'feature/x\n', 'pulls/feature/x.json': [] };
      mutate(responses);
      const result = run(t, responses, { tail: 'CLAIM_ID=466 fresh_claim_check && echo CLAIM_MUTATION', ...env });
      assert.notEqual(result.status, 0);
      assert.equal(result.stdout, '');
    });
  }
});

describe('commit-reference scan against a real git remote', () => {
  const sh = (cwd, ...args) => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8',
      env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@e', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@e' } });
    assert.equal(r.status, 0, r.stderr);
  };

  it('finds unmerged origin branches whose commits reference the issue, and nothing on the default branch', (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slashdo-claim-git-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const origin = path.join(dir, 'origin.git');
    const work = path.join(dir, 'work');
    sh(dir, 'init', '-q', '--bare', origin);
    sh(dir, 'clone', '-q', origin, work);
    sh(work, 'checkout', '-q', '-b', 'main');
    sh(work, 'commit', '-q', '--allow-empty', '-m', 'feat: merged work (#466)');
    sh(work, 'push', '-q', 'origin', 'main');
    for (const [branch, message] of [['feature/interactive', 'fix: part two (#466)'], ['feature/trailer', 'chore: tidy\n\nFIXES: #466'],
      ['feature/near', 'fix: [issue-4660] (#4661) closes #4660'], ['feature/other', 'docs: unrelated']]) {
      sh(work, 'checkout', '-q', '-b', branch, 'main');
      sh(work, 'commit', '-q', '--allow-empty', '-m', message);
      sh(work, 'push', '-q', 'origin', branch);
    }
    sh(work, 'checkout', '-q', 'main');
    const result = run(t, {
      'pulls/feature/interactive.json': [{ head: { ref: 'feature/interactive' } }],
      'pulls/feature/trailer.json': [],
    }, { realGit: true, cwd: work, tail: 'git fetch -q --prune && CLAIM_ID=466 pr_claim_refs' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stdout.split('\n').filter(Boolean), ['feature/interactive', 'issue-466']);
    assert.equal(result.calls, 'graphql \nrest atomantic:feature/interactive\nrest atomantic:feature/trailer\n');
  });
});

describe('fresh ownership checks shared by explicit, auto-pick and swarm', () => {
  for (const [name, options] of [
    ['same-login assignment', { assignees: 'atomantic' }],
    ['other assignment', { assignees: 'volunteer' }],
    ['closed issue', { ISSUE_STATE: 'CLOSED' }],
    ['issue state lookup failure', { STATE_FAIL: 'true' }],
    ['in-progress marker', { labels: '["in-progress"]' }],
    ['assignee lookup failure', { ASSIGNEES_FAIL: 'true' }],
    ['label lookup failure', { LABELS_FAIL: 'true' }],
    ['malformed labels', { labels: '{}' }],
    ['existing local branch', { LOCAL_TEST_REFS: 'next/issue-466' }],
  ]) {
    it(`refuses ${name}`, (t) => {
      const result = run(t, {}, { ...options,
        tail: 'refresh_in_flight && CLAIM_ID=466 fresh_claim_check && echo CLAIM_MUTATION',
      });
      assert.notEqual(result.status, 0);
      assert.equal(result.stdout, '');
    });
  }

  for (const flag of ['FETCH_FAIL', 'BRANCH_FAIL']) {
    it(`stops before claiming if ${flag} occurs`, (t) => {
      const result = run(t, {}, { [flag]: 'true',
        tail: 'refresh_in_flight || { echo "Could not verify complete claim evidence — aborting."; exit 1; }; echo CLAIM_MUTATION' });
      assert.notEqual(result.status, 0);
      assert.doesNotMatch(result.stdout, /CLAIM_MUTATION/);
    });
  }
});
