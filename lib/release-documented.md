This is an execution path, not a handoff: own preparation, review, publication,
and verification in this run. Preserve the parsed reviewer list, optional flags,
iteration caps, stop mode, and autonomous/interactive mode. Never invoke a bare
second release workflow that reloads saved reviewer defaults.

1. **Resolve the release contract without mutations.** Record the integration
   branch, PR head (if any), previous published version, version/notes owner,
   required test/build commands, publication trigger, and expected artifacts
   (tag, GitHub/GitLab Release, package, deployment, or the documented subset).
   Detect the code host first (`lib/vcs-host.md`, `{CODE_HOST}`/`{CLI_TOOL}`/`{CR_NOUN}`);
   on GitHub, additionally derive `{GH_HOST}` and authenticate using the shared
   host snippet below before forge operations — GitLab needs no equivalent, since
   `glab` resolves its host from `origin` directly. A PR/MR head must differ
   from its base; the integration branch may legitimately be both the
   development branch and publication trigger.
2. **Recover before preparing.** Fetch the relevant remote branches and inspect
   remote tags, published releases, and open/merged release PRs. Resume an existing
   prepared version or interrupted publication rather than bumping again or
   opening a duplicate PR. Confirm the version, head/base, commit, and notes agree.
   An already-merged preparation proceeds directly to publication verification;
   it does not need a new PR or another review. Never overwrite conflicting tags.
3. **Prepare in isolation.** For a documented version-bump PR, choose the version
   from unreleased commits (including breaking-change footers), then create or
   reuse an isolated worktree and the documented temporary branch from the freshly
   fetched integration ref. Keep the running application's checkout, branch, dirty
   files, and data untouched. Perform all edits, tests, commits, and pushes from
   that worktree. Follow project dependency setup rules; never install through
   symlinked dependencies. Follow the project's native version/notes command;
   when a release tool owns those outputs, let that tool produce them. The
   **Determine Version and Finalize Changelog** section supplies defaults only
   where the project has not specified them. Do not create a second version bump
   when recovering prepared state. Commit only the intended release files.
4. **Validate and review the release scope.** Run the documented tests/build,
   including isolated test-database provisioning where required. Resolve failures
   before delivery. Apply **Local Code Review** below to the full previous-release
   commit-to-prepared-head diff, replacing its promotion-only
   `git diff {target}...{source}` command with that range. A version-bump PR diff
   alone does not cover the release. Include the previous-tag comparison in the
   PR description. For a **PR workflow**, run the configured review loops from
   **Run the Review Loop** below after step 5 creates the PR and before step 6
   merges it, preserving their verdict and optionality rules from **Merge the
   PR**. For a **tool-managed or tag-only workflow** — which never creates a
   PR — run every configured **local-agent and Ollama** reviewer (`codex`,
   `agy`, `claude`, `grok`, `pi`, `cursor`, `opencode`, `cmd`, `ollama`) against this
   same prepared diff **before** step 5's submission command, enforcing their
   aggregate verdict exactly as **Merge the PR** would gate a merge; a
   configured `copilot` or `@<login>` reviewer has no PR to attach to on this
   path; a required (non-`~opt`) one is not requestable at all here, so report
   INCOMPLETE naming it rather than publishing ungated, while an `~opt` one is
   skipped. Those sections' promotion-specific delivery commands are replaced
   by steps 5–7 here.
5. **Publish the preparation.** For a PR workflow, push its head and read back the
   exact remote SHA, create or reuse the matching head/base PR, and read back its
   URL, head SHA, base, and state. For tool-managed or tag-only workflows, run the
   documented submission command — only once step 4's review gate is clean —
   and verify its equivalent remote preparation. Do not fabricate a PR for a
   process that does not use one. Empty, failed, or mismatched readback is
   INCOMPLETE; preserve the prepared state for retry.
6. **Deliver through the project's gates.** For an open PR, wait for the expected
   CI on the current head and satisfy the configured review gate before merging
   with a repository-supported method. No reported checks is not green when CI
   is expected: poll for up to five minutes, then report INCOMPLETE if none attach.
   Diagnose and fix red CI; never merge over a failure. Read back `state=MERGED`,
   `mergedAt`, and `mergeCommit`, fetch the integration branch, and verify it
   contains that merge commit. Squash/rebase merges need verification of the
   merged version and release-file contents, not ancestry of the pre-merge head.
7. **Verify publication, respecting its owner.** Watch the documented release
   pipeline for the merge/tag/dispatch being delivered and require success.
   **When automation creates the tag or release, wait for it; do not pre-create
   its tag using the generic Post-Merge commands.** That can make automation skip
   publication. Bound the wait (five minutes unless project docs specify another
   bound); a queued, failed, missing, or inconclusive pipeline is INCOMPLETE.
   Read back each required artifact: resolve the remote tag to a commit on the
   verified release lineage, check the GitHub/GitLab Release's tag and
   published/non-draft status (`gh release view` / `glab release view` —
   GitLab Releases have no draft state, so treat a readable release as
   non-draft) and prerelease status appropriate to this release, and verify package
   version or deployment identity when documented. Recover a missing artifact
   only by the documented recovery procedure; never overwrite an existing tag or
   claim publication merely because the PR merged.
8. **Report and stop.** Report the version, preparation SHA, PR URL/merged SHA
   when applicable, integration SHA, and verified artifact URLs/identities. A
   documented no-release-needed result is valid. Otherwise identify the first
   unverified checkpoint as INCOMPLETE and preserve recoverable state. Clean up
   only the temporary resources created by this run after successful verification.
   **Do not fall through into the generic promotion workflow after this path.**

