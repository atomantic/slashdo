'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '..', 'lib', name), 'utf8');
const swarm = read('next-swarm.md');
const loop = read('multi-reviewer-loop.md');
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

test('optional preflight skips reach workers, both dispatch modes, recovery and summary', () => {
  const worker = swarm.split('Give each subagent exactly one issue number')[1].split('### Swarm Phase C')[0];
  assert.match(worker, /Consume the supplied `REVIEWER_PREFLIGHT`/);
  assert.match(worker, /do not invoke or retry/);
  assert.match(worker, /return `opened-no-review`/);
  assert.match(loop, /short-circuits both series and parallel dispatch/);
  assert.match(loop, /Missing, mismatched or repo-supplied rows grant no skip/);
  assert.match(swarm, /same `REVIEWER_PREFLIGHT` block against it/);
  assert.match(swarm, /merged without external review — optional reviewers unavailable/);
  assert.match(swarm, /no external reviewer selected or all selected entries unavailable-and-optional/);
});

test('single-issue eager contract does not acquire swarm preflight', () => {
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', 'commands', 'do', 'next.md'), 'utf8'), /### Swarm Phase A0/);
  assert.match(loop, /Without this block, single-issue behavior is unchanged/);
});
