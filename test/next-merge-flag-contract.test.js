'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { readCommandDocs } = require('./helpers/command-docs');

// #288: /do:next never defined --merge/--no-merge, had no unknown-flag rule, and
// Phase 6 told the model to forward "the flags this command received" to /do:pr —
// which, taken literally with an undefined --merge/--no-merge, forwards a
// combination /do:pr aborts on. These contracts pin the fix: the flags are defined
// in Parse Arguments and the argument-hint, unknown flags abort before any claim,
// and Phase 6 forwards only the named review flags, never the merge ones.
const next = readCommandDocs('next.md', { eager: false });

describe('/do:next --merge / --no-merge (#288)', () => {
  it('declares the merge flags in the argument-hint', () => {
    const hint = next.match(/^argument-hint: "(.+)"$/m);
    assert.ok(hint, 'expected an argument-hint line');
    assert.match(hint[1], /\[--merge\|--no-merge\|--merge=<method>\]/);
    assert.match(hint[1], /\[--merge-method <method>\]/);
    // Keep the pre-existing hint fragments other swarm workers' contract tests pin.
    assert.match(hint[1], /\[--collaborators\|--no-collaborators\]/);
    assert.match(hint[1], /\[--trusted-authors <list>\]/);
  });

  it('defines --merge / --no-merge / --merge=<method> / --merge-method in Parse Arguments', () => {
    assert.match(
      next,
      /\*\*`--merge`\*\* \/ \*\*`--no-merge`\*\* \/ \*\*`--merge=<method>`\*\* \/ \*\*`--merge-method <method>`\*\*/,
    );
    assert.match(next, /resolves `MERGE_ENABLED=true`/);
    assert.match(next, /`--no-merge` resolves `MERGE_ENABLED=false`/);
    assert.match(next, /--merge and --no-merge cannot be combined/);
    assert.match(
      next,
      /--merge=<method> and --merge-method specify conflicting methods \(\{first\} vs \{second\}\)/,
    );
  });

  it("keeps /do:next's own --no-merge default distinct from /do:pr's", () => {
    // /do:next has always merged its own claim once the gate passed; the built-in
    // default when neither flag is typed must stay `true`, not silently flip to
    // /do:pr's `false` (which would turn every existing /do:next run into a
    // leave-the-PR-open run).
    assert.match(
      next,
      /resolve `MERGE_ENABLED` from the saved `merge` default, else the \*\*built-in `true`\*\*/,
    );
  });

  it('aborts on an unrecognized flag before any claim is made', () => {
    assert.match(
      next,
      /\*\*Any other `--flag`\*\* not defined above aborts immediately, before any claim is made: `Unknown \/do:next option: \{flag\}\. Supported: [^`]+`/,
    );
  });

  it("stops after Phase 6 opens the PR on --no-merge, reusing the dirty/inconclusive stop path", () => {
    assert.match(
      next,
      /On `dirty`\/`inconclusive`, or when `MERGE_ENABLED=false` \(`--no-merge`\), \*\*stop and leave the PR open\*\*/,
    );
    assert.match(next, /do NOT run Phase 7 cleanup/);
  });

  it('gates the merge on MERGE_ENABLED before the review-result gate', () => {
    assert.match(
      next,
      /\*\*`MERGE_ENABLED` must be `true`\*\* \(Parse Arguments' `--merge`\/`--no-merge` resolution\)/,
    );
  });
});

describe('/do:next never forwards its own merge flags to /do:pr (#288)', () => {
  it('names only the review flags in the Phase 6 hand-off, not --merge/--no-merge', () => {
    assert.doesNotMatch(next, /with the flags this command received/);
    assert.match(
      next,
      /forwarding \*\*only the review flags listed in Parse Arguments\*\* \(`--review-with` \/ `--review-iterations` \/ `--review-mode` \/ `--review-stop-on-findings` \/ `--review-stop-on-clean` \/ `--reviewer-applies`\)/,
    );
    assert.match(
      next,
      /translating `--no-review` to `--review-with none` rather than forwarding it verbatim/,
    );
    assert.match(
      next,
      /never this command's own `--merge` \/ `--no-merge` \/ `--merge=<method>` \/ `--merge-method`, which `\/do:next` resolves for itself/,
    );
  });

  it('still always ships the internal /do:pr call with --no-merge', () => {
    assert.match(next, /\*\*Always pass `--no-merge` to `\/do:pr`\*\*/);
  });
});

describe('/do:next --merge is ignored under --swarm except for the method (#288)', () => {
  it('states the swarm skip for enable/disable but keeps --merge-method live for Phase C', () => {
    assert.match(
      next,
      /the orchestrator always attempts its own serialized merge in Phase C for every eligible result/,
    );
    assert.match(
      next,
      /`--merge=<method>`\/`--merge-method` still resolve `MERGE_METHOD` for that Phase C merge/,
    );
  });
});

describe('lib/config-defaults-issues-merge.md documents /do:next reading the merge key (#288)', () => {
  const defaults = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'lib', 'config-defaults-issues-merge.md'),
    'utf8',
  );

  it('no longer claims only /do:pr reads the merge key', () => {
    assert.doesNotMatch(defaults, /Only `\/do:pr` reads this key\./);
  });

  it('documents the differing built-in defaults for /do:pr vs /do:next', () => {
    assert.match(
      defaults,
      /`\/do:pr` and `\/do:next` both read this key, with different built-in defaults when it is absent/,
    );
    assert.match(defaults, /`\/do:pr`'s is `false`/);
    assert.match(defaults, /`\/do:next`'s is `true`/);
  });

  it('clarifies /do:next never relays --merge/--no-merge into its internal /do:pr call', () => {
    assert.match(
      defaults,
      /`\/do:next` never forwards `--merge`\/`--no-merge` to the `\/do:pr` call it makes internally/,
    );
  });
});
