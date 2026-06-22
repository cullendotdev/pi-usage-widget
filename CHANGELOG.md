# Changelog

All notable changes to pi-usage-widget are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.3] - 2026-06-22

### Fixed
- **`/usage-settings` arrow keys, Tab, and Escape under the Kitty keyboard protocol**
  Arrow keys (↑↓←→), Tab, Enter, and Escape now respond in terminals that honor the Kitty keyboard protocol (e.g. [herdr](https://github.com/herdr/herdr), [kitty](https://sw.kovidgoyal.net/kitty/), Ghostty). Special-key detection in `settings-menu.ts` and `color-picker.ts` now uses [`matchesKey()`](https://github.com/earendil-works/pi-tui) from pi-tui instead of raw escape-sequence comparison, matching `pi-skill-gate`. Behavior in tmux and raw terminals is unchanged.