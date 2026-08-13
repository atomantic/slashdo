# Unreleased Changes

## Product requirements documents (`/do:goals --prd`, `/do:prd`)
- `/do:goals` now supports `--prd`, which generates a detailed `PRD.md` instead of the strategic `GOALS.md` — functional requirements, non-functional requirements, and explicit negative requirements ("must not") grouped by feature area, each with a stable ID and acceptance criteria, plus personas, out-of-scope, assumptions, success metrics, and open questions.
- `/do:prd` is a shorthand for `/do:goals --prd`.
- In `--interactive` mode, risks and open questions surfaced during generation are now resolved with you directly: judgment calls are asked and folded into the document, while purely factual items (like whether a referenced tracker issue is still open) are checked automatically instead of asked.
- Numeric success metrics are never invented — where the codebase doesn't evidence a concrete target, it's left as an open question rather than a fabricated number.

## Contributing
- Added `CONTRIBUTING.md` covering project structure, local dev/test workflow, and commit/PR conventions.
