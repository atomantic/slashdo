'use strict';

// /do:next serving a Jira tracker (#422). The executable layer RUNS the shell that
// decides a claim — the in-flight segment match in next.md, and the Jira target,
// walk, claim, release, and close blocks in lib/tracker-jira.md — against a stub
// `jira`, the same way test/tracker-jira-contract.test.js checks the verbs. The
// wiring layer keeps next.md, next-swarm.md, epic-children.md, and merge-gate.md
// pointed at those blocks instead of GitHub-only behavior (`Closes #`, labels).

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), 'utf8');
const next = read('commands', 'do', 'next.md');
const jira = read('lib', 'tracker-jira.md');
const swarm = read('lib', 'next-swarm.md');
const epics = read('lib', 'epic-children.md');
const gate = read('lib', 'merge-gate.md');

const section = (doc, marker) => {
  const start = doc.indexOf(marker);
  assert.ok(start > -1, `missing section ${marker}`);
  const level = marker.match(/^\n(#+) /)[1];
  const end = doc.slice(start + 1).search(new RegExp(`\\n#{1,${level.length}} `));
  return end === -1 ? doc.slice(start) : doc.slice(start, start + 1 + end);
};
const bash = (text, { count = 1, index = 0 } = {}) => {
  const blocks = [...text.matchAll(/```bash\n([\s\S]*?)```/g)].map(([, body]) => body);
  assert.equal(blocks.length, count, `expected ${count} bash block(s) in:\n${text.slice(0, 200)}`);
  return blocks[index];
};

const serving = section(jira, '\n## Serving `/do:next`\n');
// `heading` is the whole heading line, so `Claim` never matches `Claim gates`.
const block = (heading, opts) => bash(section(serving, `\n### ${heading}\n`), opts);
const preflight = bash(section(jira, '\n## Pre-flight\n')).replace(/\{COMMAND\}/g, '/do:next');
const leaseHelper = block('Lease helper');

// PRIORITY_SORT (next.md Conventions) with Jira's fields filled in, escaped for the
// double-quoted jq program the walk passes it in.
const prioritySort = () => {
  const fragment = next.match(/\*\*`PRIORITY_SORT`\*\*[\s\S]*?```\n([\s\S]*?)\n```/)[1];
  return fragment
    .replace(/<labels>/g, '.fields.labels[]')
    .replace(/<created>/g, '.fields.created')
    .replace(/"/g, '\\"');
};

// Every argv is logged one word per `|`. The lease answers come from JIRA_LEASE_SEQ,
// one comma-separated answer per call (the last repeats).
const JIRA_STUB = `#!/bin/sh
{ printf '%s|' "$@"; echo; } >> "$CALL_LOG"
case "$1 $2" in
  "me "*) [ -n "$JIRA_LOGIN" ] && echo "$JIRA_LOGIN"; exit 0 ;;
  "issue list")
    case "$*" in
      *"assignee = currentUser()"*)
        n=$(($(cat "$STATE/lease" 2>/dev/null || echo 0) + 1)); echo "$n" > "$STATE/lease"
        ans="$(printf '%s' "$JIRA_LEASE_SEQ" | cut -d, -f"$n")"
        [ -n "$ans" ] || ans="$(printf '%s' "$JIRA_LEASE_SEQ" | awk -F, '{print $NF}')"
        case "$ans" in
          yes) echo "PROJ-7" ;;
          no) echo "No result found for given query in project" >&2; exit 1 ;;
          *) echo "Error: 500 Internal Server Error" >&2; exit 1 ;;
        esac ;;
      *--raw*)
        [ "$JIRA_LIST_MODE" = denied ] && { echo "Error: 401 Unauthorized" >&2; exit 1; }
        prev=""; from=""; for a in "$@"; do [ "$prev" = "--paginate" ] && from="\${a%%:*}"; prev="$a"; done
        if [ -f "$PAGES/$from.json" ]; then cat "$PAGES/$from.json"
        else echo "No result found for given query in project" >&2; exit 1; fi ;;
      *) echo "PROJ-1" ;;
    esac ;;
  "issue view") echo "$JIRA_VIEW_JSON" ;;
  "issue move") [ "$JIRA_MOVE_FAIL" = 1 ] && { echo "Error: invalid transition" >&2; exit 1; } ;;
esac
exit 0
`;

function runShell(body, { env = {}, pages = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slashdo-next-jira-'));
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
    const state = path.join(dir, 'state');
    const pagesDir = path.join(dir, 'pages');
    fs.mkdirSync(state);
    fs.mkdirSync(pagesDir);
    for (const [from, issues] of Object.entries(pages)) fs.writeFileSync(path.join(pagesDir, `${from}.json`), JSON.stringify(issues));
    const callLog = path.join(dir, 'calls.log');
    fs.writeFileSync(callLog, '');
    const script = path.join(dir, 'run.sh');
    fs.writeFileSync(script, body);
    const result = spawnSync('sh', [script], {
      cwd: repo,
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: home,
        CALL_LOG: callLog,
        STATE: state,
        PAGES: pagesDir,
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        JIRA_LOGIN: 'dev@example.com',
        JIRA_LEASE_SEQ: 'yes',
        ...env,
      },
    });
    const calls = fs.readFileSync(callLog, 'utf8').split('\n').filter(Boolean);
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, calls };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const MUTATIONS = /^issue\|(create|edit|assign|move|comment)\|/;
const mutations = (calls) => calls.filter((c) => MUTATIONS.test(c));
const issue = (key, { labels = [], created = '2026-01-01', status = 'To Do', category = 'new', assignee = null } = {}) => ({
  key,
  fields: {
    summary: `Summary of ${key}`, labels, created, issuetype: { name: 'Task' }, subtasks: [],
    status: { name: status, statusCategory: { key: category } },
    assignee: assignee && { displayName: assignee }, reporter: { displayName: 'Dev' },
  },
});

describe('in-flight segment match (next.md), executed', () => {
  const inFlight = next.split('\n').find((line) => line.startsWith('in_flight() {'));
  const check = (refs, id) => {
    const script = `IN_FLIGHT_REFS='${refs.join('\n')}'\n${inFlight}\nin_flight '${id}' && echo HIT || echo MISS\n`;
    const out = execFileSync('sh', ['-c', script], { encoding: 'utf8' }).trim();
    return out === 'HIT';
  };

  it('is defined once, in the Phase 1 in-flight block', () => {
    assert.ok(inFlight, 'next.md must define in_flight() as a shell function');
    assert.match(next, /IN_FLIGHT_REFS="\$\(git branch -a --no-color --format='%\(refname:short\)'; open_refs 2>\/dev\/null \|\| true\)"/);
    assert.match(next, /Issue `N` is in flight if EITHER `in_flight N` succeeds/);
  });

  it('accepts issue-PROJ-123 for PROJ-123 on any ref, with a case-insensitive project', () => {
    assert.ok(check(['main', 'origin/next/issue-PROJ-123'], 'PROJ-123'));
    assert.ok(check(['next/issue-proj-123'], 'PROJ-123'));
    assert.ok(check(['claim/issue-PROJ-123'], 'proj-123'));
  });

  it('rejects a neighboring key and a bare key without the issue- segment', () => {
    assert.ok(!check(['next/issue-PROJ-12', 'next/issue-PROJ-1234'], 'PROJ-123'));
    assert.ok(!check(['next/issue-PROJ-123'], 'PROJ-12'));
    assert.ok(!check(['next/issue-PROJ-123'], 'PROJ-1234'));
    assert.ok(!check(['next/PROJ-123', 'origin/PROJ-123'], 'PROJ-123'), 'a bare next/<KEY> is not a claim');
    assert.ok(!check(['next/issue-OTHER-123'], 'PROJ-123'));
  });

  it('keeps the GitHub/GitLab numeric match exactly as before', () => {
    assert.ok(check(['origin/next/issue-12'], '12'));
    assert.ok(check(['claim/issue-12'], '12'));
    assert.ok(!check(['feature/12', 'hotfix/12', 'release/v12', 'fix-issue-12'], '12'), 'a bare number in an unrelated ref never matches');
    assert.ok(!check(['next/issue-123', 'next/issue-1'], '12'));
    assert.ok(!check(['next/issue-PROJ-12'], '12'));
  });
});

describe('Jira targets, executed', () => {
  const run = (target) => runShell(`JIRA_PROJECT=PROJ\nT='${target}'\n${block('Targets')}`);

  it('normalizes a key, #-prefixed or lowercase', () => {
    for (const target of ['PROJ-123', '#PROJ-123', 'proj-123']) {
      const result = run(target);
      assert.equal(result.status, 0, result.stdout);
      assert.match(result.stdout, /^TARGET=PROJ-123$/m);
    }
  });

  it('rejects bare numbers, malformed keys, and other projects', () => {
    for (const target of ['123', '#123', 'PROJ', 'PROJ-0', 'PROJ-12a']) {
      const result = run(target);
      assert.equal(result.status, 1, target);
      assert.match(result.stdout, /is not a Jira issue key — the tracker is Jira, so \/do:next claims keys \(e\.g\. PROJ-123\)/);
    }
    const other = run('OPS-5');
    assert.equal(other.status, 1);
    assert.match(other.stdout, /OPS-5 is not in Jira project PROJ/);
  });
});

describe('Jira queue walk, executed', () => {
  const walk = (vars) => `${preflight}\n${vars}\n${block('Queue walk', { count: 2 }).replace(/PRIORITY_SORT/g, prioritySort())}`;

  it('lists open issues by JQL, priority label first, then oldest', () => {
    const result = runShell(walk('LABEL_FILTER=plan; SELF_MODE=true'), {
      pages: { 0: [
        issue('PROJ-1', { created: '2026-01-01' }),
        issue('PROJ-2', { labels: ['priority:2'], created: '2026-01-02' }),
        issue('PROJ-3', { labels: ['priority:1', 'model:light'], created: '2026-01-03', assignee: 'Someone' }),
      ] },
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const rows = result.stdout.trim().split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
    assert.deepEqual(rows.map((r) => r.key), ['PROJ-3', 'PROJ-2', 'PROJ-1']);
    assert.equal(rows[0].assignee, 'Someone');
    assert.equal(rows[1].assignee, null);
    const list = result.calls.find((c) => c.includes('--raw'));
    assert.match(list, /^issue\|list\|-p\|PROJ\|-q\|statusCategory != Done AND labels = "plan" AND reporter = currentUser\(\)\|--order-by\|created\|--reverse\|--paginate\|0:100\|--raw\|$/);
    assert.deepEqual(mutations(result.calls), []);
  });

  it('pages 100 at a time and treats "No result found" as an empty page', () => {
    const full = Array.from({ length: 100 }, (_, i) => issue(`PROJ-${i + 1}`, { created: `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}` }));
    const result = runShell(walk(''), { pages: { 0: full } });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stdout.trim().split('\n').filter((l) => l.startsWith('{')).length, 100);
    assert.deepEqual(result.calls.filter((c) => c.includes('--raw')).map((c) => c.match(/--paginate\|([^|]+)/)[1]), ['0:100', '100:100']);
    const empty = runShell(walk(''));
    assert.equal(empty.status, 0, empty.stdout + empty.stderr);
    assert.doesNotMatch(empty.stdout, /\{/);
  });

  it('fails closed on any other list error', () => {
    const result = runShell(walk(''), { env: { JIRA_LIST_MODE: 'denied' }, pages: {} });
    // The pre-flight's own list call is a plain one and passes; the walk's --raw call fails.
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stdout, /Could not list PROJ issues — aborting/);
    // A label that would break out of the JQL string never reaches jira.
    const quoted = runShell(walk(`LABEL_FILTER='plan" OR project = OPS'`), { pages: { 0: [issue('PROJ-1')] } });
    assert.equal(quoted.status, 1, quoted.stdout);
    assert.match(quoted.stdout, /Jira labels cannot contain spaces or quotes/);
    assert.ok(!quoted.calls.some((c) => c.includes('--raw')));
  });
});

describe('Jira claim, release, and close, executed', () => {
  const claim = (key = 'PROJ-7') => `${preflight}\n${leaseHelper}\n${block('Claim (Phase 2, in place of its marker block)').replace(/<KEY>/g, key)}`;
  const view = (fields) => JSON.stringify(issue('PROJ-7', fields));

  it('assigns, reads the lease back, transitions, and reads it back again', () => {
    const result = runShell(claim(), { env: { JIRA_VIEW_JSON: view({ status: 'To Do' }) } });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /^PRE_CLAIM_STATUS=To Do$/m);
    assert.deepEqual(mutations(result.calls), ['issue|assign|PROJ-7|dev@example.com|', 'issue|move|PROJ-7|In Progress|']);
    assert.equal(result.calls.filter((c) => c.includes('assignee = currentUser()')).length, 2);
  });

  it('refuses an issue someone already holds, without touching it', () => {
    const result = runShell(claim(), { env: { JIRA_VIEW_JSON: view({ assignee: 'Rival' }) } });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /PROJ-7 is already assigned to Rival — yielding/);
    assert.deepEqual(mutations(result.calls), []);
  });

  it('yields a lost lease without unassigning the winner', () => {
    const result = runShell(claim(), { env: { JIRA_VIEW_JSON: view({}), JIRA_LEASE_SEQ: 'no' } });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /lease read-back: no — yielding/);
    assert.deepEqual(mutations(result.calls), ['issue|assign|PROJ-7|dev@example.com|']);
    const late = runShell(claim(), { env: { JIRA_VIEW_JSON: view({}), JIRA_LEASE_SEQ: 'yes,no' } });
    assert.equal(late.status, 1);
    assert.match(late.stdout, /changed hands during the claim — yielding/);
    assert.ok(!late.calls.includes('issue|assign|PROJ-7|x|'));
  });

  it('releases the assignee when the start transition fails', () => {
    const result = runShell(claim(), { env: { JIRA_VIEW_JSON: view({}), JIRA_MOVE_FAIL: '1' } });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /Could not move PROJ-7 to "In Progress" — releasing the claim/);
    assert.equal(mutations(result.calls).at(-1), 'issue|assign|PROJ-7|x|');
  });

  it('skips the transition for an issue already In Progress', () => {
    const result = runShell(claim(), { env: { JIRA_VIEW_JSON: view({ status: 'In Progress', category: 'indeterminate' }) } });
    assert.equal(result.status, 0, result.stdout);
    assert.deepEqual(mutations(result.calls), ['issue|assign|PROJ-7|dev@example.com|']);
  });

  const release = (pre) => `${preflight}\n${leaseHelper}\n${block('`release_marker`').replace(/<KEY>/g, 'PROJ-7').replace('<printed by the claim>', pre)}`;

  it('releases only a lease it holds: transition back, then unassign', () => {
    const held = runShell(release('To Do'), { env: { JIRA_VIEW_JSON: view({ status: 'In Progress' }) } });
    assert.equal(held.status, 0, held.stdout);
    assert.deepEqual(mutations(held.calls), ['issue|move|PROJ-7|To Do|', 'issue|assign|PROJ-7|x|']);
    const unknown = runShell(`${preflight}\n${leaseHelper}\n${block('`release_marker`').replace(/<KEY>/g, 'PROJ-7')}`, { env: { JIRA_VIEW_JSON: view({ status: 'In Progress' }) } });
    assert.deepEqual(mutations(unknown.calls), ['issue|assign|PROJ-7|x|'], 'an unsubstituted PRE_CLAIM_STATUS skips the move');
    const refused = runShell(release('To Do'), { env: { JIRA_VIEW_JSON: view({ status: 'In Progress' }), JIRA_MOVE_FAIL: '1' } });
    assert.equal(refused.status, 0, 'a refused transition warns and still unassigns');
    assert.match(refused.stdout, /WARN: the workflow would not move PROJ-7 back to "To Do"/);
    assert.equal(mutations(refused.calls).at(-1), 'issue|assign|PROJ-7|x|');
    const foreign = runShell(release('To Do'), { env: { JIRA_VIEW_JSON: view({ status: 'In Progress' }), JIRA_LEASE_SEQ: 'no' } });
    assert.deepEqual(mutations(foreign.calls), [], 'never clear another user\'s lease');
  });

  const close = () => `${preflight}\n${block('Close after merge').replace(/<KEY>/g, 'PROJ-7').replace('<merged PR/MR URL>', 'https://github.com/o/r/pull/9')}`;

  it('transitions to Done with the PR URL after a merge, once', () => {
    const open = runShell(close(), { env: { JIRA_VIEW_JSON: view({ status: 'In Progress', category: 'indeterminate' }) } });
    assert.equal(open.status, 0, open.stdout);
    assert.deepEqual(mutations(open.calls), ['issue|move|PROJ-7|Done|--comment|Shipped in https://github.com/o/r/pull/9.|']);
    const done = runShell(close(), { env: { JIRA_VIEW_JSON: view({ status: 'Closed', category: 'done' }) } });
    assert.equal(done.status, 0);
    assert.deepEqual(mutations(done.calls), []);
    const failed = runShell(close(), { env: { JIRA_VIEW_JSON: view({ category: 'indeterminate' }), JIRA_MOVE_FAIL: '1' } });
    assert.equal(failed.status, 1);
    assert.match(failed.stdout, /ERROR: https:\/\/github\.com\/o\/r\/pull\/9 merged, but PROJ-7 could not move to "Done"/);
  });

  it('lists epic children by status category', () => {
    const form = jira.match(/^- `issue_children <KEY>` — `([^`]*)`/m)[1].replace(/<KEY>/g, 'PROJ-1');
    const result = runShell(`${preflight}\n${form}`, { pages: { 0: [issue('PROJ-2'), issue('PROJ-3', { status: 'Shipped', category: 'done' })] } });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /^PROJ-2\tOPEN\nPROJ-3\tCLOSED$/m);
    assert.ok(result.calls.some((c) => c.includes('|-q|parent = PROJ-1|')));
  });
});

describe('/do:next is wired to the Jira backend', () => {
  it('runs the Jira pre-flight in place of the tracker gate, right after host selection', () => {
    const vcs = next.indexOf('!read lib/vcs-host.md');
    const jiraRead = next.indexOf('\n!read lib/tracker-jira.md\n');
    const gateLine = next.indexOf('Otherwise, if the partial\'s tracker gate leaves `TRACKER_CLI` empty, abort naming the tracker');
    assert.ok(vcs > -1 && vcs < jiraRead && jiraRead < gateLine, 'vcs-host → tracker-jira → plain gate');
    assert.match(next, /\*\*Jira tracker \(`TRACKER=jira`\) only — read the Jira backend now\*\* and run its Pre-flight \(`\{COMMAND\}` = `\/do:next`\) in place of the tracker gate/);
    assert.match(next, /on a Jira tracker \(`TRACKER_CLI` is `jira`\) every `issue_\*`, `label_\*`, `assign_me`, and `unassign_me` runs its form in \[lib\/tracker-jira\.md\]/);
  });

  it('routes targets, walk, claim, release, and close through tracker-jira.md', () => {
    for (const heading of ['Targets', 'Claim gates', 'Queue walk', 'Claim', '`release_marker`', 'Close after merge']) {
      assert.match(next, new RegExp(`lib/tracker-jira\\.md[^\\n]*${heading.replace(/[`()]/g, '\\$&')}`), `next.md must route to "${heading}"`);
    }
    assert.match(next, /argument-hint: "\[#<issue>\|<JIRA-KEY> …\]/);
  });

  it('never closes a Jira issue with a Closes # trailer', () => {
    assert.match(serving, /`Jira: PROJ-123` and \*\*no\*\* `Closes #…` line/);
    assert.match(next, /\*\*On a Jira tracker\*\* the body says `Jira: <KEY>` \(follow-ups by key\) and carries \*\*no\*\* `Closes #…`/);
    assert.match(serving, /prefix `\[issue-<num>\]` \(commits, PR title, changelog\) \| `\[PROJ-123\]`/);
    assert.match(gate, /## 6\. Close the issue \(caller\)[\s\S]*On a Jira tracker nothing closes on merge[\s\S]*"Close after merge"/);
  });

  it('refuses --collaborators on Jira instead of failing open', () => {
    assert.match(serving, /\/do:next --collaborators cannot be enforced on a Jira tracker/);
    assert.match(serving, /When `COLLAB_MODE` is on and `SELF_MODE` is not, abort before listing\s+anything — never fall open to any-author/);
    assert.match(serving, /-q "key = <KEY> AND reporter = currentUser\(\)"/);
  });

  it('carries the key through swarm and epics', () => {
    assert.match(swarm, /\*\*Jira tracker\.\*\* Every `#<num>` below is the issue key/);
    assert.match(swarm, /On Jira, that step is \[tracker-jira\.md\]\(\.\/tracker-jira\.md\) "Close after merge"/);
    const jiraEpics = section(epics, '\n## Jira\n');
    assert.match(jiraEpics, /`issue_children <KEY>`/);
    assert.match(jiraEpics, /\.fields\.parent\.key \/\/ empty/);
    assert.match(jiraEpics, /`issue_close_note <KEY> /);
  });
});
