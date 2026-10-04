const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), 'utf8');

describe('label color table guidance (#437)', () => {
  const setup = read('lib', 'plan-issue-setup.md');
  const replan = read('commands', 'do', 'replan.md');

  it('renders label colors as whole gh label create commands with --color', () => {
    assert.match(setup, /gh label create <PLAN_LABEL> --color 428BCA/);
    assert.match(setup, /gh label create <category> --color 0366D6/);

    // Severity
    assert.match(setup, /gh label create severity\$\{LABEL_SEP\}critical --color B60205/);
    assert.match(setup, /gh label create severity\$\{LABEL_SEP\}high --color D93F0B/);
    assert.match(setup, /gh label create severity\$\{LABEL_SEP\}medium --color FBCA04/);
    assert.match(setup, /gh label create severity\$\{LABEL_SEP\}low --color 0E8A16/);

    // Model
    assert.match(setup, /gh label create model\$\{LABEL_SEP\}light --color D4C5F9/);
    assert.match(setup, /gh label create model\$\{LABEL_SEP\}medium --color A371F7/);
    assert.match(setup, /gh label create model\$\{LABEL_SEP\}heavy --color 6F42C1/);

    // Effort
    assert.match(setup, /gh label create effort\$\{LABEL_SEP\}low --color BFE5E5/);
    assert.match(setup, /gh label create effort\$\{LABEL_SEP\}medium --color 76C7C7/);
    assert.match(setup, /gh label create effort\$\{LABEL_SEP\}high --color 1D7874/);
    assert.match(setup, /gh label create effort\$\{LABEL_SEP\}xhigh --color 0E4F4C/);
    assert.match(setup, /gh label create effort\$\{LABEL_SEP\}max --color 05403D/);
  });

  it('renders replan label creation with explicit --color', () => {
    assert.match(replan, /gh label create <PLAN_LABEL> --color 428BCA --description "Tracked by \/do:replan"/);
    assert.match(replan, /gh label create drift --color E8A33D/);
  });

  it('does not present label names and hex codes as adjacent prose tokens outside --color', () => {
    const files = [
      path.join('lib', 'plan-issue-setup.md'),
      path.join('commands', 'do', 'replan.md'),
      path.join('commands', 'do', 'plan-task.md'),
      path.join('commands', 'do', 'next.md'),
    ];

    const barePairPatterns = [
      /`PLAN_LABEL`:\s*`428BCA`/,
      /`model`:\s*light\s*`?D4C5F9`?/,
      /`effort`:\s*low\s*`?BFE5E5`?/,
      /category:\s*`?0366D6`?/,
      /critical\s+`?B60205`?/,
    ];

    for (const rel of files) {
      const content = read(rel);
      for (const pattern of barePairPatterns) {
        assert.doesNotMatch(content, pattern, `${rel} pairs label name and hex without --color (${pattern})`);
      }
    }
  });
});
