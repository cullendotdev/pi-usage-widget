/**
 * Settings menu TUI — interactive `/usage-settings` command.
 *
 * Renders a 5-tab shell with live preview pane. The Global tab is fully
 * functional (mode, scope, preset selectors). Other tabs are stubs for
 * Slice 6 (Mode tabs), Slice 7 (Color pickers), and Slice 8 (Placement).
 *
 * Exports:
 *   - SettingsMenu — Component that manages tab state, rendering, and input
 *   - createMockUsageData() — minimal mock data for the live preview
 *
 * Follows the pi-thinking-box pattern: Container → SettingsList for dropdowns,
 * DynamicBorder for borders, live preview in a Container rebuilt on changes.
 */

import {
  Container,
  Spacer,
  SettingsList,
  Text,
  type Component,
  type SettingItem,
  type SettingsListTheme,
} from "@earendil-works/pi-tui";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { loadConfig, saveConfig } from "./config-persistence.js";
import { renderWidget } from "./widget-render.js";
import type {
  UsageWidgetConfig,
  UsageData,
  DisplayMode,
  TimeScope,
  ThemedPreset,
  ModeColumnConfig,
} from "./types.js";
import { colorPresets } from "./color-engine.js";

// =============================================================================
// Constants
// =============================================================================

const TAB_NAMES = ["Summary", "Compact", "Per-Model", "Expanded", "Global"] as const;
type TabIndex = 0 | 1 | 2 | 3 | 4;

const DISPLAY_MODES: DisplayMode[] = ["summary", "compact", "per-model", "expanded"];
const TIME_SCOPES: TimeScope[] = [
  "lastHour",
  "today",
  "yesterday",
  "thisWeek",
  "lastWeek",
  "thisMonth",
  "allTime",
];
const THEMED_PRESETS: ThemedPreset[] = [
  "default",
  "tokyo-night",
  "dracula",
  "gruvbox",
  "nord",
  "catppuccin",
];

const DISPLAY_MODE_LABELS: Record<DisplayMode, string> = {
  summary: "Summary",
  compact: "Compact",
  "per-model": "Per Model",
  expanded: "Expanded",
  hidden: "Hidden",
};

const TIME_SCOPE_LABELS: Record<TimeScope, string> = {
  lastHour: "Last Hour",
  today: "Today",
  yesterday: "Yesterday",
  thisWeek: "This Week",
  lastWeek: "Last Week",
  thisMonth: "This Month",
  allTime: "All Time",
};

const PRESET_LABELS: Record<ThemedPreset, string> = {
  default: "Default",
  "tokyo-night": "Tokyo Night",
  dracula: "Dracula",
  gruvbox: "Gruvbox",
  nord: "Nord",
  catppuccin: "Catppuccin",
};

// =============================================================================
// Column toggle definitions for mode tabs
// =============================================================================

interface ColumnToggleDef {
  id: keyof ModeColumnConfig;
  label: string;
  description: string;
}

const ALL_COLUMNS: ColumnToggleDef[] = [
  { id: "provider", label: "Provider", description: "Show/hide provider name column" },
  { id: "model", label: "Model", description: "Show/hide model name column" },
  { id: "sessions", label: "Sessions", description: "Show/hide sessions column" },
  { id: "msgs", label: "Msgs", description: "Show/hide messages column" },
  { id: "cost", label: "Cost", description: "Show/hide cost column" },
  { id: "tokens", label: "Tokens", description: "Show/hide total tokens column" },
  { id: "tokensIn", label: "Tokens In", description: "Show/hide input tokens column" },
  { id: "tokensOut", label: "Tokens Out", description: "Show/hide output tokens column" },
  { id: "cache", label: "Cache", description: "Show/hide cache tokens column" },
];

/** Map of display mode for each tab index (0-3). 4=Global uses config.defaultMode. */
const TAB_MODE: Record<number, DisplayMode> = {
  0: "summary",
  1: "compact",
  2: "per-model",
  3: "expanded",
};

const TOGGLE_VALUES = ["Show", "Hide"];

// =============================================================================
// Mock UsageData for live preview
// =============================================================================

/**
 * Create minimal mock UsageData so renderWidget can produce a visible preview.
 * The preview shows structure, not real data — it's a UI preview, not a data dashboard.
 */
export function createMockUsageData(): UsageData {
  const emptyStats = (): UsageData[keyof UsageData] => ({
    providers: new Map(),
    totals: { messages: 0, cost: 0, tokens: { total: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, sessions: 0 },
    insights: { insights: [] },
  });

  return {
    lastHour: emptyStats(),
    today: emptyStats(),
    yesterday: emptyStats(),
    thisWeek: emptyStats(),
    lastWeek: emptyStats(),
    thisMonth: emptyStats(),
    allTime: emptyStats(),
  };
}

// =============================================================================
// SettingsList theme (matches the existing color usage pattern)
// =============================================================================

function createSettingsListTheme(theme: Theme, isGlobal: boolean = true): SettingsListTheme {
  return {
    label: (text: string, _selected: boolean) => {
      // Labels always rendered in dim white
      return theme.fg(isGlobal ? "text" : "dim", text);
    },
    value: (text: string, selected: boolean) => {
      // Selected value gets accent; unselected gets text color
      return theme.fg(selected ? "accent" : "text", text);
    },
    description: (text: string) => {
      return theme.fg("dim", text);
    },
    cursor: theme.fg("accent", "▸ "),
    hint: (text: string) => theme.fg("muted", text),
  };
}

// =============================================================================
// SettingsMenu Component
// =============================================================================

export class SettingsMenu implements Component {
  private config: UsageWidgetConfig;
  private theme: Theme;
  private tui: { requestRender: () => void };
  private done: () => void;
  private activeTab: TabIndex = 4; // Default to Global tab (last tab)

  // SettingsList for the Global tab
  private globalSettingsList: SettingsList;

  // SettingsLists for the four mode tabs (indices 0-3)
  private modeSettingsLists: SettingsList[] = [];

  // Cached values for the preview
  private previewCache: string[] = [];
  private previewCacheWidth = -1;
  private previewCacheMode: string = "";

  constructor(
    theme: Theme,
    tui: { requestRender: () => void },
    done: () => void,
  ) {
    this.theme = theme;
    this.tui = tui;
    this.done = done;

    // Load persisted config
    this.config = loadConfig();

    // Build the Global tab SettingsList
    this.globalSettingsList = this.buildGlobalSettingsList();

    // Build all four mode tab SettingsLists
    this.modeSettingsLists = this.buildModeSettingsLists();
  }

  // ===========================================================================
  // Global tab — SettingsList with 3 cycle-able dropdowns
  // ===========================================================================

  private buildGlobalSettingsList(): SettingsList {
    const theme = createSettingsListTheme(this.theme);

    const items: SettingItem[] = [
      {
        id: "defaultMode",
        label: "Display Mode",
        description: "Default display mode when widget loads",
        currentValue: DISPLAY_MODE_LABELS[this.config.defaultMode] ?? this.config.defaultMode,
        values: DISPLAY_MODES.map((m) => DISPLAY_MODE_LABELS[m]),
      },
      {
        id: "defaultScope",
        label: "Time Scope",
        description: "Default time scope when widget loads",
        currentValue: TIME_SCOPE_LABELS[this.config.defaultScope] ?? this.config.defaultScope,
        values: TIME_SCOPES.map((s) => TIME_SCOPE_LABELS[s]),
      },
      {
        id: "themedPreset",
        label: "Theme Preset",
        description: "Color scheme for the usage widget",
        currentValue: PRESET_LABELS[this.config.themedPreset] ?? this.config.themedPreset,
        values: THEMED_PRESETS.map((p) => PRESET_LABELS[p]),
      },
    ];

    const list = new SettingsList(
      items,
      12, // maxVisible — show all items
      theme,
      (id: string, newValue: string) => this.onGlobalSettingChanged(id, newValue),
      () => this.done(), // Escape cancels → close menu
      { enableSearch: false },
    );

    return list;
  }

  private onGlobalSettingChanged(id: string, newLabel: string): void {
    switch (id) {
      case "defaultMode": {
        const mode = DISPLAY_MODES.find((m) => DISPLAY_MODE_LABELS[m] === newLabel);
        if (mode && mode !== this.config.defaultMode) {
          this.config.defaultMode = mode;
          saveConfig(this.config);
          this.invalidatePreview();
          this.tui.requestRender();
        }
        break;
      }
      case "defaultScope": {
        const scope = TIME_SCOPES.find((s) => TIME_SCOPE_LABELS[s] === newLabel);
        if (scope && scope !== this.config.defaultScope) {
          this.config.defaultScope = scope;
          saveConfig(this.config);
          this.invalidatePreview();
          this.tui.requestRender();
        }
        break;
      }
      case "themedPreset": {
        const preset = THEMED_PRESETS.find((p) => PRESET_LABELS[p] === newLabel);
        if (preset && preset !== this.config.themedPreset) {
          this.config.themedPreset = preset;
          saveConfig(this.config);
          this.invalidatePreview();
          this.tui.requestRender();
        }
        break;
      }
      default:
        break;
    }
  }

  // ===========================================================================
  // Mode tab — column toggle settings
  // ===========================================================================

  /** Get the display mode for the currently active tab. */
  private getActiveTabMode(): string {
    if (this.activeTab === 4) return this.config.defaultMode;
    return TAB_MODE[this.activeTab] ?? "compact";
  }

  /** Build a SettingsList for a specific display mode's column config. */
  private buildModeSettingsList(mode: DisplayMode): SettingsList {
    const theme = createSettingsListTheme(this.theme, false);
    const columnConfig = this.config.modes[mode];
    const items: SettingItem[] = [];
    const isSummary = mode === "summary";

    for (const col of ALL_COLUMNS) {
      // For summary, provider/model are available but noted as less useful
      const visible = columnConfig[col.id] as boolean;
      const desc = isSummary && (col.id === "provider" || col.id === "model")
        ? col.description + " (less useful in summary mode)"
        : col.description;

      items.push({
        id: `${mode}:${col.id}`,
        label: col.label,
        description: desc,
        currentValue: visible ? "Show" : "Hide",
        values: TOGGLE_VALUES,
      });
    }

    // Add totals toggle for non-summary modes
    if (!isSummary) {
      items.push({
        id: `${mode}:showTotals`,
        label: "Totals Row",
        description: "Show/hide the totals summary row",
        currentValue: columnConfig.showTotals ? "Show" : "Hide",
        values: TOGGLE_VALUES,
      });
    }

    const list = new SettingsList(
      items,
      14,
      theme,
      (id: string, newValue: string) => this.onModeSettingChanged(id, newValue),
      () => this.done(),
      { enableSearch: false },
    );

    return list;
  }

  /** Build all four mode SettingsLists (one per tab). */
  private buildModeSettingsLists(): SettingsList[] {
    return DISPLAY_MODES.map((mode) => this.buildModeSettingsList(mode));
  }

  /** Handle a column or totals toggle change for a mode tab. */
  private onModeSettingChanged(id: string, newValue: string): void {
    // Parse the compound id: "{mode}:{columnId}" or "{mode}:showTotals"
    const colonIdx = id.indexOf(":");
    if (colonIdx < 0) return;

    const mode = id.slice(0, colonIdx) as DisplayMode;
    const settingKey = id.slice(colonIdx + 1);
    const modeConfig = this.config.modes[mode];
    if (!modeConfig) return;

    const boolValue = newValue === "Show";

    if (settingKey === "showTotals") {
      if (modeConfig.showTotals !== boolValue) {
        modeConfig.showTotals = boolValue;
        saveConfig(this.config);
        this.invalidatePreview();
        this.tui.requestRender();
      }
    } else if (settingKey in modeConfig) {
      const key = settingKey as keyof ModeColumnConfig;
      const current = modeConfig[key];
      if (typeof current === "boolean" && current !== boolValue) {
        (modeConfig as Record<string, boolean>)[settingKey] = boolValue;
        saveConfig(this.config);
        this.invalidatePreview();
        this.tui.requestRender();
      }
    }
  }

  /** Rebuild mode SettingsLists after config changes (e.g., persistence restore). */
  private rebuildModeSettingsLists(): void {
    this.modeSettingsLists = this.buildModeSettingsLists();
  }

  // ===========================================================================
  // Preview rendering
  // ===========================================================================

  private invalidatePreview(): void {
    this.previewCacheWidth = -1;
    this.previewCacheMode = "";
    this.previewCache = [];
  }

  private renderPreview(width: number): string[] {
    if (width <= 0) return [];

    const previewMode = this.getActiveTabMode();

    // Use cache to avoid re-rendering on every frame
    if (this.previewCacheWidth === width && this.previewCacheMode === previewMode && this.previewCache.length > 0) {
      return this.previewCache;
    }

    try {
      const mockData = createMockUsageData();
      const lines = renderWidget(this.config, this.theme, mockData, width, previewMode);
      this.previewCache = lines;
      this.previewCacheWidth = width;
      this.previewCacheMode = previewMode;
      return lines;
    } catch {
      // Graceful fallback if renderWidget fails (e.g., no data)
      return [this.theme.fg("dim", "Usage: No data (preview)")];
    }
  }

  // ===========================================================================
  // Tab content rendering
  // ===========================================================================

  private renderTabContent(width: number): string[] {
    if (this.activeTab >= 0 && this.activeTab <= 3) {
      // Mode tabs — render the corresponding SettingsList
      const list = this.modeSettingsLists[this.activeTab];
      if (list) return list.render(width);
      return [this.theme.fg("dim", `No settings for ${TAB_NAMES[this.activeTab]} tab`)];
    }
    if (this.activeTab === 4) {
      // Global tab
      return this.globalSettingsList.render(width);
    }
    return [];
  }

  // ===========================================================================
  // Tab bar rendering
  // ===========================================================================

  private renderTabBar(width: number): string[] {
    if (width < 20) {
      // Too narrow for tab bar — just show active tab name
      return [this.theme.fg("accent", `  ${TAB_NAMES[this.activeTab]}  `)];
    }

    const tabWidth = Math.min(14, Math.floor((width - 4) / TAB_NAMES.length));
    let line = " ";

    for (let i = 0; i < TAB_NAMES.length; i++) {
      const name = TAB_NAMES[i];
      const isActive = i === this.activeTab;
      const displayName = name.length > tabWidth - 2
        ? name.slice(0, tabWidth - 4) + "…"
        : name;

      // Center the name within the tab width
      const padding = Math.max(0, tabWidth - displayName.length - 2);
      const leftPad = Math.floor(padding / 2);
      const rightPad = Math.ceil(padding / 2);

      const padded = " ".repeat(leftPad) + displayName + " ".repeat(rightPad);

      if (isActive) {
        line += this.theme.bg("selectedBg", this.theme.fg("text", padded));
      } else {
        line += this.theme.fg("muted", padded);
      }
    }

    line += " ";
    return [line];
  }

  private renderHintBar(width: number): string[] {
    const hints = "← → switch tabs  ↑↓ select  Enter change  Esc/q close";
    if (width < hints.length + 2) return [];
    const leftPad = Math.floor((width - hints.length) / 2);
    return [this.theme.fg("dim", " ".repeat(leftPad) + hints)];
  }

  // ===========================================================================
  // Main render
  // ===========================================================================

  render(width: number): string[] {
    const safeWidth = Math.max(width, 20);
    const lines: string[] = [];

    // Top border
    lines.push(this.theme.fg("border", "─".repeat(safeWidth)));

    // Title
    const title = " Usage Settings ";
    const titlePad = Math.floor((safeWidth - title.length) / 2);
    lines.push(this.theme.fg("border", "─".repeat(titlePad) + title + "─".repeat(safeWidth - titlePad - title.length)));

    // Live preview section
    lines.push("");
    const previewLabel = this.theme.fg("dim", "┌─ Live Preview " + "─".repeat(Math.max(0, safeWidth - 18)));
    lines.push(previewLabel);
    const previewLines = this.renderPreview(safeWidth);
    for (const line of previewLines) {
      lines.push(" " + line);
    }
    lines.push(this.theme.fg("dim", "└" + "─".repeat(Math.max(0, safeWidth - 1))));
    lines.push("");

    // Tab bar
    lines.push(this.theme.fg("dim", "─".repeat(safeWidth)));
    lines.push(...this.renderTabBar(safeWidth));
    lines.push(this.theme.fg("dim", "─".repeat(safeWidth)));
    lines.push("");

    // Tab content
    const contentLines = this.renderTabContent(safeWidth);
    for (const line of contentLines) {
      lines.push("  " + line);
    }

    // Footer
    lines.push("");
    lines.push(this.theme.fg("dim", "─".repeat(safeWidth)));
    lines.push(...this.renderHintBar(safeWidth));
    lines.push(this.theme.fg("border", "─".repeat(safeWidth)));

    return lines;
  }

  // ===========================================================================
  // Input handling
  // ===========================================================================

  handleInput(input: string): void {
    // Escape / q — close menu
    if (input === "\x1b" || input === "q") {
      this.done();
      return;
    }

    // Tab switching via left/right arrows
    if (input === "\x1b[C" || input === "\x1bOC") {
      // Right arrow
      this.activeTab = ((this.activeTab + 1) % TAB_NAMES.length) as TabIndex;
      this.invalidatePreview();
      this.tui.requestRender();
      return;
    }
    if (input === "\x1b[D" || input === "\x1bOD") {
      // Left arrow
      this.activeTab = ((this.activeTab - 1 + TAB_NAMES.length) % TAB_NAMES.length) as TabIndex;
      this.invalidatePreview();
      this.tui.requestRender();
      return;
    }

    // Tab content input — delegate to appropriate SettingsList
    if (this.activeTab >= 0 && this.activeTab <= 3) {
      const list = this.modeSettingsLists[this.activeTab];
      if (list) list.handleInput(input);
    } else if (this.activeTab === 4) {
      this.globalSettingsList.handleInput(input);
    }
  }

  // ===========================================================================
  // Dispose
  // ===========================================================================

  dispose(): void {
    // Nothing to clean up
  }
}
