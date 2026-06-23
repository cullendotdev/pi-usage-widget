import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { unlink, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// We'll test config-persistence by mocking the config path.
// The module reads from ~/.pi/agent/pi-usage-widget-settings.json.
// For tests, we use a temp file and override the path via env.

// NOTE: config-persistence.ts should respect PI_USAGE_CONFIG_PATH env var for testing,
// falling back to ~/.pi/agent/pi-usage-widget-settings.json in production.

// For now, let's test the default config generation and merge logic directly,
// which are the core behaviors we care about.

import {
  getDefaultConfig,
  mergeConfig,
  type UsageWidgetConfig,
} from "../config-persistence.js";

const defaultConfig: UsageWidgetConfig = getDefaultConfig();

// =============================================================================
// Default configuration
// =============================================================================

describe("getDefaultConfig", () => {
  it("returns a config with expected top-level keys", () => {
    assert.ok(typeof defaultConfig.defaultMode === "string");
    assert.ok(typeof defaultConfig.defaultScope === "string");
    assert.ok(typeof defaultConfig.themedPreset === "string");
    assert.ok(defaultConfig.placement !== undefined);
    assert.ok(defaultConfig.modes !== undefined);
  });

  it("defaultMode is 'summary'", () => {
    assert.equal(defaultConfig.defaultMode, "summary");
  });

  it("defaultScope is 'today'", () => {
    assert.equal(defaultConfig.defaultScope, "today");
  });

  it("themedPreset is 'default'", () => {
    assert.equal(defaultConfig.themedPreset, "default");
  });

  it("placement defaults to footer", () => {
    assert.equal(defaultConfig.placement.mode, "footer");
    assert.equal(defaultConfig.placement.paddingX, 0);
    assert.equal(defaultConfig.placement.paddingY, 0);
  });

  it("has all five display modes configured", () => {
    const modes = [
      "summary",
      "compact",
      "Per Model",
      "expanded",
      "hidden",
    ] as const;
    for (const mode of modes) {
      assert.ok(
        defaultConfig.modes[mode] !== undefined,
        `Mode '${mode}' should exist`,
      );
    }
  });

  it("summary mode has showTotals false (summary has no totals row)", () => {
    assert.equal(defaultConfig.modes.summary.showTotals, false);
  });

  it("compact, per-model, and expanded modes have showTotals true", () => {
    assert.equal(defaultConfig.modes.compact.showTotals, true);
    assert.equal(defaultConfig.modes["Per Model"].showTotals, true);
    assert.equal(defaultConfig.modes.expanded.showTotals, true);
  });

  it("headerLine defaults to visible with thin dash", () => {
    assert.equal(defaultConfig.headerLine.show, true);
    assert.equal(defaultConfig.headerLine.character, "─");
    assert.equal(defaultConfig.headerLine.color, null);
  });

  it("footerLine defaults to visible with thin dash", () => {
    assert.equal(defaultConfig.footerLine.show, true);
    assert.equal(defaultConfig.footerLine.character, "─");
    assert.equal(defaultConfig.footerLine.color, null);
  });

  it("per-mode color overrides have all null entries for each mode", () => {
    for (const mode of [
      "summary",
      "compact",
      "Per Model",
      "expanded",
      "hidden",
    ] as const) {
      const overrides = defaultConfig.perModeColorOverrides[mode];
      assert.ok(overrides !== undefined, `Mode '${mode}' overrides missing`);
      assert.equal(overrides.title, null);
      assert.equal(overrides.scope, null);
      assert.equal(overrides.providerHeader, null);
      assert.equal(overrides.modelHeader, null);
    }
  });
});

// =============================================================================
// mergeConfig
// =============================================================================

describe("mergeConfig", () => {
  it("returns default config when partial is empty", () => {
    const result = mergeConfig(defaultConfig, {});
    assert.deepEqual(result, defaultConfig);
  });

  it("overrides a top-level value while keeping other defaults", () => {
    const result = mergeConfig(defaultConfig, { defaultMode: "expanded" });
    assert.equal(result.defaultMode, "expanded");
    assert.equal(result.defaultScope, defaultConfig.defaultScope);
    assert.equal(result.themedPreset, defaultConfig.themedPreset);
  });

  it("overrides themedPreset", () => {
    const result = mergeConfig(defaultConfig, { themedPreset: "dracula" });
    assert.equal(result.themedPreset, "dracula");
  });

  it("deep merges placement config", () => {
    const result = mergeConfig(defaultConfig, {
      placement: { mode: "header", paddingX: 5, paddingY: 0 },
    });
    assert.equal(result.placement.mode, "header");
    assert.equal(result.placement.paddingX, 5);
    assert.equal(result.placement.paddingY, 0); // kept default
  });

  it("deep merges mode column configs", () => {
    const result = mergeConfig(defaultConfig, {
      modes: {
        compact: { showTotals: false },
      },
    });
    assert.equal(result.modes.compact.showTotals, false);
    // Other compact columns should keep defaults
    assert.equal(result.modes.compact.sessions, true);
    assert.equal(result.modes.compact.cost, true);
    // Other modes unaffected
    assert.equal(result.modes.summary.showTotals, false);
  });

  it("deep merges per-mode color overrides", () => {
    const result = mergeConfig(defaultConfig, {
      perModeColorOverrides: {
        summary: { title: "#00ff00", scope: null },
      },
    });
    assert.equal(result.perModeColorOverrides.summary.title, "#00ff00");
    assert.equal(result.perModeColorOverrides.summary.scope, null);
    assert.equal(result.perModeColorOverrides.compact.title, null);
  });

  it("deep merges headerLine config", () => {
    const result = mergeConfig(defaultConfig, {
      headerLine: { show: false },
    });
    assert.equal(result.headerLine.show, false);
    assert.equal(
      result.headerLine.character,
      defaultConfig.headerLine.character,
    );
    assert.equal(result.headerLine.color, defaultConfig.headerLine.color);
  });

  it("handles undefined values by using defaults", () => {
    const result = mergeConfig(defaultConfig, {
      defaultMode: undefined,
    } as unknown as Partial<UsageWidgetConfig>);
    assert.equal(result.defaultMode, defaultConfig.defaultMode);
  });

  it("handles null values by using defaults", () => {
    const result = mergeConfig(defaultConfig, {
      defaultMode: null,
    } as unknown as Partial<UsageWidgetConfig>);
    assert.equal(result.defaultMode, defaultConfig.defaultMode);
  });
});

// =============================================================================
// loadConfig / saveConfig integration (uses temp file)
// =============================================================================

let tempConfigPath: string;

beforeEach(async () => {
  // Create a unique temp path per test
  const testDir = join(
    tmpdir(),
    `pi-usage-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(testDir, { recursive: true });
  tempConfigPath = join(testDir, "pi-usage-widget-settings.json");
  process.env.PI_USAGE_CONFIG_PATH = tempConfigPath;
});

afterEach(async () => {
  delete process.env.PI_USAGE_CONFIG_PATH;
  try {
    await unlink(tempConfigPath);
  } catch {
    /* ok */
  }
});

// We need to import loadConfig/saveConfig after setting the env var
// since they may read the env at import time. We'll use dynamic import.

async function reloadPersistence() {
  // Clear module cache to pick up new env var
  const mod = await import("../config-persistence.js?" + Math.random());
  return mod;
}

describe("loadConfig", () => {
  it("returns default config when no file exists", async () => {
    const { loadConfig } = await reloadPersistence();
    const config = loadConfig();
    assert.equal(config.defaultMode, "summary");
    assert.equal(config.defaultScope, "today");
  });

  it("loads a partial config from file and merges with defaults", async () => {
    await writeFile(
      tempConfigPath,
      JSON.stringify({ defaultMode: "expanded" }),
    );
    const { loadConfig } = await reloadPersistence();
    const config = loadConfig();
    assert.equal(config.defaultMode, "expanded");
    assert.equal(config.defaultScope, "today"); // from defaults
  });

  it("loads a full config from file", async () => {
    const saved: UsageWidgetConfig = {
      ...defaultConfig,
      defaultMode: "compact",
      defaultScope: "thisWeek",
      themedPreset: "nord",
    };
    await writeFile(tempConfigPath, JSON.stringify(saved));
    const { loadConfig } = await reloadPersistence();
    const config = loadConfig();
    assert.equal(config.defaultMode, "compact");
    assert.equal(config.defaultScope, "thisWeek");
    assert.equal(config.themedPreset, "nord");
  });

  it("handles invalid JSON gracefully — falls back to defaults", async () => {
    await writeFile(tempConfigPath, "not valid json {{{");
    const { loadConfig } = await reloadPersistence();
    const config = loadConfig();
    // Should not crash and should return default config
    assert.equal(config.defaultMode, "summary");
  });

  it("handles empty file gracefully", async () => {
    await writeFile(tempConfigPath, "");
    const { loadConfig } = await reloadPersistence();
    const config = loadConfig();
    assert.equal(config.defaultMode, "summary");
  });

  it("handles non-object JSON (e.g., array) gracefully", async () => {
    await writeFile(tempConfigPath, "[1, 2, 3]");
    const { loadConfig } = await reloadPersistence();
    const config = loadConfig();
    assert.equal(config.defaultMode, "summary");
  });
});

describe("saveConfig", () => {
  it("writes config to disk as valid JSON", async () => {
    const { saveConfig, loadConfig } = await reloadPersistence();
    const configToSave: UsageWidgetConfig = {
      ...defaultConfig,
      defaultMode: "expanded",
      themedPreset: "catppuccin",
    };
    saveConfig(configToSave);

    // Load back and verify
    const loaded = loadConfig();
    assert.equal(loaded.defaultMode, "expanded");
    assert.equal(loaded.themedPreset, "catppuccin");
    assert.equal(loaded.defaultScope, "today"); // unchanged
  });

  it("can save and load full per-mode configuration", async () => {
    const { saveConfig, loadConfig } = await reloadPersistence();
    const configToSave: UsageWidgetConfig = {
      ...defaultConfig,
      modes: {
        ...defaultConfig.modes,
        compact: {
          ...defaultConfig.modes.compact,
          sessions: false,
          msgs: false,
          showTotals: false,
        },
        "Per Model": {
          ...defaultConfig.modes["Per Model"],
          provider: true,
          model: true,
          cost: true,
          tokens: false,
        },
      },
    };
    saveConfig(configToSave);

    const loaded = loadConfig();
    assert.equal(loaded.modes.compact.sessions, false);
    assert.equal(loaded.modes.compact.msgs, false);
    assert.equal(loaded.modes.compact.showTotals, false);
    assert.equal(loaded.modes["Per Model"].tokens, false);
    assert.equal(loaded.modes["Per Model"].cost, true);
  });
});
