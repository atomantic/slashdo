# Unreleased Changes

## Local agent review loop
- The `--review-with=claude` reviewer now names the exact sub-agent type to dispatch, so it no longer probes for a non-existent `code-reviewer` agent and wastes a turn recovering before the review starts.
