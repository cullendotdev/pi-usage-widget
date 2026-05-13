/**
 * Settings menu TUI — interactive `/usage-settings` command.
 *
 * Renders a 5-tab shell with live preview pane. Full implementation:
 *   - Global tab: display mode, time scope, theme preset, Global Colors
 *   - Mode tabs: column toggles, totals, per-mode color overrides
 *   - Color picker submenu for per-element color editing
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
  ColorOverrides,
} from "./types.js";
import { colorPresets, colorElements, resolveColor, hexToAnsi } from "./color-engine.js";
import type { ColorElement } from "./color-engine.js";
import { ColorPicker, ELEMENT_LABELS, renderColorSwatch, validateHex } from "./color-picker.js";

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

// Focus section for tabs that have both settings and color sections
type FocusSection = "settings" | "colors";

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
      return theme.fg(isGlobal ? "text" : "dim", text);
    },
    value: (text: string, selected: boolean) => {
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
  private previewCacheMode = "";

  // Color picker integration
  private colorPicker: ColorPicker | null = null;
  /** Which element is currently being edited (null = none) */
  private editingElement: ColorElement | null = null;
  /** Which mode's override is being edited (null = global) */
  private editingMode: DisplayMode | null = null;

  // Color section navigation
  private focusSection: FocusSection = "settings";
  private colorElementIndex = 0;
  private colorScrollOffset = 0;

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
      12,
      theme,
      (id: string, newValue: string) => this.onGlobalSettingChanged(id, newValue),
      () => this.done(),
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

  private buildModeSettingsLists(): SettingsList[] {
    return DISPLAY_MODES.map((mode) => this.buildModeSettingsList(mode));
  }

  private onModeSettingChanged(id: string, newValue: string): void {
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

  // ===========================================================================
  // Color picker integration
  // ===========================================================================

  /**
   * Open the color picker for a specific element.
   * @param element  The color element to edit
   * @param mode     Display mode for per-mode overrides (null = global)
   */
  private openColorPicker(element: ColorElement, mode: DisplayMode | null): void {
    this.editingElement = element;
    this.editingMode = mode;

    // Get current color value
    let currentColor: string | null;
    if (mode) {
      currentColor = this.config.perModeColorOverrides[mode][element] ?? null;
    } else {
      currentColor = this.config.globalColorOverrides[element] ?? null;
    }

    this.colorPicker = new ColorPicker(
      this.theme,
      currentColor,
      // onSelect
      (color: string | null) => {
        this.applyColorChange(element, mode, color);
        this.colorPicker = null;
        this.editingElement = null;
        this.editingMode = null;
        this.tui.requestRender();
      },
      // onCancel
      () => {
        this.colorPicker = null;
        this.editingElement = null;
        this.editingMode = null;
        this.tui.requestRender();
      },
    );

    this.tui.requestRender();
  }

  /** Apply a color change to the config and save. */
  private applyColorChange(
    element: ColorElement,
    mode: DisplayMode | null,
    color: string | null,
  ): void {
    if (mode) {
      this.config.perModeColorOverrides[mode][element] = color;
    } else {
      this.config.globalColorOverrides[element] = color;
    }
    saveConfig(this.config);
    this.invalidatePreview();
  }

  /** Get the override object for the current editing context. */
  private getCurrentOverrides(): ColorOverrides {
    if (this.editingMode) {
      return this.config.perModeColorOverrides[this.editingMode];
    }
    return this.config.globalColorOverrides;
  }

  // ===========================================================================
  // Color element rendering helpers
  // ===========================================================================

  /** Get the display text for a color value (hex, role name, or "(inherit)"). */
  private getColorDisplayText(value: string | null): string {
    if (value === null || value === "") return "(inherit)";
    return value;
  }

  /** Get a color swatch for the resolved color of an element. */
  private getResolvedColorSwatch(element: ColorElement, mode: DisplayMode | null): string {
    try {
      const ansi = resolveColor(element, this.config, mode ? { mode } : undefined);
      // Extract hex from ANSI truecolor if possible, otherwise use approximation
      const trueColorMatch = ansi.match(/38;2;(\d+);(\d+);(\d+)/);
      if (trueColorMatch) {
        const r = parseInt(trueColorMatch[1]);
        const g = parseInt(trueColorMatch[2]);
        const b = parseInt(trueColorMatch[3]);
        const hex = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
        return renderColorSwatch(hex);
      }
      // Fallback for non-truecolor modes — just use the ansi code itself
      return `${ansi}██\x1b[0m`;
    } catch {
      return "??";
    }
  }

  // ===========================================================================
  // Color elements section rendering (Global tab)
  // ===========================================================================

  /** Render the Global Colors section. */
  private renderGlobalColorsSection(width: number): string[] {
    const lines: string[] = [];
    const innerWidth = width - 4;
    const maxVisible = Math.min(colorElements.length, 14);
    const isFocused = this.focusSection === "colors";

    // Section header
    lines.push("");
    lines.push("  " + this.theme.fg("dim", isFocused ? "┌─ Global Colors (c=settings) ─" + "─".repeat(Math.max(0, innerWidth - 27)) : "┌─ Global Colors (c) " + "─".repeat(Math.max(0, innerWidth - 22))));
    lines.push("");

    // Adjust scroll offset
    if (this.colorElementIndex < this.colorScrollOffset) {
      this.colorScrollOffset = this.colorElementIndex;
    } else if (this.colorElementIndex >= this.colorScrollOffset + maxVisible) {
      this.colorScrollOffset = this.colorElementIndex - maxVisible + 1;
    }

    if (this.colorScrollOffset > 0) {
      lines.push("  " + this.theme.fg("dim", "  ↑ ..."));
    }

    for (let i = this.colorScrollOffset; i < Math.min(this.colorScrollOffset + maxVisible, colorElements.length); i++) {
      const element = colorElements[i];
      const label = ELEMENT_LABELS[element] ?? element;
      const isSelected = isFocused && i === this.colorElementIndex;
      const cursor = isSelected ? this.theme.fg("accent", "▸") : " ";

      // Get current override value (global)
      const overrideVal = this.config.globalColorOverrides[element];
      const swatch = this.getResolvedColorSwatch(element, null);
      const valueText = overrideVal
        ? this.theme.fg(isSelected ? "accent" : "text", overrideVal)
        : this.theme.fg("dim", "(inherit)");

      const labelText = isSelected
        ? this.theme.fg("accent", label.padEnd(18))
        : this.theme.fg("text", label.padEnd(18));

      lines.push(`  ${cursor} ${swatch} ${labelText} ${valueText}`);
    }

    if (this.colorScrollOffset + maxVisible < colorElements.length) {
      lines.push("  " + this.theme.fg("dim", "  ↓ ..."));
    }

    lines.push("");
    lines.push("  " + this.theme.fg("dim", "└" + "─".repeat(Math.max(0, innerWidth - 1))));

    return lines;
  }

  /** Render the per-mode color overrides section. */
  private renderModeColorSection(mode: DisplayMode, width: number): string[] {
    const lines: string[] = [];
    const innerWidth = width - 4;
    const overrides = this.config.perModeColorOverrides[mode];
    const maxVisible = Math.min(colorElements.length, 10);
    const isFocused = this.focusSection === "colors";

    // Section header
    lines.push("");
    lines.push("  " + this.theme.fg("dim", isFocused ? "┌─ Color Overrides (c=settings) ─" + "─".repeat(Math.max(0, innerWidth - 32)) : "┌─ Color Overrides (c) " + "─".repeat(Math.max(0, innerWidth - 27))));
    lines.push("");

    // Adjust scroll offset
    if (this.colorElementIndex < this.colorScrollOffset) {
      this.colorScrollOffset = this.colorElementIndex;
    } else if (this.colorElementIndex >= this.colorScrollOffset + maxVisible) {
      this.colorScrollOffset = this.colorElementIndex - maxVisible + 1;
    }

    if (this.colorScrollOffset > 0) {
      lines.push("  " + this.theme.fg("dim", "  ↑ ..."));
    }

    for (let i = this.colorScrollOffset; i < Math.min(this.colorScrollOffset + maxVisible, colorElements.length); i++) {
      const element = colorElements[i];
      const label = ELEMENT_LABELS[element] ?? element;
      const isSelected = isFocused && i === this.colorElementIndex;
      const cursor = isSelected ? this.theme.fg("accent", "▸") : " ";

      const overrideVal = overrides[element];
      const swatch = this.getResolvedColorSwatch(element, mode);
      const isOverridden = overrideVal !== null && overrideVal !== "";

      // Overridden elements marked with *
      const prefix = isOverridden ? "*" : " ";
      const labelText = isSelected
        ? this.theme.fg("accent", `${prefix}${label}`.padEnd(19))
        : this.theme.fg("text", `${prefix}${label}`.padEnd(19));

      const valueText = isOverridden
        ? this.theme.fg(isSelected ? "accent" : "text", overrideVal!)
        : this.theme.fg("dim", "(inherit)");

      lines.push(`  ${cursor} ${swatch} ${labelText} ${valueText}`);
    }

    if (this.colorScrollOffset + maxVisible < colorElements.length) {
      lines.push("  " + this.theme.fg("dim", "  ↓ ..."));
    }

    lines.push("");
    lines.push("  " + this.theme.fg("dim", "└" + "─".repeat(Math.max(0, innerWidth - 1))));

    return lines;
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
      return [this.theme.fg("dim", "Usage: No data (preview)")];
    }
  }

  // ===========================================================================
  // Tab content rendering
  // ===========================================================================

  private renderGlobalTabContent(width: number): string[] {
    const lines: string[] = [];

    // SettingsList (mode/scope/preset)
    const settingsLines = this.globalSettingsList.render(width);
    for (const line of settingsLines) {
      lines.push("  " + line);
    }

    // Global Colors section
    lines.push(...this.renderGlobalColorsSection(width));

    return lines;
  }

  private renderModeTabContent(mode: DisplayMode, width: number): string[] {
    const lines: string[] = [];

    // SettingsList (column toggles)
    const tabIndex = DISPLAY_MODES.indexOf(mode);
    const list = this.modeSettingsLists[tabIndex];
    if (list) {
      const settingsLines = list.render(width);
      for (const line of settingsLines) {
        lines.push("  " + line);
      }
    }

    // Color Overrides section
    lines.push(...this.renderModeColorSection(mode, width));

    return lines;
  }

  private renderTabContent(width: number): string[] {
    if (this.activeTab >= 0 && this.activeTab <= 3) {
      const mode = TAB_MODE[this.activeTab];
      return this.renderModeTabContent(mode, width);
    }
    if (this.activeTab === 4) {
      return this.renderGlobalTabContent(width);
    }
    return [];
  }

  // ===========================================================================
  // Tab bar rendering
  // ===========================================================================

  private renderTabBar(width: number): string[] {
    if (width < 20) {
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
    const hints = "← → tabs  ↑↓ select  Enter edit  c=colors  Esc/q close";
    if (width < hints.length + 2) return [];
    const leftPad = Math.floor((width - hints.length) / 2);
    return [this.theme.fg("dim", " ".repeat(leftPad) + hints)];
  }

  // ===========================================================================
  // Main render
  // ===========================================================================

  render(width: number): string[] {
    const safeWidth = Math.max(width, 40);

    // If color picker is active, render it instead of normal content
    if (this.colorPicker) {
      const elementName = this.editingElement
        ? ELEMENT_LABELS[this.editingElement] ?? this.editingElement
        : "Unknown";
      const context = this.editingMode
        ? `${elementName} (${this.editingMode} mode)`
        : `${elementName} (global)`;

      const pickerLines = this.colorPicker.render(safeWidth);
      return [
        this.theme.fg("dim", `Editing: ${context}`),
        "",
        ...pickerLines,
      ];
    }

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
      lines.push(line);
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
    // If color picker is active, delegate to it
    if (this.colorPicker) {
      this.colorPicker.handleInput(input);
      this.tui.requestRender();
      return;
    }

    // Escape / q — close menu
    if (input === "\x1b" || input === "q") {
      this.done();
      return;
    }

    // Tab switching via left/right arrows
    if (input === "\x1b[C" || input === "\x1bOC") {
      this.activeTab = ((this.activeTab + 1) % TAB_NAMES.length) as TabIndex;
      this.focusSection = "settings";
      this.invalidatePreview();
      this.tui.requestRender();
      return;
    }
    if (input === "\x1b[D" || input === "\x1bOD") {
      this.activeTab = ((this.activeTab - 1 + TAB_NAMES.length) % TAB_NAMES.length) as TabIndex;
      this.focusSection = "settings";
      this.invalidatePreview();
      this.tui.requestRender();
      return;
    }

    // 'c' key — toggle between settings and colors section
    if (input === "c") {
      this.focusSection = this.focusSection === "settings" ? "colors" : "settings";
      this.tui.requestRender();
      return;
    }

    // Handle input based on which section is focused
    if (this.focusSection === "settings") {
      this.handleSettingsInput(input);
    } else {
      this.handleColorSectionInput(input);
    }
  }

  /** Delegate input to the active SettingsList. */
  private handleSettingsInput(input: string): void {
    if (this.activeTab >= 0 && this.activeTab <= 3) {
      const list = this.modeSettingsLists[this.activeTab];
      if (list) list.handleInput(input);
    } else if (this.activeTab === 4) {
      this.globalSettingsList.handleInput(input);
    }
  }

  /** Handle navigation within the color elements section. */
  private handleColorSectionInput(input: string): void {
    // Up arrow
    if (input === "\x1b[A" || input === "\x1bOA") {
      if (this.colorElementIndex > 0) {
        this.colorElementIndex--;
        this.tui.requestRender();
      }
      return;
    }

    // Down arrow
    if (input === "\x1b[B" || input === "\x1bOB") {
      if (this.colorElementIndex < colorElements.length - 1) {
        this.colorElementIndex++;
        this.tui.requestRender();
      }
      return;
    }

    // Home
    if (input === "\x1b[H" || input === "\x1bOH") {
      this.colorElementIndex = 0;
      this.colorScrollOffset = 0;
      this.tui.requestRender();
      return;
    }

    // End
    if (input === "\x1b[F" || input === "\x1bOF") {
      this.colorElementIndex = colorElements.length - 1;
      this.tui.requestRender();
      return;
    }

    // Enter — open color picker for selected element
    if (input === "\r" || input === "\n") {
      const element = colorElements[this.colorElementIndex];
      if (element) {
        // Determine mode context
        if (this.activeTab === 4) {
          // Global tab — editing global overrides
          this.openColorPicker(element, null);
        } else if (this.activeTab >= 0 && this.activeTab <= 3) {
          // Mode tab — editing per-mode overrides
          const mode = TAB_MODE[this.activeTab];
          this.openColorPicker(element, mode);
        }
      }
      return;
    }

    // Delete / Backspace — reset override to null (inherit)
    if (input === "\x7f" || input === "\b" || input === "d") {
      const element = colorElements[this.colorElementIndex];
      if (element) {
        if (this.activeTab === 4) {
          this.config.globalColorOverrides[element] = null;
        } else if (this.activeTab >= 0 && this.activeTab <= 3) {
          const mode = TAB_MODE[this.activeTab];
          this.config.perModeColorOverrides[mode][element] = null;
        }
        saveConfig(this.config);
        this.invalidatePreview();
        this.tui.requestRender();
      }
      return;
    }
  }

  // ===========================================================================
  // Dispose
  // ===========================================================================

  dispose(): void {
    if (this.colorPicker) {
      this.colorPicker.dispose();
      this.colorPicker = null;
    }
  }
}
