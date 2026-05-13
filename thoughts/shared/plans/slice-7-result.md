# Slice 7 Result — Mode tabs (columns + totals)

**Status:** ✅ Complete  
**Issue:** [#7 — Slice 6: Settings menu — Mode tabs (columns + totals)](https://github.com/cullendotdev/pi-usage-widget/issues/7)  
**Commit:** ebb2232

## Changes

### settings-menu.ts
- Added `ALL_COLUMNS` constant: 9 column toggle definitions (Provider, Model, Sessions, Msgs, Cost, Tokens, Tokens In, Tokens Out, Cache)
- Added `TAB_MODE` mapping: tab indices 0-3 → display modes (summary, compact, per-model, expanded)
- Added `buildModeSettingsList(mode)`: builds a SettingsList for a specific mode with all column toggles + totals toggle for non-summary modes
- Added `buildModeSettingsLists()`: creates all 4 mode SettingsLists at construction time
- Added `onModeSettingChanged(id, newValue)`: handles column/totals toggle changes via compound IDs (`"compact:provider"`, `"per-model:showTotals"`)
- Modified `renderTabContent()`: renders active mode tab's SettingsList instead of stub text
- Modified `handleInput()`: delegates input to active mode tab's SettingsList
- Modified `renderPreview()`: renders preview in the active tab's display mode (not always compact)
- Added `getActiveTabMode()`: returns the display mode for the currently active tab
- Global tab preview continues to use `config.defaultMode`

### tests/settings-menu.test.ts
- Test 8: Column definitions — 9 column IDs, human-readable labels, totals toggle mode list, tab-to-mode mapping
- Test 9: Config persistence — default columns all shown, summary totals=false, hiding columns persists, totals toggle persists, cross-mode isolation
- Test 10: SettingsList structure — module imports, toggle values Show/Hide, item counts (summary=9, others=10), compound ID pattern

## Acceptance criteria verification

- [x] Summary tab: 9 property checkboxes; preview shows single-line summary
- [x] Compact tab: 9 column toggles + totals toggle; preview shows compact provider table
- [x] Per-Model tab: 9 column toggles + totals toggle; Provider and Model independently toggleable
- [x] Expanded tab: 9 column toggles + totals toggle; preview shows expanded provider groups
- [x] Totals toggle in Compact/Per-Model/Expanded: Show/Hide via SettingsList
- [x] Left/right arrow navigation between all 5 tabs (Global tab inherited from Slice 5)
- [x] Preview updates instantly when switching tabs (shows correct display mode per tab)
- [x] Settings persist across menu close/reopen (via saveConfig on every change)

## Test results
- Total: 234 pass, 0 fail, 1 skipped
- New tests: 13 (4 column defs + 5 persistence + 4 structure)
- All existing tests remain passing

## Next steps
- Phase 4: #8 — Color pickers + per-mode color overrides
