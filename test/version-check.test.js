'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { getInstalledVersion, compareVersions } = require('../src/version-check');

// ── getInstalledVersion ─────────────────────────────────────────────

describe('getInstalledVersion', () => {
  it('reads version from existing file', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slashdo-ver-'));
    const versionFile = path.join(tmpDir, '.slashdo-version');
    fs.writeFileSync(versionFile, '1.2.0\n', 'utf8');

    assert.equal(getInstalledVersion(versionFile), '1.2.0');
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns null for missing file', () => {
    assert.equal(getInstalledVersion('/tmp/nonexistent-slashdo-version'), null);
  });

  it('returns null when path is null', () => {
    assert.equal(getInstalledVersion(null), null);
  });

  it('returns null when path is undefined', () => {
    assert.equal(getInstalledVersion(undefined), null);
  });
});

// ── compareVersions ─────────────────────────────────────────────────

describe('compareVersions', () => {
  it('detects major version bump', () => {
    assert.equal(compareVersions('1.0.0', '2.0.0'), 'major');
  });

  it('detects minor version bump', () => {
    assert.equal(compareVersions('1.0.0', '1.1.0'), 'minor');
  });

  it('detects patch version bump', () => {
    assert.equal(compareVersions('1.0.0', '1.0.1'), 'patch');
  });

  it('returns null when versions are equal', () => {
    assert.equal(compareVersions('1.2.0', '1.2.0'), null);
  });

  it('returns null when installed is newer', () => {
    assert.equal(compareVersions('2.0.0', '1.0.0'), null);
  });

  it('returns null when installed is null', () => {
    assert.equal(compareVersions(null, '1.0.0'), null);
  });

  it('returns null when latest is null', () => {
    assert.equal(compareVersions('1.0.0', null), null);
  });

  it('handles v prefix on versions', () => {
    assert.equal(compareVersions('v1.0.0', 'v1.1.0'), 'minor');
  });

  it('handles mixed v prefix', () => {
    assert.equal(compareVersions('v1.0.0', '2.0.0'), 'major');
  });
});
