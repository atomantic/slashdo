## Issue mode — the shared `/do:better` spool/filer contract

`better.md` reads this file **once**, gated on `ISSUE_MODE=true`, before Phase 1
dispatches any agent. It is the only place that reads the general tracker
mechanics; every phase below cites it instead of restating its rules.

!read lib/plan-issue-setup.md
!read lib/plan-issue-filing.md

> **Phase 2 (Plan Generation):** Keep the consolidated findings (Phase 2 steps 2–4) as
> your **in-run working plan in context** — do **not** create or write the
> `## Better Audit` section to `PLAN.md`, and skip step 1's "read/create PLAN.md".
> The tracker, not `PLAN.md`, is the source of truth for already-known work, so the
> disposition partial above has you fetch the open issues into `EXISTING_ISSUES`
> during setup. When consolidating findings (step 2), **dedup against
> `EXISTING_ISSUES`** as well as across agents: a finding that already has an open
> issue is not new — reuse that issue's `#<number>` instead of filing a duplicate.
> Remediation (Phase 3+) proceeds from that in-context plan exactly as normal. The
> only persistent records are issues: for any finding you **defer** (don't
> remediate this run, per the finding-disposition rules), file a labeled tracker
> issue instead of a PLAN.md line — see the disposition partial above. Report the
> created **and** reused issue numbers (`#<n>`) in the Phase 2 summary where you'd
> report slugs. Setup (VCS host + label + `EXISTING_ISSUES` fetch) is covered by
> [lib/plan-issue-setup.md](./plan-issue-setup.md) above: reuse `CLI_TOOL` from Phase 0a.
> Phase 1 spooled the finding **bodies** to `SPOOL_DIR` and returned only the
> **index**, so consolidate and dedup against those index lines — steps 2–4 need
> nothing else, so do not open a spool file **for them**. **Step 3 is the exception**:
> grouping the Foundation extractions needs the duplication counts and call-site lists that
> live only in the bodies, so read `$SPOOL_DIR/dry.md` for the ids step 2 kept in the `dry`
> category before writing the Foundation list Phase 3b builds from. Beyond that, the only
> reasons to open a spool file are targeted validation of `UNCERTAIN` findings
> against their cited source, and lifting a block verbatim into a `--body-file` on
> the inline path below. A validated finding receives its assessed severity;
> a disproven one is dropped. Keep unresolved findings explicitly unconfirmed,
> track them as investigation follow-ups without a confirmed severity label, and
> never auto-remediate them. When validation changes a status, have the owning
> audit worker update that finding's block and index before filing; the
> orchestrator still does not retype spooled evidence. When the surviving set is
> larger than ~20 findings, hand the ids off to per-category **filer agents** per
> [lib/plan-issue-filing.md](./plan-issue-filing.md)'s "Bulk filing — spool the bodies, dedup on an
> index" section rather than running `gh issue create` yourself; at or below that, file them inline —
> still lifting each id's block verbatim out of its spool file into a `--body-file`,
> never retyping it from the index line.

**Hand the filing to per-category filer agents when the surviving set exceeds ~20** —
whether that's the normal Phase 2 deferred set or, under `--scan-only`, every
surviving finding. Dispatch one filer
agent per category **in parallel**, giving each the surviving ids for its category,
the `$SPOOL_DIR/<category-slug>.md` file those bodies live in, `CLI_TOOL`,
`PLAN_LABEL`, the label rules, the `${URL##*/}` number-capture form, and the
secondary-rate-limit retry rule. Each returns only its `<id> -> #<number>` map. One
agent per category is the correct fan-out — dedup already gave each finding exactly
one category, so no two filers can collide, and sharding a category further only
makes rate limiting more likely.

Merge the returned maps for the summary. **An id a filer returned as `ERROR` was not
filed** — report those separately with their spool path so they can be filed by hand,
and keep `SPOOL_DIR` on disk when any error occurred. At or below ~20 surviving
findings, skip the fan-out and file them inline — still `--body-file`ing each block
verbatim out of the spool, never retyped from the index line; only the fan-out overhead
isn't worth it at that size.

### Phase 1 (Audit) — spooling a finding

Audit agents are `Explore` agents, which have no `Write` tool — they write their
spool file with a quoted-heredoc `cat > "$SPOOL_DIR/<slug>.md" <<'EOF'` via Bash,
so backticks and `$` in quoted evidence survive verbatim. **Only the first write
uses `>`; every later one must use `>>`** — an agent that spools findings across more
than one Bash call and reaches for `cat >` a second time truncates everything it has
already written, which is the tail-dropping this whole path exists to prevent.

A large audit surfaces hundreds of findings, and the alternative pulls every body
through the orchestrator's context twice — once reading the agent's report, once
re-emitting it into a `gh issue create` body. That second pass is where bodies get
truncated and tail findings get dropped. Everything Phase 2 actually decides —
cross-agent dedup, dedup against `EXISTING_ISSUES`, [gate 3](./better-simplify.md)'s churn
adjustment, and the `FILE_OWNER_MAP` — keys off the index fields alone, so the
bodies stay on disk until the filer agents move them to the tracker.

### Phase 3 (Remediation) — reading a spooled body back

**In issue mode the finding bodies are on disk, not in this context.** Build
`{FINDINGS}` from each worker's index lines plus the literal `SPOOL_DIR` path, and
instruct the worker to read the full body for each of its ids out of
`$SPOOL_DIR/<slug>.md`, where `<slug>` is the category on that id's own index line —
Conflict avoidance may merge two categories' findings into one worker when they
touch the same file, so such a worker must open every spool file its ids name, not
just the one matching its own category. "The orchestrator never rewrites a spooled
body" keeps the bodies out of *this* context — it does not license remediating from
titles.

### Phase 4c (Test Enhancement) — triage from the spool

**In issue mode the test-audit findings are on disk, not in this context.** The index
(`<id> | <SEVERITY> | <category> | <file:line> | <title>`) carries no `[VACUOUS]`/`[WEAK]`/`[MISSING]` tag at all — triaging off it is not merely
lossy, it is impossible. Read `$SPOOL_DIR/tests.md` (the literal path from run state) and
triage off each finding's full body, populating `{VACUOUS_AND_WEAK_FINDINGS}` /
`{MISSING_FINDINGS}` from those bodies, never from the index titles.

### Phase 7 (Cleanup) — removing the spool

Remove `SPOOL_DIR` (the literal path from run state) once nothing downstream still
needs the bodies — Phase 4c (or Phase 2's scan-only filing, when there is no Phase 3c
or 4c) is the last reader. **Unless any filer returned `ERROR`** — those findings were
never filed and their bodies exist nowhere else, so leave the directory and print its
path so they can be filed by hand.
