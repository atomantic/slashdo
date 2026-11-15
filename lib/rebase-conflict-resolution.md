# Autonomous Rebase Conflict Resolution

Use this whenever a required `git rebase` or `git pull --rebase` stops with conflicts.
A conflict is a step to work through in the PR workflow, not a reason to abort or hand
the branch back to the user.

## Posture

- **Resolve and continue.** Keep both the current base branch's contract and the
  intent of the commit being replayed, and keep the resolution scoped to the conflicted
  paths plus any source-of-truth files that must change with them.
- **Do not choose a side by label.** During a rebase `--ours` is the base being
  replayed onto and `--theirs` is your own commit, the reverse of a merge, so a blanket
  `--ours`/`--theirs` can silently discard the feature. For the same reason do not
  hard-reset the branch or use a bare `--force`.
- **A generated file is regenerated, not hand-merged**, and its conflict alone is never
  an ambiguity that needs the user.

## At each stop

1. **Look at what is being replayed** before editing: `git status --short`,
   `git diff --name-only --diff-filter=U`, and `git rebase --show-current-patch`. Read
   the conflicted files with their callers and tests; `git show :1:<path>` / `:2:` /
   `:3:` show the common ancestor, the new base's version, and the replayed commit's
   version.
2. **Resolve human-authored sources by meaning**: take upstream's current API, schema or
   structure and keep the behavior the replayed commit adds. Follow renames and moves
   rather than resolving only the marker lines.
3. **Regenerate generated artifacts** (a path marked by a generated header, a
   `*.generated.*` name, the project's docs, or adjacent tooling). Resolve their
   human-authored inputs first, then run the project's own generator and take its whole
   output, followed by its drift or schema check. If the generator needs a parseable
   file to start from, seed it with either index stage; the seed is not the resolution.
   With no generator, rebuild the output from the canonical sources and validate it with
   the project's existing checks.
4. **Stage only what you resolved for this commit, then continue:**

   ```bash
   test -z "$(git diff --name-only --diff-filter=U)"
   git diff --check
   git diff --cached --check
   GIT_EDITOR=true git rebase --continue
   ```

   `GIT_EDITOR=true` keeps the continue from opening an editor. If a replayed commit
   becomes empty, use `git rebase --skip` only after confirming from the patch and the
   new base that its whole intent is already there.

When the rebase finishes, confirm Git is no longer mid-rebase, the expected branch is
checked out and nothing is unmerged; run the checks for whatever you resolved and then
the caller's normal build/test gate; and carry on with the push, review or PR step that
hit the conflict. A resolved rebase is not a stopping point.

## Last-resort abort

Abort only for a genuine, material ambiguity that the replayed commit, the canonical
sources, the generator, callers, tests and history cannot answer, or when required
tooling is unavailable with no deterministic fallback. Then run `git rebase --abort`,
verify the original branch, commit and clean state are restored, and report the exact
incompatible choices or the missing tool, plus what you checked. "Rebase conflict" or
"generated file conflict" alone is never the reason.
