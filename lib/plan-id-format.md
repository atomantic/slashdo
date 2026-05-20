# Plan-Item ID Format

PLAN.md items use stable slug IDs so concurrent agents can claim distinct
work by encoding the slug in their worktree branch name
(`cos/<task>/<plan-id>/<agent>`). Other agents detect the claim by scanning
git branches and open PRs for the slug.

The 50-char slug cap (see step 3 below) is sized for the branch-name
budget: many CI/hosting integrations cap full ref names at ~244 chars, so
keeping each segment tight leaves room for the `cos/<task>/<plan-id>/<agent>`
wrapper and any `-2`/`-3` collision suffix without bumping that limit.

## Shape

Every `- [ ]` / `- [x]` checkbox carries an ID **immediately after the
checkbox brackets**:

```markdown
- [ ] [universe-builder-redesign-trunks] **Universe Builder redesign — trunks layout.** Description...
- [x] [old-finished-task] **Old item.** Already done.
  - [ ] [phase-a-data-model] **Phase A — Data model + migration.** Nested sub-item.
```

Headings, prose, numbered "Next Up" intros, and bare bullets without a
checkbox are NOT given IDs — the unit of work is the checkbox.

## Slug derivation

The slug is derived deterministically from the item's title text:

1. **Strip markdown wrappers** — `**bold**` → `bold`, `` `code` `` → `code`,
   `[text](url)` → `text`, `~~struck~~` → `struck`. Remove HTML comments
   (e.g. `<!-- NEEDS_INPUT -->`).
2. **Lowercase, kebab-case** — replace any run of non-`[a-z0-9]` with `-`,
   collapse repeated `-`, trim leading/trailing `-`. Note: camelCase tokens
   are **flattened** because there is no non-alphanumeric boundary inside
   them — e.g. `resolveProviderAndModel` becomes `resolveproviderandmodel`,
   not `resolve-provider-and-model`. If you want readable word boundaries
   inside a camelCase identifier, manually space-separate it in the title.
3. **Truncate to 50 chars** at the last `-` boundary at or before the
   cap (so the slug ends on a word boundary, not a partial fragment),
   then trim any trailing `-` left behind by the truncation. Precise
   semantics: take the longest prefix of the kebab string whose length
   is ≤ 50 chars *and* which ends in `-`; drop the trailing `-`. If
   there is no `-` within the first 50 chars (single long word),
   hard-truncate at 50 and skip the trailing-`-` trim (there is none).
   Worked example: a 52-char kebab `extract-…-promptrunner-js` has a
   `-` at position 50 (1-indexed, immediately before `js`); the
   ≤-50-char prefix ending in `-` is positions 1–50 (the string up to
   and including that `-`); trimming the trailing `-` yields a 49-char
   slug.
4. **Uniqueness** — the resulting slug must not collide with any existing
   `[slug]` already in PLAN.md. On collision, append `-2`,
   `-3`, … (hard-truncating the base from the right if needed so that
   `base + "-N"` stays within 50 chars). After each right-trim the
   resulting `base + "-N"` may itself collide with an unrelated existing
   slug that happens to be a prefix of the original — **re-run the
   uniqueness check after every truncation+suffix step, bumping `N`
   until the candidate is unique against PLAN.md**. The
   right-trimmed base is not required to end on a word boundary (rule 3's
   word-boundary guarantee applies only to the initial 50-char
   truncation).

   Note: slugs are only checked for collision against PLAN.md. Completed
   items are removed from PLAN.md (not archived to a separate file) — the
   audit trail of which slugs once existed lives in `git log` and the
   changelog. A retired slug *can* theoretically be reused for a brand-new
   item, but in practice the title-derivation rules make accidental reuse
   unlikely; reach into git history if you need to confirm.

Examples:

| Title | Slug |
| --- | --- |
| `**Extract resolveProviderAndModel into promptRunner.js.**` | `extract-resolveproviderandmodel-into-promptrunner` (truncated at last `-` boundary ≤50; result is 49 chars) |
| `**Content-addressed asset dedup.**` | `content-addressed-asset-dedup` |
| `**Foo Bar.**` (first occurrence) | `foo-bar` |
| `**Foo Bar.**` (second occurrence) | `foo-bar-2` |

**Worked example for the first row** (subtle enough to deserve a trace):

1. Strip wrappers: `Extract resolveProviderAndModel into promptRunner.js.`
2. Lowercase + kebab: `.` is non-alphanumeric so the `.js.` segment
   becomes `-js-`, then trailing-`-` trim gives the intermediate
   pre-truncation slug `extract-resolveproviderandmodel-into-promptrunner-js`
   (52 chars). Note `resolveProviderAndModel` is *flattened* to
   `resolveproviderandmodel` because camelCase has no internal
   non-alphanumeric boundary — see rule 2.
3. Truncate at the last `-` ≤ position 50: the `-` immediately before
   `js` sits at position 50 (1-indexed), so the longest prefix ending
   in `-` whose length is ≤ 50 is exactly the first 50 chars:
   `extract-resolveproviderandmodel-into-promptrunner-`. Trim the
   trailing `-` for a final 49-char slug.
4. Uniqueness: no collision in this example, so we stop here.

## Immutability

Once a slug is assigned, it is **immutable** — even if the item's title is
later edited, the slug stays the same. This is intentional: the slug
identifies the work item across PR titles, branches, commit messages, and
changelog entries.

The ID-assignment pass (run by `/do:replan` and the PortOS `do-replan`
scheduled task) only assigns slugs to items that are missing one — it
never rewrites an existing slug.

### Strict positional pattern for the Phase 0 collision scan

The Phase 0 uniqueness check must only collect `[slug]` tokens from
fixed positions to avoid false collisions with legitimate non-slug
brackets (inline markdown links `[text](url)`, references like
`see [docs/x.md]`, etc.) that may appear inside item descriptions:

- **PLAN.md**: only the bracketed token at position 3 on a checkbox
  line (right after `- [ ] ` or `- [x] `, including nested-indent
  variants like `  - [ ] [slug] …`). Regex sketch:
  `^\s*-\s+\[[ x]\]\s+\[([a-z0-9-]+)\]\s`.

Brackets in any other position (mid-description links, inline `[…]`
references, multi-bracket prose) MUST be ignored — they are not slugs
and treating them as taken would force collision suffixes onto
unrelated future items.

**Permissive matching by design.** The `[a-z0-9-]+` character class
accepts a single leading or trailing `-` even though the derivation
rules trim them. Hand-edited PLAN.md entries with a malformed slug
like `[-foo-]` will be picked up by the collision scan as taken (which
is the safe choice — collide against the malformed slug, don't reissue
it). Implementations that want to reject malformed slugs at collection
time can use the stricter `[a-z0-9]+(-[a-z0-9]+)*` pattern.

**Domain-specific shape conventions live in the per-command docs, not
here.** The slug-derivation rules in this file are *general*: they map
a title string to a kebab slug. Commands that want a more specific
shape — e.g. `do:depfree` requiring `drop-<scope>-<pkg>` so scoped
npm packages don't collapse to the same slug as their unscoped
namesake (see `commands/do/depfree.md`) — encode that convention in
the title text *before* applying the rules here. The collision scan
still treats the resulting slug as opaque.
