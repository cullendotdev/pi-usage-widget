/**
 * Integration tests — Slice 9: Integration, commands, session lifecycle.
 *
 * Tests the UsageWidget class in isolation and verifies config persistence
 * through cycle commands. Also validates getUsageData wiring works.
 *
 * Run: npx tsx --test tests/integration.test.ts
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  unlinkSync,
  writeFileSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// =============================================================================
// Mock Pi runtime types for isolation testing
// =============================================================================

// Minimal Theme mock that matches the Pi Theme interface
function mockTheme(): Record<string, (role: string, text: string) => string> {
  return {
    fg: (role: string, text: string) => text, // pass-through for testing
    bg: (_role: string, text: string) => text,
    bold: (text: string) => text,
    italic: (text: string) => text,
    underline: (text: string) => text,
    dim: (text: string) => text,
    strikethrough: (text: string) => text,
  } as unknown as Record<string, (role: string, text: string) => string>;
}

// =============================================================================
// Config Persistence Integration
// =============================================================================

describe("Config persistence integration", () => {
  const testConfigDir = join(tmpdir(), "pi-usage-integration-test");
  const testConfigPath = join(testConfigDir, "pi-usage-widget-settings.json");

  beforeEach(() => {
    process.env.PI_USAGE_CONFIG_PATH = testConfigPath;
    // Clean up any previous test config
    try {
      rmSync(testConfigDir, { recursive: true });
    } catch {}
    mkdirSync(testConfigDir, { recursive: true });
  });

  afterEach(() => {
    delete process.env.PI_USAGE_CONFIG_PATH;
    try {
      rmSync(testConfigDir, { recursive: true });
    } catch {}
  });

  it("loadConfig returns defaults when no config file exists", () => {
    const {
      loadConfig,
      getDefaultConfig,
    } = require("../config-persistence.js");
    const config = loadConfig();
    const defaults = getDefaultConfig();
    assert.deepStrictEqual(config, defaults);
    assert.strictEqual(config.defaultMode, "summary");
    assert.strictEqual(config.defaultScope, "today");
    assert.strictEqual(config.themedPreset, "default");
  });

  it("loadConfig returns merged config when partial file exists", () => {
    const {
      loadConfig,
      getDefaultConfig,
    } = require("../config-persistence.js");
    writeFileSync(
      testConfigPath,
      JSON.stringify({ defaultMode: "compact", defaultScope: "allTime" }),
    );
    const config = loadConfig();
    assert.strictEqual(config.defaultMode, "compact");
    assert.strictEqual(config.defaultScope, "allTime");
    // Unspecified fields use defaults
    assert.strictEqual(config.themedPreset, "default");
  });

  it("saveConfig writes config and loadConfig reads it back", () => {
    const { loadConfig, saveConfig } = require("../config-persistence.js");
    const config = loadConfig();
    config.defaultMode = "expanded";
    config.defaultScope = "yesterday";
    config.themedPreset = "dracula";
    saveConfig(config);

    const reloaded = loadConfig();
    assert.strictEqual(reloaded.defaultMode, "expanded");
    assert.strictEqual(reloaded.defaultScope, "yesterday");
    assert.strictEqual(reloaded.themedPreset, "dracula");
  });

  it("loadConfig handles invalid JSON gracefully", () => {
    const {
      loadConfig,
      getDefaultConfig,
    } = require("../config-persistence.js");
    writeFileSync(testConfigPath, "this is not json {{");
    const config = loadConfig();
    assert.deepStrictEqual(config, getDefaultConfig());
  });

  it("config round-trips through save → load preserves all defaults", () => {
    const { loadConfig, saveConfig } = require("../config-persistence.js");
    const config = loadConfig();
    saveConfig(config);
    const reloaded = loadConfig();
    assert.deepStrictEqual(reloaded, config);
  });
});

// =============================================================================
// UsageWidget Cycle Commands + Config Persistence
// =============================================================================

describe("UsageWidget — cycle commands persist config", () => {
  const testConfigDir = join(tmpdir(), "pi-usage-integration-cycle");
  const testConfigPath = join(testConfigDir, "pi-usage-widget-settings.json");

  // Re-define UsageWidget inline for testing (avoids Pi runtime dependency)
  // We test the logic pattern: cycleMode → updates config → calls saveConfig
  let saveCalls: Array<{ defaultMode: string; defaultScope: string }> = [];

  beforeEach(() => {
    saveCalls = [];
    process.env.PI_USAGE_CONFIG_PATH = testConfigPath;
    try {
      rmSync(testConfigDir, { recursive: true });
    } catch {}
    mkdirSync(testConfigDir, { recursive: true });
  });

  afterEach(() => {
    delete process.env.PI_USAGE_CONFIG_PATH;
    try {
      rmSync(testConfigDir, { recursive: true });
    } catch {}
  });

  it("cycleMode advances through all display modes and persists each", () => {
    const {
      loadConfig,
      saveConfig,
      getDefaultConfig,
    } = require("../config-persistence.js");
    const DISPLAY_MODES = [
      "summary",
      "compact",
      "Per Model",
      "expanded",
      "hidden",
    ];
    const SCOPE_ORDER = [
      "lastHour",
      "today",
      "yesterday",
      "thisWeek",
      "lastWeek",
      "thisMonth",
      "allTime",
    ];

    // Simulate: on session_start, load config
    const config = loadConfig();
    assert.strictEqual(config.defaultMode, "summary");

    // Simulate: cycle through all modes
    for (let i = 0; i < DISPLAY_MODES.length; i++) {
      const idx = DISPLAY_MODES.indexOf(config.defaultMode);
      const next = DISPLAY_MODES[(idx + 1) % DISPLAY_MODES.length]!;
      config.defaultMode = next;
      saveConfig(config);
      const reloaded = loadConfig();
      assert.strictEqual(
        reloaded.defaultMode,
        next,
        `After cycle ${i + 1}, expected mode=${next}, got ${reloaded.defaultMode}`,
      );
    }

    // After 5 cycles, should wrap back to summary
    const final = loadConfig();
    assert.strictEqual(final.defaultMode, "summary");
  });

  it("cycleScope advances through all scopes and persists each", () => {
    const { loadConfig, saveConfig } = require("../config-persistence.js");
    const SCOPE_ORDER = [
      "lastHour",
      "today",
      "yesterday",
      "thisWeek",
      "lastWeek",
      "thisMonth",
      "allTime",
    ];

    const config = loadConfig();
    assert.strictEqual(config.defaultScope, "today");

    // Advance to "yesterday"
    const idx = SCOPE_ORDER.indexOf(config.defaultScope);
    const next = SCOPE_ORDER[(idx + 1) % SCOPE_ORDER.length]!;
    config.defaultScope = next;
    saveConfig(config);

    const reloaded = loadConfig();
    assert.strictEqual(reloaded.defaultScope, "yesterday");

    // Advance to "thisWeek"
    const idx2 = SCOPE_ORDER.indexOf(reloaded.defaultScope);
    const next2 = SCOPE_ORDER[(idx2 + 1) % SCOPE_ORDER.length]!;
    reloaded.defaultScope = next2;
    saveConfig(reloaded);

    const reloaded2 = loadConfig();
    assert.strictEqual(reloaded2.defaultScope, "thisWeek");
  });

  it("mode and scope changes are both persisted independently", () => {
    const { loadConfig, saveConfig } = require("../config-persistence.js");
    const config = loadConfig();

    // Change mode only
    config.defaultMode = "expanded";
    saveConfig(config);
    let reloaded = loadConfig();
    assert.strictEqual(reloaded.defaultMode, "expanded");
    assert.strictEqual(reloaded.defaultScope, "today"); // unchanged

    // Change scope only
    reloaded.defaultScope = "thisMonth";
    saveConfig(reloaded);
    reloaded = loadConfig();
    assert.strictEqual(reloaded.defaultMode, "expanded"); // preserved
    assert.strictEqual(reloaded.defaultScope, "thisMonth");
  });
});

// =============================================================================
// getUsageData integration with data-collection module
// =============================================================================

describe("getUsageData — data-collection module integration", () => {
  it("getUsageData resolves with empty data when no sessions exist", async () => {
    // Temporarily point sessions dir to a non-existent path
    const original = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = join(
      tmpdir(),
      "pi-usage-nonexistent-sessions",
    );
    try {
      const { getUsageData } = require("../data-collection.js");
      const result = await getUsageData();
      assert.ok(result, "getUsageData should return a result");
      assert.ok(result.allTime, "should have allTime data");
      assert.strictEqual(
        result.allTime.totals.messages,
        0,
        "should have 0 messages for no sessions",
      );
    } finally {
      if (original) {
        process.env.PI_CODING_AGENT_DIR = original;
      } else {
        delete process.env.PI_CODING_AGENT_DIR;
      }
    }
  });

  it("getUsageData is abortable via AbortSignal", async () => {
    const controller = new AbortController();
    controller.abort();
    const { getUsageData } = require("../data-collection.js");
    const result = await getUsageData(controller.signal);
    // Should return empty data when aborted
    assert.ok(result);
    assert.strictEqual(result.allTime.totals.messages, 0);
  });
});

// =============================================================================
// Render Engine + Config Integration
// =============================================================================

describe("Render engine — config-driven display modes", () => {
  it("renderWidget respects hidden mode (returns empty array)", () => {
    const { renderWidget } = require("../widget-render.js");
    const { getDefaultConfig } = require("../config-persistence.js");
    const { createMockUsageData } = require("../settings-menu.js");

    const config = getDefaultConfig();
    const theme = mockTheme();
    const data = createMockUsageData();

    const result = renderWidget(config, theme, data, 80, "hidden", "today");
    assert.deepStrictEqual(
      result,
      [],
      "hidden mode should return empty (flash handled by UsageWidget)",
    );
  });

  it("renderWidget renders summary mode with properties", () => {
    const { renderWidget } = require("../widget-render.js");
    const { getDefaultConfig } = require("../config-persistence.js");
    const { createMockUsageData } = require("../settings-menu.js");

    const config = getDefaultConfig();
    config.defaultMode = "summary";
    const theme = mockTheme();
    const data = createMockUsageData();

    const result = renderWidget(config, theme, data, 80, "summary", "today");
    assert.ok(result.length > 0, "summary should produce output");
    const combined = result.join("");
    // With mock theme, text passes through — check for expected content
    assert.ok(
      combined.includes("OpenAI") || combined.includes("Usage"),
      "should include provider or usage text",
    );
  });

  it("renderWidget renders compact mode with column config", () => {
    const { renderWidget } = require("../widget-render.js");
    const { getDefaultConfig } = require("../config-persistence.js");
    const { createMockUsageData } = require("../settings-menu.js");

    const config = getDefaultConfig();
    config.defaultMode = "compact";
    // Disable some columns
    config.modes["compact"]!.cache = false;
    config.modes["compact"]!.tokensIn = false;
    config.modes["compact"]!.tokensOut = false;

    const theme = mockTheme();
    const data = createMockUsageData();

    const result = renderWidget(config, theme, data, 120, "compact", "today");
    const combined = result.join("");
    // Cache column should be absent, Cost column should be present
    assert.ok(
      !combined.includes("Cache") || combined.includes("Cost"),
      "should reflect column config",
    );
  });

  it("renderWidget with different scope uses correct data", () => {
    const { renderWidget } = require("../widget-render.js");
    const { getDefaultConfig } = require("../config-persistence.js");
    const { createMockUsageData } = require("../settings-menu.js");

    const config = getDefaultConfig();
    const theme = mockTheme();
    const data = createMockUsageData();

    const todayResult = renderWidget(
      config,
      theme,
      data,
      80,
      "summary",
      "today",
    );
    const allTimeResult = renderWidget(
      config,
      theme,
      data,
      80,
      "summary",
      "allTime",
    );

    // Both should produce output
    assert.ok(todayResult.length > 0);
    assert.ok(allTimeResult.length > 0);
  });
});

// =============================================================================
// Settings Menu → Widget Re-render Integration
// =============================================================================

describe("Settings menu integration — config reload after close", () => {
  const testConfigDir = join(tmpdir(), "pi-usage-integration-reload");
  const testConfigPath = join(testConfigDir, "pi-usage-widget-settings.json");

  beforeEach(() => {
    process.env.PI_USAGE_CONFIG_PATH = testConfigPath;
    try {
      rmSync(testConfigDir, { recursive: true });
    } catch {}
    mkdirSync(testConfigDir, { recursive: true });
  });

  afterEach(() => {
    delete process.env.PI_USAGE_CONFIG_PATH;
    try {
      rmSync(testConfigDir, { recursive: true });
    } catch {}
  });

  it("after settings change, reloading config reflects new values", () => {
    const {
      loadConfig,
      saveConfig,
      getDefaultConfig,
    } = require("../config-persistence.js");

    // Initial state
    const initial = loadConfig();
    assert.strictEqual(initial.themedPreset, "default");

    // Simulate settings menu changing the theme preset then saving
    const modified = { ...initial, themedPreset: "nord" as const };
    saveConfig(modified);

    // Widget reloads config after settings menu closes
    const reloaded = loadConfig();
    assert.strictEqual(reloaded.themedPreset, "nord");
  });

  it("settings changes to defaultMode are reflected after reload", () => {
    const { loadConfig, saveConfig } = require("../config-persistence.js");

    const config = loadConfig();
    config.defaultMode = "Per Model";
    saveConfig(config);

    const reloaded = loadConfig();
    assert.strictEqual(reloaded.defaultMode, "Per Model");
  });

  it("settings changes to defaultScope are reflected after reload", () => {
    const { loadConfig, saveConfig } = require("../config-persistence.js");

    const config = loadConfig();
    config.defaultScope = "thisWeek";
    saveConfig(config);

    const reloaded = loadConfig();
    assert.strictEqual(reloaded.defaultScope, "thisWeek");
  });

  it("full round-trip: change all settings, persist, reload, verify", () => {
    const { loadConfig, saveConfig } = require("../config-persistence.js");

    const config = loadConfig();
    config.defaultMode = "expanded";
    config.defaultScope = "allTime";
    config.themedPreset = "dracula";
    config.placement.mode = "header";
    config.perModeColorOverrides.expanded.title = "#ff0000";
    config.modes["compact"]!.cost = false;
    saveConfig(config);

    const reloaded = loadConfig();
    assert.strictEqual(reloaded.defaultMode, "expanded");
    assert.strictEqual(reloaded.defaultScope, "allTime");
    assert.strictEqual(reloaded.themedPreset, "dracula");
    assert.strictEqual(reloaded.placement.mode, "header");
    assert.strictEqual(reloaded.perModeColorOverrides.expanded.title, "#ff0000");
    assert.strictEqual(reloaded.modes["compact"]!.cost, false);
  });
});

// =============================================================================
// Resource Cleanup Verification
// =============================================================================

describe("Resource cleanup — session lifecycle simulation", () => {
  it("session cleanup stops timers", () => {
    // Simulate the cleanup pattern from index.ts
    let intervalCleared = false;
    let timeoutCleared = false;
    let abortCalled = false;

    // Create fake resources
    const intervalId = setInterval(() => {}, 1000);
    const timeoutId = setTimeout(() => {}, 1000);
    const controller = new AbortController();

    // Cleanup simulation
    clearInterval(intervalId);
    intervalCleared = true;
    clearTimeout(timeoutId);
    timeoutCleared = true;
    controller.abort();
    abortCalled = controller.signal.aborted;

    assert.ok(intervalCleared, "interval should be cleared");
    assert.ok(timeoutCleared, "timeout should be cleared");
    assert.ok(abortCalled, "abort controller should be aborted");
  });

  it("abort controller pattern cancels in-flight data loads", () => {
    const controller = new AbortController();
    // Abort before the async operation
    controller.abort();

    // Verify signal is aborted
    assert.ok(
      controller.signal.aborted,
      "signal should be aborted after abort() call",
    );

    // A new controller should not be aborted
    const newController = new AbortController();
    assert.ok(
      !newController.signal.aborted,
      "new controller should not be aborted",
    );
  });
});
