'use strict';

// Skill hosts expand `$0`-`$9` and `$*` in an injected skill body against the user's slash
// arguments, so `/do:next --swarm 4 --merge` rendered `awk -v id="$1"` as `awk -v id="4"` and
// `print $3` as `print --merge` (issues #454, #494). Shell blocks in commands/ and lib/ (lib/
// partials are inlined into the installed skill) must use named variables instead.
// KNOWN_LIB_DEBT lists lib files whose helper functions still read their own positional
// parameters; the per-file count may only shrink. Do not add entries.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const commandsDir = path.join(__dirname, '..', 'commands');

function mdFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return mdFiles(full);
    return entry.name.endsWith('.md') ? [full] : [];
  });
}

const libDir = path.join(__dirname, '..', 'lib');
const KNOWN_LIB_DEBT = {
  'local-agent-claude.md': 2,
  'local-cli-runner.md': 5,
  'release-source-gate.md': 2,
  'review-mr-mode.md': 2,
  'tracker-jira.md': 2,
  'vcs-host.md': 1,
};

const POSITIONAL = /\$(?:[0-9*]|\{[0-9*])/;

function shellBlockHits(file) {
  const hits = [];
  let inBlock = false;
  let shell = false;
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    const fence = line.trim().match(/^```(\w*)/);
    if (fence) {
      inBlock = !inBlock;
      shell = inBlock && /^(bash|sh|zsh|shell)$/.test(fence[1]);
      return;
    }
    if (inBlock && shell && POSITIONAL.test(line)) hits.push(`${i + 1}: ${line.trim()}`);
  });
  return hits;
}

describe('command shell blocks carry no positional parameters', () => {
  for (const file of mdFiles(commandsDir)) {
    it(path.relative(commandsDir, file), () => {
      assert.deepEqual(shellBlockHits(file), [], 'use a named variable (e.g. CLAIM_ID) instead of $0-$9 / $*');
    });
  }
});

describe('lib shell blocks carry no new positional parameters', () => {
  for (const file of mdFiles(libDir)) {
    const name = path.relative(libDir, file);
    it(name, () => {
      const hits = shellBlockHits(file);
      const allowed = KNOWN_LIB_DEBT[name] || 0;
      assert.ok(hits.length <= allowed, `${hits.length} > ${allowed} allowed:\n${hits.join('\n')}`);
    });
  }
});

describe('GitHub host snippet and claim gates avoid positional parameters', () => {
  it('lib/gh-host.md extracts the host with cut, not awk fields', () => {
    assert.match(fs.readFileSync(path.join(libDir, 'gh-host.md'), 'utf8'), /cut -d\/ -f3/);
  });
});

describe('in_flight() matcher (next.md), executed', () => {
  const next = fs.readFileSync(path.join(commandsDir, 'do', 'next.md'), 'utf8');
  const def = next.split('\n').find((line) => line.startsWith('in_flight() {'));
  const check = (refs, id) => execFileSync('sh', ['-c',
    `IN_FLIGHT_REFS='${refs.join('\n')}'\n${def}\nCLAIM_ID='${id}' in_flight && echo HIT || echo MISS\n`],
  { encoding: 'utf8' }).trim() === 'HIT';

  it('detects issue-12 but not issue-123, feature/12, or a Jira neighbor', () => {
    assert.ok(check(['origin/next/issue-12'], '12'));
    assert.ok(!check(['next/issue-123'], '12'));
    assert.ok(!check(['feature/12'], '12'));
    assert.ok(check(['next/issue-proj-12'], 'PROJ-12'));
    assert.ok(!check(['next/issue-PROJ-123'], 'PROJ-12'));
  });
});
