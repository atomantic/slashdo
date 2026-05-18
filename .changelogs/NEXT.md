# Unreleased Changes

## Added

## Changed

- **Post-review phase now encodes conventions in code instead of recommending CLAUDE.md additions.** The phase invoked at the end of `do:review`, `do:rpr`, and the Copilot review loop has been renamed from **Documentation Recommendations** to **Convention Encoding** and inverted from read-only-suggest to auto-apply. For each recurring pattern in the findings, the agent now picks the *smallest* code-level action that makes the convention self-evident — in priority order: a surgical refactor that eliminates the bug class, an in-tree comment at the canonical site, a clarifying rename, or a brief in-tree `docs/*.md` note — and applies it in the same branch as the review fixes. CLAUDE.md / AGENTS.md additions are now an explicit **fallback**, used only when the convention spans the codebase with no canonical enforcement site. Bounded by: one-line comments only, no new abstractions for their own sake, no speculative changes, and an escape hatch ("Proposed — not auto-applied") for actions too risky to auto-apply. Motivation: the previous behavior produced wall-of-text CLAUDE.md bullets that rot and don't reach the next contributor, while a comment at the right line or a refactor that removes the footgun is durable. `lib/post-review-doc-recommendations.md` rewritten end-to-end; filename kept for path stability so installed copies pick up the new content on `/do:update`. Report section header in reviews is now `Conventions Encoded`.

## Fixed

## Removed
