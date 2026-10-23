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
const base = 'repos/atomantic/example/pulls';
const list = `${base}?state=open&per_page=100`;
const sha = (n) => n.toString(16).padStart(40, '0');
const pr = (number, body = null, commits = 1) => ({
  number, body, commits, state: 'open', head: { ref: `feature/topic-${number}`, sha: sha(number) },
});
const commit = (p, message = 'unrelated change') => ({ sha: p.head.sha, commit: { message } });

function fixture(pulls = [], messages = {}) {
  const responses = { [list]: [pulls] };
  for (const p of pulls) {
    responses[`${base}/${p.number}`] = p;
    responses[`${base}/${p.number}/commits?per_page=100`] = [[commit(p, messages[p.number])]];
  }
  return responses;
}

function run(t, responses, { tail = 'open_refs', assignees = '', labels = '[]', ...env } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slashdo-claim-evidence-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [endpoint, data] of Object.entries(responses)) {
    const file = path.join(dir, `${endpoint}.json`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data));
  }
  const script = `
gh() (
  printf '%s\\n' "$*" >> "$FIXTURES/calls"
  if [ "$1 $2" = 'repo view' ]; then printf 'atomantic/example'; exit 0; fi
  [ "$1" = api ] || exit 98
  for endpoint; do :; done
  [ "$endpoint" != "$FAIL_ENDPOINT" ] || exit 7
  case "$endpoint" in
    *per_page=100) case " $* " in *' --paginate --slurp '*) ;; *) exit 97 ;; esac ;;
  esac
  cat "$FIXTURES/$endpoint.json"
)
git() {
  case "$1" in
    fetch) [ "$FETCH_FAIL" != true ] ;;
    branch) [ "$BRANCH_FAIL" != true ] && printf '%s' "$LOCAL_TEST_REFS" ;;
    *) return 99 ;;
  esac
}
issue_assignees() { [ "$ASSIGNEES_FAIL" != true ] && printf '%s' "$ASSIGNEES"; }
issue_state() { [ "$STATE_FAIL" != true ] && printf '%s' "\${ISSUE_STATE:-OPEN}"; }
issue_labels() { [ "$LABELS_FAIL" != true ] && printf '%s' "$LABELS"; }
${collector}
${gates}
${tail}
`;
  const result = spawnSync('bash', ['-c', script], {
    encoding: 'utf8', timeout: 60000,
    env: { ...process.env, GH_HOST: 'forge.example', FIXTURES: dir,
      ASSIGNEES: assignees, LABELS: labels, ...env },
  });
  assert.ifError(result.error);
  return { ...result, calls: fs.existsSync(path.join(dir, 'calls')) ? readCalls(dir) : '', dir };
}
function readCalls(dir) { return fs.readFileSync(path.join(dir, 'calls'), 'utf8'); }

describe('GitHub open PR claim evidence, executed without network', () => {
  for (const trailer of ['Closes #466', 'Fixes #466', 'Fixes: #466', 'rEsOlVeS #466', 'Closed #466']) {
    it(`blocks an arbitrary PR branch with ${trailer}`, (t) => {
      const result = run(t, fixture([pr(7, trailer)]), {
        tail: 'fresh_claim_check 466 && echo AVAILABLE || echo CLAIMED',
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.trim(), 'CLAIMED');
      assert.match(result.calls, /api --hostname forge\.example --paginate --slurp/);
    });
  }

  for (const message of ['fix: part one [issue-466]', 'fix: part two (#466)']) {
    it(`blocks a head commit reference: ${message}`, (t) => {
      const p = pr(7, null, 2);
      const responses = fixture([p]);
      responses[`${base}/7/commits?per_page=100`] = [
        [{ sha: sha(99), commit: { message } }], [commit(p)],
      ];
      const result = run(t, responses, { tail: 'in_flight 466 && echo CLAIMED' });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.trim(), 'CLAIMED');
    });
  }

  it('reads all PR pages beyond the old 500 limit', (t) => {
    const pulls = Array.from({ length: 501 }, (_, i) => pr(i + 1));
    pulls[500].body = 'Closes #466';
    const responses = fixture(pulls);
    responses[list] = Array.from({ length: 6 }, (_, i) => pulls.slice(i * 100, (i + 1) * 100));
    const result = run(t, responses, { tail: 'in_flight 466 && echo CLAIMED' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'CLAIMED');
    assert.match(result.calls, /pulls\/501\/commits\?per_page=100/);
  });

  it('checks commits after the first 100', (t) => {
    const p = pr(7, null, 101);
    const responses = fixture([p]);
    responses[`${base}/7/commits?per_page=100`] = [
      Array.from({ length: 100 }, (_, i) => ({ sha: sha(i + 100), commit: { message: 'unrelated' } })),
      [commit(p, 'fix: final part (#466)')],
    ];
    const result = run(t, responses, { tail: 'in_flight 466 && echo CLAIMED' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'CLAIMED');
  });

  it('keeps claim branches and exact issue/Jira segments without numeric false positives', (t) => {
    const result = run(t, fixture([pr(7, 'Refs #466; Closes #4660')], { 7: '[issue-4660] (#4661)' }), {
      LOCAL_TEST_REFS: 'origin/claim/issue-12\ncos/task/issue-PROJ-42/worker\nfeature/466',
      tail: 'in_flight 12 && in_flight proj-42 && ! in_flight 466 && fresh_claim_check 466 && echo AVAILABLE',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'AVAILABLE');
  });

  it('treats hostile body/commit text as data', (t) => {
    const p = pr(7, '$(touch "$FIXTURES/injected")\n`touch "$FIXTURES/injected"`\nCloses #466');
    const result = run(t, fixture([p], { 7: '; touch "$FIXTURES/injected"' }));
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /issue-466/);
    assert.equal(fs.existsSync(path.join(result.dir, 'injected')), false);
  });

  it('accepts a valid empty PR list', (t) => {
    const result = run(t, fixture(), { tail: 'fresh_claim_check 466 && echo AVAILABLE' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'AVAILABLE');
  });

  it('parses large unicode bodies through stdin instead of OS argument limits', (t) => {
    const result = run(t, fixture([pr(7, `${'🙂'.repeat(40000)}\nFixes #466`)]));
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /issue-466/);
  });

  for (const [name, mutate, env] of [
    ['PR transport failure', () => {}, { FAIL_ENDPOINT: list }],
    ['malformed PR JSON', (r) => { r[list] = '{'; }],
    ['empty PR output', (r) => { r[list] = ''; }],
    ['missing PR pages', (r) => { r[list] = []; }],
    ['wrong PR page shape', (r) => { r[list] = [{}]; }],
    ['missing PR body', (r) => { delete r[list][0][0].body; }],
    ['PR detail failure', () => {}, { FAIL_ENDPOINT: `${base}/7` }],
    ['malformed PR detail', (r) => { r[`${base}/7`] = {}; }],
    ['commit transport failure', () => {}, { FAIL_ENDPOINT: `${base}/7/commits?per_page=100` }],
    ['empty commit response', (r) => { r[`${base}/7/commits?per_page=100`] = [[]]; }],
    ['malformed commit', (r) => { delete r[`${base}/7/commits?per_page=100`][0][0].commit; }],
    ['invalid commit SHA', (r) => { r[`${base}/7/commits?per_page=100`][0][0].sha = 'invalid'; }],
    ['duplicate commits', (r) => { r[`${base}/7`].commits = 2; r[`${base}/7/commits?per_page=100`][0].push(r[`${base}/7/commits?per_page=100`][0][0]); }],
    ['truncated commits', (r) => { r[`${base}/7`].commits = 251; }],
    ['changed head', (r) => { r[`${base}/7/commits?per_page=100`][0][0].sha = sha(8); }],
  ]) {
    it(`fails closed on ${name}, with no partial evidence or claim`, (t) => {
      const responses = fixture([pr(6, 'Closes #466'), pr(7)]);
      mutate(responses);
      const result = run(t, responses, { ...env, tail: 'echo CLAIM_MUTATION' });
      assert.notEqual(result.status, 0);
      assert.equal(result.stdout, 'Could not verify complete claim evidence — aborting.\n');
    });
  }
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
      const result = run(t, fixture(), { ...options,
        tail: 'fresh_claim_check 466 && echo CLAIM_MUTATION',
      });
      assert.notEqual(result.status, 0);
      assert.equal(result.stdout, '');
    });
  }

  for (const flag of ['FETCH_FAIL', 'BRANCH_FAIL']) {
    it(`stops before claiming if ${flag} occurs`, (t) => {
      const result = run(t, fixture(), { [flag]: 'true', tail: 'echo CLAIM_MUTATION' });
      assert.notEqual(result.status, 0);
      assert.doesNotMatch(result.stdout, /CLAIM_MUTATION/);
    });
  }

  it('rechecks just before creation and keeps continuation proof separate from login', () => {
    const creation = next.indexOf('git worktree add -b');
    assert.ok(next.lastIndexOf('fresh_claim_check "$ISSUE_NUM"', creation) > next.indexOf('## Phase 2'));
    assert.match(next, /Only a continuation with a trusted, recorded same-run ownership record/);
    assert.match(next, /skip fresh selection\/creation/);
    assert.match(next, /A fresh run never adopts an existing branch or PR/);
    assert.match(next, /explicit targets, auto-pick, epic children and both swarm paths/);
    assert.match(read('lib/next-swarm.md'), /Require `next.md`'s shared `fresh_claim_check <N>`/);
    assert.match(read('lib/next-gitlab.md'), /`open_refs` — `glab mr list/);
    assert.match(read('lib/tracker-jira.md'), /`issue_labels <KEY>`[\s\S]*?\.fields\.labels/);
  });

  it('ships the collector in generated command bundles', () => {
    const bundle = buildPromptBundle(next, path.join(root, 'lib'));
    assert.ok(Object.hasOwn(bundle.files, 'next-github.md'));
    assert.match(bundle.files['next-github.md'], /open_refs\(\)/);
  });
});
