'use strict';

// The review lenses and the shared review preferences state a mandate, a few
// principles, and the output contract the orchestrator parses — not catalogs of
// bug shapes a capable model already knows. These tests keep the catalogs from
// growing back and pin the parts other files depend on.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const LENSES = [
  'review-surface-scan',
  'review-surface-quality',
  'review-security-audit',
  'review-cross-file-tracing',
  'review-cross-file-contract',
  'review-structural-ambition',
];
const CATALOG_SECTIONS = /^## (How to think|Hot patterns|Past misses|Reading strategy|Tone|Missed Code-Judo Opportunities)\b/m;

describe('review lens files', () => {
  for (const lens of LENSES) {
    it(`${lens} is a mandate, at most three principles, and its output contract`, () => {
      const body = read(`lib/${lens}.md`);
      // Structural Ambition also carries its presumptive-blocker rules.
      const budget = lens === 'review-structural-ambition' ? 2400 : 1500;
      assert.ok(Buffer.byteLength(body) <= budget, `${lens} is ${Buffer.byteLength(body)} bytes (budget ${budget})`);
      assert.doesNotMatch(body, CATALOG_SECTIONS);
      assert.match(body, /^## Mandate$/m);
      assert.match(body, /^## Output [Ff]ormat$/m);
      assert.match(body, /^file:line — \[[A-Z|-]+\] description$/m);
      const principles = body.match(/^## Principles\n([\s\S]*?)(?=^## )/m);
      assert.ok(principles, `${lens} has a Principles section`);
      const count = principles[1].split('\n').filter((line) => line.startsWith('- ')).length;
      assert.ok(count >= 1 && count <= 3, `${lens} has ${count} principles`);
    });
  }

  it('keeps the structural presumptive blockers that strict-mode promotion names', () => {
    const body = read('lib/review-structural-ambition.md');
    const blockers = body.match(/^## Presumptive Blockers\n([\s\S]*?)(?=^## )/m);
    assert.ok(blockers, 'Presumptive Blockers section is present');
    for (const name of ['File-size growth', 'Spaghetti growth', 'Thin wrappers', 'Boundary leaks', 'Bespoke duplicates']) {
      assert.match(blockers[1], new RegExp(`^- \\*\\*${name}`, 'm'), `missing blocker: ${name}`);
    }
    assert.match(body, /\[BLOCKER\|IMPROVEMENT\|UNCERTAIN\]/);
  });

  it('assigns accessibility to the runtime lens', () => {
    assert.match(read('lib/review-surface-scan.md').match(/^## Mandate\n(.*)$/m)[1], /inaccessible by keyboard or assistive technology/);
  });

  it('does not point lens selection at a checklist /do:review never loads', () => {
    assert.doesNotMatch(read('lib/review-agent-selection.md'), /review checklist/);
    assert.doesNotMatch(read('lib/post-review-doc-recommendations.md'), /review checklists?/);
  });
});

describe('shared review preferences', () => {
  it('replaces the tiered checklist with a short preferences partial', () => {
    assert.ok(!fs.existsSync(path.join(root, 'lib/code-review-checklist.md')));
    const body = read('lib/review-preferences.md');
    assert.ok(Buffer.byteLength(body) <= 1600, `review-preferences.md is ${Buffer.byteLength(body)} bytes`);
    assert.doesNotMatch(body, /Tier [1-4]/);
    assert.match(body, /\*\*Review logic, not lint\.\*\*/);
    assert.match(body, /every finding must name a concrete wrong outcome/i);
    assert.match(body, /Quote the code line/);
    for (const severity of ['CRITICAL', 'IMPROVEMENT', 'UNCERTAIN']) assert.match(body, new RegExp(`\\*\\*${severity}\\*\\*`));
  });

  it('is what /do:pr, /do:fpr, /do:release, and the better pipeline load', () => {
    for (const file of ['commands/do/pr.md', 'commands/do/fpr.md']) {
      const body = read(file);
      assert.match(body, /^!`cat ~\/\.claude\/lib\/review-preferences\.md`$/m, file);
      assert.doesNotMatch(body, /Tiers? [1-4]/, `${file} still cites checklist tiers`);
    }
    const release = read('commands/do/release.md');
    assert.match(release, /^[ \t]*!read lib\/review-preferences\.md$/m);
    assert.doesNotMatch(release, /Tiers? [1-4]/);
    assert.match(read('lib/better-pipeline-inputs.md'), /^!read lib\/review-preferences\.md$/m);
  });

  it('leaves no reference to the removed checklist', () => {
    const files = [
      ...fs.readdirSync(path.join(root, 'commands/do')).map((name) => `commands/do/${name}`),
      ...fs.readdirSync(path.join(root, 'lib')).map((name) => `lib/${name}`),
      ...fs.readdirSync(path.join(root, 'src')).map((name) => `src/${name}`),
      'install.sh',
      'uninstall.sh',
      'README.md',
      '.claude/commands/improve/review.md',
    ];
    for (const file of files) assert.doesNotMatch(read(file), /code-review-checklist/, file);
  });
});
