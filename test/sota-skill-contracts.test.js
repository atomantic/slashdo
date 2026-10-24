'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

describe('SOTA skill contracts (#478-#483)', () => {
  it('guards parallel single-worktree remediation against index races and sibling build noise (#478)', () => {
    const remediation = read('lib', 'better-remediation.md');
    const template = read('lib', 'remediation-agent-template.md');
    const depfree = read('commands', 'do', 'depfree.md');
    const rpr = read('commands', 'do', 'rpr.md');

    assert.match(remediation, /git commit --only -m "<subject>" -- <owned-files>/);
    assert.match(template, /git commit --only -m "<subject>" -- <owned-files>/);
    assert.match(template, /sibling worker's in-progress edit/);
    assert.match(depfree, /git commit --only -m "refactor: replace \{package\} with owned \{utility\/code\}" -- <owned-files>/);
    assert.match(rpr, /group unresolved threads by file/);
    assert.match(rpr, /never spawn two parallel agents that edit the same file/);
    assert.match(rpr, /After all thread-fixing agents return, run one additional `Agent` call \(or inline pass\) for an \*\*independent code quality review\*\*/);
  });

  it('registers new owned files before path-scoped commits while preserving sibling staging', () => {
    for (const parts of [
      ['lib', 'remediation-agent-template.md'],
      ['lib', 'better-remediation.md'],
      ['commands', 'do', 'depfree.md'],
    ]) {
      const instructions = read(...parts);
      const stage = instructions.indexOf('git add -- <new-owned-files>');
      const commit = instructions.indexOf('git commit --only');
      assert.ok(stage >= 0 && stage < commit, `${parts.join('/')} must register new files first`);
    }

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slashdo-owned-commit-'));
    const git = (...args) => execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], {
      cwd: dir, encoding: 'utf8',
    }).trim();
    try {
      git('init', '--quiet');
      git('config', 'user.name', 'Regression test');
      git('config', 'user.email', 'test@example.invalid');
      fs.writeFileSync(path.join(dir, 'sibling.txt'), 'baseline\n');
      git('add', '--', 'sibling.txt');
      git('commit', '--quiet', '-m', 'baseline');
      fs.writeFileSync(path.join(dir, 'sibling.txt'), 'sibling work\n');
      git('add', '--', 'sibling.txt');
      fs.writeFileSync(path.join(dir, 'owned.txt'), 'new owned utility\n');
      git('add', '--', 'owned.txt');
      git('commit', '--only', '--quiet', '-m', 'owned fix', '--', 'owned.txt');
      assert.equal(git('show', '--format=', '--name-only', 'HEAD'), 'owned.txt');
      assert.equal(git('diff', '--cached', '--name-only'), 'sibling.txt');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('preserves Phase 3b Foundation files on per-category branches and removes audit version bumps (#479)', () => {
    const prAndCi = read('lib', 'better-pr-and-ci.md');
    const betterInputs = read('lib', 'better-pipeline-inputs.md');
    const swiftInputs = read('lib', 'swift-pipeline-inputs.md');
    const discovery = read('lib', 'better-discovery.md');

    assert.match(prAndCi, /Phase 3b Foundation commit on `\{BRANCH_PREFIX\}\/\{DATE\}`/);
    assert.match(prAndCi, /File isolation & Foundation preservation/);
    assert.match(prAndCi, /### 5b: No Version Bump in Audit PRs/);
    assert.match(prAndCi, /Never bump package or manifest versions/);
    assert.doesNotMatch(prAndCi, /VERSION_BUMP_SECTION/);
    assert.doesNotMatch(betterInputs, /VERSION_BUMP_SECTION/);
    assert.doesNotMatch(swiftInputs, /VERSION_BUMP_SECTION/);
    assert.doesNotMatch(discovery, /HAS_VERSION_BUMP/);
  });

  it('scopes PR review fixes to PR-impacted code and makes convention encoding conservative (#480)', () => {
    const disposition = read('lib', 'finding-disposition.md');
    const rpr = read('commands', 'do', 'rpr.md');
    const hostLoop = read('lib', 'host-reviewer-loop.md');
    const conventions = read('lib', 'review-fix-conventions.md');

    assert.match(disposition, /lives in a file touched by the current PR\/branch/);
    assert.match(disposition, /pre-existing issue in an untouched, unrelated file\/subsystem/);
    assert.doesNotMatch(rpr, /regardless of whether the current PR touched that code/);
    assert.match(rpr, /confirmed pre-existing issue in an untouched, unrelated file, defer and file it as a tracker issue/);
    assert.doesNotMatch(hostLoop, /regardless of\s+whether the current \{CR_NOUN\} modified that code/);
    assert.match(hostLoop, /confirmed pre-existing issue in an untouched,\s+unrelated file, defer it to a tracker issue/);
    assert.match(conventions, /\*\*Default to `No conventions encoded`\*\*/);
    assert.match(conventions, /never append one-off bug lessons to `CLAUDE\.md` or `AGENTS\.md`/);
  });

  it('keeps /do:replan from auto-closing likely-done and stale issues in Default mode (#481)', () => {
    const replan = read('commands', 'do', 'replan.md');
    const jira = read('lib', 'tracker-jira.md');

    assert.match(replan, /\| `likely-done` \|[^|]+\| \*\*Never auto-close in Default mode\*\*/);
    assert.match(replan, /\| `stale` \|[^|]+\| \*\*Never auto-close in Default mode\*\*/);
    assert.match(replan, /only `confirmed-done` and `epic-done` are auto-closed in Default mode; `likely-done`, `stale`, and `drifted` items are never auto-closed without human confirmation/);
    assert.doesNotMatch(replan, /`confirmed-done` \/ `likely-done` → \*\*close\*\*/);
    assert.match(jira, /In Default mode, `likely-done` and `stale` are commented with `issue_comment` and labeled/);
  });

  it('restrains default-mode parser rewrites in /do:depfree and bounds WebFetch in /do:scan (#482)', () => {
    const depfree = read('commands', 'do', 'depfree.md');
    const scan = read('commands', 'do', 'scan.md');

    assert.match(depfree, /Default-mode restraint on complex parsers\/validators/);
    assert.match(depfree, /reserve hand-rolled parser\/validator modules for `--heavy` and `--extreme`/);
    assert.match(scan, /at most 25 direct dependencies/);
    assert.match(scan, /INCOMPLETE — rate-limit budget reached/);
    assert.match(scan, /`stat`\/`wc -c` size/);
    assert.doesNotMatch(scan, /forbids byte-dump readers \(`head -c`, `cat`, `wc`\)/);
  });

  it('warns against cross-call cwd persistence assumptions in /do:next and condenses verification prompt rules (#483)', () => {
    const next = read('commands', 'do', 'next.md');
    const verification = read('lib', 'better-verification.md');

    assert.doesNotMatch(next, /only the working directory does/);
    assert.match(next, /Neither shell variables nor `cd` working-directory changes are guaranteed to persist across separate Bash tool calls on all harnesses/);
    assert.match(next, /`cd "\$WORKTREE"` at the start of every subsequent Bash tool call/);
    assert.match(verification, /\*\*Placeholder substitution:\*\* omit any line whose sole token is empty/);
  });
});
