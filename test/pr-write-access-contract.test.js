'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

describe('VCS host portability', () => {
  // A self-managed GitHub Enterprise instance is commonly served from a domain with no
  // `github` in it at all. Two constructs make a command wrong on those installs: a URL
  // built on the literal domain (it 404s), and a branch gated on the literal domain (it
  // fails closed). Prose *explaining* that `gh api` defaults to github.com is neither.
  const URL_TEMPLATE = /https:\/\/github\.com\/\{/;
  const LITERAL_GATE = /\*github\.com[:\/]\*/;

  it('builds no URL and gates no branch on a literal github.com', () => {
    // Both bans sweep the whole shipped tree, so a new command or partial inherits
    // them without anyone remembering to add it here.
    const files = [
      ...fs.readdirSync(path.join(root, 'commands', 'do'))
        .filter((f) => f.endsWith('.md')).map((f) => ['commands/do', f]),
      ...fs.readdirSync(path.join(root, 'lib'))
        .filter((f) => f.endsWith('.md')).map((f) => ['lib', f]),
    ];
    for (const [dir, name] of files) {
      // scan.md's github.com references are a WebFetch allowlist for public advisory
      // data — a real domain allowlist, not an assumption about where a repo lives.
      if (name === 'scan.md') continue;
      const body = fs.readFileSync(path.join(root, dir, name), 'utf8');
      assert.doesNotMatch(
        body,
        URL_TEMPLATE,
        `${dir}/${name} templates a URL onto a literal github.com — build it from {GH_HOST}`,
      );
      assert.doesNotMatch(
        body,
        LITERAL_GATE,
        `${dir}/${name} gates a branch on a literal github.com glob — Enterprise hosts fail it`,
      );
    }
  });
});
