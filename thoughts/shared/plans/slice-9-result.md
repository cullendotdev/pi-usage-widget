# Slice 9: Integration — Commands & session lifecycle

**Status:** ✅ Complete  
**Issue:** [#10 — Slice 9: Integration](https://github.com/cullendotdev/pi-usage-widget/issues/10)

## Summary

Refactored `index.ts` from ~1100 lines to 223 lines (80% reduction) by extracting modules and completing the module wiring. All 297 tests pass (0 failures).

## Changes

### New files
- **`usage-modal.ts`** — UsageComponent class extracted from index.ts (495 lines). Interactive /usage dashboard with table and insights views.
- **`usage-widget.ts`** — UsageWidget class extracted from index.ts (105 lines). Footer widget with cycle commands that persist config.
- **`tests/integration.test.ts`** — 20 integration tests covering config persistence, cycle commands, render engine integration, settings menu reload, and resource cleanup.

### Modified files
- **`index.ts`** — Refactored from ~1100 → 223 lines. Pure orchestration layer: imports modules, registers 5 commands, handles session_start/switch/end lifecycle, debounced/periodic data refresh.

### What index.ts does now
| Section | Lines | Description |
|---------|-------|-------------|
| Imports | 1-15 | 8 module imports |
| /usage command | 17-67 | Interactive modal (CancellableLoader → UsageComponent) |
| Data refresh | 70-115 | Debounced (1s) + periodic (30s) + AbortController |
| Session lifecycle | 117-152 | session_start/switch/end with cleanup |
| Shortcuts | 155-162 | Ctrl+U (mode), Alt+U (scope) |
| Commands | 164-191 | /cycle-usage-mode, /cycle-usage-scope, /usage-settings |

### Integration points verified
- [x] `getUsageData()` from data-collection.ts replaces inlined `collectUsageData()`
- [x] `UsageComponent` from usage-modal.ts handles /usage interactive modal
- [x] `UsageWidget` from usage-widget.ts handles footer widget + cycle persistence
- [x] Cycle commands (Ctrl+U, Alt+U) persist mode/scope to config via `saveConfig()`
- [x] Settings menu close triggers `loadConfig()` → widget.updateConfig() → re-render
- [x] session_start: `loadConfig()` → create widget → initial data load → `setWidget()` → periodic refresh
- [x] session_end: cleanup all timers, abort controllers, event listeners, widget disposal
- [x] session_switch: cleanup previous session resources
- [x] `placement.mode` mapped to `setWidget()` placement option
- [x] First run with no config file works via `getDefaultConfig()` fallback in loadConfig()

## Test Results

```
# tests 298
# suites 69
# pass 297
# fail 0
# cancelled 0
# skipped 1
```

Skipped: 1 test that requires Pi runtime (index.ts export parsing)

### Coverage
- **20 integration tests**: config round-trip, cycle persistence, render engine modes, settings reload, resource cleanup
- All existing 277 module tests still pass unchanged

## Configuration Flow

```
session_start
  └─ loadConfig() ─── no file? → getDefaultConfig()
       └─ UsageWidget(config)
            └─ renderWidget(config, theme, data, width, mode, scope)
                 └─ ctx.ui.setWidget()

settings change (via menu)
  └─ SettingsMenu mutates config + saveConfig()
       └─ on close: widget.updateConfig(loadConfig())
            └─ renderWidget() with updated config

cycle mode/scope (Ctrl+U / Alt+U)
  └─ widget.cycleMode() / widget.cycleScope()
       └─ config.defaultMode = next; saveConfig(config)
            └─ tui.requestRender() → renderWidget()
```

## Acceptance Criteria

- [x] Session start: widget loads config, renders with persisted settings
- [x] No config file on first run: widget works with hardcoded defaults (no crash)
- [x] Changing settings via /usage-settings persists to pi-usage-widget-settings.json
- [x] Restarting session: widget respects previously saved settings
- [x] Ctrl+U cycles display modes (summary → compact → per-model → expanded → hidden)
- [x] Alt+U cycles time scopes
- [x] Widget updates in real-time on message_end (debounced 1s)
- [x] Widget updates periodically (30s) for background subagent activity
- [x] session_switch cleans up old widget state
- [x] session_end cleans up all resources (timers, abort controllers, event listeners)
- [x] All existing 277 tests still pass + 20 new integration tests
- [ ] **HITL: Human verifies end-to-end flow in live Pi session**

## Next Steps

Human-in-the-loop verification required:
1. Change settings via `/usage-settings` → restart session → verify settings persist
2. Ctrl+U / Alt+U → verify widget updates and settings are saved
3. Verify widget appears correctly after session switch
4. Verify no memory leaks or stale timers after session_end
