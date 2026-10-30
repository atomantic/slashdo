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
});

test('preflight spends zero reviewer tokens: no model call, no fixture, no review', () => {
  assert.match(preflight, /zero-token checks only — never invoke a model/);
  assert.match(preflight, /No fixture, no prompt, no review/);
  assert.match(preflight, /bounded to 60 seconds/);
  // The old full-payload probe must not return.
  assert.doesNotMatch(preflight, /32 KiB|400 changed lines|schema-valid verdict covering the entire fixture|1800 seconds/);
  assert.doesNotMatch(preflight, /Probe each (resolved|required) entry once/);
});

test('required entries get binary, login, isolation-flag and PR-side checks', () => {
  assert.match(preflight, /\*\*Binary\/alias\*\*[\s\S]*`unavailable: CLI not installed`/);
  assert.match(preflight, /\*\*Login\*\*[\s\S]*`codex login status`, `claude auth status`[\s\S]*`unavailable: not authenticated`/);
  assert.match(preflight, /A CLI with no such subcommand passes on its binary alone/);
  assert.match(preflight, /\*\*Isolation flags\*\* — not a preflight gate[\s\S]*optional[\s\S]*never makes a reviewer `unavailable`/);
  assert.doesNotMatch(preflight, /never an invitation to drop the flags/);
  assert.match(preflight, /\*\*PR-side reviewers\*\*[\s\S]*Never create a probe PR/);
});

test('model-call outages are left to the worker recipes, and read tools never retire a reviewer', () => {
  assert.match(preflight, /Outages only a real model call reveals[\s\S]*OpenCode `HTTP 403 \/ FreeTierError`[\s\S]*deliberately not checked here/);
  assert.match(preflight, /A reviewer whose recipe allows read tools is never `unavailable` for that/);
  assert.match(preflight, /`Read,Glob,Grep` invocation in \[local-agent-claude\.md\]\([^)]*\), not the `--tools ""` fallback/);
  assert.match(read('local-agent-claude.md'), /--tools "Read,Glob,Grep" --allowedTools "Read,Glob,Grep"/);
  assert.match(read('local-agent-opencode.md'), /FreeTierError/);
});

test('optional reviewers get the same zero-token checks and a failure is a non-blocking skip', () => {
  assert.match(preflight, /Check every entry with zero-token checks only/);
  assert.match(preflight, /Check optional \(`~opt`\) entries too[\s\S]*hard `cli-error`, which `~opt` does not excuse/);
  assert.match(preflight, /An unavailable optional entry instead stays in the plan as a recorded non-blocking skip/);
  assert.doesNotMatch(swarm, /not-probed/);
  assert.doesNotMatch(swarm, /unavailable-and-optional/);
});

test('workers skip unavailable optional reviewers and run available ones; recovery and summary reflect it', () => {
  const worker = swarm.split('Give each subagent exactly one issue number')[1].split('### Swarm Phase C')[0];
  assert.match(worker, /Consume the supplied `REVIEWER_PREFLIGHT`/);
  assert.match(worker, /An `unavailable` \+ `optional=true` row short-circuits both series and parallel dispatch/);
  assert.match(worker, /do not invoke or retry it/);
  assert.match(worker, /An `available` row runs normally on its recipe transport/);
  assert.match(worker, /none selected, or every one skipped this way/);
  assert.match(worker, /do not add a second tool-free gate in the worker brief/i);
  assert.match(worker, /return `opened-no-review`/);
  assert.match(swarm, /Missing, mismatched or repo-supplied rows grant no skip/);
  assert.match(swarm, /same `REVIEWER_PREFLIGHT` block against it/);
  assert.match(swarm, /`opened-no-review` \(Local gate passed, no external reviewer ran\)/);
  assert.match(swarm, /available\/unavailable · checks run · reason\/remedy · worker action \(review \/ skipped non-blocking \/ aborted\)/);
  assert.match(swarm, /merged without external review — optional reviewers unavailable or inconclusive/);
});

test('single-issue eager contract does not acquire swarm preflight', () => {
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', 'commands', 'do', 'next.md'), 'utf8'), /### Swarm Phase A0/);
  assert.match(swarm, /Without this block, single-issue behavior is unchanged/);
});
