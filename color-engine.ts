/**
 * Color engine — themed presets, override resolution, and ANSI conversion.
 *
 * Exports:
 *   - colorElements       — array of all valid element keys
 *   - colorPresets        — 6 themed ColorScheme presets
 *   - defaultThemeFgMap   — mapping from Theme fg role names to hex colors
 *   - hexToAnsi()         — convert hex (#rrggbb) to ANSI truecolor escape
 *   - ansiNameToAnsi()    — convert 16-color ANSI name to escape
 *   - resolveColor()      — resolve element → ANSI code from config layers
 *
 * Never touches the file system. Pure functions only.
 */

import type { UsageWidgetConfig, DisplayMode, ColorOverrides, ThemedPreset } from "./types.js";

// =============================================================================
// Element enumeration
// =============================================================================

/**
 * Ordered array of every colorable element in the widget.
 * Maintains parity with ColorOverrides keys in types.ts.
 */
export const colorElements = [
  "title",
  "scope",
  // Column headers
  "providerHeader",
  "modelHeader",
  "sessionsHeader",
  "msgsHeader",
  "costHeader",
  "tokensHeader",
  "tokensInHeader",
  "tokensOutHeader",
  "cacheHeader",
  // Column values
  "providerValue",
  "modelValue",
  "sessionsValue",
  "msgsValue",
  "costValue",
  "tokensValue",
  "tokensInValue",
  "tokensOutValue",
  "cacheValue",
  // Separator lines
  "headerLine",
  "footerLine",
] as const;

/** Union type of all element keys (derived from the const array). */
export type ColorElement = (typeof colorElements)[number];

/** Complete color scheme — every element mapped to a hex color. */
export type ColorScheme = Record<ColorElement, string>;

// =============================================================================
// Default Theme fg role → hex mapping
// =============================================================================

/**
 * Maps Pi Theme fg role names to their canonical hex colors.
 * Used when an override references a role name instead of a raw hex code.
 *
 * The color engine does not import Theme directly — callers pass this map
 * (or a live map extracted from a Theme instance) via resolveColor() options.
 */
export const defaultThemeFgMap: Record<string, string> = {
  accent: "#58a6ff",
  muted: "#8b949e",
  dim: "#6a737d",
  text: "#c9d1d9",
  border: "#30363d",
  thinkingText: "#8b949e",
  error: "#f85149",
  warning: "#d29922",
  success: "#56d364",
  info: "#58a6ff",
};

// =============================================================================
// ANSI conversion helpers
// =============================================================================

const ANSI_4BIT_NAMES: Record<string, string> = {
  black: "\x1b[30m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  brightBlack: "\x1b[90m",
  brightRed: "\x1b[91m",
  brightGreen: "\x1b[92m",
  brightYellow: "\x1b[93m",
  brightBlue: "\x1b[94m",
  brightMagenta: "\x1b[95m",
  brightCyan: "\x1b[96m",
  brightWhite: "\x1b[97m",
};

const HEX_RE = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/;

/**
 * Convert a hex color string (#rrggbb) to an ANSI truecolor foreground escape.
 * Returns empty string for invalid input (caller handles fallback).
 */
export function hexToAnsi(hex: string): string {
  const m = HEX_RE.exec(hex);
  if (!m) return "";
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return `\x1b[38;2;${r};${g};${b}m`;
}

/**
 * Convert a 16-color ANSI palette name to its escape sequence.
 * Returns empty string for unknown names.
 */
export function ansiNameToAnsi(name: string): string {
  return ANSI_4BIT_NAMES[name] ?? "";
}

// =============================================================================
// Themed presets
// =============================================================================

/**
 * Immutable presets keyed by ThemedPreset name.
 * Every preset covers all 22 elements with hex colors.
 */
export const colorPresets: Record<ThemedPreset, ColorScheme> = {
  // ==========================================================================
  // Default — clean blue/gray (Pi-like)
  // ==========================================================================
  default: {
    title: "#58a6ff",
    scope: "#8b949e",
    // Headers
    providerHeader: "#8b949e",
    modelHeader: "#8b949e",
    sessionsHeader: "#8b949e",
    msgsHeader: "#8b949e",
    costHeader: "#e3b341",
    tokensHeader: "#8b949e",
    tokensInHeader: "#6a737d",
    tokensOutHeader: "#6a737d",
    cacheHeader: "#6a737d",
    // Values
    providerValue: "#c9d1d9",
    modelValue: "#c9d1d9",
    sessionsValue: "#c9d1d9",
    msgsValue: "#c9d1d9",
    costValue: "#e3b341",
    tokensValue: "#c9d1d9",
    tokensInValue: "#6a737d",
    tokensOutValue: "#6a737d",
    cacheValue: "#6a737d",
    // Lines
    headerLine: "#30363d",
    footerLine: "#30363d",
  },

  // ==========================================================================
  // Tokyo Night — dark blue/purple, vibrant accents
  // ==========================================================================
  "tokyo-night": {
    title: "#7aa2f7",
    scope: "#565f89",
    // Headers
    providerHeader: "#9ece6a",
    modelHeader: "#9ece6a",
    sessionsHeader: "#565f89",
    msgsHeader: "#565f89",
    costHeader: "#e0af68",
    tokensHeader: "#565f89",
    tokensInHeader: "#3b4261",
    tokensOutHeader: "#3b4261",
    cacheHeader: "#3b4261",
    // Values
    providerValue: "#c0caf5",
    modelValue: "#c0caf5",
    sessionsValue: "#a9b1d6",
    msgsValue: "#a9b1d6",
    costValue: "#e0af68",
    tokensValue: "#a9b1d6",
    tokensInValue: "#565f89",
    tokensOutValue: "#565f89",
    cacheValue: "#565f89",
    // Lines
    headerLine: "#292e42",
    footerLine: "#292e42",
  },

  // ==========================================================================
  // Dracula — purple/cyan/pink
  // ==========================================================================
  dracula: {
    title: "#bd93f9",
    scope: "#6272a4",
    // Headers
    providerHeader: "#8be9fd",
    modelHeader: "#8be9fd",
    sessionsHeader: "#6272a4",
    msgsHeader: "#6272a4",
    costHeader: "#f1fa8c",
    tokensHeader: "#6272a4",
    tokensInHeader: "#44475a",
    tokensOutHeader: "#44475a",
    cacheHeader: "#44475a",
    // Values
    providerValue: "#f8f8f2",
    modelValue: "#f8f8f2",
    sessionsValue: "#f8f8f2",
    msgsValue: "#f8f8f2",
    costValue: "#f1fa8c",
    tokensValue: "#f8f8f2",
    tokensInValue: "#6272a4",
    tokensOutValue: "#6272a4",
    cacheValue: "#6272a4",
    // Lines
    headerLine: "#44475a",
    footerLine: "#44475a",
  },

  // ==========================================================================
  // Gruvbox — warm retro earth tones
  // ==========================================================================
  gruvbox: {
    title: "#fabd2f",
    scope: "#928374",
    // Headers
    providerHeader: "#83a598",
    modelHeader: "#83a598",
    sessionsHeader: "#928374",
    msgsHeader: "#928374",
    costHeader: "#b8bb26",
    tokensHeader: "#928374",
    tokensInHeader: "#665c54",
    tokensOutHeader: "#665c54",
    cacheHeader: "#665c54",
    // Values
    providerValue: "#ebdbb2",
    modelValue: "#ebdbb2",
    sessionsValue: "#d5c4a1",
    msgsValue: "#d5c4a1",
    costValue: "#b8bb26",
    tokensValue: "#d5c4a1",
    tokensInValue: "#928374",
    tokensOutValue: "#928374",
    cacheValue: "#928374",
    // Lines
    headerLine: "#504945",
    footerLine: "#504945",
  },

  // ==========================================================================
  // Nord — cool arctic blue/gray
  // ==========================================================================
  nord: {
    title: "#88c0d0",
    scope: "#4c566a",
    // Headers
    providerHeader: "#81a1c1",
    modelHeader: "#81a1c1",
    sessionsHeader: "#4c566a",
    msgsHeader: "#4c566a",
    costHeader: "#ebcb8b",
    tokensHeader: "#4c566a",
    tokensInHeader: "#434c5e",
    tokensOutHeader: "#434c5e",
    cacheHeader: "#434c5e",
    // Values
    providerValue: "#d8dee9",
    modelValue: "#d8dee9",
    sessionsValue: "#e5e9f0",
    msgsValue: "#e5e9f0",
    costValue: "#ebcb8b",
    tokensValue: "#e5e9f0",
    tokensInValue: "#4c566a",
    tokensOutValue: "#4c566a",
    cacheValue: "#4c566a",
    // Lines
    headerLine: "#3b4252",
    footerLine: "#3b4252",
  },

  // ==========================================================================
  // Catppuccin — pastel macchiato
  // ==========================================================================
  catppuccin: {
    title: "#89b4fa",
    scope: "#585b70",
    // Headers
    providerHeader: "#a6e3a1",
    modelHeader: "#a6e3a1",
    sessionsHeader: "#585b70",
    msgsHeader: "#585b70",
    costHeader: "#f9e2af",
    tokensHeader: "#585b70",
    tokensInHeader: "#45475a",
    tokensOutHeader: "#45475a",
    cacheHeader: "#45475a",
    // Values
    providerValue: "#cdd6f4",
    modelValue: "#cdd6f4",
    sessionsValue: "#bac2de",
    msgsValue: "#bac2de",
    costValue: "#f9e2af",
    tokensValue: "#bac2de",
    tokensInValue: "#585b70",
    tokensOutValue: "#585b70",
    cacheValue: "#585b70",
    // Lines
    headerLine: "#45475a",
    footerLine: "#45475a",
  },

  // ==========================================================================
  // Monokai — dark bg with vibrant syntax-inspired accents
  // ==========================================================================
  monokai: {
    title: "#ae81ff",
    scope: "#75715e",
    // Headers
    providerHeader: "#a6e22e",
    modelHeader: "#a6e22e",
    sessionsHeader: "#75715e",
    msgsHeader: "#75715e",
    costHeader: "#e4db74",
    tokensHeader: "#75715e",
    tokensInHeader: "#49483e",
    tokensOutHeader: "#49483e",
    cacheHeader: "#49483e",
    // Values
    providerValue: "#f8f8f2",
    modelValue: "#f8f8f2",
    sessionsValue: "#f8f8f2",
    msgsValue: "#f8f8f2",
    costValue: "#e4db74",
    tokensValue: "#f8f8f2",
    tokensInValue: "#75715e",
    tokensOutValue: "#75715e",
    cacheValue: "#75715e",
    // Lines
    headerLine: "#66d9ef",
    footerLine: "#66d9ef",
  },
};

// =============================================================================
// Resolution options
// =============================================================================

export interface ResolveColorOptions {
  /** Active display mode (for per-mode override lookup). Defaults to config.defaultMode. */
  mode?: DisplayMode;
  /** Mapping from Theme fg role names to hex colors. Defaults to defaultThemeFgMap. */
  themeFgMap?: Record<string, string>;
}

// =============================================================================
// Internal: color value → ANSI resolution
// =============================================================================

/**
 * Given a color override value (which may be a role name, ANSI palette name,
 * or hex code), resolve it to an ANSI escape string using the provided
 * theme fg map. Returns "" for invalid/unparseable values.
 */
function overrideToAnsi(raw: string, fgMap: Record<string, string>): string {
  // 1. Try hex code
  const ansi = hexToAnsi(raw);
  if (ansi) return ansi;

  // 2. Try theme fg role
  const hexFromRole = fgMap[raw];
  if (hexFromRole) return hexToAnsi(hexFromRole);

  // 3. Try 16-color ANSI name
  const ansiFromName = ansiNameToAnsi(raw);
  if (ansiFromName) return ansiFromName;

  // 4. Unknown — fallback
  return "";
}

/**
 * Resolve a single override layer: returns the first non-null value.
 * null means "delegate to the next layer down."
 */
function pickOverride(
  overrides: ColorOverrides | undefined,
  element: ColorElement,
): string | null {
  if (!overrides) return null;
  // All ColorOverrides keys match ColorElement exactly
  return (overrides as Record<string, string | null>)[element] ?? null;
}

// =============================================================================
// Public API: resolveColor
// =============================================================================

/**
 * Resolve the final ANSI foreground color escape for an element given the
 * full config and optional resolution options.
 *
 * Resolution order (highest priority first):
 *   1. Per-mode override (non-null)
 *   2. Global override (non-null)
 *   3. Themed preset default
 *   4. Hardcoded fallback ("dim" role → hex → ANSI)
 *
 * @param element  The colorable element to resolve
 * @param config   The full resolved UsageWidgetConfig
 * @param options  Optional mode and theme fg map overrides
 * @returns        ANSI foreground escape sequence (e.g. "\x1b[38;2;84;160;255m")
 */
export function resolveColor(
  element: ColorElement,
  config: UsageWidgetConfig,
  options?: ResolveColorOptions,
): string {
  const mode = options?.mode ?? config.defaultMode;
  const fgMap = options?.themeFgMap ?? defaultThemeFgMap;

  // 1. Per-mode override
  const perModeOverride = pickOverride(config.perModeColorOverrides[mode], element);
  if (perModeOverride !== null) {
    const result = overrideToAnsi(perModeOverride, fgMap);
    if (result) return result;
    // Invalid override — fall through to next layer
  }

  // 2. Global override
  const globalOverride = pickOverride(config.globalColorOverrides, element);
  if (globalOverride !== null) {
    const result = overrideToAnsi(globalOverride, fgMap);
    if (result) return result;
    // Invalid override — fall through to next layer
  }

  // 3. Themed preset — per-mode override first, then global
  const perModePreset = config.perModeThemedPreset[mode];
  const effectivePreset = perModePreset ?? config.themedPreset;
  const preset = colorPresets[effectivePreset] ?? colorPresets.default;
  const presetHex = preset[element];
  if (presetHex) {
    const result = hexToAnsi(presetHex);
    if (result) return result;
  }

  // 4. Hardcoded fallback — use "dim" from the fg map
  const fallbackHex = fgMap["dim"] ?? "#6a737d";
  return hexToAnsi(fallbackHex) || "\x1b[37m";
}
