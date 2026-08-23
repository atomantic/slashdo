'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

describe('slashdo statusline', () => {
  it('exits silently when stdin emits an error', () => {
    const statusline = path.resolve(__dirname, '../hooks/slashdo-statusline.js');
    const result = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(statusline)}); process.stdin.emit('error', new Error('broken pipe'));`], {
      encoding: 'utf8',
    });

    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
  });
});
