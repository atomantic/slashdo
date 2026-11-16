'use strict';

// lib/code-review-checklist.md was replaced by lib/review-preferences.md. Installs
// that predate the swap still have the old file on disk, so the curl installer's
// manifest must keep naming it as a retired lib for uninstall.sh to remove.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseManifest } = require('../scripts/build-install-manifest');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

describe('retired review checklist', () => {
  it('is still cleaned off disk by uninstall.sh as a retired lib', () => {
    const manifest = parseManifest(read('install-manifest.txt'));
    assert.ok(manifest['retired-libs'].includes('code-review-checklist.md'));
  });
});
