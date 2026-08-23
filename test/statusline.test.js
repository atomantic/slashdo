'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const statusline = path.resolve(__dirname, '../hooks/slashdo-statusline.js');

function runStatusline(input, options = {}) {
  return spawnSync(process.execPath, [statusline], {
    encoding: 'utf8',
    input,
    timeout: 2000,
    ...options,
  });
}

describe('slashdo statusline', () => {
  it('renders the model, directory, and normalized context usage', () => {
    const result = runStatusline(JSON.stringify({
      model: { display_name: 'Sonnet' },
      workspace: { current_dir: '/x/y' },
      context_window: { remaining_percentage: 90 },
    }));

    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    assert.match(result.stdout, /Sonnet/);
    assert.match(result.stdout, /\x1b\[2my\x1b\[0m/);
    assert.match(result.stdout, /█░{9} 12%/);
  });

  it('exits promptly and silently when stdin closes without data', () => {
    const result = runStatusline('');

    assert.equal(result.error, undefined);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  });

  it('exits silently when stdin emits an error', () => {
    const result = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(statusline)}); process.stdin.emit('error', new Error('broken pipe'));`], {
      encoding: 'utf8',
      timeout: 2000,
    });

    assert.equal(result.error, undefined);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  });

  it('ignores malformed JSON without writing or throwing', () => {
    const result = runStatusline('{not json');

    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  });

  it('renders an update-check notice badge from the cache', () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slashdo-statusline-notice-'));

    try {
      fs.mkdirSync(path.join(configDir, 'cache'));
      fs.writeFileSync(path.join(configDir, 'cache', 'slashdo-update-check.json'), JSON.stringify({
        update_available: false,
        command: '/do:update',
        update_check: 'npm-unavailable',
        notice: 'slashdo update check needs npm on PATH',
      }));

      const result = runStatusline(JSON.stringify({
        model: { display_name: 'Opus' },
        workspace: { current_dir: '/project/root' },
      }), {
        env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
      });

      assert.equal(result.status, 0);
      assert.match(result.stdout, /⚠ slashdo update check needs npm on PATH/);
      assert.doesNotMatch(result.stdout, /⬆/);
    } finally {
      fs.rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('strips control characters from cache-supplied badge text', () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slashdo-statusline-escape-'));

    try {
      fs.mkdirSync(path.join(configDir, 'cache'));
      fs.writeFileSync(path.join(configDir, 'cache', 'evil-update-check.json'), JSON.stringify({
        update_available: true,
        command: '/x\u001b[31mRED\u001b[0m',
      }));

      const result = runStatusline(JSON.stringify({
        model: { display_name: 'Opus' },
        workspace: { current_dir: '/project/root' },
      }), {
        env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
      });

      assert.equal(result.status, 0);
      assert.match(result.stdout, /⬆ \/x \[31mRED \[0m/);
    } finally {
      fs.rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('reads the current task from CLAUDE_CONFIG_DIR', () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slashdo-statusline-'));
    const todosDir = path.join(configDir, 'todos');
    const sessionId = `statusline-${process.pid}`;
    const bridgePath = path.join(os.tmpdir(), `claude-ctx-${sessionId}.json`);

    try {
      fs.mkdirSync(todosDir);
      fs.writeFileSync(path.join(todosDir, `${sessionId}-agent-test.json`), JSON.stringify([
        { status: 'pending', activeForm: 'Ignore pending task' },
        { status: 'in_progress', activeForm: 'Exercise config override' },
      ]));

      const result = runStatusline(JSON.stringify({
        model: { display_name: 'Opus' },
        workspace: { current_dir: '/project/root' },
        session_id: sessionId,
      }), {
        env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
      });

      assert.equal(result.status, 0);
      assert.equal(result.stderr, '');
      assert.match(result.stdout, /Exercise config override/);
      assert.doesNotMatch(result.stdout, /Ignore pending task/);
    } finally {
      fs.rmSync(configDir, { recursive: true, force: true });
      fs.rmSync(bridgePath, { force: true });
    }
  });
});
