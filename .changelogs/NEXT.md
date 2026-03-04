# Unreleased Changes

## Added

- `/improve:review` command — learns from PR review feedback (Copilot, human reviewers) to improve the self-review checklist with generic, technology-agnostic checks
- New `improve` command namespace with install/uninstall support for Claude, OpenCode, and Gemini
- 14 new code review checklist items covering: client/server trust boundaries, async/UI state consistency, type coercion edge cases, schema pass-through integrity, test quality, and mutable defaults

## Changed

- `/improve:review` now also analyzes review process gaps (depth, flow, tooling) and updates `commands/do/review.md` with new deep-check and flow-tracing instructions

## Fixed

## Removed
