# Contributing to slashdo

Thanks for considering a contribution. slashdo is a small, actively-maintained project — issues and PRs are welcome.

## Before you start

- **Bugs and feature ideas**: [open an issue](https://github.com/atomantic/slashdo/issues). For anything beyond a trivial fix, opening an issue first (or commenting on an existing one) before writing code avoids duplicated effort — the project tracks its roadmap as `plan`-labeled issues rather than in `PLAN.md`.
- **Small, obvious fixes** (typos, broken links, a clearly wrong flag description): a PR without a prior issue is fine.

## Project structure

- `commands/do/*.md` — the source of truth for every `/do:*` command, written in Claude Code's native format
- `lib/*.md` — shared partials referenced from multiple commands
- **Any command with a genuine runtime dependency on another command must cite it, not just mention it in prose.** Cite the required command with `` ~/.claude/commands/do/<name>.md `` for an execution instruction (e.g. "Run the workflow defined in `~/.claude/commands/do/goals.md`"), or `[label](<name>.md#anchor)` for a link to one of its sections — never hand-roll a host-specific path, and never rely on a bare `` `/do:<name>` `` mention or verb phrase like "delegate to"/"invoke" without one of these two forms nearby. The transformer resolves both forms per environment (`src/transformer.js`'s `resolveCommandExecRef`/`resolveCommandSiblingRef`) and uses the same two forms (`extractCommandDependencies`) to auto-install the dependency on a filtered install and to refuse an uninstall that would strand it. This applies whether the dependency is a **wrapper command** that delegates its entire workflow (`do:prd`, `do:simplify`, `do:pr-better`) or a command that merely invokes another as one step of a larger, otherwise-independent procedure (e.g. `do:next` citing `do:pr` for its ship phase) — the citation form is what makes the dependency machine-checkable either way. A command that only *mentions* another (e.g. contrasting itself with it, or referencing a flag the other command also accepts) does not need a citation — only a command whose own run cannot complete without the other installed does.
- `src/*.js` — the installer/transformer that converts `commands/do/` and `lib/` into each target environment's native format (Claude Code, OpenCode, Antigravity CLI, Codex, Grok Build)
- `src/settings-hooks.js` — the single implementation of the `~/.claude/settings.json` hook/statusline mutation, shared by the npm installer and (fetched at install time) by `install.sh`/`uninstall.sh`; keep it dependency-free so the curl path can fetch it alone
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

## Changelog

**Do not write a changelog entry in your PR.** There is no unreleased/staging changelog file in this repo — no `NEXT.md`, no `## Unreleased` section. **The commit history is the changelog.**

Release notes are rolled up once, at release time: `/do:release` reads `git log {last_tag}..HEAD`, synthesizes it into feature-grouped notes, and writes `.changelogs/v{version}.md` as part of the release PR. `.github/workflows/release.yml` then publishes that file as the GitHub Release body. The `.changelogs/v*.md` files are the archive of past releases — read them, don't hand-edit them.

This is why commit subjects matter (below): a vague subject becomes a vague release note, and nothing downstream can recover the intent.

## Commit and PR conventions

- Commit subjects are specific sentences, not vague tags — `fix: guard empty array expansion in review-loop bash 3.2 path`, not `fix bug`.
- Conventional prefixes (`fix:`, `feat:`, `docs:`, `chore:`, `refactor:`) are used but not strictly enforced by tooling — match the style in `git log`.
- Keep PRs scoped to one logical change. A doc fix and a behavior change should be separate PRs.
- CI runs the full test suite, a `shellcheck` pass on `install.sh`/`uninstall.sh`, and validates every command's frontmatter across Node 18/20/22 — make sure it's green before requesting review.
- No AI-attribution footers or co-author trailers in commits or PR descriptions, regardless of what tooling you used to help write the change.

## License

By contributing, you agree your contribution is licensed under the project's [MIT License](./LICENSE).
