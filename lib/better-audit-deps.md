# Dependency Freedom
   Audit all third-party dependencies for necessity. Every small library is an attack surface — supply chain compromises are real and common.
   Focus:
   - Extract the full dependency list from the project manifest (`package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, `Gemfile`, etc.)
   - Classify each dependency into tiers:
     - **Acceptable**: large, widely-audited libraries (react, express, d3, three.js, next, vue, fastify, typescript, eslint, prisma, tailwindcss, tokio, serde, django, flask, pandas, etc.) — skip these
     - **Suspect**: smaller libraries where we may only use 1-2 functions, wrappers over built-in APIs, single-purpose utilities
     - **Removable**: libraries where the used functionality is <50 lines to implement, wraps a now-native API (e.g., `crypto.randomUUID()` replacing uuid, `structuredClone` replacing lodash.cloneDeep, `Array.prototype.flat` replacing array-flatten, `node:fs/promises` replacing fs-extra for most uses), unmaintained with known vulnerabilities, or micro-packages (is-odd, is-number, left-pad tier)
   - For each suspect/removable dependency: search all source files for imports, list every function/class/type used, count call sites, assess replacement complexity (Trivial <20 lines, Moderate 20-100, Complex 100-300, Infeasible 300+)
   - Check maintenance status: last publish date, open security issues, known CVEs
   - Report format: `**[SEVERITY]** {package-name} — {Tier}. Uses: {functions}. Call sites: {N} in {M} files. Replacement: {complexity}. Reason: {why removable}`
   - Severity mapping: unmaintained with CVEs → CRITICAL, unmaintained without CVEs → HIGH, replaceable single-function usage → MEDIUM, suspect but complex replacement → LOW
