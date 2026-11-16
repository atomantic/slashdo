# Commit Conventions

The project's own commit convention wins: what its `CLAUDE.md` / `AGENTS.md` / `CONTRIBUTING.md` states, otherwise what recent `git log` evidently does (prefix style, scope, casing, issue references, required trailers). The lines marked *fallback* apply only when the project states and shows nothing; the rest always apply.

- **Prefix (fallback):** a Conventional Commits type — `feat:`, `fix:`, `refactor:`, `docs:`, `chore:` (also `test:`, `perf:`, `ci:` where they fit). Mark a breaking change with `!` after the type (`feat!:`), not a `breaking:` type.
- **Scope (fallback, optional):** when the work completes a tracker issue, use its number as the scope — `feat([issue-<num>]): …` — so the commit greps alongside the branch, PR, and changelog. Use the issue number as the ID rather than inventing a slug. An issue tag that the calling command itself asks for stays, in whatever position the project's style allows.
- **Subject:** a specific sentence about what changed, not a vague tag (`fix: guard empty array expansion in the bash 3.2 path`, not `fix bug`).
- **Staging:** add files by name. `git add -A` / `git add .` sweep in unrelated or untracked files.
- **Trailers:** add the ones the project requires (a DCO `Signed-off-by` via `git commit -s`, a ticket trailer). Add no AI-attribution trailers — no `Co-Authored-By` for an assistant, no generated-by annotation — unless the project's convention asks for them.
- **No version bump:** leave the version field in `package.json` (and any other version manifest) alone — versioning happens only in `/do:release`.
