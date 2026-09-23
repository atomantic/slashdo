# Auto-merge internals

Expands on the [Auto-merge](../README.md#auto-merge-dopr---merge) section of the README.

## How CI is awaited

slashdo first enables GitHub-native auto-merge (`gh pr merge --auto`), so the merge lands when required checks pass even if your session ends. If the repo hasn't enabled auto-merge, it falls back to watching checks in-session (`gh pr checks --watch`) and merging once green — leaving the PR open if a required check fails. On GitLab it uses `glab mr merge --auto-merge`. It never merges on a non-clean review aggregate, before checks pass, or over branch protection.

## Which commands read the saved `merge` default

`/do:pr` **and** `/do:next` read the saved `merge` default, with different built-in defaults when it's absent: `/do:pr` defaults to `false` (open the PR and stop); `/do:next` defaults to `true` (it has always merged its own claim's PR once its gate passed — `--no-merge` is the opt-out). `/do:next` never forwards `--merge`/`--no-merge` to the internal `/do:pr` call it makes to open the PR (that call is always `--no-merge`); the key only governs `/do:next`'s own post-review merge step. The saved `merge-method` is read by `/do:pr` and by `/do:next`, which always uses it to pick the method for its own merge — `/do:better`, `/do:better-swift`, `/do:simplify`, `/do:depfree`, and `/do:release` keep their own documented merge behavior.
