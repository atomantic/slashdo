'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const readLib = (name) => fs.readFileSync(path.join(root, 'lib', name), 'utf8');
const { readCommandDocs } = require('./helpers/command-docs');
const readCommand = (name) => readCommandDocs(name);

describe('PR write-access disposition', () => {
  it('probes push permission from the API, not from a login comparison', () => {
    const partial = readLib('pr-write-access.md');

    // The two ways a head branch becomes writable. Dropping either one silently
    // downgrades a whole class of PR to comment-only: without the head-repo probe
    // an ordinary same-repo PR never applies fixes, and without the
    // maintainerCanModify + base-push pair no fork PR ever does.
    assert.match(partial, /\.permissions\.push/);
    assert.match(partial, /maintainerCanModify/);
    assert.match(partial, /isCrossRepository/);
    assert.match(partial, /HEAD_PUSH=true/);
    assert.match(partial, /BASE_PUSH=true/);

    // A closed PR or a deleted fork has no branch to push to.
    assert.match(partial, /headRepository` is `null`/);
    assert.match(partial, /state` is not `OPEN`/);

    // maintainerCanModify reads false for org-owned forks and for non-maintainer
    // queries. Treating that as an error would abort runs that should just comment.
    assert.match(partial, /never an error/i);
    assert.match(partial, /organization/i);

    // gh pr checkout is what wires the cross-repo tracking ref; a hand-rolled
    // fetch+checkout pushes to the base repo instead of the author's fork.
    assert.match(partial, /gh pr checkout/);

    // The probe can pass and the wire can still refuse. Falling back to comments
    // keeps the review useful instead of losing it.
    assert.match(partial, /downgrade, not an abort/);
  });

  it('routes /do:review between pushing fixes and commenting, and never merges by default', () => {
    const command = readCommand('review.md');

    assert.match(command, /!`cat ~\/\.claude\/lib\/pr-write-access\.md`/);
    assert.match(command, /PR_DISPOSITION/);
    assert.match(command, /--apply and --no-apply cannot be combined/);

    // auto is the default: write access decides, not a flag the caller must know to pass.
    assert.match(command, /`PR_APPLY=auto`/);

    // A draft publishes nothing, so it must not push either.
    assert.match(command, /Implies `--no-apply`/);

    // Pushing to someone else's PR without running their tests is the failure this guards.
    const pushStart = command.indexOf('## Push fixes to the PR branch');
    assert.ok(pushStart > 0, 'review.md must document the apply path');
    const pushSection = command.slice(pushStart, command.indexOf('## Post Review to GitHub PR'));
    assert.match(pushSection, /build\/test run from "Fix Issues" must have passed/);
    assert.match(pushSection, /bare `git push`/);

    // An uncommitted working tree must never be checked out over.
    assert.match(command, /git status --porcelain` is non-empty/);

    // Merge is opt-in and gated; a commented CRITICAL is not a resolved one.
    assert.match(command, /without this flag `\/do:review` never merges anything/);
    const mergeStart = command.indexOf('## Merge the PR');
    assert.ok(mergeStart > 0, 'review.md must document the merge gate');
    const mergeSection = command.slice(mergeStart, command.indexOf('## Report'));
    assert.match(mergeSection, /`PR_DISPOSITION=inline` can never merge/);
    assert.match(mergeSection, /--required --watch --fail-fast/);
    assert.match(mergeSection, /headRefOid/);
    assert.match(mergeSection, /Never pass `--delete-branch`/);
  });
});

describe('VCS host portability', () => {
  // A self-managed GitHub Enterprise instance is commonly served from a domain with no
  // `github` in it at all. Two constructs make a command wrong on those installs: a URL
  // built on the literal domain (it 404s), and a branch gated on the literal domain (it
  // fails closed). Prose *explaining* that `gh api` defaults to github.com is neither.
  const URL_TEMPLATE = /https:\/\/github\.com\/\{/;
  const LITERAL_GATE = /\*github\.com[:\/]\*/;
  it('detects a PR reference by URL shape, never by hostname', () => {
    const command = readCommandDocs('review.md');
    const parseStart = command.indexOf('- **PR reference**');
    assert.ok(parseStart > 0, 'review.md must document PR-reference parsing');
    const parse = command.slice(parseStart, command.indexOf('- Any other non-flag token'));

    assert.match(parse, /Match on URL \*shape\*, never on the hostname/);
    assert.match(parse, /\{scheme\}:\/\/\{host\}\/\{owner\}\/\{repo\}\/pull\/\{number\}/);
    assert.match(parse, /no `github` substring/);
    assert.doesNotMatch(parse, /substring `github`/);

    // A GitLab MR URL must abort with a usable message rather than fall through to
    // the base-branch branch, which would review the wrong thing without saying so.
    assert.match(parse, /merge_requests/);
    assert.match(parse, /cannot review a GitLab merge request yet/);
  });

  it('keeps /do:fpr working on Enterprise hosts', () => {
    const fpr = readCommandDocs('fpr.md');

    // The old guard rejected any remote that was not literally github.com, which
    // failed closed on every Enterprise fork.
    assert.doesNotMatch(fpr, /\*github\.com:\*\|\*github\.com\/\*/);
    assert.doesNotMatch(fpr, /https:\/\/github\.com\/\{UPSTREAM_OWNER\}/);

    assert.match(fpr, /!read lib\/vcs-host\.md/);
    assert.doesNotMatch(fpr, /ORIGIN_HOST=|gh auth token --hostname "\$ORIGIN_HOST"/);
    assert.match(fpr, /ORIGIN_SLUG=/);
    assert.match(fpr, /gh repo view "\$GH_HOST\/\$ORIGIN_SLUG"/);
    assert.match(fpr, /git remote add upstream "https:\/\/\{GH_HOST\}\//);

    // `gh pr create --repo` does not infer the host from the local remote (unlike
    // `gh pr`/`gh repo` bare commands), so a bare OWNER/REPO here would target
    // gh's default host instead of the derived Enterprise one.
    assert.match(fpr, /gh pr create \\\n\s*--repo \{GH_HOST\}\/\{UPSTREAM_OWNER\}\/\{UPSTREAM_REPO\}/);
  });

  it('gives /do:fpr a real GitLab fork-MR path instead of stopping', () => {
    const fpr = readCommandDocs('fpr.md');

    // The old guard rejected any origin whose CLI was not `gh`; GitLab forks
    // now get a real path instead of a hard stop.
    assert.doesNotMatch(fpr, /stop and report that `\/do:fpr` requires a GitHub origin/);
    assert.match(fpr, /CLI_TOOL=glab/);
    assert.match(fpr, /glab api "projects\/:id"/);
    assert.match(fpr, /forked_from_project/);

    // GitLab's fork-MR endpoint resolves the target project by numeric id, not
    // a namespace/project path — this must be threaded through explicitly.
    assert.match(fpr, /UPSTREAM_PROJECT_ID/);
    assert.match(fpr, /--target-project \{UPSTREAM_PROJECT_ID\}/);
    assert.match(fpr, /glab mr create \\\n\s*--source-branch \{CURRENT_BRANCH\}/);

    // The GitLab upstream remote must not be built on a literal github.com or
    // an unresolved {GH_HOST} (that var is only populated on the GitHub path);
    // it reuses {ORIGIN_HOST} from vcs-host.md rather than re-deriving it.
    assert.match(fpr, /git remote add upstream "https:\/\/\{ORIGIN_HOST\}\//);
  });

  it('builds no URL and gates no branch on a literal github.com', () => {
    // Both bans sweep the whole shipped tree, so a new command or partial inherits
    // them without anyone remembering to add it here.
    const files = [
      ...fs.readdirSync(path.join(root, 'commands', 'do'))
        .filter((f) => f.endsWith('.md')).map((f) => ['commands/do', f]),
      ...fs.readdirSync(path.join(root, 'lib'))
        .filter((f) => f.endsWith('.md')).map((f) => ['lib', f]),
    ];
    for (const [dir, name] of files) {
      // scan.md's github.com references are a WebFetch allowlist for public advisory
      // data — a real domain allowlist, not an assumption about where a repo lives.
      if (name === 'scan.md') continue;
      const body = fs.readFileSync(path.join(root, dir, name), 'utf8');
      assert.doesNotMatch(
        body,
        URL_TEMPLATE,
        `${dir}/${name} templates a URL onto a literal github.com — build it from {GH_HOST}`,
      );
      assert.doesNotMatch(
        body,
        LITERAL_GATE,
        `${dir}/${name} gates a branch on a literal github.com glob — Enterprise hosts fail it`,
      );
    }
  });
});
