## Tracker filing — the shared `/do:better` spool/filer contract

`better.md` reads this file **once**, before Phase 1 dispatches any agent. It is the only place that reads the general tracker mechanics; every phase cites it instead of restating its rules.

!read lib/plan-issue-setup.md
!read lib/plan-issue-filing.md

**When `TRACKER_AVAILABLE=false`** (Phase 0a), skip the setup, the `EXISTING_ISSUES`
fetch, and every filing step below: carry each deferred finding's title, one-line
rationale, and `file:line` from its index line into the Phase 7 report under
"Deferred (not filed — no issue tracker available)". Spooling and remediation are
unchanged.

### Phase 1 (Audit) — spooling a finding

Create the spool directory before dispatching any audit agent:

```bash
SPOOL_DIR="$(mktemp -d "${TMPDIR:-/tmp}/slashdo-issues-XXXXXX")"; echo "$SPOOL_DIR"
```

Record the printed path as `SPOOL_DIR` in run state and pass **that literal path**
to every agent; a shell variable does not survive between tool calls. Each agent
writes one ready-to-file issue body per finding (the Phase 1 finding format) to
`$SPOOL_DIR/<category-slug>.md`, using its own category slug, and **returns only the
compact index**:

```
<id> | <SEVERITY-or-UNCERTAIN> | <category> | <file:line> | <one-line title>
```

Preserve `[UNCERTAIN]` as `UNCERTAIN` in the index and in the spooled body; do not
assign a confirmed severity just to fit the index. Audit agents have no `Write` tool,
so they spool with a quoted heredoc (`cat > "$SPOOL_DIR/<slug>.md" <<'EOF'`) via Bash.
**Only the first write uses `>`; every later one must use `>>`** — a second `cat >`
truncates everything already spooled.

### Phase 2 (Plan) — working from the index

Everything Phase 2 decides — cross-agent and `EXISTING_ISSUES` dedup, churn
adjustment, `FILE_OWNER_MAP` — keys off the index lines, so do not open a spool file
for steps 2–4. **Step 3 is the exception**: read `$SPOOL_DIR/dry.md` for the ids step 2
kept in the `dry` category, since the duplication counts and call-site lists live only
in the bodies. Otherwise, open a spool file only for targeted validation of `UNCERTAIN` findings
 against their cited source, or to lift a block into a `--body-file`. A
validated finding receives its assessed severity; a disproven one is dropped. Keep
unresolved findings explicitly unconfirmed, track them as investigation follow-ups
without a confirmed severity label, and never auto-remediate them. When validation
changes a status, the owning audit worker updates that block and index line before
filing; the orchestrator never retypes spooled evidence.

Report created **and** reused issue numbers (`#<n>`) in the Phase 2 summary.

**Hand the filing to per-category filer agents when the surviving set exceeds ~20** —
the Phase 2 deferred set or, under `--scan-only`, every surviving finding — per
[lib/plan-issue-filing.md](./plan-issue-filing.md)'s bulk-filing section. Dispatch one
filer per category **in parallel**, giving each its surviving ids, its
`$SPOOL_DIR/<category-slug>.md` file, `CLI_TOOL`, `PLAN_LABEL`, the label rules, the
`${URL##*/}` number-capture form, and the secondary-rate-limit retry rule. Each
returns only its `<id> -> #<number>` map; never shard a category further.

Merge the returned maps for the summary. **An id a filer returned as `ERROR` was not
filed** — report those separately with their spool path so they can be filed by hand,
and keep `SPOOL_DIR` on disk when any error occurred. At or below ~20 surviving
findings, file them inline instead — still lifting each id's block verbatim out of its spool file, still `--body-file`ing each block
verbatim out of the spool, never retyped from the index line.

### Phase 3 (Remediation) — reading a spooled body back

**The finding bodies are on disk, not in this context.** Build `{FINDINGS}` from each
worker's index lines plus the literal `SPOOL_DIR` path, and instruct the worker to
read the full body for each of its ids out of `$SPOOL_DIR/<slug>.md`, where
`<slug>` is the category on that id's own index line. The Phase 3c ownership rule
may give one worker two categories' findings, so it must open every spool file its ids name.
Never remediate from index titles.

### Phase 4c (Test Enhancement) — triage from the spool

The index line carries no `[VACUOUS]`/`[WEAK]`/`[MISSING]` tag at all.
Read `$SPOOL_DIR/tests.md` (the literal path from run state) and populate
`{VACUOUS_AND_WEAK_FINDINGS}` / `{MISSING_FINDINGS}` from the full bodies.

### Phase 7 (Cleanup) — removing the spool

Remove `SPOOL_DIR` once nothing downstream still needs the bodies — Phase 4c (or
Phase 2's scan-only filing) is the last reader. **Unless any filer returned `ERROR`** —
those bodies exist nowhere else, so leave the directory and print its path.
