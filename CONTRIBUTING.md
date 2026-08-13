# Contributing to slashdo

Thanks for considering a contribution. slashdo is a small, actively-maintained project — issues and PRs are welcome.

## Before you start

- **Bugs and feature ideas**: [open an issue](https://github.com/atomantic/slashdo/issues). For anything beyond a trivial fix, opening an issue first (or commenting on an existing one) before writing code avoids duplicated effort — the project tracks its roadmap as `plan`-labeled issues rather than in `PLAN.md`.
- **Small, obvious fixes** (typos, broken links, a clearly wrong flag description): a PR without a prior issue is fine.

## Project structure

- `commands/do/*.md` — the source of truth for every `/do:*` command, written in Claude Code's native format
- `lib/*.md` — shared partials referenced from multiple commands
- `src/*.js` — the installer/transformer that converts `commands/do/` and `lib/` into each target environment's native format (Claude Code, OpenCode, Antigravity CLI, Codex, Grok Build)
- `install.sh` / `uninstall.sh` — the no-npm curl-based install path; their `COMMANDS`/`LIBS` arrays must stay in sync with `commands/do/` and `lib/` (`test/curl-installer-allowlist.test.js` enforces this in CI)
- `test/*.test.js` — the test suite, run with `node --test`

## Making a change

1. Fork and clone the repo. There are no npm dependencies to install — the package has none, and the test suite runs on Node's built-in test runner.
2. Edit the relevant `commands/do/*.md` or `lib/*.md` source file. If you touch environment-specific behavior, wrap it in `<!-- if:teams -->…<!-- else -->…<!-- /if:teams -->` (or the matching capability flag in `src/environments.js`) rather than hard-coding for one environment.
3. If you add or rename a command or lib file, update the `COMMANDS`/`LIBS` arrays in both `install.sh` and `uninstall.sh` — CI will fail the drift check otherwise.
4. Verify locally:
   - `node bin/cli.js --list` — confirm the command shows up correctly
   - `node bin/cli.js --dry-run` — preview what install would do
   - `npm test` — run the full test suite
5. If your change affects behavior covered by an existing test, update it; if it adds new behavior worth locking in, add a test under `test/`.

## Commit and PR conventions

- Commit subjects are specific sentences, not vague tags — `fix: guard empty array expansion in review-loop bash 3.2 path`, not `fix bug`.
- Conventional prefixes (`fix:`, `feat:`, `docs:`, `chore:`, `refactor:`) are used but not strictly enforced by tooling — match the style in `git log`.
- Keep PRs scoped to one logical change. A doc fix and a behavior change should be separate PRs.
- CI runs the full test suite, a `shellcheck` pass on `install.sh`/`uninstall.sh`, and validates every command's frontmatter across Node 18/20/22 — make sure it's green before requesting review.
- No AI-attribution footers or co-author trailers in commits or PR descriptions, regardless of what tooling you used to help write the change.

## License

By contributing, you agree your contribution is licensed under the project's [MIT License](./LICENSE).
