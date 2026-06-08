'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { readConfig, writeConfig } = require('../src/config');

function tmpFile(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slashdo-cfg-'));
  return { dir, file: path.join(dir, name || '.slashdo-config.json') };
}

// ── readConfig ──────────────────────────────────────────────────────

describe('readConfig', () => {
  it('returns empty object for missing file', () => {
    const { dir, file } = tmpFile();
    assert.deepEqual(readConfig(file), {});
    fs.rmSync(dir, { recursive: true });
  });

  it('returns empty object for null/undefined path', () => {
    assert.deepEqual(readConfig(null), {});
    assert.deepEqual(readConfig(undefined), {});
  });

  it('reads a valid config', () => {
    const { dir, file } = tmpFile();
    fs.writeFileSync(file, JSON.stringify({ autoUpdate: true }), 'utf8');
    assert.deepEqual(readConfig(file), { autoUpdate: true });
    fs.rmSync(dir, { recursive: true });
  });

  it('returns empty object on corrupt JSON', () => {
    const { dir, file } = tmpFile();
    fs.writeFileSync(file, '{not json', 'utf8');
    assert.deepEqual(readConfig(file), {});
    fs.rmSync(dir, { recursive: true });
  });

  it('returns empty object when JSON is an array', () => {
    const { dir, file } = tmpFile();
    fs.writeFileSync(file, '[1,2,3]', 'utf8');
    assert.deepEqual(readConfig(file), {});
    fs.rmSync(dir, { recursive: true });
  });
});

// ── writeConfig ─────────────────────────────────────────────────────

describe('writeConfig', () => {
  it('writes config that round-trips through readConfig', () => {
    const { dir, file } = tmpFile();
    writeConfig(file, { autoUpdate: false });
    assert.deepEqual(readConfig(file), { autoUpdate: false });
    fs.rmSync(dir, { recursive: true });
  });

  it('writes pretty JSON with trailing newline', () => {
    const { dir, file } = tmpFile();
    writeConfig(file, { autoUpdate: true });
    const raw = fs.readFileSync(file, 'utf8');
    assert.ok(raw.endsWith('\n'));
    assert.ok(raw.includes('\n  "autoUpdate"'));
    fs.rmSync(dir, { recursive: true });
  });

  it('is a no-op for null path', () => {
    assert.doesNotThrow(() => writeConfig(null, { autoUpdate: true }));
  });
});
