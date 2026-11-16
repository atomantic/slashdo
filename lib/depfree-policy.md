### Dependency policy allowlist

`defaults["depfree-allow"]` is an array of package-name patterns in the host CLI's
global `~/.claude/.slashdo-config.json` and/or the repo-root `.slashdo.json`:

```json
{ "defaults": { "depfree-allow": ["@aws-sdk/*", "pg", "prefix-*"] } }
```

Read and parse the two files with the host's file tools. This must work in
projects with no Node.js, Python or `jq` installed.

**Load.** Read both files separately, before the ordinary project-over-global
merge of other keys.

1. A missing file, or a missing `depfree-allow` key, contributes `[]`.
2. Anything else that is wrong stops the command with an error before any
   package is classified: an unreadable file, invalid JSON, a top-level value or
   `defaults` value that is not a plain object, a `depfree-allow` that is not an
   array, or an entry that is not a string, is blank, or contains whitespace
   after trimming. A policy that failed to parse must not be silently dropped,
   because the packages it protects would then be proposed for removal.
3. `DEPFREE_ALLOW` is the **union**: the trimmed global entries followed by the
   trimmed project entries, keeping the first occurrence of each pattern
   (compared case-sensitively). A project list, including `[]`, cannot remove a
   global allowance.

| Global | Project | `DEPFREE_ALLOW` |
|---|---|---|
| `["@aws-sdk/*", "pg"]` | `["pg", "prefix-*"]` | `["@aws-sdk/*", "pg", "prefix-*"]` |
| `["@aws-sdk/*", "pg"]` | `[]` | `["@aws-sdk/*", "pg"]` |
| `["pg"]` | `[" pg ", "prefix-*", "prefix-*"]` | `["pg", "prefix-*"]` |

**Match.** A pattern is compared with the **entire** package name,
case-sensitively. `*` matches zero or more characters, including `/`; every
other character is literal. Patterns are names, not filesystem globs, regular
expressions or shell input. The first matching pattern in `DEPFREE_ALLOW` is the
one reported.

| Pattern | Package name | Matches |
|---|---|---|
| `@aws-sdk/*` | `@aws-sdk/client-s3` | yes |
| `@aws-sdk/*` | `@aws-sdkx/client-s3` | no |
| `@aws-sdk/*` | `other/@aws-sdk/client-s3` | no |
| `pg` | `pg` | yes |
| `pg` | `pg-native` | no |
| `pg` | `PG` | no |
| `prefix-*` | `prefix-utils` | yes |
| `prefix-*` | `prefix-` | yes |
| `prefix-*` | `other-prefix-utils` | no |
| `lib.js` | `libXjs` | no |
| `*` | `any-package` | yes |
