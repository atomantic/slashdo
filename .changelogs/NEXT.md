# Unreleased Changes

## Added

## Changed

- `/do:next --issues`: auto-pick is now **label-agnostic by default** — a bare `/do:next --issues` claims the oldest open issue regardless of label, instead of requiring the `plan` label. The guards against claiming the wrong thing are now the parking-label skip (`future`/`epic`/`blocked`/`needs-input`/`wontfix`/`discussion`/repo-specific) plus the existing in-flight/assigned checks. This lets a repo that files ordinary `enhancement`/`bug`/`area:*` issues work with `/do:next --issues` out of the box, without first running `/do:replan --issues` to stamp a `plan` label on every issue. Pass `--issues-label <name>` (or save it as a default) to opt back into a curated, label-scoped queue; an explicit `#<num>` still overrides every skip, including parking labels and an active filter. `epic` was added to the parking-label skip so umbrella issues aren't auto-claimed.

## Fixed

## Removed
