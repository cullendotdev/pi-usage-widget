---
date: 2026-05-12T16:33:18+0300
author: Cullen
commit: d2ce99b
branch: main
repository: pi-usage-extension
topic: "Add custom usage statistic display modes"
tags: [plan, usage-extension, display-modes, footer-widget]
status: ready
parent: "DISPLAY_MODES.md"
last_updated: 2026-05-12T16:33:18+0300
last_updated_by: Cullen
---

# Add Custom Usage Statistic Display Modes Implementation Plan

## Overview

This plan implements the five display modes (Summary, Compact, Detailed Collapsed, Detailed Expanded, Hidden) for the usage extension, as specified in `DISPLAY_MODES.md`. The new widget will be displayed above the editor in the Pi TUI, update in real-time, and cycle via `Ctrl+U`; scope toggles via `Ctrl+Shift+U`. The existing `/usage` modal remains unchanged.

## Desired End State

- Usage statistics widget appears above the editor when Pi is running.
- Pressing `Ctrl+U` cycles through Summary → Compact → Detailed (Collapsed) → Detailed (Expanded) → Hidden → Summary.
- Pressing `Ctrl+Shift+U` toggles time scope: Last Hour, Today, Yesterday, This Week, Last Week, This Month, All Time (defaults to Today).
- Widget re-renders automatically when new messages are sent and periodically for subagents.
- Cost formatting always shows 3 decimal places ($0.123). Token formatting follows Pi conventions.
- Default state on session start: Summary mode, Today scope.
- Existing `/usage` command still opens the detailed interactive modal.

## What We're NOT Doing

- Removing the existing Insights view from the `/usage` modal.
- Integrating insights into the new footer widget.
- Changing the default Pi footer (our widget is separate and placed above the editor).
- Adding telemetry beyond existing usage tracking.
- Replacing the detailed modal; it stays as-is.

## Phase 1: Refactor & Widget Foundation

### Overview
Extract reusable usage data collection logic from the existing `UsageComponent` and establish the new `UsageWidget` skeleton with basic state and placeholder rendering. Register widget on session lifecycle and add command shortcuts for mode/scope cycling.

### Changes Required:

#### 1.1 Extract usage data collection utilities (index.ts)
Move data collection functions, types, and constants out of `UsageComponent` into module scope:
- Types: `TokenStats`, `BaseStats`, `ModelStats`, `ProviderStats`, `TotalStats`, `TimeFilteredStats`, `UsageData`, `PeriodRawData`, `GlobalSessionSpan`, `SessionMessage`, `ParsedSessionFile`, `TabName`
- Core functions: `collectUsageData`, `parseSessionFile`, `addMessagesToUsageData`, `emptyTokens`, `emptyModelStats`, `emptyProviderStats`, `emptyTimeFilteredStats`, `emptyPeriodRawData`, `emptyUsageData`, `getPeriodsForTimestamp`, `accumulateStats`, `getSessionsDir`, `getAllSessionFiles`, `collectSessionFilesRecursively`
- Constants: `PARALLEL_WINDOW_MS`, `PARALLEL_SESSION_THRESHOLD`, `LARGE_CONTEXT_THRESHOLD`, `LARGE_CACHE_MISS_THRESHOLD`, `LONG_SESSION_MS`, `TOP_SESSION_COUNT`, `MIN_MESSAGES_FOR_PARALLEL_INSIGHT`, `MIN_PERCENT_TO_SHOW`
- Insight helpers: `computeInsights`, `computeParallelCostWeight`, `formatThresholdTokens`, `formatInsightPercent` (kept for modal; not used in widget)
Mark as `export` only where needed; internal functions remain unexported.

The existing `UsageComponent` code will be trimmed to import and use these helpers.

#### 1.2 Create UsageWidget class (index.ts)
Add a new `UsageWidget` class with:
- State: `displayMode: DisplayMode = 'summary'`, `scope: TimeScope = 'today'`, `usageData: UsageData | null = null`, `theme`, `requestRender`.
- Methods: `setData(data)`, `setMode(mode)`, `setScope(scope)`, `invalidate()`, and `render(width: number): string[]`.
- Render placeholder when data is null.

#### 1.3 Register widget on session_start (index.ts)
Add event listeners:
- `pi.on('session_start', async (_event, ctx) => { ... })` which creates `UsageWidget`, loads initial data via `collectUsageData()`, then calls `ctx.ui.setWidget('usage-stats-widget', { render, invalidate }, { placement: 'aboveEditor' })` if `ctx.hasUI`.
- Also listen to `session_switch` to reinitialize for new sessions.

#### 1.4 Add command shortcuts (index.ts)
Register two global commands:
- `cycle-usage-mode` (shortcut `ctrl+u`) cycles `widget.displayMode` through `['summary','compact','detailed-collapsed','detailed-expanded','hidden']`.
- `cycle-usage-scope` (shortcut `ctrl+shift+u`) cycles `widget.scope` through `['today','yesterday','thisWeek','lastWeek','thisMonth','lastHour','allTime']`.

### Success Criteria:

#### Automated:
- [ ] Type checking passes: `pnpm typecheck`
- [ ] Linting passes: `pnpm lint`
- [ ] Build succeeds: `pnpm build`

#### Manual:
- [ ] On Pi startup, a line containing "Usage: ... (Today)" appears above the editor (or "Loading..." during initial load).
- [ ] Pressing `Ctrl+U` updates the internal mode (observable via rendering).
- [ ] Pressing `Ctrl+Shift+U` updates the scope (e.g., label changes).
- [ ] The `/usage` command still opens the detailed modal overlay.

---

## Phase 2: Display Mode Rendering

### Overview
Implement the five display modes with correct formatting and styling. Extend data collection to all required scopes (Last Hour, Yesterday, This Month). Render detailed table with full column set, responsive layout, and proper color usage.

### Changes Required:

#### 2.1 Extend usage data collection for all scopes (index.ts)
Update `collectUsageData()` to compute stats for all seven scopes:
- Compute boundary timestamps:
  - `nowMs`
  - `todayMs` (midnight today)
  - `yesterdayMs = todayMs - 24h`
  - `weekStartMs` (Monday 00:00)
  - `lastWeekStartMs` (weekStartMs - 7d)
  - `monthStartMs` (1st of current month 00:00)
  - `lastHourMs = nowMs - 60*60*1000`
- Create `scopes` map with fields for each `TimeScope` using `emptyTimeFilteredStats()`.
- In the message loop, for each message with timestamp `ts`, add to every scope whose filter matches:
  - `allTime`: always
  - `today`: `ts >= todayMs`
  - `yesterday`: `ts >= yesterdayMs && ts < todayMs`
  - `thisWeek`: `ts >= weekStartMs`
  - `lastWeek`: `ts >= lastWeekStartMs && ts < weekStartMs`
  - `thisMonth`: `ts >= monthStartMs`
  - `lastHour`: `ts >= lastHourMs`
- Track per-scope `sessionContributed` to increment `totals.sessions`.
- Compute insights per scope via `computeInsights`.

Extend `UsageData` type to include all scopes.

#### 2.2 Formatting helpers (index.ts)
Add:
- `formatCostFixed3(cost: number): string` returns `cost === 0 ? '-' : \`$$\{cost.toFixed(3)}\``
- `formatScopeLabel(scope: TimeScope): string` returning proper display: `'Today'`, `'Yesterday'`, `'This Week'`, `'Last Week'`, `'This Month'`, `'Last Hour'`, `'All Time'`.
- Ensure `formatTokens` already matches spec (kept as-is).

#### 2.3 Summary mode (UsageWidget.render)
Render single line:
- If data for scope empty: `theme.fg('dim', \`Usage: --- (\{formatScopeLabel(scope)})\`)`
- Otherwise: `theme.fg('muted','Usage: ') + theme.fg('accent', formatCostFixed3(data.totals.cost)) + theme.fg('muted', ' (', formatScopeLabel(scope), ')')`

#### 2.4 Compact mode
Render:
- Title line: `theme.fg('accent', \`Usage (\{formatScopeLabel(scope)}):\`)`
- For each provider sorted by cost descending: `theme.fg('muted', '  ') + providerName + theme.fg('accent', ': ') + theme.fg('accent', formatCostFixed3(providerStats.cost))`
- If no usage: dimmed placeholder line.

#### 2.5 Detailed table scaffolding (UsageWidget)
Create helper functions within UsageWidget to share table rendering between collapsed/expanded:
- `renderTableHeader(width: number, layout: TableLayout): string[]` – renders title line, optional scope label (already rendered separately?), and column headers + separator.
- `renderDataRow(name: string, stats: BaseStats & {sessions: Set<string>|number}, layout: TableLayout, options)`: similar to existing `UsageComponent.renderDataRow`.
- `getTableLayout(width: number)`: reuse the existing `TABLE_LAYOUTS` candidates and `getTableLayout` function (move to top-level utility if not already).
The widget's detailed modes will display: scope label (in title area from outer render), then the table with header, rows, totals, formula note, help line.

Define order: Already `render` should render title and scope label separately? In Summary and Compact we include scope in content. For detailed modes, scope appears in title line at top or maybe in the table caption. We'll mimic existing UsageComponent which renders title line: "Usage Statistics" (always) and then tabs. The new widget does not have tabs; mode indicates what is shown. The title line should show "Usage (Today)" with accent? The design shows "Usage (Today)" above compact mode. For detailed modes, they also have a title line "Usage (Today)" like:
```
Usage (Today)              Sessions     Msgs     Cost   Tokens ...
──────────────────────────────────────────────────────────────────────────────────────
▸ google ...
```
So title line contains scope and aligns to left of table? In design, they put the scope right after "Usage". We can mimic: Title line = `theme.fg('accent', 'Usage') + theme.fg('muted', ` (\{formatScopeLabel(scope)})`)` and then spaces to total table width; or simply title above table left-aligned. The current UsageComponent uses a separate title line with bold "Usage Statistics" and then tabs. For widget, we don't need tabs. So render: title line (with scope), then blank line, then table header.

We'll implement: Title line using accent at start; a blank line; then header line; separator; then rows; separator; total row; formula note; optional help line (describe keybindings?). The design doesn't mention help line in widget; maybe we omit help or show a dimmed hint like "[Ctrl+U modes, Ctrl+Shift+U scope]". Could be optional.

The design says "Default pi footer remains unchanged" - that's the standard footer. Our widget is separate. So we don't need to show help. We'll omit.

#### 2.6 Detailed (Collapsed) mode
Render all providers with arrow "▸" prefix and without model rows. Use `renderDataRow` with `prefix: theme.fg('dim', '▸ ')` maybe. No interactive expansion; collapsed always shows providers only.

#### 2.7 Detailed (Expanded) mode
Render providers with arrow "▾" prefix and then for each provider render its models sorted by cost descending, each model row indented by 4 spaces and dimmed. Models use `renderDataRow` with `indent: 4` and `dimAll: true`.

#### 2.8 Hidden mode
Return empty array `[]`.

### Success Criteria:

#### Automated:
- [ ] TypeScript compiles with no errors
- [ ] No console warnings on load

#### Manual:
- [ ] Summary: single line with cost exactly 3 dp (e.g. `$0.123`)
- [ ] Compact: each provider listed with cost; totals match summary
- [ ] Detailed Collapsed: table renders all columns, totals correct, providers only
- [ ] Detailed Expanded: models nested under each provider, sorted by cost descending
- [ ] Hidden mode: no visible widget line
- [ ] Switching via `Ctrl+U` changes rendered content (update label if desired)
- [ ] Switching via `Ctrl+Shift+U` updates scope label (e.g., "(This Week)")
- [ ] Cost zero values display `-`
- [ ] Token values >999k display `X.Xk` accordingly, >1M display `X.XM`
- [ ] Narrow terminal (< full width) switches to compact column set automatically

---

## Phase 3: Real-Time Updates

### Overview
Make the widget refresh automatically when new assistant messages complete and on a periodic timer to capture background subagent activity.

### Changes Required:

#### 3.1 Subscribe to message_end (index.ts)
Add an event listener:
```typescript
pi.on('message_end', async (_event, ctx) => {
  // Debounced: schedule re-collection after short delay
  // Cancel any pending recompute; then setTimeout to async recompute
});
```
Implementation: use module-level `debounceTimer: NodeJS.Timeout | null`. On each message_end, clear existing timer, set new one for e.g., 1000 ms later. In the scheduled callback: if widget exists and has UI context, call `collectUsageData()` (with AbortSignal from previous if needed) then `widget.setData(newData)`. Handle abort to avoid updating w/ stale data.

#### 3.2 Periodic refresh
Set up `setInterval` (e.g., every 30 seconds) to recompute data and update widget. Clear interval on process exit? Not critical. Possibly tie to session_end event to clear but fine.

#### 3.3 Ensure safe UI updates
When updating widget from event, ensure `ctx` references current session UI. Use the stored widget reference and its `setData` method, which calls `requestRender`. Since the widget is attached to the UI via `setWidget`, calling `invalidate` should be safe.

### Success Criteria:

#### Automated:
- [ ] No unhandled promise rejections on message_end
- [ ] No memory leaks (verify timers cleared on new session)

#### Manual:
- [ ] After sending a new assistant message, within ~1s widget numbers increase
- [ ] Running subagents (e.g., `/plan`) updates widget without user action
- [ ] Widget remains responsive during heavy activity (no blocking)

---

## Phase 4: Documentation & Polish

### Overview
Finalize documentation, clean up code, verify type correctness and user-facing behavior matches spec.

### Changes Required:

#### 4.1 Update README.md
Add a new section **"Usage Widget (Footer)"** describing:
- Placement: above the editor
- Default mode/scope
- Keybindings: `Ctrl+U` (cycle modes), `Ctrl+Shift+U` (cycle scopes)
- List all 5 modes: Summary (single-line), Compact (per-provider), Detailed Collapsed (full table), Detailed Expanded (per-model), Hidden
- Cost formatting (3 dp) and token formatting
- Real-time update behavior
- Note that `/usage` command still opens the full interactive modal
- Include a small ASCII mockup or two.

#### 4.2 Code polish (index.ts)
- Remove all `console.log` used for debugging.
- Ensure all exported functions/types used across classes are properly typed.
- Verify theme color usage: accent for headers/values, muted for labels, dim for placeholders.
- Ensure `UsageWidget` gracefully handles missing data (no records).
- Add necessary imports to support new functionality (e.g., `setTimeout`, `clearTimeout`).
- Keep existing `UsageComponent` intact; no regression.
- Add inline comments explaining flow: session_start init, event subscriptions, mode/scope cycling.

#### 4.3 Verification checklist
Provide manual test steps in plan (already included as success criteria). Also add note to test across terminal sizes, across multiple sessions, and after clearing session data.

### Success Criteria:

#### Automated:
- [ ] `pnpm build` succeeds with no warnings
- [ ] All type-checks and lints pass

#### Manual:
- [ ] Widget appears correctly in fresh Pi session, default Summary/Today
- [ ] All five modes render as spec
- [ ] All scopes yield appropriate period data
- [ ] Real-time updates function
- [ ] README accurately reflects feature
- [ ] No visible console errors during normal use

---

## Testing Strategy

### Automated
- Standard project build and type checks: `pnpm typecheck`, `pnpm lint`, `pnpm build`.
- No unit tests currently; manual testing suffices.

### Manual Testing Steps
1. Start Pi; verify widget appears above editor with "Usage: $0.000 (Today)" or actual cost.
2. Press `Ctrl+U` repeatedly; observe mode transitions (title changes, presence/absence of widget).
3. Press `Ctrl+Shift+U`; observe scope label change (Today → This Week → Last Week → etc.).
4. Send several assistant messages; check that cost and token numbers increase and update within a few seconds.
5. Trigger subagent usage (e.g., run `/plan`). Verify widget updates to reflect added cost.
6. Toggle Hidden mode; confirm widget line disappears.
7. Toggle to Detailed modes; verify table columns align, numbers formatted correctly (3 dp cost, token shorthand).
8. Narrow terminal width; verify table collapses to a compact column set (Sessions, Msgs, Cost, Tokens) and truncates lines.
9. Launch `/usage`; confirm modal still opens with table/insights unaffected.
10. Close Pi and restart; verify defaults reset to Summary/Today.

## Performance Considerations

Data collection scans all session JSONL files, potentially expensive with many sessions. Mitigations:
- **Debouncing** on `message_end`: coalesce multiple rapid updates into one recompute (1 second delay).
- **Periodic refresh** interval set to 30 seconds to limit frequency.
- **AbortController**: if a recompute is superseded by a newer one, cancel the previous to free CPU.
- **Potential future optimization**: cache last scan's results and skip rescanning if file mtimes unchanged.

The widget renders lightweight string arrays; layout computation is O(providers) and fast.

## Migration Notes

No migration required. Existing session data is compatible. The new widget is additive, does not modify or delete any files. To disable the widget, user could remove the extension or set a setting (future).

## References

- Design spec: `DISPLAY_MODES.md`
- Current implementation: `index.ts` (UsageComponent, table rendering)
- Pi extension API: https://pt-act-pi-mono.mintlify.com/api/coding-agent/extension-api
- Example widget patterns: examples/extensions/widget-placement.ts
