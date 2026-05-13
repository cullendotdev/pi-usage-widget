/**
 * Tests for color-engine.ts — presets, conversions, and color resolution.
 *
 * Run: npx tsx --test tests/color-engine.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  colorElements,
  colorPresets,
  defaultThemeFgMap,
  hexToAnsi,
  ansiNameToAnsi,
  resolveColor,
} from "../color-engine.js";

import type { ColorElement, ColorScheme, ResolveColorOptions } from "../color-engine.js";
import type { UsageWidgetConfig, DisplayMode, ColorOverrides } from "../types.js";
import { getDefaultConfig, mergeConfig } from "../config-persistence.js";

// =============================================================================
// Helpers
// =============================================================================

const ALL_MODES: DisplayMode[] = ["summary", "compact", "per-model", "expanded", "hidden"];

function makeConfig(overrides?: Partial<UsageWidgetConfig>): UsageWidgetConfig {
  const base = getDefaultConfig();
  return overrides ? mergeConfig(base, overrides) : base;
}

function expectAnsiEscape(ansi: string): void {
  assert.ok(ansi.startsWith("\x1b["), `Expected ANSI escape, got: ${JSON.stringify(ansi)}`);
}

function ansiIsNotEmpty(ansi: string): void {
  assert.ok(ansi.length > 0, "ANSI code should not be empty");
}

/** Extract hex from truecolor ANSI like \x1b[38;2;84;160;255m → "#54a0ff" */
function ansiToHex(ansi: string): string {
  const m = /^\x1b\[38;2;(\d+);(\d+);(\d+)m$/.exec(ansi);
  if (!m) return "";
  const r = parseInt(m[1]).toString(16).padStart(2, "0");
  const g = parseInt(m[2]).toString(16).padStart(2, "0");
  const b = parseInt(m[3]).toString(16).padStart(2, "0");
  return `#${r}${g}${b}`;
}

// =============================================================================
// Preset completeness
// =============================================================================

describe("colorPresets completeness", () => {
  const presetNames = Object.keys(colorPresets) as (keyof typeof colorPresets)[];

  it("has exactly 6 presets", () => {
    assert.equal(presetNames.length, 6);
  });

  it("covers default, tokyo-night, dracula, gruvbox, nord, catppuccin", () => {
    assert.deepEqual(new Set(presetNames), new Set([
      "default",
      "tokyo-night",
      "dracula",
      "gruvbox",
      "nord",
      "catppuccin",
    ]));
  });

  for (const presetName of presetNames) {
    describe(`preset '${presetName}'`, () => {
      const preset = colorPresets[presetName];

      it("covers all 22 colorElements", () => {
        for (const el of colorElements) {
          assert.ok(el in preset, `Missing element '${el}' in preset '${presetName}'`);
        }
      });

      it("has exactly 22 elements (no extras)", () => {
        assert.equal(Object.keys(preset).length, 22);
      });

      it("all values are valid hex colors", () => {
        for (const [el, hex] of Object.entries(preset)) {
          assert.ok(/^#[0-9a-fA-F]{6}$/.test(hex), `'${el}' has invalid hex: ${hex}`);
        }
      });

      it("all values resolve to valid ANSI via hexToAnsi", () => {
        for (const hex of Object.values(preset)) {
          const ansi = hexToAnsi(hex);
          assert.ok(ansi.length > 0, `hex ${hex} did not produce ANSI`);
          expectAnsiEscape(ansi);
        }
      });

      it("is not mutated between reads", () => {
        const first = colorPresets[presetName].title;
        // Access again — must be identical
        assert.equal(colorPresets[presetName].title, first);
      });
    });
  }
});

// =============================================================================
// colorElements — completeness and type consistency
// =============================================================================

describe("colorElements", () => {
  it("has exactly 22 elements", () => {
    assert.equal(colorElements.length, 22);
  });

  it("contains all expected categories", () => {
    assert.ok(colorElements.includes("title"));
    assert.ok(colorElements.includes("scope"));
    assert.ok(colorElements.includes("providerHeader"));
    assert.ok(colorElements.includes("modelHeader"));
    assert.ok(colorElements.includes("providerValue"));
    assert.ok(colorElements.includes("modelValue"));
    assert.ok(colorElements.includes("headerLine"));
    assert.ok(colorElements.includes("footerLine"));
  });

  it("each element exists in default preset", () => {
    const preset = colorPresets.default;
    for (const el of colorElements) {
      assert.ok(preset[el] !== undefined, `'${el}' missing from default preset`);
    }
  });
});

// =============================================================================
// defaultThemeFgMap
// =============================================================================

describe("defaultThemeFgMap", () => {
  it("contains all expected role keys", () => {
    const expected = ["accent", "muted", "dim", "text", "border", "thinkingText",
      "error", "warning", "success", "info"];
    for (const role of expected) {
      assert.ok(role in defaultThemeFgMap, `Missing role: ${role}`);
    }
  });

  it("all values are valid hex colors", () => {
    for (const [role, hex] of Object.entries(defaultThemeFgMap)) {
      assert.ok(/^#[0-9a-fA-F]{6}$/.test(hex), `Role '${role}' has invalid hex: ${hex}`);
    }
  });
});

// =============================================================================
// hexToAnsi
// =============================================================================

describe("hexToAnsi", () => {
  it("converts lowercase hex to truecolor ANSI", () => {
    const ansi = hexToAnsi("#ff00ff");
    assert.equal(ansi, "\x1b[38;2;255;0;255m");
  });

  it("converts uppercase hex to truecolor ANSI", () => {
    const ansi = hexToAnsi("#AABBCC");
    assert.equal(ansi, "\x1b[38;2;170;187;204m");
  });

  it("converts black", () => {
    assert.equal(hexToAnsi("#000000"), "\x1b[38;2;0;0;0m");
  });

  it("converts white", () => {
    assert.equal(hexToAnsi("#ffffff"), "\x1b[38;2;255;255;255m");
  });

  it("returns empty string for invalid hex (too short)", () => {
    assert.equal(hexToAnsi("#fff"), "");
  });

  it("returns empty string for invalid hex (no hash)", () => {
    assert.equal(hexToAnsi("ff00ff"), "");
  });

  it("returns empty string for non-hex characters", () => {
    assert.equal(hexToAnsi("#GGGGGG"), "");
  });

  it("returns empty string for empty input", () => {
    assert.equal(hexToAnsi(""), "");
  });

  it("returns empty string for 7-char input", () => {
    assert.equal(hexToAnsi("#1234567"), "");
  });
});

// =============================================================================
// ansiNameToAnsi
// =============================================================================

describe("ansiNameToAnsi", () => {
  it("returns correct ANSI for standard colors", () => {
    assert.equal(ansiNameToAnsi("black"), "\x1b[30m");
    assert.equal(ansiNameToAnsi("red"), "\x1b[31m");
    assert.equal(ansiNameToAnsi("green"), "\x1b[32m");
    assert.equal(ansiNameToAnsi("yellow"), "\x1b[33m");
    assert.equal(ansiNameToAnsi("blue"), "\x1b[34m");
    assert.equal(ansiNameToAnsi("magenta"), "\x1b[35m");
    assert.equal(ansiNameToAnsi("cyan"), "\x1b[36m");
    assert.equal(ansiNameToAnsi("white"), "\x1b[37m");
  });

  it("returns correct ANSI for bright variants", () => {
    assert.equal(ansiNameToAnsi("brightBlack"), "\x1b[90m");
    assert.equal(ansiNameToAnsi("brightRed"), "\x1b[91m");
    assert.equal(ansiNameToAnsi("brightGreen"), "\x1b[92m");
    assert.equal(ansiNameToAnsi("brightYellow"), "\x1b[93m");
    assert.equal(ansiNameToAnsi("brightBlue"), "\x1b[94m");
    assert.equal(ansiNameToAnsi("brightMagenta"), "\x1b[95m");
    assert.equal(ansiNameToAnsi("brightCyan"), "\x1b[96m");
    assert.equal(ansiNameToAnsi("brightWhite"), "\x1b[97m");
  });

  it("returns empty string for unknown name", () => {
    assert.equal(ansiNameToAnsi("pink"), "");
    assert.equal(ansiNameToAnsi(""), "");
    assert.equal(ansiNameToAnsi("Dim"), ""); // case-sensitive
  });
});

// =============================================================================
// resolveColor — preset-only (no overrides)
// =============================================================================

describe("resolveColor — preset-only", () => {
  it("returns preset color for 'title' in default mode", () => {
    const config = makeConfig();
    const ansi = resolveColor("title", config);
    expectAnsiEscape(ansi);
    assert.equal(ansiToHex(ansi), colorPresets.default.title);
  });

  it("returns preset color for 'scope' in default mode", () => {
    const config = makeConfig();
    const ansi = resolveColor("scope", config);
    expectAnsiEscape(ansi);
  });

  it("returns preset color for providerHeader", () => {
    const config = makeConfig();
    const ansi = resolveColor("providerHeader", config);
    expectAnsiEscape(ansi);
    assert.equal(ansiToHex(ansi), colorPresets.default.providerHeader);
  });

  it("returns preset color for costValue", () => {
    const config = makeConfig();
    const ansi = resolveColor("costValue", config);
    expectAnsiEscape(ansi);
    assert.equal(ansiToHex(ansi), colorPresets.default.costValue);
  });

  it("returns preset color for headerLine", () => {
    const config = makeConfig();
    const ansi = resolveColor("headerLine", config);
    expectAnsiEscape(ansi);
  });

  it("returns preset color for footerLine", () => {
    const config = makeConfig();
    const ansi = resolveColor("footerLine", config);
    expectAnsiEscape(ansi);
  });

  it("all 22 elements resolve to non-empty ANSI codes", () => {
    const config = makeConfig();
    for (const el of colorElements) {
      const ansi = resolveColor(el, config);
      ansiIsNotEmpty(ansi);
      expectAnsiEscape(ansi);
    }
  });
});

// =============================================================================
// resolveColor — themed preset switching
// =============================================================================

describe("resolveColor — themed preset switching", () => {
  for (const presetName of ["tokyo-night", "dracula", "gruvbox", "nord", "catppuccin"] as const) {
    it(`'${presetName}' preset correctly resolves title color`, () => {
      const config = makeConfig({ themedPreset: presetName } as Partial<UsageWidgetConfig>);
      const ansi = resolveColor("title", config);
      expectAnsiEscape(ansi);
      assert.equal(ansiToHex(ansi), colorPresets[presetName].title);
    });

    it(`'${presetName}' preset all elements resolve`, () => {
      const config = makeConfig({ themedPreset: presetName } as Partial<UsageWidgetConfig>);
      for (const el of colorElements) {
        const ansi = resolveColor(el, config);
        ansiIsNotEmpty(ansi);
        expectAnsiEscape(ansi);
      }
    });
  }
});

// =============================================================================
// resolveColor — global overrides
// =============================================================================

describe("resolveColor — global overrides", () => {
  it("global hex override applies to all modes", () => {
    const config = makeConfig({
      globalColorOverrides: { title: "#ff0000" },
    });
    const ansiSummary = resolveColor("title", config, { mode: "summary" });
    const ansiCompact = resolveColor("title", config, { mode: "compact" });
    assert.equal(ansiToHex(ansiSummary), "#ff0000");
    assert.equal(ansiToHex(ansiCompact), "#ff0000");
  });

  it("global hex override for a single element does not affect others", () => {
    const config = makeConfig({
      globalColorOverrides: { title: "#ff0000" },
    });
    const titleAnsi = resolveColor("title", config);
    const scopeAnsi = resolveColor("scope", config);
    assert.equal(ansiToHex(titleAnsi), "#ff0000");
    assert.equal(ansiToHex(scopeAnsi), colorPresets.default.scope);
  });

  it("global ANSI palette name override", () => {
    const config = makeConfig({
      globalColorOverrides: { modelHeader: "brightMagenta" },
    });
    const ansi = resolveColor("modelHeader", config);
    // Should be 4-bit ANSI, not truecolor
    assert.equal(ansi, "\x1b[95m");
  });

  it("global theme fg role override resolves via fgMap", () => {
    const config = makeConfig({
      globalColorOverrides: { providerValue: "success" },
    });
    const ansi = resolveColor("providerValue", config);
    expectAnsiEscape(ansi);
    assert.equal(ansiToHex(ansi), defaultThemeFgMap.success);
  });

  it("global override with custom fgMap", () => {
    const config = makeConfig({
      globalColorOverrides: { msgsValue: "customRole" },
    });
    const ansi = resolveColor("msgsValue", config, {
      themeFgMap: { customRole: "#abcdef" },
    });
    assert.equal(ansiToHex(ansi), "#abcdef");
  });

  it("null global override falls through to preset", () => {
    const config = makeConfig({
      globalColorOverrides: { title: null, scope: "#ff0000" },
    });
    const titleAnsi = resolveColor("title", config);
    const scopeAnsi = resolveColor("scope", config);
    // title: null → inherit preset
    assert.equal(ansiToHex(titleAnsi), colorPresets.default.title);
    // scope: #ff0000 → override
    assert.equal(ansiToHex(scopeAnsi), "#ff0000");
  });

  it("invalid global override falls back to preset", () => {
    const config = makeConfig({
      globalColorOverrides: { title: "not_a_color_or_role" },
    });
    const ansi = resolveColor("title", config);
    assert.equal(ansiToHex(ansi), colorPresets.default.title);
  });
});

// =============================================================================
// resolveColor — per-mode overrides
// =============================================================================

describe("resolveColor — per-mode overrides", () => {
  it("per-mode override applies only to that mode", () => {
    const config = makeConfig({
      perModeColorOverrides: {
        summary: { title: "#ff0000" },
        compact: { title: null },
        "per-model": { title: null },
        expanded: { title: null },
        hidden: { title: null },
      },
    });
    const ansiSummary = resolveColor("title", config, { mode: "summary" });
    const ansiCompact = resolveColor("title", config, { mode: "compact" });
    assert.equal(ansiToHex(ansiSummary), "#ff0000");
    assert.equal(ansiToHex(ansiCompact), colorPresets.default.title);
  });

  it("per-mode override takes precedence over global override", () => {
    const config = makeConfig({
      globalColorOverrides: { title: "#00ff00" },
      perModeColorOverrides: {
        ...makeConfig().perModeColorOverrides,
        summary: { ...makeConfig().perModeColorOverrides.summary, title: "#ff0000" },
      },
    });
    const ansi = resolveColor("title", config, { mode: "summary" });
    assert.equal(ansiToHex(ansi), "#ff0000"); // per-mode wins, not global
  });

  it("null per-mode override falls through to global override", () => {
    const config = makeConfig({
      globalColorOverrides: { title: "#00ff00" },
    });
    // perModeColorOverrides.title is null for compact mode (default)
    const ansi = resolveColor("title", config, { mode: "compact" });
    assert.equal(ansiToHex(ansi), "#00ff00"); // falls through to global
  });

  it("null per-mode + null global = preset", () => {
    const config = makeConfig();
    const ansi = resolveColor("title", config, { mode: "compact" });
    assert.equal(ansiToHex(ansi), colorPresets.default.title);
  });
});

// =============================================================================
// resolveColor — mode option behavior
// =============================================================================

describe("resolveColor — mode option", () => {
  it("uses config.defaultMode when mode not provided", () => {
    const config = makeConfig({ defaultMode: "compact" });
    // Per-mode compact override
    const perModeOverrides = { ...makeConfig().perModeColorOverrides };
    perModeOverrides.compact = { ...perModeOverrides.compact, title: "#ff0000" };
    const config2 = makeConfig({ defaultMode: "compact", perModeColorOverrides: perModeOverrides });
    const ansi = resolveColor("title", config2);
    assert.equal(ansiToHex(ansi), "#ff0000");
  });

  it("explicit mode option overrides config.defaultMode", () => {
    const perModeOverrides = { ...makeConfig().perModeColorOverrides };
    perModeOverrides["per-model"] = { ...perModeOverrides["per-model"], title: "#abcdef" };
    const config = makeConfig({
      defaultMode: "compact",
      perModeColorOverrides: perModeOverrides,
    });
    const ansi = resolveColor("title", config, { mode: "per-model" });
    assert.equal(ansiToHex(ansi), "#abcdef");
  });
});

// =============================================================================
// resolveColor — custom themeFgMap
// =============================================================================

describe("resolveColor — custom themeFgMap", () => {
  it("custom fgMap maps role name to correct hex", () => {
    const config = makeConfig({
      globalColorOverrides: { scope: "accent" },
    });
    const ansi = resolveColor("scope", config, {
      themeFgMap: { accent: "#112233" },
    });
    assert.equal(ansiToHex(ansi), "#112233");
  });

  it("custom fgMap overrides default role mappings", () => {
    const config = makeConfig({
      globalColorOverrides: { scope: "accent" },
    });
    const ansiCustom = resolveColor("scope", config, {
      themeFgMap: { accent: "#112233" },
    });
    const ansiDefault = resolveColor("scope", config);
    assert.notEqual(ansiToHex(ansiCustom), ansiToHex(ansiDefault));
  });
});

// =============================================================================
// resolveColor — unknown preset fallback
// =============================================================================

describe("resolveColor — unknown preset fallback", () => {
  it("falls back to 'default' preset for unknown preset name", () => {
    const config = makeConfig({ themedPreset: "nord" });
    // Overwrite themedPreset to something invalid at the raw object level
    const raw = { ...config, themedPreset: "nonexistent" as any };
    const ansi = resolveColor("title", raw as UsageWidgetConfig);
    // Should fall back to default preset colors
    assert.equal(ansiToHex(ansi), colorPresets.default.title);
  });
});

// =============================================================================
// resolveColor — combined scenarios
// =============================================================================

describe("resolveColor — combined scenarios", () => {
  it("per-mode > global > preset precedence chain", () => {
    const perModeOverrides = { ...makeConfig().perModeColorOverrides };
    perModeOverrides.compact = { ...perModeOverrides.compact, costHeader: "#111111" };

    const config = makeConfig({
      themedPreset: "dracula",
      globalColorOverrides: { costHeader: "#222222" },
      perModeColorOverrides: perModeOverrides,
    });

    // Mode where per-mode IS set: should win
    const ansiCompact = resolveColor("costHeader", config, { mode: "compact" });
    assert.equal(ansiToHex(ansiCompact), "#111111");

    // Mode where per-mode is null: global wins
    const ansiSummary = resolveColor("costHeader", config, { mode: "summary" });
    assert.equal(ansiToHex(ansiSummary), "#222222");

    // Mode where both are null: preset wins
    const perModeOverrides2 = { ...makeConfig().perModeColorOverrides };
    perModeOverrides2.compact = { ...perModeOverrides2.compact, costHeader: null };
    const config2 = makeConfig({
      themedPreset: "dracula",
      globalColorOverrides: { costHeader: null },
      perModeColorOverrides: perModeOverrides2,
    });
    const ansiPreset = resolveColor("costHeader", config2, { mode: "compact" });
    assert.equal(ansiToHex(ansiPreset), colorPresets.dracula.costHeader);
  });
});

// =============================================================================
// resolveColor — every element, every mode, every preset
// =============================================================================

describe("resolveColor — exhaustive coverage", () => {
  it("every element × mode combination returns valid ANSI", () => {
    const config = makeConfig();
    for (const mode of ALL_MODES) {
      for (const el of colorElements) {
        const ansi = resolveColor(el, config, { mode });
        ansiIsNotEmpty(ansi);
        expectAnsiEscape(ansi);
      }
    }
  });

  it("every element × preset combination returns valid ANSI", () => {
    const presetNames = Object.keys(colorPresets) as (keyof typeof colorPresets)[];
    for (const preset of presetNames) {
      const config = makeConfig({ themedPreset: preset } as Partial<UsageWidgetConfig>);
      for (const el of colorElements) {
        const ansi = resolveColor(el, config);
        ansiIsNotEmpty(ansi);
        expectAnsiEscape(ansi);
      }
    }
  });
});
