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
//
// #335: /do:pr, /do:next Phase 6, and swarm Phase C all merge through ONE shared
// procedure, lib/merge-gate.md. Its safety contracts are pinned here once, against
// the partial itself; the caller contracts below pin that each caller reaches it
// (and states its own inputs) instead of carrying a hand-maintained copy.
const fs = require('fs');
const path = require('path');
const gate = fs.readFileSync(path.join(__dirname, '..', 'lib', 'merge-gate.md'), 'utf8');
const rawDoc = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

describe('lib/merge-gate.md — the shared merge procedure (#335)', () => {
  it('never passes --delete-branch on a fenced gh merge, and appends it only outside a worktree', () => {
    const merges = fencedLines(gate).filter((line) => line.includes('gh pr merge'));
    assert.ok(merges.length >= 1, 'expected the gate to document its gh merge');
    for (const line of merges) {
      assert.doesNotMatch(line, /--delete-branch/, `worktree merge must not pass --delete-branch: ${line.trim()}`);
    }
    assert.match(gate, /`\{LINKED_WORKTREE\}=0`: append ` --delete-branch` to every `gh pr merge` below\./);
    assert.match(gate, /`\{LINKED_WORKTREE\}=1`: never pass `--delete-branch`\./);
    // ...and says why, so it is not "cleaned up" back in.
    assert.match(gate, /exits non-zero after the merge has already succeeded/);
  });

  it('gates the wait-mode merge on the pushed SHA\'s required checks, chained', () => {
    // An unchained `gh pr merge` on the next line merges even when --fail-fast
    // exits non-zero on a failing required check (or the push failed and CI is
    // watching the stale SHA).
    assert.match(
      gate,
      /\{GIT\} push "\$UP_REMOTE" "HEAD:\$UP_REF" && \\\n\s+gh pr checks \{PR\} --required --watch --fail-fast && \\\n\s+gh pr merge \{PR\} --\{MERGE_METHOD\}/,
    );
  });

  it('pushes to the config-derived upstream, never a bare or hardcoded push', () => {
    // Bare `git push` fans out to every same-named branch under push.default=matching.
    assert.match(gate, /UP_REMOTE="\$\(\{GIT\} config --get "branch\.\$BR\.remote"\)"/);
    assert.match(gate, /UP_REF="\$\(\{GIT\} config --get "branch\.\$BR\.merge"\)"/);
    assert.match(gate, /\[ "\$UP_REMOTE" = "\." \]/);
    for (const line of fencedLines(gate)) {
      assert.doesNotMatch(line, /(\{GIT\}|git) push( &&|$)/, `bare push: ${line.trim()}`);
      assert.doesNotMatch(line, /push origin/, `hardcoded origin: ${line.trim()}`);
    }
  });

  it('treats "no required checks reported" as vacuously satisfied after one re-watch', () => {
    assert.match(gate, /\*\*`no required checks reported`\*\*: `gh pr checks` exits non-zero even in this case/);
    assert.match(gate, /re-run the watch once/);
    assert.match(gate, /vacuously satisfied: run `gh pr merge \{PR\} --\{MERGE_METHOD\}` alone/);
  });

  it('owns the CI flake read and continues every merge path to the read-back', () => {
    assert.match(gate, /^!read lib\/ci-flake-handling\.md$/m);
    assert.match(gate, /Every path that ran `gh pr merge` continues to step 5\./);
  });

  it('never hardcodes the merge method', () => {
    // `--merge` means a merge commit, which a squash- or rebase-only repo rejects.
    for (const line of fencedLines(gate).filter((l) => /gh pr merge /.test(l))) {
      assert.match(line, /gh pr merge \{PR\} --\{MERGE_METHOD\}/, line.trim());
    }
    assert.match(gate, /## 1\. Resolve the merge method \(GitHub\)/);
    assert.match(gate, /Never hardcode `--merge`/);
    assert.match(
      gate,
      /gh repo view --json mergeCommitAllowed,squashMergeAllowed,rebaseMergeAllowed[^\n]*\\\n[^\n]*"squash"\), \(select\(\.mergeCommitAllowed\) \| "merge"\), \(select\(\.rebaseMergeAllowed\) \| "rebase"\)\] \| first \/\/ empty/,
    );
  });

  it('waits on the GitLab pipeline of the PR branch before merging', () => {
    // A failed push leaves the wait watching the stale pipeline; a wait without
    // --branch watches whatever the caller's cwd has checked out (the swarm
    // orchestrator's main repo), not the MR's branch.
    const merges = fencedLines(gate).filter((l) => l.includes('glab mr merge'));
    assert.ok(merges.length >= 1, 'expected the gate to document its glab merge');
    for (const line of merges) {
      assert.match(line, /\{GIT\} push "\$UP_REMOTE" "HEAD:\$UP_REF" && glab ci status --wait --branch "\$\{UP_REF#refs\/heads\/\}" && glab mr merge \{PR\}/, line.trim());
      assert.doesNotMatch(line, /--auto-merge/, `--auto-merge does not wait: ${line.trim()}`);
    }
    // ...and explains why wait mode avoids --auto-merge while /do:pr's queue mode uses it.
    assert.match(gate, /\*\*Why `wait` avoids `--auto-merge`:\*\*/);
    assert.match(gate, /\*\*`\{MODE\}=queue`:\*\* run `glab mr merge \{PR\} --auto-merge --yes --remove-source-branch`/);
  });

  it('reads the state back instead of trusting the merge exit status', () => {
    // A merge queue makes `gh pr merge` exit zero while the PR is only queued, and
    // GitHub auto-closes a PR whose head branch disappears.
    assert.match(gate, /GitHub: `gh pr view \{PR\} --json state -q \.state`\. Expect `MERGED`\./);
    assert.match(gate, /GitLab: `glab mr view \{PR\} --output json --jq \.state`\. Expect `merged`\./);
    assert.match(gate, /\*\*delete nothing\*\*/);
    assert.match(
      gate,
      /if \[ "\$\(gh pr view \{PR\} --json state -q \.state\)" = "MERGED" \]; then\n\s+BR="\$\(\{GIT\} branch --show-current\)"/,
    );
  });

  it('deletes the remote head via the config-derived upstream, not a hardcoded origin', () => {
    // An upstream of upstream/feature-x or origin/pr-123-head must not be resolved
    // to origin/<local name>, which would delete an unrelated remote branch.
    assert.match(gate, /DEL_REMOTE="\$\(\{GIT\} config --get "branch\.\$BR\.remote"\)"/);
    assert.match(gate, /\{GIT\} push "\$DEL_REMOTE" --delete "\$DEL_REF"/);
    assert.doesNotMatch(gate, /push origin --delete/);
  });

  it('distinguishes an already-gone branch from a failed remote delete without inverting the exit status', () => {
    // `ls-remote && echo ERROR` exits 0 on a real failure and non-zero on the benign
    // already-gone case; a blanket `|| true` would hide a surviving branch.
    assert.match(gate, /\{GIT\} ls-remote --exit-code --heads "\$DEL_REMOTE" "\$DEL_REF" >\/dev\/null 2>&1; RC=\$\?/);
    assert.doesNotMatch(gate, /ls-remote[^\n]*"\$DEL_REF" >\/dev\/null 2>&1 &&/);
    assert.match(gate, /\[ "\$RC" -eq 2 \]/);
    for (const line of fencedLines(gate).filter((l) => l.includes('--delete'))) {
      assert.doesNotMatch(line, /(2>\/dev\/null|\|\| true)/, line.trim());
    }
  });

  it('resolves LINKED_WORKTREE portably and prints it', () => {
    // Raw, --git-common-dir is relative in a subdirectory of a plain clone;
    // --path-format=absolute fails OPEN on git < 2.31. Shell vars do not survive
    // between Bash calls, so the result must be printed and carried.
    assert.match(gate, /GIT_DIR_ABS="\$\(cd "\$\(git rev-parse --git-dir\)" && pwd -P\)"/);
    assert.match(gate, /GIT_COMMON_ABS="\$\(cd "\$\(git rev-parse --git-common-dir\)" && pwd -P\)"/);
    assert.doesNotMatch(gate, /--path-format=absolute --git-(dir|common-dir)/);
    assert.match(gate, /echo "LINKED_WORKTREE=\$LINKED_WORKTREE"/);
  });
});

describe('merge-gate callers carry no copy of the procedure (#335)', () => {
  const callers = ['commands/do/pr.md', 'commands/do/next.md', 'lib/next-swarm.md', 'lib/next-gitlab.md'];

  it('no caller documents its own merge command, read-back delete, or flake read', () => {
    for (const rel of callers) {
      const body = rawDoc(rel);
      for (const line of fencedLines(body)) {
        assert.doesNotMatch(line, /gh pr merge|glab mr merge|gh pr checks|glab ci status/, `${rel}: ${line.trim()}`);
      }
      assert.doesNotMatch(body, /^!read lib\/ci-flake-handling\.md$/m, `${rel} must leave the flake read to the gate`);
      assert.doesNotMatch(body, /gh repo view --json mergeCommitAllowed/, `${rel} must leave method resolution to the gate`);
    }
  });

  it('/do:pr, /do:next, and swarm each read the gate and state their mode', () => {
    for (const rel of ['commands/do/pr.md', 'commands/do/next.md', 'lib/next-swarm.md']) {
      assert.match(rawDoc(rel), /^!read lib\/merge-gate\.md$/m, `${rel} must read the shared gate`);
    }
    assert.match(rawDoc('commands/do/pr.md'), /`\{MODE\}` is `queue`/);
    assert.match(rawDoc('commands/do/next.md'), /`\{GIT\}` is `git`, `\{MODE\}` is `wait`, `\{LINKED_WORKTREE\}` is `1`/);
    assert.match(rawDoc('lib/next-swarm.md'), /`\{GIT\}` is `git -C "<worktree>"`, `\{MODE\}` is `wait`, `\{LINKED_WORKTREE\}` is `1`/);
  });

  it('keeps the swarm method resolved once per batch and the remote delete in the gate', () => {
    const swarm = rawDoc('lib/next-swarm.md');
    assert.match(swarm, /Resolve `MERGE_METHOD` \(gate step 1\) \*\*once per invocation\*\*/);
    assert.match(swarm, /the gate's step 5 deletes the remote head/);
    // Step 4 closes the issue only on the gate's read-back.
    assert.match(swarm, /\*\*Close out the issue — only when step 3 read back `MERGED`\.\*\*/);
  });

  it('leaves single-issue /do:next\'s remote delete to Phase 7, after the local delete', () => {
    // Deleting the remote first prunes the tracking ref `git branch -d` checks
    // against, so Phase 7's delete of a squash-merged claim branch would refuse.
    const body = readCommand('next.md');
    assert.match(body, /\*\*Skip the remote delete in the gate's step 5; Phase 7 owns it\.\*\*/);
    assert.match(body, /git branch -d "next\/\$\{SLUG\}" && \\\nif ! git push origin --delete "next\/\$\{SLUG\}"; then/);
    assert.doesNotMatch(body, /remote no-op after --delete-branch merge/);
  });

  it('drops /do:next\'s duplicate saved-default read and second next-gitlab.md load', () => {
    const next = rawDoc('commands/do/next.md');
    assert.equal((next.match(/^!read lib\/next-gitlab\.md$/gm) || []).length, 1);
    assert.doesNotMatch(next, /Read only the method here, never the saved `merge` on\/off key/);
    assert.doesNotMatch(rawDoc('lib/config-defaults-issues-merge.md'), /again at merge time/);
  });

  it('makes /do:pr sync the default branch only outside a linked worktree', () => {
    const body = readCommand('pr.md');
    const step = body.split('\n').find((line) => line.startsWith('4. After a **completed** merge'));
    assert.ok(step, 'expected /do:pr\'s post-merge sync step to still exist');
    assert.match(step, /git checkout \{default_branch\} && git pull --rebase --autostash/);
    assert.match(step, /only when `LINKED_WORKTREE=0`/);
  });
});

describe('single-issue /do:next Phase 7 cleanup', () => {
  it('syncs Phase 7\'s default branch without switching the main repo\'s checkout', () => {
    // Phase 7 runs from the MAIN repo, which may have a different branch (or a
    // dirty tree) checked out than the default branch — an unconditional
    // `git checkout "${DEFAULT_BRANCH}"` there switches the user's branch out from
    // under them and, on a dirty tree, aborts outright, breaking the `&&` chain
    // before the claim branch is ever deleted.
    const body = readCommand('next.md');
    assert.doesNotMatch(
      body,
      /git fetch origin "\$\{DEFAULT_BRANCH\}" && \\\ngit checkout "\$\{DEFAULT_BRANCH\}" && \\\ngit pull --rebase --autostash/,
    );
    assert.match(
      body,
      /if \[ "\$\(git branch --show-current\)" = "\$\{DEFAULT_BRANCH\}" \]; then\n\s+git pull --ff-only --autostash\nelse\n\s+git fetch origin "\$\{DEFAULT_BRANCH\}:\$\{DEFAULT_BRANCH\}" \|\| \{/,
    );
    assert.match(body, /fi && \\\ngit branch -d "next\/\$\{SLUG\}" && \\/);
  });

  it('distinguishes an already-gone claim branch from a failed remote delete', () => {
    const body = readCommand('next.md');
    assert.match(body, /git ls-remote --exit-code --heads origin "next\/\$\{SLUG\}"/);
    // An unconfirmed branch fails the cleanup chain; only rc 2 counts as gone.
    assert.match(body, /could not confirm next\/\$\{SLUG\} is gone \(ls-remote rc=\$RC\)[^\n]*"; false/);
  });

  it('will not enter Phase 7 cleanup on a PR that only queued', () => {
    // Phase 7 removes the worktree first, so entering it on a queued merge
    // discards the working tree of a PR that has not landed.
    const body = readCommand('next.md');
    assert.match(body, /\*\*If this run opened and merged a PR, confirm it actually merged before touching\nanything\.\*\*/);
    assert.match(body, /merge gate's step 5 read-back/);
    assert.match(body, /run none of this phase/);
    // ...but a run that never opened a PR has nothing to read back, and applying the
    // gate there would skip the abandoned-claim teardown and strand the claim branch
    // Phase 2 already published.
    assert.match(body, /has no PR to read back: skip this gate entirely/);
  });

  it('keeps cleanup ordering concise while preserving the executable gate', () => {
    const body = readCommand('next.md');
    assert.match(body, /Each step is `&&`-gated and the remote delete runs last\./);
    assert.doesNotMatch(body, /Order matters: remove the worktree/);
    assert.doesNotMatch(body, /If the gate returns \*\*merged\*\*, continue to Phase 7/);
  });
});
