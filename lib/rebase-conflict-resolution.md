# Autonomous Rebase Conflict Resolution

Use this playbook whenever a required `git rebase` or `git pull --rebase` stops
with conflicts. A conflict is a resolution step in the PR workflow, not by itself
a reason to abort, stop, or ask the user to take over.

## Required posture

- **Resolve and continue by default.** Do not abort merely because Git reports
  conflicts. Preserve both the latest base branch contract and the intent of the
  commit being replayed.
- Keep the resolution scoped to the conflicted paths and any source-of-truth files
  that must change with them. Preserve unrelated user changes and commits.
- Never blanket-select `--ours` or `--theirs`, never hard-reset the branch, and
  never use a bare `--force`. During a rebase those labels describe Git's replay
  mechanics, not "the user's work" versus "upstream," so choosing by label alone
  can silently discard the feature.
- A generated-file conflict alone is never an ambiguity that needs user input.
  Regenerate it from the resolved canonical sources.

## Resolution loop

Repeat these steps for every commit at which the rebase stops:

1. **Inspect the replay context before editing.** Run:

   ```bash
   git status --short
   git diff --name-only --diff-filter=U
   git rebase --show-current-patch
   ```

   Read every conflicted file in full plus the related callers, tests, schemas, and
   recent history. When useful, inspect the index stages with `git show :1:<path>`,
   `git show :2:<path>`, and `git show :3:<path>`; interpret them in the context of
   the current patch rather than trusting the ours/theirs labels.

2. **Resolve human-authored sources semantically.** Incorporate upstream's current
   API, schema, or structure while retaining the behavior the replayed commit was
   adding. Trace renamed/moved files and producer-consumer contracts instead of
   resolving only the marker lines. Use tests and call sites to decide the combined
   result.

3. **Regenerate generated artifacts; do not hand-merge them.** For a path identified
   by a generated header, filename, repository docs, or adjacent tooling (for
   example `server/lib/apiRouteCatalog.generated.json`):

   - Locate its canonical inputs and generator using nearby docs, package scripts,
     build scripts, and repository search.
   - Resolve the human-authored inputs first.
   - If the generator needs the output to be parseable, temporarily replace the
     conflicted output with either complete index stage only as a seed. That choice
     is not the resolution.
   - Run the repository's canonical generator and use its complete output as the
     resolution. Run the corresponding generated-drift, schema, or catalog check.
   - If no generator exists, reconstruct the output from the canonical sources and
     validate it with the repository's existing checks. Do not guess from conflict
     markers alone.

4. **Stage and continue only when the stop is fully resolved.** Stage only the
   files resolved for the current replayed commit, then run:

   ```bash
   test -z "$(git diff --name-only --diff-filter=U)"
   git diff --check
   git diff --cached --check
   GIT_EDITOR=true git rebase --continue
   ```

   If Git stops again, return to step 1. If a replayed commit becomes empty, verify
   from the current patch, history, and tests that its full intent is already on the
   new base; only then use `git rebase --skip`.

5. **Verify the completed rebase.** Confirm Git is no longer mid-rebase, the expected
   feature branch is checked out, and there are no unmerged paths. Run the focused
   generator/schema checks and tests for every resolution, then the caller's normal
   build/test gate. Continue the push, review, and PR-creation workflow from the
   step that encountered the conflict; a resolved rebase is not a terminal status.

## Last-resort abort

Abort only after the inspection above exposes a genuine, material ambiguity that
cannot be answered from the replayed commit, canonical sources, generator, callers,
tests, or repository history, or after required resolution tooling remains
unavailable with no deterministic fallback. Before reporting that blocker, run
`git rebase --abort`, verify the original branch/commit and clean state were
restored, and report the exact incompatible choices or missing tool plus the checks
performed. Never stop with only "rebase conflict" or "generated file conflict" as
the reason.
