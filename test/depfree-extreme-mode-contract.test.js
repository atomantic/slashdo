'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

// `--extreme` is the one depfree mode that raises the MODEL tier as well as the
// removal bar. The file states that twice (the "three unrelated things" note and
// the Configuration section); an edit that drops either half quietly turns an
// extreme run back into a heavy run on a cheap model — the exact failure the
// mode exists to prevent. These pins read the contract, not the prose around it.
describe('depfree --extreme contract', () => {
  const depfree = read('commands', 'do', 'depfree.md');

  it('advertises the flag and derives an ordered mode from it', () => {
    const hint = depfree.match(/^argument-hint: .*$/m)[0];
    assert.match(hint, /\[--heavy\|--extreme\]/);
    assert.match(depfree, /Set `DEPFREE_MODE` to `extreme` if `--extreme` was passed, else `heavy` if `--heavy` was passed, else `default`/);
    // Extreme is a superset of heavy: every HEAVY_MODE rule must keep applying.
    assert.match(depfree, /Set `HEAVY_MODE` to `true` when `DEPFREE_MODE` is `heavy` or `extreme`/);
    assert.match(depfree, /Modes are ordered `default` < `heavy` < `extreme`/);
  });

  it('forces the strongest model tier at max effort, and says heavy alone does not', () => {
    assert.match(depfree, /`--extreme` \*\*forces the Quality profile\*\*: `AUDIT_MODEL_TIER=heavy`, `REMEDIATION_MODEL_TIER=heavy`, and reasoning effort `max`/);
    assert.match(depfree, /`--heavy` does \*not\* raise the model tier\. `--extreme` is the exception/);
    // Interactive runs must not be offered a cheaper profile under --extreme.
    assert.match(depfree, /Under `--interactive --extreme`, skip the model-profile question/);
    // Remediation and the parity review both dispatch at the heavy tier.
    assert.match(depfree, /at most 3 agents in flight, one package .* per agent, every agent at `REMEDIATION_MODEL_TIER=heavy` with effort `max`/);
    assert.match(depfree, /dispatch this review to a second `heavy`-tier agent \(effort `max`\)/);
    // The tier vocabulary stays tiers (lib/model-tiers.md); no pinned vendor IDs.
    assert.doesNotMatch(depfree, /claude-(?:opus|sonnet|haiku)-\d/);
  });

  it('replaces the size ceiling with a parity gate and never skips silently', () => {
    assert.match(depfree, /^2\. \*\*No line ceiling\.\*\*/m);
    assert.match(depfree, /fails against a stub and passes against the owned code/);
    assert.match(depfree, /^3\. \*\*Design before code/m);
    assert.match(depfree, /^6\. \*\*Nothing is silently skipped\.\*\*/m);
    assert.match(depfree, /`SKIPPED_INFEASIBLE` \*\*with a design sketch and a filed tracker issue\*\*/);
    // The remediation brief must carry the same gate, or agents never see it.
    assert.match(depfree, /In `EXTREME_MODE` there is no size ceiling/);
    assert.match(depfree, /`EXTREME_MODE` parity gate \(Extreme Mode rules 2–3\)/);
  });

  it('keeps the security-sensitive classes out of reach', () => {
    const rule1 = depfree.slice(depfree.indexOf('## Extreme Mode (`--extreme`)'), depfree.indexOf('## Compaction Guidance'));
    for (const kept of ['TLS', 'cryptographic primitives', 'database wire protocols with authentication', 'Native bindings', 'required by CI']) {
      assert.ok(rule1.includes(kept), `extreme Tier 1 must still keep: ${kept}`);
    }
    // ...while large general-purpose libraries are explicitly candidates.
    assert.match(rule1, /A \*\*web framework\*\* \(express, fastify, koa, hono\) .* is a candidate/);
  });

  it('records the mode in DEPS.md on the strictness order', () => {
    assert.match(depfree, /`mode`: the mode the decision was made under \(`default`, `heavy`, `extreme`, or the legacy `both`, which reads as `heavy`\)/);
    assert.match(depfree, /an `extreme` decision skips any run/);
    assert.match(depfree, /Under `EXTREME_MODE`, the decision is not `SKIPPED_INFEASIBLE`/);
    assert.match(depfree, /never downgrade an `extreme` row to `heavy`/);
    assert.match(depfree, /HEAVY_SUFFIX=" \(extreme mode\)"/);
  });

  it('is documented where users look for flags', () => {
    assert.match(read('README.md'), /`--extreme` for a zero-dependency pass/);
    assert.match(read('commands', 'do', 'help.md'), /`--extreme` for zero-dependency mode/);
  });
});
