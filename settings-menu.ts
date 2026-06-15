/**
 * Settings menu TUI — interactive `/usage-settings` command.
 *
 * Renders a 5-tab shell with live preview pane. Multi-level submenu navigation:
 *   - Global tab: display mode, time scope, theme preset, Colors submenu
 *   - Mode tabs: Theme Override, Columns submenu, Colors submenu
 *   - Colors split into Headers and Values sub-submenus
 *   - Color picker for per-element color editing
 *
 * Exports:
 *   - SettingsMenu — Component that manages tab state, rendering, and input
 *   - createMockUsageData() — realistic mock data for the live preview
 *   - HEADER_ELEMENTS, VALUE_ELEMENTS — color element groupings
 */

import { Text, visibleWidth, type Component } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  loadConfig,
  saveConfig,
  DEFAULT_COLUMN_ORDER,
} from "./config-persistence.js";
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
import {
  colorPresets,
  colorElements,
  resolveColor,
  hexToAnsi,
} from "./color-engine.js";
import type { ColorElement } from "./color-engine.js";
import {
  ColorPicker,
  ELEMENT_LABELS,
  renderColorSwatch,
  validateHex,
} from "./color-picker.js";

// =============================================================================
// Constants
// =============================================================================

const TAB_NAMES = [
  "Global",
  "Summary",
  "Per Provider",
  "Per Model",
  "Provider & Model",
] as const;
type TabIndex = 0 | 1 | 2 | 3 | 4;

const DISPLAY_MODES: DisplayMode[] = [
  "summary",
  "compact",
  "Per Model",
  "expanded",
];
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
  "monokai",
];

const DISPLAY_MODE_LABELS: Record<DisplayMode, string> = {
  summary: "Summary",
  compact: "Per Provider",
  "Per Model": "Per Model",
  expanded: "Provider & Model",
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
  monokai: "Monokai",
};

// =============================================================================
// Color element groupings for the Colors submenu
// =============================================================================

/** Header-line color elements (title, scope, column headers, separators). */
export const HEADER_ELEMENTS: ColorElement[] = [
  "title",
  "scope",
  "providerHeader",
  "modelHeader",
  "sessionsHeader",
  "msgsHeader",
  "costHeader",
  "tokensHeader",
  "tokensInHeader",
  "tokensOutHeader",
  "cacheHeader",
  "headerLine",
  "footerLine",
];

/** Value-line color elements (provider, model, and data column values). */
export const VALUE_ELEMENTS: ColorElement[] = [
  "providerValue",
  "modelValue",
  "sessionsValue",
  "msgsValue",
  "costValue",
  "tokensValue",
  "tokensInValue",
  "tokensOutValue",
  "cacheValue",
];

// =============================================================================
// Column toggle definitions for the Columns submenu
// =============================================================================

interface ColumnToggleDef {
  id: keyof ModeColumnConfig;
  label: string;
  description: string;
}

const ALL_COLUMNS: ColumnToggleDef[] = [
  {
    id: "provider",
    label: "Provider",
    description: "Show/hide provider name column",
  },
  { id: "model", label: "Model", description: "Show/hide model name column" },
  {
    id: "sessions",
    label: "Sessions",
    description: "Show/hide sessions column",
  },
  { id: "msgs", label: "Msgs", description: "Show/hide messages column" },
  { id: "cost", label: "Cost", description: "Show/hide cost column" },
  {
    id: "tokens",
    label: "Tokens",
    description: "Show/hide total tokens column",
  },
  {
    id: "tokensIn",
    label: "Tokens In",
    description: "Show/hide input tokens column",
  },
  {
    id: "tokensOut",
    label: "Tokens Out",
    description: "Show/hide output tokens column",
  },
  { id: "cache", label: "Cache", description: "Show/hide cache tokens column" },
];

/** Map of display mode for each tab index. 0=Global uses config.defaultMode. */
const TAB_MODE: Record<number, DisplayMode> = {
  0: "summary", // Global tab — uses config.defaultMode
  1: "summary",
  2: "compact",
  3: "Per Model",
  4: "expanded",
};

// =============================================================================
// Customize Layout submenu types
// =============================================================================

interface LayoutItem {
  type: "section" | "setting" | "column";
  id: string;
  label: string;
  value: string; // "Show" | "Hide" | "" (empty for section headers)
}

// =============================================================================
// Navigator depth tracking
// =============================================================================

type NavDepth = 0 | 1 | 2;

/** Which submenu is active at depth 1. */
type SubMenuType =
  | "themeOverride"
  | "columns"
  | "colors"
  | "colorsHeaders"
  | "colorsValues"
  | "presetPicker"
  | "displayModePicker"
  | "activeModes";

// =============================================================================
// Mock UsageData for live preview
// =============================================================================

/**
 * Create minimal mock UsageData so renderWidget can produce a visible preview.
 * The preview shows structure, not real data — it's a UI preview, not a data dashboard.
 */
export function createMockUsageData(): UsageData {
  return {
    lastHour: buildScopeStats(0.08),
    today: buildScopeStats(1.0),
    yesterday: buildScopeStats(0.85),
    thisWeek: buildScopeStats(4.2),
    lastWeek: buildScopeStats(3.8),
    thisMonth: buildScopeStats(18.0),
    allTime: buildScopeStats(38.0),
  };
}

// =============================================================================
// Mock data builder — produces realistic preview data for live preview
// =============================================================================

/**
 * Build a single time scope's stats scaled by the given factor.
 * Base data (scale=1.0) represents one day of heavy usage across 3 providers.
 */
function buildScopeStats(scale: number): TimeFilteredStats {
  const r = (n: number): number => Math.max(0, Math.round(n * scale));
  const sessionsFor = (ids: string[]): Set<string> => new Set(ids);

  // ---- Per-model stats (scale=1.0 values) ----

  // google — Gemini models
  const gemini25ProSessions = sessionsFor(["s1", "s3"]);
  const gemini25FlashSessions = sessionsFor(["s2", "s3"]);

  const gemini25Pro = (): ModelStats => ({
    messages: r(52),
    cost: 3.8 * scale,
    tokens: {
      total: r(390000),
      input: r(285000),
      output: r(102000),
      cacheRead: r(2500),
      cacheWrite: r(500),
    },
    sessions: new Set([...gemini25ProSessions].slice(0, Math.max(1, r(2)))),
  });

  const gemini25Flash = (): ModelStats => ({
    messages: r(35),
    cost: 1.434 * scale,
    tokens: {
      total: r(130000),
      input: r(95000),
      output: r(33000),
      cacheRead: r(1500),
      cacheWrite: r(500),
    },
    sessions: new Set([...gemini25FlashSessions].slice(0, Math.max(1, r(2)))),
  });

  // anthropic — Claude models
  const claudeSonnetSessions = sessionsFor(["s4", "s5"]);
  const claudeHaikuSessions = sessionsFor(["s5", "s6"]);

  const claudeSonnet = (): ModelStats => ({
    messages: r(68),
    cost: 3.85 * scale,
    tokens: {
      total: r(445000),
      input: r(318000),
      output: r(124000),
      cacheRead: r(2200),
      cacheWrite: r(800),
    },
    sessions: new Set([...claudeSonnetSessions].slice(0, Math.max(1, r(2)))),
  });

  const claudeHaiku = (): ModelStats => ({
    messages: r(44),
    cost: 1.397 * scale,
    tokens: {
      total: r(167000),
      input: r(125000),
      output: r(39500),
      cacheRead: r(1600),
      cacheWrite: r(900),
    },
    sessions: new Set([...claudeHaikuSessions].slice(0, Math.max(1, r(2)))),
  });

  // openai — GPT models
  const gpt4oSessions = sessionsFor(["s7", "s8"]);
  const gpt41MiniSessions = sessionsFor(["s7"]);
  const o4MiniSessions = sessionsFor(["s8"]);

  const gpt4o = (): ModelStats => ({
    messages: r(72),
    cost: 2.5 * scale,
    tokens: {
      total: r(210000),
      input: r(148000),
      output: r(57000),
      cacheRead: r(3800),
      cacheWrite: r(1200),
    },
    sessions: new Set([...gpt4oSessions].slice(0, Math.max(1, r(2)))),
  });

  const gpt41Mini = (): ModelStats => ({
    messages: r(38),
    cost: 0.325 * scale,
    tokens: {
      total: r(58000),
      input: r(42000),
      output: r(15000),
      cacheRead: r(800),
      cacheWrite: r(200),
    },
    sessions: new Set([...gpt41MiniSessions].slice(0, Math.max(1, r(1)))),
  });

  const o4Mini = (): ModelStats => ({
    messages: r(33),
    cost: 0.192 * scale,
    tokens: {
      total: r(53500),
      input: r(31000),
      output: r(21800),
      cacheRead: r(400),
      cacheWrite: r(300),
    },
    sessions: new Set([...o4MiniSessions].slice(0, Math.max(1, r(1)))),
  });

  // ---- Models map ----
  const googleModels = new Map<string, ModelStats>();
  googleModels.set("gemini-2.5-pro", gemini25Pro());
  googleModels.set("gemini-2.5-flash", gemini25Flash());

  const anthropicModels = new Map<string, ModelStats>();
  anthropicModels.set("claude-sonnet-4-20250514", claudeSonnet());
  anthropicModels.set("claude-haiku-3.5", claudeHaiku());

  const openaiModels = new Map<string, ModelStats>();
  openaiModels.set("gpt-4o", gpt4o());
  openaiModels.set("gpt-4.1-mini", gpt41Mini());
  openaiModels.set("o4-mini", o4Mini());

  // ---- Aggregate totals per provider ----
  function aggregateProvider(
    models: Map<string, ModelStats>,
    sessionIds: string[],
  ): { stats: Omit<ProviderStats, "models">; sessions: Set<string> } {
    let messages = 0;
    let cost = 0;
    const tokens = {
      total: 0,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    };
    const allSessions = new Set<string>();

    for (const m of models.values()) {
      messages += m.messages;
      cost += m.cost;
      tokens.total += m.tokens.total;
      tokens.input += m.tokens.input;
      tokens.output += m.tokens.output;
      tokens.cacheRead += m.tokens.cacheRead;
      tokens.cacheWrite += m.tokens.cacheWrite;
      for (const s of m.sessions) allSessions.add(s);
    }

    // Ensure at least the expected sessions exist (for small scales)
    for (const id of sessionIds) allSessions.add(id);

    return {
      stats: {
        messages,
        cost: Math.round(cost * 1000) / 1000,
        tokens,
        sessions: allSessions,
      },
      sessions: allSessions,
    };
  }

  const googleAgg = aggregateProvider(googleModels, ["s1", "s2", "s3"]);
  const anthropicAgg = aggregateProvider(anthropicModels, ["s4", "s5", "s6"]);
  const openaiAgg = aggregateProvider(openaiModels, ["s7", "s8"]);

  // ---- Providers map ----
  const providers = new Map<string, ProviderStats>();
  providers.set("google", { ...googleAgg.stats, models: googleModels });
  providers.set("anthropic", {
    ...anthropicAgg.stats,
    models: anthropicModels,
  });
  providers.set("openai", { ...openaiAgg.stats, models: openaiModels });

  // ---- Global totals ----
  const allSessions = new Set([
    ...googleAgg.sessions,
    ...anthropicAgg.sessions,
    ...openaiAgg.sessions,
  ]);

  const totals: TotalStats = {
    messages:
      googleAgg.stats.messages +
      anthropicAgg.stats.messages +
      openaiAgg.stats.messages,
    cost:
      Math.round(
        (googleAgg.stats.cost +
          anthropicAgg.stats.cost +
          openaiAgg.stats.cost) *
          1000,
      ) / 1000,
    tokens: {
      total:
        googleAgg.stats.tokens.total +
        anthropicAgg.stats.tokens.total +
        openaiAgg.stats.tokens.total,
      input:
        googleAgg.stats.tokens.input +
        anthropicAgg.stats.tokens.input +
        openaiAgg.stats.tokens.input,
      output:
        googleAgg.stats.tokens.output +
        anthropicAgg.stats.tokens.output +
        openaiAgg.stats.tokens.output,
      cacheRead:
        googleAgg.stats.tokens.cacheRead +
        anthropicAgg.stats.tokens.cacheRead +
        openaiAgg.stats.tokens.cacheRead,
      cacheWrite:
        googleAgg.stats.tokens.cacheWrite +
        anthropicAgg.stats.tokens.cacheWrite +
        openaiAgg.stats.tokens.cacheWrite,
    },
    sessions: allSessions.size,
  };

  // ---- Insights (empty for mock preview) ----
  const insights: PeriodInsights = { insights: [] };

  return { providers, totals, insights };
}

// =============================================================================
// SettingsMenu Component
// =============================================================================

export class SettingsMenu implements Component {
  private config: UsageWidgetConfig;
  private theme: Theme;
  private tui: { requestRender: () => void };
  private done: () => void;
  private activeTab: TabIndex = 0; // Default to Global tab (first tab)
  /** When true, renders a "Switch widget to [Mode]?" prompt instead of normal content. */
  private showClosePrompt = false;
  /** Flash warning message shown briefly in the mode navigator (cleared on next input). */
  private flashWarning: string | null = null;

  // Customize Layout submenu state (replaces SettingsList)
  private layoutItems: LayoutItem[] = [];
  private layoutCursor: number = 0;
  private reorderMode: boolean = false;
  private reorderDragIndex: number = 0;
  /** Saved column order before entering reorder mode (restored on Esc cancel). */
  private originalColumnOrder: string[] = [];

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

  // Navigator state (shared between Global and Mode tabs)
  private depth: NavDepth = 0;
  private selectedIndex = 0;
  private activeSubMenu: SubMenuType | null = null;
  /** For Global tab: selected navigator index (0=Display Mode, 1=Time Scope, 2=Theme Preset, 3=Colors). */
  private globalNavIndex = 0;
  /** Transient preview preset for live preview hover effect (null = use saved config). */
  private previewPreset: ThemedPreset | null = null;

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

    // Build the Global tab SettingsList (always present)
    // TODO(pi): consider using resolveColor() from color-engine for SettingsList labels
  }

  // ===========================================================================
  // Global tab — unified navigator (4 items)
  // ===========================================================================

  // ===========================================================================
  // Submenu builders (created on demand)
  // ===========================================================================

  /** Get the display mode for the currently active tab. */
  private getActiveTabMode(): string {
    if (this.activeTab === 0) return this.config.defaultMode;
    return TAB_MODE[this.activeTab] ?? "compact";
  }

  /** Get the DisplayMode for the current mode tab (null for Global tab). */
  private getCurrentModeTab(): DisplayMode | null {
    if (this.activeTab === 0) return null;
    return TAB_MODE[this.activeTab] ?? "compact";
  }

  /** Build the items array for the Customize Layout submenu. */
  private buildCustomizeLayoutItems(mode: DisplayMode): LayoutItem[] {
    const columnConfig = this.config.modes[mode];
    const items: LayoutItem[] = [];
    const isSummary = mode === "summary";

    // ---- Section: Settings (only if there are settings to show) ----
    if (!isSummary) {
      items.push({
        type: "section",
        id: "__settings__",
        label: "Settings:",
        value: "",
      });
      items.push({
        type: "setting",
        id: "showTotals",
        label: "Totals Row",
        value: columnConfig.showTotals ? "Show" : "Hide",
      });
      items.push({
        type: "setting",
        id: "showHeaders",
        label: "Headers",
        value: columnConfig.showHeaders ? "Show" : "Hide",
      });
      items.push({
        type: "setting",
        id: "showHeaderLine",
        label: "Header Line",
        value: columnConfig.showHeaderLine ? "Show" : "Hide",
      });
      items.push({
        type: "setting",
        id: "showFooterLine",
        label: "Footer Line",
        value: columnConfig.showFooterLine ? "Show" : "Hide",
      });
    }

    // ---- Section: Columns ----
    items.push({
      type: "section",
      id: "__columns__",
      label: "Columns:",
      value: "",
    });

    // Name columns (provider / model) — conditional on mode
    const isPerModel = mode === "Per Model";
    const showProvider = mode === "expanded" || isPerModel;
    const showModel = mode === "expanded";

    if (showProvider) {
      items.push({
        type: "column",
        id: "provider",
        label: "Provider",
        value: columnConfig.provider ? "Show" : "Hide",
      });
    }
    if (showModel) {
      items.push({
        type: "column",
        id: "model",
        label: "Model",
        value: columnConfig.model ? "Show" : "Hide",
      });
    }

    // Data columns — in configured order
    const order =
      columnConfig.columnOrder && columnConfig.columnOrder.length > 0
        ? columnConfig.columnOrder
        : DEFAULT_COLUMN_ORDER;

    for (const colId of order) {
      const col = ALL_COLUMNS.find((c) => c.id === colId);
      if (col) {
        const visible =
          (columnConfig as Record<string, boolean>)[colId] ?? true;
        items.push({
          type: "column",
          id: colId,
          label: col.label,
          value: visible ? "Show" : "Hide",
        });
      }
    }

    return items;
  }

  /** Toggle a layout item's Show/Hide value and persist. */
  private toggleLayoutItem(mode: DisplayMode, id: string): void {
    const columnConfig = this.config.modes[mode];
    if (id === "showTotals") {
      columnConfig.showTotals = !columnConfig.showTotals;
    } else if (id in columnConfig) {
      const key = id as keyof ModeColumnConfig;
      const current = columnConfig[key];
      if (typeof current === "boolean") {
        (columnConfig as Record<string, boolean>)[id] = !current;
      }
    }
    saveConfig(this.config);
    this.invalidatePreview();
    // Caller is responsible for rebuilding items and requesting render
  }

  /** Get the indices (in layoutItems) of data columns (not name columns). */
  private getDataColumnIndices(): number[] {
    const indices: number[] = [];
    for (let i = 0; i < this.layoutItems.length; i++) {
      const item = this.layoutItems[i]!;
      if (
        item.type === "column" &&
        item.id !== "provider" &&
        item.id !== "model"
      ) {
        indices.push(i);
      }
    }
    return indices;
  }

  /** Swap the selected data column up or down in reorder mode. */
  private moveReorderColumn(dir: -1 | 1, mode: DisplayMode): void {
    const dataIndices = this.getDataColumnIndices();
    const pos = dataIndices.indexOf(this.reorderDragIndex);
    if (pos === -1) return;
    const newPos = pos + dir;
    if (newPos < 0 || newPos >= dataIndices.length) return;

    // Swap the two items in layoutItems
    const a = dataIndices[pos]!;
    const b = dataIndices[newPos]!;
    const temp = this.layoutItems[a]!;
    this.layoutItems[a] = this.layoutItems[b]!;
    this.layoutItems[b] = temp;
    this.reorderDragIndex = b;

    // Update config's columnOrder so the live preview reflects the swap
    this.config.modes[mode].columnOrder = this.layoutItems
      .filter(
        (item) =>
          item.type === "column" &&
          item.id !== "provider" &&
          item.id !== "model",
      )
      .map((item) => item.id);

    // Update preview immediately so user sees column order change in live preview
    this.invalidatePreview();

    this.tui.requestRender();
  }

  /** Persist the current column order from layoutItems to config. */
  private persistColumnOrder(mode: DisplayMode): void {
    const columnConfig = this.config.modes[mode];
    columnConfig.columnOrder = this.layoutItems
      .filter(
        (item) =>
          item.type === "column" &&
          item.id !== "provider" &&
          item.id !== "model",
      )
      .map((item) => item.id);
    saveConfig(this.config);
  }

  // ===========================================================================
  // Customize Layout submenu rendering
  // ===========================================================================

  /** Render the custom layout submenu (Settings section + Columns section). */
  private renderCustomizeLayout(width: number): string[] {
    const lines: string[] = [];
    const innerWidth = width - 4;
    const ac = this.theme.fg.bind(this.theme);

    // Determine if Settings section exists
    const hasSettings =
      this.layoutItems.length > 0 &&
      this.layoutItems[0]!.type === "section" &&
      this.layoutItems[0]!.id === "__settings__";

    // Section: Settings (only if there are setting items)
    if (hasSettings) {
      lines.push(
        "  " +
          ac("dim", "── Settings " + "─".repeat(Math.max(0, innerWidth - 12))),
      );
    }

    for (let i = 0; i < this.layoutItems.length; i++) {
      const item = this.layoutItems[i]!;

      // Section header: switch to Columns section
      if (item.type === "section") {
        if (item.id === "__columns__") {
          lines.push(
            "  " +
              ac(
                "dim",
                "── Columns " + "─".repeat(Math.max(0, innerWidth - 11)),
              ),
          );
        }
        continue;
      }

      const isSelected = i === this.layoutCursor;
      const isReorderDrag = this.reorderMode && i === this.reorderDragIndex;
      const canReorder =
        item.type === "column" && item.id !== "provider" && item.id !== "model";

      // Cursor / reorder indicators
      let cursor: string;
      if (isReorderDrag) {
        cursor = ac("accent", "⇔ ");
      } else if (isSelected && this.reorderMode) {
        cursor = ac("warning", "> ");
      } else if (isSelected) {
        cursor = ac("accent", "▸ ");
      } else {
        cursor = "  ";
      }

      // Label
      const labelText = isSelected
        ? ac("accent", item.label.padEnd(16))
        : ac("text", item.label.padEnd(16));

      // Value
      let valueText: string;
      if (isReorderDrag) {
        valueText = ac("accent", item.value + " ◄►");
      } else if (isSelected && canReorder && !this.reorderMode) {
        valueText = ac("accent", item.value) + ac("dim", "  (r=reorder)");
      } else if (isSelected) {
        valueText = ac("accent", item.value);
      } else {
        valueText = ac("text", item.value);
      }

      lines.push(`  ${cursor} ${labelText} ${valueText}`);
    }

    lines.push("  " + ac("dim", "─".repeat(Math.max(0, innerWidth))));
    lines.push("");

    return lines;
  }

  // ===========================================================================
  // Navigator helpers
  // ===========================================================================

  private navigateBack(): void {
    if (this.depth > 0) {
      const wasDepth = this.depth;
      this.depth = (this.depth - 1) as NavDepth;
      this.selectedIndex = 0;
      this.reorderMode = false;
      this.layoutItems = [];
      this.layoutCursor = 0;
      this.previewPreset = null;
      this.invalidatePreview();
      // Restore parent submenu when returning from depth 2 → 1
      if (this.depth === 1 && wasDepth === 2) {
        this.activeSubMenu = "colors";
      } else if (this.depth === 0) {
        this.activeSubMenu = null;
      }
      this.tui.requestRender();
    }
  }

  /** Get items for the current navigator level. */
  private getNavigatorItems(): string[] {
    if (this.depth === 0) {
      if (this.activeTab === 0) {
        // Global tab: the settings list items + Colors
        return []; // Global tab uses SettingsList directly
      } else {
        return [
          "Enabled",
          "Customize Layout",
          "Theme Preset",
          "Custom Theme Colors",
        ];
      }
    }
    if (this.depth === 1 && this.activeSubMenu === "colors") {
      return ["Headers", "Values"];
    }
    return [];
  }

  // ===========================================================================
  // Preset picker list (used by both Global and mode tab Theme Preset)
  // ===========================================================================

  /** Render the preset picker list submenu. */
  private renderPresetPickerList(width: number): string[] {
    const lines: string[] = [];
    const innerWidth = width - 4;

    lines.push(
      "  " +
        this.theme.fg(
          "dim",
          "┌─ Theme Preset " + "─".repeat(Math.max(0, innerWidth - 15)),
        ),
    );
    lines.push("");

    for (let i = 0; i < THEMED_PRESETS.length; i++) {
      const preset = THEMED_PRESETS[i];
      const label = PRESET_LABELS[preset] ?? preset;
      const isSelected = i === this.selectedIndex;
      const cursor = isSelected ? this.theme.fg("accent", "▸ ") : "  ";
      const swatch = renderColorSwatch(colorPresets[preset].title);
      const text = isSelected
        ? this.theme.fg("accent", label)
        : this.theme.fg("text", label);
      lines.push("  " + cursor + swatch + " " + text);
    }

    lines.push("");
    lines.push(
      "  " +
        this.theme.fg("dim", "└" + "─".repeat(Math.max(0, innerWidth - 1))),
    );
    lines.push("");
    lines.push(
      "  " + this.theme.fg("dim", "↑↓ select  Enter confirm  Esc cancel"),
    );

    return lines;
  }

  /** Handle input in the preset picker list (both Global and per-mode). */
  private handlePresetPickerInput(
    input: string,
    mode: DisplayMode | null,
  ): void {
    if (input === "\x1b[A" || input === "\x1bOA") {
      if (this.selectedIndex > 0) {
        this.selectedIndex--;
        this.previewPreset = THEMED_PRESETS[this.selectedIndex] ?? null;
        this.invalidatePreview();
        this.tui.requestRender();
      }
      return;
    }
    if (input === "\x1b[B" || input === "\x1bOB") {
      if (this.selectedIndex < THEMED_PRESETS.length - 1) {
        this.selectedIndex++;
        this.previewPreset = THEMED_PRESETS[this.selectedIndex] ?? null;
        this.invalidatePreview();
        this.tui.requestRender();
      }
      return;
    }
    if (input === "\r" || input === "\n") {
      const preset = THEMED_PRESETS[this.selectedIndex];
      if (preset) {
        if (mode) {
          // Per-mode override: selecting the same as global clears override
          if (preset === this.config.themedPreset) {
            this.config.perModeThemedPreset[mode] = null;
          } else {
            this.config.perModeThemedPreset[mode] = preset;
          }
        } else {
          this.config.themedPreset = preset;
        }
        this.previewPreset = null;
        saveConfig(this.config);
        this.invalidatePreview();
        this.navigateBack();
      }
      return;
    }
  }

  // ===========================================================================
  // Display mode picker (Global tab — item 0 submenu)
  // ===========================================================================

  /** Render the display mode picker list. */
  private renderDisplayModePicker(width: number): string[] {
    const lines: string[] = [];
    const innerWidth = width - 4;
    const modes = [...DISPLAY_MODES, "hidden" as DisplayMode];

    lines.push(
      "  " +
        this.theme.fg(
          "dim",
          "┌─ Widget Mode " + "─".repeat(Math.max(0, innerWidth - 16)),
        ),
    );
    lines.push("");

    for (let i = 0; i < modes.length; i++) {
      const dm = modes[i]!;
      const label = DISPLAY_MODE_LABELS[dm] ?? dm;
      const isSelected = i === this.selectedIndex;
      const isCurrent = dm === this.config.defaultMode;
      const cursor = isSelected ? this.theme.fg("accent", "▸ ") : "  ";
      const check = isCurrent ? this.theme.fg("success", " ✓") : "";
      const text = isSelected
        ? this.theme.fg("accent", label)
        : this.theme.fg("text", label);
      lines.push("  " + cursor + text + check);
    }

    lines.push("");
    lines.push(
      "  " +
        this.theme.fg("dim", "└" + "─".repeat(Math.max(0, innerWidth - 1))),
    );
    lines.push("");
    lines.push(
      "  " + this.theme.fg("dim", "↑↓ select  Enter confirm  Esc cancel"),
    );

    return lines;
  }

  /** Handle input in the display mode picker. */
  private handleDisplayModePickerInput(input: string): void {
    const modes = [...DISPLAY_MODES, "hidden" as DisplayMode];
    if (input === "\x1b[A" || input === "\x1bOA") {
      if (this.selectedIndex > 0) {
        this.selectedIndex--;
        this.tui.requestRender();
      }
      return;
    }
    if (input === "\x1b[B" || input === "\x1bOB") {
      if (this.selectedIndex < modes.length - 1) {
        this.selectedIndex++;
        this.tui.requestRender();
      }
      return;
    }
    if (input === "\r" || input === "\n") {
      const dm = modes[this.selectedIndex];
      if (dm && dm !== this.config.defaultMode) {
        this.config.defaultMode = dm;
        saveConfig(this.config);
        this.invalidatePreview();
      }
      this.navigateBack();
      return;
    }
  }

  // ===========================================================================
  // Active modes picker
  // ===========================================================================

  /** Render the active modes toggle list in the Global tab submenu. */
  private renderActiveModesPicker(width: number): string[] {
    const lines: string[] = [];
    const innerWidth = width - 4;
    const modes: DisplayMode[] = [
      "summary",
      "compact",
      "Per Model",
      "expanded",
    ];
    const modeLabels: Record<DisplayMode, string> = {
      summary: "Summary",
      compact: "Per Provider",
      "Per Model": "Per Model",
      expanded: "Provider & Model",
      hidden: "Hidden",
    };

    lines.push(
      "  " +
        this.theme.fg(
          "dim",
          "┌─ Active Modes " + "─".repeat(Math.max(0, innerWidth - 15)),
        ),
    );
    lines.push("");

    for (let i = 0; i < modes.length; i++) {
      const mode = modes[i]!;
      const label = modeLabels[mode] ?? mode;
      const enabled = this.config.enabledModes[mode] ?? true;
      const isSelected = i === this.selectedIndex;
      const cursor = isSelected ? this.theme.fg("accent", "▸ ") : "  ";

      // Green ● for enabled, dim ○ for disabled — right next to name
      const indicator = enabled
        ? this.theme.fg("success", "●")
        : this.theme.fg("dim", "○");

      // Build: [ ● ModeName ]
      const badge = "[ " + indicator + " " + label + " ]";

      const text = isSelected
        ? this.theme.fg("accent", badge)
        : enabled
          ? this.theme.fg("text", badge)
          : this.theme.fg("dim", badge);

      lines.push("  " + cursor + text);
    }

    lines.push("");
    lines.push(
      "  " +
        this.theme.fg("dim", "└" + "─".repeat(Math.max(0, innerWidth - 1))),
    );

    return lines;
  }

  /** Handle input in the active modes picker. */
  private handleActiveModesInput(input: string): void {
    const modes: DisplayMode[] = [
      "summary",
      "compact",
      "Per Model",
      "expanded",
    ];

    if (input === "\x1b[A" || input === "\x1bOA") {
      if (this.selectedIndex > 0) {
        this.selectedIndex--;
        this.tui.requestRender();
      }
      return;
    }
    if (input === "\x1b[B" || input === "\x1bOB") {
      if (this.selectedIndex < modes.length - 1) {
        this.selectedIndex++;
        this.tui.requestRender();
      }
      return;
    }

    // Toggle with Enter, Left, or Right
    if (
      input === "\r" ||
      input === "\n" ||
      input === "\x1b[C" ||
      input === "\x1bOC" ||
      input === "\x1b[D" ||
      input === "\x1bOD"
    ) {
      const mode = modes[this.selectedIndex];
      if (mode) {
        this.toggleActiveMode(mode);
        this.tui.requestRender();
      }
      return;
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
  private openColorPicker(
    element: ColorElement,
    mode: DisplayMode | null,
  ): void {
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

  // ===========================================================================
  // Color element rendering helpers
  // ===========================================================================

  /** Get a color swatch for the resolved color of an element. */
  private getResolvedColorSwatch(
    element: ColorElement,
    mode: DisplayMode | null,
  ): string {
    try {
      const ansi = resolveColor(
        element,
        this.config,
        mode ? { mode } : undefined,
      );
      const trueColorMatch = ansi.match(/38;2;(\d+);(\d+);(\d+)/);
      if (trueColorMatch) {
        const r = parseInt(trueColorMatch[1]);
        const g = parseInt(trueColorMatch[2]);
        const b = parseInt(trueColorMatch[3]);
        const hex = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
        return renderColorSwatch(hex);
      }
      return `${ansi}██\x1b[0m`;
    } catch {
      return "??";
    }
  }

  // ===========================================================================
  // Color submenu rendering (Headers / Values)
  // ===========================================================================

  /** Render a color element list (for Headers or Values submenu at depth 2). */
  private renderColorElementList(
    elements: ColorElement[],
    mode: DisplayMode | null,
    width: number,
    sectionLabel: string,
  ): string[] {
    const lines: string[] = [];
    const innerWidth = width - 4;
    const maxVisible = Math.min(elements.length, 12);

    // Section header
    lines.push("");
    lines.push(
      "  " +
        this.theme.fg(
          "dim",
          `┌─ ${sectionLabel} ` +
            "─".repeat(Math.max(0, innerWidth - sectionLabel.length - 4)),
        ),
    );
    lines.push("");

    for (let i = 0; i < Math.min(maxVisible, elements.length); i++) {
      const element = elements[i];
      const label = ELEMENT_LABELS[element] ?? element;
      const isSelected = i === this.selectedIndex;

      // Get override value
      const overrides = mode
        ? this.config.perModeColorOverrides[mode]
        : this.config.globalColorOverrides;
      const overrideVal =
        (overrides as Record<string, string | null>)[element] ?? null;

      const cursor = isSelected ? this.theme.fg("accent", "▸") : " ";
      const swatch = this.getResolvedColorSwatch(element, mode);

      const isOverridden = overrideVal !== null && overrideVal !== "";
      const prefix = isOverridden ? "*" : " ";
      const labelText = isSelected
        ? this.theme.fg("accent", `${prefix}${label}`.padEnd(18))
        : this.theme.fg("text", `${prefix}${label}`.padEnd(18));

      const valueText = isOverridden
        ? this.theme.fg(isSelected ? "accent" : "text", overrideVal!)
        : this.theme.fg("dim", "(inherit)");

      lines.push(`  ${cursor} ${swatch} ${labelText} ${valueText}`);
    }

    lines.push("");
    lines.push(
      "  " +
        this.theme.fg("dim", "└" + "─".repeat(Math.max(0, innerWidth - 1))),
    );
    lines.push("");

    // Hint
    const hint = "Enter edit  d=reset  Esc back";
    lines.push("  " + this.theme.fg("dim", hint));

    return lines;
  }

  // ===========================================================================
  // Navigator rendering (mode tabs at depth 0 and colors submenu at depth 1)
  // ===========================================================================

  /** Render the 4-item navigator for mode tabs at depth 0. */
  private renderModeNavigator(width: number): string[] {
    const mode = this.getCurrentModeTab();
    if (!mode) return [];
    const lines: string[] = [];

    // Flash warning
    if (this.flashWarning) {
      lines.push("  " + this.theme.fg("warning", this.flashWarning));
      lines.push("");
    }

    // ---- Item 0: Enabled ----
    const enabled = this.config.enabledModes[mode] ?? true;
    const isSelected0 = this.selectedIndex === 0 && this.depth === 0;
    const cursor0 = isSelected0 ? this.theme.fg("accent", "▸ ") : "  ";
    const label0 = isSelected0
      ? this.theme.fg("accent", "Enabled: ")
      : this.theme.fg("text", "Enabled: ");
    const value0 = isSelected0
      ? this.theme.fg("accent", enabled ? "On" : "Off")
      : this.theme.fg("text", enabled ? "On" : "Off");
    const toggle0 = this.theme.fg("dim", " ◐");
    lines.push(cursor0 + label0 + value0 + toggle0);

    // ---- Item 1: Customize Layout ----
    const isSelected1 = this.selectedIndex === 1 && this.depth === 0;
    const cursor1 = isSelected1 ? this.theme.fg("accent", "▸ ") : "  ";
    const label1 = isSelected1
      ? this.theme.fg("accent", "Customize Layout")
      : this.theme.fg("text", "Customize Layout");
    const arrow1 = this.theme.fg("dim", " ▶");
    lines.push(cursor1 + label1 + arrow1);

    // ---- Item 2: Theme Preset ----
    const overridePreset = this.config.perModeThemedPreset[mode];
    const effectivePreset = overridePreset ?? this.config.themedPreset;
    const presetLabel = PRESET_LABELS[effectivePreset] ?? effectivePreset;
    const statusTag = overridePreset ? " (Override)" : " (Global)";
    const themeValue = presetLabel + statusTag;

    const isSelected2 = this.selectedIndex === 2 && this.depth === 0;
    const cursor2 = isSelected2 ? this.theme.fg("accent", "▸ ") : "  ";
    const label2 = isSelected2
      ? this.theme.fg("accent", "Theme Preset: ")
      : this.theme.fg("text", "Theme Preset: ");
    const value2 = isSelected2
      ? this.theme.fg("accent", themeValue)
      : this.theme.fg("text", themeValue);
    lines.push(cursor2 + label2 + value2);

    // ---- Item 3: Custom Theme Colors ----
    const isSelected3 = this.selectedIndex === 3 && this.depth === 0;
    const cursor3 = isSelected3 ? this.theme.fg("accent", "▸ ") : "  ";
    const label3 = isSelected3
      ? this.theme.fg("accent", "Custom Theme Colors")
      : this.theme.fg("text", "Custom Theme Colors");
    const arrow3 = this.theme.fg("dim", " ▶");
    lines.push(cursor3 + label3 + arrow3);

    return lines;
  }

  /** Render the Colors submenu at depth 1 (Headers / Values). */
  private renderColorsSubmenu(width: number): string[] {
    const lines: string[] = [];
    const innerWidth = width - 4;

    // ---- Back ----
    const isSelected0 = this.selectedIndex === 0;
    const cursor0 = isSelected0 ? this.theme.fg("accent", "▸ ") : "  ";
    const label0 = isSelected0
      ? this.theme.fg("accent", "◀ Back")
      : this.theme.fg("text", "◀ Back");
    lines.push("  " + cursor0 + label0);

    // ---- Headers ----
    const isSelected1 = this.selectedIndex === 1;
    const cursor1 = isSelected1 ? this.theme.fg("accent", "▸ ") : "  ";
    const label1 = isSelected1
      ? this.theme.fg("accent", "Headers")
      : this.theme.fg("text", "Headers");
    const arrow1 = this.theme.fg("dim", " ▶");
    lines.push("  " + cursor1 + label1 + arrow1);

    // ---- Values ----
    const isSelected2 = this.selectedIndex === 2;
    const cursor2 = isSelected2 ? this.theme.fg("accent", "▸ ") : "  ";
    const label2 = isSelected2
      ? this.theme.fg("accent", "Values")
      : this.theme.fg("text", "Values");
    const arrow2 = this.theme.fg("dim", " ▶");
    lines.push("  " + cursor2 + label2 + arrow2);

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

    // If a preset is being hovered, preview with that preset's colors
    const effectiveConfig =
      this.previewPreset !== null
        ? { ...this.config, themedPreset: this.previewPreset }
        : this.config;

    // Skip cache when previewing a transient preset
    if (
      this.previewPreset === null &&
      this.previewCacheWidth === width &&
      this.previewCacheMode === previewMode &&
      this.previewCache.length > 0
    ) {
      return this.previewCache;
    }

    try {
      const mockData = createMockUsageData();
      const lines = renderWidget(
        effectiveConfig,
        this.theme,
        mockData,
        width,
        previewMode,
      );
      if (this.previewPreset === null) {
        this.previewCache = lines;
        this.previewCacheWidth = width;
        this.previewCacheMode = previewMode;
      }
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
    const idx = this.globalNavIndex;
    const ac = this.theme.fg.bind(this.theme);

    // ---- Item 0: Display Mode ----
    const modeLabel =
      DISPLAY_MODE_LABELS[this.config.defaultMode] ?? this.config.defaultMode;
    const sel0 = idx === 0;
    const c0 = sel0 ? ac("accent", "▸ ") : "  ";
    const l0 = sel0
      ? ac("accent", "Default Widget Mode: ")
      : ac("text", "Default Widget Mode: ");
    const v0 = sel0 ? ac("accent", modeLabel) : ac("text", modeLabel);
    const a0 = ac("dim", " ▶");
    lines.push(c0 + l0 + v0 + a0);

    // ---- Item 1: Time Scope ----
    const scopeLabel =
      TIME_SCOPE_LABELS[this.config.defaultScope] ?? this.config.defaultScope;
    const sel1 = idx === 1;
    const c1 = sel1 ? ac("accent", "▸ ") : "  ";
    const l1 = sel1 ? ac("accent", "Time Scope: ") : ac("text", "Time Scope: ");
    const v1 = sel1 ? ac("accent", scopeLabel) : ac("text", scopeLabel);
    lines.push(c1 + l1 + v1);

    // ---- Item 2: Theme Preset ----
    const presetLabel =
      PRESET_LABELS[this.config.themedPreset] ?? this.config.themedPreset;
    const sel2 = idx === 2;
    const c2 = sel2 ? ac("accent", "▸ ") : "  ";
    const l2 = sel2
      ? ac("accent", "Theme Preset: ")
      : ac("text", "Theme Preset: ");
    const v2 = sel2 ? ac("accent", presetLabel) : ac("text", presetLabel);
    lines.push(c2 + l2 + v2);

    // ---- Item 3: Custom Theme Colors ----
    const sel3 = idx === 3;
    const c3 = sel3 ? ac("accent", "▸ ") : "  ";
    const l3 = sel3
      ? ac("accent", "Custom Theme Colors")
      : ac("text", "Custom Theme Colors");
    const a3 = ac("dim", " ▶");
    lines.push(c3 + l3 + a3);

    // ---- Item 4: Active Modes ----
    const enabledList = (
      ["summary", "compact", "Per Model", "expanded"] as DisplayMode[]
    )
      .filter((m) => this.config.enabledModes[m] ?? true)
      .map((m) => DISPLAY_MODE_LABELS[m] ?? m)
      .join(", ");
    const activeModesLabel = enabledList
      ? `Active Modes: ${enabledList}`
      : "Active Modes";
    const sel4 = idx === 4;
    const c4 = sel4 ? ac("accent", "▸ ") : "  ";
    const l4 = sel4
      ? ac("accent", activeModesLabel)
      : ac("text", activeModesLabel);
    const a4 = ac("dim", " ▶");
    lines.push(c4 + l4 + a4);

    return lines;
  }

  private renderModeTabContent(mode: DisplayMode, width: number): string[] {
    const lines: string[] = [];

    if (this.depth === 0) {
      // Main navigator
      lines.push(...this.renderModeNavigator(width));
    }

    return lines;
  }

  private renderTabContent(width: number): string[] {
    // Colors submenu at depth 1 works the same for both Global and mode tabs
    if (this.depth === 1 && this.activeSubMenu === "colors") {
      const lines: string[] = [];
      lines.push(
        "  " +
          this.theme.fg(
            "dim",
            "┌─ Custom Theme Colors " + "─".repeat(Math.max(0, width - 25)),
          ),
      );
      lines.push("");
      lines.push(...this.renderColorsSubmenu(width));
      lines.push("");
      lines.push(
        "  " + this.theme.fg("dim", "└" + "─".repeat(Math.max(0, width - 3))),
      );
      return lines;
    }

    // Color element lists at depth 2 work the same for both Global and mode tabs
    if (
      this.depth === 2 &&
      (this.activeSubMenu === "colorsHeaders" ||
        this.activeSubMenu === "colorsValues")
    ) {
      const elements =
        this.activeSubMenu === "colorsHeaders"
          ? HEADER_ELEMENTS
          : VALUE_ELEMENTS;
      const sectionLabel =
        this.activeSubMenu === "colorsHeaders" ? "Headers" : "Values";
      const mode =
        this.activeTab === 0 ? null : (TAB_MODE[this.activeTab] ?? "compact");
      return this.renderColorElementList(elements, mode, width, sectionLabel);
    }

    if (this.activeTab >= 1 && this.activeTab <= 4) {
      const mode = TAB_MODE[this.activeTab];
      return this.renderModeTabContent(mode, width);
    }
    if (this.activeTab === 0) {
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

    // Build each tab as [● Name] with indicator inside the brackets
    let segments: string[] = [];
    let totalVisible = 0;

    for (let i = 0; i < TAB_NAMES.length; i++) {
      const name = TAB_NAMES[i];
      const isActive = i === this.activeTab;
      const isModeTab = i > 0;
      const mode = isModeTab ? TAB_MODE[i] : null;
      const enabled = mode ? (this.config.enabledModes[mode] ?? true) : true;

      // Build the indicator (mode tabs only)
      const indicator = isModeTab
        ? (enabled
            ? this.theme.fg("success", "●")
            : this.theme.fg("dim", "○")) + " "
        : "";

      // Build text inside brackets with padding: [ <indicator>Name ]
      const inner = indicator + name;
      const segment = "[ " + inner + " ]";

      // Color the segment
      let colored: string;
      if (isActive) {
        colored = this.theme.bg("selectedBg", this.theme.fg("text", segment));
      } else if (isModeTab && !enabled) {
        colored = this.theme.fg("dim", segment);
      } else {
        colored = this.theme.fg("text", segment);
      }

      segments.push(colored);
      totalVisible += visibleWidth(segment);
    }

    // Join with one space between tabs
    const totalWithSpaces = totalVisible + segments.length - 1;
    let line = " ";

    // If too wide, use equal-width tabs
    if (totalWithSpaces > width - 2) {
      const tabWidth = Math.min(
        14,
        Math.floor((width - 4 - (TAB_NAMES.length - 1)) / TAB_NAMES.length),
      );
      for (let i = 0; i < TAB_NAMES.length; i++) {
        const name = TAB_NAMES[i];
        const isActive = i === this.activeTab;
        const isModeTab = i > 0;
        const mode = isModeTab ? TAB_MODE[i] : null;
        const enabled = mode ? (this.config.enabledModes[mode] ?? true) : true;

        const indicator = isModeTab
          ? enabled
            ? this.theme.fg("success", "●")
            : this.theme.fg("dim", "○")
          : "";

        // Bracketed format: [● Name]
        // displayName truncated to leave room for brackets (2) + indicator (1) + spaces (2)
        const bracketOverhead = 5; // "[" + "●" + " " + " " + "]"
        const displayName =
          name.length > tabWidth - bracketOverhead
            ? name.slice(0, tabWidth - bracketOverhead - 2) + "…"
            : name;

        const padding = Math.max(
          0,
          tabWidth - displayName.length - bracketOverhead,
        );
        const leftPad = Math.floor(padding / 2);
        const rightPad = Math.ceil(padding / 2);
        const padded =
          "[" + indicator + " " + displayName + " ".repeat(rightPad) + "]";
        const totalLen = visibleWidth(padded);

        if (isActive) {
          line +=
            this.theme.bg("selectedBg", this.theme.fg("text", padded)) +
            " ".repeat(Math.max(0, tabWidth - totalLen));
        } else {
          line +=
            (enabled
              ? this.theme.fg("text", padded)
              : this.theme.fg("dim", padded)) +
            " ".repeat(Math.max(0, tabWidth - totalLen));
        }
      }
    } else {
      // Wide enough — use bracket style
      for (let i = 0; i < segments.length; i++) {
        line += segments[i];
        if (i < segments.length - 1) line += " ";
      }
    }

    line += " ";
    return [line];
  }

  private renderHintBar(width: number): string[] {
    let hints: string;
    if (this.depth === 2) {
      hints = "↑↓ navigate  Enter edit  d=reset  Esc back";
    } else if (this.depth === 1) {
      hints = "↑↓ select  Enter open  Esc back";
    } else {
      hints = "← → tabs  ↑↓ select  ← → cycle  Enter open  Esc/q close";
    }
    if (width < hints.length + 2) return [];
    const leftPad = Math.floor((width - hints.length) / 2);
    return [this.theme.fg("dim", " ".repeat(leftPad) + hints)];
  }

  // ===========================================================================
  // Focus section tracking
  // ===========================================================================

  // ===========================================================================
  // Shared live preview renderer
  // ===========================================================================

  private renderPreviewSection(width: number): string[] {
    const lines: string[] = [];
    lines.push("");
    const modeLabel =
      DISPLAY_MODE_LABELS[this.getActiveTabMode() as DisplayMode] ??
      this.getActiveTabMode();
    const suffix = ` - ${modeLabel}`;
    const baseLen = 18 + suffix.length;
    const previewLabel = this.theme.fg(
      "dim",
      "┌─ Live Preview" +
        suffix +
        " " +
        "─".repeat(Math.max(0, width - baseLen)),
    );
    lines.push(previewLabel);
    const previewWidth = Math.max(0, width - 1);
    const previewLines = this.renderPreview(previewWidth);
    for (const line of previewLines) {
      lines.push(" " + line);
    }
    lines.push(this.theme.fg("dim", "└" + "─".repeat(Math.max(0, width - 1))));
    lines.push("");
    return lines;
  }

  // ===========================================================================
  // Main render
  // ===========================================================================

  render(width: number): string[] {
    const safeWidth = Math.max(width, 40);

    // If color picker is active, render it instead of normal content
    if (this.colorPicker) {
      const elementName = this.editingElement
        ? (ELEMENT_LABELS[this.editingElement] ?? this.editingElement)
        : "Unknown";
      const context = this.editingMode
        ? `${elementName} (${this.editingMode} mode)`
        : `${elementName} (global)`;

      const pickerLines = this.colorPicker.render(safeWidth);
      return [this.theme.fg("dim", `Editing: ${context}`), "", ...pickerLines];
    }

    // Close prompt — ask user if they want to switch to the tab's mode
    if (this.showClosePrompt) {
      const tabMode = this.getCurrentModeTab();
      const modeLabel = tabMode
        ? (DISPLAY_MODE_LABELS[tabMode] ?? tabMode)
        : "?";
      const msg = `Switch widget to ${modeLabel} mode? (y/n)`;
      const pad = Math.max(2, Math.floor((safeWidth - msg.length) / 2));
      return [
        this.theme.fg("border", "─".repeat(safeWidth)),
        "",
        " ".repeat(pad) + this.theme.fg("accent", msg),
        "",
        this.theme.fg("border", "─".repeat(safeWidth)),
      ];
    }

    // Customize Layout submenu — custom rendering
    if (this.depth === 1 && this.activeSubMenu === "columns") {
      const lines: string[] = [];

      // Top border
      lines.push(this.theme.fg("border", "─".repeat(safeWidth)));

      // Title
      const title = " Customize Layout ";
      const titlePad = Math.floor((safeWidth - title.length) / 2);
      lines.push(
        this.theme.fg(
          "border",
          "─".repeat(titlePad) +
            title +
            "─".repeat(safeWidth - titlePad - title.length),
        ),
      );
      lines.push("");

      // Live preview
      lines.push(...this.renderPreviewSection(safeWidth));

      // Custom layout content
      const layoutLines = this.renderCustomizeLayout(safeWidth);
      for (const line of layoutLines) {
        lines.push(line);
      }

      lines.push(this.theme.fg("dim", "─".repeat(safeWidth)));
      const hint = this.reorderMode
        ? "↑↓ move column • Enter done • Esc cancel reorder"
        : "↑↓ select • Enter toggle • r reorder • Esc back";
      const leftPad = Math.floor((safeWidth - hint.length) / 2);
      lines.push(this.theme.fg("dim", " ".repeat(leftPad) + hint));
      lines.push(this.theme.fg("border", "─".repeat(safeWidth)));

      return lines;
    }

    // If display mode picker is active
    if (this.depth === 1 && this.activeSubMenu === "displayModePicker") {
      const lines: string[] = [];

      // Top border
      lines.push(this.theme.fg("border", "─".repeat(safeWidth)));

      // Title
      const title = " Widget Mode ";
      const titlePad = Math.floor((safeWidth - title.length) / 2);
      lines.push(
        this.theme.fg(
          "border",
          "─".repeat(titlePad) +
            title +
            "─".repeat(safeWidth - titlePad - title.length),
        ),
      );
      lines.push("");

      // Live preview
      lines.push(...this.renderPreviewSection(safeWidth));

      // Display mode picker list
      const pickerLines = this.renderDisplayModePicker(safeWidth);
      for (const line of pickerLines) {
        lines.push(line);
      }

      lines.push("");
      lines.push(this.theme.fg("border", "─".repeat(safeWidth)));

      return lines;
    }

    // If active modes picker is active
    if (this.depth === 1 && this.activeSubMenu === "activeModes") {
      const lines: string[] = [];

      // Top border
      lines.push(this.theme.fg("border", "─".repeat(safeWidth)));

      // Title
      const title = " Active Modes ";
      const titlePad = Math.floor((safeWidth - title.length) / 2);
      lines.push(
        this.theme.fg(
          "border",
          "─".repeat(titlePad) +
            title +
            "─".repeat(safeWidth - titlePad - title.length),
        ),
      );
      lines.push("");

      // Active modes picker list
      const pickerLines = this.renderActiveModesPicker(safeWidth);
      for (const line of pickerLines) {
        lines.push(line);
      }

      lines.push("");
      lines.push(this.theme.fg("dim", "─".repeat(safeWidth)));
      const hint = "Enter / ← → toggle  Esc back";
      const leftPad = Math.floor((safeWidth - hint.length) / 2);
      lines.push(this.theme.fg("dim", " ".repeat(leftPad) + hint));
      lines.push(this.theme.fg("border", "─".repeat(safeWidth)));

      return lines;
    }

    // If preset picker is active (depth 1 for themeOverride or presetPicker), render it
    if (
      this.depth === 1 &&
      (this.activeSubMenu === "themeOverride" ||
        this.activeSubMenu === "presetPicker")
    ) {
      const lines: string[] = [];

      // Top border
      lines.push(this.theme.fg("border", "─".repeat(safeWidth)));

      // Title
      const title = " Theme Preset ";
      const titlePad = Math.floor((safeWidth - title.length) / 2);
      lines.push(
        this.theme.fg(
          "border",
          "─".repeat(titlePad) +
            title +
            "─".repeat(safeWidth - titlePad - title.length),
        ),
      );
      lines.push("");

      // Live preview
      lines.push(...this.renderPreviewSection(safeWidth));

      // Preset picker list
      const pickerLines = this.renderPresetPickerList(safeWidth);
      for (const line of pickerLines) {
        lines.push(line);
      }

      lines.push("");
      lines.push(this.theme.fg("border", "─".repeat(safeWidth)));

      return lines;
    }

    const lines: string[] = [];

    // Top border
    lines.push(this.theme.fg("border", "─".repeat(safeWidth)));

    // Title
    const title = " Usage Settings ";
    const titlePad = Math.floor((safeWidth - title.length) / 2);
    lines.push(
      this.theme.fg(
        "border",
        "─".repeat(titlePad) +
          title +
          "─".repeat(safeWidth - titlePad - title.length),
      ),
    );

    // Live preview section
    lines.push(...this.renderPreviewSection(safeWidth));

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
    // Clear any flash warning on input
    if (this.flashWarning) {
      this.flashWarning = null;
      this.tui.requestRender();
    }

    // ── Reorder mode: Esc / q always cancels reorder, never navigates back ──
    if (this.reorderMode && (input === "\x1b" || input === "q")) {
      this.handleLayoutInput(input);
      return;
    }

    // If color picker is active, delegate to it
    if (this.colorPicker) {
      this.colorPicker.handleInput(input);
      this.tui.requestRender();
      return;
    }

    // Prompt close — handle y/n when close prompt is shown
    if (this.showClosePrompt) {
      if (input === "y" || input === "Y") {
        // Switch to the tab's mode
        const tabMode = this.getCurrentModeTab();
        if (tabMode && tabMode !== this.config.defaultMode) {
          this.config.defaultMode = tabMode;
          saveConfig(this.config);
        }
        this.done();
      } else if (input === "n" || input === "N" || input === "\x1b") {
        this.done();
      }
      return;
    }

    // Escape / q — close menu or navigate back
    if (input === "\x1b" || input === "q") {
      if (this.depth > 0) {
        // If in reorder mode inside columns submenu, let handleLayoutInput cancel it
        if (this.reorderMode && this.activeSubMenu === "columns") {
          this.handleLayoutInput(input);
          return;
        }
        this.navigateBack();
        return;
      }
      // If on a mode tab and the tab's mode differs from the active widget mode, prompt
      if (this.activeTab > 0) {
        const tabMode = this.getCurrentModeTab();
        if (tabMode && tabMode !== this.config.defaultMode) {
          this.showClosePrompt = true;
          this.tui.requestRender();
          return;
        }
      }
      this.done();
      return;
    }

    // Tab switching via left/right arrows
    if (input === "\x1b[C" || input === "\x1bOC") {
      if (this.depth > 0) return; // Block tab switching in submenus
      this.activeTab = ((this.activeTab + 1) % TAB_NAMES.length) as TabIndex;
      this.globalNavIndex = 0;
      this.selectedIndex = 0;
      this.depth = 0;
      this.reorderMode = false;
      this.layoutItems = [];
      this.layoutCursor = 0;
      this.activeSubMenu = null;
      this.invalidatePreview();
      this.tui.requestRender();
      return;
    }
    if (input === "\x1b[D" || input === "\x1bOD") {
      if (this.depth > 0) return; // Block tab switching in submenus
      this.activeTab = ((this.activeTab - 1 + TAB_NAMES.length) %
        TAB_NAMES.length) as TabIndex;
      this.globalNavIndex = 0;
      this.selectedIndex = 0;
      this.depth = 0;
      this.reorderMode = false;
      this.layoutItems = [];
      this.layoutCursor = 0;
      this.activeSubMenu = null;
      this.invalidatePreview();
      this.tui.requestRender();
      return;
    }

    // Handle Customize Layout submenu input
    if (this.depth === 1 && this.activeSubMenu === "columns") {
      this.handleLayoutInput(input);
      return;
    }

    // Handle navigation based on active tab and depth
    if (this.activeTab === 0) {
      this.handleGlobalTabInput(input);
    } else {
      this.handleModeTabInput(input);
    }
  }

  // ===========================================================================
  // Global tab input
  // ===========================================================================
  // Customize Layout submenu input
  // ===========================================================================

  private handleLayoutInput(input: string): void {
    const mode = this.getCurrentModeTab();
    if (!mode) return;

    // Reorder mode: handle arrow keys and confirm/cancel
    if (this.reorderMode) {
      if (input === "\x1b[A" || input === "\x1bOA") {
        this.moveReorderColumn(-1, mode);
        return;
      }
      if (input === "\x1b[B" || input === "\x1bOB") {
        this.moveReorderColumn(1, mode);
        return;
      }
      if (input === "\r" || input === "\n") {
        // Confirm reorder — persist to disk and exit reorder mode
        this.persistColumnOrder(mode);
        this.originalColumnOrder = [];
        this.reorderMode = false;
        this.tui.requestRender();
        return;
      }
      if (input === "\x1b") {
        // Cancel reorder — restore original column order and reload
        this.config.modes[mode].columnOrder = [...this.originalColumnOrder];
        this.originalColumnOrder = [];
        this.reorderMode = false;
        this.layoutItems = this.buildCustomizeLayoutItems(mode);
        this.invalidatePreview();
        this.tui.requestRender();
        return;
      }
      return;
    }

    // Normal mode input
    if (input === "\x1b[A" || input === "\x1bOA") {
      // Move cursor up, skipping section headers
      let newCursor = this.layoutCursor - 1;
      while (
        newCursor >= 0 &&
        this.layoutItems[newCursor]!.type === "section"
      ) {
        newCursor--;
      }
      if (newCursor >= 0) {
        this.layoutCursor = newCursor;
        this.tui.requestRender();
      }
      return;
    }

    if (input === "\x1b[B" || input === "\x1bOB") {
      // Move cursor down, skipping section headers
      let newCursor = this.layoutCursor + 1;
      while (
        newCursor < this.layoutItems.length &&
        this.layoutItems[newCursor]!.type === "section"
      ) {
        newCursor++;
      }
      if (newCursor < this.layoutItems.length) {
        this.layoutCursor = newCursor;
        this.tui.requestRender();
      }
      return;
    }

    // Left/Right or Enter to toggle
    if (
      input === "\x1b[C" ||
      input === "\x1bOC" ||
      input === "\x1b[D" ||
      input === "\x1bOD" ||
      input === "\r" ||
      input === "\n"
    ) {
      const item = this.layoutItems[this.layoutCursor];
      if (item && item.type !== "section") {
        this.toggleLayoutItem(mode, item.id);
        // Refresh items to reflect new values
        this.layoutItems = this.buildCustomizeLayoutItems(mode);
        this.tui.requestRender();
      }
      return;
    }

    // "r" hotkey — enter reorder mode on a data column
    if (input === "r" || input === "R") {
      const item = this.layoutItems[this.layoutCursor];
      if (
        item &&
        item.type === "column" &&
        item.id !== "provider" &&
        item.id !== "model"
      ) {
        // Save original order before entering reorder (for Esc cancel)
        this.originalColumnOrder = [
          ...(this.config.modes[mode].columnOrder ?? DEFAULT_COLUMN_ORDER),
        ];
        this.reorderMode = true;
        this.reorderDragIndex = this.layoutCursor;
        this.tui.requestRender();
      }
      return;
    }

    // Escape to go back
    if (input === "\x1b") {
      this.navigateBack();
      return;
    }
  }

  // ===========================================================================

  private handleGlobalTabInput(input: string): void {
    // ---- Submenu states (depth > 0) ----
    if (this.depth === 1 && this.activeSubMenu === "displayModePicker") {
      this.handleDisplayModePickerInput(input);
      return;
    }
    if (this.depth === 1 && this.activeSubMenu === "activeModes") {
      this.handleActiveModesInput(input);
      return;
    }
    if (this.depth === 1 && this.activeSubMenu === "presetPicker") {
      this.handlePresetPickerInput(input, null);
      return;
    }
    if (this.depth === 1 && this.activeSubMenu === "colors") {
      // Colors submenu navigation (Back / Headers / Values)
      if (input === "\x1b[A" || input === "\x1bOA") {
        if (this.selectedIndex > 0) {
          this.selectedIndex--;
          this.tui.requestRender();
        }
        return;
      }
      if (input === "\x1b[B" || input === "\x1bOB") {
        if (this.selectedIndex < 2) {
          this.selectedIndex++;
          this.tui.requestRender();
        }
        return;
      }
      if (input === "\r" || input === "\n") {
        if (this.selectedIndex === 0) {
          this.navigateBack();
        } else if (this.selectedIndex === 1) {
          this.depth = 2;
          this.selectedIndex = 0;
          this.activeSubMenu = "colorsHeaders";
          this.tui.requestRender();
        } else {
          this.depth = 2;
          this.selectedIndex = 0;
          this.activeSubMenu = "colorsValues";
          this.tui.requestRender();
        }
        return;
      }
      return;
    }
    if (
      this.depth === 2 &&
      (this.activeSubMenu === "colorsHeaders" ||
        this.activeSubMenu === "colorsValues")
    ) {
      const elements =
        this.activeSubMenu === "colorsHeaders"
          ? HEADER_ELEMENTS
          : VALUE_ELEMENTS;
      if (input === "\x1b[A" || input === "\x1bOA") {
        if (this.selectedIndex > 0) {
          this.selectedIndex--;
          this.tui.requestRender();
        }
        return;
      }
      if (input === "\x1b[B" || input === "\x1bOB") {
        if (this.selectedIndex < elements.length - 1) {
          this.selectedIndex++;
          this.tui.requestRender();
        }
        return;
      }
      if (input === "\r" || input === "\n") {
        const element = elements[this.selectedIndex];
        if (element) {
          this.openColorPicker(element, null);
        }
        return;
      }
      if (input === "d") {
        const element = elements[this.selectedIndex];
        if (element) {
          this.config.globalColorOverrides[element] = null;
          saveConfig(this.config);
          this.invalidatePreview();
          this.tui.requestRender();
        }
        return;
      }
      return;
    }

    // ---- Depth 0: navigate the 5 items ----
    // Up/down navigate the 5 items
    if (input === "\x1b[A" || input === "\x1bOA") {
      if (this.globalNavIndex > 0) {
        this.globalNavIndex--;
        this.tui.requestRender();
      }
      return;
    }
    if (input === "\x1b[B" || input === "\x1bOB") {
      if (this.globalNavIndex < 4) {
        this.globalNavIndex++;
        this.tui.requestRender();
      }
      return;
    }

    // Left/right cycle values on Time Scope (item 1)
    if (input === "\x1b[C" || input === "\x1bOC") {
      if (this.globalNavIndex === 1) this.cycleGlobalItem(1);
      return;
    }
    if (input === "\x1b[D" || input === "\x1bOD") {
      if (this.globalNavIndex === 1) this.cycleGlobalItem(-1);
      return;
    }

    // Enter on item
    if (input === "\r" || input === "\n") {
      if (this.globalNavIndex === 0) {
        // Display Mode — open picker submenu
        this.depth = 1;
        this.selectedIndex = 0;
        this.activeSubMenu = "displayModePicker";
        this.tui.requestRender();
      } else if (this.globalNavIndex === 1) {
        // Time Scope — cycle forward
        this.cycleGlobalItem(1);
      } else if (this.globalNavIndex === 2) {
        // Theme Preset — open preset picker
        this.depth = 1;
        this.selectedIndex = 0;
        this.activeSubMenu = "presetPicker";
        this.previewPreset = THEMED_PRESETS[0] ?? null;
        this.invalidatePreview();
        this.tui.requestRender();
      } else if (this.globalNavIndex === 3) {
        // Custom Theme Colors
        this.depth = 1;
        this.selectedIndex = 0;
        this.activeSubMenu = "colors";
        this.tui.requestRender();
      } else {
        // Active Modes
        this.depth = 1;
        this.selectedIndex = 0;
        this.activeSubMenu = "activeModes";
        this.tui.requestRender();
      }
      return;
    }
  }

  /** Cycle Time Scope value by direction (+1 or -1). */
  private cycleGlobalItem(dir: number): void {
    if (this.globalNavIndex === 1) {
      const scopes = TIME_SCOPES;
      const idx = scopes.indexOf(this.config.defaultScope);
      const next =
        scopes[(((idx + dir) % scopes.length) + scopes.length) % scopes.length];
      if (next && next !== this.config.defaultScope) {
        this.config.defaultScope = next;
        saveConfig(this.config);
        this.invalidatePreview();
        this.tui.requestRender();
      }
    }
    // items 2-3 don't cycle
  }

  // ===========================================================================
  // Mode tab input
  // ===========================================================================

  private handleModeTabInput(input: string): void {
    const mode = this.getCurrentModeTab();
    if (!mode) return;

    // ---- Depth 0: Main navigator ----
    if (this.depth === 0) {
      const itemCount = 4; // Enabled, Customize Layout, Theme Preset, Colors

      if (input === "\x1b[A" || input === "\x1bOA") {
        if (this.selectedIndex > 0) {
          this.selectedIndex--;
          this.tui.requestRender();
        }
        return;
      }
      if (input === "\x1b[B" || input === "\x1bOB") {
        if (this.selectedIndex < itemCount - 1) {
          this.selectedIndex++;
          this.tui.requestRender();
        }
        return;
      }

      // Left/Right toggle Active Widget on index 0
      if (
        this.selectedIndex === 0 &&
        (input === "\x1b[C" ||
          input === "\x1bOC" ||
          input === "\x1b[D" ||
          input === "\x1bOD")
      ) {
        this.toggleActiveMode(mode);
        return;
      }

      if (input === "\r" || input === "\n") {
        if (this.selectedIndex === 0) {
          this.toggleActiveMode(mode);
        } else {
          this.openNavigatorItem(mode);
        }
        return;
      }
      return;
    }

    // ---- Depth 1: Colors submenu (Headers / Values) or Theme Preset list ----
    if (this.depth === 1 && this.activeSubMenu === "themeOverride") {
      this.handlePresetPickerInput(input, mode);
      return;
    }

    if (this.depth === 1 && this.activeSubMenu === "colors") {
      const itemCount = 3; // Back, Headers, Values

      if (input === "\x1b[A" || input === "\x1bOA") {
        if (this.selectedIndex > 0) {
          this.selectedIndex--;
          this.tui.requestRender();
        }
        return;
      }
      if (input === "\x1b[B" || input === "\x1bOB") {
        if (this.selectedIndex < itemCount - 1) {
          this.selectedIndex++;
          this.tui.requestRender();
        }
        return;
      }

      if (input === "\r" || input === "\n") {
        if (this.selectedIndex === 0) {
          // Back
          this.navigateBack();
        } else if (this.selectedIndex === 1) {
          // Headers
          this.depth = 2;
          this.selectedIndex = 0;
          this.activeSubMenu = "colorsHeaders";
          this.tui.requestRender();
        } else if (this.selectedIndex === 2) {
          // Values
          this.depth = 2;
          this.selectedIndex = 0;
          this.activeSubMenu = "colorsValues";
          this.tui.requestRender();
        }
        return;
      }
      return;
    }

    // ---- Depth 2: Color element list ----
    if (
      this.depth === 2 &&
      (this.activeSubMenu === "colorsHeaders" ||
        this.activeSubMenu === "colorsValues")
    ) {
      const elements =
        this.activeSubMenu === "colorsHeaders"
          ? HEADER_ELEMENTS
          : VALUE_ELEMENTS;
      const maxVisible = Math.min(elements.length, 12);

      if (input === "\x1b[A" || input === "\x1bOA") {
        if (this.selectedIndex > 0) {
          this.selectedIndex--;
          this.tui.requestRender();
        }
        return;
      }
      if (input === "\x1b[B" || input === "\x1bOB") {
        if (
          this.selectedIndex < maxVisible - 1 &&
          this.selectedIndex < elements.length - 1
        ) {
          this.selectedIndex++;
          this.tui.requestRender();
        }
        return;
      }

      if (input === "\r" || input === "\n") {
        const element = elements[this.selectedIndex];
        if (element) {
          this.openColorPicker(element, mode);
        }
        return;
      }

      // d / Delete — reset override
      if (input === "d" || input === "\x7f" || input === "\b") {
        const element = elements[this.selectedIndex];
        if (element) {
          this.config.perModeColorOverrides[mode][element] = null;
          saveConfig(this.config);
          this.invalidatePreview();
          this.tui.requestRender();
        }
        return;
      }
      return;
    }
  }

  private openNavigatorItem(mode: DisplayMode): void {
    switch (this.selectedIndex) {
      case 0: {
        // Active Widget — toggle enabled/disabled
        this.toggleActiveMode(mode);
        break;
      }
      case 1: {
        // Customize Layout
        this.depth = 1;
        this.activeSubMenu = "columns";
        this.reorderMode = false;
        this.layoutItems = this.buildCustomizeLayoutItems(mode);
        this.layoutCursor = 0;
        // Start cursor on first non-section item
        for (let i = 0; i < this.layoutItems.length; i++) {
          if (this.layoutItems[i]!.type !== "section") {
            this.layoutCursor = i;
            break;
          }
        }
        this.tui.requestRender();
        break;
      }
      case 2: {
        // Theme Preset — custom list picker
        this.depth = 1;
        this.selectedIndex = 0;
        this.activeSubMenu = "themeOverride";
        this.previewPreset = THEMED_PRESETS[0] ?? null;
        this.invalidatePreview();
        this.tui.requestRender();
        break;
      }
      case 3: {
        // Custom Theme Colors
        this.depth = 1;
        this.selectedIndex = 0;
        this.activeSubMenu = "colors";
        this.tui.requestRender();
        break;
      }
    }
  }

  /** Toggle the enabled state for a mode, guarding against disabling the last enabled mode. */
  private toggleActiveMode(mode: DisplayMode): void {
    const current = this.config.enabledModes[mode] ?? true;
    if (current) {
      // Disabling — check if this is the last enabled mode
      const enabledCount = (
        ["summary", "compact", "Per Model", "expanded"] as DisplayMode[]
      ).filter((m) =>
        m === mode ? true : (this.config.enabledModes[m] ?? true),
      ).length;
      if (enabledCount <= 1) {
        this.flashWarning = "At least one mode must remain enabled";
        this.tui.requestRender();
        return;
      }
    }
    this.config.enabledModes[mode] = !current;
    saveConfig(this.config);
    this.invalidatePreview();
    this.tui.requestRender();
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
