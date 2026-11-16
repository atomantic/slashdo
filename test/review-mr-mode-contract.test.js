'use strict';

// /do:review reviews a GitLab merge request through lib/review-mr-mode.md, the GitLab
// counterpart of lib/review-pr-mode.md. This runs its MR-URL parse snippet.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const readLib = (name) => fs.readFileSync(path.join(root, 'lib', name), 'utf8');
const mrMode = readLib('review-mr-mode.md');
const hasJq = spawnSync('jq', ['--version']).status === 0;

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
