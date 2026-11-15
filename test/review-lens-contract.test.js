'use strict';

// lib/code-review-checklist.md was replaced by lib/review-preferences.md. Installs
// that predate the swap still have the old file on disk, so uninstall.sh must keep
// naming it as a retired lib.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

describe('retired review checklist', () => {
  it('is still cleaned off disk by uninstall.sh as a retired lib', () => {
    const oldLibs = read('uninstall.sh').match(/^OLD_LIBS=\(([\s\S]*?)^\)/m);
    assert.ok(oldLibs, 'uninstall.sh has no OLD_LIBS array');
    assert.match(oldLibs[1], /\bcode-review-checklist\b/);
  });
});
