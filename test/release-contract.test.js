'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { readCommandDocs } = require('./helpers/command-docs');

// Parts of the release flow live in lib partials loaded on demand via `!read`; resolve
// them here so the snippets the tests below execute are reachable.
const resolved = readCommandDocs('release.md', { eager: true });

describe('/do:release source branch admission', () => {
  const { spawnSync } = require('child_process');
  const os = require('os');
  const admission = resolved.slice(
    resolved.indexOf('## Resolve Source Branch Admission'),
    resolved.indexOf('## Open the Release PR'),
  );
  const gate = fs.readFileSync(path.join(__dirname, '..', 'lib', 'release-source-gate.md'), 'utf8');

  // Run the rendered probe block against a stub `gh` that serves canned branch-rules/branch JSON.
  function probe({ rules, branch, fail }) {
    const block = admission.match(/```bash\n([\s\S]*?)\n```/)[1]
      .replace(/\{CLI_TOOL\}/g, 'gh').replace(/\{GH_HOST\}/g, 'github.com').replace(/\{owner\}/g, 'o').replace(/\{repo\}/g, 'r').replace(/\{source\}/g, 'main');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-admission-'));
    try {
      fs.writeFileSync(path.join(dir, 'rules.json'), rules);
      fs.writeFileSync(path.join(dir, 'branch.json'), branch);
      fs.writeFileSync(path.join(dir, 'gh'), [
        '#!/bin/sh',
        `[ -n "${fail || ''}" ] && exit 1`,
        `case "$*" in *rules/branches*) cat "${dir}/rules.json" ;; *) cat "${dir}/branch.json" ;; esac`,
      ].join('\n'), { mode: 0o755 });
      const result = spawnSync('bash', ['-c', block], {
        env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, CLI_TOOL: 'gh' },
        encoding: 'utf8',
      });
      return { status: result.status, out: result.stdout };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  const unprotected = JSON.stringify({ protected: false, protection: { enabled: false, required_status_checks: { enforcement_level: 'off', contexts: [], checks: [] } } });

  it('gates a source whose ruleset requires status checks, even for a bypass-capable actor', () => {
    const r = probe({ rules: JSON.stringify([{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'CI Gate' }] } }]), branch: unprotected });
    assert.equal(r.status, 0);
    assert.match(r.out, /SOURCE_ADMISSION_HANDOFF\tSOURCE_GATED=true/);
  });

  it('gates a source with classic required status checks or a required-PR rule', () => {
    const classic = JSON.stringify({ protected: true, protection: { enabled: true, required_status_checks: { enforcement_level: 'everyone', contexts: ['CI Gate'], checks: [] } } });
    assert.match(probe({ rules: '[]', branch: classic }).out, /SOURCE_GATED=true/);
    assert.match(probe({ rules: JSON.stringify([{ type: 'pull_request' }]), branch: unprotected }).out, /SOURCE_GATED=true/);
  });

  it('gates classic protection that only requires reviews, without waiting for nonexistent checks', () => {
    const reviewsOnly = JSON.stringify({ protected: true, protection: { enabled: true, required_status_checks: { enforcement_level: 'off', contexts: [], checks: [] } } });
    assert.match(probe({ rules: '[]', branch: reviewsOnly }).out, /SOURCE_GATED=true\tSOURCE_CHECKS_REQUIRED=false/);
    assert.match(probe({ rules: JSON.stringify([{ type: 'pull_request' }]), branch: unprotected }).out, /SOURCE_GATED=true\tSOURCE_CHECKS_REQUIRED=false/);
    assert.match(probe({ rules: JSON.stringify([{ type: 'required_status_checks' }]), branch: unprotected }).out, /SOURCE_GATED=true\tSOURCE_CHECKS_REQUIRED=true/);
  });

  it('leaves an unprotected or only force-push-protected source on the direct-push path', () => {
    assert.match(probe({ rules: '[]', branch: unprotected }).out, /SOURCE_GATED=false/);
    const rulesNoGate = JSON.stringify([{ type: 'non_fast_forward' }]);
    assert.match(probe({ rules: rulesNoGate, branch: unprotected }).out, /SOURCE_GATED=false/);
  });

  it('accepts absent classic check configuration and requires configured checks without an enforcement level', () => {
    for (const checks of [undefined, null]) {
      for (const protectedBranch of [true, false]) {
        const branch = JSON.stringify({ protected: protectedBranch, protection: { required_status_checks: checks } });
        const r = probe({ rules: '[]', branch });
        assert.equal(r.status, 0, r.out);
        assert.match(r.out, new RegExp(`SOURCE_GATED=${protectedBranch}\\tSOURCE_CHECKS_REQUIRED=false`));
      }
    }
    for (const checks of [{ contexts: ['CI Gate'], checks: [] }, { contexts: [], checks: [{ context: 'CI Gate', app_id: null }] }]) {
      const r = probe({ rules: '[]', branch: JSON.stringify({ protected: true, protection: { required_status_checks: checks } }) });
      assert.equal(r.status, 0, r.out);
      assert.match(r.out, /SOURCE_GATED=true\tSOURCE_CHECKS_REQUIRED=true/);
    }
  });

  it('rejects malformed classic check metadata instead of inferring no gate', () => {
    for (const checks of [false, 1, 'checks', { contexts: 'CI Gate' }, { contexts: false }, { checks: {} }, { checks: false }]) {
      const r = probe({ rules: '[]', branch: JSON.stringify({ protected: true, protection: { required_status_checks: checks } }) });
      assert.equal(r.status, 1);
      assert.match(r.out, /INCOMPLETE — Source branch admission is unverified/);
    }
  });

  it('returns from a landed review-fix branch with the local source advanced, preserving unrelated refs', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-source-sync-'));
    const git = (...args) => {
      const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      return r.stdout.trim();
    };
    try {
      git('init', '-b', 'main');
      git('config', 'user.name', 'Release Test');
      git('config', 'user.email', 'release@example.test');
      fs.writeFileSync(path.join(dir, 'version'), 'before');
      git('add', 'version');
      git('commit', '-m', 'initial');
      const oldSource = git('rev-parse', 'HEAD');
      git('branch', 'unrelated');
      git('checkout', '-b', 'release-fix/v1.0.1-1');
      fs.writeFileSync(path.join(dir, 'version'), 'after');
      git('commit', '-am', 'fix');
      const landed = git('rev-parse', 'HEAD');
      const remote = path.join(dir, 'remote.git');
      git('init', '--bare', remote);
      git('remote', 'add', 'origin', remote);
      git('push', 'origin', 'HEAD:refs/heads/main');
      fs.writeFileSync(path.join(dir, 'gh'), `#!/bin/sh\nprintf '%s\\n' '{"state":"MERGED","mergedAt":"2026-10-04T00:00:00Z","mergeCommit":{"oid":"${landed}"}}'\n`, { mode: 0o755 });
      const blocks = [...gate.matchAll(/```bash\n([\s\S]*?)\n```/g)];
      const sync = blocks.at(-1)[1].replace(/\{source\}/g, 'main').replace(/\{GATE_PR_NUMBER\}/g, '1').replace(/\{CLI_TOOL\}/g, 'gh');
      const r = spawnSync('bash', ['-c', 'incomplete() { echo "INCOMPLETE: $*"; exit 1; }\n' + sync], {
        cwd: dir, env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, CLI_TOOL: 'gh' }, encoding: 'utf8',
      });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.equal(git('branch', '--show-current'), 'main');
      assert.equal(git('rev-parse', 'main'), landed);
      assert.equal(git('rev-parse', 'unrelated'), oldSource);
      assert.equal(fs.readFileSync(path.join(dir, 'version'), 'utf8'), 'after');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('stops the sync block itself when the forge query fails', () => {
    const blocks = [...gate.matchAll(/```bash\n([\s\S]*?)\n```/g)];
    const sync = blocks.at(-1)[1].replace(/\{source\}/g, 'main').replace(/\{GATE_PR_NUMBER\}/g, '1').replace(/\{CLI_TOOL\}/g, 'gh');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-source-sync-fail-'));
    try {
      fs.writeFileSync(path.join(dir, 'gh'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
      // A positional incomplete already in scope (release.md's helper, and the
      // success-path stub above) must not swallow the named-variable call.
      const r = spawnSync('bash', ['-c', 'incomplete() { printf "POSITIONAL %s\\n" "$*"; exit 1; }\n' + sync], {
        cwd: dir, env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, CLI_TOOL: 'gh' }, encoding: 'utf8',
      });
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stdout, /INCOMPLETE — Source gate merge is unverified; the forge state query failed\./);
      assert.doesNotMatch(r.stdout, /POSITIONAL/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails closed when the rules cannot be read or parsed', () => {
    const failed = probe({ rules: '[]', branch: unprotected, fail: '1' });
    assert.equal(failed.status, 1);
    assert.match(failed.out, /INCOMPLETE — Source branch admission is unverified/);
    const incompleteShape = probe({ rules: '[]', branch: '{}' });
    assert.equal(incompleteShape.status, 1);
    assert.match(incompleteShape.out, /INCOMPLETE — Source branch admission is unverified/);
    const malformed = probe({ rules: '{"message":"Not Found"}', branch: unprotected });
    assert.equal(malformed.status, 1);
    assert.match(malformed.out, /INCOMPLETE — Source branch admission is unverified/);
  });

  it('resolves GitLab protection from the effective branch endpoint, accepting both true and false', () => {
    const block = admission.match(/```bash\n([\s\S]*?)\n```/)[1].replace(/\{CLI_TOOL\}/g, 'glab').replace(/\{source\}/g, 'main');
    const run =(protectedBranch, mustSucceed) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-admission-gl-'));
      try {
        fs.writeFileSync(path.join(dir, 'glab'), [
          '#!/bin/sh',
          `case "$*" in *repository/branches*) echo '{"protected": ${protectedBranch}}' ;; *) echo '{"only_allow_merge_if_pipeline_succeeds": ${mustSucceed}}' ;; esac`,
        ].join('\n'), { mode: 0o755 });
        return spawnSync('bash', ['-c', block], { env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, CLI_TOOL: 'glab' }, encoding: 'utf8' });
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    };
    for (const [prot, ci] of [[true, true], [true, false], [false, true], [false, false]]) {
      const r = run(prot, ci);
      assert.equal(r.status, 0, r.stdout);
      assert.match(r.stdout, new RegExp(`SOURCE_GATED=${prot}\\tSOURCE_CHECKS_REQUIRED=${ci}`));
    }
  });
});

describe('/do:release target and version-tag checkpoints, executed', () => {
  const { spawnSync } = require('child_process');
  const os = require('os');
  const block = resolved.slice(resolved.indexOf('## Post-Merge')).match(/```bash\n([\s\S]*?)\n```/)[1];

  // A scratch repo whose remote `release` branch holds a merged release: root -> prep -> merge.
  function run({ tagOwner, remoteTagAt, annotated }) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-tag-'));
    const git = (...args) => {
      const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      return r.stdout.trim();
    };
    try {
      git('init', '-q', '-b', 'main');
      git('config', 'user.name', 'Release Test');
      git('config', 'user.email', 'release@example.test');
      git('commit', '-q', '--allow-empty', '-m', 'root');
      const commits = { root: git('rev-parse', 'HEAD') };
      git('commit', '-q', '--allow-empty', '-m', 'chore: release v1.2.3');
      commits.prep = git('rev-parse', 'HEAD');
      git('commit', '-q', '--allow-empty', '-m', 'merge');
      commits.merge = git('rev-parse', 'HEAD');
      const remote = path.join(dir, 'remote.git');
      git('init', '-q', '--bare', remote);
      git('remote', 'add', 'origin', remote);
      git('push', '-q', 'origin', 'HEAD:refs/heads/release');
      if (remoteTagAt) {
        git('tag', ...(annotated ? ['-a', '-m', 'v1.2.3'] : []), 'v1.2.3', commits[remoteTagAt]);
        git('push', '-q', 'origin', 'refs/tags/v1.2.3');
        git('tag', '-d', 'v1.2.3');
      }
      const script = block
        .replace(/\{tag\}/g, 'v1.2.3').replace(/\{target\}/g, 'release').replace(/\{tag_owner\}/g, tagOwner)
        .replace(/\{PREPARED_RELEASE_SHA\}/g, commits.prep).replace(/\{MERGE_COMMIT\}/g, commits.merge)
        .replace(/sleep 10/g, 'sleep 0');
      const r = spawnSync('bash', ['-c', script], { cwd: dir, encoding: 'utf8' });
      const remoteTag = spawnSync('git', ['ls-remote', 'origin', 'refs/tags/v1.2.3^{}', 'refs/tags/v1.2.3'], { cwd: dir, encoding: 'utf8' })
        .stdout.trim().split('\n').filter(Boolean).map((line) => line.split('\t')[0]);
      return { status: r.status, out: r.stdout + r.stderr, remoteTag, commits };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  it('creates and pushes the tag at the merge commit when this command owns it', () => {
    const r = run({ tagOwner: 'command' });
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(r.remoteTag, [r.commits.merge]);
    assert.match(r.out, new RegExp(`RELEASE_TAG_HANDOFF\\tTARGET_SHA=${r.commits.merge}\\tTAG_COMMIT=${r.commits.merge}`));
  });

  it('waits for an automation-owned tag instead of creating it', () => {
    const r = run({ tagOwner: 'automation' });
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /INCOMPLETE — Version tag v1\.2\.3 is unverified/);
    assert.deepEqual(r.remoteTag, []);
  });

  it('accepts an existing tag on the release lineage, lightweight or annotated', () => {
    for (const annotated of [false, true]) {
      const r = run({ tagOwner: 'automation', remoteTagAt: 'merge', annotated });
      assert.equal(r.status, 0, r.out);
      assert.match(r.out, new RegExp(`TAG_COMMIT=${r.commits.merge}`));
    }
  });

  it('refuses a tag that is off the release lineage and leaves it where it is', () => {
    for (const tagOwner of ['command', 'automation']) {
      const r = run({ tagOwner, remoteTagAt: 'root' });
      assert.equal(r.status, 1, r.out);
      assert.match(r.out, /never overwritten/);
      assert.deepEqual(r.remoteTag, [r.commits.root]);
    }
  });

  it('fails closed when the tag owner was never substituted', () => {
    const r = run({ tagOwner: '{tag_owner}' });
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /the tag owner was not resolved/);
    assert.deepEqual(r.remoteTag, []);
  });
});

describe('/do:release current-release notes file', () => {
  const { spawnSync } = require('child_process');
  const os = require('os');
  const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'release.yml'), 'utf8');
  const step = workflow.slice(workflow.indexOf('- name: Generate changelog'), workflow.indexOf('- name: Create Release'));
  const script = step.slice(step.indexOf('run: |\n') + 7).replace(/^ {10}/gm, '');

  // Runs the workflow's real changelog step in a scratch repo; returns the exit status and release body.
  function runStep(version, notes) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slashdo-release-'));
    try {
      const sh = (cmd) => spawnSync('sh', ['-c', cmd], { cwd: dir, encoding: 'utf8' });
      sh('git init -q && git config user.email t@example.com && git config user.name t && git commit -q --allow-empty -m "chore: root" && git commit -q --allow-empty -m "feat: seed"');
      if (notes !== null) {
        fs.mkdirSync(path.join(dir, '.changelogs'));
        fs.writeFileSync(path.join(dir, '.changelogs', 'RELEASE.md'), notes);
      }
      const out = path.join(dir, 'gh-output');
      const r = spawnSync('bash', ['-c', script.replace('${{ steps.package-version.outputs.version }}', version)], {
        cwd: dir, encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: out },
      });
      const bodyPath = r.status === 0 ? fs.readFileSync(out, 'utf8').match(/body-path=(.+)/)[1] : null;
      return { status: r.status, stderr: r.stderr, body: bodyPath && fs.readFileSync(bodyPath, 'utf8') };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  it('publishes the notes file when its heading matches the package version', () => {
    const notes = '# Release v1.2.3\n\n## Highlights\n\n- Something.\n';
    const r = runStep('1.2.3', notes);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.body, notes);
  });

  it('fails on a version mismatch rather than publishing stale notes', () => {
    const r = runStep('1.2.4', '# Release v1.2.3\n\n- Old.\n');
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /does not match package\.json version v1\.2\.4/);
  });

  it('falls back to the commit list only when the file is missing', () => {
    const r = runStep('1.2.3', null);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.body, /^# Release v1\.2\.3\n\n## Changes\n\n- feat: seed/);
  });

  it('ships a single notes file whose heading matches package.json', () => {
    const dir = path.join(__dirname, '..', '.changelogs');
    assert.deepEqual(fs.readdirSync(dir), ['RELEASE.md']);
    const { version } = require('../package.json');
    assert.equal(fs.readFileSync(path.join(dir, 'RELEASE.md'), 'utf8').split('\n')[0], `# Release v${version}`);
  });
});
