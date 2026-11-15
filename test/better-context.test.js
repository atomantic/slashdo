'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { transformCommand } = require('../src/transformer');
const { ENVIRONMENTS } = require('../src/environments');
const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

describe('better progressive context', () => {
  it('ships a compact skill with phase resources and native command read paths', () => {
    // Which libs the bundle carries is checked for every command by
    // test/command-bundle-closure.test.js; this pins the entry's size budget and
    // that each phase read reaches the agent as a native read instruction.
    const source = read('commands/do/better.md');
    const phaseReads = [...source.matchAll(/^!read lib\/([\w.-]+\.md)$/gm)].map((m) => m[1]);
    assert.ok(phaseReads.length > 0, 'better.md defers its later phases with !read');
    for (const key of ['claude', 'opencode', 'codex', 'antigravity']) {
      const files = {};
      const entry = transformCommand(source, ENVIRONMENTS[key], path.join(root, 'lib'), 'do/better.md', { files });
      assert.ok(Buffer.byteLength(entry) <= 8000, `${key} eagerly loads later phases`);
      assert.doesNotMatch(entry, /^!read /m);
      for (const lib of phaseReads) {
        assert.ok(entry.includes(`${lib}\` before performing this step`), `${key} must emit a read of ${lib}`);
      }
      for (const body of Object.values(files)) assert.doesNotMatch(body, /^!read /m);
    }
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
});
