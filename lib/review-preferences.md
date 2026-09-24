# Review preferences

**Review logic, not lint.** A linter, type-checker, compiler, formatter, and test suite already catch syntax errors, lint violations, formatting, import order, unused variables, and build breakage. Do not raise pure-style or formatting nits, rename suggestions, or "extract a helper/constant" refactors unless they are the *root cause* of a behavior bug. Every finding must name a concrete wrong outcome (a crash, a wrong value, a leak, a missing-coverage gap, a broken contract), not a preference.

Read each changed file in full, not just the diff hunks, and reason about what the change must guarantee — on the fallback and failure paths as well as the happy path — rather than matching it against known bug shapes. A comment, doc, test name, prompt, or commit message that claims behavior the code does not deliver is a finding.

**Evidence.** Quote the code line(s) behind every finding and say in one sentence why they produce the wrong outcome. A finding you cannot quote code for, or whose consequence you have not confirmed, is UNCERTAIN.

**Severity.**
- **CRITICAL** — a realistic input or sequence produces a wrong outcome: a crash, data loss or corruption, a security hole, or a broken contract.
- **IMPROVEMENT** — a real but lower-impact defect: a coverage gap, documentation drift, a degraded fallback, or dead code.
- **UNCERTAIN** — suspected but not demonstrated; verify it or drop it before acting on it.
