'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// A command's contract spans the file plus the lib docs it includes (`!cat` and
// on-demand `!read` alike): those are one document to the agent, and splitting a
// section into lib/ must not move it out of a contract's reach.
const { readCommandDocs } = require('./helpers/command-docs');
const readCommand = (name) => readCommandDocs(name, { eager: true });

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
    assert.match(body, /git push origin --delete "<branch>"/);
    // Single-issue Phase 7 keeps its own trailing remote delete as the real deletion.
    // Anchor on Phase 7's own cleanup chain — the bare command also appears in the
    // Phase 2 abort branches and the abandoned-claim paragraph, so matching it alone
    // would still pass with Phase 7's delete removed entirely.
    assert.match(body, /git branch -d "next\/\$\{SLUG\}" && \\\nif ! git push origin --delete "next\/\$\{SLUG\}"; then/);
    assert.doesNotMatch(body, /remote no-op after --delete-branch merge/);
  });

  it('gates the swarm remote delete on a read-back MERGED state', () => {
    // An ungated delete retracts the head branch of a PR that is still open —
    // the merge failed, or a merge queue accepted it without merging yet — and
    // GitHub auto-closes a PR whose head branch disappears.
    const body = readCommand('next.md');
    assert.match(
      body,
      /if \[ "\$\(gh pr view <pr_number> --json state -q \.state\)" = "MERGED" \]; then\n\s+if ! git push origin --delete "<branch>"; then/,
    );
  });

  it('gates the swarm merge on the required-checks watch', () => {
    // `gh pr checks --fail-fast` exits non-zero on a failing required check, but an
    // unchained `gh pr merge` on the next line merges regardless — shipping a red PR
    // from the one step whose prose says "wait for CI, and only then merge".
    const body = readCommand('next.md');
    assert.match(
      body,
      /git -C "<worktree>" push && \\\n\s+gh pr checks <pr_number> --required --watch --fail-fast && \\\n\s+gh pr merge <pr_number> --"\$MERGE_METHOD"/,
    );
  });

  it('gates the single-issue merge on the pushed SHA\'s required checks', () => {
    // /do:pr ran with --no-merge, so its CI gate never fired, and Phase 6's push
    // publishes a NEW SHA. Merging straight after the push merges before CI on an
    // unprotected repo — the GitLab line below it already waits, and so must this.
    const body = readCommand('next.md');
    assert.match(
      body,
      /git push && \\\n\s+gh pr checks <num> --required --watch --fail-fast && \\\n\s+gh pr merge <num> --"\$MERGE_METHOD"/,
    );
    // An absent required-checks set makes `gh pr checks --required` exit non-zero;
    // without this carve-out the chain could never merge on such a repo.
    // Pin next.md's own paragraph — next-swarm.md (read in with it) says the same thing.
    assert.match(body, /\*\*If `gh pr checks` prints `no required checks reported`\*\*, it still exits non-zero\. The gate is vacuously satisfied, so run the merge alone with the resolved method written in literally/);
  });

  it('never hardcodes the merge method on a /do:next gh merge', () => {
    // `--merge` means a merge commit, which a squash- or rebase-only repo rejects on
    // every run — /do:next could then never merge there.
    const body = readCommand('next.md');
    for (const line of fencedLines(body).filter((l) => /gh pr merge /.test(l))) {
      assert.match(line, /gh pr merge <(num|pr_number)> --"\$MERGE_METHOD"/, line.trim());
    }
    // Resolved like /do:pr step 3: the repo's allowed methods, squash > merge > rebase.
    assert.match(body, /\*\*Resolve the merge method \(GitHub\) — never hardcode `--merge`\.\*\*/);
    assert.match(
      body,
      /gh repo view --json mergeCommitAllowed,squashMergeAllowed,rebaseMergeAllowed[^\n]*\\\n[^\n]*"squash"\), \(select\(\.mergeCommitAllowed\) \| "merge"\), \(select\(\.rebaseMergeAllowed\) \| "rebase"\)\] \| first \/\/ empty/,
    );
    assert.match(body, /\*\*Merge method \(GitHub\)\.\*\* Resolve `MERGE_METHOD` \*\*once per invocation\*\*/);
  });

  it('chains the swarm GitLab push into the pipeline wait', () => {
    // A failed push leaves `glab ci status --wait` watching the stale (possibly green)
    // pipeline, which would merge the MR without its re-sync commit.
    const body = readCommand('next.md');
    assert.match(body, /git -C "<worktree>" push && glab ci status --wait && glab mr merge <pr_number>/);
  });

  it('reads the MR state back on the GitLab swarm path too', () => {
    // `glab mr merge --auto-merge` hands the MR to the pipeline and returns, so its
    // exit status says nothing about whether the work landed — and step 4 closes the
    // tracking issue off that answer.
    const body = readCommand('next.md');
    assert.match(body, /glab mr view <pr_number> --output json --jq \.state\)" = "merged" \]; then/);
    // ...and the merge must WAIT, or the read-back is always "opened" and the guard
    // against closing unlanded work becomes a guard against closing anything.
    assert.match(body, /\*\*Why `glab ci status --wait` and not `--auto-merge`:\*\*/);
    for (const line of fencedLines(body).filter((l) => l.includes('glab mr merge'))) {
      assert.match(line, /glab ci status --wait &&/, `GitLab merge must wait: ${line.trim()}`);
      assert.doesNotMatch(line, /--auto-merge/, `--auto-merge does not wait: ${line.trim()}`);
    }
  });

  it('distinguishes an already-gone branch from a failed remote delete', () => {
    // These deletes are the real deletion now, not a post-`--delete-branch` no-op.
    // A blanket `|| true` would report a clean sweep while the claim branch
    // survives on the remote, where Phase 1's scan keeps reading the issue as
    // in-flight forever — so the fallback must check whether it is actually gone.
    const body = readCommand('next.md');
    for (const line of fencedLines(body).filter((l) => l.includes('git push origin --delete "<branch>"'))) {
      assert.doesNotMatch(line, /(2>\/dev\/null|\|\| true)/, line.trim());
    }
    assert.match(body, /git ls-remote --exit-code --heads origin "<branch>"/);
    assert.match(body, /git ls-remote --exit-code --heads origin "next\/\$\{SLUG\}"/);
    // ...an unconfirmed branch fails Phase 7's cleanup chain rather than being
    // logged away, and only rc 2 ("no such ref") counts as already-gone — a
    // transport or auth failure proves nothing about whether the branch survived.
    assert.match(body, /could not confirm next\/\$\{SLUG\} is gone \(ls-remote rc=\$RC\)[^\n]*"; false/);
    assert.match(body, /\[ "\$RC" -eq 2 \]/);
  });

  it('will not enter Phase 7 cleanup on a PR that only queued', () => {
    // Phase 7 removes the worktree first, so entering it on a queued merge
    // discards the working tree of a PR that has not landed.
    const body = readCommand('next.md');
    assert.match(body, /\*\*If this run opened and merged a PR, confirm it actually merged before touching\nanything\.\*\*/);
    assert.match(body, /run none of this phase/);
    // ...but a run that never opened a PR has nothing to read back, and applying the
    // gate there would skip the abandoned-claim teardown and strand the claim branch
    // Phase 2 already published — the phantom claim this same phase verifies against.
    assert.match(body, /has no PR to read back: skip this gate entirely/);
  });

  it('explains why the flag is absent so it is not "cleaned up" back in', () => {
    const body = readCommand('next.md');
    assert.match(body, /No `--delete-branch`/);
    assert.match(body, /Why no `--delete-branch` on the `gh` merge/);
    assert.match(body, /exits non-zero (even though|after) the merge/);
  });

  it('makes /do:pr resolve LINKED_WORKTREE and gate the flag on it', () => {
    const body = readCommand('pr.md');
    // Both paths must be normalized — raw, --git-common-dir is relative in a
    // subdirectory of a plain clone, so the probe would misreport every such repo
    // as a linked worktree. `cd … && pwd -P` does that on any git version;
    // --path-format=absolute fails OPEN on git < 2.31 (unknown flag => empty
    // output on both sides => "equal" => the unsafe --delete-branch path).
    assert.match(body, /GIT_DIR_ABS="\$\(cd "\$\(git rev-parse --git-dir\)" && pwd -P\)"/);
    assert.match(body, /GIT_COMMON_ABS="\$\(cd "\$\(git rev-parse --git-common-dir\)" && pwd -P\)"/);
    assert.doesNotMatch(body, /--path-format=absolute --git-(dir|common-dir)/);
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
    assert.match(body, /DEL_REMOTE="\$\(git config --get "branch\.\$BR\.remote"\)"/);
    assert.match(body, /git push "\$DEL_REMOTE" --delete "\$DEL_REF"/);
    // Any hardcoded-origin regression, however it is spelled, fails here.
    assert.doesNotMatch(body, /git push origin --delete/);
  });

  it('prints the LINKED_WORKTREE result instead of stranding it in a shell var', () => {
    // Shell variables do not survive from one Bash call to the next, so a probe
    // that only assigns leaves every later step re-expanding an empty string —
    // which silently takes the not-a-worktree path.
    const body = readCommand('pr.md');
    assert.match(body, /echo "LINKED_WORKTREE=\$LINKED_WORKTREE"/);
  });

  it('gates /do:pr\'s remote delete on a read-back MERGED state too', () => {
    const body = readCommand('pr.md');
    assert.match(body, /if \[ "\$\(gh pr view \{number\} --json state -q \.state\)" = "MERGED" \]; then/);
  });

  it('reports /do:pr\'s delete result without inverting the exit status', () => {
    // `ls-remote && echo ERROR` exits 0 on a real failure (echo is last) and
    // non-zero on the benign already-gone case — the very "non-zero after a
    // successful merge" symptom this branch exists to remove.
    const body = readCommand('pr.md');
    assert.match(body, /git ls-remote --exit-code --heads "\$DEL_REMOTE" "\$DEL_REF" >\/dev\/null 2>&1; RC=\$\?/);
    assert.doesNotMatch(body, /git ls-remote[^\n]*"\$DEL_REF" >\/dev\/null 2>&1 &&/);
  });

  it('skips /do:pr step 6\'s default-branch sync inside a linked worktree', () => {
    const body = readCommand('pr.md');
    const step6 = body.split('\n').find((line) => line.startsWith('6. After a **completed** merge'));
    assert.ok(step6, 'expected /do:pr step 6 to still exist');
    assert.match(step6, /git checkout \{default_branch\} && git pull --rebase --autostash/);
    assert.match(step6, /only when `LINKED_WORKTREE=0`/);
  });
});
