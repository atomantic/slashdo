'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const resolveIncludes = (body) =>
  body.replace(/!`cat ~\/\.claude\/lib\/(.+?)`/g, (match, name) => {
    const libFile = path.join(root, 'lib', name);
    return fs.existsSync(libFile) ? fs.readFileSync(libFile, 'utf8') : match;
  });

const next = resolveIncludes(
  fs.readFileSync(path.join(root, 'commands', 'do', 'next.md'), 'utf8'),
);
const config = fs.readFileSync(path.join(root, 'commands', 'do', 'config.md'), 'utf8');
const defaults = fs.readFileSync(
  path.join(root, 'lib', 'review-config-defaults.md'),
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
    assert.match(next, /gh api --hostname "\$GH_HOST" repos\/:owner\/:repo\/collaborators --paginate/);
    assert.match(next, /glab api --paginate "projects\/:id\/members\/all"/);
    assert.match(next, /select\(\.access_level >= 30\)/);
    assert.match(
      next,
      /Could not list collaborators for \$OWNER_REPO — \/do:next --collaborators cannot be enforced\. Aborting/,
    );
    assert.match(next, /never fall open to `--trusted-authors` alone/);
    // Two-step GitLab capture — a piped jq would fail-open on empty input.
    assert.match(next, /MEMBERS_JSON="\$\(glab api --paginate "projects\/:id\/members\/all"\)"/);
    assert.doesNotMatch(next, /glab api --paginate "projects\/:id\/members\/all" \| jq/);
  });

  it('requests author on the GitHub issue list so the walk can skip outsiders', () => {
    // Only the /do:next picker lists (priority/oldest walk) need author; other
    // `gh issue list` examples in included libs are unrelated.
    const picker = next.match(/--json number,title,assignees,labels,createdAt,body[^\n]*/g) || [];
    assert.ok(picker.length >= 2, `expected picker json shapes, got ${picker.length}`);
    for (const call of picker) {
      assert.match(call, /author/, `missing author on: ${call}`);
    }
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

describe('swarm workers inherit the orchestrator gates', () => {
  it('passes --self/--no-self, --collaborators/--no-collaborators, and --trusted-authors', () => {
    assert.match(swarm, /explicit `--self` or `--no-self`/);
    assert.match(swarm, /explicit `--collaborators` or `--no-collaborators`/);
    assert.match(swarm, /`--trusted-authors <list>` or `--trusted-authors none`/);
    assert.match(
      swarm,
      /who is not a collaborator on <owner\/repo> \(and not on --trusted-authors\)/,
    );
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
