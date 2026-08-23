'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const readCommand = (name) => fs.readFileSync(path.join(__dirname, '..', 'commands', 'do', name), 'utf8');

// `gh pr merge --delete-branch` deletes the LOCAL branch too, and to do that gh
// checks out the default branch first. Inside a linked worktree that checkout
// fails ("already used by worktree at …") and gh exits non-zero AFTER the merge
// has already landed — which fires any `||` fallback chain wrapped around the
// merge against an already-merged PR. The worktree-based flows must therefore
// merge without the flag and delete the remote branch explicitly.
describe('worktree-safe merge contracts', () => {
  it('keeps --delete-branch off every gh merge /do:next runs from a worktree', () => {
    const body = readCommand('next.md');
    const merges = body.split('\n').filter((line) => line.includes('gh pr merge'));
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
    assert.match(body, /git push origin --delete "next\/\$\{SLUG\}"/);
    assert.doesNotMatch(body, /remote no-op after --delete-branch merge/);
  });

  it('explains why the flag is absent so it is not "cleaned up" back in', () => {
    const body = readCommand('next.md');
    assert.match(body, /No `--delete-branch`/);
    assert.match(body, /Why no `--delete-branch` on the `gh` merge/);
    assert.match(body, /exits non-zero (even though|after) the merge/);
  });

  it('makes /do:pr resolve LINKED_WORKTREE and gate the flag on it', () => {
    const body = readCommand('pr.md');
    assert.match(body, /git rev-parse --git-dir.*git rev-parse --git-common-dir/);
    assert.match(body, /LINKED_WORKTREE=0/);
    assert.match(body, /LINKED_WORKTREE=1/);
    // Both merge forms must carry the drop-the-flag instruction.
    assert.match(body, /--auto --\{MERGE_METHOD\} --delete-branch` \(drop `--delete-branch` when `LINKED_WORKTREE=1`\)/);
    assert.match(body, /\{MERGE_METHOD\} --delete-branch` \(again, drop `--delete-branch` when `LINKED_WORKTREE=1`/);
  });

  it('skips /do:pr step 6\'s default-branch sync inside a linked worktree', () => {
    const body = readCommand('pr.md');
    const step6 = body.split('\n').find((line) => line.startsWith('6. After a **completed** merge'));
    assert.ok(step6, 'expected /do:pr step 6 to still exist');
    assert.match(step6, /git checkout \{default_branch\} && git pull --rebase --autostash/);
    assert.match(step6, /only when `LINKED_WORKTREE=0`/);
  });
});
