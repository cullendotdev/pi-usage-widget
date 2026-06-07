/**
 * Usage Modal — interactive /usage dashboard with table and insights views.
 *
 * Extracted from index.ts during Slice 9 integration refactor.
 * The UsageComponent handles interactive navigation (tabs, arrow keys, expand/collapse)
 * and renders the full-screen /usage modal.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  matchesKey,
  visibleWidth,
  truncateToWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type {
  BaseStats,
  TimeFilteredStats,
  UsageData,
  TabName,
  ViewMode,
  TimeScope,
} from "./types.js";
import {
  formatCost,
  formatTokens,
  formatNumber,
  formatScopeLabel,
  formatThresholdTokens,
  formatInsightPercent,
} from "./formatting.js";

// =============================================================================
// Column Configuration (for interactive modal — different widths from widget)
// =============================================================================

interface DataColumn {
  label: string;
  width: number;
  dimmed?: boolean;
  getValue: (stats: BaseStats & { sessions: Set<string> | number }) => string;
}

interface TableLayoutCandidate {
  columns: DataColumn[];
  minNameWidth: number;
  compact?: boolean;
}

interface TableLayout {
  columns: DataColumn[];
  nameWidth: number;
  tableWidth: number;
  compact: boolean;
}

const MAX_NAME_COL_WIDTH = 26;

const SESSIONS_COLUMN: DataColumn = {
  label: "Sessions",
  width: 9,
  getValue: (s) =>
    formatNumber(typeof s.sessions === "number" ? s.sessions : s.sessions.size),
};

const MSGS_COLUMN: DataColumn = {
  label: "Msgs",
  width: 9,
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

const FULL_DATA_COLUMNS: DataColumn[] = [
  SESSIONS_COLUMN,
  MSGS_COLUMN,
  COST_COLUMN,
  TOKENS_COLUMN,
  INPUT_COLUMN,
  OUTPUT_COLUMN,
  CACHE_COLUMN,
];

const TABLE_LAYOUTS: TableLayoutCandidate[] = [
  { columns: FULL_DATA_COLUMNS, minNameWidth: MAX_NAME_COL_WIDTH },
  {
    columns: [SESSIONS_COLUMN, MSGS_COLUMN, COST_COLUMN, TOKENS_COLUMN],
    minNameWidth: 14,
    compact: true,
  },
  {
    columns: [SESSIONS_COLUMN, COST_COLUMN, TOKENS_COLUMN],
    minNameWidth: 12,
    compact: true,
  },
  { columns: [COST_COLUMN, TOKENS_COLUMN], minNameWidth: 10, compact: true },
  { columns: [COST_COLUMN], minNameWidth: 8, compact: true },
];

// =============================================================================
// Helpers
// =============================================================================

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

function sumColumnWidths(columns: DataColumn[]): number {
  return columns.reduce((sum, col) => sum + col.width, 0);
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

function pickFittingText(width: number, variants: string[]): string {
  for (const variant of variants) {
    if (visibleWidth(variant) <= width) return variant;
  }
  return variants[variants.length - 1] || "";
}

function getTableLayout(width: number): TableLayout {
  const safeWidth = Math.max(width, 0);

  for (const candidate of TABLE_LAYOUTS) {
    const columnsWidth = sumColumnWidths(candidate.columns);
    const nameWidth = Math.min(
      MAX_NAME_COL_WIDTH,
      Math.max(safeWidth - columnsWidth, 0),
    );
    if (nameWidth >= candidate.minNameWidth) {
      return {
        columns: candidate.columns,
        nameWidth,
        tableWidth: nameWidth + columnsWidth,
        compact: candidate.compact ?? false,
      };
    }
  }

  const fallback = TABLE_LAYOUTS[TABLE_LAYOUTS.length - 1]!;
  const fallbackColumnsWidth = sumColumnWidths(fallback.columns);
  const fallbackNameWidth = Math.min(
    MAX_NAME_COL_WIDTH,
    Math.max(safeWidth - fallbackColumnsWidth, 0),
  );
  return {
    columns: fallback.columns,
    nameWidth: fallbackNameWidth,
    tableWidth: fallbackNameWidth + fallbackColumnsWidth,
    compact: fallback.compact ?? false,
  };
}

// =============================================================================
// Constants
// =============================================================================

const TAB_LABELS: Record<TimeScope, string> = {
  lastHour: "Last Hour",
  today: "Today",
  yesterday: "Yesterday",
  thisWeek: "This Week",
  lastWeek: "Last Week",
  thisMonth: "This Month",
  allTime: "All Time",
};

const SCOPE_ORDER: TimeScope[] = [
  "lastHour",
  "today",
  "yesterday",
  "thisWeek",
  "lastWeek",
  "thisMonth",
  "allTime",
];

// =============================================================================
// UsageComponent
// =============================================================================

export class UsageComponent {
  private activeTab: TabName = "allTime";
  private viewMode: ViewMode = "table";
  private data: UsageData;
  private selectedIndex = 0;
  private expanded = new Set<string>();
  private providerOrder: string[] = [];
  private theme: Theme;
  private requestRender: () => void;
  private done: () => void;

  constructor(
    theme: Theme,
    data: UsageData,
    requestRender: () => void,
    done: () => void,
  ) {
    this.theme = theme;
    this.requestRender = requestRender;
    this.done = done;
    this.data = data;
    this.updateProviderOrder();
  }

  private updateProviderOrder(): void {
    const stats = this.data[this.activeTab];
    this.providerOrder = Array.from(stats.providers.entries())
      .sort((a, b) => b[1].cost - a[1].cost)
      .map(([name]) => name);
    this.selectedIndex = Math.min(
      this.selectedIndex,
      Math.max(0, this.providerOrder.length - 1),
    );
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "q")) {
      this.done();
      return;
    }

    if (matchesKey(data, "v")) {
      this.viewMode = this.viewMode === "table" ? "insights" : "table";
      this.requestRender();
      return;
    }

    if (matchesKey(data, "tab") || matchesKey(data, "right")) {
      const idx = SCOPE_ORDER.indexOf(this.activeTab);
      this.activeTab = SCOPE_ORDER[(idx + 1) % SCOPE_ORDER.length]!;
      this.updateProviderOrder();
      this.requestRender();
    } else if (matchesKey(data, "shift+tab") || matchesKey(data, "left")) {
      const idx = SCOPE_ORDER.indexOf(this.activeTab);
      this.activeTab =
        SCOPE_ORDER[(idx - 1 + SCOPE_ORDER.length) % SCOPE_ORDER.length]!;
      this.updateProviderOrder();
      this.requestRender();
    } else if (this.viewMode === "table" && matchesKey(data, "up")) {
      if (this.selectedIndex > 0) {
        this.selectedIndex--;
        this.requestRender();
      }
    } else if (this.viewMode === "table" && matchesKey(data, "down")) {
      if (this.selectedIndex < this.providerOrder.length - 1) {
        this.selectedIndex++;
        this.requestRender();
      }
    } else if (
      this.viewMode === "table" &&
      (matchesKey(data, "enter") || matchesKey(data, "space"))
    ) {
      const provider = this.providerOrder[this.selectedIndex];
      if (provider) {
        if (this.expanded.has(provider)) {
          this.expanded.delete(provider);
        } else {
          this.expanded.add(provider);
        }
        this.requestRender();
      }
    }
  }

  // -------------------------------------------------------------------------
  // Render Methods
  // -------------------------------------------------------------------------

  render(width: number): string[] {
    if (this.viewMode === "insights") {
      return clampLines(
        [
          ...this.renderTitle(),
          ...this.renderTabs(width, getTableLayout(width)),
          ...this.renderInsights(width),
          ...this.renderHelp(width),
        ],
        width,
      );
    }

    const layout = getTableLayout(width);
    return clampLines(
      [
        ...this.renderTitle(),
        ...this.renderTabs(width, layout),
        ...this.renderHeader(layout),
        ...this.renderRows(layout),
        ...this.renderTotals(layout),
        ...this.renderFormulaNote(width),
        ...this.renderHelp(width),
      ],
      width,
    );
  }

  private renderTitle(): string[] {
    const th = this.theme;
    const label =
      this.viewMode === "insights" ? "Usage Insights" : "Usage Statistics";
    return [th.fg("accent", th.bold(label)), ""];
  }

  private renderInsights(width: number): string[] {
    const th = this.theme;
    const stats = this.data[this.activeTab];
    const { insights } = stats.insights;
    const hasMessages = stats.totals.messages > 0;
    const hasCost = stats.totals.cost > 0;
    const lines: string[] = [];

    lines.push("What's contributing to your cost?");
    lines.push(
      th.fg("dim", "Approximate, based on local sessions on this machine."),
    );
    lines.push("");
    const note = `${TAB_LABELS[this.activeTab]} \u00b7 weighted by cost (USD) \u00b7 these overlap and can sum to >100%`;
    lines.push(th.fg("dim", note));
    lines.push("");

    if (!hasMessages) {
      lines.push(th.fg("dim", "  No usage recorded for this period."));
      lines.push("");
      return lines;
    }
    if (!hasCost) {
      lines.push(th.fg("dim", "  No cost data recorded for this period."));
      lines.push("");
      return lines;
    }
    if (insights.length === 0) {
      lines.push(th.fg("dim", "  No insights above 1% for this period."));
      lines.push("");
      return lines;
    }

    const indent = "     ";
    const adviceWidth = Math.max(width - indent.length, 30);

    for (const insight of insights) {
      const pct = th.fg(
        "accent",
        th.bold(formatInsightPercent(insight.percent)),
      );
      lines.push(`${pct} ${insight.headline}`);
      for (const wrapped of wrapTextWithAnsi(insight.advice, adviceWidth)) {
        lines.push(`${indent}${th.fg("dim", wrapped)}`);
      }
      lines.push("");
    }

    return lines;
  }

  private renderTabs(width: number, layout: TableLayout): string[] {
    const th = this.theme;
    const fullTabs = SCOPE_ORDER.map((tab) => {
      const label = TAB_LABELS[tab];
      return tab === this.activeTab
        ? th.fg("accent", `[${label}]`)
        : th.fg("dim", ` ${label} `);
    }).join("  ");

    const activeTabOnly = th.fg("accent", `[${TAB_LABELS[this.activeTab]}]`);
    const tabLine = pickFittingText(width, [
      fullTabs,
      `${activeTabOnly}  ${th.fg("dim", "[Tab/\u2190\u2192]")}`,
      activeTabOnly,
    ]);

    const infoLines =
      this.viewMode === "table" && layout.compact
        ? wrapTextWithAnsi(
            th.fg("dim", "Compact view. Widen the terminal for more columns."),
            Math.max(width, 1),
          )
        : [];

    return [tabLine, ...infoLines, ""];
  }

  private renderHeader(layout: TableLayout): string[] {
    const th = this.theme;

    let headerLine = fitCell("Provider / Model", layout.nameWidth);
    for (const col of layout.columns) {
      const label = fitCell(col.label, col.width, "right");
      headerLine += col.dimmed ? th.fg("dim", label) : label;
    }

    return [
      th.fg("muted", headerLine),
      th.fg("border", "\u2500".repeat(layout.tableWidth)),
    ];
  }

  private renderDataRow(
    name: string,
    stats: BaseStats & { sessions: Set<string> | number },
    layout: TableLayout,
    options: {
      indent?: number;
      selected?: boolean;
      dimAll?: boolean;
      prefix?: string;
    } = {},
  ): string {
    const th = this.theme;
    const { indent = 0, selected = false, dimAll = false, prefix } = options;

    const rawPrefix = prefix ?? " ".repeat(indent);
    const safePrefix =
      layout.nameWidth > 0
        ? truncateToWidth(rawPrefix, layout.nameWidth, "")
        : "";
    const prefixWidth = visibleWidth(safePrefix);
    const innerNameWidth = Math.max(layout.nameWidth - prefixWidth, 0);
    const truncName =
      innerNameWidth > 0 ? truncateToWidth(name, innerNameWidth) : "";
    const styledName = selected
      ? th.fg("accent", truncName)
      : dimAll
        ? th.fg("dim", truncName)
        : truncName;

    let row =
      safePrefix +
      (innerNameWidth > 0 ? padRight(styledName, innerNameWidth) : "");

    for (const col of layout.columns) {
      const value = fitCell(col.getValue(stats), col.width, "right");
      const shouldDim = col.dimmed || dimAll;
      row += shouldDim ? th.fg("dim", value) : value;
    }

    return row;
  }

  private renderRows(layout: TableLayout): string[] {
    const th = this.theme;
    const stats = this.data[this.activeTab];
    const lines: string[] = [];

    if (this.providerOrder.length === 0) {
      lines.push(th.fg("dim", "  No usage data for this period"));
      return lines;
    }

    for (let i = 0; i < this.providerOrder.length; i++) {
      const providerName = this.providerOrder[i]!;
      const providerStats = stats.providers.get(providerName)!;
      const isSelected = i === this.selectedIndex;
      const isExpanded = this.expanded.has(providerName);
      const arrow = isExpanded ? "\u25be" : "\u25b8";
      const prefix = isSelected
        ? th.fg("accent", `${arrow} `)
        : th.fg("dim", `${arrow} `);

      lines.push(
        this.renderDataRow(providerName, providerStats, layout, {
          selected: isSelected,
          prefix,
        }),
      );

      if (isExpanded) {
        const models = Array.from(providerStats.models.entries()).sort(
          (a, b) => b[1].cost - a[1].cost,
        );

        for (const [modelName, modelStats] of models) {
          lines.push(
            this.renderDataRow(modelName, modelStats, layout, {
              indent: 4,
              dimAll: true,
            }),
          );
        }
      }
    }

    return lines;
  }

  private renderTotals(layout: TableLayout): string[] {
    const th = this.theme;
    const stats = this.data[this.activeTab];

    let totalRow = fitCell(th.bold("Total"), layout.nameWidth);
    for (const col of layout.columns) {
      const value = fitCell(col.getValue(stats.totals), col.width, "right");
      totalRow += col.dimmed ? th.fg("dim", value) : value;
    }

    return [th.fg("border", "\u2500".repeat(layout.tableWidth)), totalRow, ""];
  }

  private renderFormulaNote(width: number): string[] {
    const line = pickFittingText(width, [
      "Tokens = Input + Output + CacheWrite  \u00b7  \u2191In = Input + CacheWrite  (as of 0.2.0)",
      "Tokens = In + Out + CacheWrite  \u00b7  \u2191In = In + CacheWrite  (v0.2.0+)",
      "Tokens & \u2191In include CacheWrite (v0.2.0+)",
      "Incl. CacheWrite (v0.2.0+)",
    ]);
    return [this.theme.fg("dim", line), ""];
  }

  private renderHelp(width: number): string[] {
    const variants =
      this.viewMode === "insights"
        ? [
            "[Tab/\u2190\u2192] period  [v] table view  [q] close",
            "[Tab] period  [v] table  [q] close",
            "[v] table  [q] close",
            "[q] close",
          ]
        : [
            "[Tab/\u2190\u2192] period  [\u2191\u2193] select  [Enter] expand  [v] insights  [q] close",
            "[Tab] period  [\u2191\u2193] select  [Enter] expand  [v] insights  [q] close",
            "[\u2191\u2193] select  [Enter] expand  [v] insights  [q] close",
            "[\u2191\u2193] select  [v] insights  [q] close",
            "[\u2191\u2193] select  [q] close",
            "[q] close",
          ];
    const line = pickFittingText(width, variants);
    return [this.theme.fg("dim", line)];
  }

  invalidate(): void {}
  dispose(): void {}
}
