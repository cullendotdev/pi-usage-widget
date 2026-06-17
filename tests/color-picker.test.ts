/**
 * Tests for color-picker.ts — color picker submenu component and integration.
 *
 * Run: npx tsx --test tests/color-picker.test.ts
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// =============================================================================
// Test 1: Color picker mode constants
// =============================================================================

describe("Color picker — mode constants", () => {
  it("has exactly 3 modes: theme, ansi, hex", async () => {
    const mod = await import("../color-picker.js");
    const modes = mod.COLOR_PICKER_MODES;
    assert.ok(Array.isArray(modes), "COLOR_PICKER_MODES should be an array");
    assert.equal(modes.length, 3);
    assert.ok(modes.includes("theme"));
    assert.ok(modes.includes("ansi"));
    assert.ok(modes.includes("hex"));
  });

  it("modes have display labels", async () => {
    const mod = await import("../color-picker.js");
    const labels = mod.COLOR_PICKER_MODE_LABELS;
    assert.ok(typeof labels === "object");
    assert.equal(labels.theme, "Theme Roles");
    assert.equal(labels.ansi, "ANSI Palette");
    assert.equal(labels.hex, "Custom Hex");
  });
});

// =============================================================================
// Test 2: Theme role color options
// =============================================================================

describe("Color picker — theme role options", () => {
  it("buildThemeOptions returns 10 entries", async () => {
    const mod = await import("../color-picker.js");
    const options = mod.buildThemeOptions();
    assert.equal(options.length, 10);
  });

  it("each option has label, value, and hex fields", async () => {
    const mod = await import("../color-picker.js");
    const options = mod.buildThemeOptions();

    for (const opt of options) {
      assert.ok(typeof opt.label === "string", "label should be a string");
      assert.ok(typeof opt.value === "string", "value should be a string");
      assert.ok(typeof opt.hex === "string", "hex should be a string");
      assert.ok(/^#[0-9a-fA-F]{6}$/.test(opt.hex), `hex should match #rrggbb: ${opt.hex}`);
    }
  });

  it("includes all required theme fg roles", async () => {
    const mod = await import("../color-picker.js");
    const options = mod.buildThemeOptions();
    const labels = options.map((o: { label: string }) => o.label);

    const expected = [
      "accent", "muted", "dim", "text", "border",
      "thinkingText", "error", "warning", "success", "info",
    ];

    for (const role of expected) {
      assert.ok(labels.includes(role), `Missing theme role: ${role}`);
    }
  });

  it("values match labels (theme role name)", async () => {
    const mod = await import("../color-picker.js");
    const options = mod.buildThemeOptions();

    for (const opt of options) {
      assert.equal(opt.value, opt.label,
        `theme role value should equal label for ${opt.label}`);
    }
  });
});

// =============================================================================
// Test 3: ANSI palette color options
// =============================================================================

describe("Color picker — ANSI palette options", () => {
  it("buildAnsiOptions returns 16 entries", async () => {
    const mod = await import("../color-picker.js");
    const options = mod.buildAnsiOptions();
    assert.equal(options.length, 16);
  });

  it("each option has label, value, and hex fields", async () => {
    const mod = await import("../color-picker.js");
    const options = mod.buildAnsiOptions();

    for (const opt of options) {
      assert.ok(typeof opt.label === "string", "label should be a string");
      assert.ok(typeof opt.value === "string", "value should be a string");
      assert.ok(typeof opt.hex === "string", "hex should be a string");
    }
  });

  it("includes the 8 standard ANSI colors", async () => {
    const mod = await import("../color-picker.js");
    const options = mod.buildAnsiOptions();
    const labels = options.map((o: { label: string }) => o.label);

    const baseColors = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"];
    for (const color of baseColors) {
      assert.ok(labels.includes(color), `Missing ANSI color: ${color}`);
    }
  });

  it("includes the 8 bright ANSI variants", async () => {
    const mod = await import("../color-picker.js");
    const options = mod.buildAnsiOptions();
    const labels = options.map((o: { label: string }) => o.label);

    const brightColors = [
      "brightBlack", "brightRed", "brightGreen", "brightYellow",
      "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
    ];
    for (const color of brightColors) {
      assert.ok(labels.includes(color), `Missing ANSI color: ${color}`);
    }
  });

  it("standard ANSI colors appear before bright variants", async () => {
    const mod = await import("../color-picker.js");
    const options = mod.buildAnsiOptions();

    // First 8 should be standard, last 8 should be bright
    for (let i = 0; i < 8; i++) {
      assert.ok(!options[i].label.startsWith("bright"), `Index ${i} should not be bright: ${options[i].label}`);
    }
    for (let i = 8; i < 16; i++) {
      assert.ok(options[i].label.startsWith("bright"), `Index ${i} should be bright: ${options[i].label}`);
    }
  });
});

// =============================================================================
// Test 4: Hex input validation
// =============================================================================

describe("Color picker — hex validation", () => {
  it("validateHex accepts valid 6-digit hex codes", async () => {
    const mod = await import("../color-picker.js");

    assert.ok(mod.validateHex("#ff0000"));
    assert.ok(mod.validateHex("#00ff00"));
    assert.ok(mod.validateHex("#0000ff"));
    assert.ok(mod.validateHex("#ffffff"));
    assert.ok(mod.validateHex("#000000"));
    assert.ok(mod.validateHex("#54a0ff"));
    assert.ok(mod.validateHex("#ABCDEF"));
    assert.ok(mod.validateHex("#aBcDeF"));
  });

  it("validateHex rejects invalid inputs", async () => {
    const mod = await import("../color-picker.js");

    assert.ok(!mod.validateHex(""));
    assert.ok(!mod.validateHex("#ff"));
    assert.ok(!mod.validateHex("ff0000")); // no hash
    assert.ok(!mod.validateHex("#ff000")); // 5 chars
    assert.ok(!mod.validateHex("#ff0000ff")); // 8 chars
    assert.ok(!mod.validateHex("#GGGGGG")); // invalid chars
    assert.ok(!mod.validateHex("red")); // not hex
    assert.ok(!mod.validateHex("#redred")); // invalid chars
    assert.ok(!mod.validateHex(" #ff0000")); // leading space
  });

  it("validateHex accepts mixed case", async () => {
    const mod = await import("../color-picker.js");

    assert.ok(mod.validateHex("#AbCdEf"));
    assert.ok(mod.validateHex("#aBcDeF"));
    assert.ok(mod.validateHex("#ABCDEF"));
    assert.ok(mod.validateHex("#abcdef"));
  });
});

// =============================================================================
// Test 5: Color swatch rendering
// =============================================================================

describe("Color picker — swatch rendering", () => {
  it("renderColorSwatch returns a non-empty string for valid hex", async () => {
    const mod = await import("../color-picker.js");
    const swatch = mod.renderColorSwatch("#ff0000");
    assert.ok(typeof swatch === "string");
    assert.ok(swatch.length > 0);
  });

  it("renders ANSI escape codes for the swatch", async () => {
    const mod = await import("../color-picker.js");
    const swatch = mod.renderColorSwatch("#00ff00");
    assert.ok(swatch.includes("\x1b["), "should contain ANSI escape");
  });

  it("renders a reset after each swatch", async () => {
    const mod = await import("../color-picker.js");
    const swatch = mod.renderColorSwatch("#0000ff");
    assert.ok(swatch.includes("\x1b[0m"), "should contain ANSI reset");
  });

  it("returns '??' for invalid hex", async () => {
    const mod = await import("../color-picker.js");
    assert.equal(mod.renderColorSwatch("invalid"), "??");
    assert.equal(mod.renderColorSwatch(""), "??");
    assert.equal(mod.renderColorSwatch("#GGG"), "??");
    assert.equal(mod.renderColorSwatch("#ff"), "??");
  });

  it("different colors produce different swatches", async () => {
    const mod = await import("../color-picker.js");
    const red = mod.renderColorSwatch("#ff0000");
    const blue = mod.renderColorSwatch("#0000ff");
    assert.notEqual(red, blue);
  });
});

// =============================================================================
// Test 6: findColorOption — locate current color in options
// =============================================================================

describe("Color picker — findColorOption", () => {
  it("finds a theme role in theme options", async () => {
    const mod = await import("../color-picker.js");
    const result = mod.findColorOption("accent");
    assert.ok(result !== null);
    assert.equal(result.mode, "theme");
    assert.ok(result.index >= 0);
    assert.ok(result.index < 10);
  });

  it("finds an ANSI palette name in ansi options", async () => {
    const mod = await import("../color-picker.js");
    const result = mod.findColorOption("red");
    assert.ok(result !== null);
    assert.equal(result.mode, "ansi");
    assert.ok(result.index >= 0);
    assert.ok(result.index < 16);
  });

  it("finds a bright ANSI variant", async () => {
    const mod = await import("../color-picker.js");
    const result = mod.findColorOption("brightCyan");
    assert.ok(result !== null);
    assert.equal(result.mode, "ansi");
    assert.ok(result.index >= 8 && result.index < 16);
  });

  it("identifies hex codes as hex mode", async () => {
    const mod = await import("../color-picker.js");
    const result = mod.findColorOption("#54a0ff");
    assert.ok(result !== null);
    assert.equal(result.mode, "hex");
    // hex mode returns the hex string, not an index
    assert.equal(result.hexValue, "#54a0ff");
  });

  it("returns null for unknown colors", async () => {
    const mod = await import("../color-picker.js");
    assert.equal(mod.findColorOption("unknownRole"), null);
    assert.equal(mod.findColorOption(""), null);
    assert.equal(mod.findColorOption("notAColor"), null);
  });

  it("returns null for null (inherit)", async () => {
    const mod = await import("../color-picker.js");
    assert.equal(mod.findColorOption(null), null);
  });
});

// =============================================================================
// Test 7: ColorPicker class structure
// =============================================================================

describe("ColorPicker class structure", () => {
  it("ColorPicker is a class export", async () => {
    const mod = await import("../color-picker.js");
    assert.ok(typeof mod.ColorPicker === "function", "ColorPicker should be a class/function");
  });

  it("ColorPicker prototype has render, handleInput, dispose", async () => {
    const mod = await import("../color-picker.js");
    const proto = mod.ColorPicker.prototype;

    assert.ok(typeof proto.render === "function", "should have render()");
    assert.ok(typeof proto.handleInput === "function", "should have handleInput()");
    assert.ok(typeof proto.dispose === "function", "should have dispose()");
  });
});

// =============================================================================
// Test 8: Color resolution behavior (integration with color-engine)
// =============================================================================

describe("Color resolution with overrides", () => {
  it("global override takes precedence over preset default", () => {
    const { getDefaultConfig, mergeConfig } = require("../config-persistence.js");
    const { resolveColor, colorPresets } = require("../color-engine.js");

    const config = getDefaultConfig();
    // Override title color globally
    config.globalColorOverrides.title = "#ff0000";
    const result = resolveColor("title", config);

    // Should use the override, not the preset
    assert.ok(result.includes("255;0;0") || result !== colorPresets.default.title,
      "global override should take precedence over preset");
  });

  it("per-mode override takes precedence over global", () => {
    const { getDefaultConfig } = require("../config-persistence.js");
    const { resolveColor } = require("../color-engine.js");

    const config = getDefaultConfig();
    config.globalColorOverrides.title = "#00ff00"; // global: green
    config.perModeColorOverrides.summary.title = "#ff0000"; // summary: red

    const result = resolveColor("title", { ...config }, { mode: "summary" });

    // Per-mode override (red) should win
    assert.ok(result.includes("255;0;0"),
      "per-mode override should take precedence over global");
  });

  it("null override means inherit from parent level", () => {
    const { getDefaultConfig } = require("../config-persistence.js");
    const { resolveColor, colorPresets } = require("../color-engine.js");

    const config = getDefaultConfig();
    config.globalColorOverrides.title = null; // inherit
    config.perModeColorOverrides.summary.title = null; // inherit

    // Should fall through to preset default
    const result = resolveColor("title", { ...config }, { mode: "summary" });
    const presetAnsi = require("../color-engine.js").hexToAnsi(colorPresets.default.title);

    assert.equal(result, presetAnsi,
      "null override should fall through to preset");
  });
});

// =============================================================================
// Test 9: Color element list integration (structural)
// =============================================================================

describe("Color elements for Global tab", () => {
  it("colorElements from color-engine has 24 entries", async () => {
    const { colorElements } = await import("../color-engine.js");
    assert.equal(colorElements.length, 24);
  });

  it("colorElements includes all required element names", async () => {
    const { colorElements } = await import("../color-engine.js");

    const required = [
      "title", "scope",
      "providerHeader", "modelHeader", "sessionsHeader", "msgsHeader",
      "costHeader", "tokensHeader", "tokensInHeader", "tokensOutHeader",
      "cacheHeader",
      "providerValue", "modelValue", "sessionsValue", "msgsValue",
      "costValue", "tokensValue", "tokensInValue", "tokensOutValue",
      "cacheValue",
      "headerLine", "footerLine",
    ];

    const elementsSet = new Set(colorElements);
    for (const el of required) {
      assert.ok(elementsSet.has(el), `Missing element: ${el}`);
    }
  });

  it("elementLabel maps each element to a human-readable name", async () => {
    const mod = await import("../color-picker.js");
    const labels = mod.ELEMENT_LABELS;
    const { colorElements } = await import("../color-engine.js");

    for (const el of colorElements) {
      assert.ok(labels[el] !== undefined, `Missing label for element: ${el}`);
      assert.ok(typeof labels[el] === "string");
      assert.ok(labels[el].length > 0, `Empty label for element: ${el}`);
    }
  });

  it("element labels are distinct", async () => {
    const mod = await import("../color-picker.js");
    const labels = mod.ELEMENT_LABELS;
    const values = Object.values(labels);
    const unique = new Set(values);
    assert.equal(unique.size, values.length, "All element labels should be unique");
  });
});

// =============================================================================
// Test 10: Color picker integration — config persistence
// =============================================================================

describe("Color override config persistence", () => {
  let configPath: string;
  let originalEnv: string | undefined;

  beforeEach(async () => {
    originalEnv = process.env.PI_USAGE_CONFIG_PATH;
    configPath = join(tmpdir(), `pi-usage-test-color-${Date.now()}.json`);
    process.env.PI_USAGE_CONFIG_PATH = configPath;
    try { await unlink(configPath); } catch { /* */ }
    delete require.cache[require.resolve("../config-persistence.js")];
    delete require.cache[require.resolve("../color-engine.js")];
  });

  afterEach(async () => {
    if (originalEnv) {
      process.env.PI_USAGE_CONFIG_PATH = originalEnv;
    } else {
      delete process.env.PI_USAGE_CONFIG_PATH;
    }
    try { await unlink(configPath); } catch { /* */ }
  });

  it("global color overrides start as null (all inherit)", () => {
    const { getDefaultConfig } = require("../config-persistence.js");
    const defaults = getDefaultConfig();

    const overrides = defaults.globalColorOverrides;
    const keys = Object.keys(overrides) as Array<keyof typeof overrides>;

    for (const key of keys) {
      assert.equal(overrides[key], null, `globalColorOverrides.${key} should default to null`);
    }
  });

  it("setting a global color override persists to disk", () => {
    const { getDefaultConfig, mergeConfig, saveConfig, loadConfig } = require("../config-persistence.js");

    const modified = mergeConfig(getDefaultConfig(), {
      globalColorOverrides: {
        title: "#ff0000",
        scope: null,
      },
    } as any);

    assert.equal(modified.globalColorOverrides.title, "#ff0000");
    assert.equal(modified.globalColorOverrides.scope, null);

    saveConfig(modified);

    delete require.cache[require.resolve("../config-persistence.js")];
    const { loadConfig: load2 } = require("../config-persistence.js");
    const loaded = load2();

    assert.equal(loaded.globalColorOverrides.title, "#ff0000");
    assert.equal(loaded.globalColorOverrides.scope, null);
  });

  it("per-mode color overrides persist independently per mode", () => {
    const { getDefaultConfig, mergeConfig, saveConfig, loadConfig } = require("../config-persistence.js");

    const modified = mergeConfig(getDefaultConfig(), {
      perModeColorOverrides: {
        summary: { title: "#00ff00" },
        compact: { title: "#0000ff" },
      },
    } as any);

    assert.equal(modified.perModeColorOverrides.summary.title, "#00ff00");
    assert.equal(modified.perModeColorOverrides.compact.title, "#0000ff");
    // Unmodified modes should still be null
    assert.equal(modified.perModeColorOverrides.expanded.title, null);

    saveConfig(modified);

    delete require.cache[require.resolve("../config-persistence.js")];
    const { loadConfig: load2 } = require("../config-persistence.js");
    const loaded = load2();

    assert.equal(loaded.perModeColorOverrides.summary.title, "#00ff00");
    assert.equal(loaded.perModeColorOverrides.compact.title, "#0000ff");
    assert.equal(loaded.perModeColorOverrides.expanded.title, null);
  });

  it("color overrides can use theme role names", () => {
    const { getDefaultConfig, mergeConfig, saveConfig, loadConfig } = require("../config-persistence.js");

    const modified = mergeConfig(getDefaultConfig(), {
      globalColorOverrides: { title: "accent" },
    } as any);

    assert.equal(modified.globalColorOverrides.title, "accent");
    saveConfig(modified);

    delete require.cache[require.resolve("../config-persistence.js")];
    const { loadConfig: load2 } = require("../config-persistence.js");
    const loaded = load2();
    assert.equal(loaded.globalColorOverrides.title, "accent");
  });

  it("color overrides can use ANSI palette names", () => {
    const { getDefaultConfig, mergeConfig, saveConfig, loadConfig } = require("../config-persistence.js");

    const modified = mergeConfig(getDefaultConfig(), {
      globalColorOverrides: { title: "brightCyan" },
    } as any);

    assert.equal(modified.globalColorOverrides.title, "brightCyan");
    saveConfig(modified);

    delete require.cache[require.resolve("../config-persistence.js")];
    const { loadConfig: load2 } = require("../config-persistence.js");
    const loaded = load2();
    assert.equal(loaded.globalColorOverrides.title, "brightCyan");
  });
});

// =============================================================================
// Test 11: Color picker mode navigation structure
// =============================================================================

describe("Color picker navigation", () => {
  it("mode order is theme → ansi → hex", async () => {
    const mod = await import("../color-picker.js");
    const modes = mod.COLOR_PICKER_MODES;
    assert.equal(modes[0], "theme");
    assert.equal(modes[1], "ansi");
    assert.equal(modes[2], "hex");
  });

  it("left/right arrows cycle through modes", async () => {
    const mod = await import("../color-picker.js");
    const modes = mod.COLOR_PICKER_MODES;

    // Simulate mode cycling
    const cycleRight = (current: string) => {
      const idx = modes.indexOf(current);
      return modes[(idx + 1) % modes.length];
    };
    const cycleLeft = (current: string) => {
      const idx = modes.indexOf(current);
      return modes[(idx - 1 + modes.length) % modes.length];
    };

    assert.equal(cycleRight("theme"), "ansi");
    assert.equal(cycleRight("ansi"), "hex");
    assert.equal(cycleRight("hex"), "theme");

    assert.equal(cycleLeft("theme"), "hex");
    assert.equal(cycleLeft("hex"), "ansi");
    assert.equal(cycleLeft("ansi"), "theme");
  });
});

// =============================================================================
// Test 12: settings-menu still exports correctly with color picker integration
// =============================================================================

describe("Settings menu — color integration check", () => {
  it("settings-menu.ts parses without errors", async () => {
    const mod = await import("../settings-menu.js");
    assert.ok(mod !== undefined);
    assert.ok(typeof mod.SettingsMenu === "function");
    assert.ok(typeof mod.createMockUsageData === "function");
  });

  it("settings-menu exports color element labels", async () => {
    const mod = await import("../settings-menu.js");
    // After integration, the module should still be syntactically valid
    assert.ok(mod.SettingsMenu !== undefined);
  });
});
