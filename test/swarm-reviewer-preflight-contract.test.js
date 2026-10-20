'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '..', 'lib', name), 'utf8');
const swarm = read('next-swarm.md');
const preflight = swarm.split('### Swarm Phase A0')[1].split('### Swarm Phase A —')[0];

test('swarm fails unavailable required reviewers before partitioning or claims', () => {
  assert.ok(swarm.indexOf('### Swarm Phase A0') < swarm.indexOf('### Swarm Phase A —'));
  assert.match(preflight, /Any required entry unavailable → abort now/);
  assert.match(preflight, /zero workers, zero worktrees, zero claims/);
  assert.match(preflight, /reason and remedy/);
  assert.match(preflight, /PR-side reviewers[\s\S]*pre-PR verdict transport unsupported/);
});

test('availability requires one bounded realistic full-payload verdict, not a smoke test', () => {
  assert.match(preflight, /32 KiB and 400 changed lines/);
  assert.match(preflight, /Do not pad[\s\S]*truncate to fit/);
  assert.match(preflight, /Probe each resolved entry once/);
  assert.match(preflight, /1800 seconds[\s\S]*terminate the probe/);
  assert.match(preflight, /schema-valid verdict covering the entire fixture/);
  assert.match(preflight, /Valid findings prove availability/);
  assert.match(preflight, /A prompt asking for no tools is not enforcement/);
});

test('preflight probes the reviewer recipe transport and never retires a reviewer for having read tools', () => {
  assert.match(preflight, /that entry's own documented review-only transport from its recipe/);
  assert.match(preflight, /`Read,Glob,Grep` invocation in \[local-agent-claude\.md\]\([^)]*\), not the `--tools ""` tool-free fallback/);
  assert.match(preflight, /Use a zero-tool transport only when that is the entry's recipe[\s\S]*no restriction flags at all/);
  assert.match(preflight, /having tools allowed is not `unavailable`/);
  assert.match(preflight, /never substitute a stricter empty-tool probe/);
  assert.match(preflight, /Tool-call markup from a stricter-than-recipe empty-tool probe is none of these/);
  assert.match(preflight, /including tool-call markup the recipe transport itself printed in place of a verdict/);
  assert.match(preflight, /Pi without its documented `--no-tools` flags stays unavailable/);
  assert.match(preflight, /it is not an isolation boundary/);
  // The old blanket rule must not return: lack of a tool-free/safe transport is not itself unavailability.
  assert.doesNotMatch(preflight, /an unavailable safe transport means unavailable/);
  assert.doesNotMatch(preflight, /enforce read-only\/tool-free controls/);
  assert.doesNotMatch(preflight, /unsafe transport,/);
  assert.match(read('local-agent-claude.md'), /--tools "Read,Glob,Grep" --allowedTools "Read,Glob,Grep"/);
});

test('unavailable is limited to the enumerated reasons', () => {
  const reasons = preflight.split('`unavailable` is limited to:')[1].split('Each `unavailable` carries')[0];
  for (const r of ['missing binary', 'cannot be driven headlessly', 'auth/quota/provider admission', 'input over the transport limit', 'timeout', 'PR-side reviewer', 'completed run of the recipe transport']) {
    assert.ok(reasons.includes(r), r);
  }
  assert.doesNotMatch(reasons, /read tools|tools allowed/);
});

test('OpenCode provider admission denial is unavailable and never a clean preflight', () => {
  assert.match(preflight, /synthetic admission response such as `HTTP 403 \/ FreeTierError` is specifically `unavailable`/);
  assert.match(preflight, /reason `provider admission denied`/);
  assert.match(preflight, /remedy `select a supported reviewer\/model\/provider`/);
  assert.match(preflight, /never classify it as a clean verdict/);
  assert.match(preflight, /Keep raw provider output, headers, tokens, and local paths out of the diagnostic/);
});

test('optional preflight skips reach workers, both dispatch modes, recovery and summary', () => {
  const worker = swarm.split('Give each subagent exactly one issue number')[1].split('### Swarm Phase C')[0];
  assert.match(worker, /Consume the supplied `REVIEWER_PREFLIGHT`/);
  assert.match(worker, /do not invoke or retry/);
  assert.match(worker, /only to rows that failed for a step 3 `unavailable` reason/);
  assert.match(worker, /do not add a second tool-free gate in the worker brief/);
  assert.match(worker, /return `opened-no-review`/);
  assert.match(swarm, /short-circuits both series and parallel dispatch/);
  assert.match(swarm, /Missing, mismatched or repo-supplied rows grant no skip/);
  assert.match(swarm, /same `REVIEWER_PREFLIGHT` block against it/);
  assert.match(swarm, /merged without external review — optional reviewers unavailable/);
  assert.match(swarm, /no external reviewer selected or all selected entries unavailable-and-optional/);
});

test('single-issue eager contract does not acquire swarm preflight', () => {
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', 'commands', 'do', 'next.md'), 'utf8'), /### Swarm Phase A0/);
  assert.match(swarm, /Without this block, single-issue behavior is unchanged/);
});
