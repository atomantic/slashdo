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

  it('round-trips a nested defaults object alongside autoUpdate (do:config schema)', () => {
    const { dir, file } = tmpFile();
    const cfg = {
      autoUpdate: true,
      defaults: {
        'review-with': 'claude,codex,ollama[gemma4:26b-mlx],@org-review-bot,@some-app[bot]',
        'review-iterations': 2,
        'reviewer-applies': true,
        'review-stop-mode': 'on-findings',
      },
    };
    writeConfig(file, cfg);
    assert.deepEqual(readConfig(file), cfg);
    fs.rmSync(dir, { recursive: true });
  });

  it('round-trips an arbitrary GitHub reviewer (@<login>) in review-with unchanged', () => {
    const { dir, file } = tmpFile();
    // The `@<login>` form (user or App/bot, the latter carrying a [bot] suffix)
    // must survive the JSON read/write verbatim — brackets and all.
    const cfg = {
      defaults: { 'review-with': '@octocat,@some-app[bot]' },
    };
    writeConfig(file, cfg);
    assert.equal(readConfig(file).defaults['review-with'], '@octocat,@some-app[bot]');
    fs.rmSync(dir, { recursive: true });
  });

  it('round-trips a review-with with optional (~opt) markers unchanged', () => {
    const { dir, file } = tmpFile();
    // The `~opt` non-blocking marker rides through the saved value verbatim
    // (no separate key), so a saved default can pin a non-blocking reviewer.
    // The storage layer is marker-agnostic — it must survive read/write intact,
    // on a bare slug, a bracketed ollama model, and an @<login> alike.
    const cfg = {
      defaults: { 'review-with': 'claude,ollama[qwen2.5-coder:32b]~opt,@flaky-bot~opt,codex' },
    };
    writeConfig(file, cfg);
    assert.equal(
      readConfig(file).defaults['review-with'],
      'claude,ollama[qwen2.5-coder:32b]~opt,@flaky-bot~opt,codex',
    );
    fs.rmSync(dir, { recursive: true });
  });
});
