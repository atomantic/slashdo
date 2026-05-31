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

function inlineLibContent(body, libDir) {
  return body.replace(/!`cat ~\/\.claude\/lib\/(.+?)`/g, (match, filename) => {
    const libFile = path.join(libDir, filename);
    if (fs.existsSync(libFile)) {
      return fs.readFileSync(libFile, 'utf8').trim();
    }
    return match;
  });
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
    transformedBody = inlineLibContent(transformedBody, sourceLibDir);
  }

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
  return applyConditionalBlocks(transformed, env);
}

module.exports = {
  parseFrontmatter,
  rewriteLibPaths,
  inlineLibContent,
  applyConditionalBlocks,
  getSkillName,
  getTargetFilename,
  transformCommand,
  transformLib,
};
