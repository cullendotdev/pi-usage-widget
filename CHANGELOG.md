# Changelog

All notable changes to pi-usage-widget are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project adheres to [Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-06-23

### Changed
- **Config file moved to `~/.pi/agent/config/pi-usage-widget-settings.json`**
  The settings file is now under the `config/` subdirectory of the agent dir, consistent with how other Pi extensions organise their config. If a file exists at the previous location (`~/.pi/agent/pi-usage-widget-settings.json`), it is automatically moved on first load — no manual action required.

### Removed
- **`globalColorOverrides` config field** — the Global tab in `/usage-settings` now edits per-mode overrides directly for the default mode. The global-override data layer, the corresponding resolution step in `resolveColor()`, and the schema field are all gone. Existing global overrides are folded into `perModeColorOverrides[defaultMode]` on load.
- **`perModeThemedPreset` config field** — never wired up to any UI or engine code; only `themedPreset` ever had consumers. Removed from the schema and stripped from saved configs on load.

### Refactored
- **Field-level config migrations consolidated** — `migrateLegacyConfig()` is the single entry point for stripping retired fields from parsed configs. Adding future migrations is one function call.
- **Settings menu cleanups** — `firstSelectableIndex()` replaces 6 copy-pasted cursor loops; `openColorsSubmenu()`/`openColumnsSubmenu()`/`closeSubMenu()` replace 8-way duplication in `switchTab`; `switchTab` collapses from 80 lines to ~25.

## [0.1.3] - 2026-06-22

### Fixed
- **`/usage-settings` arrow keys, Tab, and Escape under the Kitty keyboard protocol**
  Arrow keys (↑↓←→), Tab, Enter, and Escape now respond in terminals that honor the Kitty keyboard protocol (e.g. [herdr](https://github.com/herdr/herdr), [kitty](https://sw.kovidgoyal.net/kitty/), Ghostty). Special-key detection in `settings-menu.ts` and `color-picker.ts` now uses [`matchesKey()`](https://github.com/earendil-works/pi-tui) from pi-tui instead of raw escape-sequence comparison, matching `pi-skill-gate`. Behavior in tmux and raw terminals is unchanged.