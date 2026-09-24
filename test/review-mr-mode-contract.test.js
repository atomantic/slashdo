'use strict';

// /do:review used to abort on a GitLab merge request URL ("PR mode is GitHub-only").
// It now reviews the MR through lib/review-mr-mode.md, the GitLab counterpart of
// lib/review-pr-mode.md. These contracts pin the routing, the MR-URL parse (by
// running it), and the rules that keep an MR review aimed at the MR's own project
// rather than whatever `origin` the command happens to run in.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { readCommandDocs } = require('./helpers/command-docs');

const root = path.join(__dirname, '..');
const readLib = (name) => fs.readFileSync(path.join(root, 'lib', name), 'utf8');
const review = fs.readFileSync(path.join(root, 'commands', 'do', 'review.md'), 'utf8');
const mrMode = readLib('review-mr-mode.md');
const hasJq = spawnSync('jq', ['--version']).status === 0;

describe('/do:review GitLab MR routing', () => {
  it('matches an MR reference by shape and routes it instead of aborting', () => {
    const parse = review.slice(review.indexOf('- **PR reference**'), review.indexOf('- Any other non-flag token'));
    assert.doesNotMatch(parse, /cannot review a GitLab merge request/);
    assert.match(parse, /- \*\*MR reference\*\* \(GitLab\), also matched by URL \*shape\* on any host/);
    assert.match(parse, /\*\*Check it before the PR shapes\*\*/);
    assert.match(parse, /\/-\/merge_requests\/\{iid\}/);
    assert.match(parse, /`PR_MODE=true`, `CODE_HOST=gitlab`, and `CR_NOUN=MR`/);
    // The GitHub branch still names its host explicitly, so the gates below have one to test.
    assert.match(parse, /`PR_MODE=true`, `CODE_HOST=github`, `CR_NOUN=PR`/);
  });

  it('loads exactly one PR/MR partial, gated on the code host', () => {
    const prAt = review.indexOf('!read lib/review-pr-mode.md');
    const mrAt = review.indexOf('!read lib/review-mr-mode.md');
    assert.ok(prAt > 0 && mrAt > prAt);
    assert.match(review.slice(0, prAt), /only when `CODE_HOST=github` \(a GitHub PR reference\):\s*$/);
    assert.match(review.slice(prAt, mrAt), /only when `CODE_HOST=gitlab` \(a GitLab MR reference\):\s*$/);
    // Delegated host-side passes take the reference's host, not origin's.
    assert.match(review, /`gitlab` \/ `MR` for a GitLab MR\. Never re-derive them from `origin` there\./);
    assert.match(review, /an `@<login>` pass runs only when `MR_IN_CHECKOUT=true`/);
  });

  it('ships the new partial through the curl installer', () => {
    for (const script of ['install.sh', 'uninstall.sh']) {
      const body = fs.readFileSync(path.join(root, script), 'utf8');
      assert.match(body, /LIBS=\([\s\S]*\breview-mr-mode\b/, `${script} must list review-mr-mode`);
    }
  });
});

describe('GitLab MR mode body', () => {
  it('aims every API call at the MR project, never at origin', () => {
    // Every invocation (a `glab api` followed by a flag or a quoted path), prose aside.
    const apiLines = mrMode.split('\n').filter((l) => /glab api +[-"]/.test(l));
    assert.ok(apiLines.length >= 5, `found only ${apiLines.length} glab api calls`);
    for (const line of apiLines) {
      assert.match(line, /glab api --hostname \{GL_HOST\}/, line);
      assert.doesNotMatch(line, /projects\/:id/, line);
      assert.doesNotMatch(line, /--jq/, `glab api has no --jq flag: ${line}`);
      assert.doesNotMatch(line, /glab api [^|\n]*\| *jq/, `never pipe glab api straight into jq: ${line}`);
    }
    assert.match(mrMode, /\*\*The MR URL picks the target, never `origin`\.\*\*/);
  });

  it('posts through the host verb and never deletes the contributor branch', () => {
    assert.match(mrMode, /Post through the `post-review` verb of `host-gitlab\.md`, retargeted/);
    const gitlab = readLib('host-gitlab.md');
    assert.match(gitlab, /### Targeting an MR outside the checkout/);
    assert.match(gitlab, /`projects\/:id`\n\s*becomes `projects\/\{GL_PROJECT_ENC\}`/);
    assert.match(gitlab, /`glab mr` \/ `glab ci` call gains `-R "\{GL_REPO_URL\}"`/);

    const merge = mrMode.slice(mrMode.indexOf('## Merge the MR'), mrMode.indexOf('## Report additions'));
    assert.match(merge, /glab mr merge \{PR_NUM\} -R "\{GL_REPO_URL\}" --yes --sha \{HEAD_SHA\}/);
    assert.match(merge, /\*\*Never pass `--remove-source-branch`\*\*/);
    assert.match(merge, /`PR_DISPOSITION=inline` can never\s+merge/);
    assert.match(merge, /queued, not\s+merged/);
  });

  it('pushes fixes by explicit source project and branch, only from the MR checkout', () => {
    assert.match(mrMode, /`CAN_PUSH_HEAD=true` when `MR_IN_CHECKOUT=true` \*\*and\*\*/);
    assert.match(mrMode, /allow_collaboration=true/);
    assert.match(mrMode, /git push "\{SOURCE_CLONE_URL\}" "HEAD:refs\/heads\/\{HEAD_REF\}"/);
    assert.match(mrMode, /A rejected push is a downgrade, not an abort/);
  });

  it('builds the commentable-lines map the same way on both hosts', () => {
    // The two partials carry the walk separately; the edge case that silently
    // shifts every later line number must stay in both.
    for (const body of [mrMode, readLib('review-pr-mode.md')]) {
      assert.match(body, /\\ No newline at end of file/);
      assert.match(body, /do-review-pr-\{PR_NUM\}-lines\.json/);
    }
  });
});

describe('MR reference parse (executed)', { skip: !hasJq && 'jq not installed' }, () => {
  const snippet = mrMode.slice(mrMode.indexOf('## Parse the MR reference')).match(/```bash\n([\s\S]*?)```/)[1];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'do-review-mr-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  // Stub glab: `auth status` succeeds; anything else would be a bug in the parse step.
  fs.writeFileSync(path.join(bin, 'glab'), '#!/bin/sh\n[ "$1" = auth ] && exit 0\nexit 9\n', { mode: 0o755 });

  const run = (token) => {
    assert.doesNotMatch(token, /'/);
    const res = spawnSync('bash', ['-c', snippet.replace('{token}', token)], {
      cwd: dir,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      encoding: 'utf8',
    });
    const vars = Object.fromEntries([...res.stdout.matchAll(/(\w+)=(\S*)/g)].map(([, k, v]) => [k, v]));
    return { status: res.status, vars, out: res.stdout };
  };

  const cases = [
    ['https://gitlab.com/group/project/-/merge_requests/42',
      { GL_HOST: 'gitlab.com', GL_PROJECT: 'group/project', GL_PROJECT_ENC: 'group%2Fproject', PR_NUM: '42' }],
    ['https://git.corp.example/group/sub/project/-/merge_requests/123/diffs#note_9',
      { GL_HOST: 'git.corp.example', GL_PROJECT: 'group/sub/project', GL_PROJECT_ENC: 'group%2Fsub%2Fproject',
        GL_REPO_URL: 'https://git.corp.example/group/sub/project', PR_NUM: '123' }],
    ['https://git.corp.example:8443/g/p/merge_requests/7?tab=commits',
      { GL_HOST: 'git.corp.example:8443', GL_PROJECT: 'g/p', PR_NUM: '7' }],
  ];
  for (const [token, expected] of cases) {
    it(`parses ${token}`, () => {
      const { status, vars, out } = run(token);
      assert.equal(status, 0, out);
      for (const [key, value] of Object.entries(expected)) assert.equal(vars[key], value, `${key} for ${token}`);
    });
  }

  for (const token of ['https://gitlab.com/project/-/merge_requests/1', 'ftp://gitlab.com/g/p/-/merge_requests/1',
    'https://gitlab.com/g/p/-/merge_requests/abc']) {
    it(`rejects ${token}`, () => {
      const { status, out } = run(token);
      assert.equal(status, 1, out);
      assert.match(out, /could not parse a GitLab merge request/);
    });
  }
});
