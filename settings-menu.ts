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

  // Cached values for the preview
  private previewCache: string[] = [];
  private previewCacheWidth = -1;

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
  // Preview rendering
  // ===========================================================================

  private invalidatePreview(): void {
    this.previewCacheWidth = -1;
    this.previewCache = [];
  }

  private renderPreview(width: number): string[] {
    if (width <= 0) return [];

    // Use cache to avoid re-rendering on every frame
    if (this.previewCacheWidth === width && this.previewCache.length > 0) {
      return this.previewCache;
    }

    try {
      const mockData = createMockUsageData();
      const previewConfig = { ...this.config };
      // Always show in compact mode for preview
      previewConfig.defaultMode = "compact";
      const lines = renderWidget(previewConfig, this.theme, mockData, width, "compact");
      this.previewCache = lines;
      this.previewCacheWidth = width;
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
    switch (this.activeTab) {
      case 0: // Summary
        return [this.theme.fg("dim", "Summary tab — coming in Slice 6")];
      case 1: // Compact
        return [this.theme.fg("dim", "Compact tab — coming in Slice 6")];
      case 2: // Per-Model
        return [this.theme.fg("dim", "Per-Model tab — coming in Slice 6")];
      case 3: // Expanded
        return [this.theme.fg("dim", "Expanded tab — coming in Slice 6")];
      case 4: // Global
        return this.globalSettingsList.render(width);
      default:
        return [];
    }
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

    // Tab content input — delegate to appropriate handler
    switch (this.activeTab) {
      case 0:
      case 1:
      case 2:
      case 3:
        // Stub tabs — up/down arrows do nothing, Enter does nothing
        break;
      case 4:
        // Global tab — delegate to SettingsList
        this.globalSettingsList.handleInput(input);
        break;
    }
  }

  // ===========================================================================
  // Dispose
  // ===========================================================================

  dispose(): void {
    // Nothing to clean up
  }
}
