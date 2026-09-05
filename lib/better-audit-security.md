# Security & Secrets
   Sources: authentication checks, credential exposure, infrastructure security, input validation, dependency health
   Focus: hardcoded credentials, API keys, exposed secrets, authentication bypasses, disabled security checks, PII exposure, injection vulnerabilities (SQL/command/path traversal), insecure CORS configurations, missing auth checks, unsanitized user input in file paths or queries, known CVEs in dependencies (check `npm audit` / `cargo audit` / `pip-audit` / `go vuln` output), abandoned or unmaintained dependencies, overly permissive dependency version ranges
   OWASP Top 10 framing: broken auth (session fixation, credential stuffing), security misconfiguration (default creds, debug mode in prod), SSRF (user-controlled URLs in server fetch without allowlist), mass assignment (request bodies bound to models without field allowlist)
   Supply chain: lockfile committed + frozen installs in CI, no untrusted postinstall scripts
