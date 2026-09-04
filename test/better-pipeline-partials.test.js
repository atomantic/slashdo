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
// partials, in pipeline order, and define every input the partials read.
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

const includeIndex = (body, lib) => body.indexOf('!read lib/' + lib + '.md');

// A partial documents its inputs in a `### Inputs` block and then USES them in the
// phase text below it. Only the phase text is a substitution point: a token that
// survives as a doc bullet alone has lost the line it was meant to fill.
const partialBody = (lib) => {
  const text = fs.readFileSync(path.join(root, 'lib', `${lib}.md`), 'utf8');
  const parts = text.split('### Inputs');
  assert.equal(parts.length, 2, `lib/${lib}.md must have exactly one ### Inputs block`);
  const start = parts[1].indexOf('\n## ');
  assert.ok(start > -1, `lib/${lib}.md has no phase section after its ### Inputs block`);
  return parts[1].slice(start);
};

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
  it('is included by both audit commands, in pipeline order', () => {
    // Re-inlining one command's copy of a phase leaves every other test green and
    // silently restores the drift the extraction removed. Order matters just as
    // much: cleanup ahead of PR creation would tell the agent to delete the
    // staging branch and the spool before Phase 5 cherry-picks files out of them.
    for (const name of AUDIT_COMMANDS) {
      const body = readCommand(name);
      const at = PIPELINE_LIBS.map((lib) => {
        const i = includeIndex(body, lib);
        assert.notEqual(i, -1, `${name} must include lib/${lib}.md`);
        return i;
      });
      for (let i = 1; i < at.length; i++) {
        assert.ok(
          at[i] > at[i - 1],
          `${name}: lib/${PIPELINE_LIBS[i]}.md must come after lib/${PIPELINE_LIBS[i - 1]}.md`,
        );
      }
    }
  });

  it('leaves no shared phase re-pasted inline', () => {
    // The include test only proves the !cat is THERE. A command carrying both the
    // include and a re-pasted copy of a phase passes it — and that copy is the
    // drift, since the agent then reads two versions of Phase 5 and follows one.
    // Phase 4c is the only phase heading that legitimately stays inline.
    for (const name of AUDIT_COMMANDS) {
      const strays = fs.readFileSync(path.join(root, 'commands', 'do', name), 'utf8')
        .split('\n')
        .filter((l) => /^## Phase /.test(l) && !/^## Phase (0|1|2|3|4c)\b/.test(l));
      assert.deepEqual(strays, [], `${name} re-pastes a shared phase the partials own`);
    }
  });

  it('points Phase 6 at reviewer loops that come after it', () => {
    // Reviewer details must remain downstream of the Phase 6 gate.
    for (const name of AUDIT_COMMANDS) {
      const body = readCommand(name);
      const phase6 = includeIndex(body, 'better-review-loop');
      for (const lib of REVIEWER_LOOP_LIBS) {
        assert.ok(
          includeIndex(body, lib) > phase6,
          `${name}: lib/${lib}.md must be included after lib/better-review-loop.md`,
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

  it('loads reviewer libraries only from the shared review phase', () => {
    for (const name of AUDIT_COMMANDS) {
      const source = fs.readFileSync(path.join(root, 'commands', 'do', name), 'utf8');
      for (const lib of REVIEWER_LOOP_LIBS) {
        assert.ok(!source.includes(lib + '.md'), `${name} eagerly exposes ${lib}`);
        assert.ok(includeIndex(readCommand(name), lib) >= 0, `${name} cannot reach ${lib}`);
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
