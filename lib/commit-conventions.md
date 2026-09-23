# Commit Conventions

- **Prefix:** a Conventional Commits type — `feat:`, `fix:`, `refactor:`, `docs:`, `chore:` (also `test:`, `perf:`, `ci:` where they fit). Mark a breaking change with `!` after the type (`feat!:`), never a `breaking:` type.
- **Scope (optional):** when the work completes a tracked item that carries a `[<slug>]`, use the slug as the scope — `feat([<slug>]): …` — so the commit greps alongside the branch, PR, and changelog. Preserve any existing `[<slug>]` on a tracking-file line you touch.
- **Subject:** a specific sentence about what changed, not a vague tag (`fix: guard empty array expansion in the bash 3.2 path`, not `fix bug`).
- **Staging:** add files by name. Never `git add -A` / `git add .` — they sweep in unrelated or untracked files.
- **No trailers:** no `Co-Authored-By` or generated-by annotations.
- **No version bump:** leave the version field in `package.json` (and any other version manifest) alone — versioning happens only in `/do:release`.
