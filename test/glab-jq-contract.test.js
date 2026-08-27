'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const next = fs.readFileSync(path.join(root, 'commands', 'do', 'next.md'), 'utf8');

// `glab api` — unlike the `glab issue` / `glab mr` subcommands — has no built-in
// `--jq` flag and exits with "Unknown flag: --jq", so every `glab api` call pipes to
// the standalone jq binary instead. These contracts pin the three ways that piping
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
    // `--assignee "+"` claims nothing while looking like a successful claim.
    assert.doesNotMatch(next, /ME="\$\(glab api user \| jq/);
    // Both call sites capture glab's status separately and use `jq -e`, which exits
    // non-zero (4) when no valid result was produced.
    const twoStep = next.match(/ME_JSON="\$\(glab api user\)"/g) || [];
    assert.equal(twoStep.length, 2, 'both the --self list filter and the claim marker');
    assert.equal((next.match(/jq -er \.username/g) || []).length, 3, 'two snippets + the prose contract');
  });

  it('guards the resolved login on non-empty at BOTH sites', () => {
    // `jq -e` fails only on `null`/`false`. An empty-string username — `{"username":""}`
    // — is truthy to jq, so `jq -er .username` exits 0 with no login (verified). An empty
    // ME then means `--author ""`, which glab reads as NO author filter: --self would
    // enumerate and claim other people's issues, exactly the boundary it exists to hold.
    // The claim site's `+$ME` would likewise assign nobody while looking successful.
    assert.match(next, /\[ -n "\$ME" \] \|\| \{\n\s*echo "GitLab returned an empty username/);
    assert.match(next, /&& \[ -n "\$ME" \] && glab issue update/);
  });

  it('probes for jq in issue mode, not the shared pre-flight', () => {
    // jq is a dependency of the ISSUE-MODE GitLab path only — PLAN.md mode never calls
    // plain `glab api` (its `glab issue`/`glab mr` calls carry their own --jq). Probing
    // in the shared pre-flight would abort a GitLab + PLAN.md repo that never needed jq.
    const preflight = next.slice(0, next.indexOf('### Phase 1 — issues mode'));
    assert.doesNotMatch(preflight, /command -v jq/, 'no jq probe before the mode split');
    assert.match(next, /if \[ "\$CLI_TOOL" = glab \]; then\n\s*command -v jq >\/dev\/null 2>&1 \|\| \{/);
    assert.match(next, /GitLab issue mode pipes 'glab api' output through jq, which is not installed/);
  });
});
