# Unreleased Changes

## Added

## Changed
- Improved review checklist: added checks for implicit upsert semantics on update operations, bulk operation selection lifecycle (clear/invalidate/re-validate), UI rendering gate alignment across multi-part components, and input collection deduplication
- Improved rpr process: added repeated-comment dedup to avoid infinite loops on persistent Copilot feedback, and progressive poll intervals (15s/30s/60s) for faster small-diff reviews
- Improved review checklist: added checks for call-site input format verification (wrong loader/accessor/arg order), accepted-but-unused parameters (dead API surface), and source-code-inspection test anti-patterns
- Improved review process: added deep checks for framework API call-site contract verification and parameter consumption tracing

## Fixed

## Removed
