---
description: Commit and push all work with changelog
---

# Commit All My Work (cam)

Commit and push all work from this session, updating documentation as needed.

## Instructions

1. **Identify changes to commit**:
   - Run `git status` and `git diff --stat` to see what changed
   - If you edited files in this session, commit only those files
   - If invoked without prior edit context, review all uncommitted changes
   - if there are files that should be added to the .gitignore that are not yet there, ensure we have proper .gitignore coverage

2. **Update the changelog**:
   - Check for a changelog directory: `.changelogs/` or `.changelog/` (use whichever exists)
   - If found, append to `{changelog_dir}/NEXT.md`
   - If `NEXT.md` doesn't exist yet, create it with this template:
     ```markdown
     # Unreleased Changes

     ## Added

     ## Changed

     ## Fixed

     ## Removed
     ```
   - Add a concise entry describing the changes under the appropriate section (Added, Changed, Fixed, Removed)
   - If no changelog directory exists, skip this step

3. **Update PLAN.md** (if exists):
   - Mark completed items as done
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

## Important

- Never stage files you didn't edit
- Never use `git add -A` or `git add .`
- Keep commit messages focused on the "why" not just the "what"
- If there are no changes to commit, inform the user
- Do NOT bump the version in package.json — `/release` handles versioning
