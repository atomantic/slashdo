# Cognitive Load & Readability _(simplify-only mode — dispatch only when `SIMPLIFY_ONLY=true`, otherwise skip)_
   Sources: `HOT_FILES` from Phase 0e (start here — these are the files whose reader-cost is paid most often; it tells you where to look, not how severe a finding is), the largest files, and the entry points a newcomer would read first (main/index modules, primary route or command handlers)
   Focus: **how much a reader must hold in their head to change one line safely**. Where the Structural Ambition agent asks "can this whole shape be deleted or reframed?", this agent asks "can the next person understand this without a guide?"
   - Mixed abstraction levels inside one function — high-level orchestration interleaved with raw SQL, byte manipulation, or DOM detail
   - Flag arguments: boolean or enum parameters that make one function do two unrelated jobs
   - Names that lie or say nothing (`data`, `tmp2`, `handle`, `doStuff`), abbreviations that need tribal knowledge, negated booleans (`notDisabled`, `hideNothing`) that force double-negative reasoning
   - Comments that exist to explain code a rename or extraction would make self-evident; commented-out code left as documentation
   - Action at a distance: module-level mutable state, implicit ordering requirements between calls ("must call `init()` first"), side effects hidden behind names that read as pure
   - Repeated `if`/`else if` ladders or `switch` chains that a lookup table, dispatch map, or early return would collapse
   - Defensive `?.` / `|| fallback` soup that obscures which values are actually possible, and casts that paper over an unclear contract
   **Size and shape thresholds belong to agent 4**, which is also running — god files, over-long functions, nesting depth, and long parameter lists are its findings, not yours. Do not re-flag them here; report only the reader-cost issues above, which agent 4 does not look for.
   Every finding must name the concrete transformation (extract, invert, rename, table-ize, early-return) **and** the reader-cost it removes. Do NOT flag cosmetic preference — formatting, quote style, import order, and line length belong to the formatter/linter, not here. Do NOT propose a rename of a public export without a backward-compatible re-export. Tag this agent's category as `cognitive-load` for Phase 2 ownership mapping.
