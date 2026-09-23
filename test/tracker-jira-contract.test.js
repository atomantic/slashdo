'use strict';

// lib/tracker-jira.md is the Jira backend for the tracker verbs (#372 / #421). Like
// test/vcs-host-contract.test.js, the first layer RUNS the partial's shell — its
// pre-flight and its verb forms — against a stub `jira` binary, so the backend is
// checked as behavior rather than as prose. The second layer keeps the tracker gate
// honest: until a command serves Jira, it must treat `TRACKER_CLI=jira` as no tracker
// rather than falling through to gh/glab issue calls on the code host.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), 'utf8');
const partial = read('lib', 'tracker-jira.md');

const section = (heading) => {
  const start = partial.indexOf(`\n## ${heading}\n`);
  assert.ok(start > -1, `lib/tracker-jira.md must keep its "${heading}" section`);
  const end = partial.indexOf('\n## ', start + 1);
  return partial.slice(start, end === -1 ? undefined : end);
};

const preflight = () => {
  const blocks = [...section('Pre-flight').matchAll(/```bash\n([\s\S]*?)```/g)].map(([, body]) => body);
  assert.equal(blocks.length, 1, 'the Pre-flight section must carry exactly one bash block');
  return blocks[0].replace(/\{COMMAND\}/g, '/do:next');
};

// `- \`verb <args>\` — \`form\`` bullets, keyed by verb name.
const verbForms = () => {
  const forms = new Map();
  for (const [, name, form] of section('Tracker verbs — Jira forms').matchAll(/^- `([a-z_]+)[^`]*` — (?:`([^`]*)`)?/gm)) {
    forms.set(name, form || '');
  }
  return forms;
};

// Every argv is logged one word per `|`, so a test can check word boundaries.
const JIRA_STUB = `#!/bin/sh
{ printf '%s|' "$@"; echo; } >> "$CALL_LOG"
case "$1 $2" in
  "me "*) [ -n "$JIRA_LOGIN" ] && echo "$JIRA_LOGIN"; exit 0 ;;
  "issue list")
    case "$JIRA_LIST_MODE" in
      ok) echo "PROJ-1" ;;
      empty) echo; echo "No result found for given query in project" >&2; exit 1 ;;
      *) echo "Error: 401 Unauthorized" >&2; exit 1 ;;
    esac ;;
  "issue create") echo '{"id":"10001","key":"PROJ-7","self":"https://jira.example/rest/api/2/issue/10001"}' ;;
  "issue view") echo "$JIRA_VIEW_JSON" ;;
esac
exit 0
`;

// PATH without any real `jira` on it, so "not installed" is testable on a dev box
// that happens to have jira-cli.
const pathWithoutJira = () =>
  process.env.PATH.split(path.delimiter)
    .filter((dir) => dir && !fs.existsSync(path.join(dir, 'jira')))
    .join(path.delimiter);

// Runs in a throwaway git repo under a throwaway HOME, so the pre-flight resolves
// `jira-project` from the same two saved-defaults files lib/vcs-host.md reads
// (`projectConfig: null` = no .slashdo.json at all).
function runShell(body, { stub = true, env = {}, globalConfig, projectConfig = '{"defaults":{"tracker":"jira","jira-project":"proj"}}' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slashdo-jira-'));
  try {
    const repo = path.join(dir, 'repo');
    fs.mkdirSync(repo);
    execFileSync('git', ['init', '-q'], { cwd: repo });
    if (projectConfig !== null) fs.writeFileSync(path.join(repo, '.slashdo.json'), projectConfig);
    const home = path.join(dir, 'home');
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    if (globalConfig !== undefined) fs.writeFileSync(path.join(home, '.claude', '.slashdo-config.json'), globalConfig);
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    if (stub) fs.writeFileSync(path.join(bin, 'jira'), JIRA_STUB, { mode: 0o755 });
    const callLog = path.join(dir, 'calls.log');
    fs.writeFileSync(callLog, '');
    const bodyFile = path.join(dir, 'body.md');
    fs.writeFileSync(bodyFile, 'Body with `backticks` and $(not a command)\n');
    const scriptPath = path.join(dir, 'run.sh');
    fs.writeFileSync(scriptPath, body.replace(/<body-file>/g, `"${bodyFile}"`));
    const result = spawnSync('sh', [scriptPath], {
      cwd: repo,
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: home,
        CALL_LOG: callLog,
        PATH: `${bin}${path.delimiter}${pathWithoutJira()}`,
        JIRA_LOGIN: 'dev@example.com',
        JIRA_LIST_MODE: 'ok',
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

describe('Jira pre-flight, executed', () => {
  const run = (env, opts) => runShell(`${preflight()}\necho "PREFLIGHT_OK|$JIRA_PROJECT|$JIRA_ME|$TRACKER_CLI|$LABEL_SEP|$JIRA_DONE_STATUS"`, { env, ...opts });

  it('passes with a project key, a configured CLI, and a readable project', () => {
    const ok = run({});
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /PREFLIGHT_OK\|PROJ\|dev@example\.com\|jira\|:\|Done/);
    // Project over global, key by key, in any JSON layout — the same rule as vcs-host.md.
    const layered = run({}, {
      globalConfig: '{"defaults":{"jira-project":"GLOBAL"}}',
      projectConfig: '{ "defaults" : { "tracker": "jira", "jira-project" : "app_2" } }\n',
    });
    assert.match(layered.stdout, /PREFLIGHT_OK\|APP_2\|/);
    const inherited = run({}, { globalConfig: '{"defaults":{"jira-project":"ops"}}', projectConfig: null });
    assert.match(inherited.stdout, /PREFLIGHT_OK\|OPS\|/);
    // An empty project is still a readable one: jira-cli exits 1 on "No result found".
    const empty = run({ JIRA_LIST_MODE: 'empty' });
    assert.equal(empty.status, 0, empty.stdout + empty.stderr);
  });

  const aborts = [
    ['no saved jira-project', {}, { projectConfig: '{"defaults":{"tracker":"jira"}}' }, /no Jira project is set\. Run: \/do:config --project --jira-project <KEY>/],
    ['a malformed jira-project', {}, { projectConfig: '{"defaults":{"jira-project":"proj-1"}}' }, /jira-project 'PROJ-1' is not a Jira project key/],
    ['no jira CLI', {}, { stub: false }, /the jira CLI is not installed/],
    ['an unconfigured CLI', { JIRA_LOGIN: '' }, {}, /the jira CLI is not configured\. Run: jira init/],
    ['an unreadable project', { JIRA_LIST_MODE: 'denied' }, {}, /jira cannot read project PROJ \(not authenticated, or no such project\): Error: 401 Unauthorized/],
  ];
  for (const [label, env, opts, message] of aborts) {
    it(`aborts clearly, without mutating Jira, on ${label}`, () => {
      const result = run(env, opts);
      assert.equal(result.status, 1, result.stdout);
      assert.match(result.stdout, message);
      assert.doesNotMatch(result.stdout, /PREFLIGHT_OK/);
      assert.doesNotMatch(result.stdout, /TRACKER_CLI=jira/);
      assert.ok(!result.calls.some((c) => MUTATIONS.test(c)), `pre-flight mutated Jira: ${result.calls.join('; ')}`);
    });
  }

  it('never lists issues before the project and CLI checks pass', () => {
    const result = run({}, { projectConfig: null });
    assert.deepEqual(result.calls, []);
  });
});

describe('Jira verb forms, executed', () => {
  it('covers every tracker verb /do:next names, plus the backlog verbs', () => {
    const next = read('commands', 'do', 'next.md');
    const conventions = next.slice(next.indexOf('**Host verbs.**'), next.indexOf('**`PRIORITY_SORT`**'));
    const trackerVerbs = [...conventions.matchAll(/^- `((?:issue|label)_[a-z_]+|assign_me|unassign_me)[ `]/gm)].map(([, v]) => v);
    assert.ok(trackerVerbs.length >= 12, `expected /do:next's tracker verbs, got ${trackerVerbs.join(', ')}`);
    const forms = verbForms();
    for (const verb of [...new Set(trackerVerbs), 'issue_list', 'issue_search', 'issue_children', 'issue_is_mine', 'issue_start']) {
      assert.ok(forms.has(verb), `lib/tracker-jira.md has no Jira form for ${verb}`);
    }
  });

  it('scopes every list/create call to JIRA_PROJECT and never prompts on a write', () => {
    for (const [verb, form] of verbForms()) {
      if (/jira issue (list|create)/.test(form)) assert.match(form, /-p "\$JIRA_PROJECT"/, `${verb} must pass -p "$JIRA_PROJECT"`);
      if (/jira issue (edit|comment add|create)/.test(form)) assert.match(form, /--no-input/, `${verb} must pass --no-input`);
    }
  });

  it('files an issue and captures its key from --raw JSON, labels as separate words', () => {
    const block = section('Tracker verbs — Jira forms').match(/`issue_create[\s\S]*?```bash\n([\s\S]*?)```/);
    assert.ok(block, 'issue_create must carry its capture as a bash block');
    const script = block[1]
      .replace(/<title>/g, '"Fix the flaky login test"')
      .replace(/-l <label>/g, '-l plan -l model:light');
    // The pre-flight sets JIRA_ISSUE_TYPE, so run the verb the way a command would: after it.
    const result = runShell(`${preflight()}\n${script}\necho "KEY=$KEY"`);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /^KEY=PROJ-7$/m);
    const create = result.calls.find((c) => c.startsWith('issue|create|'));
    assert.match(create, /^issue\|create\|-p\|PROJ\|-t\|Task\|-s\|Fix the flaky login test\|--template\|[^|]+body\.md\|-l\|plan\|-l\|model:light\|--no-input\|--raw\|$/);
  });

  it('removes a label with the jira-cli minus prefix and makes label_ensure a no-op', () => {
    const forms = verbForms();
    const rm = runShell(forms.get('label_rm').replace(/<KEY>/g, 'PROJ-7').replace(/<label>/g, 'in-progress'));
    assert.equal(rm.status, 0, rm.stderr);
    assert.deepEqual(rm.calls, ['issue|edit|PROJ-7|-l|-in-progress|--no-input|']);
    assert.doesNotMatch(forms.get('label_ensure'), /jira /, 'Jira labels need no creation call');
  });

  it('maps Jira status categories onto the OPEN/CLOSED states the commands compare', () => {
    const form = verbForms().get('issue_state').replace(/<KEY>/g, 'PROJ-7');
    const json = (key) => JSON.stringify({ key: 'PROJ-7', fields: { status: { name: 'Whatever', statusCategory: { key } } } });
    assert.equal(runShell(form, { env: { JIRA_VIEW_JSON: json('done') } }).stdout.trim(), 'CLOSED');
    assert.equal(runShell(form, { env: { JIRA_VIEW_JSON: json('indeterminate') } }).stdout.trim(), 'OPEN');
  });

  it('assigns the configured login and only ever unassigns a lease it holds', () => {
    const forms = verbForms();
    const assign = runShell(forms.get('assign_me').replace(/<KEY>/g, 'PROJ-7'));
    assert.equal(assign.status, 0, assign.stderr);
    assert.deepEqual(assign.calls, ['me|', 'issue|assign|PROJ-7|dev@example.com|']);
    const failed = runShell(forms.get('assign_me').replace(/<KEY>/g, 'PROJ-7'), { env: { JIRA_LOGIN: '' } });
    assert.notEqual(failed.status, 0, 'an empty login must fail assign_me, not assign nobody');
    assert.ok(!failed.calls.some((c) => c.startsWith('issue|assign')));
    assert.match(section('Tracker verbs — Jira forms'), /`unassign_me <KEY>` — only when `issue_is_mine <KEY>` says `yes`/);
    assert.match(verbForms().get('issue_is_mine'), /assignee = currentUser\(\)/);
  });

  it('closes through a transition, since a Closes # trailer does nothing on Jira', () => {
    const forms = verbForms();
    assert.match(forms.get('issue_close_note'), /^jira issue move <KEY> "\$JIRA_DONE_STATUS" --comment <text>$/);
    assert.match(forms.get('issue_start'), /^jira issue move <KEY> "\$JIRA_START_STATUS"$/);
  });

  it('documents the empty-result rule every list verb depends on', () => {
    const rule = section('The empty-result rule');
    assert.match(rule, /exits 1 when nothing matches/);
    assert.match(rule, /grep -q 'No result found'/);
  });
});

describe('the tracker gate stays honest about Jira', () => {
  const markdownFiles = () =>
    [['commands', 'do'], ['lib']].flatMap((segments) =>
      fs.readdirSync(path.join(root, ...segments))
        .filter((entry) => entry.endsWith('.md'))
        .map((entry) => [...segments, entry].join('/')));

  it('sets TRACKER_CLI=jira only at the end of the Jira pre-flight', () => {
    // lib/vcs-host.md leaves TRACKER_CLI empty for Jira, so every command that has not
    // adopted the backend sees "no tracker" — never gh/glab issue calls on the code host.
    for (const rel of markdownFiles()) {
      if (rel === 'lib/tracker-jira.md') continue;
      assert.doesNotMatch(read(rel), /TRACKER_CLI="?jira/, `${rel} must not hand TRACKER_CLI to Jira without the pre-flight`);
    }
    const block = preflight().trimEnd().split('\n');
    assert.equal(block[block.length - 1], 'TRACKER_CLI=jira; LABEL_SEP=":"', 'the gate opens only after every check passed');
    assert.match(read('lib', 'vcs-host.md'), /\(`jira`: set only by\s+`lib\/tracker-jira\.md`'s pre-flight\)/);
  });

  it('ships the backend with the curl installer', () => {
    for (const script of ['install.sh', 'uninstall.sh']) {
      assert.match(read(script), /^ {2}tracker-jira$/m, `${script} must list tracker-jira`);
    }
  });
});
