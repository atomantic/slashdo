## Tracker filing — the shared `/do:better` spool/filer contract

`better.md` reads this file **once**, before Phase 1; phases cite it rather than restate it. The partials below own the spool format, index line, and filer rules; this file adds only how `/do:better` uses them.

!read lib/plan-issue-setup.md
!read lib/plan-issue-filing.md

**When `TRACKER_AVAILABLE=false`** (Phase 0a), skip setup, the `EXISTING_ISSUES`
fetch, and all filing: carry each deferred finding's title, rationale, and `file:line`
from its index line into the Phase 7 report under "Deferred (not filed — no issue
tracker available)". Spooling and remediation are unchanged.

### Phase 1 (Audit)

Create `SPOOL_DIR` before dispatching any audit agent and record the literal printed
path in run state. Each agent spools one ready-to-file block per finding (the Phase 1
finding format in the bulk-filing block format) to `$SPOOL_DIR/<category-slug>.md` and returns only its
`<SEVERITY-or-UNCERTAIN>` index lines. Audit agents have no `Write` tool, so they spool
via a quoted Bash heredoc (`cat > "$SPOOL_DIR/<slug>.md" <<'EOF'`). **Only the first
write uses `>`; every later one must use `>>`.**

### Phase 2 (Plan)

Dedup, churn adjustment, and `FILE_OWNER_MAP` key off the index lines.
**Step 3 is the exception**: read `$SPOOL_DIR/dry.md` for the ids step 2 kept in
`dry`, since duplication counts and call sites live only in the bodies. Otherwise open a block only
for targeted validation of `UNCERTAIN` findings against their cited source, or to lift
it into a `--body-file`. Validation assigns the assessed severity or drops a disproven
finding; unresolved ones stay unconfirmed follow-ups without a confirmed severity
label — never auto-remediate them. A status change is written back to the block and
index line by the owning audit worker, never retyped by the orchestrator.

File the deferred set (under `--scan-only`, every surviving finding): above ~20, via
one parallel filer per category per the bulk-filing section; at or below ~20, inline —
still lifting each id's block verbatim out of its spool file, still `--body-file`ing each block
verbatim out of the spool. **An id a filer returned as `ERROR` was not
filed**: report it with its spool path. Report created **and** reused `#<n>` in the
Phase 2 summary.

### Phase 3 (Remediation)

**The finding bodies are on disk, not in this context.** Build `{FINDINGS}` from each
worker's index lines plus the literal `SPOOL_DIR`, and have the worker read the full body for each of its ids out of `$SPOOL_DIR/<slug>.md`, where
`<slug>` is that id's own index-line category — a worker given two categories
must open every spool file its ids name. Never remediate from index titles.

### Phase 4c (Test Enhancement)

The index line carries no `[VACUOUS]`/`[WEAK]`/`[MISSING]` tag at all.
Read `$SPOOL_DIR/tests.md` and populate `{VACUOUS_AND_WEAK_FINDINGS}` /
`{MISSING_FINDINGS}` from the bodies.

### Phase 7 (Cleanup)

Phase 4c (or Phase 2's scan-only filing) is the last reader, so remove `SPOOL_DIR`
then — **unless any filer returned `ERROR`**: keep it and print its path.
