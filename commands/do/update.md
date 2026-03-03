---
description: Update slashdo commands to the latest version
---

# Update slashdo

Re-install slashdo commands from the latest published npm version.

## Steps

1. **Run the installer**:
   ```bash
   npx slashdo@latest
   ```

2. **Show what changed**:
   - Compare the previous installed version (from `~/.claude/.slashdo-version`) to the new one
   - Print a summary of new, updated, and unchanged commands

3. **Report**: Print the version that was installed and the count of changes.

## Notes

- This command is a convenience wrapper around `npx slashdo@latest`
- It always pulls the latest published version from npm
- Your existing commands that are not managed by slashdo are never touched
