# Unreleased Changes

## Added

## Changed

- `do:review`: expanded checklist and agent files with patterns learned from PR review feedback — async fire-and-forget rejections, persisted-data validation parity + authoritative flags, cross-module constant drift, duplicate ID handling, validation consistency across endpoints, ARIA roles requiring keyboard behavior, doc drift on paths/counts/response shapes, and several React-specific patterns (state invariant outside functional updater, useEffect self-dependency loops)
- `do:review`: added streaming-protocol lifecycle coverage (server disconnect handling, post-handshake error translation, paired-listener cleanup, write backpressure, mutually exclusive terminal events, client AbortController-by-stream-identity, partial-output preservation on error, wire-parser robustness for `\r\n\r\n` and EOF flush) plus generator/validator structural-invariant checks, optimistic-ID-echo guards, per-record settings persistence, deep-link sender/receiver contracts, persistence-layer validation independent of routes, cross-field schema range refinements, server-side locale/timezone non-determinism, CLI argv length limits, string-accumulation O(n²) in tight loops, required-at-use-time config null guards, network-failure translation at API client boundaries, conditional vs unconditional prompt composition, and no-op cleanup callback detection
- `do:review`: added install/setup-script discipline coverage — readiness probes that inspect output (not just exit code) with `-X`/`--no-rcfile` to ignore user config, setup scripts on hot paths gated by readiness checks to avoid recurring credential/privilege mutation, subprocess env propagation when the parent reads `.env` but the child only sees `process.env`, NaN guards for env-var numeric parsing (whitespace/inline-comment values), TTY/EOF safety for `read` prompts under `set -e` with full y/n validation, and structured-file section-header uniqueness

## Fixed

## Removed
