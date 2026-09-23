'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { readCommandDocs } = require('./helpers/command-docs');
const { transformCommand } = require('../src/transformer');
const { ENVIRONMENTS } = require('../src/environments');
const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

describe('better progressive context', () => {
  it('keeps the initial command within a small orchestration budget', () => {
    // The original 82KB source expanded beyond 200KB with review libraries.
    // Budget the entrypoint, not the task evidence or an arbitrary line count.
    const entry = read('commands/do/better.md');
    assert.ok(Buffer.byteLength(entry) <= 6000);
    assert.doesNotMatch(entry, /!`cat /);
    assert.doesNotMatch(entry, /!read lib\/(?:better-audit-|.*reviewer-loop|.*agent-review-loop)/);
    for (const phase of ['options', 'discovery', 'audit', 'plan', 'remediation', 'verification', 'pr-and-ci', 'review-loop', 'cleanup']) {
      assert.ok(entry.includes(`!read lib/better-${phase}.md`), `missing ${phase} phase route`);
    }
  });

  it('keeps a default run\'s orchestrator path within its byte budget (#325)', () => {
    // The entrypoint budget above let the progressive-disclosure split move text
    // into phase partials without shrinking it. This sums what a default run
    // (no --simplify-only, --strict, or reviewers) actually reads: better.md plus
    // every `!read` it reaches, recursively, except those whose gate prose
    // directly above opens with "Only when/with/for/on …".
    //
    // #325's target is 60 KB. Since tracker filing became unconditional (#375),
    // the shared tracker partials sit on this path; setup, model tiers, saved
    // defaults, and host selection are now contracts, and plan-issue-filing /
    // better-issue-mode are what remain. Lower it, never raise it.
    const BUDGET = 70000;
    const GATE = /^(?:\d+[a-z]?\.\s+)?Only (?:when|with|for|on)\b/;
    const reached = new Map();
    const gated = new Set();
    const visit = (file) => {
      if (reached.has(file)) return;
      const body = read(file);
      reached.set(file, Buffer.byteLength(body));
      const lines = body.split('\n');
      lines.forEach((line, i) => {
        const target = line.match(/^!read (lib\/[\w.-]+\.md)$/)?.[1];
        if (!target) return;
        let j = i - 1;
        while (j >= 0 && (!lines[j].trim() || lines[j].startsWith('!read '))) j--;
        if (j >= 0 && GATE.test(lines[j].trim())) gated.add(target);
        else visit(target);
      });
    };
    visit('commands/do/better.md');

    // Pin the gated set so a new gate can't silently drop a partial from the budget.
    assert.deepEqual([...gated].filter((f) => !reached.has(f)).sort(), [
      'lib/better-review-loop.md',
      'lib/better-simplify.md',
      'lib/review-flags.md',
      'lib/review-structural-ambition.md',
    ]);
    const total = [...reached.values()].reduce((a, b) => a + b, 0);
    const breakdown = [...reached].sort((a, b) => b[1] - a[1]).map(([f, n]) => `${n} ${f}`).join('\n');
    assert.ok(total <= BUDGET, `default /do:better path is ${total} bytes (budget ${BUDGET}):\n${breakdown}`);

    // Contracts, not how-to: no placeholder-docs block and no checklist include.
    for (const file of reached.keys()) {
      const body = read(file);
      assert.doesNotMatch(body, /^### Inputs\b/m, `${file} carries an ### Inputs placeholder-docs block`);
      assert.doesNotMatch(body, /^!read lib\/[\w.-]*checklist[\w.-]*\.md$/m, `${file} pulls a checklist onto the default path`);
    }
  });

  it('keeps better-swift a thin caller over the shared pipeline', () => {
    const entry = read('commands/do/better-swift.md');
    assert.ok(Buffer.byteLength(entry) <= 10000);
    assert.doesNotMatch(entry, /!`cat /);
    assert.doesNotMatch(entry, /^## Phase (?:0|1|2|3|4c)\b/m);
    for (const phase of ['options', 'discovery', 'audit', 'plan', 'remediation', 'verification', 'test-enhancement', 'pr-and-ci', 'review-loop', 'cleanup']) {
      assert.match(entry, new RegExp(`!read lib/better-${phase}\\.md`), `missing ${phase} phase route`);
    }
    assert.match(entry, /!read lib\/swift-pipeline-inputs\.md/);
    assert.match(entry, /unsupported by this Swift caller/);
    const inputs = read('lib/swift-pipeline-inputs.md');
    assert.match(inputs, /PLATFORMS/);
    assert.match(inputs, /DEPLOYMENT_TARGETS/);
    assert.match(inputs, /SWIFT-SPECIFIC GUARDRAILS/);
    assert.match(inputs, /platform-swiftui/);
    assert.match(inputs, /!read lib\/swift-gotchas\.md/);
    const remediation = read('lib/better-remediation.md');
    assert.match(remediation, /WORKTREE_DIR=\.\.\/\{BRANCH_PREFIX\}-\{DATE\}/);
    assert.match(read('lib/remediation-agent-template.md'), /\{BRANCH_PREFIX\} audit/);
  });
  it('ships a compact skill with phase resources and native command read paths', () => {
    const source = read('commands/do/better.md');
    for (const key of ['claude', 'opencode', 'codex', 'antigravity']) {
      const files = {};
      const entry = transformCommand(source, ENVIRONMENTS[key], path.join(root, 'lib'), 'do/better.md', { files });
      assert.ok(Buffer.byteLength(entry) <= 8000, `${key} eagerly loads later phases`);
      assert.doesNotMatch(entry, /^!read /m);
      assert.match(entry, /Read `[^`]*better-options\.md`/);
      if (ENVIRONMENTS[key].bundlesLibs) {
        assert.ok(files['better-audit.md']);
        assert.ok(files['better-simplify.md']);
        assert.ok(files['local-agent-review-loop.md']);
        for (const body of Object.values(files)) assert.doesNotMatch(body, /^!read /m);
      }
    }
  });

  it('lists every audit category slug in one ownership table instead of per-category lens files', () => {
    const dispatch = read('lib/better-audit.md');
    const pipelineInputs = read('lib/better-pipeline-inputs.md');
    const slugsLine = pipelineInputs.match(/^- `\{CATEGORY_SLUGS\}` = (.+)$/m)[1];
    const slugs = [...slugsLine.matchAll(/`([\w-]+)`/g)].map((match) => match[1]);
    assert.ok(slugs.length > 0, 'could not parse {CATEGORY_SLUGS} from lib/better-pipeline-inputs.md');
    for (const slug of slugs) {
      assert.match(dispatch, new RegExp(`\\| \`${slug}\``), `category table is missing the ${slug} row`);
    }
    assert.doesNotMatch(dispatch, /!read lib\/better-audit-/);
    assert.match(dispatch, /Do not pass the complete command/);
    assert.match(dispatch, /Cover every applicable requested scope/);
  });

  it('resolves every explicit required resource in the source tree', () => {
    for (const dir of ['commands/do', 'lib']) {
      for (const name of fs.readdirSync(path.join(root, dir)).filter((name) => name.endsWith('.md'))) {
        for (const [, target] of read(`${dir}/${name}`).matchAll(/^!read (.+)$/gm)) {
          assert.match(target, /^lib\/[\w.-]+\.md$/);
          assert.ok(read(target).trim(), `${dir}/${name} requires ${target}`);
        }
      }
    }
  });

  it('loads the spool/filer contract exactly once, from better.md', () => {
    // PLAN.md mode was removed, so tracker filing is the only behavior: better.md
    // reads the contract once, unconditionally, before Phase 1 touches it, and the
    // phase partials never re-read the general tracker mechanics themselves.
    const entry = read('commands/do/better.md');
    const gateLine = entry.split('\n').find((l) => l.includes('!read lib/better-issue-mode.md'));
    assert.ok(gateLine, 'better.md must route to lib/better-issue-mode.md');
    assert.doesNotMatch(entry, /ISSUE_MODE/);

    for (const file of ['lib/better-audit.md', 'lib/better-plan.md']) {
      assert.doesNotMatch(read(file), /^!read lib\/plan-issue-(?:setup|filing)\.md$/m, file);
    }
    const issueMode = read('lib/better-issue-mode.md');
    assert.match(issueMode, /^!read lib\/plan-issue-setup\.md$/m);
    assert.match(issueMode, /^!read lib\/plan-issue-filing\.md$/m);
  });

  it('keeps the simplify alias pointed at the moved mode contract', () => {
    const alias = read('commands/do/simplify.md');
    assert.match(alias, /!read lib\/better-simplify\.md/);
    assert.doesNotMatch(alias, /better\.md#simplify-only/);
  });

  it('preserves uncertainty and simplify-only behavior through phase boundaries', () => {
    assert.match(read('lib/better-audit.md'), /Mark unresolved hypotheses `\[UNCERTAIN\]`/);
    const issueMode = read('lib/better-issue-mode.md');
    assert.match(issueMode, /<SEVERITY-or-UNCERTAIN>/);
    assert.match(issueMode, /targeted validation of `UNCERTAIN` findings/);
    assert.match(issueMode, /never auto-remediate them/);
    const template = read('lib/remediation-agent-template.md');
    assert.match(template, /Confirm each finding against the code; skip false positives with evidence\./);
    assert.match(template, /Structural refactors are intentionally behavior-preserving; honor the caller's\nsimplify contract/);
    assert.match(read('lib/better-simplify.md'), /bug encountered incidentally is recorded as deferred/);
    assert.match(read('lib/better-pr-and-ci.md'), /`--no-merge`[\s\S]{0,160}Phase 7 safe finalization/);
  });

  it('states the Phase 4c–6 gates once, as contracts rather than transcripts', () => {
    // #323: the gates got lost among git/gh command transcripts and were repeated
    // across better.md and the partials. Each now appears once, in one sentence.
    const entry = read('commands/do/better.md');
    const prAndCi = read('lib/better-pr-and-ci.md');
    const tests = read('lib/better-test-enhancement.md');
    assert.match(prAndCi, /\*\*At most 3 CI fix attempts per PR\.\*\*/);
    assert.match(prAndCi, /every expected check \*\*for its current pushed HEAD\*\* has passed/);
    assert.doesNotMatch(entry, /three attempts|3 (?:CI )?(?:fix )?attempts/);
    assert.match(tests, /Every new test must fail against a temporarily broken implementation/);
    assert.match(tests, /the break is never committed/);
    assert.doesNotMatch(tests, /Rules for writing good tests|git restore/);
    assert.doesNotMatch(prAndCi, /Poll every 30 seconds|git checkout -b/);
    // One run-state list, not a summary in better.md plus a justified checklist.
    assert.doesNotMatch(entry, /^Preserve phase, complete file ownership/m);
  });

  it('keeps open PR branches and current-head gates in the shared workflow', () => {
    for (const command of ['better.md', 'better-swift.md']) {
      const contract = readCommandDocs(command);
      assert.match(contract, /never delete the remote branch for an open or unmerged PR/);
      assert.match(contract, /Prior approval of a different HEAD is insufficient/);
      assert.match(contract, /expected checks never attach/);
    }
  });

  it('has no PLAN.md mode left in the better/depfree pipelines', () => {
    // PLAN.md mode was removed: deferred findings are filed as tracker issues, and
    // --issues / --no-issues survive only as a deprecated no-op / an abort.
    const files = [
      ...['better', 'better-swift', 'depfree', 'simplify', 'pr-better'].map((n) => `commands/do/${n}.md`),
      ...fs.readdirSync(path.join(root, 'lib')).filter((n) => /^better-.*\.md$/.test(n)).map((n) => `lib/${n}`),
      'lib/remediation-agent-template.md',
    ];
    for (const file of files) {
      const body = read(file);
      assert.doesNotMatch(body, /ISSUE_MODE|plan-id-format|Rejected reframings|- \[x\]|\[<slug>\]/, file);
      assert.doesNotMatch(body, /\bissue mode\b/i, file);
      // PLAN.md may only appear in the removal/deprecation messages themselves.
      for (const line of body.split('\n').filter((l) => l.includes('PLAN.md'))) {
        assert.match(line, /PLAN\.md mode was removed|Never write PLAN\.md as a fallback/, `${file}: ${line}`);
      }
      const hint = body.match(/^argument-hint: .*$/m);
      if (hint) assert.doesNotMatch(hint[0], /--issues\b(?!-label)|--no-issues/, file);
    }
    for (const file of ['lib/better-options.md', 'commands/do/depfree.md']) {
      const body = read(file);
      assert.ok(body.includes('`--issues is now the default (PLAN.md mode was removed); the flag can be dropped.`'), file);
      assert.ok(body.includes("`--no-issues is no longer supported: PLAN.md mode was removed. slashdo records work only in the project's issue tracker.`"), file);
    }
  });
});
