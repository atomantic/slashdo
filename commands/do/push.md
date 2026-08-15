---
description: Commit and push all work, logging it per the project's own changelog convention
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

2. **Record the change the way this project already records changes**:

   slashdo has **no opinion about where a changelog lives or what it looks like**. Discover the project's convention and follow it. Check these sources in order and use the first that gives you an answer:

   1. **Stated convention** — the repo's `CLAUDE.md` / `AGENT.md` / `AGENTS.md`, or `CONTRIBUTING.md`, if any of them say how changes get logged. An explicit instruction wins over everything below, including anything you infer from the file tree.
   2. **Existing artifacts** — whatever changelog machinery is already in the repo. Read the most recent entries and **imitate them**: file location, heading style, grouping, tense, level of detail. Common shapes, none of them required:
      - a single rolling `CHANGELOG.md` (often Keep-a-Changelog style)
      - a per-release directory (`.changelogs/`, `.changelog/`, `docs/releases/`) — these usually pair versioned files with an unreleased staging file the release step promotes; if one exists (e.g. a `NEXT.md` next to `v1.2.3.md`), append to it, and create it only if the release tooling clearly expects it
      - a fragment tool — `.changeset/`, `changelog.d/` (towncrier), `newsfragments/`, `release-please` config. Add a fragment in that tool's format; do not hand-edit the generated changelog.
      - **nothing, because the commit log is the changelog** — a repo on conventional commits with release automation (release-please, semantic-release, git-cliff) derives its notes from commit messages. Here step 4's commit message *is* the changelog entry; write it accordingly and add no file.
   3. **No convention at all** — skip this step. Do not introduce a changelog the project never asked for, and do not invent a file name.

   When you do write an entry, two things hold regardless of format:
   - **Write it for a human reading release notes, not a coder reading the diff.** Describe the user-visible behavior or capability that changed — no file paths, module/function names, test counts, or internal symbols. Purely internal work (refactors, build/tooling, dependency housekeeping) with no user-facing effect is the exception: it can be described in code terms, under whatever heading the project uses for that.
   - **Match the project's grouping.** If the existing entries group by feature, group by feature; if they use Keep-a-Changelog's `Added` / `Changed` / `Fixed`, use those. Only when there's an unreleased file with no established shape yet, default to feature-named `##` headings (e.g. `## PR review loop`) over generic change-type buckets — a reader wants to know which capability moved.

3. **Update project documentation and task tracking per this project's own conventions**:
   - Check the target repo's `CLAUDE.md` / `AGENT.md` (or `AGENTS.md`), if present, for documentation conventions it states (e.g. "keep the README command table in sync," "update docs/ARCHITECTURE.md when adding a module") and follow them.
   - If the project tracks tasks somewhere — a `PLAN.md`, a `TODO.md`, a roadmap doc, an issue tracker — and the work you just did completes an item there, mark it done **the way that tracker already marks things done**: flip the checkbox, strike it, delete the line, close the issue. Copy the surrounding entries' convention; don't impose one.
   - Where the project uses slashdo's `[plan-id]` slug convention, **preserve the slug** on any line you touch — see [lib/plan-id-format.md](../../lib/plan-id-format.md). Referencing a finished item's slug in the commit message (e.g. `feat([slug]): …`) keeps the work grep-able across the changelog, branches, and PR titles.
   - Do not assume PLAN.md or any other specific tracking file must exist — most projects and sessions won't have one. Base what needs updating on the target repo's own AGENT/CLAUDE context and existing files, not on a fixed file-existence check.

4. **Commit and push**:
   - Stage all changed files, including any changelog or tracking file step 2 or 3 touched
   - Do NOT use `git add -A` or `git add .` - add specific files by name
   - Write a clear, concise commit message describing what was done
   - Do NOT include Co-Authored-By or generated-by annotations
   - Use conventional commit prefix: `feat:` for features, `fix:` for bug fixes, `breaking:` for breaking changes
   - Do NOT bump the version — version bumps only happen during `/release`

5. **Push the changes**:
   - Use `git pull --rebase --autostash && git push` to push safely
