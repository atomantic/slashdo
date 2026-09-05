'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildPromptBundle, transformCommand, transformLib } = require('../src/transformer');

function libraries(t, contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slashdo-bundle-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [name, body] of Object.entries(contents)) fs.writeFileSync(path.join(dir, name), body);
  return dir;
}

test('deferred bundles keep nested and cyclic phase reads outside initial context', t => {
  const dir = libraries(t, {
    'phase.md': 'PHASE_BODY\r\n!read lib/detail.md\r\nSee [shared](./shared.md).',
    'detail.md': 'DETAIL_BODY\n!read lib/phase.md',
    'shared.md': 'SHARED_BODY',
  });
  const source = 'When auditing:\n!read lib/phase.md\nAgain: `lib/phase.md`.';
  const bundle = buildPromptBundle(source, dir);
  assert.deepEqual(Object.keys(bundle.files), ['phase.md', 'detail.md', 'shared.md']);
  assert.match(bundle.body, /Read `lib\/phase.md`/);
  assert.doesNotMatch(bundle.body, /PHASE_BODY|DETAIL_BODY|SHARED_BODY|!read/);
  assert.match(bundle.files['phase.md'], /Read `.\/detail.md`/);
  assert.match(bundle.files['phase.md'], /\.\/shared.md/);
  assert.match(bundle.files['detail.md'], /Read `.\/phase.md`/);
  assert.doesNotMatch(bundle.files['phase.md'], /DETAIL_BODY|SHARED_BODY/);
  assert.deepEqual(buildPromptBundle(source, dir), bundle, 'output is deterministic');
});

test('eager bundles resolve direct and cited cycles once and preserve shell dollar tokens', t => {
  const literals = '$& $$ $1 $` $\' ${VALUE} $(command)';
  const dir = libraries(t, {
    'phase.md': 'PHASE_BODY\n!`cat ~/.claude/lib/detail.md`\nSee `~/.claude/lib/shared.md`.',
    'detail.md': `DETAIL_BODY ${literals}\n!read lib/phase.md`,
    'shared.md': 'SHARED_BODY\nSee [phase](./phase.md).',
  });
  const bundle = buildPromptBundle('!read lib/phase.md\n!`cat ~/.claude/lib/detail.md`', dir, { defer: false });
  assert.deepEqual(bundle.files, {});
  for (const marker of ['PHASE_BODY', 'DETAIL_BODY', 'SHARED_BODY']) {
    assert.equal(bundle.body.split(marker).length - 1, 1, `${marker} must appear once`);
  }
  assert.ok(bundle.body.includes(literals));
  assert.doesNotMatch(bundle.body, /!read|!`cat|~\/\.claude\/lib\/|`lib\//);
});

test('resolves conditionals before following includes in the body and every child', t => {
  const dir = libraries(t, {
    'phase.md': '<!-- if:teams -->\n!read lib/missing.md\n<!-- else -->\nSOLO_BODY\n<!-- /if:teams -->',
    'teams.md': 'TEAM_BODY',
  });
  const body = '<!-- if:teams -->\n!read lib/teams.md\n<!-- else -->\n!read lib/phase.md\n<!-- /if:teams -->';
  const solo = buildPromptBundle(body, dir);
  assert.deepEqual(Object.keys(solo.files), ['phase.md']);
  assert.equal(solo.files['phase.md'], 'SOLO_BODY\n');
  const team = buildPromptBundle(body, dir, { teams: true });
  assert.deepEqual(Object.keys(team.files), ['teams.md']);
  assert.equal(team.files['teams.md'], 'TEAM_BODY');
});

test('skipIncludes prunes reviewers throughout the graph without reading omitted files', t => {
  const dir = libraries(t, {
    'phase.md': 'PHASE_BODY\n!read lib/omitted.md\n!`cat ~/.claude/lib/omitted.md`\nSee `~/.claude/lib/omitted.md`.',
  });
  for (const defer of [true, false]) {
    const bundle = buildPromptBundle('!read lib/phase.md\n!read lib/omitted.md', dir, {
      skipIncludes: ['omitted'], defer,
    });
    assert.ok(!Object.hasOwn(bundle.files, 'omitted.md'));
    assert.doesNotMatch(JSON.stringify(bundle), /lib\/omitted.md|\.\/omitted.md/);
  }
});

test('required missing or invalid library directives fail clearly at any depth', t => {
  const dir = libraries(t, { 'phase.md': '!read lib/missing.md' });
  for (const defer of [true, false]) {
    assert.throws(() => buildPromptBundle('!read lib/phase.md', dir, { defer }),
      /Missing required slashdo library: missing.md/);
    assert.throws(() => buildPromptBundle('!`cat ~/.claude/lib/missing.md`', dir, { defer }),
      /Missing required slashdo library: missing.md/);
    assert.throws(() => buildPromptBundle('!read lib/../outside.md', dir, { defer }),
      /Invalid slashdo library filename/);
  }
});

test('native command and library targets lower required reads to their runtime paths', t => {
  const dir = libraries(t, { 'phase.md': 'PHASE_BODY' });
  const env = { supportsCatInclusion: true, libPathPrefix: '~/.config/opencode/lib/' };
  for (const transform of [transformCommand, transformLib]) {
    const result = transform('!read lib/phase.md', env, dir);
    assert.match(result, /Read `~\/\.config\/opencode\/lib\/phase.md`/);
    assert.doesNotMatch(result, /!read|PHASE_BODY/);
  }
});

test('generated skills expose the exact bundle and rewrite configuration in child files', t => {
  const dir = libraries(t, { 'phase.md': 'Use ~/.claude/.slashdo-config.json\n!read lib/detail.md', 'detail.md': 'DETAIL_BODY' });
  const files = {};
  const skill = transformCommand('---\ndescription: Example\n---\n!read lib/phase.md', {
    supportsCatInclusion: false, bundlesLibs: true, namespacing: 'directory',
    configPath: '~/.codex/.slashdo-config.json',
  }, dir, 'do/example.md', { files });
  assert.match(skill, /name: "do-example"/);
  assert.match(skill, /Read `lib\/phase.md`/);
  assert.match(files['phase.md'], /~\/\.codex\/\.slashdo-config.json/);
  assert.match(files['phase.md'], /Read `.\/detail.md`/);
  assert.equal(files['detail.md'], 'DETAIL_BODY');
});

test('legacy recipes include explicit dependencies without following see-also graphs', t => {
  const dir = libraries(t, {
    'required.md': 'REQUIRED_BODY\n!read lib/nested.md',
    'nested.md': 'NESTED_BODY',
    'large.md': 'UNRELATED_LARGE_BODY\n!read lib/missing.md',
  });
  const source = '!read lib/required.md\nSee `~/.claude/lib/large.md` and [large](./large.md).';
  const bundle = buildPromptBundle(source, dir, { defer: false, followReferences: false });
  assert.deepEqual(bundle.files, {});
  assert.match(bundle.body, /REQUIRED_BODY/);
  assert.match(bundle.body, /NESTED_BODY/);
  assert.doesNotMatch(bundle.body, /UNRELATED_LARGE_BODY|lib\/|!read/);
  const deferred = buildPromptBundle(source, dir, { followReferences: false });
  assert.deepEqual(Object.keys(deferred.files), ['required.md', 'nested.md']);
  assert.match(deferred.body, /Read `lib\/required.md`/);
  const bareCitation = buildPromptBundle('See `lib/large.md`.', dir, { defer: false });
  assert.deepEqual(bareCitation, { body: 'See `large`.', files: {} });
});
