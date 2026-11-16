'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
// A command's snippets span the file plus the lib docs it includes (`!cat` and
// on-demand `!read` alike): those are one document to the agent.
const { readCommandDocs } = require('./helpers/command-docs');
const next = readCommandDocs('next.md', { eager: true });

// `glab api` — unlike the `glab issue` / `glab mr` subcommands — has no built-in
// `--jq` flag and exits with "Unknown flag: --jq", so every `glab api` call pipes to
// the standalone jq binary instead.
describe('glab api / jq', () => {
  it('never passes --jq to a plain `glab api` call', () => {
    // The flag does not exist there; the call dies before returning any JSON.
    const offenders = next
      .split('\n')
      .filter((line) => /glab api[^|`\n]*--jq/.test(line));
    assert.deepEqual(offenders, []);
  });
});
