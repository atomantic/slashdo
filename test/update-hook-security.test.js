'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const hook = fs.readFileSync(path.resolve(__dirname, '../hooks/slashdo-check-update.js'), 'utf8');

describe('update check hook security', () => {
  it('does not execute a package manager during SessionStart', () => {
    assert.doesNotMatch(hook, /(?:npx|npm)\s+-y\s+slash-do@/);
    assert.doesNotMatch(hook, /execSync\([^)]*slash-do@/);
  });

  it('continues to report a manual update command', () => {
    assert.match(hook, /command:\s*'\/do:update'/);
  });
});
