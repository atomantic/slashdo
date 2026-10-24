# One local review phase per delivery

This is the orchestrator's private workflow evidence. Do not send it to a
reviewer or commit it. A delivery is one branch, origin, base and eventual PR/MR;
it survives shell/session restarts. Local review completion is historical
pre-publication evidence, never a claim that later feedback commits were reviewed.

## Resume before dispatch

Before initializing review state, resolve whether an OPEN PR/MR already exists
for this exact branch, origin and base using the selected forge CLI. Distinguish
an authenticated successful empty lookup from a failed lookup; errors stop.
Capture its URL as `PR_URL` (empty only when none exists). A CLOSED/MERGED PR is a
finished delivery: use a new branch for new work. Never silently reuse an old
receipt for a new task/PR. For an explicitly requested re-review, archive the old
receipt privately and start a new phase; `/do:review` remains an explicit request.

Run this block with `DEFAULT_BRANCH` set to the resolved base and `PR_URL` as above:

```bash
REVIEW_RECEIPT="$(git rev-parse --git-path slashdo-pre-pr-review.json)"
REVIEW_BRANCH="$(git branch --show-current)"
REVIEW_ORIGIN="$(git remote get-url origin)"
REVIEW_HEAD="$(git rev-parse HEAD)"
node - "$REVIEW_RECEIPT" "$REVIEW_BRANCH" "$REVIEW_ORIGIN" "$DEFAULT_BRANCH" "$REVIEW_HEAD" "${PR_URL:-}" <<'NODE'
const fs = require('node:fs');
const [file, branch, origin, base, head, prUrl] = process.argv.slice(2);
let receipt;
let hasReceipt = false;
try { receipt = JSON.parse(fs.readFileSync(file, 'utf8')); hasReceipt = true; }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const matches = receipt?.version === 1 && receipt.branch === branch && receipt.origin === origin && receipt.base === base;
const valid = matches && ['clean', 'partial', 'inconclusive'].includes(receipt.status)
  && /^[a-f0-9]{40}$/.test(receipt.reviewedHead)
  && (prUrl ? receipt.prUrl === prUrl : !receipt.prUrl && receipt.reviewedHead === head);
if (prUrl && hasReceipt && !valid) throw new Error('Existing PR lacks matching completed local phase evidence: recover original records, do not automatically spawn reviewers');
console.log(JSON.stringify({ legacyPublished: Boolean(prUrl && !hasReceipt), reuseLocalPhase: Boolean(valid && receipt.status !== 'inconclusive'), retryIncompleteLocalPhase: Boolean(valid && receipt.status === 'inconclusive'), receipt: valid ? receipt : null }));
NODE
```

On `legacyPublished:true`, an existing PR predates receipts or was opened by hand.
Report that prior local-review execution/model evidence is unavailable; do not
invent a clean local verdict, model label or reviewed head. Skip automatic local
review and continue PR-side feedback/CI/required hosted approval. Preserve any
explicit unresolved finding or recorded required-review block. Do not record or
bind a fabricated local receipt for this legacy continuation. The absent local
phase is not an inconclusive requested reviewer in this invocation's aggregate;
report it separately and aggregate the actual requested PR-side outcomes.

On `reuseLocalPhase:true`, restore `LOCAL_OVERALL_STATUS`, `LOCAL_PHASE_START_SHA`
and `LOCAL_PHASE_COMMITS` from the receipt; skip the Local Code Review gate and
Pre-PR Local Reviews, including resets and reviewer-model attribution. Go straight
to PR-side continuation if published, or retry publication if not. Keep the
reviewed head/model evidence unchanged across all later feedback/CI pushes.

On `retryIncompleteLocalPhase:true`, restore each successful reviewer and retry only incomplete required reviewers; the prior inconclusive aggregate is not successful review.

When no receipt is reusable and no PR exists, run the normal first local phase,
including fixes and re-review of accepted local findings. Persist each completed
reviewer's result and findings-remediation outcome in worktree-private evidence
as it finishes; on crash/resume restore successful reviewers and retry only
unfinished ones. A failed start, timeout or no-verdict is not successful review;
never restore it as clean. Do not restart a successful reviewer just to repair a
receipt or retry PR creation. A pre-publication code change still needs the
changed work reviewed before initial publication.

## Record the completed phase

After the aggregate is known and all accepted findings are resolved, set
`LOCAL_PHASE_COMMITS` to the number added during the phase and run this block.
`dirty`, unresolved findings, failed validation and incomplete attempts never
qualify. An `inconclusive` aggregate preserves the command's existing publication
policy but still blocks merge; it is not a successful review or clean verdict.

```bash
REVIEW_RECEIPT="$(git rev-parse --git-path slashdo-pre-pr-review.json)"
node - "$REVIEW_RECEIPT" "$(git branch --show-current)" "$(git remote get-url origin)" "$DEFAULT_BRANCH" "$(git rev-parse HEAD)" "$LOCAL_OVERALL_STATUS" "$LOCAL_PHASE_START_SHA" "$LOCAL_PHASE_COMMITS" <<'NODE'
const fs = require('node:fs');
const [file, branch, origin, base, reviewedHead, status, startHead, commits] = process.argv.slice(2);
if (!['clean', 'partial', 'inconclusive'].includes(status) || !/^[a-f0-9]{40}$/.test(reviewedHead)
    || !/^[a-f0-9]{40}$/.test(startHead) || !/^\d+$/.test(commits)) throw new Error('Local phase is incomplete');
const receipt = { version: 1, branch, origin, base, reviewedHead, status, startHead, commits: Number(commits), prUrl: '' };
fs.writeFileSync(file + '.tmp', JSON.stringify(receipt) + '\n', { mode: 0o600 });
fs.renameSync(file + '.tmp', file);
NODE
```

A write failure blocks publication; repair evidence using the completed results,
without launching another reviewer. Initialize `LOCAL_PHASE_START_SHA` before
the first local phase even when the configured local roster is empty, and use
`clean` / zero commits for that empty phase.

## Bind publication once

After creating or recovering the exact PR/MR, capture `PR_URL`, then bind it:

```bash
REVIEW_RECEIPT="$(git rev-parse --git-path slashdo-pre-pr-review.json)"
node - "$REVIEW_RECEIPT" "$(git branch --show-current)" "$(git remote get-url origin)" "$DEFAULT_BRANCH" "$(git rev-parse HEAD)" "$PR_URL" <<'NODE'
const fs = require('node:fs');
const [file, branch, origin, base, head, prUrl] = process.argv.slice(2);
const receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!prUrl || receipt.version !== 1 || receipt.branch !== branch || receipt.origin !== origin || receipt.base !== base
    || !['clean', 'partial', 'inconclusive'].includes(receipt.status)
    || (receipt.prUrl ? receipt.prUrl !== prUrl : receipt.reviewedHead !== head)) throw new Error('Publication does not match local phase');
fs.writeFileSync(file + '.tmp', JSON.stringify({ ...receipt, prUrl }) + '\n', { mode: 0o600 });
fs.renameSync(file + '.tmp', file);
NODE
```

If creation succeeded before a crash but binding did not, verify its original
published head equals `reviewedHead` from trusted forge history, then repair only
the binding. Never stamp today's head as locally reviewed. A later push, rebase,
CI fix or host-review correction stays in the PR-side workflow: run affected
validation, handle host feedback and satisfy current-head hosted review/CI.
Do not rerun the local phase automatically. Required host approval, unresolved
findings, dirty/inconclusive gates and merge safety rules remain in force.
