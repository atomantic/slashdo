'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  parseFrontmatter,
  rewriteLibPaths,
  inlineLibContent,
  getTargetFilename,
  transformCommand,
  transformLib,
} = require('../src/transformer');

// ── parseFrontmatter ────────────────────────────────────────────────

describe('parseFrontmatter', () => {
  it('parses normal YAML frontmatter', () => {
    const content = '---\ndescription: Hello world\nallowed-tools: foo\n---\nBody text';
    const { frontmatter, body } = parseFrontmatter(content);
    assert.equal(frontmatter.description, 'Hello world');
    assert.equal(frontmatter['allowed-tools'], 'foo');
    assert.equal(body, 'Body text');
  });

  it('strips quotes from frontmatter values', () => {
    const content = '---\ndescription: "Quoted value"\nother: \'Single quoted\'\n---\nBody';
    const { frontmatter } = parseFrontmatter(content);
    assert.equal(frontmatter.description, 'Quoted value');
    assert.equal(frontmatter.other, 'Single quoted');
  });

  it('returns empty frontmatter when no frontmatter present', () => {
    const content = 'Just body text\nwith multiple lines';
    const { frontmatter, body } = parseFrontmatter(content);
    assert.deepEqual(frontmatter, {});
    assert.equal(body, content);
  });

  it('returns empty frontmatter for unclosed block', () => {
    const content = '---\ndescription: Hello\nNo closing delimiter';
    const { frontmatter, body } = parseFrontmatter(content);
    assert.deepEqual(frontmatter, {});
    assert.equal(body, content);
  });

  it('handles empty frontmatter block', () => {
    const content = '---\n---\nBody after empty block';
    const { frontmatter, body } = parseFrontmatter(content);
    assert.deepEqual(frontmatter, {});
    assert.equal(body, 'Body after empty block');
  });

  it('skips lines without colon in frontmatter', () => {
    const content = '---\ndescription: Valid\nno-colon-here\n---\nBody';
    const { frontmatter } = parseFrontmatter(content);
    assert.equal(frontmatter.description, 'Valid');
    assert.equal(Object.keys(frontmatter).length, 1);
  });
});

// ── rewriteLibPaths ─────────────────────────────────────────────────

describe('rewriteLibPaths', () => {
  it('replaces ~/.claude/lib/ with target prefix', () => {
    const body = 'Use !`cat ~/.claude/lib/foo.md` here';
    const result = rewriteLibPaths(body, '~/.config/opencode/lib/');
    assert.equal(result, 'Use !`cat ~/.config/opencode/lib/foo.md` here');
  });

  it('is a no-op when no lib paths present', () => {
    const body = 'No lib references here';
    const result = rewriteLibPaths(body, '~/.gemini/lib/');
    assert.equal(result, body);
  });

  it('replaces multiple occurrences', () => {
    const body = '~/.claude/lib/a.md and ~/.claude/lib/b.md';
    const result = rewriteLibPaths(body, '~/.gemini/lib/');
    assert.equal(result, '~/.gemini/lib/a.md and ~/.gemini/lib/b.md');
  });
});

// ── inlineLibContent ────────────────────────────────────────────────

describe('inlineLibContent', () => {
  let tmpDir;

  it('inlines content when file exists', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slashdo-test-'));
    fs.writeFileSync(path.join(tmpDir, 'checklist.md'), 'Checklist content\n', 'utf8');

    const body = 'Before\n!`cat ~/.claude/lib/checklist.md`\nAfter';
    const result = inlineLibContent(body, tmpDir);
    assert.equal(result, 'Before\nChecklist content\nAfter');
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('preserves pattern when file is missing', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slashdo-test-'));
    const body = '!`cat ~/.claude/lib/missing.md`';
    const result = inlineLibContent(body, tmpDir);
    assert.equal(result, '!`cat ~/.claude/lib/missing.md`');
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('handles multiple inline patterns', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slashdo-test-'));
    fs.writeFileSync(path.join(tmpDir, 'a.md'), 'Content A\n', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'b.md'), 'Content B\n', 'utf8');

    const body = '!`cat ~/.claude/lib/a.md` and !`cat ~/.claude/lib/b.md`';
    const result = inlineLibContent(body, tmpDir);
    assert.equal(result, 'Content A and Content B');
    fs.rmSync(tmpDir, { recursive: true });
  });
});

// ── getTargetFilename ───────────────────────────────────────────────

describe('getTargetFilename', () => {
  it('subdirectory: preserves path structure', () => {
    const env = { namespacing: 'subdirectory', ext: '.md' };
    assert.equal(getTargetFilename('do/push.md', env), path.join('do', 'push.md'));
  });

  it('flat: flattens with namespace prefix', () => {
    const env = { namespacing: 'flat', ext: '.md' };
    assert.equal(getTargetFilename('do/push.md', env), 'do-push.md');
  });

  it('flat: no namespace when relPath has no directory', () => {
    const env = { namespacing: 'flat', ext: '.md' };
    assert.equal(getTargetFilename('push.md', env), 'push.md');
  });

  it('directory: creates namespace-basename/SKILL.md', () => {
    const env = { namespacing: 'directory', ext: null };
    assert.equal(getTargetFilename('do/push.md', env), path.join('do-push', 'SKILL.md'));
  });

  it('directory: no namespace for top-level file', () => {
    const env = { namespacing: 'directory', ext: null };
    assert.equal(getTargetFilename('push.md', env), path.join('push', 'SKILL.md'));
  });

  it('default: returns relPath unchanged', () => {
    const env = { namespacing: 'unknown' };
    assert.equal(getTargetFilename('do/push.md', env), 'do/push.md');
  });
});

// ── transformCommand ────────────────────────────────────────────────

describe('transformCommand', () => {
  const claudeEnv = {
    format: 'yaml-frontmatter',
    supportsCatInclusion: true,
    libPathPrefix: '~/.claude/lib/',
  };
  const geminiEnv = {
    format: 'toml',
    supportsCatInclusion: true,
    libPathPrefix: '~/.gemini/lib/',
  };
  const codexEnv = {
    format: 'skill-md',
    supportsCatInclusion: false,
    libPathPrefix: null,
  };

  it('produces yaml-frontmatter format for claude', () => {
    const content = '---\ndescription: Test cmd\n---\nBody text';
    const result = transformCommand(content, claudeEnv);
    assert.ok(result.startsWith('---\n'));
    assert.ok(result.includes('description: Test cmd'));
    assert.ok(result.includes('Body text'));
  });

  it('produces toml format for gemini (skips allowed-tools)', () => {
    const content = '---\ndescription: Test cmd\nallowed-tools: bash\n---\nBody';
    const result = transformCommand(content, geminiEnv);
    assert.ok(result.startsWith('+++\n'));
    assert.ok(result.includes('description = "Test cmd"'));
    assert.ok(!result.includes('allowed-tools'));
    assert.ok(result.includes('+++'));
  });

  it('produces skill-md format for codex', () => {
    const content = '---\ndescription: Test cmd\n---\nBody';
    const result = transformCommand(content, codexEnv);
    assert.ok(result.startsWith('# Test cmd'));
    assert.ok(result.includes('Body'));
  });

  it('rewrites lib paths for environments with supportsCatInclusion', () => {
    const content = '---\ndescription: Test\n---\n!`cat ~/.claude/lib/foo.md`';
    const result = transformCommand(content, geminiEnv);
    assert.ok(result.includes('~/.gemini/lib/foo.md'));
    assert.ok(!result.includes('~/.claude/lib/'));
  });

  it('inlines lib content for environments without supportsCatInclusion', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slashdo-test-'));
    fs.writeFileSync(path.join(tmpDir, 'foo.md'), 'Inlined content\n', 'utf8');

    const content = '---\ndescription: Test\n---\n!`cat ~/.claude/lib/foo.md`';
    const result = transformCommand(content, codexEnv, tmpDir);
    assert.ok(result.includes('Inlined content'));
    assert.ok(!result.includes('!`cat'));
    fs.rmSync(tmpDir, { recursive: true });
  });
});

// ── transformLib ────────────────────────────────────────────────────

describe('transformLib', () => {
  it('rewrites paths when env supports cat inclusion', () => {
    const env = { supportsCatInclusion: true, libPathPrefix: '~/.gemini/lib/' };
    const result = transformLib('See ~/.claude/lib/foo.md', env);
    assert.equal(result, 'See ~/.gemini/lib/foo.md');
  });

  it('returns content unchanged when env does not support cat inclusion', () => {
    const env = { supportsCatInclusion: false, libPathPrefix: null };
    const content = 'See ~/.claude/lib/foo.md';
    assert.equal(transformLib(content, env), content);
  });
});
