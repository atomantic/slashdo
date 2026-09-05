'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const _readCache = new Map();
const _read = (...parts) => {
  const f = path.join(__dirname, "..", ...parts);
  if (!_readCache.has(f)) _readCache.set(f, fs.readFileSync(f, "utf8"));
  return _readCache.get(f);
};
const readLib = (name) => _read("lib", name);
const { readCommandDocs } = require('./helpers/command-docs');
const readCommand = (name) => readCommandDocs(name);

// The loop partials whose invocations carry arrays that can legitimately be empty
// (TIMEOUT_CMD when no timeout/gtimeout is installed, MODEL_FLAG when no model is
// pinned, OLLAMA_FLAGS on an ollama too old for the optional flags).
const LOOPS_WITH_OPTIONAL_ARRAYS = [
  'local-agent-review-loop.md',
  'ollama-review-loop.md',
  'enhance-loop.md',
];

describe('review-loop parse contracts', () => {
  it('never grants blanket permissions to feedback or applying reviewers', () => {
    for (const name of ['local-agent-review-loop.md', 'enhance-loop.md']) {
      const body = readLib(name);
      assert.doesNotMatch(body, /--dangerously-skip-permissions|danger-full-access|bypassPermissions|--yolo|--force\b|--sandbox disabled/);
      assert.match(body, /--tools "Read,Glob,Grep" --allowedTools "Read,Glob,Grep"/);
      assert.match(body, /--strict-mcp-config/);
      assert.match(body, /disableAllHooks/);
    }
    const body = readLib('local-agent-review-loop.md');
    assert.match(body, /sandbox_workspace_write.network_access=false -c features.shell_tool=false/);
    assert.match(body, /Inlining a\s+diff alone is not tool isolation/);
    assert.match(body, /no per-invocation settings-file selector/);
    assert.match(body, /"write_file\(\*\)"/);
    assert.match(body, /"command\(\*\)"/);
    assert.match(body, /"mcp\(\*\)"/);
    assert.match(body, /required reviewers remain\s+unsatisfied/);
  });

  it('lets the host orchestrator select focused review lenses from the diff', () => {
    const command = readCommand('review.md');
    const selection = readLib('review-agent-selection.md');

    assert.match(command, /The host CLI is the review orchestrator/);
    assert.match(command, /Strict mode does not force a focused agent/);
    assert.match(command, /selection protocol/);
    assert.match(command, /Spawn the selected agents simultaneously/);
    assert.match(command, /If the selection is\s+empty, spawn no focused agents/);
    assert.doesNotMatch(command, /Always dispatch agents 1–5/);
    assert.doesNotMatch(command, /Spawn agents 1–5 simultaneously/);

    assert.match(selection, /Start with an empty `SELECTED_REVIEW_AGENTS` list/);
    assert.match(selection, /If no focused lens is justified, dispatch no sub-agents/);
    assert.match(selection, /Structural Ambition \| `--strict` is active \*\*and\*\*/);
    assert.match(selection, /selected lenses and their reasons/);

    const summaryStart = command.indexOf('## Report');
    const report = command.slice(summaryStart);
    assert.match(report, /The table is dynamic/);
    assert.match(report, /Host orchestrator \(self-review\)/);
    assert.match(report, /Omit all focused-lens rows when none were selected/);
  });

  it('requires structured local-agent verdicts without weakening Codex handling', () => {
    const body = readLib('local-agent-review-loop.md');
    assert.match(body, /after stripping blank lines, the result must be either exactly `NO FINDINGS`/);
    assert.match(body, /Treat a missing, malformed, or contradictory result .* `STATUS=no-verdict`/);
    assert.match(body, /For `codex`, retain its native severity-tagged output handling/);
    assert.doesNotMatch(body, /If the log contains `NO FINDINGS` \(or no actionable findings/);
  });

  it('classifies an unparseable verdict as inconclusive, not a hard error', () => {
    // A reviewer that ran fine but answered in prose left the TREE fine too, so it
    // must not fire the wrapper's hard-error short-circuit (which skips every
    // remaining reviewer) and must stay excusable by `~opt`, whose documented
    // contract names "no-verdict" as an inconclusive status it excludes from the
    // merge gate. Mapping it to `cli-error` would break both promises at once.
    const body = readLib('local-agent-review-loop.md');
    assert.match(body, /`no-verdict` is \*\*inconclusive, not a hard error\*\*/);
    assert.match(body, /# clean \/ capped \/ no-verdict \/ guardrail \/ cli-error/);

    const wrapper = readLib('multi-reviewer-loop.md');
    assert.match(wrapper, /Local-agent loop: `clean \| capped \| no-verdict \| guardrail \| cli-error/);
    // Present in the inconclusive enumerations that gate the merge...
    assert.match(wrapper, /local-agent `guardrail`\/`no-verdict`, ollama `incomplete`/);
    // ...and absent from the hard-error short-circuit set.
    assert.doesNotMatch(
      wrapper,
      /if the inner loop returns `cli-error`, `broken-build`, `test-failed`, `rejected`, or `no-verdict`/,
    );
  });

  it('keeps reviewer stderr out of the log the verdict parser validates', () => {
    // The strict verdict contract above rejects anything that is not `NO FINDINGS`
    // or a complete FINDING block, so a merged CLI banner/progress line on stderr
    // would turn a clean review into a parse failure and block the merge.
    const body = readLib('local-agent-review-loop.md');
    assert.match(body, /> "\$LOG_FILE" 2> "\$ERR_FILE"/);
    assert.doesNotMatch(body, /\{INVOCATION\} > "\$LOG_FILE" 2>&1/);
  });

  it('treats malformed Ollama output as a coverage gap rather than an empty review', () => {
    const body = readLib('ollama-review-loop.md');
    assert.match(body, /PARSE_ERRORS=0/);
    assert.match(body, /is a \*\*parse error\*\*, not a clean file/);
    assert.match(body, /`STATUS=incomplete`, never `clean`/);
    assert.match(body, /REVIEW_ERRORS \+ PARSE_ERRORS >= REVIEWABLE/);
    assert.doesNotMatch(body, /Treat a section that fails to parse .* as no findings/);
  });

  it('guards the Ollama total-failure branch against a zero-reviewable diff', () => {
    // A rename-only diff skips every file as empty-diff, leaving REVIEWABLE=0 with
    // zero errors. An unguarded `0 >= 0` would report the hard-error `cli-error`
    // and block the merge on a diff that simply had nothing to review.
    const body = readLib('ollama-review-loop.md');
    const matches = body.match(/`REVIEWABLE > 0` and `REVIEW_ERRORS \+ PARSE_ERRORS >= REVIEWABLE`/g) || [];
    assert.equal(matches.length, 2, 'both total-failure checks must carry the REVIEWABLE > 0 guard');
    assert.match(body, /counted in at most ONE of REVIEW_ERRORS \/ PARSE_ERRORS/);
  });

  it('threads the per-reviewer ~max cap through to the loops that honor it', () => {
    // `~max` only works if the wrapper resolves each entry's cap and both inner
    // loops read it instead of their old hardcoded MAX_ITERATIONS=3.
    const wrapper = readLib('multi-reviewer-loop.md');
    assert.match(wrapper, /Ollama loop: `clean \| capped/);
    assert.match(wrapper, /\{MAX_EXPLICIT\}/);

    for (const name of ['local-agent-review-loop.md', 'ollama-review-loop.md']) {
      const body = readLib(name);
      assert.doesNotMatch(
        body,
        /Initialize `ITERATION=0`, `MAX_ITERATIONS=3`/,
        `${name} must take MAX_ITERATIONS from the caller, not hardcode 3`,
      );
      assert.match(body, /`MAX_EXPLICIT`/, `${name} must distinguish capped from guardrail`);
    }
  });

  it('threads the per-reviewer ~effort level through to the loops that honor it', () => {
    const wrapper = readLib('multi-reviewer-loop.md');
    assert.match(wrapper, /~effort=<level>/);
    assert.match(wrapper, /ENTRY_EFFORT/);
    assert.match(wrapper, /REVIEW_EFFORT/);

    const localAgent = readLib('local-agent-review-loop.md');
    assert.match(localAgent, /REVIEW_EFFORT/);
    assert.match(localAgent, /EFFORT_FLAG/);
    assert.match(localAgent, /\$\{EFFORT_FLAG\[@\]\+"\$\{EFFORT_FLAG\[@\]\}"\}/);

    const ollama = readLib('ollama-review-loop.md');
    assert.match(ollama, /OLLAMA_EFFORT/);
    assert.match(ollama, /PROMPT="\$PROMPT Target reasoning effort level: \$OLLAMA_EFFORT\."/);
  });
  it('builds each reviewer a carrier its CLI actually accepts, defaulting to none', () => {
    // `--effort` is correct for only claude/grok. Passing it to a CLI that
    // rejects it is a non-zero exit BEFORE the review runs, so that reviewer's
    // merge-gate slot holds a launch failure rather than a verdict:
    //   codex-cli 0.149.1: no --effort at any level (top-level, `review`, `exec`)
    //     -> error: unexpected argument '--effort' found
    //   agy 1.1.22: --effort is mutually exclusive with --model, which this loop
    //     always pins -> --effort is not supported for model "..."
    // The pre-flight therefore dispatches per agent and defaults to NO flag; an
    // agent nobody wrote an arm for must degrade to prompt-advisory effort, not
    // inherit `--effort`. That inheritance is what broke codex and agy.
    const loop = readLib('local-agent-review-loop.md');
    const preflight = loop.slice(
      loop.indexOf('# Reasoning effort carrier.'),
      loop.indexOf('# agy only: pin the review model'),
    );
    assert.ok(preflight, 'the effort-carrier pre-flight block must exist');

    // Per-agent carrier, asserted as a table so a new reviewer adds a row.
    const CARRIERS = [
      ['claude|grok', /claude\|grok\) EFFORT_FLAG=\(--effort "\$REVIEW_EFFORT"\)/],
      ['codex', /codex\)\s+EFFORT_FLAG=\(-c "model_reasoning_effort=\$REVIEW_EFFORT"\)/],
      ['cursor', /CURSOR_MODEL="\$\{REVIEW_MODEL\}\[effort=\$\{REVIEW_EFFORT\}\]"/],
      ['agy', /agy\) : ;;/],
    ];
    for (const [agent, re] of CARRIERS) {
      assert.match(preflight, re, `${agent} must get the carrier its CLI accepts`);
    }

    // Fail closed: the default is no flag, and the unknown-agent arm guesses nothing.
    assert.match(preflight, /^EFFORT_FLAG=\(\)$/m);
    assert.match(preflight, /\*\)\s+: ;;/, 'unknown agents must not inherit a flag');
    assert.ok(
      !/^\[ -n "\$REVIEW_EFFORT" \] && EFFORT_FLAG=\(--effort/m.test(preflight),
      'no unconditional --effort assignment may precede the per-agent dispatch',
    );

    // No invocation may pass a carrier its CLI rejects.
    for (const agent of ['codex', 'agy', 'cursor']) {
      const row = loop.split('\n').find((l) => l.startsWith(`| \`${agent}\` |`));
      assert.ok(row, `${agent} invocation row must exist`);
      assert.ok(
        agent === 'codex' || !row.includes('EFFORT_FLAG'),
        `the ${agent} invocation must not pass EFFORT_FLAG`,
      );
    }

    // The carrier table is the documented rule, and agy's variant is discovered
    // at run time rather than baked into a level table that would go stale.
    assert.match(loop, /\*\*Effort carriers\.\*\*/);
    assert.match(loop, /\| `agy` \| a model \*\*variant\*\* picked from `agy models`/);
    assert.match(loop, /not from a remembered table/);
    assert.match(loop, /AGY_MODEL_RESOLVED/, 'the agy choice must persist across loop iterations');
  });

  it('tells the in-process claude reviewer what to do with ~effort, and what not to reach for', () => {
    // The Agent tool takes a model but no reasoning effort, so a dispatching agent
    // handed `claude~effort=xhigh` has no parameter to put it in. Left unsaid, it
    // improvises — one run substituted Claude Code's own `/code-review --effort xhigh`
    // skill for $LOCAL_PROMPT, which fans out on its own and reports in its own
    // format, so the loop's FINDING/NO FINDINGS parse had nothing to read and the
    // reviewer's merge-gate slot was filled by a verdict nobody verified.
    const localAgent = readLib('local-agent-review-loop.md');
    const inProcess = localAgent.slice(localAgent.indexOf('When `REVIEW_AGENT=claude`: dispatch an in-process sub-agent'));
    assert.match(inProcess, /\*\*Effort\*\*: there is no in-process analog of `--effort`/);
    assert.match(inProcess, /no reasoning-effort parameter/);
    assert.match(inProcess, /Target reasoning effort level/);
    // And the host's own review command is named as the thing not to substitute.
    assert.match(inProcess, /Never substitute the host's own review command/);
    assert.match(inProcess, /\/code-review/);
  });

  it('lets ~opt excuse no-verdict and lets capped satisfy partial', () => {
    // Two ways a new status gets stranded: added to a loop's status set but not to
    // the aggregate rules that consume it. A ~opt no-verdict must reach the
    // optional-inconclusive exclusion, and a stop-mode run whose only pass returned
    // capped must match `partial` — otherwise it matches NO rule at all (`clean`
    // excludes stop-short-circuited runs) and the merge is blocked.
    const wrapper = readLib('multi-reviewer-loop.md');
    assert.match(
      wrapper,
      /\{OPTIONAL\}` is true and whose status is inconclusive \(`timeout`\/`error`\/`guardrail`\/`no-verdict`/,
    );
    assert.match(wrapper, /`no-verdict` — a local agent that ran but did not answer in the verdict format/);
    assert.match(
      wrapper,
      /- `partial` — .*every executed pass returned a clean-equivalent status — `clean`, copilot `too-large`, or `capped`/,
    );
  });

  it('asserts each pass pushed its fixes, and skips the check without an upstream', () => {
    // Every inner loop pushes its own fix commits as its last step and nothing
    // downstream re-checks it, so an improvised loop body leaves the fixes local
    // while the reviewer still reports clean and CI still passes on the stale
    // pushed tree. The assertion must compare against the UPSTREAM ref (a clean
    // working tree says nothing about committed-but-unpushed commits) and must
    // no-op on a never-pushed branch, which /do:review and /do:better allow.
    const wrapper = readLib('multi-reviewer-loop.md');
    assert.match(wrapper, /\*\*Assert the pass's fixes reached the remote\.\*\*/);
    assert.match(wrapper, /UNPUSHED="\$\(git log --oneline @\{u\}\.\.HEAD\)"/);
    assert.match(wrapper, /git rev-parse --abbrev-ref --symbolic-full-name @\{u\} >\/dev\/null 2>&1/);
    assert.match(wrapper, /else\n\s*UNPUSHED=""/, 'no upstream must skip the assertion');
    assert.match(wrapper, /`git status` is not a substitute/);
    assert.match(wrapper, /\*\*record the pass as `push-failed`\*\*/);
    // The union apply in parallel mode is the only writer, so it needs the same guard.
    assert.match(wrapper, /\*\*Assert the applied fixes reached the remote\*\*/);
  });

  it('routes push-failed to inconclusive and refuses to let ~opt excuse it', () => {
    // Same stranding failure the ~opt/capped test above guards: a status added to
    // the dispatch step but never wired into the aggregate rules is inert. And
    // push-failed specifically must NOT follow the optional-inconclusive exclusion
    // — an optional reviewer's fixes sitting unpushed still mean the merged tree
    // is not the reviewed tree.
    const wrapper = readLib('multi-reviewer-loop.md');
    assert.match(
      wrapper,
      /\*\*or any pass at all — optional included — whose status is `push-failed`\*\*/,
      'the inconclusive rule must consume push-failed regardless of {OPTIONAL}',
    );
    assert.match(wrapper, /- \*\*`push-failed`\.\*\* An optional reviewer's \*findings\* are still real fixes/);
    // Inconclusive, not a verdict: it can never satisfy a stop-mode short-circuit.
    assert.match(wrapper, /`no-verdict`\/`skipped`\/`not-requestable`\/`push-failed`/);
    // The `inconclusive` bullet ends by excusing ~opt passes. Unqualified, that
    // sentence flatly contradicts the push-failed carve-out two clauses earlier and
    // an orchestrator could read it as license to merge an ~opt reviewer's stranded
    // fixes — so the exemption must name the statuses it applies to.
    // Structural, not verbatim: match every "<verb> here" exemption by verb STEM, so
    // inflections ("does not count here", "is not counted here", "waived here") are
    // covered rather than only the handful of full phrasings we thought of, and check
    // a window on BOTH sides — a qualification may precede the phrase ("Passes marked
    // `~opt` whose status is not `push-failed` are ignored here") just as easily as
    // follow it. No length>0 canary: a correctly-qualified rewording that happens to
    // avoid every stem must not fail for being differently worded — the verbatim
    // "but never for `push-failed`" assertion further down is what pins that the
    // qualification exists at all.
    const exemptions = [...wrapper.matchAll(/(?:ignor|exclud|excus|count|waiv|appl)\w*\s+here/gi)];
    for (const m of exemptions) {
      assert.match(
        wrapper.slice(Math.max(0, m.index - 200), m.index + 200),
        /push-failed/,
        `an ~opt exemption at index ${m.index} does not name the statuses it covers — unqualified, it reads as license to merge a pass whose fixes never reached the remote`,
      );
    }
    assert.match(wrapper, /but never for `push-failed`, which lands the aggregate here regardless of `\{OPTIONAL\}`/);
    // A hard-error must keep its own status: rewriting it to push-failed would
    // silence the hard-error short-circuit and downgrade the aggregate from dirty
    // to inconclusive, past do:pr's "abort before creating the PR on dirty" gate.
    assert.match(wrapper, /\*\*except a hard-error\*\* \(`cli-error`\/`broken-build`\/`test-failed`\/`rejected`\), which keeps its own status/);
    // The consumers that restate the aggregate rule must agree with it.
    assert.match(readCommand('release.md'), /or `push-failed`, a pass whose fix commits never reached the remote/);
  });

  it('scopes the push assertion to the pass and never pushes by fan-out', () => {
    // Two ways this check could do damage rather than prevent it: publishing
    // deliberately-unpushed local commits on a pass that committed nothing (it is a
    // "did the push step run" check, not a "sync my branch" command), and a bare
    // `git push`, which under push.default=matching fans out to every same-named
    // local branch — including a release branch that may auto-tag and publish.
    const wrapper = readLib('multi-reviewer-loop.md');
    assert.match(wrapper, /if \[ "\$PASS_START_SHA" = "\$\(git rev-parse HEAD\)" \]; then/);
    // Parallel mode reuses the whole block (derivation + scoping + push together)
    // rather than restating a push whose variables nothing in that section defines.
    assert.match(
      wrapper,
      /\*\*the same block\*\* the series dispatch's step 5 defines, verbatim, with `PARALLEL_START_SHA` substituted for `PASS_START_SHA`/,
      'parallel mode needs the same zero-commit scoping and target derivation',
    );
    // The destination must come from @{u}, never from the local branch name:
    // `git push origin HEAD` resolves <dst> to refs/heads/<local-name>, so when the
    // upstream is named differently it pushes a spurious branch, leaves the PR head
    // stale, and @{u}..HEAD stays non-empty — #134's failure inside its own guard.
    // Derive from config, not by splitting the abbrev-ref: a remote name may contain
    // a slash, and a LOCAL upstream (remote ".") abbreviates with no slash at all —
    // which a %%/ + #*/ split turns into a bogus remote, firing a false push-failed
    // on a healthy branch. A local upstream has no remote to assert against at all.
    assert.match(wrapper, /PUSH_REMOTE="\$\(git config --get "branch\.\$BR\.remote"\)"/);
    assert.match(wrapper, /PUSH_BRANCH="\$\(git config --get "branch\.\$BR\.merge"\)"/);
    assert.match(wrapper, /\[ "\$PUSH_REMOTE" = "\." \]/, 'a local-branch upstream must skip the check');
    assert.match(wrapper, /not a bare `git push`, and not `git push origin HEAD`/);
    // Every PRESCRIBED push (identified by an explicit HEAD: destination — the prose
    // warnings about `git push origin HEAD` carry none) must use the derived form.
    // A verbatim doesNotMatch only ever blocks the one phrasing it quotes.
    // Scan raw text, not just backticked spans: the in-block occurrences are inside a
    // fence and carry no backticks, so a backtick-anchored scan would miss the very
    // command that actually runs.
    const prescribed = [...wrapper.matchAll(/git push [^\n`]*?HEAD:[^\s"`]*/g)].map((m) => m[0]);
    assert.ok(prescribed.length >= 3, 'the push must appear in the block (twice, with retry) and in prose');
    assert.ok(
      prescribed.every((c) => c === 'git push "$PUSH_REMOTE" "HEAD:$PUSH_BRANCH'),
      `every prescribed push must target the upstream-derived ref, got: ${prescribed.join(' | ')}`,
    );
    // branch.<name>.merge is already refs/heads/<name>; re-prefixing would produce
    // refs/heads/refs/heads/<name>.
    assert.doesNotMatch(
      wrapper,
      /git push [^\n`]*HEAD:refs\/heads\//,
      'no prescribed push may re-prefix refs/heads/ (naming it in a warning is fine)',
    );
    // The variables must be consumed in the shell that set them — spec snippets run
    // as separate Bash calls, where an empty PUSH_REMOTE means `git push "" "HEAD:"`.
    // The point is that the push lives inside the guard, in the same shell — not
    // that it sits on any particular line.
    assert.match(wrapper, /if \[ -n "\$UNPUSHED" \]; then[\s\S]{0,600}?git push "\$PUSH_REMOTE" "HEAD:\$PUSH_BRANCH"/);
    // A conflicted retry is a resolution handoff, not an automatic abort or a
    // push-failed verdict. The trailing false keeps the shell block from falling
    // through, while the explicit marker tells the orchestrator to resolve and
    // rerun the config-derived block before it dispatches another reviewer.
    assert.match(
      wrapper,
      /else\n\s*echo "REBASE_CONFLICT_NEEDS_RESOLUTION"\n\s*false\n/,
      'a conflicted retry must hand control to autonomous resolution without falling through',
    );
    assert.doesNotMatch(wrapper, /git rebase --abort/, 'the shared retry must not abort at the first conflict');
    assert.match(wrapper, /do \*\*not\*\* record `push-failed`/);
    assert.match(wrapper, /complete the rebase[\s\S]{0,180}?rerun this entire config-derived block/);

    // do:pr's pre-PR push must derive its destination the SAME way, from the branch's
    // upstream config — `git push origin {current_branch}` hardcodes the local branch
    // name as the destination, which is the very property multi-reviewer-loop.md calls
    // "#134's failure, reintroduced by the guard meant to prevent it": on a branch whose
    // upstream is named differently the push succeeds against a spurious ref, @{u}..HEAD
    // stays non-empty, and the run opens the PR anyway.
    const pr = readCommand('pr.md');
    assert.match(pr, /PUSH_REMOTE="\$\(git config --get "branch\.\$BR\.remote"\)"/);
    assert.match(pr, /PUSH_BRANCH="\$\(git config --get "branch\.\$BR\.merge"\)"/);
    assert.match(pr, /git push "\$PUSH_REMOTE" "HEAD:\$PUSH_BRANCH"/);
    assert.match(pr, /never a bare `git push`/);
    assert.match(pr, /never `git push origin \{current_branch\}`/);
    // The gate that feeds this assertion must actually COMMIT its fixes: the check
    // compares against the upstream ref, so a fix left uncommitted in the working tree
    // is invisible to it and the PR opens from the pre-fix tree regardless.
    assert.match(pr, /\*\*commit and push those fixes\*\*/);
    assert.match(pr, /Leaving the fixes uncommitted is invisible to that section's assertion/);
    // The gate's push must name its form, not leave it to the orchestrator — the two
    // forms it would otherwise reach for are the two this file forbids.
    assert.match(pr, /using the upstream-derived push described under "Open the PR"/);
    // Without a stop-on-failure clause the orchestrator falls through to gh pr create
    // and opens exactly the stale pre-review PR this guard exists to prevent.
    assert.match(pr, /\*\*If the push still fails after that one retry, do NOT create the PR\*\*/);
  });

  it('refuses to push into a local upstream instead of a remote', () => {
    // `git branch --set-upstream-to=main` sets branch.<n>.remote=".", and @{u} then
    // resolves fine — so the "no upstream, skip the check" carve-out never fires. An
    // unguarded derived push runs `git push . HEAD:refs/heads/main`, which silently
    // fast-forwards the LOCAL default branch onto this branch's HEAD, exits 0, and
    // leaves @{u}..HEAD empty — so the guard reports the branch reached the remote and
    // opens a PR for a branch never pushed anywhere. Verified against a scratch repo.
    for (const [label, body] of [['pr.md', readCommand('pr.md')], ['multi-reviewer-loop.md', readLib('multi-reviewer-loop.md')]]) {
      assert.match(body, /\[ "\$PUSH_REMOTE" = "\." \]/, `${label} must guard against a local ("." ) upstream`);
    }
    const pr = readCommand('pr.md');
    // The guard must come BEFORE the push it protects, and must stop the run.
    assert.match(pr, /if \[ -z "\$PUSH_REMOTE" \] \|\| \[ "\$PUSH_REMOTE" = "\." \][\s\S]{0,600}?exit 1[\s\S]{0,200}?git push "\$PUSH_REMOTE" "HEAD:\$PUSH_BRANCH"/);
    // -u rewrites branch.<n>.remote/.merge, so an unconditional `git push -u origin
    // <local-name>` re-points an existing upstream and defeats the derived guard at
    // its source — it must be scoped to the never-published case.
    assert.match(pr, /\*\*Not yet published to a remote\*\*[^\n]*`git push -u origin \{current_branch\}`/);
    assert.match(pr, /`-u` \*rewrites\* `branch\.<name>\.remote`\/`\.merge`/);
    // The Commit-and-Push case split must key on the REMOTE VALUE, not on whether
    // @{u} resolves: a local upstream resolves fine, so an @{u}-based test routes it
    // into the derived-push case and pushes into the local repo — the same CRITICAL,
    // one section earlier. The "not yet published" case must cover empty AND ".".
    assert.match(pr, /Discriminate on `branch\.<name>\.remote`, \*\*not\*\* on whether `@\{u\}` resolves/);
    assert.match(pr, /\*\*Not yet published to a remote\*\* — `PUSH_REMOTE` is empty \(no upstream at all\) \*\*or\*\* `\.`/);
    // ...and the OTHER half of the split, which is where the round-1 CRITICAL would
    // re-enter: `-u` on a genuine remote upstream rewrites branch.<n>.remote/.merge,
    // re-pointing a differently-named or non-origin upstream at origin/<local-name>.
    // Without this, reintroducing `-u` in the second bullet passes every other test.
    assert.match(pr, /\*\*A genuine remote upstream\*\*[^\n]*never `-u`/);
    // A conflicted retry must be resolved before /do:next or /do:pr-better resumes.
    assert.match(pr, /If that rebase conflicts, \*\*resolve it through/);
    assert.match(pr, /Do not classify an active rebase conflict as a push failure/);
    assert.doesNotMatch(pr, /conflicts, abort it\*\*/);
  });

  it('resolves do:pr rebase conflicts autonomously and regenerates derived files', () => {
    const pr = readCommand('pr.md');
    const prBetter = readCommand('pr-better.md');
    const phaseB = prBetter.slice(prBetter.indexOf('## Phase B'));
    const resolver = readLib('rebase-conflict-resolution.md');

    assert.match(pr, /If the rebase hits conflicts, \*\*resolve them and continue the rebase\*\*/);
    assert.match(pr, /rebase-conflict-resolution\.md/);
    assert.doesNotMatch(pr, /ask the user to resolve them/);
    assert.match(phaseB, /resolving and continuing through conflicts/);
    assert.match(phaseB, /A rebase conflict is not a handoff or stop condition/);
    assert.doesNotMatch(phaseB, /aborting and surfacing conflicts/);

    assert.match(resolver, /A conflict is a resolution step in the PR workflow/);
    assert.match(resolver, /Do not abort merely because Git reports\s+conflicts/);
    assert.match(resolver, /apiRouteCatalog\.generated\.json/);
    assert.match(resolver, /Resolve the human-authored inputs first/);
    assert.match(resolver, /Run the repository's canonical generator/);
    assert.match(resolver, /GIT_EDITOR=true git rebase --continue/);
    assert.match(resolver, /only then use `git rebase --skip`/);
    assert.match(resolver, /a resolved rebase is not a terminal status/);

    for (const name of ['local-agent-review-loop.md', 'ollama-review-loop.md']) {
      const loop = readLib(name);
      assert.match(loop, /rebase-conflict-resolution\.md/, `${name} must use the shared resolver`);
      assert.match(loop, /resolve and continue the rebase/, `${name} must continue after resolving`);
    }
  });

  it('files issues inside the scan-only gate, not after it', () => {
    // The instruction originally sat in the paragraph AFTER "STOP HERE ... and exit",
    // so an orchestrator following the gate literally exited before reaching it and
    // `--scan-only --issues` filed nothing at all. Moving it back reads fine in
    // isolation, which is exactly why it needs a test rather than a reviewer.
    for (const name of ['better.md', 'better-swift.md', 'depfree.md']) {
      const body = readCommand(name);
      const gate = body.match(/\*\*GATE: If `--scan-only` was passed, STOP HERE[^\n]*/);
      assert.ok(gate, `${name}: scan-only gate not found`);
      assert.match(
        gate[0],
        /file every surviving finding as an issue first/,
        `${name}: the issue-filing instruction must be inside the gate sentence, before the exit`,
      );
    }
  });

  it('blocks PR creation and merge on unpushed commits in do:pr', () => {
    // Backstop for the two moments where unpushed review fixes become user-visible
    // damage: a PR opened from the pre-review tree, and a merge that lands it.
    const pr = readCommand('pr.md');
    assert.match(pr, /\*\*First, assert the branch's commits reached the remote\.\*\*/);
    assert.match(pr, /\*\*Unpushed-commits gate\*\* — \*\*refuse to merge while the local branch is ahead of its remote\.\*\*/);
    // Fails closed: the gate exits non-zero rather than printing a result someone
    // has to interpret — the whole failure mode here is a step being skimmed past.
    assert.match(pr, /UNPUSHED="\$\(git log --oneline @\{u\}\.\.HEAD\)"[\s\S]{0,200}?if \[ -n "\$UNPUSHED" \]; then/);
    assert.match(pr, /REFUSING TO MERGE — these commits are not on the remote:/);
    assert.match(pr, /\s+exit 1/);
    assert.match(pr, /Never merge on `dirty`\/`inconclusive`, never merge while the branch has unpushed commits/);
  });

  it('guards every possibly-empty array expansion against bash 3.2 + set -u', () => {
    // Stock macOS has neither `timeout` nor `gtimeout`, so TIMEOUT_CMD is legitimately
    // empty there — and under /bin/bash 3.2 a bare "${ARR[@]}" on an empty array is an
    // UNSET expansion that aborts with `unbound variable` before the reviewer ever runs.
    // Every file then comes back RC=1 with empty output, the loop counts them all as
    // REVIEW_ERRORS, and the pass resolves to `cli-error` — a hard error `~opt` does not
    // excuse — blocking the merge on a PR no reviewer looked at. Only the
    // ${ARR[@]+"${ARR[@]}"} form is safe on bash 3.2, bash 4/5, and zsh alike.
    // Scan by PATTERN, not by a hardcoded array-name list, so a newly introduced
    // optional-argument array is covered the day it lands.
    for (const name of LOOPS_WITH_OPTIONAL_ARRAYS) {
      const body = readLib(name);
      // A bare "${ARR[@]}" — the lookbehind lets through the guarded ${ARR[@]+"${ARR[@]}"},
      // and the negative lookahead exempts the literal name `ARR`, which is the prose
      // metavariable used to *state* the rule, never a real array.
      const bare = body.match(/(?<!\+)"\$\{(?!ARR\[)[A-Z][A-Z0-9_]*\[@\]\}"/g);
      assert.equal(
        bare,
        null,
        `${name}: unguarded ${bare && bare.join(', ')} aborts under bash 3.2 + set -u when empty — use \${ARR[@]+"\${ARR[@]}"}`,
      );
      // ...and the opposite slip: a mechanical rewrite that wraps an already-guarded
      // expansion a second time. Harmless to bash, but it publishes a second "correct"
      // spelling of the rule this partial exists to teach, which is how it drifts.
      // `"?` because the second wrap may or may not quote the inner expansion —
      // ${A[@]+${A[@]+…}} and ${A[@]+"${A[@]+…}"} are both the same slip.
      const doubled = body.match(/\$\{([A-Z][A-Z0-9_]*)\[@\]\+"?\$\{\1\[@\]\+/g);
      assert.equal(doubled, null, `${name}: double-wrapped guard ${doubled && doubled.join(', ')} — one \${ARR[@]+…} is enough`);
    }
  });

  it('accepts cursor as a local-agent reviewer and probes the Cursor CLI, not Grok agent', () => {
    // Cursor Agent is a model-taking local reviewer. The slug is `cursor`
    // (alias `cursor-agent`). The binary is NOT `cursor` and is NOT a bare
    // `agent` without an identity check: Grok Build also installs `agent` on
    // PATH, so treating that as Cursor would silently review with the wrong CLI.
    const loop = readLib('local-agent-review-loop.md');
    const wrapper = readLib('multi-reviewer-loop.md');

    assert.match(loop, /`--review-with codex\|agy\|claude\|grok\|cursor`/);
    assert.match(loop, /`cursor-agent` normalizes to `cursor`/);
    assert.match(loop, /Cursor binary probe/);
    assert.match(loop, /command -v cursor-agent/);
    assert.match(loop, /Grok Build also installs an `agent` binary/);
    assert.match(loop, /plan\/ask by itself does not enforce/);
    assert.match(loop, /\| `cursor` \| folded into `--model` as `\[effort=<level>\]`/);
    // ~effort must actually change Cursor inference: fold into --model as
    // [effort=<level>], matching cursor[gpt-5]~effort=max and a saved
    // review-models cursor=gpt-5 plus cursor~effort=max. Never pass --effort.
    assert.match(loop, /CURSOR_MODEL="\$\{REVIEW_MODEL\}\[effort=\$\{REVIEW_EFFORT\}\]"/);
    assert.match(loop, /Tool-free fallback; otherwise `STATUS=no-verdict`/);

    // Config and docs must advertise the same model + effort grammar as the
    // other reviewers — a saved review-models entry and a ~effort suffix.
    assert.match(readCommand('config.md'), /--review-models codex=o3,claude=claude-opus-4-8,cursor=gpt-5/);
    assert.match(readCommand('config.md'), /cursor\[gpt-5\]~effort=max/);
    assert.match(_read('README.md'), /cursor\[gpt-5\]~effort=max/);
    assert.match(_read("README.md"), /--review-models cursor=/);

    assert.match(wrapper, /`cursor` \(alias `cursor-agent`\)/);
    assert.match(wrapper, /`codex` \| `agy` \| `claude` \| `grok` \| `cursor`/);
    assert.match(wrapper, /Use one of: codex, agy, claude, grok, cursor, ollama, copilot/);
    assert.match(wrapper, /Cursor binary probe/);

    const enhance = readLib('enhance-loop.md');
    assert.match(enhance, /`cursor` \| Verified tool-free fallback/);

    for (const name of ['review.md', 'pr.md', 'release.md', 'better.md', 'rpr.md', 'config.md']) {
      const body = readCommand(name);
      assert.match(
        body,
        /`cursor`/,
        `${name} must accept the cursor reviewer slug`,
      );
    }

    // rpr dispatches the inner loop itself (not via the multi-reviewer wrapper),
    // so its step-2 / Pass checklists must forward {REVIEW_EFFORT} — parse-only
    // mention is not enough. Cursor folds that value into --model; drop it and
    // `cursor[gpt-5]~effort=max` silently reviews at default effort.
    const rpr = readCommand('rpr.md');
    assert.match(rpr, /forwarding `REVIEWER_APPLIES`.+\{REVIEW_EFFORT\}/s);
    assert.match(rpr, /Pass `\{REVIEW_AGENT\}`.+\{REVIEW_EFFORT\}/s);
    assert.match(rpr, /\{OLLAMA_EFFORT\}/);
  });

  it('derives GH_HOST from the one lib partial, never a hand-copied snippet', () => {
    // lib/gh-host.md exists so the Enterprise-safe API host is derived ONCE, with its
    // full 3-step fallback chain. Eight sites used to re-type a shortened 2-step copy
    // that skipped the `gh repo view` fallback, so a repo with no parsable origin
    // silently polled github.com instead of the Enterprise host. Assert the partial
    // still carries the chain, that every command whose `gh api` calls need the host
    // pulls it in via the runtime include, and that nobody re-types the derivation.
    const partial = readLib('gh-host.md');
    assert.match(partial, /GH_HOST=\$\(git remote get-url origin/);
    assert.match(partial, /gh repo view --json url --jq '\.url'/);
    assert.match(partial, /\|\| GH_HOST=github\.com/);

    const GH_HOST_INCLUDE = /!`cat ~\/\.claude\/lib\/gh-host\.md`|!read lib\/gh-host\.md/;
    const CAT_INCLUDE = /!`cat ~\/\.claude\/lib\/([A-Za-z0-9._-]+\.md)`/g;
    const HOSTNAME_USE = /gh api --hostname/;

    // A file needs GH_HOST if it calls `gh api --hostname` itself or inlines a lib
    // that does (gh-host.md itself only documents the flag, so it doesn't count).
    const libNeedsHost = (name, seen = new Set()) => {
      if (name === 'gh-host.md' || seen.has(name)) return false;
      seen.add(name);
      const body = readLib(name);
      if (HOSTNAME_USE.test(body)) return true;
      return [...body.matchAll(CAT_INCLUDE)].some(([, dep]) => libNeedsHost(dep, seen));
    };

    // Derived from the tree, never hardcoded: a new command (or a newly-included lib)
    // that reaches a `gh api --hostname` call must carry the include or fail here.
    const commandsDir = path.join(__dirname, '..', 'commands', 'do');
    const commands = fs.readdirSync(commandsDir).filter((f) => f.endsWith('.md'));
    const needsHost = commands.filter((name) => {
      const body = readCommand(name);
      return HOSTNAME_USE.test(body)
        || [...body.matchAll(CAT_INCLUDE)].some(([, dep]) => libNeedsHost(dep));
    });
    assert.ok(
      needsHost.length >= 8,
      `expected the GH_HOST-dependent command set to stay broad, got ${needsHost.join(', ')}`,
    );
    for (const name of needsHost) {
      assert.match(
        readCommand(name),
        GH_HOST_INCLUDE,
        `${name} reaches a \`gh api --hostname\` call, so it must include lib/gh-host.md`,
      );
    }

    // And nobody re-types the derivation inline. Two bans, both derived over every file:
    // the origin-parse `sed` itself (the copied half that matters), and a bare
    // github.com fallback in its common spellings. next.md legitimately runs that parse
    // once as ORIGIN_HOST to pick gh vs glab BEFORE any GH_HOST exists (gh-host.md's own
    // `gh repo view` fallback is GitHub-only, so it cannot do that job) — that one line
    // is the sole exemption.
    const ORIGIN_PARSE = "sed -E 's#^[a-z]+://##";
    const DRIFTED_FALLBACK = /\|\|\s*(?:GH_)?HOST="?github\.com/;
    const DRIFTED_DEFAULT = /\$\{(?:GH_)?HOST:[=-]"?github\.com/;
    const banned = (body, label) => {
      for (const line of body.split('\n')) {
        if (line.includes(ORIGIN_PARSE) && !line.includes('ORIGIN_HOST=')) {
          assert.fail(`${label} re-types the gh-host.md origin parse: ${line.trim()}`);
        }
        assert.doesNotMatch(line, DRIFTED_FALLBACK, `${label} hand-copies the GH_HOST fallback`);
        assert.doesNotMatch(line, DRIFTED_DEFAULT, `${label} hand-copies the GH_HOST fallback`);
      }
    };
    for (const name of commands) banned(_read("commands", "do", name), name);
    const libsDir = path.join(__dirname, '..', 'lib');
    for (const name of fs.readdirSync(libsDir).filter((f) => f.endsWith('.md') && f !== 'gh-host.md')) {
      banned(readLib(name), `lib/${name}`);
    }
    // The repo's own .claude/commands/ specs too — a copy hid there once, outside a
    // sweep that only walked the shipped tree.
    const localDir = path.join(__dirname, '..', '.claude', 'commands');
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(path.join(dir, e.name)) : (e.name.endsWith('.md') ? [path.join(dir, e.name)] : []));
    if (fs.existsSync(localDir)) {
      for (const file of walk(localDir)) {
        banned(fs.readFileSync(file, 'utf8'), path.relative(path.join(__dirname, '..'), file));
      }
    }
  });

  it('keeps the empty-array rule in one partial the loops point at', () => {
    // An absent timeout binary is an environment condition, not a reviewer failure.
    // The explanation lives in ONE partial (the lib/gh-host.md convention) — five
    // near-identical copies is how the rule drifted mid-PR the first time. Assert the
    // partial carries the contract and that each loop links to it; do NOT assert on
    // the loops' own prose wording, which is theirs to copy-edit.
    const partial = readLib('empty-array-expansion.md');
    assert.match(partial, /\$\{ARR\[@\]\+"\$\{ARR\[@\]\}"\}\s+# correct/);
    assert.match(partial, /Stock macOS ships \*\*neither\*\* `timeout\(1\)`/);
    assert.match(partial, /supported configuration\*\*/);
    assert.match(partial, /unbound variable/);

    for (const name of LOOPS_WITH_OPTIONAL_ARRAYS) {
      assert.match(
        readLib(name),
        /lib\/empty-array-expansion\.md/,
        `${name} must point at the shared empty-array-expansion partial rather than restating it`,
      );
    }
  });
});
