---
description: Refactor-only audit and remediation — architecture, DRY, simplification, and cognitive load — shipped as per-category PRs with a hard behavior-preservation contract
argument-hint: "[--interactive] [--scan-only] [--no-merge] [--review-with <agent>[,<agent>...]] [--review-iterations <n>] [--review-mode <series|parallel>] [--review-stop-on-findings|--review-stop-on-clean] [--reviewer-applies] [--issues|--no-issues] [--issues-label <name>] [path filter or focus areas]"
---

# Simplify — Refactor-Only Audit

Make the codebase easier to work in, without changing what it does.

This is `/do:better` with its audit narrowed to structural quality: **refactoring, architecture, DRY, simplification, and cognitive load**. Security, runtime bugs, performance, stack-specific gotchas, dependency removal, test authoring, and UX are out of scope — they are not audited, not remediated, and not filed. Every fix must be observably behavior-preserving, and the existing test suite must keep passing **unmodified** as the proof.

Reach for this when:
- The code works but is expensive to read, and you want that fixed with no behavioral risk
- You want a refactor pass you can merge on a green test suite alone, without re-verifying product behavior
- A full `/do:better` would produce more PRs than you want to review right now

Reach for `/do:better` instead when you also want security, bugs, performance, dependencies, tests, and UX covered.

## Execution

Run the workflow defined in `~/.claude/commands/do/better.md` **verbatim**, with `SIMPLIFY_ONLY=true` forced on — whether or not `--simplify-only` appears in `$ARGUMENTS`. Its [Simplify-Only Mode](better.md#simplify-only-mode---simplify-only) section is the specification for the narrowed agent roster, the finding gates, the behavior-preservation contract, and every per-phase deviation. This command adds none of its own.

Argument handling:
- Pass `$ARGUMENTS` through to `do:better` verbatim. It parses every flag itself, including the saved `/do:config` defaults, so there is nothing to extract or re-validate here.
- `--simplify-only` / `--refactor-only` in `$ARGUMENTS` is redundant but harmless — do not error on it.
- `--strict` / `--nuclear` is implied (`SIMPLIFY_ONLY=true` sets `STRICT_MODE=true`); passing it explicitly changes nothing.
- Every other `do:better` flag works as documented: `--scan-only` stops after the narrowed plan, `--interactive` prompts at each gate, `--no-merge` stops after PR creation, `--issues`/`--issues-label` file deferred findings as tracker issues, and the review flags (`--review-with`, `--review-mode`, `--review-iterations`, `--review-stop-on-*`, `--reviewer-applies`) drive the Phase 6 loop.

## Notes

- **Nothing about the pipeline is skipped except test authoring.** Worktree isolation, the file-ownership map, build/test verification, the internal code review, CI verification, the review loop, and merge all run exactly as in `/do:better`. Phase 4c (test enhancement) is the one phase that does not — a refactor-only run has no test findings to act on.
- **A test that needs editing is a failed refactor.** Mechanical updates (an import path, a renamed symbol, a moved fixture) are fine; a changed assertion means behavior moved, and the fix is to revert the refactor rather than adjust the test.
- This is a whole-codebase pipeline command. For a quick quality pass over just the current branch's diff, use `/do:review`; to fold a refactor pass into the feature PR you're already building, use `/do:pr-better --simplify-only`.
