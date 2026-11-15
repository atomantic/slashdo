'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const policy = read('lib/depfree-policy.md');

// Reference implementation of the procedure lib/depfree-policy.md specifies in
// prose (the prompt is the only specification shipped to hosts, which apply it
// with their file tools). The first describe block checks this implementation
// against the worked-example tables in that file, so the prose examples and the
// rules stay consistent; the second pins the edge cases the prose states.

function readDepfreeDefaults(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
  const config = JSON.parse(text);
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('slashdo config must be an object');
  }
  const defaults = config.defaults === undefined ? {} : config.defaults;
  if (!defaults || typeof defaults !== 'object' || Array.isArray(defaults)) {
    throw new TypeError('slashdo defaults must be an object');
  }
  return defaults;
}

function resolveDepfreeAllow(globalDefaults, projectDefaults) {
  const patterns = (defaults, source) => {
    const value = defaults['depfree-allow'];
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.some(entry =>
      typeof entry !== 'string' || !entry.trim() || /\s/.test(entry.trim()))) {
      throw new TypeError(`${source} depfree-allow must be an array of nonblank package-name patterns`);
    }
    return value.map(entry => entry.trim());
  };
  return [...new Set([
    ...patterns(globalDefaults, 'global'),
    ...patterns(projectDefaults, 'project'),
  ])];
}

// Returns the first matching pattern, or null.
function matchingPattern(packageName, allowlist) {
  const pattern = allowlist.find(entry => {
    const escaped = entry.split('*').map(part =>
      part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    return new RegExp(`^${escaped}$`, 'u').test(packageName);
  });
  return pattern === undefined ? null : pattern;
}

const defaults = entries => ({ 'depfree-allow': entries });

// Rows of the markdown table whose header starts with `firstHeader`, as arrays
// of cell text with surrounding backticks removed.
function tableRows(markdown, firstHeader) {
  const lines = markdown.split('\n');
  const start = lines.findIndex(line => line.startsWith(`| ${firstHeader} |`));
  assert.notEqual(start, -1, `table "${firstHeader}" not found in lib/depfree-policy.md`);
  const rows = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith('|')) break;
    rows.push(line.split('|').slice(1, -1).map(cell => cell.trim().replace(/^`(.*)`$/, '$1')));
  }
  return rows;
}

describe('dependency policy worked examples in lib/depfree-policy.md', () => {
  it('union examples resolve as the table states', () => {
    const rows = tableRows(policy, 'Global');
    assert.ok(rows.length >= 3);
    for (const [globalList, projectList, expected] of rows) {
      assert.deepEqual(
        resolveDepfreeAllow(defaults(JSON.parse(globalList)), defaults(JSON.parse(projectList))),
        JSON.parse(expected),
        `${globalList} + ${projectList}`,
      );
    }
  });

  it('match examples match, or do not, as the table states', () => {
    const rows = tableRows(policy, 'Pattern');
    assert.ok(rows.length >= 8);
    for (const [pattern, name, matches] of rows) {
      assert.ok(['yes', 'no'].includes(matches), `${pattern} / ${name}: ${matches}`);
      assert.equal(matchingPattern(name, [pattern]) !== null, matches === 'yes', `${pattern} / ${name}`);
    }
  });
});

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
    assert.equal(matchingPattern('@aws-sdk/credential-providers', allow), '@aws-sdk/*');
    assert.equal(matchingPattern('chalk', allow), null);
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

  it('treats regex metacharacters in a pattern literally', () => {
    const allow = ['lib.js', 'a+b', 'pkg[1]', 'x?y'];
    for (const name of ['libXjs', 'aaab', 'pkg1', 'xy', 'xpg']) {
      assert.equal(matchingPattern(name, allow), null, name);
    }
    for (const name of allow) {
      assert.equal(matchingPattern(name, allow), name);
    }
  });

  it('stops matching a package once its allowance is gone', () => {
    assert.equal(matchingPattern('pg', ['pg']), 'pg');
    assert.equal(matchingPattern('pg', resolveDepfreeAllow({}, {})), null);
  });

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
});
