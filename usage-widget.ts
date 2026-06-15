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
import type {
  UsageWidgetConfig,
  DisplayMode,
  TimeScope,
  UsageData,
} from "./types.js";

// Legacy display mode names for backward compatibility
type DisplayModeLegacy =
  | "summary"
  | "compact"
  | "detailed-collapsed"
  | "detailed-expanded"
  | "hidden";

const DISPLAY_MODE_ORDER: DisplayModeLegacy[] = [
  "summary",
  "compact",
  "Per Model",
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
  /** Tracks whether the "hidden" mode flash message has been shown. Reset on mode change away from hidden. */
  private _hiddenMessageShown = false;

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
    // Build a cycle list of only enabled modes
    const enabledOrder = DISPLAY_MODE_ORDER.filter(
      (m) => this.config.enabledModes[m as DisplayMode] ?? true,
    );
    // Safety net: if all modes are disabled, fall back to full order
    const order = enabledOrder.length > 0 ? enabledOrder : DISPLAY_MODE_ORDER;
    const idx = order.indexOf(this.displayMode);
    const next = order[(idx + 1) % order.length]!;
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

    // Hidden mode: flash message once, then stay hidden
    if (modeStr === "hidden") {
      if (this._hiddenMessageShown) return [];
      this._hiddenMessageShown = true;
      return [this.theme.fg("dim", "Widget hidden — press Ctrl+Alt+U to show")];
    }

    // Reset flash flag when not in hidden mode
    this._hiddenMessageShown = false;

    return renderWidget(
      this.config,
      this.theme,
      this.usageData,
      width,
      modeStr,
      this.scope,
    );
  }
}
