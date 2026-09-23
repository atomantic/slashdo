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

// Per-harness recipes the local-agent core loads with a gated `!read` (#347).
const LOCAL_AGENT_RECIPES = {
  claude: 'local-agent-claude.md',
  agy: 'local-agent-agy.md',
  cursor: 'local-agent-cursor.md',
  opencode: 'local-agent-opencode.md',
  cmd: 'local-agent-cmd.md',
};
// The core plus every recipe, for assertions that pin a rule without caring
// which of the files carries it.
const readLocalAgent = () => ['local-agent-review-loop.md', ...Object.values(LOCAL_AGENT_RECIPES)]
  .map(readLib).join('\n\n');

describe('review-loop parse contracts', () => {
  it('keeps current-head protection in the shared GitHub and Copilot path', () => {
    const core = readLib('github-reviewer-loop.md');
    const copilot = readLib('copilot-review-loop.md');
    const currentHeadQueries = core.match(/pullRequest\(number: \{PR_NUMBER\}\) \{ headRefOid reviews\(last: 20\) \{[^\n]+commit \{ oid \}/g) || [];

    assert.ok(currentHeadQueries.length >= 2);
    assert.match(core, /reuse a review from \{REVIEWER_LOGIN\} only when its\s+`commit\.oid` equals the current `headRefOid`/);
    assert.match(core, /submittedAt[\s\S]{0,240}AND\*\* its `commit\.oid` equals this poll's\s+`headRefOid`/);
    assert.match(copilot, /github-reviewer-loop\.md/);
    assert.match(copilot, /current-`headRefOid` review gate/);
    assert.match(copilot, /do not reuse that error\s+review[\s\S]+wait only\s+for a later current-head review/);
    assert.doesNotMatch(copilot, /### Sub-agent prompt template|Run the following loop|FIX all unresolved|When done, report back/);
    assert.ok(Buffer.byteLength(copilot, 'utf8') <= 2048, 'the Copilot file must remain a small delta');
  });

  it('loads the Copilot delta with the core and keeps wait schedules with callers', () => {
    const callers = ['pr.md', 'review.md', 'release.md', 'depfree.md'].map(readCommand);
    callers.push(readLib('better-review-loop.md'));

    for (const caller of callers) {
      const coreAt = caller.indexOf('!read lib/github-reviewer-loop.md');
      const deltaAt = caller.indexOf('!read lib/copilot-review-loop.md');
      assert.ok(coreAt >= 0, 'each GitHub-side caller must load the shared core');
      assert.ok(deltaAt > coreAt, 'the Copilot delta must load after the shared core');
      assert.match(caller, /caller-owned `\{WAIT_SCHEDULE\}`/);
      assert.match(caller, /`copilot` —/);
      assert.match(caller, /`@<login>` —/);
      assert.match(caller, /never give one pass both schedules/);
    }

    const core = readLib('github-reviewer-loop.md');
    const wrapper = readLib('multi-reviewer-loop.md');
    const { ON_DEMAND_LIBS } = require('../src/transformer');
    assert.match(ON_DEMAND_LIBS.get('copilot-review-loop.md').what, /delta/);
    assert.match(ON_DEMAND_LIBS.get('github-reviewer-loop.md').when, /`copilot` or an `@<login>`/);
    assert.match(core, /WAIT SCHEDULE:\n\{WAIT_SCHEDULE\}/);
    assert.doesNotMatch(core, /TIMEOUT SCHEDULE|WAIT BUDGET|Iteration 1: max wait/);
    assert.match(wrapper, /caller-selected `\{WAIT_SCHEDULE\}`/);
    // Parallel-only content now lives in its own on-demand partial.
    assert.match(
      readLib('multi-reviewer-parallel.md'),
      /shared GitHub-reviewer template's steps 1–3 plus the Copilot delta[\s\S]+accept only a current-head review/,
    );
  });

  it('removes the redundant GraphQL escaping partial and include', () => {
    const core = readLib('github-reviewer-loop.md');
    assert.match(core, /inline literal values in JSON on stdin[\s\S]+never\s+put shell-expandable `\$variables` in a query string/);
    assert.equal(fs.existsSync(path.join(__dirname, '..', 'lib', 'graphql-escaping.md')), false);

    for (const source of [
      readLib('better-review-loop.md'),
      readCommand('depfree.md'),
      readCommand('rpr.md'),
      _read('install.sh'),
    ]) {
      assert.doesNotMatch(source, /graphql-escaping/);
    }
    assert.match(_read('uninstall.sh'), /OLD_LIBS=\([\s\S]*graphql-escaping[\s\S]*\)/);
  });

  it('never grants blanket permissions to feedback or applying reviewers', () => {
    for (const [name, body] of [['local-agent loop', readLocalAgent()], ['enhance-loop.md', readLib('enhance-loop.md')]]) {
      assert.doesNotMatch(body, /--dangerously-skip-permissions|danger-full-access|bypassPermissions|--yolo|--force\b|--sandbox disabled/, name);
      assert.match(body, /--tools "Read,Glob,Grep" --allowedTools "Read,Glob,Grep"/);
      assert.match(body, /--strict-mcp-config/);
      assert.match(body, /disableAllHooks/);
    }
    const body = readLib('local-agent-review-loop.md');
    assert.match(body, /sandbox_workspace_write.network_access=false -c features.shell_tool=false/);
    assert.match(body, /Inlining a\s+diff alone is not tool isolation/);
    assert.match(body, /required reviewers remain\s+unsatisfied/);
    // agy has never exposed an isolated-settings selector: no hypothetical JSON
    // profile or "if a future version…" text for a CLI that does not exist (#347).
    assert.match(readLib(LOCAL_AGENT_RECIPES.agy), /no per-invocation settings-file selector/);
    assert.doesNotMatch(readLocalAgent(), /toolPermission|"write_file\(\*\)"|future version/i);
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
    //   agy 1.2.2: --effort is only ever redundant-or-fatal next to --model, which
    //     this loop always pins -- a level that disagrees with the pinned variant is
    //     `--model gemini-3.8-flash-high conflicts with --effort=low`, and a model
    //     without variants is `--effort is not supported for model "..."`
    // The pre-flight therefore dispatches per agent and defaults to NO flag; an
    // agent nobody wrote an arm for must degrade to prompt-advisory effort, not
    // inherit `--effort`. That inheritance is what broke codex and agy.
    const loop = readLib('local-agent-review-loop.md');
    const start = loop.indexOf('# Reasoning effort carrier.');
    const end = loop.indexOf("Then run the recipe's pre-flight block");
    assert.ok(start >= 0 && end > start, 'the effort-carrier pre-flight block must exist');
    const preflight = loop.slice(start, end);

    // Per-agent carrier, asserted as a table so a new reviewer adds a row.
    const CARRIERS = [
      ['claude|grok', /claude\|grok\) EFFORT_FLAG=\(--effort "\$REVIEW_EFFORT"\)/],
      ['codex', /codex\)\s+EFFORT_FLAG=\(-c "model_reasoning_effort=\$REVIEW_EFFORT"\)/],
      ['pi', /pi\)\s+EFFORT_FLAG=\(--thinking "\$REVIEW_EFFORT"\)/],
      ['opencode', /opencode\)\s+EFFORT_FLAG=\(--variant "\$REVIEW_EFFORT"\)/],
    ];
    for (const [agent, re] of CARRIERS) {
      assert.match(preflight, re, `${agent} must get the carrier its CLI accepts`);
    }
    // agy and cursor fold effort into the model inside their recipes; neither
    // may inherit an EFFORT_FLAG arm.
    assert.doesNotMatch(preflight, /^\s*(?:agy|cursor)\)/m);
    assert.match(readLib(LOCAL_AGENT_RECIPES.cursor), /CURSOR_MODEL="\$\{REVIEW_MODEL\}\[effort=\$\{REVIEW_EFFORT\}\]"/);

    // Fail closed: the default is no flag, and the unknown-agent arm guesses nothing.
    assert.match(preflight, /^EFFORT_FLAG=\(\)$/m);
    assert.match(preflight, /\*\)\s+: ;;/, 'unknown agents must not inherit a flag');
    assert.ok(
      !/^\[ -n "\$REVIEW_EFFORT" \] && EFFORT_FLAG=\(--effort/m.test(preflight),
      'no unconditional --effort assignment may precede the per-agent dispatch',
    );

    // No invocation may pass a carrier its CLI rejects.
    for (const agent of ['agy', 'cursor']) {
      assert.doesNotMatch(readLib(LOCAL_AGENT_RECIPES[agent]), /EFFORT_FLAG/, `the ${agent} invocation must not pass EFFORT_FLAG`);
    }

    // The carrier table is the documented rule, and agy's variant is discovered
    // at run time rather than baked into a level table that would go stale.
    assert.match(loop, /Never assume `--effort` is universal/);
    assert.match(loop, /\| `agy` \| `agy` \| a model \*\*variant\*\* picked from `agy models`/);
    const agy = readLib(LOCAL_AGENT_RECIPES.agy);
    assert.match(agy, /not from a remembered table/);
    assert.match(agy, /AGY_MODEL_RESOLVED/, 'the agy choice must persist across loop iterations');
  });

  it("resolves the agy review model against the live roster, not a hardcoded name", () => {
    // agy exits non-zero on a model it does not list, and its roster churns between
    // releases (the Gemini 3.5 tier this loop once pinned is gone in 1.2.2). So the
    // pre-flight must print `agy models` for EVERY agy review -- not only when
    // ~effort asked for a level -- and the selection step must fall back when the
    // requested name (stale env var, stale saved review-models.agy, typo'd bracket)
    // is absent, rather than handing that reviewer's merge-gate slot a launch failure.
    const block = readLib(LOCAL_AGENT_RECIPES.agy);
    assert.match(block, /if \[ "\$REVIEW_AGENT" = agy \] && \[ -z "\$AGY_MODEL_RESOLVED" \]; then/, 'the roster must be fetched for every agy review, not only when an effort level was requested');
    assert.match(block, /\bagy models\b/);
    assert.match(block, /Validate the requested model first/);
    assert.match(block, /Never pass `--effort` alongside `--model`/);
    // A bare base name must never be passed straight to --model (agy rejects it)...
    assert.match(block, /agy itself rejects the bare base/);
    // ...but it is completable against a same-base leveled sibling using ~effort,
    // not simply unrecognized -- issue #258.
    assert.match(block, /a bare base is not automatically unrecognized/);
    assert.match(block, /resolved agy\[gemini-3\.8-flash\]~effort=low -> gemini-3\.8-flash-low/);
    // ~effort must govern the final level whichever way the family was picked --
    // an exact match or the roster-default fallback, not only a base completion --
    // since agy's model IS its effort setting and there is no separate --effort
    // flag to carry a mismatched level.
    assert.match(
      block,
      /This step always runs — on an exact match and on the roster default, not only on a base completion/,
    );
  });

  it("gates enhance-loop's agy roster probe to agy entries only, and pins a leveled default", () => {
    // The per-entry model block in the enhancement loop runs once per agent, so an
    // unguarded `agy models` call there fires a network probe -- and dumps an
    // irrelevant model roster into the orchestrator's shell -- on every codex,
    // claude, grok, cursor and pi pass too. It must be gated on the entry's agent,
    // matching the review loop's own `[ "$REVIEW_AGENT" = agy ]` guard, and the
    // pinned default must be resolved against agy's live roster rather than a
    // remembered literal (same rule, same reason as local-agent-review-loop.md's
    // agy block).
    const enhance = readLib('enhance-loop.md');
    const block = enhance.slice(enhance.indexOf('# agy always pins a model'), enhance.indexOf('### Per-agent invocation'));
    assert.match(
      block,
      /\[ "\$AGENT" = agy \] && agy models\b/,
      'the roster probe must only fire for an agy entry, not every agent',
    );
    assert.match(block, /agy recipe in `lib\/local-agent-agy\.md`/);
    assert.match(block, /never a bare base/, 'the pinned default must be a leveled model name');
    assert.match(block, /validate AGY_ENH_MODEL against this; fall back to the newest Flash \(High\)/);
  });

  it('tells the in-process claude reviewer what to do with ~effort, and what not to reach for', () => {
    // The Agent tool takes a model but no reasoning effort, so a dispatching agent
    // handed `claude~effort=xhigh` has no parameter to put it in. Left unsaid, it
    // improvises — one run substituted Claude Code's own `/code-review --effort xhigh`
    // skill for $LOCAL_PROMPT, which fans out on its own and reports in its own
    // format, so the loop's FINDING/NO FINDINGS parse had nothing to read and the
    // reviewer's merge-gate slot was filled by a verdict nobody verified.
    const inProcess = readLib(LOCAL_AGENT_RECIPES.claude);
    assert.match(inProcess, /<!-- if:teams -->\n### Step 2 under Claude Code: in-process sub-agent/);
    assert.match(inProcess, /\*\*Effort\*\*: there is no in-process analog of `--effort`/);
    assert.match(inProcess, /no reasoning-effort parameter/);
    assert.match(inProcess, /Target reasoning effort level/);
    // And the host's own review command is named as the thing not to substitute.
    assert.match(inProcess, /Never substitute the host's own review command/);
    assert.match(inProcess, /\/code-review/);
  });

  it('keeps Claude Code on the in-process reviewer path with snapshot enforcement', () => {
    const localAgent = readLocalAgent();
    const enhance = readLib('enhance-loop.md');
    const dispatch = readLib(LOCAL_AGENT_RECIPES.claude);

    assert.match(dispatch, /Step 1 snapshot and Step 3 restore/);
    assert.match(dispatch, /REVIEWER_APPLIES=false/);
    assert.doesNotMatch(dispatch, /verified `REVIEWER_APPLIES=true`/);
    assert.doesNotMatch(localAgent, /This rule overrides every in-process dispatch example below/);
    assert.doesNotMatch(localAgent, /flags below disable each CLI's approval gates/);
    assert.match(enhance, /Under Claude Code, keep the in-process sub-agent as the\s+plan-billing path/);
    assert.doesNotMatch(enhance, /The Agent API must enforce a read-only tool set; otherwise/);
  });

  it('commits leftover edits before clean and normalizes reviewer-applies commits', () => {
    const loop = readLib('local-agent-review-loop.md');
    const reviewOnly = loop.slice(
      loop.indexOf('**When `REVIEWER_APPLIES=false` (default — orchestrator applies)**'),
      loop.indexOf('**When `REVIEWER_APPLIES=true` (reviewer applies)**'),
    );
    const reviewerApplies = loop.slice(loop.indexOf('**When `REVIEWER_APPLIES=true` (reviewer applies)**'));

    assert.ok(
      reviewOnly.indexOf('If recomputed `UNCOMMITTED > 0`') < reviewOnly.indexOf('If recomputed `NEW_COMMITS == 0`'),
    );
    assert.match(reviewOnly, /address review \(\$REVIEW_AGENT\): orchestrator-applied/);
    assert.match(reviewerApplies, /leave its changes uncommitted/);
    assert.match(reviewerApplies, /git reset --soft "\$LOOP_START_SHA"/);
    assert.match(reviewerApplies, /address review \(\$REVIEW_AGENT\): <summary>/);
    assert.doesNotMatch(reviewerApplies, /chore: local review changes/);
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
    // The union apply in parallel mode is the only writer, so it needs the same guard
    // (parallel-only content now lives in its own on-demand partial).
    const parallelLib = readLib('multi-reviewer-parallel.md');
    assert.match(parallelLib, /\*\*Assert the applied fixes reached the remote\*\*/);
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
    // /do:release must consume the aggregate, not restate it: its old copy of the
    // `inconclusive` rule had no ~opt exception and refused merges the wrapper cleared.
    const release = fs.readFileSync(path.join(__dirname, '..', 'commands', 'do', 'release.md'), 'utf8');
    assert.match(release, /Merge only when the wrapper's `\{OVERALL_STATUS\}` is `clean`, or `partial` with an explicit/);
    assert.doesNotMatch(release, /\*\*at least one\*\* executed pass was inconclusive/);
    assert.doesNotMatch(release, /Copilot-specific checks|Awaiting requested review/);
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
    // Parallel-only content now lives in its own on-demand partial.
    assert.match(
      readLib('multi-reviewer-parallel.md'),
      /\*\*the same block\*\* the series dispatch's step 5 defines.*, verbatim, with `PARALLEL_START_SHA` substituted for `PASS_START_SHA`/,
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
    for (const name of ['local-agent-review-loop.md', 'ollama-review-loop.md']) {
      const loop = readLib(name);
      assert.match(loop, /PUSH_REMOTE="\$\(git config --get "branch\.\$BR\.remote"\)"/, `${name} must derive its push remote from branch config`);
      assert.match(loop, /PUSH_BRANCH="\$\(git config --get "branch\.\$BR\.merge"\)"/, `${name} must derive its push ref from branch config`);
      assert.match(loop, /\[ "\$PUSH_REMOTE" = "\." \]/, `${name} must reject a local upstream`);
      const prescribed = [...loop.matchAll(/git push [^\n`]*?HEAD:[^\s"`]*/g)].map((m) => m[0]);
      assert.ok(prescribed.length >= 2, `${name} must prescribe the upstream-derived push and retry`);
      assert.ok(prescribed.every((c) => c === 'git push "$PUSH_REMOTE" "HEAD:$PUSH_BRANCH'), `${name} has a non-derived push: ${prescribed.join(' | ')}`);
      assert.doesNotMatch(loop, /git push origin \{BRANCH_NAME\}/, `${name} must not assume origin or the local branch name`);
    }
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
    assert.match(pr, /using "Open the PR"'s upstream-derived push below/);
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
    for (const name of [...LOOPS_WITH_OPTIONAL_ARRAYS, ...Object.values(LOCAL_AGENT_RECIPES)]) {
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
    const loop = readLocalAgent();
    const wrapper = readLib('multi-reviewer-loop.md');

    assert.match(loop, /`--review-with codex\|agy\|claude\|grok\|pi\|cursor\|opencode\|cmd\[<invocation>\]`/);
    assert.match(loop, /`cursor-agent` normalizes to `cursor`/);
    assert.match(loop, /Cursor binary probe/);
    assert.match(loop, /command -v cursor-agent/);
    assert.match(loop, /Grok Build also installs an `agent` binary/);
    assert.match(loop, /plan\/ask by itself does not enforce/);
    assert.match(loop, /\| `cursor` \|[^\n]*\| folded into `--model` as `\[effort=<level>\]`/);
    // ~effort must actually change Cursor inference: fold into --model as
    // [effort=<level>], matching cursor[gpt-5]~effort=max and a saved
    // review-models cursor=gpt-5 plus cursor~effort=max. Never pass --effort.
    assert.match(loop, /CURSOR_MODEL="\$\{REVIEW_MODEL\}\[effort=\$\{REVIEW_EFFORT\}\]"/);
    assert.match(loop, /"\$REVIEW_BIN" -p "\$LOCAL_PROMPT" --trust --mode ask \$\{MODEL_FLAG\[@\]\+"\$\{MODEL_FLAG\[@\]\}"\}/);

    // Config and docs must advertise the same model + effort grammar as the
    // other reviewers — a saved review-models entry and a ~effort suffix.
    assert.match(readCommand('config.md'), /--review-models codex=o3,claude=claude-opus-4-8,cursor=gpt-5/);
    assert.match(readCommand('config.md'), /cursor\[gpt-5\]~effort=max/);
    assert.match(_read('README.md'), /cursor\[gpt-5\]~effort=max/);
    assert.match(_read("README.md"), /--review-models cursor=/);

    assert.match(wrapper, /`cursor` \(alias `cursor-agent`\)/);
    assert.match(wrapper, /`codex` \| `agy` \| `claude` \| `grok` \| `pi` \| `cursor`/);
    assert.match(wrapper, /Use one of: codex, agy, claude, grok, pi, cursor, opencode, ollama, copilot/);
    assert.match(wrapper, /Cursor binary probe/);

    const enhance = readLib('enhance-loop.md');
    assert.match(enhance, /`cursor` \| Verified tool-free fallback/);

    for (const name of ['review.md', 'pr.md', 'release.md', 'better.md', 'rpr.md', 'config.md']) {
      const body = readCommandDocs(name, { eager: true });
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

  it('cursor trusts the workspace without auto-approving, and a trust refusal is skipped, not cli-error (#399)', () => {
    // An untrusted workspace makes cursor print "Workspace Trust Required" and
    // exit 1 before any model call. As cli-error that is a hard error ~opt can't
    // excuse, so the first run in any new clone aborted /do:pr.
    const recipe = readLib(LOCAL_AGENT_RECIPES.cursor);
    const loop = readLib('local-agent-review-loop.md');
    const invocation = recipe.match(/^"\$REVIEW_BIN" -p [^\n]*$/m);
    assert.ok(invocation, 'cursor recipe must carry its print-mode invocation');
    // --trust answers only the workspace prompt; --mode ask is the read-only belt.
    assert.match(invocation[0], /--trust\b/);
    assert.match(invocation[0], /--mode ask\b/);
    // Never a flag that auto-approves commands, MCP servers, or tool calls.
    // (The 'never grants blanket permissions' test already bans the long aliases
    // anywhere in the local-agent text.)
    assert.doesNotMatch(invocation[0], /(?:^|\s)(?:-f|--approve-mcps|--auto-review|--sandbox)\b/);
    assert.match(recipe, /\*\*Never\*\* pass an auto-approve flag — `-f`/);

    // The classifier: non-zero exit + trust notice on stderr => skipped, deferred
    // past Step 3's restoration check, matched on $ERR_FILE only.
    assert.match(recipe, /grep -q 'Workspace Trust Required' "\$ERR_FILE" 2>/);
    assert.match(recipe, /CURSOR_TRUST_REQUIRED=true\n/);
    const step3 = recipe.slice(recipe.indexOf('CURSOR_TRUST_REQUIRED=true` after the restoration check'));
    assert.match(step3, /STATUS=skipped/);
    assert.doesNotMatch(step3, /STATUS=cli-error/);
    assert.match(recipe, /same reasoning as `cmd`'s `126`\/`127`/);

    // The generic loop must run the cursor classifier before its cli-error branch.
    assert.match(loop, /recipe exit classifier \([^)]*cursor: workspace trust\) \*\*before\*\*/);
    assert.match(loop, /cursor: a flagged workspace-trust refusal returns `skipped`/);
  });

  it('accepts opencode (and zen aliases) as a local-agent reviewer and probes the OpenCode CLI', () => {
    // OpenCode is a model-taking local reviewer. The slug is `opencode`
    // (aliases `zen`, `opencode-zen`). The binary is `opencode`.
    // OpenCode has no slashdo-bundled model default because headless admission
    // for the former free-tier default is not verified. Explicit/configured
    // models still normalize friendly aliases, and effort maps to --variant.
    const loop = readLocalAgent();
    const wrapper = readLib('multi-reviewer-loop.md');

    assert.match(loop, /`--review-with codex\|agy\|claude\|grok\|pi\|cursor\|opencode\|cmd\[<invocation>\]`/);
    assert.match(loop, /`zen` and `opencode-zen` normalize to `opencode`/);
    assert.match(loop, /\| `opencode` \| `opencode` \| `--variant <level>` \|/);
    assert.match(loop, /no\s+slashdo override/);
    assert.match(loop, /headless provider admission is not verified/);
    assert.match(loop, /opencode\/muse-spark-1\.3-contributor-free/);
    assert.match(loop, /opencode\)\s+EFFORT_FLAG=\(--variant "\$REVIEW_EFFORT"\) ;;/);
    assert.match(loop, /opencode run --pure/);
    assert.match(loop, /< \/dev\/null/);

    // Config and docs must advertise opencode review-models and effort grammar.
    assert.match(readCommand('config.md'), /opencode=provider\/model/);
    assert.match(_read('README.md'), /opencode\[provider\/model\]/);
    assert.match(_read('README.md'), /--review-models .*opencode=provider\/model/);
    assert.doesNotMatch(_read('README.md'), /opencode(?:=|\[)muse-1\.3/);

    assert.match(wrapper, /`opencode` \(aliases `zen` \/ `opencode-zen`\)/);
    assert.match(wrapper, /`codex` \| `agy` \| `claude` \| `grok` \| `pi` \| `cursor` \| `opencode`/);
    assert.match(wrapper, /Use one of: codex, agy, claude, grok, pi, cursor, opencode, ollama, copilot/);
    assert.match(wrapper, /`zen`\/`opencode-zen` both probe the `opencode` binary/);
    // Parallel-mode aggregate rules now live in their own on-demand partial.
    const parallelLib = readLib('multi-reviewer-parallel.md');
    assert.match(parallelLib, /In \*\*parallel mode\*\* the same rules apply[\s\S]*no-verdict/);
    assert.match(parallelLib, /non-optional\*\* reviewer's review was inconclusive[\s\S]*no-verdict/);

    for (const name of ['review.md', 'pr.md', 'release.md', 'better.md', 'rpr.md', 'config.md']) {
      const body = readCommandDocs(name, { eager: true });
      assert.match(
        body,
        /`opencode`/,
        `${name} must accept the opencode reviewer slug`,
      );
    }
  });

  it('maps OpenCode provider admission denial to sanitized no-verdict and preserves reviewer aggregation', () => {
    const loop = readLocalAgent();
    const wrapper = readLib('multi-reviewer-loop.md');
    const swarm = readLib('next-swarm.md');

    assert.match(loop, /HTTP 403 \/ FreeTierError/);
    assert.match(loop, /provider admission denied/);
    assert.match(loop, /STATUS=no-verdict/);
    assert.match(loop, /Select a supported reviewer\/model\/provider explicitly/);
    assert.match(loop, /raw provider output is not user-facing/);
    assert.match(loop, /Never retry by changing the pinned model, removing `--pure`, granting tools/);
    assert.match(wrapper, /OpenCode's sanitized provider-admission diagnostic is one of these `no-verdict` outcomes/);
    assert.match(wrapper, /optionality only removes its merge-blocking effect/);
    assert.match(swarm, /synthetic admission response such as `HTTP 403 \/ FreeTierError` is specifically `unavailable`/);
    assert.match(swarm, /never classify it as a clean verdict/);
    assert.doesNotMatch(loop, /FreeTierError[\s\S]{0,240}STATUS=clean/);
  });

  it('preserves per-reviewer OpenCode admission outcomes across the parallel restoration barrier', () => {
    // Parallel-only content now lives in its own on-demand partial.
    const parallel = readLib('multi-reviewer-parallel.md')
      .split('### Parallel dispatch')[1].split('### Aggregate report')[0];
    const [launch, barrier] = parallel.split('3. **Barrier**');

    assert.match(launch, /retain `EXIT_CODE`, `LOG_FILE`, `ERR_FILE`, and `OPENCODE_ADMISSION_DENIED` \*\*per reviewer\*\*/);
    assert.match(launch, /local-agent-review-loop\.md.*Step-2 OpenCode admission classifier \*\*before generic non-zero classification\*\*/);
    assert.match(launch, /pending `no-verdict`, never `cli-error`/);
    assert.match(launch, /Suppress its raw stdout\/stderr and log paths/);
    assert.match(launch, /Defer final review-phase statuses and verdict parsing until the barrier's restoration check succeeds/);
    assert.match(barrier, /After successful restoration, consume each reviewer's `OPENCODE_ADMISSION_DENIED=true`[\s\S]*Step-3 sanitized diagnostic, remedy, and suppressed log field; record `no-verdict`/);
    assert.match(barrier, /Do not exit the wrapper[\s\S]*continue collecting every other reviewer's result/);
    assert.match(barrier, /required denial remains inconclusive and merge-blocking; an optional denial stays visible and non-blocking/);
    assert.match(barrier, /does not excuse another reviewer's `cli-error` or a failed shared restoration/);
  });

  it('accepts cmd[<invocation>] as an escape-hatch reviewer and enforces its contract', () => {
    // cmd is the generic reviewer for any harness not on the fixed list. It
    // carries no model/effort bracket of its own — the invocation IS the
    // identity — and always runs review-only, since an opaque command's
    // isolation can never be verified the way codex's sandbox can.
    const loop = readLocalAgent();
    const wrapper = readLib('multi-reviewer-loop.md');

    assert.match(loop, /#+ The `cmd` reviewer/);
    assert.match(loop, /The contract is stdin in, stdout out/);
    assert.match(loop, /printf '%s' "\$LOCAL_PROMPT"/);
    assert.match(loop, /always forces review-only/);
    assert.match(wrapper, /`cmd\[<invocation>\]` — an arbitrary reviewer not in the fixed slug list/);
    assert.match(wrapper, /bare `cmd` with no `\[<invocation>\]` is invalid/);
    assert.match(wrapper, /verbatim `<invocation>`.*for a `cmd\[…\]` entry/);

    // The lazy-load gates that dispatch into local-agent-review-loop.md are
    // written as exclusions (none of copilot/ollama/@<login>), not an
    // enumerated allowlist — so cmd (and any future reviewer) needs no gate
    // updated to reach it. Assert the gate excludes, rather than enumerates.
    for (const name of ['pr.md', 'review.md', 'release.md', 'depfree.md']) {
      const body = readCommand(name);
      assert.match(
        body,
        /Only for an entry that is none of `copilot`, `ollama`, or `@<login>`/,
        `${name} must gate the local-agent loop by exclusion, not an enumerated list`,
      );
    }
    assert.match(
      readLib('better-review-loop.md'),
      /Only for an entry that is none of `copilot`, `ollama`, or `@<login>`/,
      'better-review-loop.md must gate the local-agent loop by exclusion, not an enumerated list',
    );

    for (const name of ['review.md', 'pr.md', 'release.md', 'better.md', 'better-swift.md', 'rpr.md', 'config.md', 'depfree.md']) {
      const body = readCommandDocs(name, { eager: true });
      assert.match(body, /cmd\[<invocation>\]/, `${name} must document and accept cmd[<invocation>]`);
    }

    // The invocation table is where an orchestrator READS {INVOCATION} from, so the
    // cmd row must not fold the `printf ... |` into the cell — Step 2 wraps
    // {INVOCATION} in TIMEOUT_CMD, and a pipe inside it leaves the timeout wrapping
    // only the printf while the reviewer command itself runs unbounded.
    const cmdRecipe = readLib(LOCAL_AGENT_RECIPES.cmd);
    assert.ok(
      !/printf[^\n]*\|\s*bash -c/.test(cmdRecipe),
      'the cmd recipe must not fold `printf ... |` into {INVOCATION} — TIMEOUT_CMD would then bound only the printf',
    );
    assert.match(cmdRecipe, /\*\*`\{INVOCATION\}` is `bash -c "\$REVIEWER_CMD"` and nothing else\.\*\*/);

    // ...and the RUNNABLE templates must carry the pipe themselves. The prose rule
    // alone is not enough: both blocks say "capture the command exactly as shown",
    // so a cmd pass run from the plain form launches the reviewer with no stdin and
    // blocks until the timeout or reads EOF and reports nothing.
    const cmdStdinForm = /if \[ "\$REVIEW_AGENT" = cmd \]; then[^\n]*\n\s*printf '%s' "\$LOCAL_PROMPT" \| \$\{TIMEOUT_CMD\[@\]\+"\$\{TIMEOUT_CMD\[@\]\}"\} \{INVOCATION\}/g;
    assert.equal(
      (loop.match(cmdStdinForm) || []).length,
      2,
      'both the background and foreground Step-2 templates must pipe $LOCAL_PROMPT into a cmd invocation',
    );

    // The .git snapshot has to see a SYMLINKED hook. git executes one just the same,
    // and `find -type f` alone skips it — so `ln -s /tmp/payload .git/hooks/pre-commit`
    // would leave the baseline hash unchanged and survive the wholesale restore.
    assert.match(loop, /find "\$GIT_COMMON\/hooks" \\\( -type f -o -type l \\\)/);
    assert.match(loop, /readlink "\$f" 2>\/dev\/null \|\| cat "\$f"/);

    // The restore's `rm -rf "$GIT_COMMON/hooks"` must be guarded: GIT_COMMON is a
    // step-1 variable and step 3 is a separate shell on most hosts, so an unbound one
    // makes that line `rm -rf /hooks`.
    assert.match(loop, /GIT_COMMON="\$\{GIT_COMMON:-\$\(git rev-parse --git-common-dir\)\}"/);
    assert.match(loop, /if \[ -z "\$GIT_COMMON" \] \|\| \[ -z "\$GIT_META_BAK" \]/);

    // Parsing cmd is not the same as dispatching it — review.md names the
    // local-agent loop's actual per-agent dispatch line inline (not via a shared
    // partial), so `cmd` has to be added there by hand. pr.md and release.md have
    // no inline dispatch list — their exclusion-gated `!read`s (asserted above)
    // are the dispatch.
    assert.match(readCommand('pr.md'), /hands off to the \*\*multi-reviewer wrapper\*\*[^\n]*`LOCAL_AGENTS`[^\n]*`cmd` included/);
    // release.md has no inline dispatch list — its exclusion-gated `!read`s (asserted
    // above) are the dispatch — but it must forward the saved per-agent models.
    assert.match(readCommand('release.md'), /hand off to the \*\*multi-reviewer loop\*\*[^\n]*`\{REVIEW_MODELS\}`/);
    assert.match(readCommand('review.md'), /`codex` \| `agy` \| `claude` \| `grok` \| `pi` \| `cursor` \| `opencode` \| `cmd` \| `ollama` — invoke the local-agent review loop/);
    assert.match(readCommand('pr.md'), /`ollama\[…\]`, `cmd\[<invocation>\]`\. These review the working tree locally/);

    // The transformer's on-demand-load hint (for hosts without a native `!cat`)
    // must name every slug that actually dispatches to this file, or those
    // hosts print a hint that omits cmd as a reason to load it.
    const transformerSrc = _read('src', 'transformer.js');
    assert.match(transformerSrc, /local-agent-review-loop\.md[\s\S]{0,250}or `cmd`/);

    // A per-project .slashdo.json is repo content (the README says to commit
    // it), so a cmd[...] read from it would let the repo pick the command that
    // bash -c runs. The saved-defaults step must drop it, /do:config --project
    // must refuse to store it, and the loop's trust-boundary text must say so.
    assert.match(readLib('review-config-defaults.md'), /Ignoring cmd\[\.\.\.\] from \.slashdo\.json/);
    assert.match(readCommand('config.md'), /cannot be saved in the per-project \.slashdo\.json/);
    assert.match(loop, /A per-project `\.slashdo\.json` is repo content/);

    // The list separator must respect brackets — a comma inside cmd[…] (or a
    // nested cursor model variant) is part of the value, not a new entry.
    assert.match(wrapper, /split the value on `,` only outside the outermost brackets/);

    // ...and every command that parses --review-with INLINE has to say so too. A
    // bare "Split on `,`" splits README's own documented
    // cursor[claude-opus-4-7[thinking=true,effort=high]] into two entries and
    // aborts with `Unknown --review-with value: effort=high]]` — and does the same
    // to any cmd[…] invocation carrying a comma.
    // Scope it to the --review-with bullet: config.md's --trusted-authors bullet
    // legitimately splits on every comma (logins can't contain one).
    for (const name of ['pr.md', 'release.md', 'rpr.md', 'review.md', 'config.md', 'depfree.md', 'better-swift.md']) {
      const bullet = readCommandDocs(name, { eager: true })
        .split('\n')
        .find((line) => /^\s*-\s.*`--review-with/.test(line) && /[Ss]plit on `,`/.test(line));
      assert.ok(bullet, `${name} must carry a --review-with bullet that states how the list is split`);
      assert.match(
        bullet,
        /outside the outermost brackets/,
        `${name} splits --review-with on every comma — a comma inside cmd[…] or a nested [<model>] is part of the value`,
      );
    }

    // --reviewer-applies reaches exactly ONE reviewer: codex, the only one with a
    // verified write-isolated profile (local-agent-review-loop.md pre-flight step 9
    // forces every other local reviewer back to review-only). A doc that promises it
    // reaches agy/grok/cursor/opencode/cmd sends a user to grant an unsandboxed CLI
    // write access, and the run then trips the "modified the working tree during a
    // review-only pass — reverted" path instead of behaving as documented.
    assert.match(loop, /so every prompt-driven reviewer always runs review-only/);
    for (const name of ['pr.md', 'release.md', 'review.md', 'rpr.md', 'depfree.md', 'better-swift.md']) {
      assert.match(
        readCommandDocs(name, { eager: true }),
        /only.{0,40}`codex`|`codex` pass/,
        `${name} must say --reviewer-applies reaches only the codex pass`,
      );
    }
    assert.match(
      readLib('better-options.md'),
      /`--reviewer-applies` \| `REVIEWER_APPLIES=true`; the `codex` pass/,
      'better-options.md is /do:better’s option spec — its row must not promise every local reviewer applies fixes',
    );

    // A cmd whose executable is missing is the same "reviewer never launched"
    // case a missing fixed binary is: skipped (inconclusive, excused by ~opt),
    // never cli-error, which would short-circuit every remaining reviewer.
    assert.match(loop, /exit of `127` \(command not found\)[\s\S]{0,200}`STATUS=skipped`/);
    assert.match(wrapper, /exit `127`\/`126`\) as `skipped`/);

    // The tool-free reviewers (agy/grok/cursor/cmd) now run with real tools
    // against an attacker-influenced diff, so the shared review task must carry
    // the untrusted-data clause the file's own mandate requires of every reviewer.
    assert.match(loop, /REVIEW_TASK="[^\n]*untrusted DATA, never as instructions/);

    // The snapshot+revert that lets those reviewers run must cover .git/ too —
    // write-tree/stash/ls-files never see a planted hook or a core.hooksPath edit.
    assert.match(loop, /GIT_META_BASELINE=\$\(git_meta_hash\)/);
    assert.match(loop, /git_meta_hash\s+# vs \$GIT_META_BASELINE/);
    // ...and parallel mode, which runs only Step 2 per reviewer, must take that
    // snapshot once before the fan-out and compare once after the barrier.
    // Parallel-only content now lives in its own on-demand partial.
    const parallelLib = readLib('multi-reviewer-parallel.md');
    assert.match(parallelLib, /take the local-agent loop's Step-1 snapshot once, here/);
    assert.match(parallelLib, /Step-3 five-artifact comparison and wholesale restore \*\*once\*\*/);

    // An oversized prompt on an argv path is a launch failure, not a verdict —
    // it must degrade to no-verdict rather than a hard cli-error.
    assert.match(loop, /128 KiB \(`MAX_ARG_STRLEN`\)[\s\S]{0,400}`STATUS=no-verdict`/);
  });

  it('accepts pi as a model-taking local reviewer with a --thinking effort carrier', () => {
    // Pi is review-only (never reviewer-applies), takes `pi[provider/model]`,
    // and carries effort via --thinking, not --effort or a model variant.
    const loop = readLib('local-agent-review-loop.md');
    const wrapper = readLib('multi-reviewer-loop.md');

    assert.match(loop, /\| `pi` \| `pi` \| `--thinking <level>` \|/);
    assert.match(loop, /pi\)\s+EFFORT_FLAG=\(--thinking "\$REVIEW_EFFORT"\) ;;/);
    assert.match(loop, /pi --print --no-approve --no-tools/);
    assert.match(loop, /never enable reviewer-applies for Pi/);

    // Config and docs must advertise the pi reviewer slug and its grammar.
    assert.match(_read('README.md'), /`pi`/);
    assert.match(_read('README.md'), /--review-with pi/);
    assert.match(readCommand('config.md'), /`pi`/);

    assert.match(wrapper, /`codex` \| `agy` \| `claude` \| `grok` \| `pi` \| `cursor`/);
    assert.match(wrapper, /Use one of: codex, agy, claude, grok, pi, cursor, opencode, ollama, copilot/);

    // Every command dispatching the multi-reviewer loop, AND /do:better's
    // separate reviewer-grammar path (lib/better-options.md +
    // lib/better-review-loop.md), must accept pi — a slug documented in one
    // command's prose but unrecognized by the shared dispatch/validation libs
    // would make `--review-with pi` silently unsupported there.
    for (const name of ['review.md', 'pr.md', 'release.md', 'better.md', 'better-swift.md', 'rpr.md', 'config.md']) {
      const body = readCommandDocs(name, { eager: true });
      assert.match(
        body,
        /`pi`/,
        `${name} must accept the pi reviewer slug`,
      );
    }
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

describe('shared review-flag parse partial (#311)', () => {
  const raw = (name) => _read('commands', 'do', name);

  it('pr.md and release.md include lib/review-flags.md instead of restating the grammar', () => {
    for (const name of ['pr.md', 'release.md']) {
      const body = raw(name);
      assert.match(body, /!`cat ~\/\.claude\/lib\/review-flags\.md`/, `${name} must include the shared partial`);
      assert.doesNotMatch(body, /Accepted values per slot/, `${name} must not carry its own copy of the --review-with grammar`);
    }
    assert.match(readLib('review-flags.md'), /Accepted values per slot/);
  });

  it('forwards saved review-models and names the full --review-iterations scope', () => {
    const flags = readLib('review-flags.md');
    assert.match(flags, /`\{REVIEW_MODELS\}` — the `EFFECTIVE_REVIEW_MODELS` map/);
    assert.match(flags, /`\{REVIEW_ITERATIONS\}` \(the copilot \/ `@<login>` cycle cap\)/);
    assert.match(raw('pr.md'), /and `\{REVIEW_MODELS\}` \(the saved per-agent default models/);
    assert.doesNotMatch(raw('release.md'), /copilot iteration cap/);
  });

  it('review.md and rpr.md also include lib/review-flags.md instead of restating the grammar (#332)', () => {
    for (const name of ['review.md', 'rpr.md']) {
      const body = raw(name);
      assert.match(body, /!`cat ~\/\.claude\/lib\/review-flags\.md`/, `${name} must include the shared partial`);
      assert.doesNotMatch(body, /Accepted values per slot/, `${name} must not carry its own copy of the --review-with grammar`);
      assert.doesNotMatch(body, /Accepted slugs: `codex`, `agy`/, `${name} must not carry a hand-copied slug list`);
    }
    // review.md's other own flags (parsed outside the shared partial) must survive the swap.
    const reviewBody = raw('review.md');
    assert.match(reviewBody, /--strict`\*\* \(alias: \*\*`--nuclear/);
    assert.match(reviewBody, /--draft`\*\* \(PR mode only\)/);
    assert.match(reviewBody, /--apply` \/ `--no-apply`\*\*/);
    // rpr's own consequences of the grammar (never in the shared partial) must survive the swap.
    const rprBody = raw('rpr.md');
    assert.match(rprBody, /@<login>` entries are accepted by the parser but never requested/);
    assert.match(rprBody, /forwarded as `\{MAX_ITERATIONS\}`/);
    assert.match(rprBody, /rpr does not support `--review-iterations`/);
  });

  it('review.md forwards {REVIEW_MODELS} to the multi-reviewer wrapper (#332)', () => {
    assert.match(raw('review.md'), /`\{REVIEW_MODELS\}` — the saved per-agent default models/);
  });
});

describe('local-agent loop loads only the launched harness recipe (#347)', () => {
  const core = readLib('local-agent-review-loop.md');

  it('gates each per-harness recipe behind its own agent', () => {
    for (const [agent, file] of Object.entries(LOCAL_AGENT_RECIPES)) {
      assert.match(
        core,
        new RegExp(`^Only when \`\\{REVIEW_AGENT\\}\` is \`${agent}\`:\\n!read lib/${file.replace('.', '\\.')}$`, 'm'),
        `${file} must be a column-0 !read gated on ${agent} alone`,
      );
      assert.equal(core.split(`!read lib/${file}`).length, 2, `${file} must be read exactly once`);
    }
    // The curl installer ships every recipe.
    for (const script of ['install.sh', 'uninstall.sh']) {
      for (const file of Object.values(LOCAL_AGENT_RECIPES)) {
        assert.match(_read(script), new RegExp(`\\b${file.replace('.md', '')}\\b`), `${script} must list ${file}`);
      }
    }
  });

  it('keeps harness-specific recipes out of the core every run pays for', () => {
    assert.ok(Buffer.byteLength(core, 'utf8') <= 40000, 'the core must stay well under the old 75 KB');
    for (const marker of [/agy models 2>/, /CURSOR_MODEL/, /OPENCODE_ADMISSION_DENIED=/, /prepare_claude_review_input/, /Why stdin/]) {
      assert.doesNotMatch(core, marker, `${marker} belongs in its harness recipe`);
    }
    // Two named classes replace the per-slug enumerations; the usage line is the one list.
    const lists = core.match(/`?\b(?:claude|codex|agy|grok|pi|cursor|opencode|cmd)\b`?(?:\s*[/,|]\s*`?\b(?:claude|codex|agy|grok|pi|cursor|opencode|cmd)\b`?){3,}/g) || [];
    assert.equal(lists.length, 1, `the core re-enumerates the reviewer slugs: ${lists.join(' | ')}`);
    assert.match(core, /\*\*Prompt-driven\*\* — every other reviewer/);
  });

  it('drops maintainer notes and citations that bundle libraries the loop never runs', () => {
    const all = readLocalAgent();
    assert.doesNotMatch(all, /keep the two in sync|Same split as/);
    assert.doesNotMatch(all, /`lib\/(?:enhance-loop|ollama-review-loop|multi-reviewer-loop|review-config-defaults)\.md`|\]\(\.\/(?:enhance-loop|ollama-review-loop|multi-reviewer-loop)\.md\)/);
  });
});
