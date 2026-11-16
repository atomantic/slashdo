# Release v4.4.0

Released: 2026-11-15

## Highlights

- **Local CLI reviewer runner ships as an installed script.** The runner that drives local review CLIs is now a real script installed with slashdo instead of bash embedded in a prompt, and it refuses a runner script that was rewritten between snapshot and verify.
- **Curl installer reads a generated manifest.** `install.sh` / `uninstall.sh` take their file list from a generated `install-manifest.txt`, a stale manifest fails CI, and the npm uninstall removes the curl installer's manifest copy.
- **`/do:next` claim evidence is scoped.** Claim evidence now covers only the candidate issue, prints each surfaced PR head ref once, and no longer reads back a claim push that a rival run could share.
- **Review loops are simpler and sturdier.** One reviewer grammar and status table, shell-state-safe loops, unique scratch directories, project commit and merge conventions respected, and a pending GitLab pipeline is no longer treated as green.
- **Release flow clarified.** `/do:release` has a current-release notes file shape, states its resume and checkpoint invariants, waits on workflows whose trigger it cannot resolve, and asks before creating a release branch when no target is documented.
- **Command cleanups.** Tighter `/do:better`, `/do:better-swift`, `/do:depfree`, `/do:goals`, `/do:omd`, `/do:scan`, `/do:plan-task`, `/do:replan`, `/do:fpr` and `/do:rpr`; `/do:goals --refresh` keeps unfiled checkbox items and the project's own commit convention wins.
- **Swift gotchas corrected** for SwiftData inverses, `UIRequiresFullScreen`, and IAP sandbox behavior.

## Internal

- Tests that pinned prompt wording were dropped in favor of executed-snippet and structural checks; install.sh tests run concurrently; CI validation steps covered by `npm test` were removed and CI now tests Node 18 and 20.

## Full Changelog

**Full Diff**: https://github.com/atomantic/slashdo/compare/v4.3.7...v4.4.0
