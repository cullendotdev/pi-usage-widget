# Slice 4 Result — Color Engine: Themed Presets + Overrides

**Status:** ✅ Complete  
**Issue:** [#5 — Slice 4: Color engine — Themed presets + overrides](https://github.com/cullendotdev/pi-usage-widget/issues/5)  
**Tests:** 85/85 passing, 0 failures

## Changes

### New files
- **`color-engine.ts`** — Full color engine module (340 lines)
- **`tests/color-engine.test.ts`** — Comprehensive test suite (355 lines)

### No modifications to existing files
(per constraints: widget-render.ts, index.ts, config-persistence.ts, data-collection.ts, formatting.ts untouched)

## What was built

### 1. Themed Presets (6 complete ColorSchemes)
Each preset covers all 22 elements (title, scope, 9 column headers, 9 column values, headerLine, footerLine):
- **default** — Clean blue/gray (Pi-like)
- **tokyo-night** — Dark blue/purple with green headers
- **dracula** — Purple/cyan/pink
- **gruvbox** — Warm retro earth tones
- **nord** — Cool arctic blue/gray
- **catppuccin** — Pastel macchiato

### 2. Color Resolution Engine
- `resolveColor(element, config, options?)` → ANSI escape code
- Three-layer override system: per-mode > global > themed preset
- `null` values correctly inherit from parent level

### 3. ANSI Conversion
- `hexToAnsi("#rrggbb")` → truecolor ANSI escape `\x1b[38;2;R;G;Bm`
- `ansiNameToAnsi("name")` → 4-bit ANSI (supports all 16 standard + bright colors)
- Theme fg role names resolved via configurable `themeFgMap`

### 4. Default Theme FG Role Map
Built-in mapping for Pi theme role names ("accent", "muted", "dim", "text", "border", "thinkingText", "error", "warning", "success", "info") → hex colors. Callers can override via `options.themeFgMap`.

### 5. Graceful fallback
- Invalid hex, unknown ANSI names, missing preset → falls back through layers to a hardcoded "dim" default
- Unknown preset name falls back to "default"

## Test coverage

| Suite | Tests | Focus |
|-------|-------|-------|
| colorPresets completeness | 38 | All 6 presets have 22 elements, valid hex, valid ANSI, immutable |
| colorElements | 3 | 22 elements, all categories, default preset coverage |
| defaultThemeFgMap | 2 | 10 roles, all valid hex |
| hexToAnsi | 9 | Lowercase, uppercase, edge cases, invalid inputs |
| ansiNameToAnsi | 3 | Standard colors, bright variants, unknown names |
| resolveColor — preset-only | 7 | All 22 elements, individual verification |
| resolveColor — themed preset switching | 10 | All 5 non-default presets, title + full coverage |
| resolveColor — global overrides | 7 | Hex, ANSI names, fg roles, null handling, invalid fallback |
| resolveColor — per-mode overrides | 4 | Mode isolation, precedence over global, null inheritance |
| resolveColor — mode option | 2 | defaultMode vs explicit mode |
| resolveColor — custom themeFgMap | 2 | Custom role mapping, override of defaults |
| resolveColor — unknown preset fallback | 1 | Falls back to default preset |
| resolveColor — combined scenarios | 1 | Full precedence chain: per-mode > global > preset |
| resolveColor — exhaustive coverage | 2 | Every element × every mode, every element × every preset |

## Architecture notes

- **Pure functions only** — no filesystem access, no Theme import, no side effects
- **Single import dependency** — only `./types.js` for types
- **Future integration path:** widget-render.ts will replace `theme.fg("role", text)` calls with `resolveColor(element, config, {mode, themeFgMap})`
- **The ColorOverrides interface** in types.ts already covers all 22 element keys — no types.ts changes needed

## Acceptance criteria

- [x] 6 themed presets defined as typed data objects with complete element coverage
- [x] Preset data is immutable and centrally defined (no scattered color logic)
- [x] `resolveColor(element, config)` returns correct ANSI code for: preset-only, preset+global-override, preset+per-mode-override scenarios
- [x] Theme fg roles are correctly mapped to hex → ANSI
- [x] 16-color ANSI names correctly map to ANSI escape sequences
- [x] Custom hex codes correctly converted to ANSI truecolor
- [x] Invalid color values handled gracefully (fallback to preset default)
- [x] All tests pass: `npx tsx --test tests/color-engine.test.ts`
- [ ] Manual verification: editing JSON to change preset or override an element changes widget colors instantly (deferred to integration slice)
