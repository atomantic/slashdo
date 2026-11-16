---
description: Audit third-party dependencies and remove unnecessary ones by writing replacement code
argument-hint: "[--interactive] [--scan-only] [--no-merge] [--heavy|--extreme] [--review-with <agent>[,<agent>...]] [--review-iterations <n>] [--review-mode <series|parallel>] [--review-stop-on-findings|--review-stop-on-clean] [--reviewer-applies] [--issues-label <name>] [specific packages to evaluate]"
---

# Depfree — Dependency Freedom Audit

Every small library is an attack surface. This command inventories the project's third-party dependencies, decides which ones the project could own instead, replaces those with owned code in an isolated worktree, and opens a PR. How far it goes depends on the mode (see Modes): the default keeps large, widely-audited libraries and replaces small or barely-used ones; `--heavy` keeps only foundational frameworks; `--extreme` aims at zero dependencies.

The run is autonomous unless `--interactive` is passed.

## Arguments

Parse `$ARGUMENTS` for:

- **`--interactive`**: ask the user at three points — the model profile (Modes), the removal plan (Phase 2), and the merge (Phase 5d).
- **`--scan-only`**: run Phases 0–2 only. No worktree, no code changes, no PR; every surviving finding is filed as a tracker issue before the run exits (Phase 2).
- **`--no-merge`**: stop after the PR is opened; skip CI verification, the review loop and the merge.
- **`--heavy`**, **`--extreme`**: raise the removal bar (see Modes). `--extreme` includes everything `--heavy` does, so passing both is the same as `--extreme`. Set `DEPFREE_MODE` to `extreme`, `heavy` or `default` accordingly.
- **`--issues-label <name>`**: the label on the tracker issues that deferred removals are filed as. Set `PLAN_LABEL` from the flag, else the saved `issues-label` default, else `plan`. A saved `issues` key is ignored.
- **`--issues`** / **`--no-issues`** (both deprecated; PLAN.md mode was removed and work is recorded only in the issue tracker): accept `--issues` and print once that it is now the default and can be dropped; abort on `--no-issues` saying it is no longer supported.
- **Specific packages**: limit the audit to the named packages (e.g. `chalk dotenv`).

The review flags (`--review-with` and its companions) govern the Phase 5c review loop; their grammar is owned by this shared partial:

!`cat ~/.claude/lib/review-flags.md 2>/dev/null || cat "$(dirname "$(readlink -f .claude/commands/do/depfree.md)")/../../lib/review-flags.md"`

Then apply saved defaults (set via `/do:config`) to the review flags and `--issues-label` when the user did not pass them. An explicit flag, or `--review-with none`, overrides a saved default:

!`cat ~/.claude/lib/review-config-defaults.md 2>/dev/null || cat "$(dirname "$(readlink -f .claude/commands/do/depfree.md)")/../../lib/review-config-defaults.md"`

!`cat ~/.claude/lib/config-defaults-issues-merge.md 2>/dev/null || cat "$(dirname "$(readlink -f .claude/commands/do/depfree.md)")/../../lib/config-defaults-issues-merge.md"`

## Dependency policy

Before discovery, load the global and project `depfree-allow` lists and resolve `DEPFREE_ALLOW`:

!read lib/depfree-policy.md

A package matching `DEPFREE_ALLOW` is **policy-kept**, and that outranks everything else in this command:

- It applies in every mode, to every workspace manifest and installed version, and to packages the user named explicitly. Check policy before prior decisions and before classification.
- A policy-kept package is recorded as kept with reason `policy allowlist` and the matching pattern. It gets no usage analysis and is never proposed for removal or evaluation, never filed as a removal issue, and never handed to a remediation agent.
- Policy excludes removal analysis only. Policy-kept packages stay in the vulnerability audit (Phase 1a) and in the dependency graph (Phase 1c), where they count as kept parents; packages still installed through one are not counted as eliminated.
- Policy is read from current config on every run. A policy row in the decision record is a report, not a cached allowance: when an allowance is removed, the package is classified normally on the next run.

## Modes

Dependencies are sorted into three **classes**:

- **Foundational** — kept without a usage audit.
- **Suspect** — usage is analyzed, then the package is kept or removed.
- **Removable** — owning the code clearly costs less than the supply-chain risk.

The mode sets where the lines fall. This table is the single statement of the per-mode rules; later phases refer back to it.

| | default | `--heavy` | `--extreme` |
|---|---|---|---|
| Goal | drop small, replaceable packages | own everything feasible | zero dependencies; every package left needs a reason that survives a strong model trying to remove it |
| Foundational | large, widely-audited libraries and tooling; very high download counts qualify | only foundational frameworks, core platform tooling and language runtimes; popularity does not count; wrappers, utility collections, CLIs and single-purpose tools are Suspect or Removable | only what cannot be owned responsibly (Extreme rule 1) |
| An `EVALUATE` recommendation becomes | KEEP | REMOVE | REMOVE |
| Replacement size limit | about 50 lines for Removable; an agent stops when the work exceeds twice its estimate | 300 lines | none — the parity gate decides (Extreme rule 2) |
| Infeasible means | over the size limit, or needs deep domain expertise | over 300 lines, or needs deep domain expertise (crypto primitives, binary protocol parsers, codecs) | only an Extreme rule 1 class; recorded with a design sketch and a filed issue, and re-tested on every extreme run |
| Maintenance status | a factor | irrelevant — the question is whether we can own the code | irrelevant |
| devDependencies | audited, lower priority | same priority as production | same priority as production |
| Lint, format and test tools | Foundational | Foundational when CI or an organization standard requires them; otherwise Suspect, audited but not rewritten | same as heavy |
| A kept parent shelters a transitive candidate (Phase 1c) | any kept parent | any kept parent | only a Foundational or policy-kept parent |
| Model tier for agents | `medium`, or the profile chosen under `--interactive` | same as default | `heavy` with reasoning effort `max`, always |
| Remediation agents | up to 5 in parallel | up to 5 in parallel | up to 3, one package (or one owned-subsystem group) per agent |
| Verification (Phase 4) | build, tests, inline diff review | same | plus the end-to-end or smoke suite, and the diff review goes to a second `heavy` agent |

`--heavy` raises the removal bar only; it does not change which model runs. `--extreme` raises both, because replacing a large library is where a weaker model produces a confident, subtly wrong reimplementation.

**Model profile.** `AUDIT_MODEL_TIER` and `REMEDIATION_MODEL_TIER` are tiers, resolved against the running host per [lib/model-tiers.md](../../lib/model-tiers.md) — never model names. Without `--interactive` both are `medium`. With `--interactive` (and not `--extreme`), ask the user which profile to use: **Quality** (`heavy` / `heavy` — strongest model, fewest false positives, highest cost), **Balanced** (`medium` / `medium`, recommended) or **Budget** (`light` audit / `medium` remediation). Under `--extreme`, skip the question, use `heavy` / `heavy`, and say so. A host that cannot set a per-agent model runs at the session default; state that and continue.

### Extreme rules

These apply only when `DEPFREE_MODE=extreme`, on top of the heavy column.

1. **What stays Foundational.** Only these are kept without a usage audit:
   - The language runtime, its standard library, the package manager, and the compiler or transpiler the build cannot run without.
   - Security-sensitive protocol and primitive implementations: TLS, cryptographic primitives and key exchange, authentication protocols, database wire protocols with authentication (`pg`, `mysql2`, `mongodb`), and compression or media codecs whose conformance suites you cannot run. Reimplementing these trades a reviewed implementation for an unreviewed one. OAuth client flows are not in this class — they are HTTP plus signing, and are candidates.
   - Native bindings to the OS or hardware (PTYs, GPU, USB, sensors), where the replacement would itself be a native addon.
   - Lint, format and test tools that CI requires. Rewriting a test runner is not dependency freedom.

   Everything else is Suspect or Removable, including frameworks, UI libraries, rendering and math libraries, client SDKs, parsers, ORMs and build plugins. A web framework whose used surface is routing, middleware chaining, static files and body parsing is a candidate. A UI framework is a candidate only when the component tree is small enough that a design (rule 3) can name every construct it uses; otherwise record it as skipped with a design sketch and file it (rule 5), so the decision is written down instead of assumed.
2. **Parity gate instead of a size limit.** A replacement ships when every call site's behavior is covered by a test that fails against a stub and passes against the owned code, the full build and test suite pass, and no new dependency was introduced. Size is reported and never used as a reason to stop.
3. **Design before code** for any replacement estimated above about 100 lines. The remediation agent first writes a short design — the exact used surface (symbols, options, behaviors relied on), the owned module's public API, the parity test plan, the edge cases the call sites reach, the edge cases provably unreachable and therefore omitted, and the risk of the swap — into a `docs/deps/<package>.md` note (or the project's equivalent docs location). The design is the reviewer's checklist in Phase 4b.
4. **Consolidate before replacing.** Phase 2 plans the owned-module layout across all removals first (one `http/` module for a framework plus its body parser plus its static server), so three removals do not produce three overlapping utilities.
5. **Nothing is silently skipped.** Every package still in the manifest after an extreme run is kept by policy with its pattern, kept as Foundational under rule 1, kept after audit with a reason a reviewer could argue with (not "popular" or "large"), or skipped as infeasible with a design sketch and a filed tracker issue naming what a future run would need (a conformance suite, a native addon, a product-level rewrite). A reverted replacement is allowed only after a real parity failure the agent could not fix; record the failing test.

Extreme mode is slow and expensive by design. Run it with `--scan-only` first when the goal is a plan and not a PR.

## Compaction guidance

When compacting during this workflow, preserve: `DEPENDENCY_MAP`, `PRIOR_DECISIONS`, `DEPFREE_ALLOW` and which packages are policy-kept; every removal finding with its usage details; the current phase; PR numbers and URLs; `DEPFREE_MODE`, `AUDIT_MODEL_TIER`, `REMEDIATION_MODEL_TIER`; `PROJECT_TYPE`, `BUILD_CMD`, `TEST_CMD`, `REPO_DIR`, `WORKTREE_DIR`, `BRANCH`, `DEPS_FILE`; `VCS_HOST`, `CLI_TOOL`, `GH_HOST`, `TRACKER_AVAILABLE`, `DEFAULT_BRANCH`; and, under extreme mode, where each replacement design was written.

## Phase 0: Discovery & Setup

### 0a: VCS host
Resolve `VCS_HOST` and `CLI_TOOL` here, before any phase reaches for a forge CLI:

!read lib/vcs-host.md

- **When `VCS_HOST=github`, also derive `GH_HOST` from the `origin` remote** and carry it in state, following the shared derivation (and its per-host auth precheck) included below. The review loop's GitHub verbs use `gh api`, which ignores the repo remote and defaults to github.com — on a GitHub Enterprise repo `GH_HOST` must be forwarded to them or they poll the wrong host and time out.
- **Record `TRACKER_AVAILABLE` once.** `true` when the tracker gate's `TRACKER_CLI` is set and reaches this repo with its issues feature enabled; otherwise `false`. Deferred removals are filed as issues only when it is `true`; when `false` the run continues, files nothing, and lists every deferred removal (title, one-line rationale, `file:line`) in the final report under "Deferred (not filed — no issue tracker available)". PLAN.md is never written as a fallback. On a Jira tracker it is `true` only when the Jira Pre-flight below passes (`{COMMAND}` = `/do:depfree`); a failed one prints its message and records `false`. Filed removals are then referenced by key (`PROJ-123`), not `#<n>`.

Only on a Jira tracker (`TRACKER=jira`), read the Jira backend and run its Pre-flight in place of the tracker gate:

!read lib/tracker-jira.md

**GitHub only — skip the snippet below entirely on GitLab**, whose `glab` calls resolve the host from the remote themselves and where its `gh auth` precheck would abort the run.

!`cat ~/.claude/lib/gh-host.md 2>/dev/null || cat "$(dirname "$(readlink -f .claude/commands/do/depfree.md)")/../../lib/gh-host.md"`

### 0b: Project
Record:

- `REPO_DIR` — `git rev-parse --show-toplevel`.
- `DEFAULT_BRANCH` — from the forge CLI (`gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name'`, or the `glab` equivalent).
- `PROJECT_TYPE`, `BUILD_CMD`, `TEST_CMD` — the stack and the commands the project itself uses to build and test. Take them from the project's own instructions (CLAUDE.md, AGENTS.md, CONTRIBUTING, CI config) before inferring them from manifest scripts.

### 0c: Prior decisions

The decision record from earlier `/do:depfree` runs lets a rerun skip packages it already audited. Set `DEPS_FILE` to the existing tracked `DEPS.md` whose title is "Dependency Audit Decisions", wherever the project keeps it; if there is none, `docs/DEPS.md` (or the project's existing docs directory if it uses a different one). Parse it into `PRIOR_DECISIONS`, keyed by package name, each with a decision (`KEPT`, `REMOVED` or `SKIPPED`), the major version evaluated, the mode, the date and the reason. A missing file is an empty map. The file is only written in Phase 4c, so `--scan-only` never creates it.

The current format is the single table shown in Phase 4c. A file written by an earlier release has one section per decision type instead; read its rows as:

| Old section | Reads as |
|---|---|
| Kept — Policy allowlist | `KEPT`, reason `policy: <pattern>` |
| Kept — Tier 1 (foundational) | `KEPT`, reason `foundational` |
| Kept — Tier 2 (audited) | `KEPT`, reason `audited: …` |
| Kept — Transitive | `KEPT`, reason `transitive: <chain>` |
| Removed | `REMOVED` |
| Reverted | `SKIPPED`, reason `reverted: …` |
| Skipped (replacement infeasible) | `SKIPPED`, reason `infeasible: …` |

An old row's mode `both` reads as `heavy`. Phase 4c rewrites the file in the current format.

A prior decision is **reused** — the package skips classification and usage analysis — only when all of these hold:

1. The package is still in the manifest at the same major version.
2. The row's mode is at least as strict as this run's, on the order `default` < `heavy` < `extreme`. A `heavy` row covers a default run but not an extreme one.
3. The row is `KEPT` with a `foundational` or `audited` reason, or `SKIPPED` with an `infeasible` reason on a run that is not extreme.

Everything else is evaluated again, for a reason in each case: policy rows depend on current config; transitive rows depend on this run's kept-parent graph, which changes whenever policy or the candidate list does; a reverted replacement deserves another attempt; and extreme mode re-tests infeasibility because the bar it was measured against (model capability, runtime built-ins) moves. A `REMOVED` package that is back in the manifest is treated as new.

## Phase 1: Dependency Inventory

### 1a: Inventory and classify

List every direct dependency from the project's manifests, including dev, build and optional groups and each workspace member's manifest in a monorepo.

Run the ecosystem's whole-tree vulnerability audit once (`npm audit --json`, `cargo audit --json`, `pip-audit -f json`, …) and index the results as `VULN_MAP`, keyed by package name **and installed version** — a lock file can carry several versions of one package, and a finding against one must not be attributed to another. Phase 1b reads from `VULN_MAP`; do not re-run the audit per package.

Then, for each dependency, in this order:

1. **Policy.** If it matches `DEPFREE_ALLOW`, record it as policy-kept and stop (see Dependency policy).
2. **Prior decision.** If `PRIOR_DECISIONS` holds a reusable row (Phase 0c), carry it forward as kept, mark it `from_prior`, and print `↻ {package}@{major} — carrying forward prior {decision} ({date})`.
3. **Classify** as Foundational, Suspect or Removable using the Modes table and the criteria below.

**Suspect** — any of:
- a single-purpose utility, or one where the project uses only one or two functions;
- a thin wrapper over built-in APIs, or functionality that newer versions of the language or runtime now provide;
- low download counts for its ecosystem;
- abandoned or unmaintained (no commits in 12+ months, open security issues);
- in heavy and extreme mode, also: maintained by an individual or small team; less than half its API surface is used; a utility collection, HTTP client, logger, CLI argument parser, or a second tool for a job another dependency already does.

**Removable** — any of:
- the used surface fits within the mode's replacement size limit;
- the functionality is available natively in the runtime version the project supports (check the project's declared minimum version before relying on a built-in);
- the library is unmaintained and has known vulnerabilities;
- in heavy and extreme mode, also: a utility library of which any subset is used, even heavily — write an owned module for the functions actually called.

**Default-mode restraint on parsers and validators.** In default mode, do not hand-roll replacements for complex schema validators, semver range engines, or full-featured CLI, glob or date parsers (`zod`, `joi`, `semver`, `commander`, `yargs`, `minimatch`, `date-fns`, `dayjs`) unless a runtime built-in (`node:util` `parseArgs`, `fs.glob`, native `Intl`/`Date`) directly covers the exact used surface within the 50-line limit. Hand-rolled parser and validator modules are for `--heavy` and `--extreme`.

Record the result as `DEPENDENCY_MAP`.

### 1b: Usage analysis (Suspect and Removable only)

Skip policy-kept and `from_prior` packages. For the rest, dispatch read-only sub-agents in parallel at `AUDIT_MODEL_TIER`. Each one, for its package:

1. Finds every import of the package, lists each imported symbol, and counts call sites per symbol.
2. Rates replacement complexity: **Trivial** (under 20 lines), **Moderate** (20–100, needs tests and edge-case handling), **Complex** (100–300, significant logic), or **Infeasible** as the Modes table defines it for this mode. In extreme mode line counts describe and do not gate: a 2,000-line used surface with a clear design is Complex, and the report sketches the owned module's API and parity test plan so Phase 2 can plan consolidation.
3. Reads known vulnerabilities for the installed version from `VULN_MAP`, and checks the last publish date and maintenance status.
4. Checks for consolidation: does another dependency serve the same purpose (two state managers, two HTTP clients, two date libraries)? If so, name the kept one that could absorb this usage.

Each report gives: package and class; imported symbols with a one-line description; call-site and file counts; replacement complexity; maintenance and CVE status; a recommendation of **REMOVE**, **KEEP** or **EVALUATE**; the consolidation target if any; and, for REMOVE, a sketch of the replacement.

### 1c: Transitive dependency check

Policy-kept packages are always included as kept parents in the dependency graph, and their transitive footprint is recorded even when there are no REMOVE candidates.

Removing a direct dependency that remains in the lock file as a transitive dep of a kept package provides zero supply chain benefit — the code is still installed and executable. For each REMOVE candidate:

1. Check whether it appears as a transitive dependency of a kept package (a nested entry under a kept package's tree, not just the project root):
   - **Node.js (npm)**: `npm ls {package}`
   - **Node.js (yarn)**: `yarn why {package}`
   - **Node.js (pnpm)**: `pnpm why {package}`
   - **Rust**: `cargo tree -i {package}`
   - **Python**: `pipdeptree -r -p {package}` or `uv pip tree --invert | grep {package}` (record the full chain)
   - **Go**: `go mod graph | grep {package}`
   - **Ruby**: `bundle why {gem}`
2. If it is transitive of a kept package, determine the **removal motivation**. Which parents count as kept is the "shelters" row of the Modes table: in extreme mode a parent that is itself a removal candidate does not shelter its children, because it is on the same list.
   - **Supply chain only** (flagged purely for attack-surface reduction) → downgrade to **KEEP (transitive)**: removing the direct entry does not remove the code from the lock file or the runtime.
   - **Consolidation** (overlaps in purpose with another kept dependency, e.g. zustand→redux, moment→dayjs) → keep the **REMOVE** recommendation: the value is eliminating redundant usage from our own code. Record the consolidation target.
   - Record the dependency chain in either case, root to leaf (e.g. `@react-three/fiber → tunnel-rat → zustand`).
3. Exception: if the direct dependency pulls a **different major version** than the transitive one, keep the REMOVE recommendation and note the version difference.

Update `DEPENDENCY_MAP` with the results.

## Phase 2: Replacement Plan

The plan is working state for this run and is never written to a file. A removal that is planned but not carried out is **deferred** and filed as a labeled tracker issue. Unless `TRACKER_AVAILABLE=false`, read the tracker setup and filing partials now, and reuse `CLI_TOOL` from Phase 0:

!read lib/plan-issue-setup.md
!read lib/plan-issue-filing.md

1. Fetch `EXISTING_ISSUES` per those partials (skip when `TRACKER_AVAILABLE=false`).
2. Take the REMOVE recommendations that survived Phase 1c. Resolve each EVALUATE per the Modes table; under `--interactive`, ask the user about each one instead, suggesting the mode's answer.
3. Group the removals by strategy:
   - **Native replacement** — a built-in API replaces the library.
   - **Inline replacement** — a small owned utility function.
   - **Consolidation** — several small dependencies replaced by one owned utility module.
   - **Owned subsystem** (extreme mode) — a large library's used surface rebuilt as an owned module with its own parity suite. Record the module boundary now so sibling removals land in the same module (Extreme rule 4); this grouping decides agent assignment in Phase 3b.
4. Estimate the lines of replacement code for each. The estimate is reported in every mode and is a limit only where the Modes table says so.
5. Print the summary:
   ```
   | Status      | Count | Examples                          |
   |-------------|-------|-----------------------------------|
   | Foundational| ...   | react, express, typescript, ...   |
   | Kept        | ...   | {packages kept with reasons}      |
   | Policy kept | ...   | {package (pattern), ...}          |
   | Removable   | ...   | {packages to remove}              |
   | Total       | ...   |                                   |
   ```
   Policy kept is a subset of Kept and does not add to Total. List each policy-kept package with its matching pattern on every exit, including the two gates below.

**Gate — `--scan-only`.** File every surviving finding as an issue (all of them, since the filed issues are this run's output), deduplicated against `EXISTING_ISSUES` and labeled per the filing partial. Report the created and reused issue numbers, print the summary and stop. When `TRACKER_AVAILABLE=false`, list the findings under "Deferred (not filed — no issue tracker available)" instead.

**Gate — nothing to remove.** Print "All dependencies are justified" and stop.

**Interactive mode.** Show the removal plan and ask the user whether to proceed with all of it, review each removal individually (then continue with only the approved ones), or abort without changes.

## Phase 3: Worktree Remediation

### 3a: Setup

All changes happen in a new worktree, so the user's checkout — its branch, index and uncommitted work — is never touched and needs no stash.

1. Set `DATE` to today's date (YYYY-MM-DD), `BRANCH` to `depfree/{DATE}` and `WORKTREE_DIR` to the absolute path `{parent directory of REPO_DIR}/depfree-{DATE}`. If that branch or directory already exists (an earlier run today left its PR open), append `-2`, `-3`, … to both until the name is free, and mention the earlier one in the final summary.
2. Create the worktree from the branch the PR targets, not from whatever is checked out:
   ```bash
   git fetch origin {DEFAULT_BRANCH}
   git worktree add "{WORKTREE_DIR}" -b {BRANCH} origin/{DEFAULT_BRANCH}
   ```
3. Phases 1–2 read the user's checkout. If it was not at `origin/{DEFAULT_BRANCH}`, confirm in the worktree that each planned package is still in the manifest and still used as analyzed, and drop any that is not.

### 3b: Write replacement code

Dispatch one sub-agent per dependency (or per group) at `REMEDIATION_MODEL_TIER`, with the agent count from the Modes table. Give each a non-overlapping set of files: if two removals would touch the same source files, or share one owned module, give them to one agent. In extreme mode each agent gets one package or one owned-subsystem group, because a large replacement needs the whole context window.

Agents share one worktree, so they only edit files; the orchestrator does all committing and is the only one that edits the manifest and lock file.

Brief each agent with:

```
<context>
Project type: {PROJECT_TYPE}
Build command: {BUILD_CMD}
Test command: {TEST_CMD}
Working directory: {WORKTREE_DIR} (a git worktree; do all work here)
Depfree mode: {DEPFREE_MODE}
Reasoning effort: {max in extreme mode; otherwise omit this line}
</context>

<task>
Remove the dependency on `{PACKAGE_NAME}` and replace it with owned code.

Current usage:
{USAGE_DETAILS from Phase 1b — imported symbols, call sites, files}

Replacement strategy: {STRATEGY from Phase 2, including the owned module location}

1. Write the replacement and update every import of the package to use it.
2. Update tests that mock the package or import helpers from it.
3. Run `{BUILD_CMD}` and the tests covering the files you changed. The manifest still lists the package, so it still resolves; that is expected.
4. Report the files you created and changed, the lines of owned code, and anything you could not replace.
</task>

<guardrails>
- Preserve behavior for every current call site and documented invariant. You may omit input shapes that are provably unreachable from the usage above, but do not narrow behavior for any real call site.
- Do not add a new dependency to replace the old one.
- Do not edit the manifest or lock file, and do not run git add or git commit. Other agents are editing other files in this same worktree; the orchestrator removes the packages from the manifest and commits each replacement after you report. A build or test failure outside your files may be another agent's work in progress — report it and leave it alone.
- Keep the replacement minimal and put shared utilities where the project already keeps such code.
- {Size rule for this mode, from the Modes table: default — if the work exceeds twice the estimate, stop and report instead of forcing a bad replacement; heavy — stop only past 300 lines or when it needs deep domain expertise; extreme — size is never a reason to stop, and a skip must come back with a design sketch of the owned module and what blocks it.}
- {Extreme mode only: for a replacement above about 100 lines, first write the design note (used surface, owned API, parity test plan, reachable and provably unreachable edge cases, risk) to `docs/deps/{PACKAGE_NAME}.md`. Then write parity tests that fail against a stub and pass against the owned code before switching any call site; the work is done only when every call site's behavior has such a test. Read the library's source for the behaviors your call sites depend on — option defaults, error shapes, ordering guarantees, encoding edge cases — instead of inferring them from its README.}
</guardrails>
```

As each agent reports, commit its replacement on its own, staging only the paths it reported, so Phase 4 can revert one replacement without disturbing the others:

```bash
git -C "{WORKTREE_DIR}" add -- {files the agent reported}
git -C "{WORKTREE_DIR}" commit -m "refactor: replace {package} with owned {utility/code}"
```

Follow the project's commit convention where it states one; the subjects in this command are the fallback. If an agent fails, continue with the others and record the gap. In extreme mode, re-dispatch an agent that stalled on a large replacement once, with the design note it produced so far.

### 3c: Manifest and lock file

After every agent has finished, in the orchestrator:

1. Remove all replaced packages from the manifest(s) in one pass and commit: `chore: remove replaced dependencies from manifest`.
2. Refresh the lock file to match, without running install scripts or upgrading unrelated packages:
   ```bash
   # npm
   npm install --package-lock-only --ignore-scripts
   # yarn Berry (2.x+)
   yarn install --mode=update-lockfile
   # pnpm
   pnpm install --lockfile-only --ignore-scripts
   # Rust — refreshes Cargo.lock for the removed entries only
   cargo update --workspace
   # Poetry 2.x — `poetry lock --no-update` was removed; plain `poetry lock`
   # only touches entries affected by the pyproject.toml change
   poetry lock
   # pip-tools
   pip-compile requirements.in
   ```
   Run only the line for this project's package manager, from `{WORKTREE_DIR}`.
3. Commit the lock file: `chore: update lock file after dependency removal`.

## Phase 4: Verification

### 4a: Build and test

Run `{BUILD_CMD}` and `{TEST_CMD}` in `{WORKTREE_DIR}`. In extreme mode also run the project's end-to-end or smoke suite when it documents one — a framework swap can pass every unit test and still break request handling that only an integration path exercises.

On a failure, identify the replacement responsible and fix it in a new commit. If the fix is not evident, revert that replacement's commit with `git -C "{WORKTREE_DIR}" revert <sha>`, restore its manifest and lock entries, and record the package as reverted with the failing test — a working dependency is better than broken owned code.

### 4b: Diff review

Review `git -C "{WORKTREE_DIR}" diff origin/{DEFAULT_BRANCH}...HEAD` for behavior parity with each removed library: same inputs and outputs, the edge cases the original handled, correct error handling at system boundaries, and no new security or performance regression (a naive regex replacing a sanitization library, O(n²) code replacing an optimized parser).

In extreme mode, give this review to a second `heavy`-tier agent at effort `max`, with each replacement's design note as its checklist: every behavior the design lists as relied upon has a parity test, every edge case it lists as unreachable really is unreachable from the call sites, and the owned module introduces no new dependency.

Fix what the review finds, one commit per fix.

### 4c: Update the decision record

Rewrite `{DEPS_FILE}` in the worktree (create its directory if needed) from this run's decisions plus the reused prior rows:

| This run | Decision | Reason starts with |
|---|---|---|
| policy-kept | `KEPT` | `policy: <pattern>` |
| Foundational | `KEPT` | `foundational` |
| kept after usage analysis | `KEPT` | `audited:` and why |
| downgraded in Phase 1c | `KEPT` | `transitive:` and the chain |
| removed | `REMOVED` | the replacement (file or native API) |
| reverted in Phase 4a | `SKIPPED` | `reverted:` and the failing test |
| not attempted or abandoned as infeasible | `SKIPPED` | `infeasible:` and what blocks it (in extreme mode, the design sketch and issue) |

A reused prior row keeps its date and mode. Drop rows for packages no longer in the manifest, except this run's `REMOVED` rows. When a prior row at a stricter mode reached the same conclusion, keep the stricter mode — a heavy run agreeing with an extreme row does not downgrade it.

```markdown
# Dependency Audit Decisions

Maintained by `/do:depfree`, which reuses these rows to skip packages it has
already audited. A package is audited again after a major version bump, on a
run in a stricter mode than its row records (default < heavy < extreme), or
when its row is deleted. Policy, transitive and reverted rows are re-evaluated
on every run, and extreme runs re-test infeasible ones.

Last updated: {YYYY-MM-DD}

| Package | Major | Decision | Mode | Date | Reason |
|---------|-------|----------|------|------|--------|
| ...     | ...   | KEPT     | ...  | ...  | ...    |
```

Sort rows by package name. Commit the file as `docs: update DEPS.md with audit decisions` if it changed.

### 4d: No remaining references

Search the worktree's source for imports of each removed package and fix any that remain. Match import syntax for the language (`import`/`require`/`from`/`use`), not the bare name: names like `uuid`, `debug` or `color` are also ordinary words and will match comments, identifiers and the replacement files this run just wrote. Exclude vendored and build-output directories.

## Phase 5: PR Creation

### 5a: Push and open the PR

```bash
git -C "{WORKTREE_DIR}" push -u origin {BRANCH}
```

Compose the title and body as text, substituting values you hold in context (do not rely on shell variables set in an earlier command). `{MODE_SUFFIX}` is empty in default mode, ` (heavy mode)` in heavy and ` (extreme mode)` in extreme, on both hosts.

- Title: `refactor: remove {N} unnecessary dependencies{MODE_SUFFIX}`
- Body: if the repository has a PR/MR template, follow it and fit the content below into it. Otherwise use:

```markdown
## Depfree Audit — Dependency Removal{MODE_SUFFIX}

### Summary
Removed {N} unnecessary third-party dependencies and replaced them with owned code.
Estimated supply chain attack surface reduction: {N} packages ({transitive count} including transitive deps).

### Dependencies Removed
| Package | Replacement | Lines of Owned Code |
|---------|-------------|---------------------|
{one row per removed package}

### Dependencies Kept
{count} dependencies kept with rationale (recorded in `{DEPS_FILE}`), including {policy count} kept by policy allowlist: {package (pattern), …}. Policy-kept packages were not usage-audited.

### Replacement Code
{bulleted list of new utility files or inline changes}

### Verification
- [ ] Build passes
- [ ] All tests pass
- [ ] No remaining references to removed packages
- [ ] Lock file updated
- [ ] `{DEPS_FILE}` updated with audit decisions
```

Write the body to a temporary file outside the repository and create the PR in one command:

```bash
# GitHub
gh pr create --head {BRANCH} --base {DEFAULT_BRANCH} --title "{TITLE}" --body-file "{BODY_FILE}"
# GitLab
glab mr create --source-branch {BRANCH} --target-branch {DEFAULT_BRANCH} --title "{TITLE}" --description "$(cat "{BODY_FILE}")"
```

Record `PR_NUMBER` and `PR_URL`.

**Gate — `--no-merge`.** Print the PR/MR URL and summary, then go to Phase 6, skipping 5b–5d. The PR/MR and its branch stay exactly as opened.

### 5b: CI verification

1. Wait 30 seconds for CI or the pipeline to start.
2. Poll status:
   - **GitHub:** `gh pr checks {PR_NUMBER}` every 30 seconds, for at most 10 minutes.
   - **GitLab:** `glab ci status --wait --branch {BRANCH}`, which blocks until the head pipeline finishes. GitLab has no separate list of required checks.
3. On a failure, fetch the logs, diagnose, fix, commit and push. After 3 failed attempts, stop fixing and report the failure to the user. If a push is rejected, rebase onto the remote branch and push again.

### 5c: Review Loop

**GATE — no reviewer requested: If `REVIEW_AGENTS` is empty** (no `--review-with` was passed), **skip this phase AND the Phase 5d merge.** There is no default reviewer. Leave the PR open for manual review, print its URL and summary, then proceed to Phase 6 cleanup.

Otherwise, run the **multi-reviewer loop** over `REVIEW_AGENTS`, in order, with the parsed `{REVIEW_STOP_MODE}`, `{REVIEW_MODE}` (series default — reviewers run one-at-a-time so each sees the prior's fixes; `parallel` collects reviews concurrently then applies the union once), `{REVIEWER_APPLIES}`, and `{REVIEW_ITERATIONS}` (the last caps copilot and `@<login>` passes only; local-agent and ollama passes use their own fixed iteration caps). Read the wrapper, then only the inner loop bodies it dispatches to for the reviewer kinds in `REVIEW_AGENTS`.

Each host-side entry takes `{WAIT_SCHEDULE}` from "Wait schedules" in the host-reviewer file; this command states no difference.

!read lib/multi-reviewer-loop.md

### Inner loop bodies (referenced by the wrapper)

Read only the bodies for reviewer kinds present in the agent list.

For every `copilot` or `@<login>` entry, read the shared host-reviewer template (its sub-agent runs the `{CODE_HOST}` verb file):

!read lib/host-reviewer-loop.md

Only for `copilot` entries on GitHub, also read the Copilot delta:

!read lib/copilot-review-loop.md

Only for an entry that is none of `copilot`, `ollama`, or `@<login>` (every other slug — the fixed CLIs and `cmd[<invocation>]` alike — dispatches through this one loop; a future addition needs no new gate here):

!read lib/local-agent-review-loop.md

Only for `ollama` entries:

!read lib/ollama-review-loop.md

Pass: `{REVIEW_AGENTS}`, `{REVIEW_STOP_MODE}`, `{REVIEW_MODE}`, `{REVIEWER_APPLIES}`, `{REVIEW_MODELS}` (the saved per-agent default models resolved in Parse Arguments — every local reviewer but `cmd` reads it; without it a saved `review-models` default is silently ignored), `{PR_NUMBER}`, `{OWNER}/{REPO}`, `{GH_HOST}` (so the host-side loops' `gh api` calls hit the right host on GitHub Enterprise), the per-entry `{WAIT_SCHEDULE}` selected above, `{BRANCH}` (the branch the local-agent loop checks out), `{BUILD_CMD}`, and `{REVIEW_ITERATIONS}` (default 1 — one pass, returning `capped`, which counts as clean for the merge gate below; 0 = run until 0 comments, bounded by the 10-iteration guardrail).

### 5d: Merge

Reached only when a review loop ran. Consume the multi-reviewer wrapper's `{OVERALL_STATUS}`:

- `clean` (or `partial` under an explicit stop-mode): proceed to the merge gate. Under `--interactive`, show the status and ask the user to approve the merge first.
- `inconclusive` (a requested reviewer timed out, errored, hit its guardrail or was skipped, including a missing CLI binary) or `dirty` (broken build, failed tests, or a reject): leave the PR open, set `MERGE_OUTCOME=left open`, report the status, and skip the merge gate.

Merge through the shared merge gate, which resolves the repo's allowed merge method, waits on required CI, merges, and reads the result back instead of trusting the merge command's exit status. Run it from inside `{WORKTREE_DIR}` with `{PR}` = `{PR_NUMBER}`, `{GIT}` = `git`, `{MODE}` = `wait` (Phase 6 needs the confirmed read-back to decide whether deleting the branch is safe), `{LINKED_WORKTREE}` = `1`, and `{MERGE_METHOD}` unset (depfree has no `--merge-method` flag, so the gate falls back to the repo's allowed method):

!read lib/merge-gate.md

Record the gate's outcome as `MERGE_OUTCOME` (`merged`, `queued`, or `left open`). The gate deletes the remote head itself once it reads back `MERGED`; Phase 6 does not delete it again.

## Phase 6: Cleanup

Reached from every path through Phase 5. `MERGE_OUTCOME` is `merged` only when 5d's gate confirmed it; on every other path (`--no-merge`, no reviewer requested, `queued`, `left open`, or unset) the PR/MR is still open.

1. **If `MERGE_OUTCOME=merged`**, remove the worktree and the local branch:
   ```bash
   git worktree remove "{WORKTREE_DIR}"
   git branch -d {BRANCH}
   ```
   Use `-d`, not `-D`. A refusal means the local branch carries commits the merge does not account for (a squash merge rewrites the SHA, for instance); investigate before forcing.

   **Otherwise the PR/MR is still open.** Do not remove the worktree, and do not delete the local or remote branch — deleting the head branch of an open PR/MR closes it. Report `{WORKTREE_DIR}` and `{BRANCH}` as retained for later review and merge.
2. File each removal that was reverted or skipped after Phase 2 as a deferred issue, deduplicated against `EXISTING_ISSUES` per the Phase 2 partials. When `TRACKER_AVAILABLE=false`, add it to the "Deferred (not filed — no issue tracker available)" list instead.
3. Print the final summary: the PR link (saying so when it is still open and not merged), the created and reused issue numbers for deferred removals, the not-filed list when there is no tracker, and:

```
| Package          | Status   | Replacement              | Lines |
|------------------|----------|--------------------------|-------|
| {package}        | Removed  | {utility/native API}     | {N}   |
| {package}        | Kept     | {reason; for policy, the matching pattern} | — |
| {package}        | Reverted | {reason for failure}     | —     |

Total dependencies before: {before}
Total dependencies after:  {after}
Packages removed: {count}
Owned replacement code: ~{lines} lines
Transitive deps eliminated: ~{count} (estimated)
```
