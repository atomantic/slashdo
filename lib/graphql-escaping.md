## GraphQL Shell Escaping Rules

When using `gh api graphql -f query='...'`, **do NOT use `$variableName` syntax** in GraphQL queries — shell expansion consumes `$` signs. Instead, inline all values directly into the query string:
```bash
gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: "PRRT_abc123"}) { thread { id isResolved } } }'
```

Never use `$variables` in GraphQL queries. Never use `-f query=` with dollar signs. Always use stdin JSON piping for complex queries.
