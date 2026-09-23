# Commit Conventions

Commit messages should follow these conventions:

## Conventional Commits prefix

Use one of these standardized prefixes:
- `feat:` — a new feature or capability
- `fix:` — a bug fix
- `refactor:` — internal restructuring with no user-visible change
- `docs:` — documentation only
- `chore:` — tooling, dependencies, or maintenance

For a breaking change, append `!` after the prefix: `feat!:` or `fix!:`.

## Optional scope

Optionally include a scope in square brackets after the prefix to narrow the change's domain:
```
feat([slug]): short description
```

Preserve any `[<slug>]` that already exists on a line you touch — the slug links changelog, branches, and PRs together for grep-ability.

## Commit all changes by name

- Use `git add <file-name>` to stage specific files
- Never use `git add -A` or `git add .` — they may include unintended files
- Include changelog or tracking files your commit touches

## No trailers

- Do not include `Co-Authored-By` or generated-by annotations
- Do not bump version or update `package.json` — `/do:release` owns versioning

## Examples

```
feat: add new slash-command prompt for daily standup
fix([deploy]): guard empty array expansion in bash 3.2 path
docs: clarify PR review loop timing
refactor!: redesign the command registry API
chore: update GitHub Actions to node 20
```
