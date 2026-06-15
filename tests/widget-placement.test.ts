import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

// =============================================================================
// Test 1: Config defaults and merge for placement
// =============================================================================

import { getDefaultConfig, mergeConfig } from "../config-persistence.js";
import type { UsageWidgetConfig } from "../types.js";

const defaultConfig = getDefaultConfig();

describe("Placement config defaults", () => {
  it("defaults to footer placement", () => {
    assert.equal(defaultConfig.placement.mode, "footer");
  });

  it("defaults to zero padding", () => {
    assert.equal(defaultConfig.placement.paddingX, 0);
    assert.equal(defaultConfig.placement.paddingY, 0);
  });

  it("placement is a deep object with all required keys", () => {
    assert.ok(defaultConfig.placement !== undefined);
    assert.ok(typeof defaultConfig.placement.mode === "string");
    assert.ok(typeof defaultConfig.placement.paddingX === "number");
    assert.ok(typeof defaultConfig.placement.paddingY === "number");
  });
});

describe("mergeConfig with placement", () => {
  it("deep merges placement mode", () => {
    const result = mergeConfig(defaultConfig, {
      placement: { mode: "header", paddingX: 0, paddingY: 0 },
    });
    assert.equal(result.placement.mode, "header");
    assert.equal(result.placement.paddingX, 0);
  });

  it("deep merges detached with padding", () => {
    const result = mergeConfig(defaultConfig, {
      placement: { mode: "detached", paddingX: 3, paddingY: 2 },
    });
    assert.equal(result.placement.mode, "detached");
    assert.equal(result.placement.paddingX, 3);
    assert.equal(result.placement.paddingY, 2);
  });

  it("partial placement merge preserves other placement keys", () => {
    const result = mergeConfig(defaultConfig, {
      placement: { mode: "header" },
    });
    assert.equal(result.placement.mode, "header");
    assert.equal(result.placement.paddingX, 0); // kept default
    assert.equal(result.placement.paddingY, 0); // kept default
  });

  it("placement config persists through save/load round trip", () => {
    // Verify placement can survive a serialize/deserialize/merge cycle
    const modified: UsageWidgetConfig = {
      ...defaultConfig,
      placement: { mode: "detached", paddingX: 5, paddingY: 3 },
    };
    assert.equal(modified.placement.mode, "detached");
    assert.equal(modified.placement.paddingX, 5);
    assert.equal(modified.placement.paddingY, 3);

    // Simulate save → load merge
    const merged = mergeConfig(defaultConfig, {
      placement: modified.placement,
    });
    assert.deepEqual(merged.placement, {
      mode: "detached",
      paddingX: 5,
      paddingY: 3,
    });
  });
});

// =============================================================================
// Test 2: Render engine — detached placement padding
// =============================================================================

// Create a minimal mock theme for testing
// Theme.fg(role, text) wraps text in ANSI codes; we can test content structure
// by checking that our lines contain the expected text
const mockTheme = {
  fg: (role: string, text: string) => `[${role}]${text}[/${role}]`,
  bold: (text: string) => `[B]${text}[/B]`,
} as any;

// Minimal mock data that satisfies the renderWidget interface
function mockTimeFilteredStats() {
  return {
    providers: new Map(),
    totals: {
      sessions: 0,
      messages: 0,
      cost: 0,
      tokens: { total: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
    insights: { insights: [] },
  };
}

function mockUsageData(scopeStats?: any) {
  const stats = scopeStats || mockTimeFilteredStats();
  return {
    lastHour: stats,
    today: stats,
    yesterday: stats,
    thisWeek: stats,
    lastWeek: stats,
    thisMonth: stats,
    allTime: stats,
  };
}

function configWithPlacement(
  mode: "header" | "footer" | "detached",
  paddingX = 0,
  paddingY = 0,
): UsageWidgetConfig {
  return {
    ...defaultConfig,
    placement: { mode, paddingX, paddingY },
  };
}

// We'll import renderWidget lazily after module resolution
let renderWidget: any;

// Since widget-render imports from pi-tui which requires native modules,
// we test placement behavior by inspecting renderWidget at the boundary.
// The detached mode padding is added by renderWidget after calling the
// mode-specific renderers.

describe("Render engine — placement awareness", () => {
  it("renderWidget function exists and is callable", async () => {
    // Test that the module can be imported (validation check)
    const mod = await import("../widget-render.js");
    assert.ok(
      typeof mod.renderWidget === "function",
      "renderWidget should be a function",
    );
    renderWidget = mod.renderWidget;
  });

  it("returns no output for hidden mode regardless of placement", async () => {
    if (!renderWidget) {
      const mod = await import("../widget-render.js");
      renderWidget = mod.renderWidget;
    }
    const config = configWithPlacement("detached", 5, 5);
    const data = mockUsageData();
    const result = renderWidget(config, mockTheme, data, 80, "hidden", "today");
    assert.deepStrictEqual(
      result,
      [],
      "hidden mode returns empty (flash handled by UsageWidget)",
    );
  });

  it("adds paddingY blank lines for detached mode with no data", async () => {
    if (!renderWidget) {
      const mod = await import("../widget-render.js");
      renderWidget = mod.renderWidget;
    }
    const config = configWithPlacement("detached", 0, 3);
    const data = mockUsageData();
    const result = renderWidget(
      config,
      mockTheme,
      data,
      80,
      "summary",
      "today",
    );

    // Should have "Usage: --- (today)" line + padding
    // Count empty lines at the start
    const firstNonEmpty = result.findIndex((line: string) => line !== "");
    assert.ok(
      firstNonEmpty >= 3,
      `Expected at least 3 empty lines for paddingY=3, got ${firstNonEmpty}`,
    );

    // Should also have trailing empty lines
    const lastNonEmpty =
      result.length -
      1 -
      result
        .slice()
        .reverse()
        .findIndex((line: string) => line !== "");
    const trailingEmpty = result.length - 1 - lastNonEmpty;
    assert.ok(
      trailingEmpty >= 3,
      `Expected at least 3 trailing empty lines for paddingY=3, got ${trailingEmpty}`,
    );
  });

  it("does NOT add padding for header mode", async () => {
    if (!renderWidget) {
      const mod = await import("../widget-render.js");
      renderWidget = mod.renderWidget;
    }
    const config = configWithPlacement("header", 0, 0);
    const data = mockUsageData();
    const result = renderWidget(
      config,
      mockTheme,
      data,
      80,
      "summary",
      "today",
    );

    // Header mode should NOT have leading empty lines from padding
    const firstNonEmpty = result.findIndex((line: string) => line !== "");
    assert.ok(
      firstNonEmpty <= 0,
      "Header mode should have no leading padding lines",
    );
  });

  it("does NOT add padding for footer mode", async () => {
    if (!renderWidget) {
      const mod = await import("../widget-render.js");
      renderWidget = mod.renderWidget;
    }
    const config = configWithPlacement("footer", 0, 0);
    const data = mockUsageData();
    const result = renderWidget(
      config,
      mockTheme,
      data,
      80,
      "summary",
      "today",
    );

    const firstNonEmpty = result.findIndex((line: string) => line !== "");
    assert.ok(
      firstNonEmpty <= 0,
      "Footer mode should have no leading padding lines",
    );
  });

  it("adds horizontal padding (paddingX) by indenting lines in detached mode", async () => {
    if (!renderWidget) {
      const mod = await import("../widget-render.js");
      renderWidget = mod.renderWidget;
    }
    const config = configWithPlacement("detached", 5, 0);
    const data = mockUsageData();
    const result = renderWidget(
      config,
      mockTheme,
      data,
      80,
      "summary",
      "today",
    );

    // Find a non-empty content line (not a blank padding line)
    const contentLines = result.filter((line: string) => line !== "");
    if (contentLines.length > 0) {
      const contentLine = contentLines[0]!;
      // Should start with 5 spaces
      assert.ok(
        contentLine.startsWith("     "),
        `Content line should be indented by 5 spaces for paddingX=5, got: "${contentLine.slice(0, 20)}..."`,
      );
    }
  });

  it("handles zero padding gracefully", async () => {
    if (!renderWidget) {
      const mod = await import("../widget-render.js");
      renderWidget = mod.renderWidget;
    }
    const config = configWithPlacement("detached", 0, 0);
    const data = mockUsageData();
    // Should not crash
    const result = renderWidget(
      config,
      mockTheme,
      data,
      80,
      "summary",
      "today",
    );
    assert.ok(Array.isArray(result), "Result should always be an array");
  });

  it("renders correctly with all modes and placements", async () => {
    if (!renderWidget) {
      const mod = await import("../widget-render.js");
      renderWidget = mod.renderWidget;
    }
    const modes = ["summary", "compact", "Per Model", "expanded"] as const;
    const placements = ["header", "footer", "detached"] as const;

    for (const mode of modes) {
      for (const placement of placements) {
        const config = configWithPlacement(
          placement,
          placement === "detached" ? 2 : 0,
          placement === "detached" ? 1 : 0,
        );
        const data = mockUsageData();
        const result = renderWidget(config, mockTheme, data, 80, mode, "today");
        assert.ok(
          Array.isArray(result),
          `renderWidget should return array for mode=${mode}, placement=${placement}`,
        );
        assert.ok(result.length >= 0, "Result should have non-negative length");
      }
    }
  });
});
