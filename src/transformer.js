'use strict';

const fs = require('fs');
const path = require('path');

// Maps an `if:<capability>` token to the boolean flag on an environment.
// Only registered capabilities are resolved; unknown tokens are left intact.
const CONDITIONAL_CAPABILITIES = { teams: 'supportsTeams' };

function parseFrontmatter(content) {
  const lines = content.split(/\r?\n/);
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

function shellQuotePath(value, platform = process.platform) {
  if (platform === 'win32') return `"${value.replace(/"/g, '""')}"`;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function joinClaudePath(root, suffix, platform) {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const separator = platform === 'win32' ? '\\' : '/';
  return pathApi.join(root, suffix.replace(/^[/\\]+/, '').replace(/\//g, separator));
}

function rewriteClaudeRootPaths(body, env) {
  if (env.claudeRootPath) {
    const platform = env.platform || process.platform;
    const rootToken = '~/.claude';
    // Match complete path-like references so the replacement can quote the
    // joined path. Quoting only the directory prefix produces invalid Windows
    // tokens such as `"C:\\Claude Data"\\lib/file.md`.
    return body.replace(/~\/\.claude(?:\/(?:[A-Za-z0-9_-]|\.[A-Za-z0-9_-])+)*\/?(?![A-Za-z0-9_-])/g,
      (match) => shellQuotePath(joinClaudePath(env.claudeRootPath,
        match.slice(rootToken.length), platform), platform));
  }
  if (!env.claudeRootPathPrefix) return body;
  const rootPath = env.claudeRootPathPrefix.endsWith(path.sep)
    ? env.claudeRootPathPrefix.slice(0, -path.sep.length)
    : env.claudeRootPathPrefix;
  return body.replace(/~\/\.claude(\/|(?=$|[^A-Za-z0-9_-]))/g,
    (match, slash) => slash ? env.claudeRootPathPrefix : rootPath);
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

// Canonical includes plus the citation forms used by command and library docs.
const LIB_CAT_RE = /!`cat ~\/\.claude\/lib\/(.+?)`/g;
const LIB_PROSE_RE = /~\/\.claude\/lib\/([A-Za-z0-9._-]+\.md)/g;
const LIB_MD_LINK_RE = /\[[^\]]*\]\((?:\.\.\/)+lib\/([A-Za-z0-9._-]+\.md)\)/g;
// Sibling and backticked paths can also refer to non-slashdo docs. Resolve only
// when a matching library exists; command/lib basename disjointness is tested.
const LIB_SIBLING_LINK_RE = /\[[^\]]*\]\(\.\/([A-Za-z0-9._-]+\.md)\)/g;
const LIB_BACKTICK_RE = /`lib\/([A-Za-z0-9._-]+\.md)`/g;

// Libs that sit on a CONDITIONAL path — content a given run needs only when it
// takes a particular branch. Inlining them puts every branch in every SKILL.md at
// once; for environments that bundle lib docs beside SKILL.md they are written as
// sibling files and cited with a read directive instead.
//
// This keeps existing !cat sources compatible. New phased workflows use !read
// explicitly at the relevant step instead of extending this filename registry.
//
// `when` states the branch that makes the read required; `what` names the content.
// Both are rendered into the directive, so the agent is told when it must read the
// file rather than being left to infer it. Environments with runtime `!cat`
// (Claude/OpenCode) never reach this path and are unaffected.
const ON_DEMAND_LIBS = new Map([
  // Reviewer backends: `--review-with` dispatches to exactly one of these per
  // reviewer, so at most one of the four is ever live. The dispatcher
  // (multi-reviewer-loop.md) deliberately stays inline — it is always on the taken
  // path and is what names which backend to load.
  ['copilot-review-loop.md',
    { what: 'Copilot reviewer loop', when: 'the reviewer list includes `copilot`' }],
  ['github-reviewer-loop.md',
    { what: 'GitHub-reviewer loop', when: 'the reviewer list includes an `@<login>` reviewer' }],
  ['local-agent-review-loop.md',
    { what: 'local-agent reviewer loop', when: 'the reviewer list includes `codex`, `claude`, `agy`, `grok`, or `cursor`' }],
  ['ollama-review-loop.md',
    { what: 'Ollama reviewer loop', when: 'the reviewer list includes `ollama`' }],

  // Issue-tracker machinery: only reached in issues mode. PLAN.md mode — the
  // default — never opens the tracker at all.
  ['plan-issue-mode.md',
    { what: 'issue-mode setup and filing rules', when: 'this run is in issues mode' }],
  ['epic-children.md',
    { what: 'epic/child issue resolution rules', when: 'a candidate issue is an epic or carries children' }],

  // Explicitly flag-gated or situational paths.
  ['next-swarm.md',
    { what: 'parallel swarm flow (phases A-D)', when: '`--swarm` was passed' }],
  ['enhance-loop.md',
    { what: 'draft-enhancement loop', when: '`--enhance-with` was passed' }],
  ['ci-flake-handling.md',
    { what: 'CI flake triage rules', when: 'a CI check fails in a way that looks like a flake' }],
  ['rebase-conflict-resolution.md',
    { what: 'autonomous rebase-conflict resolution playbook', when: 'a rebase stops on conflicts' }],

  // Review lenses: review-agent-selection.md dispatches only the lenses a diff
  // actually signals — often one or two, sometimes none.
  ['review-surface-scan.md',
    { what: 'Surface Scan (Runtime) lens', when: 'you dispatch that lens' }],
  ['review-surface-quality.md',
    { what: 'Surface Quality lens', when: 'you dispatch that lens' }],
  ['review-security-audit.md',
    { what: 'Security Audit lens', when: 'you dispatch that lens' }],
  ['review-cross-file-tracing.md',
    { what: 'Cross-File Tracing (State) lens', when: 'you dispatch that lens' }],
  ['review-cross-file-contract.md',
    { what: 'Cross-File Contract lens', when: 'you dispatch that lens' }],
  ['review-structural-ambition.md',
    { what: 'Structural Ambition lens', when: 'you dispatch that lens (strict mode only)' }],
]);

const DEFERRED_LIBS = new Set(ON_DEMAND_LIBS.keys());

const BUNDLED_LIB_DIR = 'lib';

// Source authors put !read on its own line after the phase/condition that
// requires it. Native command hosts receive a read instruction; file-less hosts
// inline the same content. Never execute this directive as a shell command.
const LIB_READ_RE = /^[ \t]*!read lib\/([^\s]+)[ \t]*\r?$/gm;

function assertLibraryFilename(filename) {
  if (!/^[A-Za-z0-9._-]+\.md$/.test(filename)) {
    throw new Error(`Invalid slashdo library filename: ${filename}`);
  }
}

function requiredReadDirective(ref) {
  return `Read \`${ref}\` before performing this step; required when this step applies.`;
}

function deferredLibDirective(ref, filename) {
  const { what, when } = ON_DEMAND_LIBS.get(filename);
  return `> **Read \`${ref}\` now — required when ${when}.** Follow the ${what} in that file.`;
}

// One graph resolver serves installed skills and embedding hosts. Explicit !cat
// includes stay inline (except known conditional libraries); citations and !read
// directives become files in deferred mode. Eager mode includes each dependency
// once. Resolve conditions before discovering edges, so inactive references do
// not load content or fail on a file that that environment never needs.
function createPromptRenderer(libDir, { skipIncludes = [], teams = false, defer = true, followReferences = true } = {}) {
  const skipped = new Set(skipIncludes.map(name => name.endsWith('.md') ? name : `${name}.md`));
  const bundled = new Set();
  const cache = new Map();
  const bareName = filename => filename.replace(/\.md$/, '');
  const prepare = text => applyConditionalBlocks(text, { supportsTeams: teams });

  function readLib(filename, required = false) {
    assertLibraryFilename(filename);
    if (!cache.has(filename)) {
      const file = path.join(libDir, filename);
      cache.set(filename, fs.existsSync(file) ? prepare(fs.readFileSync(file, 'utf8').trim()) : null);
    }
    const content = cache.get(filename);
    if (content === null && required) throw new Error(`Missing required slashdo library: ${filename}`);
    return content;
  }

  function renderDocument(content, { fromLibDir = false, present = new Set() } = {}) {
    const inlined = new Set();
    const queued = new Set();
    const ref = filename => fromLibDir ? `./${filename}` : `${BUNDLED_LIB_DIR}/${filename}`;
    const alreadyPresent = filename => present.has(filename) || inlined.has(filename);

    const include = (filename, explicitRead = false) => {
      if (skipped.has(filename)) return '';
      const raw = readLib(filename, true);
      if (defer && (explicitRead || DEFERRED_LIBS.has(filename))) {
        bundled.add(filename);
        return explicitRead ? requiredReadDirective(ref(filename)) : deferredLibDirective(ref(filename), filename);
      }
      if (alreadyPresent(filename)) return `See \`${bareName(filename)}\` already included here.`;
      // Mark before recursion: a -> b -> a includes each body just once.
      inlined.add(filename);
      return inlineDirectives(raw);
    };
    const inlineDirectives = text => prepare(text)
      .replace(LIB_CAT_RE, (match, filename) => include(filename))
      .replace(LIB_READ_RE, (match, filename) => include(filename, true));

    const queueAndName = filename => {
      if (skipped.has(filename)) return bareName(filename);
      if (defer && bundled.has(filename)) return ref(filename);
      if (!followReferences || alreadyPresent(filename)) return bareName(filename);
      if (readLib(filename) === null) return bareName(filename);
      if (defer) {
        bundled.add(filename);
        return ref(filename);
      }
      queued.add(filename);
      return bareName(filename);
    };
    const resolveRefs = text => text
      .replace(LIB_MD_LINK_RE, (match, filename) => queueAndName(filename))
      .replace(LIB_SIBLING_LINK_RE, (match, filename) =>
        !skipped.has(filename) && !fs.existsSync(path.join(libDir, filename)) ? match : queueAndName(filename))
      .replace(LIB_BACKTICK_RE, (match, filename) => {
        if (!skipped.has(filename) && !fs.existsSync(path.join(libDir, filename))) return match;
        // Bare backticks are see-also names, not required includes. Historically
        // following them in eager mode inflated tiny recipes by entire workflows.
        return `\`${defer ? queueAndName(filename) : bareName(filename)}\``;
      })
      .replace(LIB_PROSE_RE, (match, filename) => queueAndName(filename));

    const body = resolveRefs(inlineDirectives(content));
    const sections = [];
    for (const filename of queued) {
      if (alreadyPresent(filename)) continue;
      inlined.add(filename);
      sections.push(`### ${bareName(filename)}\n\n${resolveRefs(inlineDirectives(readLib(filename, true)))}`);
    }
    return {
      body: sections.length ? `${body}\n\n---\n\n## Referenced libraries\n\n${sections.join('\n\n')}` : body,
      present: new Set([...present, ...inlined]),
    };
  }

  return { renderDocument, bundled, readLib };
}

function buildPromptBundle(content, libDir, options = {}) {
  const renderer = createPromptRenderer(libDir, options);
  const root = renderer.renderDocument(content);
  const files = {};
  // Set iteration visits newly discovered dependencies and terminates on cycles.
  for (const filename of renderer.bundled) {
    files[filename] = renderer.renderDocument(renderer.readLib(filename, true), {
      fromLibDir: true,
      present: new Set([...root.present, filename]),
    }).body;
  }
  return { body: root.body, files };
}

// Compatibility entrypoint for callers that collect bundles themselves.
function inlineLibReferences(body, libDir, opts = {}) {
  const renderer = createPromptRenderer(libDir, {
    skipIncludes: opts.skipIncludes,
    teams: opts.teams,
    followReferences: opts.followReferences,
    defer: opts.bundlesLibs === true,
  });
  const result = renderer.renderDocument(body, opts);
  for (const filename of renderer.bundled) opts.bundled?.add(filename);
  for (const filename of result.present) opts.presentOut?.add(filename);
  return result.body;
}

function resolveReadDirectives(content, sourceLibDir) {
  return content.replace(LIB_READ_RE, (match, filename) => {
    assertLibraryFilename(filename);
    if (sourceLibDir && !fs.existsSync(path.join(sourceLibDir, filename))) {
      throw new Error(`Missing required slashdo library: ${filename}`);
    }
    return requiredReadDirective(`~/.claude/lib/${filename}`);
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

function transformCommand(content, env, sourceLibDir, relPath, opts = {}) {
  const { frontmatter, body } = parseFrontmatter(content);

  let transformedBody = applyConditionalBlocks(body, env);

  // A relocated Claude config directory owns the entire ~/.claude tree, not
  // only slashdo's libraries and saved config. Quote the custom root so the
  // generated shell snippets remain valid when the directory contains spaces
  // or shell metacharacters.
  if (env.supportsCatInclusion) transformedBody = resolveReadDirectives(transformedBody, sourceLibDir);
  transformedBody = rewriteClaudeRootPaths(transformedBody, env);

  if (env.supportsCatInclusion && env.libPathPrefix) {
    transformedBody = rewriteLibPaths(transformedBody, env.libPathPrefix);
  } else if (!env.supportsCatInclusion && sourceLibDir) {
    const bundle = buildPromptBundle(transformedBody, sourceLibDir, {
      teams: env.supportsTeams === true,
      defer: env.bundlesLibs === true,
    });
    transformedBody = bundle.body;
    if (opts.files) {
      for (const [filename, text] of Object.entries(bundle.files)) {
        opts.files[filename] = rewriteConfigPath(text, env);
      }
    }
    for (const filename of Object.keys(bundle.files)) opts.bundled?.add(filename);
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

function transformLib(content, env, sourceLibDir, opts = {}) {
  let transformed = applyConditionalBlocks(content, env);
  if (env.supportsCatInclusion) transformed = resolveReadDirectives(transformed, sourceLibDir);
  transformed = rewriteClaudeRootPaths(transformed, env);
  if (env.supportsCatInclusion && env.libPathPrefix) {
    transformed = rewriteLibPaths(transformed, env.libPathPrefix);
  } else if (!env.supportsCatInclusion && sourceLibDir) {
    // A bundled lib is read standalone, so its own citations must resolve the same
    // way SKILL.md's do. `fromLibDir` makes sibling references relative to the lib
    // directory the file itself lives in (`./x.md`, not `lib/x.md`).
    transformed = inlineLibReferences(transformed, sourceLibDir, {
      bundlesLibs: env.bundlesLibs === true,
      bundled: opts.bundled,
      present: opts.present,
      teams: env.supportsTeams === true,
      fromLibDir: true,
    });
  }
  transformed = rewriteConfigPath(transformed, env);
  return applyConditionalBlocks(transformed, env);
}

module.exports = {
  ON_DEMAND_LIBS,
  DEFERRED_LIBS,
  BUNDLED_LIB_DIR,
  parseFrontmatter,
  rewriteLibPaths,
  rewriteConfigPath,
  inlineLibReferences,
  buildPromptBundle,
  applyConditionalBlocks,
  getSkillName,
  getTargetFilename,
  transformCommand,
  transformLib,
};
