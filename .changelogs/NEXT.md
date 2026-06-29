# Unreleased Changes

## Issue queue

- **`/do:next --self` claims only issues you filed.** A new security gate for issue mode: `/do:next --issues --self` restricts every claim — auto-pick, `--swarm` batch, and an explicit `#<num>` — to issues whose author is the running account (`@me`), so on a shared tracker your agent never picks up (or acts on the instructions embedded in) an issue opened by someone else. Issues filed by anyone else are filtered out at the API; an explicit number for another user's issue is refused, not overridden. Save it once with `/do:config --self` (globally or per-repo with `--project`); pass `--no-self` on a run to fall back to claiming any open issue.
