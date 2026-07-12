'use strict';

const fs = require('fs');
const path = require('path');

// Maps an `if:<capability>` token to the boolean flag on an environment.
// Only registered capabilities are resolved; unknown tokens are left intact.
const CONDITIONAL_CAPABILITIES = { teams: 'supportsTeams' };

function parseFrontmatter(content) {
  const lines = content.split('\n');
  if (lines[0] !== '---') return { frontmatter: {}, body: content };

  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') { endIdx = i; break; }
  }
  if (endIdx === -1) return { frontmatter: {}, body: content };

  const fm = {};
  for (let i = 1; i < endIdx; i++) {
    const line = lines[i];
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let val = line.slice(colonIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    fm[key] = val;
  }

  const body = lines.slice(endIdx + 1).join('\n');
  return { frontmatter: fm, body };
}

function rewriteLibPaths(body, targetPrefix) {
  return body.replace(/~\/\.claude\/lib\//g, targetPrefix);
}

// Rewrites the slashdo config-path token (`~/.claude/.slashdo-config.json`) to
// the host CLI's own config path so commands read/write the right file at
// runtime. Unlike lib paths, this is a literal the agent resolves at runtime on
// every host (cat-inclusion or not), so it is applied to the full command body
// after any lib inlining. No-op for Claude (the token already matches) and for
// envs without a configPath.
function rewriteConfigPath(body, env) {
  if (!env.configPath || env.configPath === '~/.claude/.slashdo-config.json') return body;
  return body.replace(/~\/\.claude\/\.slashdo-config\.json/g, env.configPath);
}

function inlineLibContent(body, libDir) {
  return body.replace(/!`cat ~\/\.claude\/lib\/(.+?)`/g, (match, filename) => {
    const libFile = path.join(libDir, filename);
    if (fs.existsSync(libFile)) {
      return fs.readFileSync(libFile, 'utf8').trim();
    }
    return match;
  });
}

// Matches a top-level `!cat ~/.claude/lib/<name>.md` runtime include.
const LIB_CAT_RE = /!`cat ~\/\.claude\/lib\/(.+?)`/g;
// Matches an in-PROSE citation of a lib doc, e.g. `~/.claude/lib/gh-host.md` —
// the "see also, full detail here" pointers many lib files carry. Requires a
// `<name>.md` filename so bare directory mentions (`~/.claude/lib/`) are left
// alone; those are explanatory, not dangling file references.
const LIB_PROSE_RE = /~\/\.claude\/lib\/([A-Za-z0-9._-]+\.md)/g;

// For Agent Skills environments (Codex/Antigravity/Grok — `libDir: null`, no
// runtime `!cat`, and no `~/.claude/lib/` on disk for a host-only user), make
// every referenced lib doc resolvable in the generated SKILL.md instead of citing
// a path the user cannot open. Three steps:
//   1. Inline top-level `!cat ~/.claude/lib/<name>.md` includes (recording which
//      libs became present so their in-prose citations turn into in-skill names).
//   2. Rewrite the remaining PROSE citations `~/.claude/lib/<name>.md` to a
//      host-neutral bare doc name, dropping the un-resolvable path.
//   3. For any cited lib whose content is NOT already inlined (its detail is
//      otherwise absent), append it once under a "Referenced libraries" section —
//      recursively resolving that lib's own citations too (nested refs), deduped
//      and cycle-safe — so the load-bearing detail is available host-side.
// Claude/OpenCode never reach this path (they keep runtime `~/.claude/lib/` via
// cat inclusion), so their output is unchanged.
function inlineLibReferences(body, libDir) {
  const inlined = new Set();   // libs whose full content is present in the document
  const queued = new Set();    // libs already appended or scheduled for the appendix
  const appendQueue = [];      // ordered absent-but-cited libs to inline as appendix

  const readLib = (filename) => {
    const libFile = path.join(libDir, filename);
    return fs.existsSync(libFile) ? fs.readFileSync(libFile, 'utf8').trim() : null;
  };

  // Inline `!cat` includes in a chunk, recording each resolved lib as present.
  const inlineCatIncludes = (text) => text.replace(LIB_CAT_RE, (match, filename) => {
    const content = readLib(filename);
    if (content === null) return match;
    inlined.add(filename);
    return content;
  });

  // Rewrite prose citations to a bare doc name; queue any cited-but-absent lib
  // (one never `!cat`-inlined) for the appendix so its content is available.
  const resolveProseRefs = (text) => text.replace(LIB_PROSE_RE, (match, filename) => {
    if (!inlined.has(filename) && !queued.has(filename) && readLib(filename) !== null) {
      queued.add(filename);
      appendQueue.push(filename);
    }
    return filename.replace(/\.md$/, '');
  });

  // Main body: inline includes first, then resolve the prose refs left behind
  // (including those that arrived inside inlined lib content).
  const out = resolveProseRefs(inlineCatIncludes(body));

  // Drain the appendix queue. Each appended lib may cite further libs — inline any
  // `!cat` it carries and resolve its prose refs, which can enqueue more (BFS).
  // `queued` guarantees each lib is appended at most once, so any cite cycle
  // terminates.
  const sections = [];
  for (let i = 0; i < appendQueue.length; i++) {
    const filename = appendQueue[i];
    const raw = readLib(filename);
    if (raw === null) continue; // only real files are queued; defensive
    const content = resolveProseRefs(inlineCatIncludes(raw));
    sections.push(`### ${filename.replace(/\.md$/, '')}\n\n${content}`);
  }

  if (sections.length === 0) return out;

  const appendix =
    '\n---\n\n## Referenced libraries\n\n' +
    'These slashdo library docs are cited above. This environment has no ' +
    '`~/.claude/lib/` directory, so their content is inlined here.\n\n' +
    sections.join('\n\n');

  return out + '\n' + appendix;
}

// Resolves `<!-- if:<cap> -->…<!-- else -->…<!-- /if:<cap> -->` blocks against
// the target environment's capability flags, keeping the matching branch and
// stripping the markers. The `else` branch is optional. Blocks do not nest.
// Unknown capabilities are left untouched so stray comments never silently
// delete content.
function applyConditionalBlocks(content, env) {
  const blockRe = /<!--\s*if:([a-zA-Z]+)\s*-->\n?([\s\S]*?)(?:<!--\s*else\s*-->\n?([\s\S]*?))?<!--\s*\/if:\1\s*-->\n?/g;
  return content.replace(blockRe, (match, cap, ifContent, elseContent = '') => {
    const flag = CONDITIONAL_CAPABILITIES[cap];
    if (!flag) return match;
    return env[flag] ? ifContent : elseContent;
  });
}

function toYamlFrontmatter(fm) {
  const lines = ['---'];
  for (const [key, val] of Object.entries(fm)) {
    lines.push(`${key}: ${JSON.stringify(String(val))}`);
  }
  lines.push('---');
  return lines.join('\n');
}

// The flat/directory skill name for a command: `do/better` -> `do-better`.
// Matches the directory `getTargetFilename` creates for directory namespacing,
// so it can double as the Agent Skills `name` field.
function getSkillName(relPath) {
  const basename = path.basename(relPath, '.md');
  const dir = path.dirname(relPath);
  const namespace = dir === '.' ? '' : dir;
  return namespace ? `${namespace}-${basename}` : basename;
}

function getTargetFilename(relPath, env) {
  const basename = path.basename(relPath, '.md');
  const dir = path.dirname(relPath);
  const namespace = dir === '.' ? '' : dir;

  switch (env.namespacing) {
    case 'subdirectory':
      return path.join(namespace, basename + (env.ext || '.md'));

    case 'flat':
      return getSkillName(relPath) + (env.ext || '.md');

    case 'directory':
      return path.join(getSkillName(relPath), 'SKILL.md');

    default:
      return relPath;
  }
}

function transformCommand(content, env, sourceLibDir, relPath) {
  const { frontmatter, body } = parseFrontmatter(content);

  let transformedBody = body;

  if (env.supportsCatInclusion && env.libPathPrefix) {
    transformedBody = rewriteLibPaths(transformedBody, env.libPathPrefix);
  } else if (!env.supportsCatInclusion && sourceLibDir) {
    transformedBody = inlineLibReferences(transformedBody, sourceLibDir);
  }

  // Run on the full body (after inlining) so config-path tokens that arrived via
  // inlined lib content are rewritten too.
  transformedBody = rewriteConfigPath(transformedBody, env);

  // Run after inlining so conditionals inside inlined lib content are resolved too.
  transformedBody = applyConditionalBlocks(transformedBody, env);

  // The Agent Skills standard (directory namespacing — Antigravity/agy and
  // Codex) requires a `name` field in SKILL.md frontmatter that matches the
  // skill directory. Without it agy can't disambiguate skills and collapses
  // them all into a single entry. Inject it first (Agent Skills convention puts
  // `name` ahead of `description`) when the source command omits it.
  let outFrontmatter = frontmatter;
  if (env.namespacing === 'directory' && relPath && !frontmatter.name) {
    outFrontmatter = { name: getSkillName(relPath), ...frontmatter };
  }

  // All current environments use YAML frontmatter (Claude / OpenCode commands,
  // and the Agent Skills SKILL.md format used by Antigravity and Codex). The
  // legacy Gemini CLI's TOML headers were dropped when Gemini became the
  // Antigravity CLI (agy), which uses Agent Skills instead.
  const header = toYamlFrontmatter(outFrontmatter);

  return header + '\n' + transformedBody;
}

function transformLib(content, env) {
  let transformed = content;
  if (env.supportsCatInclusion && env.libPathPrefix) {
    transformed = rewriteLibPaths(transformed, env.libPathPrefix);
  }
  transformed = rewriteConfigPath(transformed, env);
  return applyConditionalBlocks(transformed, env);
}

module.exports = {
  parseFrontmatter,
  rewriteLibPaths,
  rewriteConfigPath,
  inlineLibContent,
  inlineLibReferences,
  applyConditionalBlocks,
  getSkillName,
  getTargetFilename,
  transformCommand,
  transformLib,
};
