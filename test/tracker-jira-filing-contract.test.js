'use strict';

// The backlog and filing commands serving a Jira tracker (#423). Like
// test/next-jira-contract.test.js, the executable layer RUNS lib/tracker-jira.md's
// "File one issue" and "List issues" blocks against a stub `jira`, so filing (create,
// key capture, labels) and the backlog/dedup read are checked as behavior. The wiring
// layer keeps /do:replan, /do:plan-task, /do:goals, and the deferred-finding filers
// running the Jira pre-flight in place of the tracker gate rather than treating Jira
// as no tracker.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), 'utf8');
const jira = read('lib', 'tracker-jira.md');

const section = (doc, marker) => {
  const start = doc.indexOf(marker);
  assert.ok(start > -1, `missing section ${marker}`);
  const level = marker.match(/^\n(#+) /)[1];
  const end = doc.slice(start + 1).search(new RegExp(`\\n#{1,${level.length}} `));
  return end === -1 ? doc.slice(start) : doc.slice(start, start + 1 + end);
};
const bash = (text) => {
  const blocks = [...text.matchAll(/```bash\n([\s\S]*?)```/g)].map(([, body]) => body);
  assert.equal(blocks.length, 1, `expected one bash block in:\n${text.slice(0, 200)}`);
  return blocks[0];
};

const serving = section(jira, '\n## Serving the backlog and filing commands\n');
const preflight = bash(section(jira, '\n## Pre-flight\n')).replace(/\{COMMAND\}/g, '/do:better');
const fileOne = bash(section(serving, '\n### File one issue\n'));
const listIssues = bash(section(serving, '\n### List issues\n'));

// Every argv is logged one word per `|`, so a test can check word boundaries.
const JIRA_STUB = `#!/bin/sh
{ printf '%s|' "$@"; echo; } >> "$CALL_LOG"
case "$1 $2" in
  "me "*) echo "dev@example.com"; exit 0 ;;
  "issue list")
    case "$*" in
      *--raw*)
        [ "$JIRA_LIST_MODE" = denied ] && { echo "Error: 401 Unauthorized" >&2; exit 1; }
        prev=""; from=""; for a in "$@"; do [ "$prev" = "--paginate" ] && from="\${a%%:*}"; prev="$a"; done
        if [ -f "$PAGES/$from.json" ]; then cat "$PAGES/$from.json"
        else echo "No result found for given query in project" >&2; exit 1; fi ;;
      *) echo "PROJ-1" ;;
    esac ;;
  "issue create")
    case "$JIRA_CREATE_MODE" in
      fail) echo "Error: 400 Bad Request" >&2; exit 1 ;;
      banner) echo "Issue created https://jira.example/browse/PROJ-7" ;;
      *) echo '{"id":"10001","key":"PROJ-7","self":"https://jira.example/rest/api/2/issue/10001"}' ;;
    esac ;;
esac
exit 0
`;

function runShell(body, { env = {}, pages = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slashdo-jira-filing-'));
  try {
    const repo = path.join(dir, 'repo');
    fs.mkdirSync(repo);
    execFileSync('git', ['init', '-q'], { cwd: repo });
    fs.writeFileSync(path.join(repo, '.slashdo.json'), '{"defaults":{"tracker":"jira","jira-project":"proj"}}');
    const home = path.join(dir, 'home');
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'jira'), JIRA_STUB, { mode: 0o755 });
    const pagesDir = path.join(dir, 'pages');
    fs.mkdirSync(pagesDir);
    for (const [from, issues] of Object.entries(pages)) fs.writeFileSync(path.join(pagesDir, `${from}.json`), JSON.stringify(issues));
    const callLog = path.join(dir, 'calls.log');
    fs.writeFileSync(callLog, '');
    const bodyFile = path.join(dir, 'body.md');
    fs.writeFileSync(bodyFile, 'Finding with `backticks` and $(not a command)\n');
    const script = path.join(dir, 'run.sh');
    fs.writeFileSync(script, body.replace(/<body-file>/g, `"${bodyFile}"`));
    const result = spawnSync('sh', [script], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, HOME: home, CALL_LOG: callLog, PAGES: pagesDir, PATH: `${bin}${path.delimiter}${process.env.PATH}`, ...env },
    });
    const calls = fs.readFileSync(callLog, 'utf8').split('\n').filter(Boolean);
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, calls };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const creates = (calls) => calls.filter((c) => c.startsWith('issue|create|'));
const issue = (key, { labels = [], category = 'new' } = {}) => ({
  key,
  fields: {
    summary: `Summary of ${key}`, labels, created: '2026-01-01', updated: '2026-02-01',
    issuetype: { name: 'Task' }, status: { name: 'To Do', statusCategory: { key: category } },
  },
});

describe('Jira "File one issue", executed', () => {
  const file = ({ title = '"Guard the empty config path"', labels = 'plan security "severity:high" "model:light"', parent = '' } = {}) => {
    let script = fileOne.replace('<title>', title).replace('<label>...', labels);
    if (parent) script = script.replace('<parent-KEY, or empty>', parent);
    return runShell(`${preflight}\n${script}`);
  };

  it('creates in JIRA_PROJECT with one -l per label and captures the key from --raw', () => {
    const result = file();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /^FILED=PROJ-7$/m);
    const [create, ...rest] = creates(result.calls);
    assert.deepEqual(rest, [], 'files exactly one issue');
    assert.match(create, /^issue\|create\|-p\|PROJ\|-t\|Task\|-s\|Guard the empty config path\|--template\|[^|]+body\.md\|-l\|plan\|-l\|security\|-l\|severity:high\|-l\|model:light\|--no-input\|--raw\|$/);
  });

  it('files an epic child with -P, and no labels at all when none apply', () => {
    const child = file({ parent: 'PROJ-3', labels: '' });
    assert.equal(child.status, 0, child.stdout + child.stderr);
    assert.match(creates(child.calls)[0], /\|--template\|[^|]+\|-P\|PROJ-3\|--no-input\|--raw\|$/);
    assert.doesNotMatch(creates(child.calls)[0], /\|-l\|/);
    const bad = file({ parent: '123' });
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /"123" is not a Jira issue key/);
    assert.deepEqual(creates(bad.calls), []);
  });

  it('aborts on a label with whitespace before filing anything', () => {
    const result = file({ labels: 'plan "needs decision"' });
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stdout, /Jira labels cannot contain spaces \(got: needs decision\)/);
    assert.deepEqual(creates(result.calls), []);
  });

  it('fails loudly, with no key, when the create fails or prints only a banner', () => {
    for (const mode of ['fail', 'banner']) {
      const script = fileOne.replace('<title>', '"T"').replace('<label>...', 'plan');
      const result = runShell(`${preflight}\n${script}`, { env: { JIRA_CREATE_MODE: mode } });
      assert.equal(result.status, 1, `${mode}: ${result.stdout}`);
      assert.match(result.stdout, /Could not file "T" in PROJ\./);
      assert.doesNotMatch(result.stdout, /FILED=/);
    }
  });
});

describe('Jira "List issues", executed', () => {
  const list = (state, labels) => runShell.bind(null, `${preflight}\n${listIssues.replace('<statusCategory != Done | statusCategory = Done>', state).replace('<label>...', labels)}`);
  const rows = (stdout) => stdout.trim().split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
  const listCalls = (calls) => calls.filter((c) => c.includes('--raw'));

  it('reads the PLAN_LABEL backlog with the fields replan triages on', () => {
    const result = list('statusCategory != Done', '"plan"')({ pages: { 0: [issue('PROJ-1', { labels: ['plan'] }), issue('PROJ-2', { labels: ['plan', 'epic'] })] } });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(rows(result.stdout).map((r) => [r.key, r.updated, r.created]), [['PROJ-1', '2026-02-01', '2026-01-01'], ['PROJ-2', '2026-02-01', '2026-01-01']]);
    assert.match(listCalls(result.calls)[0], /^issue\|list\|-p\|PROJ\|-q\|statusCategory != Done AND labels = "plan"\|--order-by\|created\|--reverse\|--paginate\|0:100\|--raw\|$/);
    assert.deepEqual(creates(result.calls), []);
  });

  it('lists every open issue for EXISTING_ISSUES and closed rejections by two labels', () => {
    const all = list('statusCategory != Done', '')({ pages: { 0: [issue('PROJ-1')] } });
    assert.match(listCalls(all.calls)[0], /\|-q\|statusCategory != Done\|/);
    const rejected = list('statusCategory = Done', '"plan" rejected-reframing')({ pages: {} });
    assert.equal(rejected.status, 0, 'an empty result is not a failure');
    assert.deepEqual(rows(rejected.stdout), []);
    assert.match(listCalls(rejected.calls)[0], /\|-q\|statusCategory = Done AND labels = "plan" AND labels = "rejected-reframing"\|/);
  });

  it('pages 100 at a time', () => {
    const full = Array.from({ length: 100 }, (_, i) => issue(`PROJ-${i + 1}`));
    const result = list('statusCategory != Done', '')({ pages: { 0: full, 100: [issue('PROJ-101')] } });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(rows(result.stdout).length, 101);
    assert.deepEqual(listCalls(result.calls).map((c) => c.match(/--paginate\|([^|]+)/)[1]), ['0:100', '100:100']);
  });

  it('fails closed on a list error, and never sends a label that escapes the JQL', () => {
    const denied = list('statusCategory != Done', '')({ env: { JIRA_LIST_MODE: 'denied' } });
    assert.equal(denied.status, 1);
    assert.match(denied.stdout, /Could not list PROJ issues — aborting/);
    const quoted = list('statusCategory != Done', `'plan" OR project = OPS'`)({ pages: { 0: [issue('PROJ-1')] } });
    assert.equal(quoted.status, 1);
    assert.match(quoted.stdout, /Jira labels cannot contain spaces or quotes/);
    assert.deepEqual(listCalls(quoted.calls), []);
  });
});

describe('the backlog and filing commands are wired to the Jira backend', () => {
  const replan = read('commands', 'do', 'replan.md');
  const planTask = read('commands', 'do', 'plan-task.md');

  for (const [name, doc, command] of [['replan', replan, '/do:replan'], ['plan-task', planTask, '/do:plan-task']]) {
    it(`/do:${name} runs the Jira pre-flight in place of the tracker gate`, () => {
      const vcs = doc.indexOf('!read lib/vcs-host.md');
      const jiraRead = doc.search(/\n *!read lib\/tracker-jira\.md\n/);
      const gateLine = doc.search(/Otherwise, stop[^\n]*tracker/);
      assert.ok(vcs > -1 && vcs < jiraRead && jiraRead < gateLine, 'vcs-host → tracker-jira → plain gate');
      assert.ok(doc.includes(`Pre-flight (\`{COMMAND}\` = \`${command}\`) in place of the tracker gate`));
      assert.match(doc, /It alone sets `TRACKER_CLI` to `jira`/);
    });
  }

  it('routes every Jira filing path through "File one issue" and reports keys', () => {
    assert.match(replan, /"`\/do:replan` on Jira"/);
    assert.match(planTask, /"File one issue"/);
    assert.match(planTask, /`\/do:next <KEY>`/);
    const goals = read('commands', 'do', 'goals.md');
    assert.match(goals, /run its Pre-flight \(`\{COMMAND\}` = `\/do:goals`\) in place of the tracker gate/);
    assert.match(goals, /"File one issue" block/);
    assert.match(serving, /\| bulk filer map `<id> -> #<number>` \| `<id> -> PROJ-123`/);
    assert.match(serving, /never `#123`, which names an unrelated code-host issue/);
  });

  it('serves every deferred-finding filer through the shared setup partial', () => {
    // The setup partial is on /do:better's default path, so its Jira read is gated
    // (test/better-context.test.js) and the forms live in tracker-jira.md.
    const setup = read('lib', 'plan-issue-setup.md');
    assert.match(setup, /^Only on a Jira tracker \(`TRACKER=jira`\), if not yet read \(it replaces the tracker gate, these calls, `#<n>`\):\n\n!read lib\/tracker-jira\.md$/m);
    assert.match(serving, /give each filer `JIRA_PROJECT` and "File one issue"/);
    // better/better-swift/simplify/pr-better share discovery; depfree has its own Phase 0.
    assert.match(read('lib', 'better-discovery.md'), /^Only on a Jira tracker \(`TRACKER=jira`\), whose Pre-flight is the gate \(pass = available\):\n\n!read lib\/tracker-jira\.md$/m);
    const depfree = read('commands', 'do', 'depfree.md');
    assert.match(depfree, /On a Jira tracker it is `true` only when the Jira Pre-flight below passes/);
    assert.match(depfree, /^Only on a Jira tracker \(`TRACKER=jira`\), read the Jira backend and run its Pre-flight in place of the tracker gate:\n\n!read lib\/tracker-jira\.md$/m);
    // /do:review and /do:rpr defer through plan-issue-setup.md, which reads the backend.
    for (const rel of ['commands/do/review.md', 'commands/do/rpr.md']) {
      assert.match(read(rel), /^!read lib\/plan-issue-setup\.md$/m, rel);
      assert.match(read(rel), /PROJ-123/, `${rel} must report filed issues by key on Jira`);
    }
    assert.match(read('lib', 'better-simplify.md'), /tracker-jira\.md\)[^\n]*"Rejected-reframing records"/);
  });

  it('no ported consumer still treats Jira as an unserved tracker', () => {
    assert.match(serving, /\*\*A failed Pre-flight is "no tracker"\*\*/);
    const config = read('commands', 'do', 'config.md');
    assert.doesNotMatch(config, /does not run the Jira backend's pre-flight yet/);
    assert.match(config, /A `jira` tracker is served by every tracker-backed command/);
    for (const rel of ['commands/do/replan.md', 'commands/do/plan-task.md', 'commands/do/goals.md', 'lib/plan-issue-setup.md']) {
      assert.doesNotMatch(read(rel), /jira[^\n]*(?:unserved|not served|treated as no tracker)/i, rel);
    }
  });
});
