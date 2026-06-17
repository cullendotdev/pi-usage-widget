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
import { DEFAULT_COLUMN_ORDER } from "./config-persistence.js";
import {
  resolveColor,
  getThemeHex,
  defaultThemeFgMap,
  type ColorElement,
} from "./color-engine.js";

// =============================================================================
// Column system
// =============================================================================

interface DataColumn {
  label: string;
  width: number;
  dimmed?: boolean;
  /** Color element for the column header label. */
  headerElement?: ColorElement;
  /** Color element for the column value in data rows. */
  valueElement?: ColorElement;
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
  headerElement: "sessionsHeader",
  valueElement: "sessionsValue",
  getValue: (s) =>
    formatNumber(typeof s.sessions === "number" ? s.sessions : s.sessions.size),
};

const MSGS_COLUMN: DataColumn = {
  label: "Msgs",
  width: 7,
  headerElement: "msgsHeader",
  valueElement: "msgsValue",
  getValue: (s) => formatNumber(s.messages),
};

const COST_COLUMN: DataColumn = {
  label: "Cost",
  width: 9,
  headerElement: "costHeader",
  valueElement: "costValue",
  getValue: (s) => formatCost(s.cost),
};

const TOKENS_COLUMN: DataColumn = {
  label: "Tokens",
  width: 9,
  headerElement: "tokensHeader",
  valueElement: "tokensValue",
  getValue: (s) => formatTokens(s.tokens.total),
};

const INPUT_COLUMN: DataColumn = {
  label: "\u2191In",
  width: 8,
  dimmed: true,
  headerElement: "tokensInHeader",
  valueElement: "tokensInValue",
  getValue: (s) => formatTokens(s.tokens.input + s.tokens.cacheWrite),
};

const OUTPUT_COLUMN: DataColumn = {
  label: "\u2193Out",
  width: 8,
  dimmed: true,
  headerElement: "tokensOutHeader",
  valueElement: "tokensOutValue",
  getValue: (s) => formatTokens(s.tokens.output),
};

const CACHE_COLUMN: DataColumn = {
  label: "Cache",
  width: 8,
  dimmed: true,
  headerElement: "cacheHeader",
  valueElement: "cacheValue",
  getValue: (s) => formatTokens(s.tokens.cacheRead + s.tokens.cacheWrite),
};

// Widget-specific cost column with 3 decimal places (matching index.ts)
const WIDGET_COST_COLUMN: DataColumn = {
  label: "Cost",
  width: 9,
  headerElement: "costHeader",
  valueElement: "costValue",
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

/** Per-model specific columns with Provider & Model name columns */
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
// =============================================================================
// Column filtering by config
// =============================================================================

/**
 * Filter data columns based on the mode's column visibility config
 * and sort them according to the configured columnOrder.
 * The name column (provider/model) is handled separately.
 */
function filterDataColumns(
  _allColumns: DataColumn[],
  columnConfig: ModeColumnConfig,
): DataColumn[] {
  // Map column IDs to their DataColumn objects
  const columnMap: Record<string, DataColumn> = {
    sessions: SESSIONS_COLUMN,
    msgs: MSGS_COLUMN,
    cost: WIDGET_COST_COLUMN,
    tokens: TOKENS_COLUMN,
    tokensIn: columnConfig.showInOutArrows
      ? { ...INPUT_COLUMN, getValue: (s: BaseStats & { sessions: Set<string> | number }) => `\u2191${INPUT_COLUMN.getValue(s)}` }
      : INPUT_COLUMN,
    tokensOut: columnConfig.showInOutArrows
      ? { ...OUTPUT_COLUMN, getValue: (s: BaseStats & { sessions: Set<string> | number }) => `\u2193${OUTPUT_COLUMN.getValue(s)}` }
      : OUTPUT_COLUMN,
    cache: CACHE_COLUMN,
  };

  const visibleIds = new Set<string>();
  if (columnConfig.sessions) visibleIds.add("sessions");
  if (columnConfig.msgs) visibleIds.add("msgs");
  if (columnConfig.cost) visibleIds.add("cost");
  if (columnConfig.tokens) visibleIds.add("tokens");
  if (columnConfig.tokensIn) visibleIds.add("tokensIn");
  if (columnConfig.tokensOut) visibleIds.add("tokensOut");
  if (columnConfig.cache) visibleIds.add("cache");

  // Use configured columnOrder (or fall back to the order of appearance)
  const order = columnConfig.columnOrder && columnConfig.columnOrder.length > 0
    ? columnConfig.columnOrder
    : Object.keys(columnMap);

  const result: DataColumn[] = [];
  for (const id of order) {
    if (visibleIds.has(id) && columnMap[id]) {
      result.push(columnMap[id]!);
    }
  }

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

function fitCell(
  s: string,
  len: number,
  align: "left" | "right" = "left",
): string {
  if (len <= 0) return "";
  const truncated = truncateToWidth(s, len);
  return align === "right" ? padLeft(truncated, len) : padRight(truncated, len);
}

function clampLines(lines: string[], width: number): string[] {
  return lines.map((line) => truncateToWidth(line, Math.max(width, 0)));
}

// =============================================================================
// Color engine integration
// =============================================================================

/**
 * Wrap text in a resolved ANSI foreground color escape + reset.
 * Returns text unchanged if ansi is empty.
 */
function wrap(ansi: string, text: string): string {
  if (!ansi) return text;
  return `${ansi}${text}\x1b[0m`;
}

/**
 * Resolve a color element to its ANSI code and wrap the given text.
 * Shortcut for wrap(resolveColor(element, config), text).
 * When highlightElement matches the element and theme is provided,
 * the text is underlined to indicate the element being edited.
 *
 * themeFgMap is pre-resolved from the live Pi theme via getThemeHex()
 * and ensures role-name overrides (e.g. "accent") use the user's active
 * theme colors rather than the hardcoded defaults.
 */
function colorFg(
  config: UsageWidgetConfig,
  element: ColorElement,
  text: string,
  options?: {
    theme?: Theme;
    highlightElement?: ColorElement;
    themeFgMap?: Record<string, string>;
    mode?: DisplayMode;
  },
): string {
  const resolveOpts: ResolveColorOptions = {};
  if (options?.theme) {
    resolveOpts.getFgAnsi = (role: string) => options.theme!.getFgAnsi(role);
  }
  if (options?.themeFgMap) {
    resolveOpts.themeFgMap = options.themeFgMap;
  }
  if (options?.mode) {
    resolveOpts.mode = options.mode;
  }
  const result = wrap(resolveColor(element, config, resolveOpts), text);
  if (options?.theme && options?.highlightElement === element) {
    return options.theme.underline(result);
  }
  return result;
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
  maxNameWidth: number = MAX_NAME_COL_WIDTH,
): TableLayout {
  const safeWidth = Math.max(width, 0);
  const nameCap = Math.min(maxNameWidth, MAX_NAME_COL_WIDTH);

  for (const candidate of candidates) {
    const columnsWidth = sumColumnWidths(candidate.columns);
    // With two name columns, split name width between them
    const nameWidthBudget = Math.min(
      nameCap,
      Math.max(safeWidth - columnsWidth, 0),
    );

    // Each data column is preceded by " " in rendered output
    const spacing = candidate.columns.length;

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
          tableWidth: totalNameWidth + columnsWidth + spacing,
          compact: candidate.compact ?? false,
        };
      }
    } else {
      if (nameWidthBudget >= candidate.minNameWidth) {
        return {
          columns: candidate.columns,
          nameWidth: nameWidthBudget,
          tableWidth: nameWidthBudget + columnsWidth + spacing,
          compact: candidate.compact ?? false,
        };
      }
    }
  }

  // Fallback — use last candidate
  const fallback = candidates[candidates.length - 1]!;
  const fallbackColumnsWidth = sumColumnWidths(fallback.columns);
  const fallbackNameWidth = Math.min(
    nameCap,
    Math.max(safeWidth - fallbackColumnsWidth, 0),
  );
  // Each data column is preceded by " " in rendered output
  const fallbackSpacing = fallback.columns.length;

  if (hasSecondNameCol) {
    const providerNameWidth = Math.max(4, Math.floor(fallbackNameWidth * 0.4));
    const modelNameWidth = Math.max(4, fallbackNameWidth - providerNameWidth);
    return {
      columns: fallback.columns,
      nameWidth: providerNameWidth,
      nameWidth2: modelNameWidth,
      tableWidth: providerNameWidth + modelNameWidth + fallbackColumnsWidth + fallbackSpacing,
      compact: fallback.compact ?? false,
    };
  }

  return {
    columns: fallback.columns,
    nameWidth: fallbackNameWidth,
    tableWidth: fallbackNameWidth + fallbackColumnsWidth + fallbackSpacing,
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
  mode: DisplayMode,
  highlightElement?: ColorElement,
): string | null {
  const lineCfg = config[lineConfig];
  if (!lineCfg.show) return null;

  const char = lineCfg.character || "\u2500"; // ─ default
  const line = char.repeat(Math.max(tableWidth, 0));
  return colorFg(config, lineConfig, line, { theme, highlightElement, mode });
}

// =============================================================================
// Data row rendering
// =============================================================================

function renderDataRow(
  theme: Theme,
  name: string,
  stats: BaseStats & { sessions: Set<string> | number },
  layout: TableLayout,
  options: {
    indent?: number;
    dimAll?: boolean;
    prefix?: string;
    /** Second name part (model name) for combined "provider/model" rendering. */
    namePart2?: string;
    /** Separator between name parts (default "/"). Colored with "separator" element. */
    nameSep?: string;
    /** Ideal width for name part 1 (provider). Used for proportional split when namePart2 is set. */
    namePart1Width?: number;
    /** Ideal width for name part 2 (model). Used for proportional split when namePart2 is set. */
    namePart2Width?: number;
  } = {},
  config: UsageWidgetConfig,
  mode: DisplayMode,
  highlightElement?: ColorElement,
): string {
  const { indent = 0, dimAll = false, prefix, namePart2, nameSep = "/", namePart1Width, namePart2Width } = options;
  const opts = { theme, highlightElement, mode };

  const rawPrefix = prefix ?? " ".repeat(indent);
  const safePrefix =
    layout.nameWidth > 0
      ? truncateToWidth(rawPrefix, layout.nameWidth, "")
      : "";
  const prefixWidth = visibleWidth(safePrefix);
  const innerNameWidth = Math.max(layout.nameWidth - prefixWidth, 0);

  let styledName: string;

  if (namePart2 && innerNameWidth > 0) {
    // Two-part name: provider / model with separate colors
    const sepStyled = colorFg(config, "separator", nameSep, opts);
    const sepWidth = visibleWidth(nameSep);
    // Split remaining width proportionally using ideal widths when available,
    // fall back to 45/55 heuristic otherwise.
    let part1Budget: number;
    let part2Budget: number;
    if (namePart1Width !== undefined && namePart2Width !== undefined) {
      const ideal = namePart1Width + namePart2Width;
      part1Budget = Math.max(1, Math.floor((innerNameWidth - sepWidth) * namePart1Width / ideal));
      part2Budget = Math.max(1, innerNameWidth - part1Budget - sepWidth);
    } else {
      part1Budget = Math.max(1, Math.floor((innerNameWidth - sepWidth) * 0.45));
      part2Budget = Math.max(1, innerNameWidth - part1Budget - sepWidth);
    }
    const part1Trunc = truncateToWidth(name, part1Budget);
    const part2Trunc = truncateToWidth(namePart2, part2Budget);
    const part1Styled = colorFg(config, "providerValue", part1Trunc, opts);
    const part2Styled = colorFg(config, "modelValue", part2Trunc, opts);
    // Right-pad the combined name to fill the full name width
    const combined = part1Styled + sepStyled + part2Styled;
    const combinedVis = visibleWidth(part1Trunc) + sepWidth + visibleWidth(part2Trunc);
    styledName = combined + " ".repeat(Math.max(0, innerNameWidth - combinedVis));
  } else if (innerNameWidth > 0) {
    const truncName = truncateToWidth(name, innerNameWidth);
    const nameElement: ColorElement = dimAll ? "modelValue" : "providerValue";
    styledName = padRight(colorFg(config, nameElement, truncName, opts), innerNameWidth);
  } else {
    styledName = "";
  }

  let row = safePrefix + styledName;

  for (const col of layout.columns) {
    const value = fitCell(col.getValue(stats), col.width, "right");
    const elem = col.valueElement;
    row += " " + (elem
      ? colorFg(config, elem, value, opts)
      : dimAll
        ? colorFg(config, "modelValue", value, opts)
        : value);
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
  config: UsageWidgetConfig,
  mode: DisplayMode,
  highlightElement?: ColorElement,
): string {
  const { dimAll = false } = options;
  const opts = { theme, highlightElement, mode };

  // First column: provider
  const provTrunc =
    layout.nameWidth > 0 ? truncateToWidth(providerName, layout.nameWidth) : "";
  const provStyled = colorFg(config, "providerValue", provTrunc, opts);
  const provCell =
    layout.nameWidth > 0 ? padRight(provStyled, layout.nameWidth) : "";

  // Second column: model
  const name2Width = layout.nameWidth2 ?? layout.nameWidth;
  const modelTrunc =
    name2Width > 0 ? truncateToWidth(modelName, name2Width) : "";
  const modelStyled = dimAll
    ? colorFg(config, "modelValue", modelTrunc, opts)
    : colorFg(config, "modelValue", modelTrunc, opts);
  const modelCell = name2Width > 0 ? padRight(modelStyled, name2Width) : "";

  let row = provCell + modelCell;

  for (const col of layout.columns) {
    const value = fitCell(col.getValue(stats), col.width, "right");
    const elem = col.valueElement;
    row += " " + (elem
      ? colorFg(config, elem, value, opts)
      : dimAll
        ? colorFg(config, "modelValue", value, opts)
        : value);
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
  config: UsageWidgetConfig,
  mode: DisplayMode,
  modelColLabel?: string,
  highlightElement?: ColorElement,
): string[] {
  const lines: string[] = [];
  const opts = { theme, highlightElement, mode };

  if (modelColLabel !== undefined) {
    // Dual name columns
    const provHdr = fitCell(providerColLabel, layout.nameWidth);
    const modelHdr = fitCell(
      modelColLabel,
      layout.nameWidth2 ?? layout.nameWidth,
    );
    let headerLine =
      colorFg(config, "providerHeader", provHdr, opts) +
      colorFg(config, "modelHeader", modelHdr, opts);
    for (const col of layout.columns) {
      const label = fitCell(col.label, col.width, "right");
      headerLine += " " + (col.headerElement
        ? colorFg(config, col.headerElement, label, opts)
        : label);
    }
    lines.push(headerLine);
  } else {
    let headerLine = colorFg(
      config,
      "providerHeader",
      fitCell(providerColLabel, layout.nameWidth),
      opts,
    );
    for (const col of layout.columns) {
      const label = fitCell(col.label, col.width, "right");
      headerLine += " " + (col.headerElement
        ? colorFg(config, col.headerElement, label, opts)
        : label);
    }
    lines.push(headerLine);
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
  config: UsageWidgetConfig,
  mode: DisplayMode,
  highlightElement?: ColorElement,
): string[] {
  const lines: string[] = [];
  const hasDualNames = layout.nameWidth2 !== undefined;
  const opts = { theme, highlightElement, mode };

  if (hasDualNames) {
    // Merge Provider & Model name cells into one spanned "Total" cell
    const totalNameWidth = layout.nameWidth + (layout.nameWidth2 ?? 0);
    let totalRow = fitCell(
      colorFg(config, "totalLabel", theme.bold("Total"), opts),
      totalNameWidth,
    );
    for (const col of layout.columns) {
      const value = fitCell(col.getValue(totals), col.width, "right");
      const elem = col.valueElement ?? "totalLabel";
      totalRow += " " + colorFg(config, elem, value, opts);
    }
    lines.push(totalRow);
  } else {
    let totalRow = fitCell(
      colorFg(config, "totalLabel", theme.bold("Total"), opts),
      layout.nameWidth,
    );
    for (const col of layout.columns) {
      const value = fitCell(col.getValue(totals), col.width, "right");
      const elem = col.valueElement ?? "totalLabel";
      totalRow += " " + colorFg(config, elem, value, opts);
    }
    lines.push(totalRow);
  }

  return lines;
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
  config: UsageWidgetConfig,
  mode: DisplayMode,
  highlightElement?: ColorElement,
): string[] {
  const totals = data.totals;
  const scopeLabel = formatScopeLabel(scope);

  // Build empty-state line respecting visibility flags
  if (totals.messages === 0) {
    let emptyLine = "";
    if (columnConfig.showTitle) {
      emptyLine += colorFg(config, "title", "Usage: ---", { theme, highlightElement, mode });
    }
    if (columnConfig.showScope) {
      const parens = emptyLine ? ` (${scopeLabel})` : `(${scopeLabel})`;
      emptyLine += colorFg(config, "scope", parens, { theme, highlightElement, mode });
    }
    return [emptyLine || "Usage: ---"];
  }

  // Build a map of column id → [colorElement, formattedText]
  const colParts: Record<string, [ColorElement, string]> = {};

  if (columnConfig.sessions) {
    colParts["sessions"] = [
      "sessionsValue",
      `${formatNumber(totals.sessions)} sessions`,
    ];
  }
  if (columnConfig.msgs) {
    colParts["msgs"] = [
      "msgsValue",
      `${formatNumber(totals.messages)} msgs`,
    ];
  }
  if (columnConfig.cost) {
    colParts["cost"] = ["costValue", formatCostFixed3(totals.cost)];
  }
  if (columnConfig.tokens) {
    colParts["tokens"] = [
      "tokensValue",
      `${formatTokens(totals.tokens.total)} tokens`,
    ];
  }
  if (columnConfig.tokensIn) {
    colParts["tokensIn"] = [
      "tokensInValue",
      `\u2191${formatTokens(totals.tokens.input + totals.tokens.cacheWrite)}`,
    ];
  }
  if (columnConfig.tokensOut) {
    colParts["tokensOut"] = [
      "tokensOutValue",
      `\u2193${formatTokens(totals.tokens.output)}`,
    ];
  }
  if (columnConfig.cache) {
    colParts["cache"] = [
      "cacheValue",
      `${formatTokens(totals.tokens.cacheRead + totals.tokens.cacheWrite)} cache`,
    ];
  }

  // Build ordered parts array respecting columnOrder (user's configured reorder).
  // The "scope" pseudo-column can appear anywhere in the order and outputs the
  // scope label in that position. If scope is not in the order (backward compat),
  // it is appended at the end.
  const order = columnConfig.columnOrder && columnConfig.columnOrder.length > 0
    ? columnConfig.columnOrder
    : DEFAULT_COLUMN_ORDER;

  const parts: Array<[ColorElement, string]> = [];
  let scopeEmitted = false;

  for (const colId of order) {
    if (colId === "scope" && columnConfig.showScope) {
      parts.push(["scope", `(${scopeLabel})`]);
      scopeEmitted = true;
    } else {
      const entry = colParts[colId];
      if (entry) {
        parts.push(entry);
      }
    }
  }

  // Backward compat: if scope is visible but not in columnOrder, append at end
  if (columnConfig.showScope && !scopeEmitted) {
    parts.push(["scope", `(${scopeLabel})`]);
  }

  // Build the joined stats string with optional separator
  const sep = columnConfig.showSeparator
    ? colorFg(config, "separator", " \u00b7 ", { theme, highlightElement, mode })
    : " ";
  const joined =
    parts.length > 0
      ? parts
          .map(([el, text]) =>
            colorFg(config, el, text, { theme, highlightElement, mode }),
          )
          .join(sep)
      : "";

  // Build the output line
  let line = "";

  // Title prefix
  if (columnConfig.showTitle) {
    line += colorFg(config, "title", "Usage: ", { theme, highlightElement, mode });
  }

  // Stats (now includes scope label at configured position)
  line += joined;

  return [line];
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
  mode: DisplayMode,
  highlightElement?: ColorElement,
): string[] {
  if (data.totals.messages === 0) {
    return [
      colorFg(config, "title", `Usage: --- (${formatScopeLabel(scope)})`, { mode }),
    ];
  }

  const lines: string[] = [];

  // Scope label for header row
  const scopeLabel = formatScopeLabel(scope);
  const headerLabel = `Usage (${scopeLabel})`;

  // Filter columns by config
  const columns = filterDataColumns(FULL_DATA_COLUMNS, columnConfig);

  if (columns.length === 0 && !columnConfig.provider) {
    // Nothing to show
    return lines;
  }

  if (columns.length === 0) {
    // No stat columns — simple provider list
    if (columnConfig.provider) {
      const providers = Array.from(data.providers.entries()).sort(
        (a, b) => b[1].cost - a[1].cost,
      );
      for (const [provider] of providers) {
        lines.push(colorFg(config, "providerValue", "  " + provider, { mode }));
      }
    }
    return lines;
  }

  // Build candidates from filtered columns
  const candidates: TableLayoutCandidate[] = buildLayoutCandidates(columns);

  // Compute dynamic max name width from actual provider names
  let maxNameLen = 0;
  for (const [name] of data.providers) {
    maxNameLen = Math.max(maxNameLen, name.length);
  }
  const layout = selectTableLayout(candidates, width, false);
  fitDynamicNameWidth(layout, maxNameLen + 1, width, headerLabel);

  if (!columnConfig.provider) {
    layout.nameWidth = 0;
    layout.tableWidth = sumColumnWidths(layout.columns) + layout.columns.length;
  }

  // Header
  if (columnConfig.showHeaders && columnConfig.provider) {
    lines.push(...renderTableHeader(theme, layout, headerLabel, config, mode, undefined, highlightElement));
  }

  // Header separator
  if (columnConfig.showHeaderLine) {
    const headerSep = renderSeparatorLine(
      theme,
      config,
      "headerLine",
      layout.tableWidth,
      mode,
      highlightElement,
    );
    if (headerSep !== null) lines.push(headerSep);
  }

  // Provider rows
  const providers = Array.from(data.providers.entries()).sort(
    (a, b) => b[1].cost - a[1].cost,
  );

  if (providers.length === 0) {
    lines.push(colorFg(config, "title", "  No usage data for this period", { theme, highlightElement, mode }));
  } else if (columnConfig.provider) {
    for (const [providerName, providerStats] of providers) {
      const prefix = colorFg(config, "providerValue", "\u25b8 ", { theme, highlightElement, mode });
      lines.push(
        renderDataRow(
          theme,
          providerName,
          providerStats,
          layout,
          { prefix },
          config,
          mode,
          highlightElement,
        ),
      );
    }
  } else {
    // No provider column — show just data columns
    for (const [, providerStats] of providers) {
      lines.push(renderDataRow(theme, "", providerStats, layout, {}, config, mode, highlightElement));
    }
  }

  // Footer separator
  if (columnConfig.showFooterLine) {
    const footerSep = renderSeparatorLine(
      theme,
      config,
      "footerLine",
      layout.tableWidth,
      mode,
      highlightElement,
    );
    if (footerSep !== null) lines.push(footerSep);
  }

  // Totals
  if (columnConfig.showTotals) {
    lines.push(
      ...renderTotalsRow(theme, data.totals, layout, columnConfig, config, mode, highlightElement),
    );
  }

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
  mode: DisplayMode,
  highlightElement?: ColorElement,
): string[] {
  if (data.totals.messages === 0) {
    return [
      colorFg(config, "title", `Usage: --- (${formatScopeLabel(scope)})`, { mode }),
    ];
  }

  const lines: string[] = [];

  // Scope label for header row
  const scopeLabel = formatScopeLabel(scope);
  const headerLabel = `Usage (${scopeLabel})`;

  const showProvider = columnConfig.provider;
  const showModel = columnConfig.model;
  const showCombined = showProvider && showModel;

  // Flatten all models from all providers, sorted by cost descending.
  interface ModelEntry {
    name: string; // display name (provider/model, provider, or model)
    providerName?: string; // separate provider name for two-part coloring
    modelName?: string; // separate model name for two-part coloring
    stats: ModelStats;
  }

  const models: ModelEntry[] = [];
  for (const [providerName, providerStats] of data.providers) {
    for (const [modelName, modelStats] of providerStats.models) {
      const entry: ModelEntry = { stats: modelStats };
      if (showCombined) {
        entry.name = `${providerName}/${modelName}`;
        entry.providerName = providerName;
        entry.modelName = modelName;
      } else if (showProvider) {
        entry.name = providerName;
        entry.providerName = providerName;
      } else if (showModel) {
        entry.name = modelName;
        entry.modelName = modelName;
      } else {
        entry.name = "";
      }
      models.push(entry);
    }
  }
  models.sort((a, b) => b.stats.cost - a.stats.cost);

  // Filter columns by config
  const columns = filterDataColumns(PER_MODEL_DATA_COLUMNS, columnConfig);

  if (columns.length === 0 && !showProvider && !showModel) {
    // Nothing to show
    return lines;
  }

  // Compute max lengths for provider and model names independently.
  // Using independent maxes ensures the column accommodates the longest
  // provider and the longest model even when they come from different entries.
  let maxProviderLen = 4;
  let maxModelLen = 4;
  for (const entry of models) {
    if (entry.providerName) {
      maxProviderLen = Math.max(maxProviderLen, visibleWidth(entry.providerName));
    }
    if (entry.modelName) {
      maxModelLen = Math.max(maxModelLen, visibleWidth(entry.modelName));
    }
  }

  let maxNameLen: number;
  if (showCombined) {
    maxNameLen = maxProviderLen + 1 + maxModelLen; // +1 for "/" separator
  } else if (showProvider) {
    maxNameLen = maxProviderLen;
  } else if (showModel) {
    maxNameLen = maxModelLen;
  } else {
    maxNameLen = 4;
  }

  let layout: TableLayout;

  if (showProvider || showModel) {
    // Single name column (merged provider/model when both shown)
    const candidates = buildLayoutCandidates(columns);
    layout = selectTableLayout(candidates, width, false);
    fitDynamicNameWidth(layout, maxNameLen + 1, width, headerLabel);

    if (columnConfig.showHeaders) {
      lines.push(...renderTableHeader(theme, layout, headerLabel, config, mode, undefined, highlightElement));
    }
  } else {
    // No name columns — just data
    const candidates = buildLayoutCandidates(columns);
    layout = selectTableLayout(candidates, width, false);
    layout.nameWidth = 0;
    layout.tableWidth = sumColumnWidths(layout.columns) + layout.columns.length;
  }

  // Header separator
  if (columnConfig.showHeaderLine) {
    const headerSep = renderSeparatorLine(
      theme,
      config,
      "headerLine",
      layout.tableWidth,
      mode,
      highlightElement,
    );
    if (headerSep !== null) lines.push(headerSep);
  }

  if (models.length === 0) {
    lines.push(colorFg(config, "title", "  No usage data for this period", { theme, highlightElement, mode }));
  } else {
    for (const entry of models) {
      if (showProvider || showModel) {
        const rowOpts: {
          namePart2?: string;
          nameSep?: string;
          dimAll?: boolean;
          namePart1Width?: number;
          namePart2Width?: number;
        } = {};
        if (showCombined && entry.providerName && entry.modelName) {
          rowOpts.namePart2 = entry.modelName;
          rowOpts.nameSep = "/";
          rowOpts.namePart1Width = maxProviderLen;
          rowOpts.namePart2Width = maxModelLen;
        } else if (showModel && !showProvider) {
          // Only model shown — use modelValue for the name
          rowOpts.dimAll = true;
        }
        lines.push(
          renderDataRow(
            theme,
            showCombined ? (entry.providerName ?? entry.name) : entry.name,
            entry.stats,
            layout,
            rowOpts,
            config,
            mode,
            highlightElement,
          ),
        );
      } else {
        // No name columns — just data columns
        const opts = { theme, highlightElement, mode };
        let row = "";
        for (const col of layout.columns) {
          const value = fitCell(col.getValue(entry.stats), col.width, "right");
          const elem = col.valueElement;
          row += " " + (elem ? colorFg(config, elem, value, opts) : value);
        }
        lines.push(row);
      }
    }
  }

  // Footer separator
  if (columnConfig.showFooterLine) {
    const footerSep = renderSeparatorLine(
      theme,
      config,
      "footerLine",
      layout.tableWidth,
      mode,
      highlightElement,
    );
    if (footerSep !== null) lines.push(footerSep);
  }

  // Totals
  if (columnConfig.showTotals) {
    lines.push(
      ...renderTotalsRow(theme, data.totals, layout, columnConfig, config, mode, highlightElement),
    );
  }

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
  mode: DisplayMode,
  highlightElement?: ColorElement,
): string[] {
  if (data.totals.messages === 0) {
    return [
      colorFg(config, "title", `Usage: --- (${formatScopeLabel(scope)})`, { mode }),
    ];
  }

  const lines: string[] = [];

  // Scope label for header row
  const scopeLabel = formatScopeLabel(scope);
  const headerLabel = `Usage (${scopeLabel})`;

  const showProvider = columnConfig.provider;
  const showModel = columnConfig.model;

  // Filter columns by config
  const columns = filterDataColumns(FULL_DATA_COLUMNS, columnConfig);

  if (columns.length === 0 && !showProvider && !showModel) {
    // Nothing to show
    return lines;
  }

  if (columns.length === 0) {
    // No stat columns — simple provider list with models
    const providers = Array.from(data.providers.entries()).sort(
      (a, b) => b[1].cost - a[1].cost,
    );
    for (const [providerName, providerStats] of providers) {
      if (showProvider) {
        lines.push(
          colorFg(config, "providerValue", "  \u25be ", { mode }) + providerName,
        );
      }
      if (showModel) {
        const providerModels = Array.from(providerStats.models.entries()).sort(
          (a, b) => b[1].cost - a[1].cost,
        );
        for (const [modelName] of providerModels) {
          lines.push(colorFg(config, "modelValue", "      " + modelName, { mode }));
        }
      }
    }
    return lines;
  }

  // Compute max name width needed (provider names or indented model names)
  let maxNameLen = 0;
  if (showProvider || showModel) {
    for (const [pName, pStats] of data.providers) {
      if (showProvider) maxNameLen = Math.max(maxNameLen, pName.length);
      if (showModel) {
        for (const [mName] of pStats.models) {
          maxNameLen = Math.max(maxNameLen, mName.length + 4);
        }
      }
    }
  }

  const candidates = buildLayoutCandidates(columns);
  const layout = selectTableLayout(candidates, width, false);
  fitDynamicNameWidth(layout, maxNameLen + 1, width, headerLabel);

  if (!showProvider && !showModel) {
    layout.nameWidth = 0;
    layout.tableWidth = sumColumnWidths(layout.columns) + layout.columns.length;
  }

  // Header
  if (columnConfig.showHeaders) {
    lines.push(...renderTableHeader(theme, layout, headerLabel, config, mode, undefined, highlightElement));
  }

  // Header separator
  if (columnConfig.showHeaderLine) {
    const headerSep = renderSeparatorLine(
      theme,
      config,
      "headerLine",
      layout.tableWidth,
      mode,
      highlightElement,
    );
    if (headerSep !== null) lines.push(headerSep);
  }

  // Provider rows with expanded models
  const providers = Array.from(data.providers.entries()).sort(
    (a, b) => b[1].cost - a[1].cost,
  );

  if (providers.length === 0) {
    lines.push(colorFg(config, "title", "  No usage data for this period", { theme, highlightElement, mode }));
  } else {
    for (const [providerName, providerStats] of providers) {
      if (showProvider) {
        const prefix = colorFg(config, "providerValue", "\u25be ", { theme, highlightElement, mode });
        lines.push(
          renderDataRow(
            theme,
            providerName,
            providerStats,
            layout,
            { prefix },
            config,
            mode,
            highlightElement,
          ),
        );
      }

      if (showModel) {
        const providerModels = Array.from(providerStats.models.entries()).sort(
          (a, b) => b[1].cost - a[1].cost,
        );
        for (const [modelName, modelStats] of providerModels) {
          lines.push(
            renderDataRow(
              theme,
              modelName,
              modelStats,
              layout,
              { indent: showProvider ? 4 : 0, dimAll: true },
              config,
              mode,
              highlightElement,
            ),
          );
        }
      }
    }
  }

  // Footer separator
  if (columnConfig.showFooterLine) {
    const footerSep = renderSeparatorLine(
      theme,
      config,
      "footerLine",
      layout.tableWidth,
      mode,
      highlightElement,
    );
    if (footerSep !== null) lines.push(footerSep);
  }

  // Totals
  if (columnConfig.showTotals) {
    lines.push(
      ...renderTotalsRow(theme, data.totals, layout, columnConfig, config, mode, highlightElement),
    );
  }

  return lines;
}

// =============================================================================
// Layout candidate builder — respects column config filtering
// =============================================================================

/**
 * After layout selection, size columns dynamically so the table fills
 * the available width. The name column gets at least maxNameLen + 1 chars.
 * When full-width columns fit, use them and give extra space to the name.
 * When tight, shrink/drop data columns to make room for the name.
 */
function fitDynamicNameWidth(
  layout: TableLayout,
  maxNameLen: number,
  availableWidth: number,
  headerLabel?: string,
): void {
  if (maxNameLen <= 0 && !headerLabel) return;
  // Consider header label width so it doesn't get truncated
  const headerLen = headerLabel ? visibleWidth(headerLabel) : 0;
  const minNameWidth = Math.max(maxNameLen + 1, headerLen + 1);
  const clampedMin = Math.min(minNameWidth, availableWidth - 4);
  const fullDataWidth = sumColumnWidths(layout.columns);
  const fullTotal = clampedMin + fullDataWidth;

  if (fullTotal <= availableWidth) {
    // Everything fits at full width — use natural widths, extra space stays on the right
    layout.nameWidth = minNameWidth;
    // + layout.columns.length accounts for " " prefix before each data column
    layout.tableWidth = fullTotal + layout.columns.length;
    return;
  }

  // Tight: keep columns at full width while budget allows,
  // shrink the crossing column, drop the rest
  let budget = availableWidth - clampedMin;
  const slimmed: DataColumn[] = [];
  for (const col of layout.columns) {
    if (budget >= col.width) {
      slimmed.push(col);
      budget -= col.width;
    } else if (budget >= 4) {
      // Shrink this column to consume the remaining budget
      slimmed.push({ ...col, width: budget });
      budget = 0;
    }
    // else: drop this column (budget < 4)
  }

  // If no columns survived, keep at least one at 4 chars
  if (slimmed.length === 0) {
    slimmed.push({ ...layout.columns[0]!, width: 4 });
  }

  layout.columns = slimmed;
  layout.nameWidth = clampedMin;
  // + slimmed.length accounts for " " prefix before each data column
  layout.tableWidth = layout.nameWidth + sumColumnWidths(slimmed) + slimmed.length;
}

function buildLayoutCandidates(
  filteredColumns: DataColumn[],
): TableLayoutCandidate[] {
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
    const minName =
      colsWidth <= 20 ? 10 : colsWidth <= 35 ? 14 : MAX_NAME_COL_WIDTH;
    candidates.push({
      columns: [...cols],
      minNameWidth: minName,
      compact: true,
    });
  }

  // Last: single column
  candidates.push({
    columns: [filteredColumns[0]!],
    minNameWidth: 4,
    compact: true,
  });

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
  const valid: DisplayMode[] = [
    "summary",
    "compact",
    "Per Model",
    "expanded",
    "hidden",
  ];
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
  highlightElement?: ColorElement,
): string[] {
  const activeMode = mode ?? config.defaultMode;
  const activeScope = scope ?? config.defaultScope;
  const safeWidth = Math.max(width, 0);

  // Handle legacy display modes (backward compat with existing widget cycle)
  const resolvedMode = normalizeMode(activeMode);

  // Hidden mode — flash message handled by UsageWidget, render nothing here
  if (resolvedMode === "hidden") {
    return [];
  }

  // Get data for the active time scope
  const scopeStats = data[activeScope] as TimeFilteredStats | undefined;

  // Guard against invalid/missing scope data
  if (!scopeStats) {
    return [
      colorFg(config, "title", `Usage: --- (${formatScopeLabel(activeScope)})`),
    ];
  }

  // Build live theme fg map so role-name overrides (e.g. "accent") use
  // the user's active Pi theme colors instead of hardcoded defaults.
  const themeFgMap: Record<string, string> = {};
  for (const role of Object.keys(defaultThemeFgMap)) {
    const hex = getThemeHex(theme, role);
    if (hex) themeFgMap[role] = hex;
  }

  // Get column config for the active mode
  const columnConfig = config.modes[resolvedMode] ?? config.modes["compact"]!;

  // Route to mode renderer
  let lines: string[];
  switch (resolvedMode) {
    case "summary":
      lines = renderSummary(
        theme,
        columnConfig,
        scopeStats,
        activeScope,
        safeWidth,
        config,
        resolvedMode,
        highlightElement,
      );
      break;

    case "compact":
      lines = renderCompact(
        theme,
        columnConfig,
        scopeStats,
        activeScope,
        safeWidth,
        config,
        resolvedMode,
        highlightElement,
      );
      break;

    case "Per Model":
      lines = renderPerModel(
        theme,
        columnConfig,
        scopeStats,
        activeScope,
        safeWidth,
        config,
        resolvedMode,
        highlightElement,
      );
      break;

    case "expanded":
      lines = renderExpanded(
        theme,
        columnConfig,
        scopeStats,
        activeScope,
        safeWidth,
        config,
        resolvedMode,
        highlightElement,
      );
      break;

    default:
      return [];
  }

  // Apply placement padding for detached mode
  if (config.placement.mode === "detached") {
    const { paddingX, paddingY } = config.placement;
    const hPad = " ".repeat(Math.max(paddingX, 0));
    const adjustedWidth = Math.max(safeWidth - paddingX * 2, 0);

    // Add vertical padding (blank lines) above and below
    const paddedLines: string[] = [];
    for (let i = 0; i < paddingY; i++) {
      paddedLines.push("");
    }
    paddedLines.push(...lines.map((line) => hPad + line));
    for (let i = 0; i < paddingY; i++) {
      paddedLines.push("");
    }
    lines = clampLines(paddedLines, safeWidth);
  } else {
    lines = clampLines(lines, safeWidth);
  }

  return lines;
}
