# PRD mode internals

Expands on the [PRD mode](../README.md#prd-mode-dogoals---prd) section of the README.

## What PRD.md contains

An overview and problem statement, goals & objectives (aligned with an existing GOALS.md's Core Tenets when one exists), target users/personas, **functional requirements** grouped by feature area (stable `FR-` IDs, MUST/SHOULD/MAY priority, acceptance criteria), **non-functional requirements** (`NFR-` IDs — performance, security, reliability, usability), **negative requirements** (`NR-` IDs — explicit things the system must not do), an out-of-scope list, assumptions & constraints, success metrics, and open questions.

## Discovery from tests

An extra discovery agent mines test suites, validation/guard-clause logic, and auth/rate-limit code for requirements that are already implicitly specified in the codebase, since executable tests are high-confidence evidence of intended behavior. Numeric success metrics are never fabricated — where the codebase doesn't evidence a concrete target, it's left as an open question instead.

## Requirement ID stability

Requirement IDs are stable across `--refresh` runs — unchanged requirements keep their ID, new ones get the next unused number, and requirements that no longer hold are marked `(status: removed — verify)` rather than silently deleted.
