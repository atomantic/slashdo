'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const scan = fs.readFileSync(path.join(__dirname, '..', 'commands', 'do', 'scan.md'), 'utf8');
const i9 = scan.slice(scan.indexOf('### I9 — `--report-path` validation'), scan.indexOf('\n## Argument parsing'));
const phase0a = scan.slice(scan.indexOf('### 0a: Resolve scan target and validate report path'), scan.indexOf('\n### 0b:'));

describe('/do:scan report path safety', () => {
  it('selects a free path for both default and explicit reports', () => {
    assert.match(i9, /default date-based path and an explicit `--report-path` alike/);
    assert.match(i9, /`-1`, `-2`, \.\.\. `-100`/);
    assert.match(i9, /never overwrite an earlier report/);
    assert.match(phase0a, /Apply Invariant \*\*I9\*\* to either candidate/);
    assert.match(phase0a, /Record the selected free path as `REPORT_PATH` before scanning/);
  });
});

describe('/do:scan advisory applicability', () => {
  it('requires an exact selected version and vulnerable-range match', () => {
    const lookup = scan.slice(scan.indexOf('2. **Vulnerability lookup**'), scan.indexOf('\n\n3. **Heuristic flags**'));
    assert.match(lookup, /match by package name alone is \*\*not\*\* evidence/);
    assert.match(lookup, /resolve the exact selected version from the lockfile/);
    assert.match(lookup, /compare it with `vulnerable_version_range` using that ecosystem's version semantics/);
    assert.match(lookup, /only when the exact selected version is confidently inside the vulnerable range/);
    assert.match(lookup, /UNKNOWN — advisory applicability could not be determined/);
    assert.match(lookup, /`patched_versions` can corroborate the range but cannot replace the selected-version check/);
  });
});
