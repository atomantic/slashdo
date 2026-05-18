# Per-Finding Root Cause

When fixing each review finding, also identify *why the finding existed in the first place* and apply the smallest fix to that root cause **in the same change**. Catching it now — while context is fresh — is much cheaper than retrofitting later from a retrospective. The end-of-loop **Convention Encoding** phase (see `~/.claude/lib/post-review-doc-recommendations.md`) still runs at the end of the review cycle to pick up cross-cutting patterns; this per-finding step catches the easy cases as they happen.

## After applying each direct fix

Pause briefly (~10–30 seconds, not a full investigation) and ask: **"What was the contributor missing that allowed this to land?"** Match the answer to one of the categories below, then apply the minimal action. If none fit — the finding was a genuine one-off — move on.

## Root cause categories and minimal actions

- **Lint / format gap** — a common static analyzer would have flagged this (unused import, missing `await`, dead code, `==` vs `===`, missing return type, swallowed promise). **Action**: if the project already runs the relevant linter, enable the missing rule; if the rule is on, investigate why it didn't fire. *Do not* introduce a brand-new linting tool as part of a review fix — that's out of scope.
- **Type / contract gap** — a stronger type or schema would have made the mistake impossible. **Action**: tighten the type at the declaration site (narrow `string` → union, replace `any` with the concrete shape, mark a field non-optional). No type-system refactor.
- **Missing / wrong comment at the canonical site** — the fix relied on a non-obvious invariant that wasn't stated where it's enforced ("this list must stay sorted", "this field is server-owned", "this helper sanitizes internally"). **Action**: add one short comment (1–2 lines max), leading with the *why*.
- **Misleading name** — the wrong call/value was passed because an identifier suggested the wrong semantics (`data`, `update`, `handler`, an ambiguous boolean flag). **Action**: rename locally. No codebase-wide rename unless naming is already inconsistent across files.
- **API invites the mistake** — the helper's signature makes the bug easy to write (caller has to remember to sanitize; two parallel write paths exist; an enum value silently defaults). **Action**: surgical refactor to absorb the missing step into the helper, OR collapse the parallel paths. *No new abstractions just to encode the convention* — three similar lines is better than a premature helper.
- **Missing test** — the bug class is easy to regress and the project already has tests covering this code path. **Action**: add one focused regression test. Skip if no test culture exists for this area.
- **Missing context** — the contributor didn't know about a related helper, constraint, or pattern that's already established elsewhere. **Action**: add a one-line comment with a pointer (`// see <path> for the canonical sanitizer`).
- **None — one-off mistake** — typo, off-by-one, isolated copy-paste error, transient logic slip with no systemic cause. **Action**: skip; move on.

## Bounds

- **One root-cause action per finding.** Pick the smallest that fits; don't stack actions.
- **No new tooling, dependencies, or abstractions.** Enabling an already-configured lint rule is in scope; adding a new linter, framework, or wrapper helper is not.
- **No speculative changes.** Only address the root cause demonstrated by this finding, not adjacent concerns you happen to notice.
- **Defer big actions to end-of-loop Convention Encoding.** If the root-cause action would be a large refactor or touches multiple subsystems, note it (as `# Root cause deferred: <one-line description>` in the commit body or a scratch list) and let the end-of-loop phase aggregate it.
- **Cross-finding patterns also defer up.** If the same root cause keeps surfacing across many findings, address only the local instances now — the end-of-loop Convention Encoding phase will pick up the cross-cutting pattern in aggregate.

## Commit message

When the root-cause action is non-trivial, mention it in the commit body (not the subject):

```
fix: prevent stale write in CharacterReferenceSheetPanel

Root cause: PATCH-preserve guard didn't cover the mutator path.
Encoded: comment at server/models/character.js:142 explaining
referenceSheetImageRef ownership.
```

If the root-cause action was a single comment line or enabling an existing lint rule, the diff speaks for itself — no callout needed.
