# Unreleased Changes

## Added

## Changed

## Fixed

- The GitHub auth pre-flight in `/do:next`, `/do:pr`, `/do:replan`, `/do:better`, `/do:better-swift`, `/do:depfree`, and the shared issue-mode setup now checks `gh auth status --active` instead of a bare `gh auth status`. A bare check exits non-zero whenever *any* configured `gh` account has a stale or invalid token — even when the account you're actually using is authenticated fine — which made these commands falsely report "not authenticated" and run extra diagnostic steps on every invocation. Scoping the check to the active account fixes that.

## Removed
