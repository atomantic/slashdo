# Unreleased Changes

## Added
- Code review checklist: test mock state leaking detection (mock setup persistence vs call history clearing, sequential mock coupling to call count)
- Code review checklist: monotonic counter/store lockstep check for append-only storage
- Code review checklist: null-to-sentinel coercion detection in comparison/trigger logic
- Code review checklist: pagination pre-filter limit and cursor derivation checks
- Code review checklist: query optimization correctness check (early exits reducing result sets)
- Code review checklist: write-path/read-path index alignment check
- Code review checklist: consistent HTTP status for same access-control decision across endpoints
- Code review checklist: legacy field fallback when new logic checks only newly introduced fields
- Review process: query key/stored key precision alignment deep check

## Changed

## Fixed

## Removed
