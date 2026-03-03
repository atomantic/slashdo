'use strict';

const fs = require('fs');
const path = require('path');

const CLAUDE_LIB_PREFIX = '~/.claude/lib/';

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

function toYamlFrontmatter(fm) {
  const lines = ['---'];
  for (const [key, val] of Object.entries(fm)) {
    lines.push(`${key}: ${val}`);
  }
  lines.push('---');
  return lines.join('\n');
}

function toTomlHeader(fm) {
  const lines = ['+++'];
  for (const [key, val] of Object.entries(fm)) {
    if (key === 'allowed-tools') continue;
    lines.push(`${key} = "${val}"`);
  }
  lines.push('+++');
  return lines.join('\n');
}

function toSkillHeader(fm) {
  const lines = [];
  if (fm.description) lines.push(`# ${fm.description}`);
  return lines.join('\n');
}

function getTargetFilename(relPath, env) {
  const basename = path.basename(relPath, '.md');
  const dir = path.dirname(relPath);
  const namespace = dir === '.' ? '' : dir;

  switch (env.namespacing) {
    case 'subdirectory':
      return path.join(namespace, basename + (env.ext || '.md'));

    case 'flat': {
      const flat = namespace ? `${namespace}-${basename}` : basename;
      return flat + (env.ext || '.md');
    }

    case 'directory': {
      const dirName = namespace ? `${namespace}-${basename}` : basename;
      return path.join(dirName, 'SKILL.md');
    }

    default:
      return relPath;
  }
}

function transformCommand(content, env, sourceLibDir) {
  const { frontmatter, body } = parseFrontmatter(content);

  let transformedBody = body;

  if (env.supportsCatInclusion && env.libPathPrefix) {
    transformedBody = rewriteLibPaths(transformedBody, env.libPathPrefix);
  } else if (!env.supportsCatInclusion && sourceLibDir) {
    transformedBody = inlineLibContent(transformedBody, sourceLibDir);
  }

  let header;
  switch (env.format) {
    case 'yaml-frontmatter':
      header = toYamlFrontmatter(frontmatter);
      break;
    case 'toml':
      header = toTomlHeader(frontmatter);
      break;
    case 'skill-md':
      header = toSkillHeader(frontmatter);
      break;
    default:
      header = toYamlFrontmatter(frontmatter);
  }

  return header + '\n' + transformedBody;
}

function transformLib(content, env) {
  if (env.supportsCatInclusion && env.libPathPrefix) {
    return rewriteLibPaths(content, env.libPathPrefix);
  }
  return content;
}

module.exports = {
  parseFrontmatter,
  rewriteLibPaths,
  inlineLibContent,
  getTargetFilename,
  transformCommand,
  transformLib,
};
