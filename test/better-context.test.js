'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { readCommandDocs } = require('./helpers/command-docs');
const { transformCommand } = require('../src/transformer');
const { ENVIRONMENTS } = require('../src/environments');
const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

describe('better progressive context', () => {
  it('keeps the initial command within a small orchestration budget', () => {
    // The original 82KB source expanded beyond 200KB with review libraries.
    // Budget the entrypoint, not the task evidence or an arbitrary line count.
    const entry = read('commands/do/better.md');
    assert.ok(Buffer.byteLength(entry) <= 6000);
    assert.doesNotMatch(entry, /!`cat /);
    assert.doesNotMatch(entry, /!read lib\/(?:better-audit-|.*reviewer-loop|.*agent-review-loop)/);
    for (const phase of ['options', 'discovery', 'audit', 'plan', 'remediation', 'verification', 'pr-and-ci', 'review-loop', 'cleanup']) {
      assert.ok(entry.includes(`!read lib/better-${phase}.md`), `missing ${phase} phase route`);
    }
  });

  it('ships a compact skill with phase resources and native command read paths', () => {
    const source = read('commands/do/better.md');
    for (const key of ['claude', 'opencode', 'codex', 'antigravity']) {
      const files = {};
      const entry = transformCommand(source, ENVIRONMENTS[key], path.join(root, 'lib'), 'do/better.md', { files });
      assert.ok(Buffer.byteLength(entry) <= 8000, `${key} eagerly loads later phases`);
      assert.doesNotMatch(entry, /^!read /m);
      assert.match(entry, /Read `[^`]*better-options\.md`/);
      if (ENVIRONMENTS[key].bundlesLibs) {
        assert.ok(files['better-audit.md']);
        assert.ok(files['better-simplify.md']);
        assert.ok(files['local-agent-review-loop.md']);
        for (const body of Object.values(files)) assert.doesNotMatch(body, /^!read /m);
      }
    }
  });

  it('routes every audit lens to an existing separate resource', () => {
    const dispatch = read('lib/better-audit.md');
    const lenses = [...dispatch.matchAll(/^!read (lib\/better-audit-[\w-]+\.md)$/gm)].map((match) => match[1]);
    assert.equal(lenses.length, 11);
    assert.equal(new Set(lenses).size, lenses.length);
    for (const lens of lenses) assert.ok(read(lens).length > 0);
    assert.match(dispatch, /Do not pass the complete command/);
    assert.match(dispatch, /Cover every applicable requested scope/);
  });

  it('resolves every explicit required resource in the source tree', () => {
    for (const dir of ['commands/do', 'lib']) {
      for (const name of fs.readdirSync(path.join(root, dir)).filter((name) => name.endsWith('.md'))) {
        for (const [, target] of read(`${dir}/${name}`).matchAll(/^!read (.+)$/gm)) {
          assert.match(target, /^lib\/[\w.-]+\.md$/);
          assert.ok(read(target).trim(), `${dir}/${name} requires ${target}`);
        }
      }
    }
  });

  it('keeps the simplify alias pointed at the moved mode contract', () => {
    const alias = read('commands/do/simplify.md');
    assert.match(alias, /!read lib\/better-simplify\.md/);
    assert.doesNotMatch(alias, /better\.md#simplify-only/);
  });

  it('preserves uncertainty and simplify-only behavior through phase boundaries', () => {
    assert.match(read('lib/better-audit.md'), /<SEVERITY-or-UNCERTAIN>/);
    const plan = read('lib/better-plan.md');
    assert.match(plan, /targeted validation of `UNCERTAIN` findings/);
    assert.match(plan, /never auto-remediate them/);
    assert.match(read('lib/remediation-agent-template.md'), /Useful structural\n  refactors are intentionally behavior-preserving/);
    assert.match(read('lib/better-simplify.md'), /bug encountered incidentally is recorded as deferred/);
    assert.match(read('lib/better-pr-and-ci.md'), /`--no-merge`[\s\S]{0,160}Phase 7 safe finalization/);
  });

  it('keeps open PR branches and current-head gates in the shared workflow', () => {
    for (const command of ['better.md', 'better-swift.md']) {
      const contract = readCommandDocs(command);
      assert.match(contract, /never delete the remote branch for an open or unmerged PR/);
      assert.match(contract, /Prior approval of a different HEAD is insufficient/);
      assert.match(contract, /expected checks never attach/);
    }
  });
});
