'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const { readCommandDocs } = require('./helpers/command-docs');
const readCommand = (name) => readCommandDocs(name);

// The two audit commands run the SAME pipeline for Phases 4/4b, 5/5d, 6, and 7.
// That used to be ~800 byte-identical lines maintained by hand in both files, and
// they had already drifted. The phases now live in lib/better-*.md, which only
// keeps them in lockstep for as long as both commands actually include the
// partials and define every input the partials read.
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
  'LEVEL', 'PR_NUMBER', 'OWNER', 'REPO', 'GH_HOST', 'CODE_HOST', 'REVIEW_AGENTS',
  'REVIEW_STOP_MODE', 'REVIEW_MODE', 'REVIEWER_APPLIES', 'REVIEW_ITERATIONS',
  'REVIEW_MODELS', 'WAIT_SCHEDULE', 'MERGE_METHOD', 'OVERALL_STATUS', 'OPTIONAL', 'RUN_ID', 'JOB_ID', 'PLATFORMS',
  'DEPLOYMENT_TARGETS', 'VACUOUS_TESTS_FIXED', 'WEAK_TESTS_STRENGTHENED',
  'NEW_TEST_CASES', 'NEW_TEST_FILES', 'SIMPLIFY_CATEGORIES', 'N',
]);

const partialBody = (lib) => fs.readFileSync(path.join(root, 'lib', `${lib}.md`), 'utf8');

const tokensIn = (text) => new Set([...text.matchAll(/\{([A-Z][A-Z0-9_]+)\}/g)].map((m) => m[1]));

// Not every input is substituted as {TOKEN}: a run-state FLAG is read as a
// condition the partial branches on (`SIMPLIFY_ONLY=true`). Count both forms, or
// the unused-input check reports a flag the partials very much do use.
const readIn = (text) => new Set([
  ...tokensIn(text),
  ...[...text.matchAll(/`([A-Z][A-Z0-9_]+)=/g)].map((m) => m[1]),
]);

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
  it('is driven by the same input token set from both commands', () => {
    // A token one command defines and the other does not is drift by another name:
    // the partial reads it, and one of the two pipelines runs with a hole in it.
    const [a, b] = AUDIT_COMMANDS.map((name) => inputTokens(readCommand(name)));
    assert.deepEqual([...a].sort(), [...b].sort());
  });

  it('has every token its partials substitute defined by both commands', () => {
    const defined = AUDIT_COMMANDS.map((name) => inputTokens(readCommand(name)));
    for (const lib of PIPELINE_LIBS) {
      for (const token of tokensIn(partialBody(lib))) {
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

  it('defines no input no partial substitutes', () => {
    // A definition with no use site is drift waiting to happen: it reads as
    // load-bearing, so it gets maintained, while the phase text has moved on.
    const read = new Set();
    for (const lib of PIPELINE_LIBS) {
      for (const token of readIn(partialBody(lib))) read.add(token);
    }
    for (const name of AUDIT_COMMANDS) {
      for (const token of inputTokens(readCommand(name))) {
        assert.ok(read.has(token), `${name} defines {${token}}, which no partial substitutes`);
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
      for (const [, target] of body.matchAll(/!`cat ~\/\.claude\/lib\/([^`\s]+)[^`]*`/g)) {
        assert.ok(
          fs.existsSync(path.join(root, 'lib', target)),
          `${dir}/${file} includes lib/${target}, which does not exist`,
        );
      }
    }
  });
});
