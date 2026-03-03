---
description: Check for slashdo updates on session start
hooks:
  - event: SessionStart
---

# slashdo Update Check

Check if a newer version of slashdo is available.

## Steps

1. Read the installed version from `~/.claude/.slashdo-version`
2. If the file doesn't exist, skip silently (slashdo may not be installed)
3. Run `npm view slash-do version` with a 3-second timeout
4. Compare versions
5. If the latest version is newer than the installed version, print:
   ```
   slashdo update available: v{installed} -> v{latest} (run /do:update)
   ```
6. If up to date or if the check fails (network error, timeout), do nothing — don't interrupt the user's session
