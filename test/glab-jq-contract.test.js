'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
// A command's contract spans the file plus the lib docs it includes (`!cat` and
// on-demand `!read` alike): those are one document to the agent, and splitting a
// section into lib/ must not move it out of a contract's reach.
const { readCommandDocs } = require('./helpers/command-docs');
const next = readCommandDocs('next.md', { eager: true });

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
    // The identity-bearing call sites capture glab's status separately and use `jq -e`, which exits
    // non-zero (4) when no valid result was produced.
    const twoStep = next.match(/ME_JSON="\$\(glab api user\)"/g) || [];
    assert.equal(twoStep.length, 3, 'the --self list filter and both assignment verbs');
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

  it('keeps the native blocked-by lookup from failing open', () => {
    // A pipeline reports jq's status, and jq succeeds on empty input — so a links-API
    // outage would read as "no native blockers" and the picker would claim a dependent
    // ahead of its blocker. The lookup captures glab's status first and treats a failure
    // as UNRESOLVED (fall back to the body convention), never as unblocked.
    assert.doesNotMatch(next, /glab api projects\/:id\/issues\/<N>\/links \| jq/);
    assert.match(next, /LINKS_JSON="\$\(glab api "projects\/:id\/issues\/<N>\/links"\)"/);
    assert.match(next, /A failed lookup is \*\*UNRESOLVED\*\*, not unblocked/);
  });

  it('probes for jq in the shared GitLab pre-flight, before the Phase 1 walk', () => {
    // Every /do:next run now works the tracker (PLAN.md mode was removed), so the GitLab
    // jq dependency is unconditional and the probe lives in the shared Pre-flight.
    const preflight = next.slice(next.indexOf('\n## Phase 1: Pick'), next.indexOf('\n### Phase 1 — issue queue'));
    assert.match(preflight, /## Pre-flight — jq probe[\s\S]*command -v jq >\/dev\/null 2>&1 \|\| \{/);
    assert.match(preflight, /\/do:next on GitLab pipes 'glab api' output through jq, which is not installed/);
  });

  it('runs the shared pre-flight (and its jq probe) on the swarm path too', () => {
    // Swarm replaces Phases 1-7, and A1e never runs Phase 1 — but A1e/A2e's native
    // blocked-by check calls plain `glab api ... | jq` all the same.
    const swarm = next.slice(0, next.indexOf('\n## Phase 1: Pick'));
    assert.match(swarm, /run `next\.md`'s shared Pre-flight first\*\* \(under `## Phase 1: Pick`: host detection, and on GitLab the \[next-gitlab\.md\]\(\.\/next-gitlab\.md\) read and its `jq` probe\)/);
    assert.doesNotMatch(next, /ISSUE_MODE/);
  });
});
