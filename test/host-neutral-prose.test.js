'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

// Command and lib prose must stay host-neutral (#410, #417): GitHub/GitLab-specific
// wording belongs in the per-host backend files, or in a note scoped to a genuinely
// host-specific capability. These files ARE the host backends, so they are exempt.
const BACKEND_FILES = new Set([
  'lib/host-github.md',
  'lib/host-gitlab.md',
  'lib/gh-host.md',
  'lib/next-gitlab.md',
  'lib/review-pr-mode.md',
  'lib/review-mr-mode.md',
  'lib/copilot-review-loop.md',
  'lib/tracker-jira.md',
]);

// Phrasing from the GitHub-assumed era. Each one names GitHub where the concept is
// host-neutral (a code-host reviewer, the host-side reviewer loop, an issue) or
// describes a skip that a GitLab backend now covers.
const BANNED = [
  { re: /\(skipped on GitLab\)/i, why: 'name the host and the missing capability instead' },
  { re: /\bGitHub[- ]only and (?:were|was) skipped\b/i, why: 'name the host and the missing capability instead' },
  { re: /github-reviewer-loop/, why: 'renamed to lib/host-reviewer-loop.md' },
  { re: /\bGitHub[- ]reviewer loop\b/i, why: 'say "host-side reviewer loop"' },
  { re: /\bGitHub-side\b/, why: 'say "host-side"' },
  { re: /\barbitrary GitHub (?:reviewer|login|user)\b/i, why: 'an @<login> is a reviewer handle on the project\'s code host' },
  { re: /\bGitHub issues?\b/, why: 'say "issue" or "tracker issue"' },
];

// A "GitHub only" / "GitLab only" note is allowed only when it is scoped to something
// that really exists on one host: Copilot, a native API relationship, the GH_HOST
// derivation, a gh/glab CLI call, or GitHub's merge-method choice.
const HOST_ONLY = /\b(?:GitHub|GitLab)[- ]only\b/i;
const HOST_SCOPE = /copilot|\bnative\b|GH_HOST|`gh[ `]|`glab[ `]|\bsquash\b/i;

function proseFiles() {
  const out = [];
  for (const dir of ['commands/do', 'lib']) {
    for (const name of fs.readdirSync(path.join(root, dir))) {
      const rel = `${dir}/${name}`;
      if (name.endsWith('.md') && !BACKEND_FILES.has(rel)) out.push(rel);
    }
  }
  return out;
}

describe('host-neutral command and lib prose', () => {
  const files = proseFiles();

  it('finds the prose files', () => {
    assert.ok(files.length > 40, `expected commands + lib, got ${files.length}`);
  });

  it('every exempt backend file exists', () => {
    for (const rel of BACKEND_FILES) assert.ok(fs.existsSync(path.join(root, rel)), `stale exemption: ${rel}`);
  });

  for (const rel of files) {
    it(`${rel} carries no GitHub-assumed wording`, () => {
      const hits = [];
      fs.readFileSync(path.join(root, rel), 'utf8').split('\n').forEach((line, i) => {
        for (const { re, why } of BANNED) {
          if (re.test(line)) hits.push(`${rel}:${i + 1}: "${line.match(re)[0]}" — ${why}`);
        }
        if (HOST_ONLY.test(line) && !HOST_SCOPE.test(line)) {
          hits.push(`${rel}:${i + 1}: "${line.match(HOST_ONLY)[0]}" without a host-specific scope (Copilot, native API, GH_HOST, gh/glab call)`);
        }
      });
      assert.deepEqual(hits, []);
    });
  }
});
