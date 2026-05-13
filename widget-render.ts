/**
 * Widget render engine — pure function that renders widget output from config,
 * theme, data, and width.
 *
 * Exports a single function:
 *   renderWidget(config, theme, data, width): string[]
 *
 * Never touches the file system. Never mutates config.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth, truncateToWidth } from "@earendil-works/pi-tui";
import type {
  UsageWidgetConfig,
  DisplayMode,
  TimeScope,
  TimeFilteredStats,
  TotalStats,
  ProviderStats,
  ModelStats,
  BaseStats,
  ModeColumnConfig,
} from "./types.js";
import {
  formatCost,
  formatCostFixed3,
  formatTokens,
  formatNumber,
  formatScopeLabel,
} from "./formatting.js";

// =============================================================================
// Column system
// =============================================================================

interface DataColumn {
  label: string;
  width: number;
  dimmed?: boolean;
  getValue: (s: BaseStats & { sessions: Set<string> | number }) => string;
}

interface TableLayoutCandidate {
  columns: DataColumn[];
  minNameWidth: number;
  /** If true, only one name column is used */
  compact?: boolean;
}

interface TableLayout {
  columns: DataColumn[];
  nameWidth: number;
  nameWidth2?: number; // second name column for per-model mode
  tableWidth: number;
  compact?: boolean;
}

// =============================================================================
// Column definitions (matching index.ts exactly)
// =============================================================================

const SESSIONS_COLUMN: DataColumn = {
  label: "Sessions",
  width: 8,
  getValue: (s) => formatNumber(typeof s.sessions === "number" ? s.sessions : s.sessions.size),
};

const MSGS_COLUMN: DataColumn = {
  label: "Msgs",
  width: 7,
  getValue: (s) => formatNumber(s.messages),
};

const COST_COLUMN: DataColumn = {
  label: "Cost",
  width: 9,
  getValue: (s) => formatCost(s.cost),
};

const TOKENS_COLUMN: DataColumn = {
  label: "Tokens",
  width: 9,
  getValue: (s) => formatTokens(s.tokens.total),
};

const INPUT_COLUMN: DataColumn = {
  label: "\u2191In",
  width: 8,
  dimmed: true,
  getValue: (s) => formatTokens(s.tokens.input + s.tokens.cacheWrite),
};

const OUTPUT_COLUMN: DataColumn = {
  label: "\u2193Out",
  width: 8,
  dimmed: true,
  getValue: (s) => formatTokens(s.tokens.output),
};

const CACHE_COLUMN: DataColumn = {
  label: "Cache",
  width: 8,
  dimmed: true,
  getValue: (s) => formatTokens(s.tokens.cacheRead + s.tokens.cacheWrite),
};

// Widget-specific cost column with 3 decimal places (matching index.ts)
const WIDGET_COST_COLUMN: DataColumn = {
  label: "Cost",
  width: 9,
  getValue: (s) => formatCostFixed3(s.cost),
};

const FULL_DATA_COLUMNS: DataColumn[] = [
  SESSIONS_COLUMN,
  MSGS_COLUMN,
  WIDGET_COST_COLUMN,
  TOKENS_COLUMN,
  INPUT_COLUMN,
  OUTPUT_COLUMN,
  CACHE_COLUMN,
];

/** Per-model specific columns with provider+model name columns */
const PER_MODEL_DATA_COLUMNS: DataColumn[] = [
  SESSIONS_COLUMN,
  MSGS_COLUMN,
  WIDGET_COST_COLUMN,
  TOKENS_COLUMN,
  INPUT_COLUMN,
  OUTPUT_COLUMN,
  CACHE_COLUMN,
];

const MAX_NAME_COL_WIDTH = 24;

// =============================================================================
// Table layout candidates
// =============================================================================

const TABLE_LAYOUT_CANDIDATES: TableLayoutCandidate[] = [
  { columns: FULL_DATA_COLUMNS, minNameWidth: MAX_NAME_COL_WIDTH },
  { columns: [SESSIONS_COLUMN, MSGS_COLUMN, WIDGET_COST_COLUMN, TOKENS_COLUMN], minNameWidth: 14, compact: true },
  { columns: [SESSIONS_COLUMN, WIDGET_COST_COLUMN, TOKENS_COLUMN], minNameWidth: 12, compact: true },
  { columns: [WIDGET_COST_COLUMN, TOKENS_COLUMN], minNameWidth: 10, compact: true },
  { columns: [WIDGET_COST_COLUMN], minNameWidth: 8, compact: true },
];

// Per-model mode candidates — uses two name columns (provider + model)
const PER_MODEL_TABLE_CANDIDATES: TableLayoutCandidate[] = [
  { columns: PER_MODEL_DATA_COLUMNS, minNameWidth: MAX_NAME_COL_WIDTH },
  { columns: [SESSIONS_COLUMN, MSGS_COLUMN, WIDGET_COST_COLUMN, TOKENS_COLUMN], minNameWidth: 10, compact: true },
  { columns: [SESSIONS_COLUMN, WIDGET_COST_COLUMN, TOKENS_COLUMN], minNameWidth: 8, compact: true },
  { columns: [WIDGET_COST_COLUMN, TOKENS_COLUMN], minNameWidth: 6, compact: true },
  { columns: [WIDGET_COST_COLUMN], minNameWidth: 4, compact: true },
];

// =============================================================================
// Column filtering by config
// =============================================================================

/**
 * Filter data columns based on the mode's column visibility config.
 * The name column (provider/model) is handled separately.
 */
function filterDataColumns(
  allColumns: DataColumn[],
  columnConfig: ModeColumnConfig,
): DataColumn[] {
  const result: DataColumn[] = [];

  if (columnConfig.sessions) result.push(SESSIONS_COLUMN);
  if (columnConfig.msgs) result.push(MSGS_COLUMN);
  if (columnConfig.cost) {
    // For the widget, use the 3-decimal cost column
    result.push(WIDGET_COST_COLUMN);
  }
  if (columnConfig.tokens) result.push(TOKENS_COLUMN);
  if (columnConfig.tokensIn) result.push(INPUT_COLUMN);
  if (columnConfig.tokensOut) result.push(OUTPUT_COLUMN);
  if (columnConfig.cache) result.push(CACHE_COLUMN);

  return result;
}

// =============================================================================
// Layout helpers
// =============================================================================

function sumColumnWidths(columns: DataColumn[]): number {
  return columns.reduce((sum, col) => sum + col.width, 0);
}

function padLeft(s: string, len: number): string {
  const vis = visibleWidth(s);
  if (vis >= len) return s;
  return " ".repeat(len - vis) + s;
}

function padRight(s: string, len: number): string {
  const vis = visibleWidth(s);
  if (vis >= len) return s;
  return s + " ".repeat(len - vis);
}

function fitCell(s: string, len: number, align: "left" | "right" = "left"): string {
  if (len <= 0) return "";
  const truncated = truncateToWidth(s, len);
  return align === "right" ? padLeft(truncated, len) : padRight(truncated, len);
}

function clampLines(lines: string[], width: number): string[] {
  return lines.map((line) => truncateToWidth(line, Math.max(width, 0)));
}

function pickFittingText(width: number, variants: string[]): string {
  for (const variant of variants) {
    if (visibleWidth(variant) <= width) return variant;
  }
  return variants[variants.length - 1] || "";
}

// =============================================================================
// Table layout selection
// =============================================================================

function selectTableLayout(
  candidates: TableLayoutCandidate[],
  width: number,
  hasSecondNameCol: boolean,
): TableLayout {
  const safeWidth = Math.max(width, 0);

  for (const candidate of candidates) {
    const columnsWidth = sumColumnWidths(candidate.columns);
    // With two name columns, split name width between them
    const nameWidthBudget = Math.min(MAX_NAME_COL_WIDTH, Math.max(safeWidth - columnsWidth, 0));

    if (hasSecondNameCol) {
      // Provider column gets ~40% of name budget, Model gets ~60%
      const providerNameWidth = Math.max(4, Math.floor(nameWidthBudget * 0.4));
      const modelNameWidth = Math.max(4, nameWidthBudget - providerNameWidth);
      const totalNameWidth = providerNameWidth + modelNameWidth;
      if (totalNameWidth >= candidate.minNameWidth) {
        return {
          columns: candidate.columns,
          nameWidth: providerNameWidth,
          nameWidth2: modelNameWidth,
          tableWidth: totalNameWidth + columnsWidth,
          compact: candidate.compact ?? false,
        };
      }
    } else {
      if (nameWidthBudget >= candidate.minNameWidth) {
        return {
          columns: candidate.columns,
          nameWidth: nameWidthBudget,
          tableWidth: nameWidthBudget + columnsWidth,
          compact: candidate.compact ?? false,
        };
      }
    }
  }

  // Fallback — use last candidate
  const fallback = candidates[candidates.length - 1]!;
  const fallbackColumnsWidth = sumColumnWidths(fallback.columns);
  const fallbackNameWidth = Math.min(MAX_NAME_COL_WIDTH, Math.max(safeWidth - fallbackColumnsWidth, 0));

  if (hasSecondNameCol) {
    const providerNameWidth = Math.max(4, Math.floor(fallbackNameWidth * 0.4));
    const modelNameWidth = Math.max(4, fallbackNameWidth - providerNameWidth);
    return {
      columns: fallback.columns,
      nameWidth: providerNameWidth,
      nameWidth2: modelNameWidth,
      tableWidth: providerNameWidth + modelNameWidth + fallbackColumnsWidth,
      compact: fallback.compact ?? false,
    };
  }

  return {
    columns: fallback.columns,
    nameWidth: fallbackNameWidth,
    tableWidth: fallbackNameWidth + fallbackColumnsWidth,
    compact: fallback.compact ?? false,
  };
}

// =============================================================================
// Separator line renderer
// =============================================================================

function renderSeparatorLine(
  theme: Theme,
  config: UsageWidgetConfig,
  lineConfig: "headerLine" | "footerLine",
  tableWidth: number,
): string | null {
  const lineCfg = config[lineConfig];
  if (!lineCfg.show) return null;

  const char = lineCfg.character || "\u2500"; // ─ default
  const line = char.repeat(Math.max(tableWidth, 0));
  return theme.fg("border", line);
}

// =============================================================================
// Data row rendering
// =============================================================================

function renderDataRow(
  theme: Theme,
  name: string,
  stats: BaseStats & { sessions: Set<string> | number },
  layout: TableLayout,
  options: { indent?: number; dimAll?: boolean; prefix?: string } = {},
): string {
  const { indent = 0, dimAll = false, prefix } = options;

  const rawPrefix = prefix ?? " ".repeat(indent);
  const safePrefix = layout.nameWidth > 0 ? truncateToWidth(rawPrefix, layout.nameWidth, "") : "";
  const prefixWidth = visibleWidth(safePrefix);
  const innerNameWidth = Math.max(layout.nameWidth - prefixWidth, 0);
  const truncName = innerNameWidth > 0 ? truncateToWidth(name, innerNameWidth) : "";
  const styledName = dimAll ? theme.fg("dim", truncName) : truncName;

  let row = safePrefix + (innerNameWidth > 0 ? padRight(styledName, innerNameWidth) : "");

  for (const col of layout.columns) {
    const value = fitCell(col.getValue(stats), col.width, "right");
    const shouldDim = col.dimmed || dimAll;
    row += shouldDim ? theme.fg("dim", value) : value;
  }

  return row;
}

/**
 * Render a two-name-column row for per-model mode.
 */
function renderDualNameRow(
  theme: Theme,
  providerName: string,
  modelName: string,
  stats: BaseStats & { sessions: Set<string> | number },
  layout: TableLayout,
  options: { dimAll?: boolean } = {},
): string {
  const { dimAll = false } = options;

  // First column: provider
  const provTrunc = layout.nameWidth > 0 ? truncateToWidth(providerName, layout.nameWidth) : "";
  const provStyled = dimAll ? theme.fg("dim", provTrunc) : provTrunc;
  const provCell = layout.nameWidth > 0 ? padRight(provStyled, layout.nameWidth) : "";

  // Second column: model
  const name2Width = layout.nameWidth2 ?? layout.nameWidth;
  const modelTrunc = name2Width > 0 ? truncateToWidth(modelName, name2Width) : "";
  const modelStyled = dimAll ? theme.fg("dim", modelTrunc) : modelTrunc;
  const modelCell = name2Width > 0 ? padRight(modelStyled, name2Width) : "";

  let row = provCell + modelCell;

  for (const col of layout.columns) {
    const value = fitCell(col.getValue(stats), col.width, "right");
    const shouldDim = col.dimmed || dimAll;
    row += shouldDim ? theme.fg("dim", value) : value;
  }

  return row;
}

// =============================================================================
// Table header rendering
// =============================================================================

function renderTableHeader(
  theme: Theme,
  layout: TableLayout,
  providerColLabel: string,
  modelColLabel?: string,
): string[] {
  const lines: string[] = [];

  if (modelColLabel !== undefined) {
    // Dual name columns
    const provHdr = fitCell(providerColLabel, layout.nameWidth);
    const modelHdr = fitCell(modelColLabel, layout.nameWidth2 ?? layout.nameWidth);
    let headerLine = provHdr + modelHdr;
    for (const col of layout.columns) {
      headerLine += fitCell(col.label, col.width, "right");
    }
    lines.push(theme.fg("muted", headerLine));
  } else {
    let headerLine = fitCell(providerColLabel, layout.nameWidth);
    for (const col of layout.columns) {
      const label = fitCell(col.label, col.width, "right");
      headerLine += col.dimmed ? theme.fg("dim", label) : label;
    }
    lines.push(theme.fg("muted", headerLine));
  }

  return lines;
}

// =============================================================================
// Totals row rendering
// =============================================================================

function renderTotalsRow(
  theme: Theme,
  totals: TotalStats,
  layout: TableLayout,
  columnConfig: ModeColumnConfig,
): string[] {
  const lines: string[] = [];
  const hasDualNames = layout.nameWidth2 !== undefined;

  if (hasDualNames) {
    // Merge provider+model name cells into one spanned "Total" cell
    const totalNameWidth = layout.nameWidth + (layout.nameWidth2 ?? 0);
    let totalRow = fitCell(theme.bold("Total"), totalNameWidth);
    for (const col of layout.columns) {
      const value = fitCell(col.getValue(totals), col.width, "right");
      totalRow += col.dimmed ? theme.fg("dim", value) : value;
    }
    lines.push(totalRow);
  } else {
    let totalRow = fitCell(theme.bold("Total"), layout.nameWidth);
    for (const col of layout.columns) {
      const value = fitCell(col.getValue(totals), col.width, "right");
      totalRow += col.dimmed ? theme.fg("dim", value) : value;
    }
    lines.push(totalRow);
  }

  return lines;
}

// =============================================================================
// Formula note
// =============================================================================

function renderFormulaNote(theme: Theme, width: number): string[] {
  const line = pickFittingText(width, [
    "Tokens = Input + Output + CacheWrite  \u00b7  \u2191In = Input + CacheWrite  (as of 0.2.0)",
    "Tokens = In + Out + CacheWrite  \u00b7  \u2191In = In + CacheWrite  (v0.2.0+)",
    "Tokens & \u2191In include CacheWrite (v0.2.0+)",
    "Incl. CacheWrite (v0.2.0+)",
  ]);
  return [theme.fg("dim", line), ""];
}

// =============================================================================
// Mode: Summary — single-line property pipe
// =============================================================================

function renderSummary(
  theme: Theme,
  columnConfig: ModeColumnConfig,
  data: TimeFilteredStats,
  scope: TimeScope,
  _width: number,
): string[] {
  const totals = data.totals;

  if (totals.messages === 0) {
    const label = formatScopeLabel(scope);
    return [theme.fg("dim", `Usage: --- (${label})`)];
  }

  const parts: string[] = [];

  if (columnConfig.sessions) {
    parts.push(`${formatNumber(totals.sessions)} sessions`);
  }
  if (columnConfig.msgs) {
    parts.push(`${formatNumber(totals.messages)} msgs`);
  }
  if (columnConfig.cost) {
    parts.push(formatCostFixed3(totals.cost));
  }
  if (columnConfig.tokens) {
    parts.push(`${formatTokens(totals.tokens.total)} tokens`);
  }
  if (columnConfig.tokensIn) {
    parts.push(`\u2191${formatTokens(totals.tokens.input + totals.tokens.cacheWrite)}`);
  }
  if (columnConfig.tokensOut) {
    parts.push(`\u2193${formatTokens(totals.tokens.output)}`);
  }
  if (columnConfig.cache) {
    parts.push(`${formatTokens(totals.tokens.cacheRead + totals.tokens.cacheWrite)} cache`);
  }

  const joined = parts.join(" \u00b7 ");
  const scopeLabel = formatScopeLabel(scope);

  return [
    theme.fg("muted", "Usage: ") +
    theme.fg("text", joined) +
    (joined ? theme.fg("muted", ` (${scopeLabel})`) : theme.fg("muted", `(${scopeLabel})`)),
  ];
}

// =============================================================================
// Mode: Compact — provider table (like old detailed-collapsed)
// =============================================================================

function renderCompact(
  theme: Theme,
  columnConfig: ModeColumnConfig,
  data: TimeFilteredStats,
  scope: TimeScope,
  width: number,
  config: UsageWidgetConfig,
): string[] {
  if (data.totals.messages === 0) {
    return [theme.fg("dim", `Usage: --- (${formatScopeLabel(scope)})`)];
  }

  const lines: string[] = [];

  // Title
  lines.push(theme.fg("muted", `Usage: (${formatScopeLabel(scope)})`));

  // Filter columns by config
  const columns = filterDataColumns(FULL_DATA_COLUMNS, columnConfig);

  if (columns.length === 0) {
    // No stat columns — simple provider list
    const providers = Array.from(data.providers.entries())
      .sort((a, b) => b[1].cost - a[1].cost);
    for (const [provider] of providers) {
      lines.push(theme.fg("muted", "  " + provider));
    }
    return lines;
  }

  // Build candidates from filtered columns
  const candidates: TableLayoutCandidate[] = buildLayoutCandidates(columns);
  const layout = selectTableLayout(candidates, width, false);

  // Header
  lines.push(...renderTableHeader(theme, layout, "Provider / Model"));

  // Header separator
  const headerSep = renderSeparatorLine(theme, config, "headerLine", layout.tableWidth);
  if (headerSep !== null) lines.push(headerSep);

  // Provider rows
  const providers = Array.from(data.providers.entries())
    .sort((a, b) => b[1].cost - a[1].cost);

  if (providers.length === 0) {
    lines.push(theme.fg("dim", "  No usage data for this period"));
  } else {
    for (const [providerName, providerStats] of providers) {
      const prefix = theme.fg("dim", "\u25b8 ");
      lines.push(renderDataRow(theme, providerName, providerStats, layout, { prefix }));
    }
  }

  // Footer separator
  const footerSep = renderSeparatorLine(theme, config, "footerLine", layout.tableWidth);
  if (footerSep !== null) lines.push(footerSep);

  // Totals
  if (columnConfig.showTotals) {
    lines.push(...renderTotalsRow(theme, data.totals, layout, columnConfig));
  }

  // Formula note
  lines.push(...renderFormulaNote(theme, width));

  return lines;
}

// =============================================================================
// Mode: Per-Model — flat table sorted by cost across all providers
// =============================================================================

function renderPerModel(
  theme: Theme,
  columnConfig: ModeColumnConfig,
  data: TimeFilteredStats,
  scope: TimeScope,
  width: number,
  config: UsageWidgetConfig,
): string[] {
  if (data.totals.messages === 0) {
    return [theme.fg("dim", `Usage: --- (${formatScopeLabel(scope)})`)];
  }

  const lines: string[] = [];

  // Title
  lines.push(theme.fg("muted", `Usage: (${formatScopeLabel(scope)})`));

  // Flatten all models from all providers, sorted by cost descending
  interface ModelEntry {
    provider: string;
    model: string;
    stats: ModelStats;
  }

  const models: ModelEntry[] = [];
  for (const [providerName, providerStats] of data.providers) {
    for (const [modelName, modelStats] of providerStats.models) {
      models.push({ provider: providerName, model: modelName, stats: modelStats });
    }
  }
  models.sort((a, b) => b.stats.cost - a.stats.cost);

  // Filter columns by config
  const columns = filterDataColumns(PER_MODEL_DATA_COLUMNS, columnConfig);

  if (columns.length === 0 && !columnConfig.provider && !columnConfig.model) {
    // Nothing to show
    return lines;
  }

  // Determine if we show provider and/or model columns
  const showProvider = columnConfig.provider;
  const showModel = columnConfig.model;

  let layout: TableLayout;

  if (showProvider && showModel) {
    // Dual name columns
    const candidates = buildLayoutCandidates(columns);
    layout = selectTableLayout(candidates, width, true);
    layout.nameWidth2 = layout.nameWidth2 ?? Math.max(4, Math.floor(layout.nameWidth * 0.6));
    lines.push(...renderTableHeader(theme, layout, "Provider", "Model"));
  } else if (showProvider && !showModel) {
    // Single provider column
    const candidates = buildLayoutCandidates(columns);
    layout = selectTableLayout(candidates, width, false);
    lines.push(...renderTableHeader(theme, layout, "Provider"));
  } else if (!showProvider && showModel) {
    // Single model column
    const candidates = buildLayoutCandidates(columns);
    layout = selectTableLayout(candidates, width, false);
    lines.push(...renderTableHeader(theme, layout, "Model"));
  } else {
    // No name columns — just data
    const candidates = buildLayoutCandidates(columns);
    layout = selectTableLayout(candidates, width, false);
    layout.nameWidth = 0;
  }

  // Header separator
  const headerSep = renderSeparatorLine(theme, config, "headerLine", layout.tableWidth);
  if (headerSep !== null) lines.push(headerSep);

  if (models.length === 0) {
    lines.push(theme.fg("dim", "  No usage data for this period"));
  } else {
    for (const entry of models) {
      if (showProvider && showModel) {
        lines.push(renderDualNameRow(theme, entry.provider, entry.model, entry.stats, layout));
      } else if (showProvider && !showModel) {
        lines.push(renderDataRow(theme, entry.provider, entry.stats, layout));
      } else if (!showProvider && showModel) {
        lines.push(renderDataRow(theme, entry.model, entry.stats, layout));
      } else {
        // No name columns — just data columns
        let row = "";
        for (const col of layout.columns) {
          const value = fitCell(col.getValue(entry.stats), col.width, "right");
          row += col.dimmed ? theme.fg("dim", value) : value;
        }
        lines.push(row);
      }
    }
  }

  // Footer separator
  const footerSep = renderSeparatorLine(theme, config, "footerLine", layout.tableWidth);
  if (footerSep !== null) lines.push(footerSep);

  // Totals
  if (columnConfig.showTotals) {
    // Compute aggregate totals for per-model display
    // (Re-use the existing totals from data.totals)
    const adjLayout = { ...layout };
    if (showProvider && showModel) {
      // Keep dual columns
    } else if (showProvider && !showModel) {
      adjLayout.nameWidth2 = undefined;
    } else if (!showProvider && showModel) {
      adjLayout.nameWidth2 = undefined;
    }
    lines.push(...renderTotalsRow(theme, data.totals, layout, columnConfig));
  }

  // Formula note
  lines.push(...renderFormulaNote(theme, width));

  return lines;
}

// =============================================================================
// Mode: Expanded — grouped providers with model sub-rows (like old detailed-expanded)
// =============================================================================

function renderExpanded(
  theme: Theme,
  columnConfig: ModeColumnConfig,
  data: TimeFilteredStats,
  scope: TimeScope,
  width: number,
  config: UsageWidgetConfig,
): string[] {
  if (data.totals.messages === 0) {
    return [theme.fg("dim", `Usage: --- (${formatScopeLabel(scope)})`)];
  }

  const lines: string[] = [];

  // Title
  lines.push(theme.fg("muted", `Usage: (${formatScopeLabel(scope)})`));

  // Filter columns by config
  const columns = filterDataColumns(FULL_DATA_COLUMNS, columnConfig);

  if (columns.length === 0) {
    // No stat columns — simple provider list with models
    const providers = Array.from(data.providers.entries())
      .sort((a, b) => b[1].cost - a[1].cost);
    for (const [providerName, providerStats] of providers) {
      lines.push(theme.fg("muted", "  \u25be ") + providerName);
      const providerModels = Array.from(providerStats.models.entries())
        .sort((a, b) => b[1].cost - a[1].cost);
      for (const [modelName] of providerModels) {
        lines.push(theme.fg("dim", "      " + modelName));
      }
    }
    return lines;
  }

  // Build candidates from filtered columns
  const candidates = buildLayoutCandidates(columns);
  const layout = selectTableLayout(candidates, width, false);

  // Header
  lines.push(...renderTableHeader(theme, layout, "Provider / Model"));

  // Header separator
  const headerSep = renderSeparatorLine(theme, config, "headerLine", layout.tableWidth);
  if (headerSep !== null) lines.push(headerSep);

  // Provider rows with expanded models
  const providers = Array.from(data.providers.entries())
    .sort((a, b) => b[1].cost - a[1].cost);

  if (providers.length === 0) {
    lines.push(theme.fg("dim", "  No usage data for this period"));
  } else {
    for (const [providerName, providerStats] of providers) {
      const prefix = theme.fg("dim", "\u25be ");
      lines.push(renderDataRow(theme, providerName, providerStats, layout, { prefix }));

      const providerModels = Array.from(providerStats.models.entries())
        .sort((a, b) => b[1].cost - a[1].cost);
      for (const [modelName, modelStats] of providerModels) {
        lines.push(renderDataRow(theme, modelName, modelStats, layout, { indent: 4, dimAll: true }));
      }
    }
  }

  // Footer separator
  const footerSep = renderSeparatorLine(theme, config, "footerLine", layout.tableWidth);
  if (footerSep !== null) lines.push(footerSep);

  // Totals
  if (columnConfig.showTotals) {
    lines.push(...renderTotalsRow(theme, data.totals, layout, columnConfig));
  }

  // Formula note
  lines.push(...renderFormulaNote(theme, width));

  return lines;
}

// =============================================================================
// Layout candidate builder — respects column config filtering
// =============================================================================

function buildLayoutCandidates(filteredColumns: DataColumn[]): TableLayoutCandidate[] {
  if (filteredColumns.length === 0) {
    // Minimal fallback
    return [{ columns: [WIDGET_COST_COLUMN], minNameWidth: 4 }];
  }

  // Start with the full set
  const candidates: TableLayoutCandidate[] = [
    { columns: filteredColumns, minNameWidth: MAX_NAME_COL_WIDTH },
  ];

  // Add progressive compacting variants by dropping columns from the right
  const cols = [...filteredColumns];
  while (cols.length > 1) {
    cols.pop();
    const colsWidth = sumColumnWidths(cols);
    const minName = colsWidth <= 20 ? 10 : colsWidth <= 35 ? 14 : MAX_NAME_COL_WIDTH;
    candidates.push({ columns: [...cols], minNameWidth: minName, compact: true });
  }

  // Last: single column
  candidates.push({ columns: [filteredColumns[0]!], minNameWidth: 4, compact: true });

  return candidates;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Normalize a display mode string, handling legacy mode names.
 */
function normalizeMode(mode: string): DisplayMode {
  if (mode === "detailed-collapsed") return "compact";
  if (mode === "detailed-expanded") return "expanded";
  // Ensure it's a valid DisplayMode
  const valid: DisplayMode[] = ["summary", "compact", "per-model", "expanded", "hidden"];
  if (valid.includes(mode as DisplayMode)) return mode as DisplayMode;
  return "compact"; // fallback
}

/**
 * Render the usage widget output.
 *
 * Pure function — never touches the file system or mutates config.
 *
 * @param config  The resolved UsageWidgetConfig
 * @param theme   The Pi Theme for coloring
 * @param data    The UsageData from data-collection
 * @param width   Available terminal width
 * @param mode    Display mode override (defaults to config.defaultMode)
 * @param scope   Time scope override (defaults to config.defaultScope)
 * @returns Array of rendered lines (with ANSI escape codes)
 */
export function renderWidget(
  config: UsageWidgetConfig,
  theme: Theme,
  data: UsageData,
  width: number,
  mode?: string,
  scope?: TimeScope,
): string[] {
  const activeMode = mode ?? config.defaultMode;
  const activeScope = scope ?? config.defaultScope;
  const safeWidth = Math.max(width, 0);

  // Handle legacy display modes (backward compat with existing widget cycle)
  const resolvedMode = normalizeMode(activeMode);

  // Hidden mode
  if (resolvedMode === "hidden") {
    return [];
  }

  // Get data for the active time scope
  const scopeStats = data[activeScope] as TimeFilteredStats | undefined;

  // Guard against invalid/missing scope data
  if (!scopeStats) {
    return [theme.fg("dim", `Usage: --- (${formatScopeLabel(activeScope)})`)];
  }

  // Get column config for the active mode
  const columnConfig = config.modes[resolvedMode] ?? config.modes["compact"]!;

  // Route to mode renderer
  switch (resolvedMode) {
    case "summary":
      return clampLines(renderSummary(theme, columnConfig, scopeStats, activeScope, safeWidth), safeWidth);

    case "compact":
      return clampLines(renderCompact(theme, columnConfig, scopeStats, activeScope, safeWidth, config), safeWidth);

    case "per-model":
      return clampLines(
        renderPerModel(theme, columnConfig, scopeStats, activeScope, safeWidth, config),
        safeWidth,
      );

    case "expanded":
      return clampLines(renderExpanded(theme, columnConfig, scopeStats, activeScope, safeWidth, config), safeWidth);

    default:
      return [];
  }
}
