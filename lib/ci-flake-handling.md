# CI Flake Handling

When a merge gate watches CI in-session and a **required** check fails, the failure is one of two things: a *real* regression in the diff, or a *flake* — a non-deterministic failure (worker-teardown race, async-logging teardown, network blip, ordering-dependent test) that has nothing to do with the change. Treating every red as real strands finished PRs behind noise; treating every red as a flake merges broken code. This routine distinguishes them with **one conservative re-run on the same commit** — no signature list, nothing project-specific.

Apply it **only** on the in-session watch path (where the gate is actively polling `gh pr checks` / `glab ci status`), not on GitHub-native `--auto` merge — auto-merge already re-evaluates required checks itself and lands only when they pass, so there is nothing to re-run. Never use it to bypass branch protection.

## The rule

A failure is a **flake only if the *same commit* both fails and passes.** Same SHA is non-negotiable — re-running after any new push proves nothing, because a different tree could pass for real reasons. Re-run the failed jobs **at most once**:

1. **Capture the failing SHA and jobs.** `HEAD_SHA=$(gh pr view <number> --json headRefOid -q .headRefOid)`. List the failed required checks (`gh pr checks <number> --required` → the `fail`/`failure` rows) so you re-run and re-judge *only those*, not the whole suite.
2. **Re-run the failed jobs on the unchanged commit** (GitHub): find the failing run and re-run just its failed jobs — `gh run rerun <run-id> --failed`. Get `<run-id>` from `gh run list --branch <branch> --json databaseId,headSha,conclusion` filtered to `headSha == $HEAD_SHA`. (GitLab: `glab ci retry` against the failed jobs of the pipeline for `$HEAD_SHA`.) Confirm the re-run is attached to `$HEAD_SHA` before trusting it — if the branch advanced, abort the flake-check and treat the state as a fresh failure.
3. **Re-watch the required checks**: `gh pr checks <number> --required --watch --fail-fast`.
   - **Pass on re-run → flake.** The same commit now passes; proceed with the merge as if CI were green. **Log it**: report which check failed-then-passed and that it was treated as a flake, with the run URL — a silent auto-rerun hides a real intermittent failure that deserves a fix.
   - **Fail again on re-run → real.** Leave the PR open and report which required check failed, with the run URL. Do **not** re-run a second time — one re-run is the whole budget; a check that fails twice on the same SHA is a real failure, not bad luck.

## Boundaries

- **One re-run, ever, per gate invocation.** Re-running until green is how broken code merges. If the first re-run still fails, stop and surface it.
- **Required checks only.** An optional/non-required job's failure never blocked the merge to begin with — don't re-run it.
- **Same SHA only.** If anything pushed to the branch between the failure and the re-run, the comparison is void — treat the latest result as authoritative and do not claim "flake."
- **No project-specific signature matching here.** This routine is deliberately mechanism-only (fails-then-passes-on-same-commit). A project that wants to *recognize* a known flake signature and react faster should encode that in its own `CLAUDE.md`/`AGENTS.md`, not in slashdo — keep this command project-agnostic.
