'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildPromptBundle } = require('../src/transformer');

const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const policy = read('lib/depfree-policy.md');
// Execute the actual procedure shipped to command hosts, not a test-side matcher.
const source = policy.match(/```javascript\n([\s\S]*?)\n```/)[1];
const { readDepfreeDefaults, resolveDepfreeAllow, depfreePolicyDecision } =
  new Function('require', `${source}\nreturn { readDepfreeDefaults, resolveDepfreeAllow, depfreePolicyDecision };`)(require);
const defaults = entries => ({ 'depfree-allow': entries });
const depfree = read('commands/do/depfree.md');
const config = read('commands/do/config.md');

describe('dependency policy procedure', () => {
  it('loads both config scopes and unions exact names and scope/prefix globs', t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slashdo-depfree-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const globalFile = path.join(dir, 'global.json');
    const projectFile = path.join(dir, '.slashdo.json');
    fs.writeFileSync(globalFile, JSON.stringify({ defaults: defaults(['@aws-sdk/*', 'pg']) }));
    fs.writeFileSync(projectFile, JSON.stringify({ defaults: defaults(['pg', 'prefix-*']) }));
    const allow = resolveDepfreeAllow(readDepfreeDefaults(globalFile), readDepfreeDefaults(projectFile));
    assert.deepEqual(allow, ['@aws-sdk/*', 'pg', 'prefix-*']);
    for (const name of ['@aws-sdk/client-s3', '@aws-sdk/credential-providers', 'pg', 'prefix-utils']) {
      assert.equal(depfreePolicyDecision(name, allow).recommendation, 'KEEP');
    }
    assert.equal(depfreePolicyDecision('chalk', allow), null);
    fs.writeFileSync(projectFile, JSON.stringify({ defaults: defaults([]) }));
    assert.deepEqual(resolveDepfreeAllow(readDepfreeDefaults(globalFile), readDepfreeDefaults(projectFile)), ['@aws-sdk/*', 'pg']);
  });

  it('dedupes without mutating either source and cannot mask global policy', () => {
    const global = defaults(Object.freeze(['pg', '@aws-sdk/*']));
    const project = defaults(Object.freeze([' pg ', 'prefix-*', 'prefix-*']));
    assert.deepEqual(resolveDepfreeAllow(global, project), ['pg', '@aws-sdk/*', 'prefix-*']);
    for (const empty of [{}, defaults([])]) {
      assert.deepEqual(resolveDepfreeAllow(global, empty), ['pg', '@aws-sdk/*']);
    }
    assert.deepEqual(resolveDepfreeAllow({}, {}), []);
  });

  it('anchors exact and glob matches and treats regex metacharacters literally', () => {
    const allow = ['pg', '@aws-sdk/*', 'prefix-*', 'lib.js', 'a+b', 'pkg[1]', 'x?y'];
    for (const name of ['pg-native', 'xpg', 'PG', 'other/@aws-sdk/client-s3', '@aws-sdkx/client-s3', 'other-prefix-utils', 'libXjs', 'aaab', 'pkg1', 'xy']) {
      assert.equal(depfreePolicyDecision(name, allow), null, name);
    }
    for (const name of ['prefix-', 'lib.js', 'a+b', 'pkg[1]', 'x?y']) {
      assert.equal(depfreePolicyDecision(name, allow).recommendation, 'KEEP', name);
    }
    assert.equal(depfreePolicyDecision('any-package', ['*']).policy_pattern, '*');
  });

  for (const mode of ['default', 'heavy', 'extreme']) {
    it(`keeps policy matches before the ${mode} audit rules`, () => {
      const classification = depfree.slice(depfree.indexOf('### 1b:'), depfree.indexOf('### 1c:'));
      assert.ok(classification.indexOf('depfreePolicyDecision(packageName, DEPFREE_ALLOW)') < classification.indexOf('check `PRIOR_DECISIONS`'));
      assert.match(classification, /skip all remaining tier\/removal rules and Phase 1c/);
      assert.ok(classification.includes(`This applies in default, heavy, and extreme modes`));
      // The procedure has no mode override: even the SDK from the issue stays KEEP.
      assert.deepEqual(depfreePolicyDecision('@aws-sdk/client-s3', resolveDepfreeAllow(defaults(['@aws-sdk/*']), {})), {
        decision: 'KEPT_POLICY', recommendation: 'KEEP', reason: 'policy allowlist',
        policy_pattern: '@aws-sdk/*', from_policy: true,
      });
    });
  }

  it('rejects malformed policy in either scope rather than dropping allowances', () => {
    for (const invalid of [null, 'pg', {}, [null], [''], ['  '], ['two names'], [4], [{ pattern: 'pg' }]]) {
      assert.throws(() => resolveDepfreeAllow(defaults(invalid), {}), /global depfree-allow/);
      assert.throws(() => resolveDepfreeAllow(defaults(['pg']), defaults(invalid)), /project depfree-allow/);
    }
  });

  it('distinguishes missing config from corrupt or unreadable config', t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slashdo-depfree-invalid-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'config.json');
    assert.deepEqual(readDepfreeDefaults(file), {});
    fs.writeFileSync(file, '{}');
    assert.deepEqual(readDepfreeDefaults(file), {});
    for (const invalid of ['{oops', '[]', 'null', '{"defaults":[]}', '{"defaults":null}']) {
      fs.writeFileSync(file, invalid);
      assert.throws(() => readDepfreeDefaults(file));
    }
    assert.throws(() => readDepfreeDefaults(dir));
  });

  it('stops keeping a package when current policy no longer matches', () => {
    assert.equal(depfreePolicyDecision('pg', ['pg']).decision, 'KEPT_POLICY');
    assert.equal(depfreePolicyDecision('pg', resolveDepfreeAllow({}, {})), null);
    assert.match(depfree, /The decision is not `KEPT_POLICY`/);
    assert.match(depfree, /excluding old `KEPT_POLICY` rows and entries superseded by current policy/);
  });
});

describe('dependency policy workflow integration', () => {
  it('preserves usage exclusion, vulnerability reporting, and transitive accounting', () => {
    assert.match(depfree, /Skip any dependency with `from_policy: true` or `from_prior: true`/);
    assert.match(depfree, /Exclude `from_policy: true` from REMOVE, EVALUATE, deferred findings, and remediation/);
    assert.match(policy, /whole-tree vulnerability audit and Phase 1d/);
    assert.match(depfree, /record their transitive footprint, even when there are no REMOVE candidates/);
    assert.match(depfree, /Tier 1 under Extreme Mode rule 1 or `from_policy: true`/);
  });

  it('reports current policy in the plan, DEPS.md, and PR summary', () => {
    for (const heading of ['| Policy kept |', '## Kept — Policy allowlist', '### Dependencies Kept']) {
      assert.ok(depfree.includes(heading), heading);
    }
    assert.match(depfree, /including on scan-only and "All dependencies are justified" exits/);
    assert.match(depfree, /these were not usage-audited/);
  });

  it('exposes config set/unset/show and documents the union exception', () => {
    assert.match(config, /\[--depfree-allow <patterns>\]/);
    assert.match(config, /`--depfree-allow <patterns>` → key `depfree-allow`/);
    assert.match(config, /`--unset depfree-allow`/);
    assert.match(config, /depfree-allow\s+= \{global\/project union as JSON array, or \[\]\}/);
    assert.match(read('lib/review-config-defaults.md'), /scalar merge above must never drop global allowances/);
    assert.match(read('docs/config.md'), /@aws-sdk\/\*,pg/);
  });

  it('ships the policy procedure with both audit and config command bundles', () => {
    for (const command of [depfree, config]) {
      assert.match(command, /^!read lib\/depfree-policy\.md$/m);
      const bundle = buildPromptBundle(command, path.join(root, 'lib'));
      assert.match(bundle.files['depfree-policy.md'], /function depfreePolicyDecision/);
      assert.match(bundle.files['depfree-policy.md'], /function resolveDepfreeAllow/);
    }
  });
});
