'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const _readCache = new Map();
const _read = (...parts) => {
  const f = path.join(__dirname, "..", ...parts);
  if (!_readCache.has(f)) _readCache.set(f, fs.readFileSync(f, "utf8"));
  return _readCache.get(f);
};
const readLib = (name) => _read("lib", name);
const { readCommandDocs } = require('./helpers/command-docs');
const readCommand = (name) => readCommandDocs(name);

// The loop partials whose invocations carry arrays that can legitimately be empty
// (TIMEOUT_CMD when no timeout/gtimeout is installed, MODEL_FLAG when no model is
// pinned, OLLAMA_FLAGS on an ollama too old for the optional flags).
const LOOPS_WITH_OPTIONAL_ARRAYS = [
  'local-agent-review-loop.md',
  'ollama-review-loop.md',
  'enhance-loop.md',
  'local-cli-runner.md',
];

// Per-harness recipes the local-agent core loads with a gated `!read` (#347).
const LOCAL_AGENT_RECIPES = {
  claude: 'local-agent-claude.md',
  agy: 'local-agent-agy.md',
  cursor: 'local-agent-cursor.md',
  opencode: 'local-agent-opencode.md',
  cmd: 'local-agent-cmd.md',
};

describe('review-loop snippet contracts', () => {
  it('guards every possibly-empty array expansion against bash 3.2 + set -u', () => {
    // Stock macOS has neither `timeout` nor `gtimeout`, so TIMEOUT_CMD is legitimately
    // empty there — and under /bin/bash 3.2 a bare "${ARR[@]}" on an empty array is an
    // UNSET expansion that aborts with `unbound variable` before the reviewer ever runs.
    // Every file then comes back RC=1 with empty output, the loop counts them all as
    // REVIEW_ERRORS, and the pass resolves to `cli-error` — a hard error `~opt` does not
    // excuse — blocking the merge on a PR no reviewer looked at. Only the
    // ${ARR[@]+"${ARR[@]}"} form is safe on bash 3.2, bash 4/5, and zsh alike.
    // Scan by PATTERN, not by a hardcoded array-name list, so a newly introduced
    // optional-argument array is covered the day it lands.
    for (const name of [...LOOPS_WITH_OPTIONAL_ARRAYS, ...Object.values(LOCAL_AGENT_RECIPES)]) {
      const body = readLib(name);
      // A bare "${ARR[@]}" — the lookbehind lets through the guarded ${ARR[@]+"${ARR[@]}"},
      // and the negative lookahead exempts the literal name `ARR`, which is the prose
      // metavariable used to *state* the rule, never a real array.
      const bare = body.match(/(?<!\+)"\$\{(?!ARR\[)[A-Z][A-Z0-9_]*\[@\]\}"/g);
      assert.equal(
        bare,
        null,
        `${name}: unguarded ${bare && bare.join(', ')} aborts under bash 3.2 + set -u when empty — use \${ARR[@]+"\${ARR[@]}"}`,
      );
      // ...and the opposite slip: a mechanical rewrite that wraps an already-guarded
      // expansion a second time. Harmless to bash, but it publishes a second "correct"
      // spelling of the rule this partial exists to teach, which is how it drifts.
      // `"?` because the second wrap may or may not quote the inner expansion —
      // ${A[@]+${A[@]+…}} and ${A[@]+"${A[@]+…}"} are both the same slip.
      const doubled = body.match(/\$\{([A-Z][A-Z0-9_]*)\[@\]\+"?\$\{\1\[@\]\+/g);
      assert.equal(doubled, null, `${name}: double-wrapped guard ${doubled && doubled.join(', ')} — one \${ARR[@]+…} is enough`);
    }
  });

  it('executes the grok effort carrier (max clamped to xhigh), prompt-file prep, and verdict extraction', () => {
    // #452: grok rejects `max` (`unknown effort level 'max'; use one of: xhigh,
    // high, medium, low`), so `grok~effort=max` failed fast as cli-error. Grok
    // Build 1.0.62 `grok --help`: `-p/--single`, `--prompt-file`,
    // `--reasoning-effort` (alias `--effort`), `--permission-mode plan`,
    // `--sandbox`, `--tools`, `--disallowed-tools`, `--disable-web-search`,
    // `--no-subagents`, `--verbatim`.
    const { execFileSync } = require('child_process');
    const loop = readLib('local-agent-review-loop.md');

    // Run the real carrier block: max must reach grok as xhigh, other levels unchanged.
    const start = loop.indexOf('# Reasoning effort carrier.');
    const carrier = loop.slice(start, loop.indexOf('```', start));
    const effortArgv = (effort) => execFileSync('bash', ['-c', `${carrier}\nprintf '%s\\n' "\${EFFORT_FLAG[@]}"`], {
      env: { ...process.env, REVIEW_AGENT: 'grok', REVIEW_EFFORT: effort },
      encoding: 'utf8',
    }).trim().split('\n');
    assert.deepEqual(effortArgv('max'), ['--reasoning-effort', 'xhigh']);
    assert.deepEqual(effortArgv('xhigh'), ['--reasoning-effort', 'xhigh']);
    assert.deepEqual(effortArgv('high'), ['--reasoning-effort', 'high']);

    const runner = loop.slice(loop.indexOf('**Grok runner.**'), loop.indexOf('### Enforced reviewer permissions'));
    // Execute the prompt-file block: a real prompt lands in a private file; an empty one is no-verdict.
    const prep = runner.match(/```bash\n(GROK_REVIEW_INPUT=""[\s\S]*?)```/)[1];
    const runPrep = (prompt) => execFileSync('bash', ['-c', `${prep}\nprintf '%s|%s|' "$STATUS" "$GROK_REVIEW_INPUT"; [ -n "$GROK_REVIEW_INPUT" ] && cat "$GROK_REVIEW_INPUT" && rm -f "$GROK_REVIEW_INPUT"; true`], {
      env: { ...process.env, REVIEW_AGENT: 'grok', LOCAL_PROMPT: prompt },
      encoding: 'utf8',
    });
    const [okStatus, okFile, okBody] = runPrep('review this\ndiff').split('|');
    assert.equal(okStatus, '');
    assert.ok(okFile.length > 0);
    assert.equal(okBody, 'review this\ndiff');
    assert.equal(runPrep('').split('|').slice(0, 2).join('|'), 'no-verdict|');

    // `plain`/`json` glue pre-tool narration onto the verdict line (seen live:
    // "I'll read `package.json` first.NO FINDINGS"); the post-launch step must hand
    // Step 3 only the stream's final result, and an unusable stream must parse empty.
    const post = runner.match(/```bash\n(if \[ "\$REVIEW_AGENT" = grok \]; then\n[\s\S]*?)```/)[1];
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'grok-verdict-'));
    const verdictOf = (stream, exitCode = '0') => {
      const log = path.join(tmp, `s${Math.random().toString(36).slice(2)}.log`);
      fs.writeFileSync(log, stream);
      return execFileSync('bash', ['-c', `${post}\nprintf '%s|%s|' "$REPORT_LOG_FILE" "$LOG_FILE"; cat "$LOG_FILE"`], {
        env: { ...process.env, REVIEW_AGENT: 'grok', LOG_FILE: log, GROK_REVIEW_INPUT: '', EXIT_CODE: exitCode },
        encoding: 'utf8',
      }).split('|');
    };
    try {
      const stream = [
        { type: 'system', subtype: 'init' },
        { type: 'assistant', message: { content: [{ type: 'text', text: "I'll read `package.json` first." }, { type: 'tool_use' }] } },
        { type: 'user', message: { content: [{ type: 'tool_result' }] } },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'NO FINDINGS' }] } },
        { type: 'result', subtype: 'success', result: 'NO FINDINGS' },
      ].map((l) => JSON.stringify(l)).join('\n');
      const [reported, verdictLog, verdict] = verdictOf(stream);
      assert.equal(verdict.trim(), 'NO FINDINGS');
      assert.match(verdictLog, /\.verdict\.log$/);
      assert.notEqual(reported, verdictLog, 'the raw stream stays the reported log');
      assert.equal(verdictOf('not json\n')[2], '');
      assert.equal(verdictOf(JSON.stringify({ type: 'result', subtype: 'error_max_turns', result: 'NO FINDINGS' }))[2], '');
      // A failed launch keeps the raw stream as LOG_FILE so the cli-error dump shows grok's stdout error.
      const failed = verdictOf('{"type":"error","message":"boom"}', '1');
      assert.doesNotMatch(failed[1], /\.verdict\.log$/);
      assert.match(failed[2], /boom/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('derives GH_HOST from the one lib partial, never a hand-copied snippet', () => {
    // lib/gh-host.md exists so the Enterprise-safe API host is derived ONCE, with its
    // full 3-step fallback chain. Eight sites used to re-type a shortened 2-step copy
    // that skipped the `gh repo view` fallback, so a repo with no parsable origin
    // silently polled github.com instead of the Enterprise host. Assert that every
    // command whose `gh api` calls need the host
    // pulls it in via the runtime include, and that nobody re-types the derivation.
    const GH_HOST_INCLUDE = /!`cat ~\/\.claude\/lib\/gh-host\.md[^`]*`|!read lib\/gh-host\.md/;
    const CAT_INCLUDE = /!`cat ~\/\.claude\/lib\/([A-Za-z0-9._-]+\.md)[^`]*`/g;
    const HOSTNAME_USE = /gh api --hostname/;

    // A file needs GH_HOST if it calls `gh api --hostname` itself or inlines a lib
    // that does (gh-host.md itself only documents the flag, so it doesn't count).
    const libNeedsHost = (name, seen = new Set()) => {
      if (name === 'gh-host.md' || seen.has(name)) return false;
      seen.add(name);
      const body = readLib(name);
      if (HOSTNAME_USE.test(body)) return true;
      return [...body.matchAll(CAT_INCLUDE)].some(([, dep]) => libNeedsHost(dep, seen));
    };

    // Derived from the tree, never hardcoded: a new command (or a newly-included lib)
    // that reaches a `gh api --hostname` call must carry the include or fail here.
    const commandsDir = path.join(__dirname, '..', 'commands', 'do');
    const commands = fs.readdirSync(commandsDir).filter((f) => f.endsWith('.md'));
    const needsHost = commands.filter((name) => {
      const body = readCommand(name);
      return HOSTNAME_USE.test(body)
        || [...body.matchAll(CAT_INCLUDE)].some(([, dep]) => libNeedsHost(dep));
    });
    assert.ok(
      needsHost.length >= 8,
      `expected the GH_HOST-dependent command set to stay broad, got ${needsHost.join(', ')}`,
    );
    for (const name of needsHost) {
      assert.match(
        readCommand(name),
        GH_HOST_INCLUDE,
        `${name} reaches a \`gh api --hostname\` call, so it must include lib/gh-host.md`,
      );
    }

    // And nobody re-types the derivation inline. Two bans, both derived over every file:
    // the origin-parse `sed` itself (the copied half that matters), and a bare
    // github.com fallback in its common spellings. next.md legitimately runs that parse
    // once as ORIGIN_HOST to pick gh vs glab BEFORE any GH_HOST exists (gh-host.md's own
    // `gh repo view` fallback is GitHub-only, so it cannot do that job) — that one line
    // is the sole exemption.
    const ORIGIN_PARSE = "sed -E 's#^[a-z]+://##";
    const DRIFTED_FALLBACK = /\|\|\s*(?:GH_)?HOST="?github\.com/;
    const DRIFTED_DEFAULT = /\$\{(?:GH_)?HOST:[=-]"?github\.com/;
    const banned = (body, label) => {
      for (const line of body.split('\n')) {
        if (line.includes(ORIGIN_PARSE) && !line.includes('ORIGIN_HOST=')) {
          assert.fail(`${label} re-types the gh-host.md origin parse: ${line.trim()}`);
        }
        assert.doesNotMatch(line, DRIFTED_FALLBACK, `${label} hand-copies the GH_HOST fallback`);
        assert.doesNotMatch(line, DRIFTED_DEFAULT, `${label} hand-copies the GH_HOST fallback`);
      }
    };
    for (const name of commands) banned(_read("commands", "do", name), name);
    const libsDir = path.join(__dirname, '..', 'lib');
    for (const name of fs.readdirSync(libsDir).filter((f) => f.endsWith('.md') && f !== 'gh-host.md')) {
      banned(readLib(name), `lib/${name}`);
    }
    // The repo's own .claude/commands/ specs too — a copy hid there once, outside a
    // sweep that only walked the shipped tree.
    const localDir = path.join(__dirname, '..', '.claude', 'commands');
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(path.join(dir, e.name)) : (e.name.endsWith('.md') ? [path.join(dir, e.name)] : []));
    if (fs.existsSync(localDir)) {
      for (const file of walk(localDir)) {
        banned(fs.readFileSync(file, 'utf8'), path.relative(path.join(__dirname, '..'), file));
      }
    }
  });
});

describe('local CLI runner and review fix tail are single-owner partials (#349)', () => {
  const { buildPromptBundle } = require('../src/transformer');
  const libDir = path.join(__dirname, '..', 'lib');
  const bundleFiles = (name) => Object.keys(buildPromptBundle(_read('commands', 'do', name), libDir).files);

  it('bundles the shared partials with their users and no whole-loop cross-citations', () => {
    // enhance-loop.md used to cite local-agent-review-loop.md ("same pattern as"),
    // and the local-agent loop once cited enhance-loop.md, so each command shipped the
    // other's entire loop. Now both cite only the runner they actually execute.
    for (const name of ['pr.md', 'rpr.md', 'review.md', 'release.md']) {
      const files = bundleFiles(name);
      for (const lib of ['local-cli-runner.md', 'review-fix-tail.md']) {
        assert.ok(files.includes(lib), `${name} must bundle ${lib}`);
      }
      assert.ok(!files.includes('enhance-loop.md'), `${name} never runs the enhance loop`);
    }
    assert.ok(bundleFiles('plan-task.md').includes('local-cli-runner.md'), 'plan-task must bundle the runner enhance uses');
    // What the enhance loop itself pulls in: the runner and its per-CLI recipes, never
    // a review loop or the review fix tail.
    const enhanceFiles = Object.keys(buildPromptBundle(readLib('enhance-loop.md'), libDir).files);
    assert.ok(enhanceFiles.includes('local-cli-runner.md'));
    for (const lib of ['local-agent-review-loop.md', 'ollama-review-loop.md', 'review-fix-tail.md']) {
      assert.ok(!enhanceFiles.includes(lib), `enhance-loop.md must not bundle ${lib}`);
    }
  });

  it('keeps the inlined push-target guard identical to the tested one in upstream-push.md', () => {
    // The fix tail (loaded without the wrapper under /do:rpr) and the wrapper (loaded without
    // the tail on a host-only run) each have to carry the guard that keeps a branch with
    // inherited base tracking off the default branch. test/upstream-push-base-guard-contract
    // executes the copy in upstream-push.md; this keeps the two inlined copies from drifting.
    const guard = readLib('upstream-push.md').match(/```bash\n(BR=[\s\S]*?)```/)[1].trim();
    for (const name of ['review-fix-tail.md', 'multi-reviewer-loop.md']) {
      const dedented = readLib(name).split('\n').map((line) => line.replace(/^ {3}/, '')).join('\n');
      assert.ok(dedented.includes(guard), `${name} push-target guard drifted from lib/upstream-push.md`);
    }
  });
});
