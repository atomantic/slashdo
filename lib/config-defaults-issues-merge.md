### Saved defaults — issue-tracking and merge keys

This extends the saved-defaults procedure in [lib/review-config-defaults.md](./review-config-defaults.md): its precedence, load and merge steps, and the "not present in `$ARGUMENTS`" rule apply unchanged to these keys. Apply only the ones whose flag this command accepts.

- `issues` — removed and ignored, whatever its value: tracker issues are always used. `/do:config --unset issues` removes a stale saved value.
- `issues-label` → `--issues-label <name>` (string; the label that scopes plan-tracking issues, built-in default `plan`). Read by every command that files or reads tracker issues.
- `merge` → `--merge` / `--no-merge` (boolean; `true` auto-merges the PR once reviews and CI are solid, `false` leaves it open). A typed flag in either direction wins. `/do:pr` and `/do:next` both read this key with different built-in defaults when it is absent: `false` for `/do:pr` (open the PR and stop), `true` for `/do:next` (it merges its own claim's PR once its gate passes). `/do:next` always calls `/do:pr` with `--no-merge`; the key governs only `/do:next`'s own merge step after review.
- `merge-method` → `--merge-method <squash|rebase|merge>` (string; when unset, the repo's allowed method). For `/do:pr` it matters only when merge is on; `/do:next` always uses it for its own merge. A method given through `/do:pr`'s `--merge=<method>` shorthand counts as a typed `merge-method`: do not inject the saved default over it, since that would override the user's choice or trip the conflicting-methods abort. For this key, "flag absent" means neither `--merge=<method>` nor `--merge-method` was typed.
- `self`, `collaborators`, `trusted-authors` — claim gates read only by `/do:next`, which resolves them in its own Parse Arguments under the same precedence. Other commands ignore them.

`/do:better`, `/do:depfree` and `/do:release` have their own merge behavior and do not consult `merge` or `merge-method`.
