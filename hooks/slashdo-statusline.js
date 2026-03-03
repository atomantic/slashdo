#!/usr/bin/env node
// slashdo statusline for Claude Code
// Shows: model | current task | directory | context usage | update notifications

const fs = require('fs');
const path = require('path');
const os = require('os');

// Read JSON from stdin
let input = '';
// Timeout guard: if stdin doesn't close within 3s (e.g. pipe issues on
// Windows/Git Bash), exit silently instead of hanging.
const stdinTimeout = setTimeout(() => process.exit(0), 3000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    const data = JSON.parse(input);
    const model = data.model?.display_name || 'Claude';
    const dir = data.workspace?.current_dir || process.cwd();
    const session = data.session_id || '';
    const remaining = data.context_window?.remaining_percentage;

    // Context window display (shows USED percentage scaled to usable context)
    // Claude Code reserves ~16.5% for autocompact buffer, so usable context
    // is 83.5% of the total window. We normalize to show 100% at that point.
    const AUTO_COMPACT_BUFFER_PCT = 16.5;
    let ctx = '';
    if (remaining != null) {
      const usableRemaining = Math.max(0, ((remaining - AUTO_COMPACT_BUFFER_PCT) / (100 - AUTO_COMPACT_BUFFER_PCT)) * 100);
      const used = Math.max(0, Math.min(100, Math.round(100 - usableRemaining)));

      // Write context metrics to bridge file for context-monitor hooks
      if (session) {
        try {
          const safeSession = session.replace(/[^a-zA-Z0-9_-]/g, '');
          const bridgePath = path.join(os.tmpdir(), `claude-ctx-${safeSession}.json`);
          const bridgeData = JSON.stringify({
            session_id: session,
            remaining_percentage: remaining,
            used_pct: used,
            timestamp: Math.floor(Date.now() / 1000)
          });
          fs.writeFileSync(bridgePath, bridgeData);
        } catch (e) {
          // Silent fail -- bridge is best-effort, don't break statusline
        }
      }

      // Build progress bar (10 segments)
      const filled = Math.floor(used / 10);
      const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);

      // Color based on usable context thresholds
      if (used < 50) {
        ctx = ` \x1b[32m${bar} ${used}%\x1b[0m`;
      } else if (used < 65) {
        ctx = ` \x1b[33m${bar} ${used}%\x1b[0m`;
      } else if (used < 80) {
        ctx = ` \x1b[38;5;208m${bar} ${used}%\x1b[0m`;
      } else {
        ctx = ` \x1b[5;31m💀 ${bar} ${used}%\x1b[0m`;
      }
    }

    // Current task from todos
    let task = '';
    const homeDir = os.homedir();
    // Respect CLAUDE_CONFIG_DIR for custom config directory setups
    const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(homeDir, '.claude');
    const todosDir = path.join(claudeDir, 'todos');
    if (session && fs.existsSync(todosDir)) {
      try {
        const entries = fs.readdirSync(todosDir);
        let latestFile = null;
        let latestMtime = 0;
        for (const f of entries) {
          if (!f.startsWith(session) || !f.includes('-agent-') || !f.endsWith('.json')) continue;
          try {
            const mt = fs.statSync(path.join(todosDir, f)).mtimeMs;
            if (mt > latestMtime) { latestMtime = mt; latestFile = f; }
          } catch (e) {}
        }

        if (latestFile) {
          try {
            const todos = JSON.parse(fs.readFileSync(path.join(todosDir, latestFile), 'utf8'));
            const inProgress = todos.find(t => t.status === 'in_progress');
            if (inProgress) task = inProgress.activeForm || '';
          } catch (e) {}
        }
      } catch (e) {
        // Silently fail on file system errors - don't break statusline
      }
    }

    // Update notifications (GSD + slashdo)
    let updates = '';
    const cacheDir = path.join(claudeDir, 'cache');
    const gsdCacheFile = path.join(cacheDir, 'gsd-update-check.json');
    if (fs.existsSync(gsdCacheFile)) {
      try {
        const cache = JSON.parse(fs.readFileSync(gsdCacheFile, 'utf8'));
        if (cache.update_available) {
          updates += '\x1b[33m⬆ /gsd:update\x1b[0m │ ';
        }
      } catch (e) {}
    }
    const slashdoCacheFile = path.join(cacheDir, 'slashdo-update-check.json');
    if (fs.existsSync(slashdoCacheFile)) {
      try {
        const cache = JSON.parse(fs.readFileSync(slashdoCacheFile, 'utf8'));
        if (cache.update_available) {
          updates += '\x1b[33m⬆ /do:update\x1b[0m │ ';
        }
      } catch (e) {}
    }

    // Output
    const dirname = path.basename(dir);
    if (task) {
      process.stdout.write(`${updates}\x1b[2m${model}\x1b[0m │ \x1b[1m${task}\x1b[0m │ \x1b[2m${dirname}\x1b[0m${ctx}`);
    } else {
      process.stdout.write(`${updates}\x1b[2m${model}\x1b[0m │ \x1b[2m${dirname}\x1b[0m${ctx}`);
    }
  } catch (e) {
    // Silent fail - don't break statusline on parse errors
  }
});
