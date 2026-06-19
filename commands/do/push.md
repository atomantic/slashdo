---
description: Commit and push all work with changelog
---

# Push — Commit and Push All Work

Commit and push all work from this session, updating documentation as needed.

## Instructions

1. **Identify changes to commit**:
   - Run `git status` and `git diff --stat` to see what changed
   - If there are no changes to commit, inform the user and stop
   - If you edited files in this session, commit only those files
   - If invoked without prior edit context, review all uncommitted changes
   - if there are files that should be added to the .gitignore that are not yet there, ensure we have proper .gitignore coverage

2. **Update the changelog**:
   - Check for a changelog directory: `.changelogs/` or `.changelog/` (use whichever exists)
   - If found, append to `{changelog_dir}/NEXT.md`
   - If `NEXT.md` doesn't exist yet, create it with this template:
     ```markdown
     # Unreleased Changes
     ```
   - **Group entries by feature, not by change-type.** Each `##` heading is the name of a feature or capability the work touched (e.g. `## PR review loop`, `## Plan claiming`), and the bullets beneath it describe what changed for that feature. Do NOT create generic `## Added` / `## Changed` / `## Fixed` / `## Removed` buckets. If a relevant feature heading already exists in `NEXT.md`, add your bullet under it instead of starting a new one.
   - **Write entries for a human reading release notes, not a coder reading the diff.** Describe the user-visible behavior or capability that changed — no file paths, module/function names, test counts, or internal symbols. The one exception: purely internal code-administration/organization work (refactors, build/tooling, dependency housekeeping) with no user-facing effect — group those under a `## Internal` (or similarly named) heading and describe them in code terms, since there's nothing user-facing to express.
   - Example:
     ```markdown
     # Unreleased Changes

     ## PR review loop
     - Local reviewers now run before the PR is opened; Copilot runs after.

     ## Internal
     - Consolidated changelog-template logic shared by push and next.
     ```
   - If no changelog directory exists, skip this step

3. **Update PLAN.md** (if exists):
   - Mark completed items as done by flipping `- [ ]` → `- [x]`
   - **Preserve the `[plan-id]` slug** on any line you touch — only the box character changes, the slug stays. See [lib/plan-id-format.md](../../lib/plan-id-format.md) for the slug convention. If you reference a finished item in the commit message or changelog, include its slug (e.g. `feat([slug]): …`) so the work is grep-able across the changelog, branches, and PR titles.
   - Update progress notes if relevant
   - Skip if no PLAN.md exists or changes aren't plan-related

4. **Commit and push**:
   - Stage all changed files (including `NEXT.md` if updated)
   - Do NOT use `git add -A` or `git add .` - add specific files by name
   - Write a clear, concise commit message describing what was done
   - Do NOT include Co-Authored-By or generated-by annotations
   - Use conventional commit prefix: `feat:` for features, `fix:` for bug fixes, `breaking:` for breaking changes
   - Do NOT bump the version — version bumps only happen during `/release`

5. **Push the changes**:
   - Use `git pull --rebase --autostash && git push` to push safely
