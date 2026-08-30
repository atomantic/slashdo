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

// Matches a top-level `!cat ~/.claude/lib/<name>.md` runtime include.
const LIB_CAT_RE = /!`cat ~\/\.claude\/lib\/(.+?)`/g;
// Matches an in-PROSE citation of a lib doc, e.g. `~/.claude/lib/gh-host.md` —
// the "see also, full detail here" pointers many lib files carry. Requires a
// `<name>.md` filename so bare directory mentions (`~/.claude/lib/`) are left
// alone; those are explanatory, not dangling file references.
const LIB_PROSE_RE = /~\/\.claude\/lib\/([A-Za-z0-9._-]+\.md)/g;
// Matches a relative Markdown link to a lib doc, e.g. `[lib/gh-host.md](../../lib/gh-host.md)` —
// the GitHub-clickable form command files use to cite a lib. The link target is
// relative to the source tree and does NOT exist in an installed skill dir, so it
// must be resolved for Agent Skills environments exactly like a prose citation.
// One or more `../` segments precede `lib/<name>.md`; the whole `[text](url)` is
// consumed and replaced by the bare doc name (link text is always the lib path).
const LIB_MD_LINK_RE = /\[[^\]]*\]\((?:\.\.\/)+lib\/([A-Za-z0-9._-]+\.md)\)/g;
// Matches an intra-lib SIBLING Markdown link, e.g. `[plan-id-format.md](./plan-id-format.md)` —
// the form a lib doc uses to cite another lib doc, where `../../lib/` would be the
// wrong relative path. Unlike the two forms above, `./<name>.md` does NOT carry
// `lib/` in its path, so a match is not self-evidently a lib reference (any file
// may link a sibling doc). This one is therefore rewritten ONLY when a file of that
// name exists in `lib/` — see the existence guard in resolveProseRefs.
//
// That guard matches on BASENAME; it does not resolve the link relative to the file
// that wrote it (this function never sees the source path). So it is exact only
// while no command shares a basename with a lib — otherwise a command's link to its
// own sibling would be rewritten into a lib citation. Nothing collides today, and
// test/transformer.test.js asserts the disjointness so a future collision fails CI
// rather than silently mis-rewriting. Teach this to resolve source-relative paths if
// that invariant ever needs to be relaxed.
const LIB_SIBLING_LINK_RE = /\[[^\]]*\]\(\.\/([A-Za-z0-9._-]+\.md)\)/g;
// Matches a BACKTICKED bare citation, e.g. `` `lib/multi-reviewer-loop.md` `` — the
// "full mechanics in X" pointers the command specs use. Harmless prose while every
// lib was inlined, but once `lib/<name>.md` denotes a real bundled file beside
// SKILL.md the same token reads as a path, and a non-bundled one is then a dangling
// reference. Resolved like the other prose forms: to a bundled path when the lib is
// deferred (the file exists), to a bare doc name when it is inlined nearby. Guarded
// on the name existing under lib/, so an unrelated `lib/...md` in a shell snippet is
// left alone.
const LIB_BACKTICK_RE = /`lib\/([A-Za-z0-9._-]+\.md)`/g;

// Libs that sit on a CONDITIONAL path — content a given run needs only when it
// takes a particular branch. Inlining them puts every branch in every SKILL.md at
// once; for environments that bundle lib docs beside SKILL.md they are written as
// sibling files and cited with a read directive instead.
//
// The bar for an entry is that a real run can finish WITHOUT it. A lib the command
// always needs (`code-review-checklist.md` under a REQUIRED GATE, `swift-gotchas.md`
// which Phase 1 says to "load into your context") must stay inline: deferring it
// only buys an extra read, and risks the agent skipping content it always needed.
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

// The read directive that replaces a deferred lib's inline content. Written as an
// imperative instruction naming the branch that makes it required, rather than a
// passive link: the agent must treat it as a required read on that path, not an
// optional reference, or the content it names is silently lost.
function deferredLibDirective(ref, filename) {
  const { what, when } = ON_DEMAND_LIBS.get(filename);
  return [
    `> **Read \`${ref}\` now — required when ${when}.** The full ${what} lives in`,
    '> that file, bundled alongside this skill. Read it in full before acting on this',
    '> step and follow it exactly. Do NOT improvise from the summary above: the file',
    '> carries the load-bearing detail this summary deliberately omits.',
  ].join('\n');
}

// For Agent Skills environments (Codex/Antigravity/Grok — `libDir: null`, no
// runtime `!cat`, and no `~/.claude/lib/` on disk for a host-only user), make
// every referenced lib doc resolvable in the generated SKILL.md instead of citing
// a path the user cannot open. Three steps:
//   1. Inline top-level `!cat ~/.claude/lib/<name>.md` includes (recording which
//      libs became present so their in-prose citations turn into in-skill names).
//   2. Rewrite the remaining citations — both PROSE `~/.claude/lib/<name>.md` and
//      relative Markdown links `[lib/<name>.md](../../lib/<name>.md)` — to a
//      host-neutral bare doc name, dropping the un-resolvable path.
//   3. For any cited lib whose content is NOT already inlined (its detail is
//      otherwise absent), append it once under a "Referenced libraries" section —
//      recursively resolving that lib's own citations too (nested refs), deduped
//      and cycle-safe — so the load-bearing detail is available host-side.
// Claude/OpenCode never reach this path (they keep runtime `~/.claude/lib/` via
// cat inclusion), so their output is unchanged.
function inlineLibReferences(body, libDir, opts = {}) {
  const inlined = new Set();   // libs whose full content is present in the document
  const queued = new Set();    // libs already appended or scheduled for the appendix
  const appendQueue = [];      // ordered absent-but-cited libs to inline as appendix
  // Deferral is opt-in per environment (`bundlesLibs`). When off, every code path
  // below behaves exactly as before, so Claude/OpenCode output is byte-identical.
  const deferred = opts.bundlesLibs ? DEFERRED_LIBS : new Set();
  // Every lib the installer must write beside SKILL.md, filled as they are cited.
  const bundled = opts.bundled instanceof Set ? opts.bundled : new Set();
  const fromLibDir = opts.fromLibDir === true;
  // Libs the READER already has in front of them (the parent SKILL.md's inlined
  // content and appendix). A bundled child cites those by name instead of
  // re-inlining them — without this, every backend file re-appends the whole
  // dispatcher it was split away from, and the split saves nothing on read.
  const present = opts.present instanceof Set ? opts.present : new Set();
  // Reports back everything this document makes available, so a parent transform
  // can hand its own set to the children it bundles.
  const presentOut = opts.presentOut instanceof Set ? opts.presentOut : null;

  const readLib = (filename) => {
    const libFile = path.join(libDir, filename);
    return fs.existsSync(libFile) ? fs.readFileSync(libFile, 'utf8').trim() : null;
  };

  // Inline `!cat` includes in a chunk, recording each resolved lib as present.
  const inlineCatIncludes = (text) => text.replace(LIB_CAT_RE, (match, filename) => {
    const content = readLib(filename);
    if (content === null) return match;
    // A deferred backend is bundled as its own file and cited, never inlined.
    if (deferred.has(filename)) {
      bundled.add(filename);
      return deferredLibDirective(bundledRef(filename), filename);
    }
    inlined.add(filename);
    return content;
  });

  // Where a bundled lib lives from the citing document: `lib/<name>.md` from a
  // SKILL.md, `./<name>.md` from a doc already inside that bundle directory.
  const bundledRef = (filename) =>
    (fromLibDir ? `./${filename}` : `${BUNDLED_LIB_DIR}/${filename}`);
  const bareName = (filename) => filename.replace(/\.md$/, '');

  // Rewrite a cited lib to its bare doc name, queueing any cited-but-absent lib
  // (one never `!cat`-inlined) for the appendix so its content is available.
  const queueAndName = (filename) => {
    // A deferred backend must never reach the appendix — that would re-inline the
    // very content the deferral exists to keep out. Cite the bundled file instead,
    // which is a path the agent can actually open.
    if (deferred.has(filename) && readLib(filename) !== null) {
      bundled.add(filename);
      return bundledRef(filename);
    }
    if (!present.has(filename) && !inlined.has(filename) && !queued.has(filename)
        && readLib(filename) !== null) {
      queued.add(filename);
      appendQueue.push(filename);
    }
    return bareName(filename);
  };

  // The backticked "full mechanics in `lib/x.md`" form is a SEE-ALSO pointer, not a
  // demand for the content. Routing it through queueAndName would drag the whole doc
  // (and its transitive citations) into the appendix of every skill that merely
  // name-drops it — which inflated /do:config from 19KB to 91KB. So: cite the real
  // bundled path when this skill actually bundles the file, otherwise strip it to a
  // bare doc name and pull in nothing.
  const nameOnly = (filename) =>
    (bundled.has(filename) ? bundledRef(filename) : bareName(filename));

  // Resolve all three citation forms — relative Markdown links, intra-lib sibling
  // links, and `~/.claude/lib/` prose refs — to bare doc names. Links are handled
  // first so their `lib/<name>.md` link text isn't matched by the prose regex
  // mid-rewrite. The sibling form is guarded on the target actually being a lib
  // file: its path carries no `lib/` marker, so rewriting an unresolvable one would
  // silently mangle an ordinary sibling-doc link into a bare word.
  const resolveProseRefs = (text) =>
    text
      .replace(LIB_MD_LINK_RE, (match, filename) => queueAndName(filename))
      .replace(LIB_SIBLING_LINK_RE, (match, filename) =>
        readLib(filename) === null ? match : queueAndName(filename))
      .replace(LIB_BACKTICK_RE, (match, filename) =>
        readLib(filename) === null ? match : `\`${nameOnly(filename)}\``)
      .replace(LIB_PROSE_RE, (match, filename) => queueAndName(filename));

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

  if (presentOut) {
    for (const f of inlined) presentOut.add(f);
    for (const f of queued) presentOut.add(f);
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

function transformCommand(content, env, sourceLibDir, relPath, opts = {}) {
  const { frontmatter, body } = parseFrontmatter(content);

  let transformedBody = body;

  // A relocated Claude config directory owns the entire ~/.claude tree, not
  // only slashdo's libraries and saved config. Quote the custom root so the
  // generated shell snippets remain valid when the directory contains spaces
  // or shell metacharacters.
  transformedBody = rewriteClaudeRootPaths(transformedBody, env);

  if (env.supportsCatInclusion && env.libPathPrefix) {
    transformedBody = rewriteLibPaths(transformedBody, env.libPathPrefix);
  } else if (!env.supportsCatInclusion && sourceLibDir) {
    transformedBody = inlineLibReferences(transformedBody, sourceLibDir, {
      bundlesLibs: env.bundlesLibs === true,
      bundled: opts.bundled,
      presentOut: opts.present,
    });
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
  let transformed = rewriteClaudeRootPaths(content, env);
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
  applyConditionalBlocks,
  getSkillName,
  getTargetFilename,
  transformCommand,
  transformLib,
};
