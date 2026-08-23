'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const readCommand = (name) => fs.readFileSync(path.join(__dirname, '..', 'commands', 'do', name), 'utf8');

// Command lines only — the surrounding prose explains why `--delete-branch` is
// absent, so a naive whole-file scan would flag its own rationale.
const fencedLines = (body) => {
  const out = [];
  let inFence = false;
  for (const line of body.split('\n')) {
    if (/^\s*```/.test(line)) { inFence = !inFence; continue; }
    if (inFence) out.push(line);
  }
  return out;
};

// `gh pr merge --delete-branch` deletes the LOCAL branch too, and to do that gh
// checks out the default branch first. Inside a linked worktree that checkout
// fails ("already used by worktree at …") and gh exits non-zero AFTER the merge
// has already landed — which fires any `||` fallback chain wrapped around the
// merge against an already-merged PR. The worktree-based flows must therefore
// merge without the flag and delete the remote branch explicitly.
describe('worktree-safe merge contracts', () => {
  it('keeps --delete-branch off every gh merge /do:next runs from a worktree', () => {
    const body = readCommand('next.md');
    const merges = fencedLines(body).filter((line) => line.includes('gh pr merge'));
    assert.ok(merges.length >= 2, 'expected /do:next to document both the swarm and single-issue merges');
    for (const line of merges) {
      assert.doesNotMatch(line, /--delete-branch/, `worktree merge must not pass --delete-branch: ${line.trim()}`);
    }
  });

  it('deletes the remote claim branch explicitly instead', () => {
    const body = readCommand('next.md');
    // Swarm Phase C merges from the orchestrator; Phase D owns the local branch.
    assert.match(body, /git push origin --delete "next\/issue-<num>"/);
    // Single-issue Phase 7 keeps its own trailing remote delete as the real deletion.
    // Anchor on Phase 7's own cleanup chain — the bare command also appears in the
    // Phase 2 abort branches and the abandoned-claim paragraph, so matching it alone
    // would still pass with Phase 7's delete removed entirely.
    assert.match(body, /git branch -d "next\/\$\{SLUG\}" && \\\n\{ git push origin --delete "next\/\$\{SLUG\}"/);
    assert.doesNotMatch(body, /remote no-op after --delete-branch merge/);
  });

  it('gates the swarm remote delete on a read-back MERGED state', () => {
    // An ungated delete retracts the head branch of a PR that is still open —
    // the merge failed, or a merge queue accepted it without merging yet — and
    // GitHub auto-closes a PR whose head branch disappears.
    const body = readCommand('next.md');
    assert.match(
      body,
      /if \[ "\$\(gh pr view <pr_number> --json state -q \.state\)" = "MERGED" \]; then\n\s+git push origin --delete "next\/issue-<num>"/,
    );
  });

  it('does not swallow a failed remote-branch delete', () => {
    // Both deletes are now the real deletion, not a post-`--delete-branch` no-op,
    // so a genuine failure must surface instead of vanishing into 2>/dev/null.
    const body = readCommand('next.md');
    for (const line of fencedLines(body).filter((l) => l.includes('git push origin --delete "next/issue-<num>"'))) {
      assert.doesNotMatch(line, /2>\/dev\/null/, line.trim());
    }
    const phase7 = body.split('\n').find((l) => l.includes('git push origin --delete "next/${SLUG}"') && l.includes('warning:'));
    assert.ok(phase7, 'expected Phase 7 to report a failed remote delete');
    assert.doesNotMatch(phase7, /2>\/dev\/null/);
  });

  it('explains why the flag is absent so it is not "cleaned up" back in', () => {
    const body = readCommand('next.md');
    assert.match(body, /No `--delete-branch`/);
    assert.match(body, /Why no `--delete-branch` on the `gh` merge/);
    assert.match(body, /exits non-zero (even though|after) the merge/);
  });

  it('makes /do:pr resolve LINKED_WORKTREE and gate the flag on it', () => {
    const body = readCommand('pr.md');
    // --path-format=absolute is required: without it --git-common-dir is relative
    // in a subdirectory of a plain clone, so the probe misreports every such repo
    // as a linked worktree.
    assert.match(
      body,
      /git rev-parse --path-format=absolute --git-dir.*git rev-parse --path-format=absolute --git-common-dir/,
    );
    assert.match(body, /LINKED_WORKTREE=0/);
    assert.match(body, /LINKED_WORKTREE=1/);
    // Both merge forms must carry the drop-the-flag instruction.
    assert.match(body, /--auto --\{MERGE_METHOD\} --delete-branch` \(drop `--delete-branch` when `LINKED_WORKTREE=1`\)/);
    assert.match(body, /\{MERGE_METHOD\} --delete-branch` \(again, drop `--delete-branch` when `LINKED_WORKTREE=1`/);
  });

  it('deletes the remote branch via the config-derived upstream, not a hardcoded origin', () => {
    // pr.md's own push step forbids a destination built from the local branch name:
    // an upstream of upstream/feature-x or origin/pr-123-head must not be resolved
    // to origin/<local name>, which would delete an unrelated remote branch.
    const body = readCommand('pr.md');
    assert.match(body, /git push "\$PUSH_REMOTE" --delete "\$PUSH_BRANCH"/);
    assert.doesNotMatch(body, /git push origin --delete \{branch\}/);
  });

  it('skips /do:pr step 6\'s default-branch sync inside a linked worktree', () => {
    const body = readCommand('pr.md');
    const step6 = body.split('\n').find((line) => line.startsWith('6. After a **completed** merge'));
    assert.ok(step6, 'expected /do:pr step 6 to still exist');
    assert.match(step6, /git checkout \{default_branch\} && git pull --rebase --autostash/);
    assert.match(step6, /only when `LINKED_WORKTREE=0`/);
  });
});
