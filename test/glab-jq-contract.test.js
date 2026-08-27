'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const next = fs.readFileSync(path.join(root, 'commands', 'do', 'next.md'), 'utf8');

// `glab api` — unlike the `glab issue` / `glab mr` subcommands — has no built-in
// `--jq` flag and exits with "Unknown flag: --jq", so every `glab api` call pipes to
// the standalone jq binary instead. These contracts pin the two ways that piping
// fails silently rather than loudly.
describe('glab api / jq contracts', () => {
  it('never passes --jq to a plain `glab api` call', () => {
    // The flag does not exist there; the call dies before returning any JSON.
    const offenders = next
      .split('\n')
      .filter((line) => /glab api[^|`\n]*--jq/.test(line));
    assert.deepEqual(offenders, []);
  });

  it('resolves the GitLab login in two steps, not one jq pipeline', () => {
    // A pipeline's exit status is jq's, and `jq -r .username` exits 0 on EMPTY input
    // (verified: exit 0, no output). So `ME="$(glab api user | jq -r .username)"`
    // leaves ME empty when glab fails — `--author ""` drops the --self filter, and
    // `--assignee "+"` claims nothing while still looking like a successful claim.
    assert.doesNotMatch(next, /ME="\$\(glab api user \| jq/);
    // Both call sites capture glab's status separately and use `jq -e`, which exits
    // non-zero (4) when no valid result was produced.
    const twoStep = next.match(/ME_JSON="\$\(glab api user\)"/g) || [];
    assert.equal(twoStep.length, 2, 'both the --self list filter and the claim marker');
    assert.equal((next.match(/jq -er \.username/g) || []).length, 3, 'two snippets + the prose contract');
  });

  it('probes for jq in the GitLab pre-flight', () => {
    // glab is validated up front; jq became a hard dependency of the same path, so a
    // machine with glab but no jq must fail with a fixable message, not die mid-claim.
    assert.match(next, /command -v jq >\/dev\/null 2>&1 \|\| \{/);
    assert.match(next, /which is not installed\. Install it/);
  });
});
