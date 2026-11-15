# One local review phase per delivery

The Local Code Review gate and the pre-PR local reviewers run once, before the
PR/MR opens. Re-entering `/do:pr` later — to handle hosted feedback or CI, or
because creating the PR failed — must not repeat a local review that already
finished. Two checks decide that, using only git and the forge CLI. To review
again on purpose, run `/do:review`.

## 1. An open PR/MR already exists for this branch

Look it up with the selected CLI:

- GitHub: `gh pr list --head {current_branch} --base {default_branch} --state open --json number,url`
- GitLab: `glab mr list --source-branch {current_branch} --target-branch {default_branch} --output json`

A lookup that fails (auth, network) is not an empty result: stop rather than
treat it as "no PR". When one exists, adopt its number and URL, commit and push
any new work, skip "Local Code Review" and "Pre-PR Local Reviews", do not create
another PR, and continue at "Run the PR-side Reviews". Later commits are covered
by the PR-side reviewers and CI, not by a second local phase.

For the aggregate, `LOCAL_OVERALL_STATUS` is the status in this branch's note
(below) when there is one. A note that says `inconclusive` means some local
reviewer never returned a verdict: run "Pre-PR Local Reviews" once more (not the
Local Code Review gate) and record the new status, so the run is not left
blocking `--merge` for good. With no note (the PR was opened by hand or by an
older version), say that no local review ran in this invocation and count the
local phase as `clean`; do not invent a verdict or a reviewer model for it.

## 2. No PR yet, but the local phase already finished on this exact HEAD

The finished phase is recorded as a note in the branch's local git config: the
reviewed commit and the phase status. It is never committed or pushed, and git
removes it with the branch. Read it after "Commit and Push", once HEAD is final:

```bash
NOTE="$(git config --get "branch.$(git branch --show-current).slashdo-local-review" || true)"
if [ "${NOTE%% *}" = "$(git rev-parse HEAD)" ]; then echo "local review recorded for HEAD: ${NOTE#* }"; else echo "no local review recorded for HEAD"; fi
```

If it reports `clean` or `partial` for HEAD, skip "Local Code Review" and
"Pre-PR Local Reviews", restore that status as `LOCAL_OVERALL_STATUS`, and go to
"Open the PR": only the creation is retried. Otherwise — no note, a different
commit, or `inconclusive` — run the local phase normally. A rebase or a new
commit changes HEAD, so changed work is always reviewed before it is published.

## Record the finished phase

When the local phase ends with any status except `dirty` and its fixes are
committed, record it (`{LOCAL_OVERALL_STATUS}` written literally; `clean` when
`LOCAL_AGENTS` was empty and only the Local Code Review gate ran):

```bash
git config "branch.$(git branch --show-current).slashdo-local-review" "$(git rev-parse HEAD) {LOCAL_OVERALL_STATUS}"
```

If the write fails, report it and continue; the cost is one repeated local
review on a retry, never a skipped one.
