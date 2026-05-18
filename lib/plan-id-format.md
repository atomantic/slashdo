# Plan-Item ID Format

PLAN.md items use stable slug IDs so concurrent agents can claim distinct
work by encoding the slug in their worktree branch name
(`cos/<task>/<plan-id>/<agent>`). Other agents detect the claim by scanning
git branches and open PRs for the slug.

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
   collapse repeated `-`, trim leading/trailing `-`.
3. **Truncate to 50 chars** at the last `-` boundary at or before the cap
   (so the slug ends on a word boundary, not a partial fragment). If there
   is no `-` within the first 50 chars (single long word), hard-truncate
   at 50.
4. **Uniqueness** — the resulting slug must not collide with any existing
   `[slug]` already in PLAN.md OR DONE.md. On collision, append `-2`,
   `-3`, … (hard-truncating the base from the right if needed so that
   `base + "-N"` stays within 50 chars).

Examples:

| Title | Slug |
| --- | --- |
| `**Extract resolveProviderAndModel into promptRunner.js.**` | `extract-resolveproviderandmodel-into-promptrunner` (truncated at 50) |
| `**Content-addressed asset dedup.**` | `content-addressed-asset-dedup` |
| `**Foo Bar.**` (first occurrence) | `foo-bar` |
| `**Foo Bar.**` (second occurrence) | `foo-bar-2` |

## Immutability

Once a slug is assigned, it is **immutable** — even if the item's title is
later edited, the slug stays the same. This is intentional: the slug
identifies the work item across PR titles, branches, and DONE.md archive
entries.

The ID-assignment pass (run by `/do:replan` and the PortOS `do-replan`
scheduled task) only assigns slugs to items that are missing one — it
never rewrites an existing slug.

## DONE.md archival

When an item moves from PLAN.md to DONE.md, the slug is preserved as a
prefix on the archived entry:

```markdown
## 2026-05-17

- **[extract-resolveproviderandmodel-into-promptrunner] Extract resolveProviderAndModel** — landed `server/lib/promptRunner.js`; consolidated three call sites.
```

This means the uniqueness check (step 4 above) scans DONE.md as well, so a
retired slug is never recycled for a future item with a similar title.
