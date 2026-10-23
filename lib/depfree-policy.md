### Dependency policy allowlist

`defaults["depfree-allow"]` is an array of package-name strings in the host CLI's
global `~/.claude/.slashdo-config.json` and/or the repo-root `.slashdo.json`:

```json
{ "defaults": { "depfree-allow": ["@aws-sdk/*", "pg", "prefix-*"] } }
```

Read both files separately, before the ordinary project-over-global merge. The
effective `DEPFREE_ALLOW` is their **union**, deduplicated in global-then-project
order. A project list, including `[]`, cannot drop a global allowance. Missing
files or keys contribute `[]`; unreadable files, invalid JSON, malformed objects,
or a non-array/non-string/blank entry abort the audit before classification.
Do not silently discard a policy because parsing failed. `/do:config` uses the
same validation and union when showing the effective list.

Match the **entire package name**, case-sensitively. Only `*` is special (zero or
more characters, including `/`); every other character is literal. These are
name patterns, never filesystem globs, regex input, shell commands, or links.
`@aws-sdk/*` matches `@aws-sdk/client-s3`; `pg` does not match `pg-native`.

Use the host's file tools to read and parse the two JSON files, as `/do:config`
does; do not require Node.js, Python, `jq`, or another runtime. Shell installs
and audits of non-JavaScript projects must work with those file tools alone.

Apply this runtime-independent procedure:

1. For each config file, treat only a missing file as `{}`. Read and parse an
   existing file as JSON; propagate read/parse errors. Require the top-level
   value and any present `defaults` value to be non-null objects, not arrays.
2. Read `defaults["depfree-allow"]`, using `[]` only when the key is absent.
   Require an array of strings; trim each string and reject blank entries or
   any remaining whitespace. Validate both scopes before combining them.
3. Combine global entries followed by project entries, keeping only the first
   occurrence of each case-sensitive pattern. Save the result as `DEPFREE_ALLOW`.
4. For each package, find the first pattern whose literal text and `*` wildcards
   match the entire name under the rules above. A match returns
   `{decision: "KEPT_POLICY", recommendation: "KEEP", reason: "policy allowlist",
   policy_pattern: <matching pattern>, from_policy: true}`; otherwise return null.

The function names used below and in `/do:depfree` name these operations; they
do not require executing JavaScript. When Node.js is already available, this
optional reference implementation performs the same operations. Inline it in a
local Node invocation, passing config paths as arguments and package data as
JSON, never interpolating config values or package names into shell code.

```javascript
function readDepfreeDefaults(file) {
  let text;
  try {
    text = require('node:fs').readFileSync(file, 'utf8');
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

function depfreePolicyDecision(packageName, allowlist) {
  const pattern = allowlist.find(entry => {
    const escaped = entry.split('*').map(part =>
      part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    return new RegExp(`^${escaped}$`, 'u').test(packageName);
  });
  return pattern === undefined ? null : {
    decision: 'KEPT_POLICY',
    recommendation: 'KEEP',
    reason: 'policy allowlist',
    policy_pattern: pattern,
    from_policy: true,
  };
}
```

Resolve the config paths above for this host CLI and repo, then set
`DEPFREE_ALLOW` with steps 1–3. With the optional helper this is
`resolveDepfreeAllow(readDepfreeDefaults(GLOBAL_CONFIG_PATH),
readDepfreeDefaults(PROJECT_CONFIG_PATH))`. Preserve the list through compaction.

Policy wins **before prior decisions and tier classification**, in **default,
heavy, and extreme** modes, including explicitly named packages. For each
inventory entry, apply `depfreePolicyDecision(packageName, DEPFREE_ALLOW)` first.
If non-null, record its fields in `DEPENDENCY_MAP` as a kept Tier 2 entry and skip
Phase 1c usage analysis. Never emit REMOVE/EVALUATE, propose a replacement, file
a removal issue, or dispatch remediation for `from_policy: true`.

Keep policy packages in the Phase 1a whole-tree vulnerability audit and Phase 1d
dependency graph: policy excludes removal analysis, not vulnerability reporting
or transitive accounting. Report their installed transitive footprint even if
no REMOVE candidate remains. A policy-kept parent counts as kept in every mode.

`KEPT_POLICY` in `docs/DEPS.md` is a record, not a cached allowance. Recompute it
from the current config on every run, regardless of version or mode. When an
allowance is removed, discard that old policy row and classify the package
normally; never carry it forward as `KEPT_AUDITED`.


Prior `KEPT_TRANSITIVE` decisions are also recomputed through normal classification
and Phase 1d on every run. A dependency formerly retained through a policy-kept
parent is no longer protected by that old chain after the parent's allowance is
removed; only the current kept-parent graph can justify a transitive KEEP.
