# Post-Review Documentation Recommendations

After a review-and-fix cycle (e.g., `/do:review`, `/do:rpr`, end of a Copilot review loop) completes, scan the findings for patterns worth surfacing in project documentation — so the next contributor (or AI agent) avoids the same class of issue without needing the reviewer to teach them again.

This phase is **read-only on project docs** — it surfaces concrete suggestions the user accepts or rejects. Do NOT auto-edit CLAUDE.md, README.md, or any project documentation file.

## What counts as a documentation candidate

A finding earns a doc recommendation when ALL of the following apply:

1. **Preventable by knowing a convention**: the issue would not have happened if the contributor knew a project-level convention, invariant, or constraint.
2. **Non-obvious from the code**: a competent contributor skimming the relevant file wouldn't infer the convention from the code alone (e.g., it lives in one helper but is the established pattern everywhere).
3. **Likely to recur**: the codebase has many similar entry points OR similar issues have appeared in past PRs/commits. One-time mistakes don't warrant a doc change.

A finding is **NOT** a doc candidate when:
- It's a one-off bug (typo, missed null check, copy-paste error, isolated logic mistake).
- The fix itself made the convention discoverable (e.g., introducing a `request()` helper that callers will find by grep).
- It's a generic best practice already covered by the review checklists — those belong in `lib/code-review-checklist.md` and the agent files, not in project docs.
- The recommendation would be documentation about what one function does — that's a code-level comment or a self-documenting rename, not project documentation.

## Where to recommend each update

Match each doc candidate to the right surface:

- **`CLAUDE.md`** (or `.claude/CLAUDE.md`, `AGENTS.md` — whichever the project already uses) — codebase-level conventions an AI agent or human contributor should know before editing: auth model, error class hierarchy, "we don't mock the DB", custom helper conventions (`use request() not fetch()`), platform constraints, "never touch X without doing Y".
- **`CONTRIBUTING.md`** — contributor process: how to run tests, branch naming, commit format, review expectations, what kinds of PRs are out of scope.
- **`README.md`** — setup, build, run, ports, service dependencies, environment variables a new contributor must set.
- **`docs/<area>.md`** or an in-tree `AGENTS.md` — architecture explanations that span multiple files (data flow, state machine, lifecycle, plugin contracts, the canonical place to add a new X).
- **In-tree comment near the relevant code** — invariants too narrow for top-level docs but easy to miss when editing one file (e.g., "this list must remain sorted by `priority` because `findFirst` does binary search").

If the project doesn't have a CLAUDE.md / AGENTS.md and a candidate clearly belongs there, suggest creating it (not actively — recommend it).

## Output format

Append this section to the end of the review/fix report:

```
## Documentation Recommendations

Based on the {N} findings addressed in this review, the following project documentation updates would help prevent the same class of issue in future PRs:

### {target file path} — {one-line purpose}

**Add**:
> {exact text to paste, 1-3 sentences, written in the project's existing voice if known}

**Why**: {one sentence linking back to the finding(s) that motivated it}

---

(repeat per recommendation; group multiple recommendations under the same file when they fit together)
```

If no findings meet the doc-candidate criteria, print exactly:

```
## Documentation Recommendations

No project documentation updates recommended — the findings in this review were isolated and don't suggest a recurring convention worth surfacing.
```

## Guidelines

- **Quote-able text**: write the proposed addition as if pasting it directly. The user should be able to copy it without rewording.
- **Project voice**: if the existing docs use a particular tone (terse / formal / bulleted / prose), match it. If you haven't read the existing docs, suggest the addition in plain prose and flag that the user may want to reformat.
- **One recommendation per pattern, not per finding**: if three findings all point to "callers must use the `request()` helper, not bare `fetch()`", that's one recommendation, not three.
- **Don't recommend documentation of the fix itself**: a PR fixing a bug doesn't need a doc note saying "we fixed bug X". Document the underlying invariant or convention instead.
- **Be honest when nothing recurs**: it's better to print the "no recommendations" message than to invent doc changes for the sake of output.
