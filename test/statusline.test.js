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
    const startedAt = Date.now();
    const result = runStatusline('');

    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
    assert.ok(Date.now() - startedAt < 2500, 'statusline waited for its 3s timeout');
  });

  it('exits silently when stdin emits an error', () => {
    const result = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(statusline)}); process.stdin.emit('error', new Error('broken pipe'));`], {
      encoding: 'utf8',
    });

    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
  });

  it('ignores malformed JSON without writing or throwing', () => {
    const result = runStatusline('{not json');

    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
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
