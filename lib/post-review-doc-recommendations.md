# Post-Review Convention Encoding

After a review-and-fix cycle (e.g., `/do:review`, `/do:rpr`, end of a Copilot review loop) completes, scan the findings for patterns worth encoding — so the next contributor (or AI agent) avoids the same class of issue without needing the reviewer to teach them again.

**Default action is to encode the convention in the code itself**, not to surface a CLAUDE.md suggestion. A convention buried in a wall-of-text doc bullet rots; a comment at the canonical site, a renamed helper, or a small refactor that eliminates the bug class is durable.

CLAUDE.md additions are a **fallback**, used only when the convention genuinely spans too many sites to encode locally.

## What counts as an encoding candidate

A finding earns an encoding action when ALL of the following apply:

1. **Preventable by knowing a convention**: the issue would not have happened if the contributor knew a project-level convention, invariant, or constraint.
2. **Non-obvious from the code**: a competent contributor skimming the relevant file wouldn't infer the convention from the code alone.
3. **Likely to recur**: the codebase has many similar entry points OR similar issues have appeared in past PRs/commits. One-time mistakes don't warrant encoding.

A finding is **NOT** an encoding candidate when:
- It's a one-off bug (typo, missed null check, copy-paste error, isolated logic mistake).
- The fix itself made the convention discoverable (e.g., introducing a `request()` helper that callers will find by grep).
- It's a generic best practice already covered by the review checklists.

## Action selection — prefer code over docs

For each candidate, pick the **smallest** action from this priority list that makes the convention self-evident. Stop at the first option that fits:

1. **Refactor that eliminates the bug class** — when the same mistake keeps recurring because the API invites it. Examples: pre-sanitize inside the helper instead of relying on callers to remember; collapse two parallel write paths into one; rename a misleading parameter. Keep the refactor surgical — do NOT introduce new abstractions or layers just to encode a convention. Three similar lines is better than a premature helper.
2. **In-tree comment at the canonical site** — one short line (one or two sentences max) placed where the convention is enforced or where it's most likely to be violated. Lead with the *why*, since well-named identifiers already convey the *what*. Don't reference the current PR or finding — those rot.
3. **Rename for clarity** — when a misleading or generic name (`data`, `update`, `handler`) caused the confusion. A renamed identifier teaches every caller for free.
4. **Brief addition to an existing in-tree `docs/<area>.md` or module-level `AGENTS.md`** — when the convention spans 2-5 files in a clear area and a comment in each would be redundant.
5. **CLAUDE.md / AGENTS.md fallback** — only when the convention spans the whole codebase, has no canonical enforcement site, and can't be expressed locally without scattering identical comments everywhere. This should be rare.

If even the CLAUDE.md fallback would just restate something a careful reader would catch, skip it. It's better to encode nothing than to bloat the docs.

## Bounds on auto-edits

- **One-line comments only** (or two short lines if a `Why:` plus a one-line constraint is needed). No multi-paragraph docstrings. No "this function does X" comments — those duplicate the code.
- **No new abstractions for their own sake.** A refactor is acceptable only if it makes the existing code clearer or removes a footgun; it is NOT acceptable to introduce a wrapper/helper/guard solely to have a place to attach a comment.
- **No speculative changes.** Encode only the convention demonstrated by the findings, not adjacent conventions you happen to notice.
- **Test impact**: if the refactor touches behavior, run the test suite and surface any failures. If the refactor is comment-only or rename-only, no tests need to run.
- **Stay in scope**: encoding actions should land alongside the review fixes in the same commit/PR — don't open a new branch for them.

## Output format

After applying any encoding actions and committing them, append this section to the end of the review/fix report:

```
## Conventions Encoded

For each finding pattern below, the smallest action that makes the convention self-evident from the code has been applied. CLAUDE.md additions are listed at the bottom only when the convention can't be expressed locally.

### {pattern name, e.g. "Server-owned operational fields"}
**Action**: {one of: comment at <path:line>, rename <old> → <new> at <path>, refactor in <path> (1-line summary), in-tree doc at <path>}
**Why**: {one sentence linking back to the finding(s)}

---

(repeat per encoded pattern)

### CLAUDE.md fallback (only if necessary)

**Add to {file}** (under {section}):
> {1-3 sentence convention text in the project's voice}

**Why local encoding wasn't sufficient**: {one sentence — e.g., "convention applies to every new render type and has no single dispatch site"}
```

If no findings meet the encoding criteria, print exactly:

```
## Conventions Encoded

No conventions encoded — the findings in this review were isolated and don't suggest a recurring pattern worth surfacing.
```

## Guidelines

- **One action per pattern, not per finding**: if three findings all point to "callers must use the `request()` helper", that's one encoding action (the comment / rename / refactor), not three.
- **Don't encode the fix itself**: a PR fixing a bug doesn't need a comment saying "we fixed bug X". Encode the underlying invariant or convention.
- **Project voice for any text written**: match the existing tone (terse / formal / bulleted / prose). If you haven't read the existing docs, default to plain terse prose.
- **Be honest when nothing recurs**: print the "no conventions encoded" message rather than inventing changes.
- **Read-only escape hatch**: if a candidate action would be too risky to apply automatically (large refactor, ambiguous canonical site, touches multiple subsystems), describe the action under the `Conventions Encoded` section as **"Proposed — not auto-applied"** with the rationale, instead of attempting it.
