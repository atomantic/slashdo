'use strict';

// One structural check for every command, in place of per-command "ships X"
// pins: every include and citation resolves to a real file, and the bundle
// buildPromptBundle produces is exactly the transitive closure of those
// references. Adding, renaming or removing a lib file needs no edit here; a
// reference that dangles, or a reachable lib the bundle drops, fails for
// whichever command reaches it.
//
// The reference grammar below is the documented source syntax (CONTRIBUTING.md,
// "Embedding command prompts"), read independently of src/transformer.js so the
// renderer is checked against it rather than against itself.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  buildPromptBundle, parseFrontmatter, applyConditionalBlocks, DEFERRED_LIBS,
} = require('../src/transformer');

const ROOT = path.join(__dirname, '..');
const LIB_DIR = path.join(ROOT, 'lib');
const COMMAND_DIR = path.join(ROOT, 'commands', 'do');
const libExists = (name) => fs.existsSync(path.join(LIB_DIR, name));
const NAME = '[A-Za-z0-9._-]+\\.md';
// An executable lib asset (a shell script) is cited only by its installed path and
// always ships as a file; it has no references of its own to follow.
const ASSET = '[A-Za-z0-9._-]+\\.sh';
const ASSET_PREFIX = '/installed/skill/lib/';

// Each reference form, and whether it inlines the lib (an eager `!cat` of a lib
// that is not on a conditional path) or delivers it as a bundled file. The
// sibling-link and bare-backtick forms can also name a non-slashdo doc, so they
// count only when such a lib exists — the same rule the renderer applies.
const FORMS = [
  { re: /!`cat ~\/\.claude\/lib\/([^`\s]+)[^`]*`/g, kind: (name) => (DEFERRED_LIBS.has(name) ? 'file' : 'inline') },
  { re: /^[ \t]*!read lib\/(\S+)[ \t]*\r?$/gm, kind: () => 'file' },
  { re: new RegExp(`~/\\.claude/lib/(${NAME})`, 'g'), kind: () => 'file' },
  { re: new RegExp(`~/\\.claude/lib/(${ASSET})(?![A-Za-z0-9._-])`, 'g'), kind: () => 'file' },
  { re: new RegExp(`\\[[^\\]]*\\]\\((?:\\.\\./)+lib/(${NAME})\\)`, 'g'), kind: () => 'file' },
  { re: new RegExp(`\\[[^\\]]*\\]\\(\\./(${NAME})\\)`, 'g'), kind: () => 'file', ifExists: true },
  { re: new RegExp(`\`lib/(${NAME})\``, 'g'), kind: () => 'file', ifExists: true },
];
const COMMAND_CITATION = new RegExp(`~/\\.claude/commands/do/(${NAME})`, 'g');

function references(text, teams) {
  const resolved = applyConditionalBlocks(text, { supportsTeams: teams });
  const refs = [];
  for (const { re, kind, ifExists } of FORMS) {
    for (const [, name] of resolved.matchAll(re)) {
      if (ifExists && !libExists(name)) continue;
      refs.push({ name, kind: kind(name) });
    }
  }
  return refs;
}

// Walk every reference from the command body through the libs it reaches.
function closure(body, teams, label) {
  const reached = new Map(); // lib -> Set of kinds it is reached by
  const queue = [[body, label]];
  while (queue.length) {
    const [text, from] = queue.shift();
    for (const { name, kind } of references(text, teams)) {
      assert.ok(libExists(name), `${from} references lib/${name}, which does not exist`);
      if (!reached.has(name)) {
        reached.set(name, new Set());
        if (name.endsWith('.md')) queue.push([fs.readFileSync(path.join(LIB_DIR, name), 'utf8'), `lib/${name}`]);
      }
      reached.get(name).add(kind);
    }
  }
  return reached;
}

const commands = fs.readdirSync(COMMAND_DIR).filter((name) => name.endsWith('.md')).sort();

describe('every command bundle is the closure of its references', () => {
  it('finds commands to check', () => assert.ok(commands.length > 0));

  for (const command of commands) {
    for (const teams of [false, true]) {
      it(`${command} (teams: ${teams})`, () => {
        const { body } = parseFrontmatter(fs.readFileSync(path.join(COMMAND_DIR, command), 'utf8'));
        const reached = closure(body, teams, `commands/do/${command}`);
        const bundle = buildPromptBundle(body, LIB_DIR, { teams, defer: true, assetPathPrefix: ASSET_PREFIX });
        const files = new Set(Object.keys(bundle.files));
        const inlined = [...reached].filter(([, kinds]) => kinds.has('inline')).map(([name]) => name);

        // Nothing in the bundle that no reference reaches...
        assert.deepEqual([...files].filter((name) => !reached.has(name)), [],
          `${command} bundles libs none of its references reach`);
        // ...and every reached lib delivered: bundled as a file, or inlined by an eager include.
        assert.deepEqual(
          [...reached.keys()].filter((name) => !files.has(name) && !inlined.includes(name)), [],
          `${command} reaches libs its bundle neither includes nor inlines`);
        // A `!read` or a conditional-path include is always a file, never dropped
        // because its content happened to be inlined elsewhere.
        assert.deepEqual(
          [...reached].filter(([name, kinds]) => kinds.has('file') && !kinds.has('inline') && !files.has(name))
            .map(([name]) => name), [],
          `${command} drops libs that are only ever cited or read`);

        // Every path the bundle emits resolves to a file it ships.
        const emitted = [
          ...[...bundle.body.matchAll(new RegExp(`\`lib/(${NAME})\``, 'g'))].map((m) => m[1]),
          ...Object.values(bundle.files).flatMap((text) =>
            [...text.matchAll(new RegExp(`\`\\./(${NAME})\`|\\]\\(\\./(${NAME})\\)`, 'g'))].map((m) => m[1] || m[2])),
        ];
        assert.deepEqual([...new Set(emitted)].filter((name) => !files.has(name)), [],
          `${command} emits references to files its bundle does not ship`);

        // An asset is cited at the host-supplied prefix, shipped byte for byte, and
        // never left behind as an unresolved ~/.claude path.
        const texts = [bundle.body, ...Object.values(bundle.files)];
        for (const text of texts) assert.doesNotMatch(text, new RegExp(`~/\\.claude/lib/${ASSET}`));
        const assetRefs = texts.flatMap((text) =>
          [...text.matchAll(new RegExp(`${ASSET_PREFIX.replace(/\//g, '\\/')}(${ASSET})`, 'g'))].map((m) => m[1]));
        for (const name of assetRefs) {
          assert.ok(files.has(name), `${command} cites asset ${name} without shipping it`);
          assert.equal(bundle.files[name], fs.readFileSync(path.join(LIB_DIR, name), 'utf8'), `${name} ships verbatim`);
        }
        for (const name of [...files].filter((file) => file.endsWith('.sh'))) {
          assert.ok(assetRefs.includes(name), `${command} ships asset ${name} nothing cites`);
        }
      });
    }
  }
});

describe('every command citation resolves', () => {
  for (const [dir, label] of [[COMMAND_DIR, 'commands/do'], [LIB_DIR, 'lib']]) {
    for (const name of fs.readdirSync(dir).filter((file) => file.endsWith('.md')).sort()) {
      it(`${label}/${name}`, () => {
        for (const [, cited] of fs.readFileSync(path.join(dir, name), 'utf8').matchAll(COMMAND_CITATION)) {
          assert.ok(fs.existsSync(path.join(COMMAND_DIR, cited)),
            `${label}/${name} cites ~/.claude/commands/do/${cited}, which does not exist`);
        }
      });
    }
  }
});
