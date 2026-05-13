/**
 * UsageWidget — footer widget that renders usage stats.
 *
 * Owns the display state (mode, scope, config) and delegates
 * rendering to widget-render.ts. Cycle commands persist config via
 * config-persistence.ts.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { renderWidget } from "./widget-render.js";
import { getDefaultConfig, saveConfig } from "./config-persistence.js";
import type { UsageWidgetConfig, DisplayMode, TimeScope, UsageData } from "./types.js";

// Legacy display mode names for backward compatibility
type DisplayModeLegacy = "summary" | "compact" | "detailed-collapsed" | "detailed-expanded" | "hidden";

const DISPLAY_MODE_ORDER: DisplayModeLegacy[] = [
  "summary",
  "compact",
  "per-model",
  "expanded",
  "hidden",
] as DisplayModeLegacy[];

const SCOPE_ORDER: TimeScope[] = [
  "lastHour",
  "today",
  "yesterday",
  "thisWeek",
  "lastWeek",
  "thisMonth",
  "allTime",
];

export class UsageWidget {
  private displayMode: DisplayModeLegacy = "summary";
  private scope: TimeScope = "today";
  private usageData: UsageData | null = null;
  private theme: Theme;
  private tui: import("@earendil-works/pi-tui").TUI | null = null;
  private config: UsageWidgetConfig;

  constructor(theme: Theme, config?: UsageWidgetConfig) {
    this.theme = theme;
    this.config = config ?? getDefaultConfig();
    this.displayMode = this.config.defaultMode as DisplayModeLegacy;
    this.scope = this.config.defaultScope;
  }

  setTui(tui: import("@earendil-works/pi-tui").TUI): void {
    this.tui = tui;
  }

  setData(data: UsageData | null): void {
    this.usageData = data;
    this.tui?.requestRender();
  }

  setMode(mode: DisplayModeLegacy): void {
    this.displayMode = mode;
    this.config.defaultMode = mode as DisplayMode;
    saveConfig(this.config);
    this.tui?.requestRender();
  }

  setScope(scope: TimeScope): void {
    this.scope = scope;
    this.config.defaultScope = scope;
    saveConfig(this.config);
    this.tui?.requestRender();
  }

  updateConfig(config: UsageWidgetConfig): void {
    this.config = config;
    this.displayMode = config.defaultMode as DisplayModeLegacy;
    this.scope = config.defaultScope;
    this.tui?.requestRender();
  }

  invalidate(): void {
    this.tui?.requestRender();
  }

  dispose(): void {}

  cycleMode(): void {
    const idx = DISPLAY_MODE_ORDER.indexOf(this.displayMode);
    const next = DISPLAY_MODE_ORDER[(idx + 1) % DISPLAY_MODE_ORDER.length]!;
    this.setMode(next);
  }

  cycleScope(): void {
    const idx = SCOPE_ORDER.indexOf(this.scope);
    const next = SCOPE_ORDER[(idx + 1) % SCOPE_ORDER.length]!;
    this.setScope(next);
  }

  render(width: number): string[] {
    if (!this.usageData) {
      return [this.theme.fg("dim", "Usage: Loading...")];
    }

    // Normalize legacy mode names for render engine
    let modeStr: string = this.displayMode;
    if (modeStr === "detailed-collapsed") modeStr = "compact";
    if (modeStr === "detailed-expanded") modeStr = "expanded";

    return renderWidget(this.config, this.theme, this.usageData, width, modeStr, this.scope);
  }
}
