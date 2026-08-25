# Review Agent Selection

The host CLI agent is the review orchestrator. It must inspect the scoped diff,
changed files, commit claims, and project conventions before deciding whether any
focused sub-agent is needed. The focused agents below are optional review lenses,
not a fixed checklist or a minimum fan-out.

## Selection protocol

After the PR-level coherence check and before dispatch:

1. Read the changed files in full and summarize what the change actually does.
2. Start with an empty `SELECTED_REVIEW_AGENTS` list. Add a lens only when the
   diff contains a concrete signal that its reading strategy will add coverage.
3. Record one short reason beside every selected lens. The reason must name the
   changed behavior or boundary that triggered it, not merely repeat the lens
   name.
4. If no focused lens is justified, dispatch no sub-agents. The host agent still
   performs the complete self-review, and the report must say that the focused
   pass was intentionally skipped and why.
5. When the signal is ambiguous but the consequence could be serious, select the
   relevant lens. Saving a dispatch is not a reason to omit a lens that is clearly
   needed.

The decision is about review coverage, not file extensions alone. A small diff can
need several lenses when it changes a security boundary or a producer/consumer
contract; a larger mechanical or documentation-only diff may need none or only one.
If multiple lenses are selected, dispatch them in parallel. Each selected lens reads
all changed files, but reports only findings within its own mandate.

## Lens signals

| Lens | Select when the diff shows | Usually skip when |
|---|---|---|
| Surface Scan (Runtime) | Executable behavior, request handling, UI state, scripts, migrations, subprocesses, or error paths that can fail at runtime | The change is only prose, metadata, or a mechanically generated fixture with no runtime behavior |
| Surface Quality | Documentation or configuration claims, tests/fixtures, dependency metadata, or a behavior change whose intent and coverage need a file-local quality pass | The diff is a tiny, self-evident implementation edit and the host can verify its local quality directly |
| Security Audit | Authentication/authorization, untrusted input, secrets, URLs, shell/process execution, network calls, file paths, dependencies, or sensitive output | No trust boundary, privilege, external input, or sensitive data changes |
| Cross-File Tracing (State) | Async work, state machines, events, jobs, retries, lifecycle, persistence, concurrency, or a control/data flow spanning modules | A self-contained change with no stateful or cross-module lifecycle |
| Cross-File Contract | API/schema/type, serialization, persistence, configuration, event payload, or producer/consumer changes across a boundary | No changed shape or agreement crosses a module, layer, or documented interface |
| Structural Ambition | `--strict` is active **and** the diff contains non-trivial refactoring, new abstraction layers, large-file growth, conditional sprawl, boundary leakage, or duplicated canonical logic | `--strict` is absent, or strict mode is active only for a small isolated behavior/doc fix |

These signals are prompts for judgment, not an exhaustive classifier. Select more
than one lens when the change crosses concerns, and do not select a lens solely
because its category appears in the generic review checklist.

## Dispatch record

The review summary must report the selected lenses and their reasons, plus the
focused lenses intentionally skipped when that is useful context. The summary must
also distinguish the host orchestrator's self-review from the optional focused
passes, so zero sub-agents is visible as an intentional decision rather than a
missing review.
