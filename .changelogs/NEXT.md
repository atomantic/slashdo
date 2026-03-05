# Unreleased Changes

## Added

## Changed

- `do:better` Copilot review loop now uses GitHub API exclusively, removing Playwright browser dependency

## Fixed

## Removed

- Browser authentication steps (Phase 0e, Phase 6.0) from `do:better` — no longer needed with API-based Copilot reviews
- Playwright fallback (`REVIEW_METHOD`) from Copilot review request logic
