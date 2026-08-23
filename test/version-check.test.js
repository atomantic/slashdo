'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { spawnSync } = require('node:child_process');

const { getInstalledVersion, compareVersions, hasNpm } = require('../src/version-check');

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
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slashdo-ver-missing-'));
    const missingVersionFile = path.join(tmpDir, 'nonexistent-slashdo-version');
    assert.equal(getInstalledVersion(missingVersionFile), null);
    fs.rmSync(tmpDir, { recursive: true });
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

  // compareVersions ranks; it does not decide whether to nag. These two answers
  // are shared with hooks/slashdo-check-update.js, which layers its update
  // policy on top via isUpdateAvailable() — see test/check-update.test.js.
  it('returns null for a version it cannot rank', () => {
    assert.equal(compareVersions('1.2', '3.33.2'), null);
    assert.equal(compareVersions('nightly', '1.0.0'), null);
  });

  it('ranks against the release a prerelease belongs to', () => {
    assert.equal(compareVersions('1.2.3', '1.2.4-beta.1'), 'patch');
    assert.equal(compareVersions('1.2.4-beta.1', '1.2.4'), null);
  });
});

// ── hasNpm / getLatestVersion ───────────────────────────────────────

// Probe hasNpm() in a child with a PATH we control, so the result depends on the
// fixture rather than on whether the machine running the tests happens to have npm.
function probeWithPath(pathValue) {
  const modulePath = path.resolve(__dirname, '../src/version-check');
  const script = [
    'const { hasNpm, getLatestVersion } = require(' + JSON.stringify(modulePath) + ');',
    'let code = null;',
    'try { getLatestVersion(1000); } catch (e) { code = e.code; }',
    'process.stdout.write(JSON.stringify({ hasNpm: hasNpm(), code }));',
  ].join('\n');
  const result = spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    timeout: 10000,
    env: { PATH: pathValue },
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

describe('hasNpm', () => {
  it('reports true when npm resolves on PATH', { skip: process.platform === 'win32' }, () => {
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slashdo-fake-npm-'));
    const fakeNpm = path.join(binDir, 'npm');
    // Stub stands in for a real npm: hasNpm only asks whether PATH resolves it.
    fs.writeFileSync(fakeNpm, '#!/bin/sh\necho 9.9.9\n', 'utf8');
    fs.chmodSync(fakeNpm, 0o755);

    try {
      assert.equal(probeWithPath(binDir).hasNpm, true);
    } finally {
      fs.rmSync(binDir, { recursive: true, force: true });
    }
  });

  it('reports false and getLatestVersion throws NPM_UNAVAILABLE with npm off PATH', () => {
    assert.deepEqual(probeWithPath('/nonexistent-slashdo-bin'), { hasNpm: false, code: 'NPM_UNAVAILABLE' });
  });
});
