'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
// A command's contract spans the file plus the lib docs it includes (`!cat` and
// on-demand `!read` alike): those are one document to the agent, and splitting a
// section into lib/ (e.g. issue #293's lib/next-gitlab.md) must not move it out of
// a contract's reach.
const { readCommandDocs } = require('./helpers/command-docs');

const root = path.join(__dirname, '..');

const next = readCommandDocs('next.md', { eager: true });
const config = fs.readFileSync(path.join(root, 'commands', 'do', 'config.md'), 'utf8');
const defaults = fs.readFileSync(
  path.join(root, 'lib', 'config-defaults-issues-merge.md'),
  'utf8',
);
const swarm = fs.readFileSync(path.join(root, 'lib', 'next-swarm.md'), 'utf8');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');

describe('/do:next --self claim gate (existing)', () => {
  it('keeps --self as a hard explicit-#num refuse, not an override', () => {
    assert.match(next, /\*\*`--self`\*\* \/ \*\*`--no-self`\*\*/);
    assert.match(
      next,
      /Issue #<num> was filed by <author>, not you — \/do:next --self only works on issues you filed/,
    );
    assert.match(next, /\[ "\$SELF_MODE" = "true" \] && LIST_ARGS\+=\(--author "@me"\)/);
  });
});

describe('/do:next --collaborators claim gate', () => {
  it('documents --collaborators / --no-collaborators on next and config', () => {
    assert.match(next, /\[--collaborators\|--no-collaborators\]/);
    assert.match(config, /\[--collaborators\|--no-collaborators\]/);
    assert.match(config, /`--collaborators` → key `collaborators`/);
    assert.match(defaults, /`collaborators` → the `--collaborators` \/ `--no-collaborators` flags/);
  });

  it('fetches live collaborators and fails closed on empty or error', () => {
    assert.match(next, /COLLAB_LOGINS="\$\(collaborators\)"/);
    assert.match(next, /gh api --hostname "\$GH_HOST" repos\/:owner\/:repo\/collaborators --paginate/);
    assert.match(next, /glab api --paginate "projects\/:id\/members\/all"/);
    assert.match(next, /select\(\.access_level >= 30\)/);
    assert.match(
      next,
      /Could not list collaborators for \$OWNER_REPO — \/do:next --collaborators cannot be enforced\. Aborting/,
    );
    assert.match(next, /never fall open to `--trusted-authors` alone/);
    assert.match(next, /MEMBERS_JSON="\$\(glab api --paginate "projects\/:id\/members\/all"\)"/);
    assert.doesNotMatch(next, /glab api --paginate "projects\/:id\/members\/all" \| jq/);
  });

  it('requests author on the GitHub issue list so the walk can skip outsiders', () => {
    // Only the /do:next picker lists (priority/oldest walk) need author; other
    // `gh issue list` examples in included libs are unrelated.
    const picker = next.match(/--json number,title,assignees,labels,createdAt[^\n]*/g) || [];
    assert.ok(picker.length >= 2, `expected picker json shapes, got ${picker.length}`);
    for (const call of picker) {
      assert.match(call, /author/, `missing author on: ${call}`);
    }
  });

  it('keeps issue bodies out of the walk list and skips the EXISTING_ISSUES dump (#291)', () => {
    // Bodies are fetched per candidate (steps 3-4), never for every open issue.
    const picker = next.match(/--json number,title,assignees,labels,createdAt[^\n]*/g) || [];
    for (const call of picker) {
      assert.doesNotMatch(call, /\bbody\b/, `walk list must not fetch body: ${call}`);
    }
    // GitLab walks project away `description`.
    const glabProjected = next.match(/\| \.\[\] \| \{iid,title,labels,assignees,author,created_at\}"/g) || [];
    assert.ok(glabProjected.length >= 2, `expected projected GitLab walks, got ${glabProjected.length}`);
    assert.match(next, /fetch the body for this candidate only\*\* with `issue_body <N>`/);
    assert.match(next, /check the freshest state with `issue_state <N>`/);
    assert.match(next, /reads only the setup partial, not \[lib\/plan-issue-filing\.md\]/);
  });

  it('refuses an explicit #num for a non-collaborator, not overridden', () => {
    assert.match(
      next,
      /who is not a collaborator on <owner\/repo> \(and not on --trusted-authors\)/,
    );
    assert.match(
      next,
      /These are the \*\*skips an explicit number does NOT override\*\* — `--self` and `--collaborators`/,
    );
  });

  it('auto-pick skip names both collaborator and trusted-authors', () => {
    assert.match(
      next,
      /#N filed by <author> — not a collaborator \(and not on --trusted-authors\)/,
    );
  });

  it('lets SELF_MODE win so the collaborator fetch is skipped', () => {
    assert.match(next, /If `SELF_MODE` is on, skip this fetch \(self is a subset/);
    assert.match(
      next,
      /if \[ "\$COLLAB_MODE" = "true" \] && \[ "\$SELF_MODE" != "true" \]; then/,
    );
  });
});

describe('/do:next --trusted-authors union', () => {
  it('is extra authors unioned only when COLLAB_MODE is on', () => {
    assert.match(next, /\[--trusted-authors <list>\]/);
    assert.match(next, /When `COLLAB_MODE` is off, `--trusted-authors` does not restrict or widen auto-pick/);
    assert.match(next, /TRUSTED_CLAIM_POOL="\$COLLAB_LOGINS"/);
    assert.match(next, /tr ',' '\\n'/);
    assert.match(defaults, /`trusted-authors` → `--trusted-authors <list>`/);
    assert.match(config, /`--trusted-authors <list>` → key `trusted-authors`/);
  });

  it('does not treat trusted-authors as a saved collaborator allowlist', () => {
    assert.match(next, /This is \*\*not\*\* a saved collaborator allowlist/);
    assert.match(config, /it is not a saved collaborator allowlist/);
    assert.match(defaults, /not a saved collaborator allowlist/);
  });

  it('accepts none/empty as a clear, and unset as a config key', () => {
    assert.match(config, /`--unset <key>`[\s\S]*`trusted-authors`/);
    assert.match(config, /Valid keys:[\s\S]*trusted-authors/);
    assert.match(next, /a saved `none` \(case-insensitive\) is a tombstone meaning no extra authors/);
    assert.match(config, /The literal `none` \(case-insensitive\) or an empty value is a tombstone stored as `none`/);
  });

  it('compares logins case-insensitively and validates login shape', () => {
    assert.match(next, /compare \*\*case-insensitively\*/);
    assert.match(next, /Invalid --trusted-authors login: \{value\}/);
    assert.match(config, /Invalid --trusted-authors login: \{value\}/);
    assert.match(next, /\^\[A-Za-z0-9\]\[A-Za-z0-9-\]\*\(\\\[bot\\\]\)\?\$/);
  });

  it('`--self` still wins over collaborators and trusted-authors', () => {
    assert.match(next, /`--self` still wins over both/);
    assert.match(defaults, /`--self` still wins over both/);
  });
});

describe('/do:next claim snippet', () => {
  it('keeps the sibling-race hard stop without repeated teardown rationale', () => {
    const claim = next.split('### Phase 2 — mark the issue in progress')[1].split('## Phase 3')[0];
    assert.match(claim, /assign_me "\$ISSUE_NUM"/);
    assert.match(claim, /ASSIGNEES="\$\(issue_assignees "\$ISSUE_NUM"\)"/);
    assert.match(claim, /unassign_me "\$ISSUE_NUM"/);
    assert.match(claim, /label_add "\$ISSUE_NUM" in-progress/);
    assert.match(claim, /grep -qxF "\$ME"/);
    assert.match(claim, /if printf '%s' "\$ASSIGNEES"[\s\S]*?git push origin --delete "next\/\$\{SLUG\}"[\s\S]*?exit 1/);
    assert.doesNotMatch(claim, /Claim exclusivity is best-effort/);
    assert.doesNotMatch(claim, /race-detected branch is a hard stop/);
    assert.doesNotMatch(claim, /HARD STOP/);
  });
});

describe('/do:next host verbs', () => {
  it('defines the requested GitHub forms once and routes claim operations through them', () => {
    for (const verb of ['issue_body', 'issue_state', 'issue_close_note', 'assign_me', 'unassign_me', 'label_add', 'label_rm', 'ci_wait_merge']) {
      const marker = '- ' + String.fromCharCode(96) + verb;
      const line = next.split('\n').find((candidate) => candidate.startsWith(marker));
      assert.ok(line && line.includes('` — `') && line.includes('gh '), `${verb} must have one GitHub form`);
    }
    assert.match(next, /\*\*Host verbs\.\*\*/);
    assert.match(next, /GitLab forms and the two-step `glab api` rule/);
  });
});

describe('swarm workers inherit the orchestrator gates', () => {
  it('passes the exact resolved self, collaborators, and trusted-authors decisions', () => {
    assert.match(
      swarm,
      /resolved `--self\|--no-self`, `--collaborators\|--no-collaborators`, `--trusted-authors <list>\|none` explicitly/,
    );
    assert.match(
      swarm,
      /who is not a collaborator on <owner\/repo> \(and not on --trusted-authors\)/,
    );
    assert.doesNotMatch(swarm, /per-run override that widened or narrowed the batch/);
    assert.doesNotMatch(swarm, /Also pass the orchestrator's resolved claim gates explicitly/);
  });
});

describe('swarm prose slimming keeps executable rules', () => {
  it('retains named-blocker holds, dispatch resolution, and reviewer preflight', () => {
    assert.match(swarm, /repeatedly hold any dependent whose named blocker is still open but was removed/);
    assert.match(swarm, /Re-run the hold pass if A2e drops cycle members/);
    assert.match(swarm, /light.*cheapest capable coding model.*medium.*workhorse.*heavy.*strongest available alias/);
    assert.match(swarm, /lack of entitlement, retry once with the session model/);
    assert.match(swarm, /exact orchestrator-owned `REVIEWER_PREFLIGHT` block/);
  });
});

describe('README documents the gates', () => {
  it('covers --collaborators and --trusted-authors in issue mode and config', () => {
    assert.match(readme, /--collaborators/);
    assert.match(readme, /--trusted-authors howlingmime,Joebok/);
    assert.match(readme, /Claim only collaborator-authored issues/);
    assert.match(readme, /Extra trusted authors/);
    assert.match(readme, /`--no-collaborators`/);
  });
});
