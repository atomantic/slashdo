'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const readCommand = (name) => fs.readFileSync(path.join(root, 'commands', 'do', name), 'utf8');

// The two audit commands run the SAME pipeline for Phases 4/4b, 5/5d, 6, and 7.
// That used to be ~800 byte-identical lines maintained by hand in both files, and
// they had already drifted. The phases now live in lib/better-*.md, which only
// keeps them in lockstep for as long as both commands actually include the
// partials and both define every input the partials read.
const AUDIT_COMMANDS = ['better.md', 'better-swift.md'];
const PIPELINE_LIBS = [
  'better-verification',
  'better-pr-and-ci',
  'better-review-loop',
  'better-cleanup',
];

// Tokens the wider pipeline already carries into these phases (Phase 0 detection,
// Phase 3a worktree setup, the review-flag parser). The partials read them but no
// Shared Pipeline Inputs block redefines them.
const RUNTIME_TOKENS = new Set([
  'BUILD_CMD', 'TEST_CMD', 'WORKTREE_DIR', 'REPO_DIR', 'CURRENT_BRANCH',
  'DEFAULT_BRANCH', 'DATE', 'CATEGORY_SLUG', 'FIRST_CATEGORY', 'NEW_VERSION',
  'LEVEL', 'PR_NUMBER', 'OWNER', 'REPO', 'GH_HOST', 'REVIEW_AGENTS',
  'REVIEW_STOP_MODE', 'REVIEW_MODE', 'REVIEWER_APPLIES', 'REVIEW_ITERATIONS',
  'OVERALL_STATUS', 'OPTIONAL', 'RUN_ID', 'JOB_ID', 'PLATFORMS',
  'DEPLOYMENT_TARGETS', 'VACUOUS_TESTS_FIXED', 'WEAK_TESTS_STRENGTHENED',
  'NEW_TEST_CASES', 'NEW_TEST_FILES', 'SIMPLIFY_CATEGORIES', 'N',
]);

// The reviewer loops Phase 6.1 dispatches to. `inlineLibContent` resolves a `!cat`
// once and does not re-scan the text it pasted in, so a `!cat` written INSIDE a
// partial is never expanded on the Claude path — these five must stay at each
// command's own top level.
const REVIEWER_LOOP_LIBS = [
  'multi-reviewer-loop',
  'copilot-review-loop',
  'github-reviewer-loop',
  'local-agent-review-loop',
  'ollama-review-loop',
];

const inputTokens = (body) => {
  const section = body.split('## Shared Pipeline Inputs')[1];
  assert.ok(section, 'no Shared Pipeline Inputs section');
  const list = section.split('\n## Phase')[0];
  const all = [...list.matchAll(/`\{([A-Z][A-Z0-9_]+)\}`/g)].map((m) => m[1]);
  // The block quotes some token VALUES, and a value may itself mention a runtime
  // token ({BUILD_CMD} in the Swift review-loop instruction). Those are not inputs.
  return new Set(all.filter((t) => !RUNTIME_TOKENS.has(t)));
};

describe('shared better-* pipeline partials', () => {
  it('is included by both audit commands', () => {
    // Re-inlining one command's copy of a phase leaves every other test green and
    // silently restores the drift the extraction removed.
    for (const name of AUDIT_COMMANDS) {
      const body = readCommand(name);
      for (const lib of PIPELINE_LIBS) {
        assert.match(
          body,
          new RegExp('!`cat ~/\\.claude/lib/' + lib + '\\.md`'),
          `${name} must include lib/${lib}.md`,
        );
      }
    }
  });

  it('is driven by the same input token set from both commands', () => {
    // A token one command defines and the other does not is drift by another name:
    // the partial reads it, and one of the two pipelines runs with a hole in it.
    const [a, b] = AUDIT_COMMANDS.map((name) => inputTokens(readCommand(name)));
    assert.deepEqual([...a].sort(), [...b].sort());
  });

  it('has every token its partials read defined by both commands', () => {
    const defined = AUDIT_COMMANDS.map((name) => inputTokens(readCommand(name)));
    for (const lib of PIPELINE_LIBS) {
      const text = fs.readFileSync(path.join(root, 'lib', `${lib}.md`), 'utf8');
      for (const [, token] of text.matchAll(/\{([A-Z][A-Z0-9_]+)\}/g)) {
        if (RUNTIME_TOKENS.has(token)) continue;
        for (let i = 0; i < AUDIT_COMMANDS.length; i++) {
          assert.ok(
            defined[i].has(token),
            `lib/${lib}.md reads {${token}}, which ${AUDIT_COMMANDS[i]} never defines`,
          );
        }
      }
    }
  });

  it('defines no input no partial reads', () => {
    // A stale definition is a maintenance trap: it reads as load-bearing and gets
    // updated alongside the ones that are.
    const read = new Set();
    for (const lib of PIPELINE_LIBS) {
      const text = fs.readFileSync(path.join(root, 'lib', `${lib}.md`), 'utf8');
      for (const [, token] of text.matchAll(/\{([A-Z][A-Z0-9_]+)\}/g)) read.add(token);
    }
    for (const name of AUDIT_COMMANDS) {
      for (const token of inputTokens(readCommand(name))) {
        assert.ok(read.has(token), `${name} defines {${token}}, which no partial reads`);
      }
    }
  });

  it('keeps the reviewer loops at each command\'s top level', () => {
    // lib/better-review-loop.md documents this requirement; without a test it is
    // one refactor away from a Phase 6 that cats nothing.
    for (const name of AUDIT_COMMANDS) {
      const body = readCommand(name);
      for (const lib of REVIEWER_LOOP_LIBS) {
        assert.match(
          body,
          new RegExp('^!`cat ~/\\.claude/lib/' + lib + '\\.md`$', 'm'),
          `${name} must !cat lib/${lib}.md at top level, not from inside a partial`,
        );
      }
    }
  });
});

describe('lib includes resolve', () => {
  it('names a lib file that exists, everywhere a !cat appears', () => {
    // The transformer passes an unresolvable include through verbatim, so a typo or
    // a renamed partial reaches the agent as a literal `!cat` line it cannot run.
    const files = [
      ...fs.readdirSync(path.join(root, 'commands', 'do')).map((f) => ['commands/do', f]),
      ...fs.readdirSync(path.join(root, 'lib')).map((f) => ['lib', f]),
    ].filter(([, f]) => f.endsWith('.md'));

    for (const [dir, file] of files) {
      const body = fs.readFileSync(path.join(root, dir, file), 'utf8');
      for (const [, target] of body.matchAll(/!`cat ~\/\.claude\/lib\/(.+?)`/g)) {
        assert.ok(
          fs.existsSync(path.join(root, 'lib', target)),
          `${dir}/${file} includes lib/${target}, which does not exist`,
        );
      }
    }
  });
});
