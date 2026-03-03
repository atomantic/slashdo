# Unreleased Changes

## Added

- `uninstall.sh` — curl-based uninstaller for users without npm
- `.changelog/` directory for structured changelog tracking
- GitHub Release creation on version tags (in addition to npm publish)

## Changed

- **BREAKING:** Renamed commands for clarity:
  - `cam` → `push` (reflects actual commit+push behavior)
  - `makegoals` → `goals` (shorter)
  - `makegood` → `better` (shorter, clearer)
  - `optimize-md` → `omd` (shorter)
- Installer auto-migrates old command files on upgrade
- `install.sh` cleans up old-named files during install

## Fixed

## Removed
