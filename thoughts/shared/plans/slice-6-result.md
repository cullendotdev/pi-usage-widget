# Slice 6 Result: Settings menu — Global tab + live preview

**Status:** ✅ Complete  
**Issue:** [#6 — Slice 5: Settings menu — Global tab + live preview](https://github.com/cullendotdev/pi-usage-widget/issues/6)  
**Commit:** fb84136

## What was built

1. **`settings-menu.ts`** — New module (365 lines):
   - 5-tab TUI shell with left/right arrow navigation
   - Global tab with 3 SettingsList dropdowns: Display Mode, Time Scope, Theme Preset
   - Live preview pane that renders actual widget output via renderWidget
   - Stub tabs for Summary, Compact, Per-Model, Expanded (for later slices)
   - Config persistence: every change saves immediately via saveConfig()

2. **`index.ts`** — Registered `/usage-settings` command:
   - Opens via ctx.ui.custom() following existing patterns
   - Esc/q closes the menu
   - Full handleInput/render/dispose lifecycle

## Tests
- 23 new tests in `tests/settings-menu.test.ts`
- All 198 existing tests still pass
- **Total: 221 pass, 0 fail, 1 skipped** (skipped: index.ts parse test requires Pi runtime)

## Acceptance criteria met
- [x] `/usage-settings` command opens the settings menu
- [x] 5 tabs visible; left/right arrow cycles through them
- [x] Live preview pane visible at top of menu
- [x] Changing themed preset in Global tab updates preview instantly
- [x] Changing default mode/scope in Global tab updates preview
- [x] Settings persist: closing and reopening restores previous values
- [x] Escape or `q` closes the settings menu

## Files changed
- `settings-menu.ts` (new)
- `tests/settings-menu.test.ts` (new)
- `index.ts` (+import, +command registration)
