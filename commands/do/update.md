---
description: Update slashdo commands to the latest version
---

# Update slashdo

Re-install slashdo commands from the latest published npm version.

## Steps

1. **Record the installed version**: Read `~/.claude/.slashdo-version` before running the installer (it gets overwritten in the next step). Treat a missing file as "none installed".

2. **Run the installer**: If `command -v npm` finds npm, run:
   ```bash
   npx slash-do@latest
   ```
   Otherwise (the curl installer does not require npm), run:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/atomantic/slashdo/main/install.sh | bash
   ```
   The installer itself prints the new/updated/unchanged command counts — do not recompute or restate that summary.

3. **Report**: Print the version recorded in step 1, the new version (read `~/.claude/.slashdo-version` again), and pass through the installer's own output.

## Notes

- This command wraps `npx slash-do@latest`, or `install.sh` when npm is unavailable
- It always pulls the latest published version
- Your existing commands that are not managed by slashdo are never touched
