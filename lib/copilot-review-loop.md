## Copilot Code Review Loop (legacy)

After the PR is created, run the Copilot review-and-fix loop. **This loop only runs when `copilot` is explicitly in `REVIEW_AGENTS`** — no command selects it for you. The local-agent loop (`local-agent-review-loop.md`) and the generalized GitHub-reviewer loop (`github-reviewer-loop.md`) are the actively-developed paths; this one is kept for the `copilot` slug and unchanged in behavior.

**`--reviewer-applies` is a no-op on this path**: Copilot reviews are read-only cloud-side, so there is no reviewer-side edit path to enable. The calling command should already have warned and continued; fixes are always applied by the sub-agent the parent spawns, reading from Copilot's comments.

**Sub-agent delegation**: delegate the entire loop to a **general-purpose sub-agent** via the Agent tool so long review cycles don't exhaust the parent's context. The sub-agent runs the full loop (request → wait → check → fix → re-request) autonomously and returns only the final status.

### Sub-agent prompt template:

```
You are a Copilot review loop agent.

PR: {PR_NUMBER} in {OWNER}/{REPO}
Branch: {BRANCH_NAME}
Build command: {BUILD_CMD}
GitHub API host: {GH_HOST}   (pass `--hostname {GH_HOST}` on EVERY `gh api` call
  below — `gh api` defaults to github.com and does NOT read the repo remote, so on
  GitHub Enterprise an unqualified call polls the wrong host and times out. See
  `~/.claude/lib/gh-host.md`. If {GH_HOST} is empty/unset, omit the flag.)
Max iterations: {REVIEW_ITERATIONS} (default 1). Run at most this many
  review-and-fix cycles, exiting early the moment a review returns 0 comments.
  The default of 1 means: request one review, fix everything it surfaced, and
  stop without spending another cycle to re-confirm. 0 means "loop until
  Copilot returns 0 comments" (legacy), bounded by the safety guardrail below.
  The caller resolves this value: a per-entry `~max=<n>` suffix on the
  `--review-with` token (e.g. `copilot~max=3`) wins over the run's
  `--review-iterations`, which wins over the default of 1. Either source is
  user-configured, so reaching the cap here is "capped", never "guardrail".
  See `~/.claude/lib/multi-reviewer-loop.md`.
Safety guardrail: applies only in unlimited mode ({REVIEW_ITERATIONS} is 0).
  After 10 iterations, report back and — in interactive mode — ask the user
  whether to continue or stop; never loop indefinitely without confirmation.
  When {REVIEW_ITERATIONS} is positive, that count IS the cap: the loop stops
  there with status "capped" (clean-equivalent for merge purposes).

TIMEOUT SCHEDULE:
Parallel PR reviews (do:better) — shorter waits so other PRs aren't blocked,
with a 15-second poll interval:
- Iteration 1: max wait 3 minutes
- Iteration 2: max wait 2 minutes
- Iteration 3: max wait 90 seconds
- Iteration 4: max wait 60 seconds
- Iteration 5+: max wait 45 seconds
Single-PR reviews (do:pr, do:release) — dynamic timing: check the previous
Copilot review duration on this PR (default 60 seconds if none). Set max wait
to 3x the expected duration (minimum 90 seconds, maximum 5 minutes); only
large diffs (200+ changed lines) should approach the max. Use progressive poll
intervals: 5s, 5s, 10s, 10s, then 15s thereafter.

Run the following loop for at most {REVIEW_ITERATIONS} review-and-fix cycles
(default 1), exiting early the moment a review returns zero new comments. When
{REVIEW_ITERATIONS} is 0, loop until zero new comments (bounded by the
10-iteration safety guardrail):

1. CAPTURE the latest Copilot review submittedAt timestamp (to detect when a
   NEW review arrives):
   echo '{"query":"{ repository(owner: \"{OWNER}\", name: \"{REPO}\") { pullRequest(number: {PR_NUMBER}) { reviews(last: 5) { nodes { author { login } submittedAt } } } } }"}' | gh api --hostname {GH_HOST} graphql --input -
   Record the most recent submittedAt from copilot-pull-request-reviewer[bot].
   Then REQUEST a Copilot review:
   gh api --hostname {GH_HOST} repos/{OWNER}/{REPO}/pulls/{PR_NUMBER}/requested_reviewers \
     -f 'reviewers[]=copilot-pull-request-reviewer[bot]'
   CRITICAL: The reviewer name MUST include the [bot] suffix.
   - For public repos: check if a review already exists before requesting
   - If no Copilot reviewer is configured, report back and exit

2. WAIT for the review to complete (BLOCKING):
   - Poll using stdin JSON piping to avoid shell-escaping issues:
     echo '{"query":"{ repository(owner: \"{OWNER}\", name: \"{REPO}\") { pullRequest(number: {PR_NUMBER}) { reviews(last: 5) { totalCount nodes { state body author { login } submittedAt } } reviewThreads(first: 100) { nodes { id isResolved comments(first: 3) { nodes { body path line author { login } } } } } } } }"}' | gh api --hostname {GH_HOST} graphql --input -
   - The review is complete when a new Copilot review node appears with a
     submittedAt after the timestamp captured in step 1
   - Use the TIMEOUT SCHEDULE above for the current mode and iteration
   - Error detection: if the review body contains "exceeds the maximum
     number of lines", treat this as a terminal complete state — do NOT
     re-request, do NOT retry. Report status "too-large" and exit the loop
     immediately (proceed to merge as if zero comments).
   - If the review body contains "Copilot encountered an error" or
     "unable to review this pull request", re-request (step 1) and resume
     polling. Max 3 error retries before reporting failure.
   - If no review appears after max wait, report the timeout.
     **Default mode**: skip and continue. **Interactive mode (`--interactive`)**: ask the user what to do

3. CHECK for unresolved comments:
   - Filter review threads for isResolved: false
   - First verify the review was successful: if the latest Copilot review
     body contains error text, go back to step 1.
   - If zero comments (body says "generated 0 comments" or no unresolved
     threads): PR is clean — report success and exit
   - If unresolved comments exist: proceed to step 4

4. FIX all unresolved review comments:
   For each unresolved thread:
   - Read the referenced file and understand the feedback
   - Evaluate if the finding is a real issue — if it is, fix it regardless of whether the current PR modified that code. Never dismiss findings as "out of scope" or "pre-existing."
   - A real issue is a logic/behavior bug, security hole, broken contract, or missing-coverage gap — something the project's linter/type-checker/formatter/build does NOT already catch. If a comment is a pure style/formatting/lint nit (already covered by tooling) or a bare rename/extract-a-helper preference with no behavior consequence, resolve the thread without a code change rather than churning the diff.
   - Make the code fix
   - IDENTIFY THE ROOT CAUSE of why the issue landed and apply the smallest matching action in the same change, per `~/.claude/lib/review-fix-conventions.md`. Defer big refactors and cross-cutting patterns to the end-of-loop Convention Encoding phase.
   - Run the build command
   - If build passes, commit: address review (copilot): <summary>
     (the parenthesized agent name records which reviewer surfaced the finding)
   - Resolve the thread via GraphQL mutation using stdin JSON piping:
     echo '{"query":"mutation { resolveReviewThread(input: {threadId: \"{THREAD_ID}\"}) { thread { id isResolved } } }"}' | gh api --hostname {GH_HOST} graphql --input -
   - After all threads resolved, push all commits to remote
   - Increment iteration counter
   - If {REVIEW_ITERATIONS} > 0 and the iteration counter reaches
     {REVIEW_ITERATIONS}: stop the loop and report status "capped" — the
     configured cap was reached after applying every fix the review surfaced
     (the default 1-iteration path). Clean-equivalent for merge purposes.
   - If {REVIEW_ITERATIONS} is 0 (unlimited) and the iteration counter
     reaches 10: stop the loop and report status "guardrail".
     **Default mode**: auto-stop and mark as best-effort.
     **Interactive mode (`--interactive`)**: ask the user whether to continue or stop
   - CONVERGENCE GATE (unlimited mode, {REVIEW_ITERATIONS}=0, before the
     10-iteration guardrail): apply ~/.claude/lib/review-convergence-gate.md.
     If the round just completed resolved only *marginal* comments (edge-case
     guards, refinements of already-correct behavior, hypotheticals with no
     concrete wrong outcome), converge — stop and report "clean", noting the
     diminishing-returns convergence, rather than re-requesting to mine more.
     Only a round that resolved at least one *substantive* comment earns
     another request. (No effect when {REVIEW_ITERATIONS} is a positive cap.)
   - Otherwise, go back to step 1

When done, report back:
- Final status: clean / capped / timeout / error / guardrail / too-large
  - `clean` — a review returned 0 comments (PR is confirmed clean)
  - `capped` — reached the configured {REVIEW_ITERATIONS} cap after applying every fix (the default 1-iteration path); treated as clean-equivalent for merge purposes
  - `guardrail` — only in unlimited mode ({REVIEW_ITERATIONS}=0): hit the 10-iteration safety cap with comments still outstanding
  - `too-large` — PR exceeded Copilot's 20 000-line limit; treated as clean
  - `timeout` / `error` — the review did not complete
- Total iterations completed
- List of commits made (if any)
- Any unresolved threads remaining
- **Convention encoding**: run the end-of-cycle phase from `~/.claude/lib/review-fix-conventions.md` against the issues fixed across all iterations, even when every finding was a nitpick (or none landed) — always print the "Conventions Encoded" section, using its explicit no-conventions message when nothing qualifies.
```

Launch the sub-agent and wait for its result.

**Default mode**: on a sub-agent timeout or error, skip the timed-out review and continue autonomously.

**Interactive mode (`--interactive`)**: on a sub-agent timeout or error, ask the user whether to continue waiting, re-request the review, or skip.
