# Review Fix Conventions

When fixing a review finding, also close off *why it existed in the first place* — catching that now, while the context is fresh, is far cheaper than retrofitting it later from a retrospective.

## Per finding

After applying the direct fix, ask: **"What was the contributor missing that allowed this to land?"** If a category below fits, apply its minimal action in the same change. If none fit — a genuine one-off (typo, off-by-one, isolated copy-paste slip) — skip and move on.

- **Lint / format gap** (an analyzer would have caught this) — enable the missing rule if the project already runs that linter; investigate why an enabled rule didn't fire. Don't introduce a new linting tool.
- **Type / contract gap** — tighten the type at the declaration site (narrow a union, replace `any`, mark a field non-optional). No type-system refactor.
- **Missing comment at the canonical site** — the fix relied on a non-obvious invariant stated nowhere it's enforced. Add one short comment (1–2 lines), leading with the *why*.
- **Misleading name** — rename locally. No codebase-wide rename unless naming is already inconsistent.
- **API invites the mistake** — a surgical refactor that absorbs the missing step into the helper, or collapses parallel write paths. No new abstraction just to encode the convention — three similar lines beats a premature helper.
- **Missing test** (and the area already has test culture) — add one focused regression test.
- **Missing context** — add a one-line comment pointing at the existing helper/pattern.

**Bounds**: one action per finding, the smallest that fits. No new tooling, dependencies, or abstractions. No speculative changes beyond what this finding demonstrated. If the action would be a large refactor, a cross-cutting rename, or spans multiple subsystems, defer it to end-of-cycle instead of attempting it inline.

## End of cycle

After a review-and-fix cycle completes (`/do:review`, `/do:rpr`, a Copilot loop), scan the findings for patterns that recurred, or were deferred above as too large for one finding. A pattern earns encoding only when it's preventable by knowing a convention, not obvious from the code alone, and likely to recur (many similar entry points, or it's shown up before) — never for a one-off.

Pick the smallest action that makes the convention self-evident, same priority order as above, plus a brief addition to an existing in-tree `docs/<area>.md`/`AGENTS.md` when it spans 2-5 files. **CLAUDE.md / AGENTS.md is the fallback**, used only when the convention spans the whole codebase with no single enforcement site. One action per pattern, not per finding. Land encoding actions in the same branch/commit as the review fixes.

## Output

Append this to the end of the review/fix report:

```
## Conventions Encoded

### {pattern name}
**Action**: {comment at <path:line> | rename <old> → <new> at <path> | refactor in <path> (1-line summary) | in-tree doc at <path>}
**Why**: {one sentence linking back to the finding(s)}

---
(repeat per encoded pattern)

### CLAUDE.md fallback (only if necessary)
**Add to {file}** (under {section}): {1-3 sentence convention text in the project's voice}
**Why local encoding wasn't sufficient**: {one sentence}
```

If no findings meet the criteria, print exactly:

```
## Conventions Encoded

No conventions encoded — the findings in this review were isolated and don't suggest a recurring pattern worth surfacing.
```

Always print the section — never omit it, even for an all-nitpick round.
