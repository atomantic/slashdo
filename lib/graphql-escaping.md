## GraphQL Shell Escaping Rules

When inlining values directly into a GraphQL query string (rather than passing real GraphQL variables via `gh api`'s own `-F`/`-f` flags), **do NOT reference them as `$variableName`** — shell expansion consumes `$` signs before `gh` ever sees the query. Pipe the query in as stdin JSON, and always carry `--hostname GH_HOST`:
```bash
echo '{"query":"mutation { resolveReviewThread(input: {threadId: \"PRRT_abc123\"}) { thread { id isResolved } } }"}' | gh api --hostname GH_HOST graphql --input -
```

Never use inline `$variables` in a query string. Always use stdin JSON piping with `--hostname GH_HOST`.
